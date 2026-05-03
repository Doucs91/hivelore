/**
 * Stack memory packs — pre-seeded validated memories for common stacks.
 *
 * Each pack contains 4-8 high-value gotchas/conventions that every team
 * using that stack rediscovers. Pre-seeding them means haive is useful
 * from J+0, not J+30.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildFrontmatter,
  memoryFilePath,
  serializeMemory,
  type HaivePaths,
} from "@hiveai/core";

interface PackMemory {
  slug: string;
  type: "gotcha" | "convention" | "decision" | "architecture";
  tags: string[];
  body: string;
}

type StackName = "nestjs" | "nextjs" | "remix" | "react" | "express" | "fastify" | "prisma" | "drizzle"
  | "zustand" | "redux" | "reactquery" | "trpc" | "mongoose" | "graphql";

const PACKS: Record<StackName, PackMemory[]> = {
  nestjs: [
    {
      slug: "jwtmodule-requires-secret",
      type: "gotcha",
      tags: ["auth", "jwt", "nestjs"],
      body: `JwtModule must be registered with an explicit secret — there is no default.

\`\`\`ts
JwtModule.register({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: '7d' } })
\`\`\`

Without a secret, tokens are signed with an empty string and any client can forge them.
Always load the secret from env and validate it is defined at startup.`,
    },
    {
      slug: "global-validation-pipe",
      type: "convention",
      tags: ["validation", "nestjs", "security"],
      body: `Register ValidationPipe globally in main.ts, not per-controller.

\`\`\`ts
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
\`\`\`

- \`whitelist: true\` strips unknown properties silently
- \`forbidNonWhitelisted: true\` throws 400 on unknown fields (safer)
- Without this, NestJS passes unvalidated payloads to handlers.`,
    },
    {
      slug: "nestjs-no-direct-orm-in-controller",
      type: "convention",
      tags: ["architecture", "nestjs"],
      body: `Controllers must never import Prisma/TypeORM directly — that belongs in Services.

Controller → Service → Repository (or direct ORM) is the required layering.
Direct ORM usage in controllers makes testing impossible and couples transport to persistence.`,
    },
    {
      slug: "nestjs-exception-filter-for-prisma",
      type: "gotcha",
      tags: ["error-handling", "nestjs", "prisma"],
      body: `Prisma errors bubble up as unhandled 500s without a custom exception filter.

Create an \`AllExceptionsFilter\` or a specific \`PrismaClientExceptionFilter\` that maps:
- P2002 (unique constraint) → 409 Conflict
- P2025 (record not found) → 404 Not Found
- P2003 (foreign key) → 422 Unprocessable

Without this, clients receive raw Prisma error messages which may leak schema info.`,
    },
  ],

  nextjs: [
    {
      slug: "server-components-no-client-hooks",
      type: "gotcha",
      tags: ["nextjs", "react", "server-components"],
      body: `Server Components cannot use useState, useEffect, or any browser APIs.

Add \`"use client"\` at the top of any component that needs hooks or event handlers.
The boundary propagates down — children of a client component don't need the directive.

Common mistake: importing a client-only library (e.g. framer-motion) in a server component
causes a cryptic runtime error. Check for browser globals (window, document, localStorage).`,
    },
    {
      slug: "nextjs-env-client-exposure",
      type: "gotcha",
      tags: ["security", "nextjs", "env"],
      body: `Only environment variables prefixed with NEXT_PUBLIC_ are exposed to the browser.

Never put secrets in NEXT_PUBLIC_* variables — they are bundled into the client JS.
Variables without the prefix are server-only and safe for API keys, database URLs, etc.`,
    },
    {
      slug: "nextjs-fetch-cache-defaults",
      type: "gotcha",
      tags: ["nextjs", "caching", "fetch"],
      body: `In Next.js App Router, \`fetch()\` is cached indefinitely by default in Server Components.

Add \`{ cache: 'no-store' }\` for dynamic data, or \`{ next: { revalidate: 60 } }\` for ISR.
Forgetting this means stale data is returned after a deploy until the cache expires.`,
    },
    {
      slug: "nextjs-metadata-api",
      type: "convention",
      tags: ["nextjs", "seo"],
      body: `Use the Metadata API (export const metadata / generateMetadata) instead of <Head>.

\`<Head>\` from next/head still works in pages/ but is not supported in the App Router.
Use \`generateMetadata\` for dynamic titles/descriptions based on route params.`,
    },
  ],

  remix: [
    {
      slug: "remix-loader-vs-action",
      type: "convention",
      tags: ["remix", "architecture"],
      body: `loader = GET data for rendering. action = handle form submissions / mutations.

- \`loader\` runs on every GET request (server-side, returns data for the component)
- \`action\` runs on POST/PUT/DELETE (mutations — redirect after success)
- Never fetch inside the component itself for route data — use the loader instead.`,
    },
    {
      slug: "remix-error-boundaries",
      type: "gotcha",
      tags: ["remix", "error-handling"],
      body: `Each route should export an ErrorBoundary to catch loader/action errors gracefully.

Without it, errors bubble to the root boundary and replace the entire page.
Export \`export function ErrorBoundary() { ... }\` to scope errors to the route.`,
    },
  ],

  react: [
    {
      slug: "useeffect-cleanup",
      type: "gotcha",
      tags: ["react", "memory-leak"],
      body: `useEffect subscriptions, timers, and async operations need cleanup to avoid memory leaks.

\`\`\`ts
useEffect(() => {
  const controller = new AbortController();
  fetchData({ signal: controller.signal });
  return () => controller.abort(); // cleanup
}, [dep]);
\`\`\`

Missing cleanup causes: state updates on unmounted components, duplicate subscriptions,
and event listeners that accumulate across re-renders.`,
    },
    {
      slug: "react-key-prop-in-lists",
      type: "gotcha",
      tags: ["react", "performance"],
      body: `Keys must be stable, unique IDs — never use array index as key.

Using index as key causes React to re-render wrong items on reorder/filter,
corrupts form state, and triggers avoidable DOM mutations.
Use item.id or a stable hash — never Math.random().`,
    },
    {
      slug: "react-avoid-use-effect-for-derived-state",
      type: "convention",
      tags: ["react", "state"],
      body: `Don't use useEffect to sync state from props — compute it during render instead.

\`\`\`ts
// ❌ Bad
const [fullName, setFullName] = useState('');
useEffect(() => { setFullName(first + ' ' + last); }, [first, last]);

// ✅ Good
const fullName = first + ' ' + last; // derived during render
\`\`\``,
    },
  ],

  express: [
    {
      slug: "express-missing-validation",
      type: "gotcha",
      tags: ["security", "express", "validation"],
      body: `Express does not validate request bodies by default — always validate with zod, joi, or express-validator.

Without validation:
- req.body fields are \`any\` and may be missing, wrong type, or injected
- Downstream code crashes or processes malicious data
Add a validation middleware for every route that accepts user input.`,
    },
    {
      slug: "express-async-error-propagation",
      type: "gotcha",
      tags: ["express", "error-handling"],
      body: `Async route handlers don't propagate errors to error middleware without explicit next(err).

\`\`\`ts
// ❌ Unhandled — Express never sees the rejection
app.get('/', async (req, res) => { throw new Error('oops'); });

// ✅ Correct
app.get('/', async (req, res, next) => {
  try { await doWork(); }
  catch (err) { next(err); }
});
\`\`\`
Or use express-async-errors / wrap helper.`,
    },
  ],

  fastify: [
    {
      slug: "fastify-schema-validation-required",
      type: "convention",
      tags: ["fastify", "validation", "security"],
      body: `Always define a JSON schema on routes — Fastify validates and coerces automatically.

\`\`\`ts
fastify.post('/users', {
  schema: { body: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' } } } }
}, handler)
\`\`\`
Routes without schema accept any body and bypass Fastify's fast-json-stringify serialization.`,
    },
  ],

  prisma: [
    {
      slug: "prisma-no-disconnect-in-lambda",
      type: "gotcha",
      tags: ["prisma", "serverless"],
      body: `Do NOT call prisma.$disconnect() inside Lambda/Edge function handlers.

Calling $disconnect() after each request wastes the warm connection pool.
Create one PrismaClient per process (module-level singleton), not per request.
Disconnecting is only needed when the process is shutting down.`,
    },
    {
      slug: "prisma-migrations-never-modify",
      type: "convention",
      tags: ["prisma", "database", "migrations"],
      body: `Never modify an existing migration file — create a new one instead.

Prisma tracks migration history by file hash. Editing a deployed migration
causes \`migrate deploy\` to fail with a checksum mismatch in production.
Always use \`npx prisma migrate dev --name <description>\` to create incremental migrations.`,
    },
  ],

  drizzle: [
    {
      slug: "drizzle-always-await-queries",
      type: "gotcha",
      tags: ["drizzle", "async"],
      body: `Drizzle queries are thenable but not auto-executed — always await them.

\`\`\`ts
// ❌ Silently returns a query builder, never executes
const rows = db.select().from(users).where(eq(users.id, id));

// ✅ Correct
const rows = await db.select().from(users).where(eq(users.id, id));
\`\`\``,
    },
    {
      slug: "drizzle-schema-must-match-db",
      type: "gotcha",
      tags: ["drizzle", "migrations"],
      body: `Drizzle does NOT auto-sync the schema to the database — you must run migrations explicitly.

After changing schema.ts:
1. \`npx drizzle-kit generate\` — creates migration SQL
2. \`npx drizzle-kit migrate\` (or push in dev) — applies it

Without this, queries silently operate on stale column definitions and may return wrong data.`,
    },
  ],

  zustand: [
    {
      slug: "zustand-select-slices-not-whole-store",
      type: "convention",
      tags: ["zustand", "performance", "react"],
      body: `Always select specific slices — never subscribe to the whole store.

\`\`\`ts
// ❌ Re-renders on any store change (even unrelated fields)
const store = useStore();

// ✅ Re-renders only when count changes
const count = useStore((s) => s.count);
\`\`\`

Subscribing to the whole store is the single most common Zustand performance mistake.`,
    },
    {
      slug: "zustand-devtools-wrap-dev-only",
      type: "convention",
      tags: ["zustand", "devtools", "performance"],
      body: `Wrap Zustand devtools middleware in a dev-only condition.

\`\`\`ts
import { devtools } from 'zustand/middleware';

const useStore = create(
  process.env.NODE_ENV === 'development'
    ? devtools(storeImpl, { name: 'AppStore' })
    : storeImpl,
);
\`\`\`

Shipping devtools to production adds overhead and exposes store internals in bundle.`,
    },
    {
      slug: "zustand-persist-hydration-ssr",
      type: "gotcha",
      tags: ["zustand", "ssr", "nextjs", "hydration"],
      body: `Zustand persist middleware causes hydration mismatch in SSR (Next.js / Remix).

The server renders with empty state; the client rehydrates from localStorage.
Fix: use \`skipHydration: true\` and manually call \`rehydrate()\` after mount.

\`\`\`ts
// In a useEffect or useLayoutEffect on the client:
useEffect(() => { useStore.persist.rehydrate(); }, []);
\`\`\``,
    },
  ],

  redux: [
    {
      slug: "redux-toolkit-immer-mutate-or-return",
      type: "gotcha",
      tags: ["redux", "redux-toolkit", "immer"],
      body: `In RTK createSlice reducers (Immer), you must EITHER mutate the draft OR return a new value — never both.

\`\`\`ts
// ✅ Mutate draft (Immer converts to immutable update)
state.count += 1;

// ✅ Return new value
return { ...state, count: state.count + 1 };

// ❌ Both — causes undefined state
state.count += 1;
return state; // DON'T — Immer sees both a mutation and a return
\`\`\``,
    },
    {
      slug: "redux-toolkit-rtk-query-over-thunk",
      type: "decision",
      tags: ["redux", "redux-toolkit", "data-fetching"],
      body: `Use RTK Query for server data, not createAsyncThunk.

RTK Query automatically handles: caching, loading/error states, cache invalidation, polling, optimistic updates.
createAsyncThunk is for one-off side effects that don't fit the query/mutation model (e.g. file upload with progress).`,
    },
    {
      slug: "redux-toolkit-normalize-nested-data",
      type: "convention",
      tags: ["redux", "redux-toolkit", "normalization"],
      body: `Normalize nested API responses before storing in Redux — use createEntityAdapter.

Storing deeply nested objects causes:
- Redundant re-renders when any deeply nested field changes
- Difficult update logic (deep merge)

\`\`\`ts
const usersAdapter = createEntityAdapter<User>();
const usersSlice = createSlice({
  name: 'users',
  initialState: usersAdapter.getInitialState(),
  reducers: { usersReceived: usersAdapter.setAll },
});
\`\`\``,
    },
  ],

  reactquery: [
    {
      slug: "tanstack-query-stale-time-default",
      type: "gotcha",
      tags: ["react-query", "tanstack-query", "caching"],
      body: `By default, TanStack Query marks data as stale immediately (staleTime: 0) and refetches on every window focus.

Set a reasonable staleTime to avoid unnecessary network requests:

\`\`\`ts
useQuery({
  queryKey: ['user', id],
  queryFn: () => getUser(id),
  staleTime: 5 * 60 * 1000, // 5 minutes
})
\`\`\`

Set globally via QueryClient defaultOptions for consistency.`,
    },
    {
      slug: "tanstack-query-invalidate-after-mutation",
      type: "convention",
      tags: ["react-query", "tanstack-query", "mutations"],
      body: `Always invalidate related queries after a mutation to keep the cache fresh.

\`\`\`ts
useMutation({
  mutationFn: createUser,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
})
\`\`\`

Skipping invalidation causes the UI to show stale data after a write until the next background refetch.`,
    },
    {
      slug: "tanstack-query-querykey-as-dependency",
      type: "convention",
      tags: ["react-query", "tanstack-query"],
      body: `Treat the queryKey array as a dependency array — include all variables the queryFn depends on.

\`\`\`ts
// ❌ Won't refetch when userId changes
useQuery({ queryKey: ['user'], queryFn: () => getUser(userId) });

// ✅ Refetches automatically when userId changes
useQuery({ queryKey: ['user', userId], queryFn: () => getUser(userId) });
\`\`\``,
    },
  ],

  trpc: [
    {
      slug: "trpc-always-validate-input-with-zod",
      type: "convention",
      tags: ["trpc", "validation", "security"],
      body: `Always validate procedure inputs with Zod — tRPC infers types but doesn't enforce them at runtime without a schema.

\`\`\`ts
// ❌ No runtime validation — input is 'unknown'
t.procedure.query(({ input }) => getUser(input as string));

// ✅ Validated and typed end-to-end
t.procedure
  .input(z.object({ id: z.string().uuid() }))
  .query(({ input }) => getUser(input.id));
\`\`\``,
    },
    {
      slug: "trpc-server-side-caller-for-ssr",
      type: "convention",
      tags: ["trpc", "nextjs", "ssr"],
      body: `Use the server-side caller in Server Components / SSR — don't call tRPC over HTTP from the server.

\`\`\`ts
// In Next.js App Router server component
const caller = appRouter.createCaller(await createContext());
const data = await caller.users.getAll(); // Direct function call, no HTTP
\`\`\`

HTTP round-trips from server → server add latency and bypass auth context.`,
    },
    {
      slug: "trpc-context-for-auth",
      type: "architecture",
      tags: ["trpc", "auth"],
      body: `Put auth session on the tRPC context, not in individual procedures.

\`\`\`ts
// createContext(): resolve session once, share across all procedures
export async function createContext({ req }: CreateNextContextOptions) {
  const session = await getServerSession(req);
  return { session, db };
}

// In procedure: ctx.session.user is always typed
const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session?.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return next({ ctx: { ...ctx, user: ctx.session.user } });
});
\`\`\``,
    },
  ],

  mongoose: [
    {
      slug: "mongoose-connection-singleton",
      type: "convention",
      tags: ["mongoose", "mongodb", "connection", "serverless"],
      body: `Create one Mongoose connection at startup — never connect inside route handlers.

In serverless (Next.js, Vercel), cache the connection to reuse across warm invocations:

\`\`\`ts
let cached = (global as any).__mongoose ?? { conn: null, promise: null };

export async function dbConnect() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(process.env.MONGODB_URI!);
  }
  cached.conn = await cached.promise;
  (global as any).__mongoose = cached;
  return cached.conn;
}
\`\`\``,
    },
    {
      slug: "mongoose-lean-for-read-only",
      type: "convention",
      tags: ["mongoose", "performance"],
      body: `Add .lean() to read-only queries to get plain JS objects instead of full Mongoose documents.

\`\`\`ts
// ❌ Full Mongoose document — slow, heavy, has virtuals/methods
const users = await User.find({});

// ✅ Plain JS object — 2-5x faster on large result sets
const users = await User.find({}).lean();
\`\`\`

Never use .lean() when you need to call .save() or Mongoose instance methods.`,
    },
    {
      slug: "mongoose-index-frequently-queried-fields",
      type: "gotcha",
      tags: ["mongoose", "mongodb", "performance"],
      body: `Mongoose does NOT create indexes automatically unless you call syncIndexes() or ensureIndexes().

Declare indexes in the schema and sync them at startup:

\`\`\`ts
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ createdAt: -1 });

// At startup (not per-request):
await User.syncIndexes();
\`\`\`

Missing indexes cause full collection scans and timeouts at scale.`,
    },
  ],

  graphql: [
    {
      slug: "graphql-n-plus-one-dataloader",
      type: "gotcha",
      tags: ["graphql", "performance", "n+1"],
      body: `GraphQL resolvers cause N+1 database queries without DataLoader batching.

Every field resolver runs independently — fetching related data naively causes N queries for N items.

\`\`\`ts
// In context, create one DataLoader per request (NOT per resolver call)
const userLoader = new DataLoader(async (ids: readonly string[]) =>
  User.findByIds(ids as string[])
);

// In resolver:
author: (post) => userLoader.load(post.authorId),
\`\`\`

A list of 100 posts with authors = 101 queries without DataLoader, 2 queries with it.`,
    },
    {
      slug: "graphql-mask-internal-errors-in-production",
      type: "gotcha",
      tags: ["graphql", "security", "apollo"],
      body: `Apollo Server exposes full error details (including stack traces) in development.

In production, mask internal errors to prevent leaking implementation details:

\`\`\`ts
new ApolloServer({
  formatError: (formattedError) => {
    if (formattedError.extensions?.code === 'INTERNAL_SERVER_ERROR') {
      return { message: 'Internal server error', extensions: { code: 'INTERNAL_SERVER_ERROR' } };
    }
    return formattedError;
  },
});
\`\`\``,
    },
    {
      slug: "graphql-depth-limit-and-complexity",
      type: "convention",
      tags: ["graphql", "security", "dos"],
      body: `Add query depth and complexity limits to prevent DoS via deeply nested queries.

Without limits, a single query can request exponentially nested data and exhaust the server.

\`\`\`ts
import depthLimit from 'graphql-depth-limit';
import { createComplexityLimitRule } from 'graphql-validation-complexity';

new ApolloServer({
  validationRules: [
    depthLimit(7),
    createComplexityLimitRule(1000),
  ],
});
\`\`\``,
    },
  ],

};

export const SUPPORTED_STACKS = Object.keys(PACKS) as StackName[];

export function isValidStack(name: string): name is StackName {
  return name in PACKS;
}

/** Auto-detect which stacks are present from a package.json dep map. */
export function autoDetectStacks(deps: Record<string, string>): StackName[] {
  const detected: StackName[] = [];
  const stackDetectors: [StackName, string[]][] = [
    ["nestjs",     ["@nestjs/core"]],
    ["nextjs",     ["next"]],
    ["remix",      ["@remix-run/react", "@remix-run/node"]],
    ["react",      ["react"]],
    ["express",    ["express"]],
    ["fastify",    ["fastify"]],
    ["prisma",     ["@prisma/client", "prisma"]],
    ["drizzle",    ["drizzle-orm"]],
    ["zustand",    ["zustand"]],
    ["redux",      ["@reduxjs/toolkit", "redux"]],
    ["reactquery", ["@tanstack/react-query", "react-query"]],
    ["trpc",       ["@trpc/server", "@trpc/client"]],
    ["mongoose",   ["mongoose"]],
    ["graphql",    ["@apollo/client", "@apollo/server", "apollo-server", "graphql"]],
  ];
  for (const [stack, signals] of stackDetectors) {
    if (signals.some((s) => s in deps)) detected.push(stack);
  }
  // Deduplicate: avoid react when next/remix already detected
  if (detected.includes("nextjs") || detected.includes("remix")) {
    return detected.filter((s) => s !== "react");
  }
  return detected;
}

/** Seed memory pack files on disk. Returns count of memories written. */
export async function seedStackPack(
  haivePaths: HaivePaths,
  stack: StackName,
): Promise<number> {
  const memories = PACKS[stack];
  if (!memories) return 0;

  await mkdir(haivePaths.teamDir, { recursive: true });

  let count = 0;
  for (const mem of memories) {
    const fm = buildFrontmatter({
      type: mem.type,
      slug: `${stack}-${mem.slug}`,
      scope: "team",
      status: "validated",
      tags: mem.tags,
    });
    const filePath = memoryFilePath(haivePaths, "team", fm.id);
    if (existsSync(filePath)) continue; // never overwrite existing
    const content = serializeMemory({ frontmatter: fm, body: mem.body });
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    count++;
  }
  return count;
}
