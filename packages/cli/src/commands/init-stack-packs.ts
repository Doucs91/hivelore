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
  loadMemoriesFromDir,
  meetsSeedQualityFloor,
  memoryFilePath,
  serializeMemory,
  STACK_PACK_TAG,
  type HaivePaths,
  type Sensor,
} from "@hivelore/core";
import { ui } from "../utils/ui.js";

/**
 * A curated, hand-authored regex sensor for a stack-pack memory. Turns generic
 * framework guidance into a deterministic feedforward+feedback guardrail: the
 * lesson fires on the user's own diff, not just when the briefing surfaces it.
 * Seed sensors are always `warn` (never auto-block) and `autogen: false` (vetted).
 */
interface PackSensor {
  pattern: string;
  flags?: string;
  message: string;
  /** Optional exact-file/dir-prefix scoping. Empty = applies to all added diff lines. */
  paths?: string[];
}

interface PackMemory {
  slug: string;
  type: "gotcha" | "convention" | "decision" | "architecture";
  tags: string[];
  body: string;
  /** Optional executable guardrail derived from this lesson. */
  sensor?: PackSensor;
}

export type StackName = "nestjs" | "nextjs" | "remix" | "react" | "express" | "fastify" | "prisma" | "drizzle"
  | "zustand" | "redux" | "reactquery" | "trpc" | "mongoose" | "graphql"
  | "fastapi" | "django" | "go" | "flask" | "vue" | "spring"
  | "tailwind" | "vite" | "sveltekit" | "astro" | "typescript" | "monorepo"
  | "laravel" | "rails" | "dotnet" | "docker";

export const PACKS: Record<StackName, PackMemory[]> = {
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
      sensor: {
        pattern: "@prisma/client|PrismaClient|getRepository\\(|createQueryBuilder\\(",
        paths: ["**/*.controller.ts"],
        message: "ORM/Prisma used directly in a controller — move persistence into a Service (Controller → Service → Repository).",
      },
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
      sensor: {
        pattern: "NEXT_PUBLIC_[A-Z0-9_]*(SECRET|PRIVATE|TOKEN|PASSWORD|API_?KEY)",
        message: "A NEXT_PUBLIC_ env var with a secret-looking name is bundled into client JS — move the secret to a server-only (non-NEXT_PUBLIC_) variable.",
      },
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
      sensor: {
        pattern: "key=\\{\\s*index\\s*\\}",
        message: "Array index used as a React key — switch to a stable unique id to avoid state corruption on reorder.",
      },
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
      sensor: {
        pattern: "\\$disconnect\\(\\)",
        message: "prisma.$disconnect() per request drains the warm connection pool in serverless — use a module-level PrismaClient singleton and only disconnect on shutdown.",
      },
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
      sensor: {
        pattern: "use[A-Z]\\w*Store\\(\\s*\\)",
        message: "A Zustand store hook called with no selector subscribes to the WHOLE store (re-renders on any change) — pass a slice selector: useStore(s => s.field).",
      },
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

\`.lean()\` skips hydration into a Mongoose \`Document\`, so getters, virtuals, \`toObject()\` and
instance methods are gone. Never use \`.lean()\` when you then call \`.save()\` or instance methods.`,
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

  fastapi: [
    {
      slug: "fastapi-validate-with-pydantic",
      type: "convention",
      tags: ["fastapi", "python", "validation"],
      body: `Declare request/response models with Pydantic — never read raw dict bodies.

\`\`\`py
class CreateUser(BaseModel):
    email: EmailStr
    age: int = Field(ge=0)

@app.post("/users")
def create(user: CreateUser): ...
\`\`\`

Pydantic validates and coerces at the boundary; raw \`dict\` bodies bypass validation and typing.`,
    },
    {
      slug: "fastapi-no-blocking-io-in-async",
      type: "gotcha",
      tags: ["fastapi", "python", "async", "performance"],
      body: `Never call blocking I/O (requests, time.sleep, sync DB drivers) inside an \`async def\` route.

A blocking call inside the event loop freezes the whole worker for every concurrent request.
Use an async client (httpx.AsyncClient, asyncpg) or run blocking work in a threadpool
(\`await run_in_threadpool(...)\` / \`def\` route, which FastAPI runs in a threadpool).`,
    },
    {
      slug: "fastapi-uvicorn-reload-not-in-prod",
      type: "gotcha",
      tags: ["fastapi", "python", "deployment"],
      body: `\`uvicorn.run(..., reload=True)\` is a dev-only feature — never ship it to production.

Reload spawns a file-watcher process and disables multi-worker scaling.
In production run \`uvicorn app:app --workers N\` (no reload) behind a process manager.`,
      sensor: {
        pattern: "uvicorn\\.run\\([^)]*reload\\s*=\\s*True",
        message: "uvicorn reload=True is dev-only — remove it from production entrypoints.",
      },
    },
    {
      slug: "fastapi-no-bare-except",
      type: "convention",
      tags: ["fastapi", "python", "error-handling"],
      body: `Never use a bare \`except:\` — it swallows KeyboardInterrupt/SystemExit and hides real bugs.

Catch the specific exception you expect, or \`except Exception as e:\` at most, and log it.`,
      sensor: {
        pattern: "except\\s*:",
        message: "Bare `except:` swallows everything (incl. KeyboardInterrupt) — catch a specific exception type.",
      },
    },
  ],

  django: [
    {
      slug: "django-debug-false-in-prod",
      type: "gotcha",
      tags: ["django", "python", "security", "deployment"],
      body: `\`DEBUG = True\` in production leaks stack traces, settings, and SQL to any visitor.

Drive it from the environment and default to safe:

\`\`\`py
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"
\`\`\``,
      sensor: {
        pattern: "DEBUG\\s*=\\s*True",
        message: "DEBUG = True leaks internals in production — read it from the environment and default to False.",
      },
    },
    {
      slug: "django-secret-key-from-env",
      type: "gotcha",
      tags: ["django", "python", "security"],
      body: `Never hardcode SECRET_KEY in settings — load it from the environment.

A committed SECRET_KEY lets anyone forge sessions and signed tokens.

\`\`\`py
SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
\`\`\``,
      sensor: {
        pattern: "SECRET_KEY\\s*=\\s*[\"'][^\"']+[\"']",
        message: "Hardcoded SECRET_KEY — load it from os.environ instead of committing a literal.",
      },
    },
    {
      slug: "django-select-related-n-plus-one",
      type: "gotcha",
      tags: ["django", "python", "orm", "performance"],
      body: `Accessing a ForeignKey in a loop triggers one query per row (N+1).

Use \`select_related\` (FK / one-to-one, SQL JOIN) and \`prefetch_related\` (M2M / reverse FK):

\`\`\`py
for order in Order.objects.select_related("customer").all():
    order.customer.name  # no extra query
\`\`\``,
    },
  ],

  flask: [
    {
      slug: "flask-no-debug-in-prod",
      type: "gotcha",
      tags: ["flask", "python", "security", "deployment"],
      body: `\`app.run(debug=True)\` enables the Werkzeug debugger — remote code execution if exposed.

Never ship debug mode. Run behind a real WSGI server (gunicorn/uwsgi) in production and
drive debug from the environment for local dev only.`,
      sensor: {
        pattern: "app\\.run\\([^)]*debug\\s*=\\s*True",
        message: "Flask debug=True exposes the Werkzeug console (RCE) — never run it in production.",
      },
    },
    {
      slug: "flask-secret-key-from-env",
      type: "convention",
      tags: ["flask", "python", "security"],
      body: `Load \`SECRET_KEY\` from the environment — never commit a literal.

\`\`\`py
app.config["SECRET_KEY"] = os.environ["SECRET_KEY"]
\`\`\`
A committed key lets anyone forge sessions and CSRF tokens.`,
    },
    {
      slug: "flask-no-sql-string-interpolation",
      type: "gotcha",
      tags: ["flask", "python", "security", "sql-injection"],
      body: `Never build SQL with f-strings/%-formatting — use parameterized queries.

\`\`\`py
# ❌ SQL injection
db.execute(f"SELECT * FROM users WHERE id = {uid}")
# ✅
db.execute("SELECT * FROM users WHERE id = %s", (uid,))
\`\`\``,
      sensor: {
        pattern: "execute\\(\\s*f[\"']",
        message: "SQL built with an f-string inside execute() — SQL injection risk; use a parameterized query: execute(\"… %s …\", (params,)).",
      },
    },
  ],

  vue: [
    {
      slug: "vue-v-html-xss",
      type: "gotcha",
      tags: ["vue", "security", "xss"],
      body: `\`v-html\` renders raw HTML and bypasses Vue's escaping — an XSS sink for user content.

Only use it on trusted/sanitized content. Prefer text interpolation ({{ }}) or sanitize
with DOMPurify before binding.`,
      sensor: {
        pattern: "v-html",
        message: "v-html renders unescaped HTML (XSS risk) — sanitize the value or use text interpolation.",
      },
    },
    {
      slug: "vue-key-in-v-for",
      type: "convention",
      tags: ["vue", "performance"],
      body: `Always bind a stable \`:key\` on \`v-for\` — and never the loop index.

Index keys corrupt component state on reorder/insert, exactly like React. Use a stable id.`,
    },
    {
      slug: "vue-props-are-readonly",
      type: "gotcha",
      tags: ["vue", "reactivity"],
      body: `Never mutate a prop inside a child component — props are one-way (parent → child).

Mutating a prop breaks the data flow and warns in dev. Emit an event (\`update:modelValue\`)
or copy the prop into local state, depending on intent.`,
    },
  ],

  spring: [
    {
      slug: "spring-constructor-injection",
      type: "convention",
      tags: ["spring", "java", "di", "testing"],
      body: `Prefer constructor injection over \`@Autowired\` field injection.

Constructor injection makes dependencies explicit, allows \`final\` fields, and lets you
instantiate the class in tests without a Spring context. Field injection hides dependencies
and forces reflection-based test setup.`,
    },
    {
      slug: "spring-no-cors-wildcard",
      type: "gotcha",
      tags: ["spring", "java", "security", "cors"],
      body: `\`@CrossOrigin(origins = "*")\` (or wildcard CORS config) allows any site to call your API.

Combined with credentials it leaks authenticated data cross-origin. Whitelist explicit origins.`,
      sensor: {
        pattern: "@CrossOrigin\\([^)]*\\*",
        message: "Wildcard CORS (@CrossOrigin origins=\"*\") lets any site call your API — whitelist explicit origins.",
      },
    },
    {
      slug: "spring-no-field-secrets",
      type: "convention",
      tags: ["spring", "java", "security", "config"],
      body: `Keep secrets in externalized config (env / vault / application.yml placeholders), not in source.

\`\`\`java
@Value("\${app.api-key}") private String apiKey; // resolved from env, not hardcoded
\`\`\``,
    },
  ],

  go: [
    {
      slug: "go-check-every-error",
      type: "convention",
      tags: ["go", "error-handling"],
      body: `Check every returned error — never discard it with \`_\`.

\`\`\`go
// ❌ silently ignores failure
val, _ := doThing()

// ✅
val, err := doThing()
if err != nil {
    return fmt.Errorf("doThing: %w", err)
}
\`\`\`
Wrap with \`%w\` to preserve the chain for errors.Is/As.`,
    },
    {
      slug: "go-defer-close-after-error-check",
      type: "gotcha",
      tags: ["go", "resources"],
      body: `Place \`defer rows.Close()\` (or file/body Close) AFTER checking the open error, not before.

\`\`\`go
rows, err := db.Query(q)
if err != nil { return err }
defer rows.Close() // only reached when rows is non-nil
\`\`\`
Deferring before the error check can call Close on a nil resource and panic.`,
    },
    {
      slug: "go-context-first-param",
      type: "convention",
      tags: ["go", "context", "api-design"],
      body: `context.Context is always the FIRST parameter and is never stored in a struct.

\`\`\`go
func Fetch(ctx context.Context, id string) (*User, error)
\`\`\`
Pass it explicitly down the call chain so cancellation and deadlines propagate.`,
    },
  ],

  tailwind: [
    {
      slug: "tailwind-content-paths-required",
      type: "gotcha",
      tags: ["tailwind", "css", "build"],
      body: `Classes only ship if their files are listed in \`content\` (tailwind.config). Miss a path and the styles silently vanish in production.

\`\`\`js
content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"]
\`\`\`
Never build class names dynamically by string concatenation (\`\`text-\${color}-500\`\`) — Tailwind's scanner can't see them and they get purged. Use full literal class names or a safelist.`,
    },
    {
      slug: "tailwind-no-apply-everywhere",
      type: "convention",
      tags: ["tailwind", "css", "maintainability"],
      body: `Don't recreate component CSS with \`@apply\` for everything — it defeats the utility-first model and grows the bundle.

Prefer utility classes in markup; reach for \`@apply\` only for small, truly repeated primitives (e.g. \`.btn\`). For real components, extract a React/Vue component, not a CSS class.`,
    },
  ],

  vite: [
    {
      slug: "vite-env-prefix-client-exposure",
      type: "gotcha",
      tags: ["vite", "security", "env"],
      body: `Only \`import.meta.env.VITE_*\` variables are exposed to client code — and they are bundled into the shipped JS.

Never give a secret a \`VITE_\` prefix: it ends up readable in the browser. Keep server secrets unprefixed and read them server-side only.`,
      sensor: {
        pattern: "VITE_[A-Z0-9_]*(SECRET|PRIVATE|TOKEN|PASSWORD|API_?KEY)",
        message: "A VITE_ env var with a secret-looking name is bundled into client JS — drop the VITE_ prefix and read it server-side.",
      },
    },
    {
      slug: "vite-no-process-env",
      type: "gotcha",
      tags: ["vite", "env"],
      body: `\`process.env\` is not available in Vite client code — use \`import.meta.env\`.

Referencing \`process.env.FOO\` in browser code throws \`process is not defined\` at runtime (or is statically undefined). Vite only replaces \`import.meta.env.*\`.`,
    },
  ],

  sveltekit: [
    {
      slug: "sveltekit-env-static-private-vs-public",
      type: "gotcha",
      tags: ["sveltekit", "security", "env"],
      body: `Import secrets from \`$env/static/private\` (or \`$env/dynamic/private\`) — never \`$env/static/public\`.

\`$env/*/public\` (and any \`PUBLIC_\`-prefixed var) is shipped to the browser. SvelteKit refuses to import a private module into client code, but a value moved to a PUBLIC_ name is silently exposed.`,
    },
    {
      slug: "sveltekit-load-runs-on-server-and-client",
      type: "gotcha",
      tags: ["sveltekit", "load", "ssr"],
      body: `A universal \`load\` (in \`+page.js\`) runs on BOTH server and client. Only \`+page.server.js\` / \`+layout.server.js\` loads are server-only.

Put DB access, secrets, and private fetches in \`.server\` load functions. Universal loads must be safe to run in the browser.`,
    },
  ],

  astro: [
    {
      slug: "astro-islands-need-client-directive",
      type: "gotcha",
      tags: ["astro", "hydration", "islands"],
      body: `Components are server-rendered to static HTML by default — interactivity requires a \`client:*\` directive.

\`\`\`astro
<Counter client:load />
<Counter client:visible />
\`\`\`
Without a \`client:\` directive, event handlers and hooks simply don't run in the browser.`,
    },
    {
      slug: "astro-frontmatter-runs-on-server",
      type: "convention",
      tags: ["astro", "ssr"],
      body: `The component frontmatter (the code fence \`---\`) runs on the server at build/request time, not in the browser.

Fetch data and read secrets there freely — it never ships to the client. Don't expect \`window\`/\`document\` in the frontmatter; guard browser APIs inside \`client:\`-hydrated components or \`<script>\` tags.`,
    },
  ],

  typescript: [
    {
      slug: "typescript-no-any-prefer-unknown",
      type: "convention",
      tags: ["typescript", "types"],
      body: `Avoid \`any\` — it disables type-checking for everything it touches and spreads silently. Use \`unknown\` and narrow, or a precise type.

Enable \`"strict": true\` (and \`noImplicitAny\`) in tsconfig. \`unknown\` forces a check before use; \`any\` forces nothing.`,
      sensor: {
        pattern: ":\\s*any\\b",
        message: "Explicit `any` disables type-checking — use `unknown` + narrowing or a precise type.",
      },
    },
    {
      slug: "typescript-no-non-null-assertion-on-untrusted",
      type: "gotcha",
      tags: ["typescript", "types", "safety"],
      body: `The non-null assertion (\`value!\`) silences the compiler but does NOT check at runtime — it just crashes later if the value is actually null/undefined.

Prefer a real guard (\`if (!value) throw…\`) or optional chaining. Reserve \`!\` for cases the compiler can't see but you can prove (e.g. just-initialized fields).`,
    },
  ],

  monorepo: [
    {
      slug: "monorepo-pin-internal-deps-workspace-protocol",
      type: "convention",
      tags: ["monorepo", "turborepo", "nx", "pnpm"],
      body: `Reference internal packages with the workspace protocol (\`"@scope/pkg": "workspace:*"\`), not a version range.

A real version range makes the package manager fetch the published version from the registry instead of linking the local source — you end up testing stale code.`,
    },
    {
      slug: "monorepo-declare-task-inputs-outputs",
      type: "gotcha",
      tags: ["monorepo", "turborepo", "nx", "caching"],
      body: `Task caching is only correct if inputs/outputs are declared. An undeclared output (e.g. a \`dist/\` folder) means a cache hit restores nothing and downstream tasks break.

In Turborepo declare \`outputs\` per task in \`turbo.json\`; in Nx declare \`outputs\` in target options. Missing/incorrect \`outputs\` is the #1 cause of "works locally, broken in CI" cache bugs.`,
    },
  ],

  laravel: [
    {
      slug: "laravel-eloquent-n-plus-one",
      type: "gotcha",
      tags: ["laravel", "php", "eloquent", "performance"],
      body: `Accessing a relationship in a loop triggers one query per row (N+1). Eager-load with \`with()\`.

\`\`\`php
foreach (Post::with('author')->get() as $post) { echo $post->author->name; }
\`\`\`
Enable \`Model::preventLazyLoading()\` in dev to catch these.`,
    },
    {
      slug: "laravel-mass-assignment-fillable",
      type: "gotcha",
      tags: ["laravel", "php", "security"],
      body: `\`Model::create($request->all())\` is a mass-assignment hole unless \`$fillable\` is set — a user can set columns you never intended (e.g. \`is_admin\`).

Define \`$fillable\` (allow-list) on every model and validate the request before creating.`,
    },
  ],

  rails: [
    {
      slug: "rails-n-plus-one-includes",
      type: "gotcha",
      tags: ["rails", "ruby", "activerecord", "performance"],
      body: `Calling an association inside a loop triggers N+1 queries. Use \`includes\` to eager-load.

\`\`\`ruby
Post.includes(:author).each { |p| puts p.author.name }
\`\`\`
Add the \`bullet\` gem in development to detect them automatically.`,
    },
    {
      slug: "rails-strong-parameters",
      type: "convention",
      tags: ["rails", "ruby", "security"],
      body: `Never pass \`params\` straight to \`update\`/\`create\` — always go through strong parameters (\`params.require(:user).permit(:name, :email)\`).

Permitting everything (or skipping it) lets a request set protected attributes like \`admin\`/\`role\`.`,
    },
  ],

  dotnet: [
    {
      slug: "dotnet-async-no-blocking-result-wait",
      type: "gotcha",
      tags: ["dotnet", "csharp", "async", "deadlock"],
      body: `Never block on async with \`.Result\` or \`.Wait()\` — it deadlocks under a synchronization context (ASP.NET classic, UI).

Make the call chain async all the way up; use \`ConfigureAwait(false)\` in library code.`,
    },
    {
      slug: "dotnet-httpclient-reuse",
      type: "convention",
      tags: ["dotnet", "csharp", "resources"],
      body: `Don't create a new \`HttpClient\` per request — reuse one (or use \`IHttpClientFactory\`). Creating + disposing per call exhausts sockets (\`SocketException\` under load).

Wrap other \`IDisposable\` resources (DbConnection, streams) in \`using\` so they're released deterministically.`,
    },
  ],

  docker: [
    {
      slug: "docker-no-secrets-in-image-layers",
      type: "gotcha",
      tags: ["docker", "security", "secrets"],
      body: `\`ENV\`/\`ARG\` secrets and \`COPY .env\` are baked into image layers — anyone with the image can read them via \`docker history\`, even if a later layer deletes the file.

Use build secrets (\`RUN --mount=type=secret\`) or inject at runtime. Add \`.env\` to \`.dockerignore\`.`,
    },
    {
      slug: "docker-pin-base-image-and-nonroot",
      type: "convention",
      tags: ["docker", "kubernetes", "security"],
      body: `Pin a specific base image tag (not \`:latest\`) for reproducible builds, and run as a non-root user (\`USER app\`).

Containers default to root; a container escape then runs as host root. In Kubernetes set \`securityContext.runAsNonRoot: true\`. Use multi-stage builds to keep build tooling out of the runtime image.`,
    },
  ],

};

/**
 * Footer appended to every seeded pack memory. Keeps the corpus honest: this is
 * generic framework guidance, not repo-specific knowledge. Anchoring it to a real
 * file (or replacing it) is what turns it into high-signal context.
 */
const SEED_FOOTER = (stack: string): string =>
  `> _Seeded by \`hivelore init\` from the **${stack}** stack pack — generic guidance, not repo-specific. ` +
  `Anchor it to a real file or replace it with a repo-specific note to raise it above background priority._`;

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
    ["tailwind",   ["tailwindcss"]],
    ["vite",       ["vite"]],
    ["sveltekit",  ["@sveltejs/kit"]],
    ["astro",      ["astro"]],
    ["typescript", ["typescript"]],
    ["monorepo",   ["turbo", "nx", "@nrwl/workspace", "@nx/workspace"]],
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

export interface SeedPackResult {
  memories: number;
  sensors: number;
}

/** Seed memory pack files on disk. Returns counts of memories and sensors written. */
export async function seedStackPack(
  haivePaths: HaivePaths,
  stack: StackName,
): Promise<SeedPackResult> {
  const memories = PACKS[stack];
  if (!memories) return { memories: 0, sensors: 0 };

  await mkdir(haivePaths.teamDir, { recursive: true });

  // Dedup by a STABLE signature, not the filename. `buildFrontmatter` stamps today's date into
  // the id, so a cross-day re-seed used to produce a duplicate (e.g. the typescript pack appeared
  // twice after a slug change). We skip a pack memory if the corpus already contains one with the
  // same `topic` OR the same date-insensitive id signature (`type-slug`), so re-seeding is idempotent.
  const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}-/;
  const existingTopics = new Set<string>();
  const existingSignatures = new Set<string>();
  // Hand-written (non-seed) memories, for the near-duplicate hint below: a legacy corpus often
  // already documents a stack rule in its own words (e.g. "vite-env-prefix-required"), which the
  // signature/topic dedup cannot see. We only HINT — humans decide with memory resolve-conflict.
  const handWrittenSlugs: string[] = [];
  if (existsSync(haivePaths.memoriesDir)) {
    for (const { memory } of await loadMemoriesFromDir(haivePaths.memoriesDir)) {
      if (memory.frontmatter.topic) existingTopics.add(memory.frontmatter.topic);
      existingSignatures.add(memory.frontmatter.id.replace(DATE_PREFIX, ""));
      if (!memory.frontmatter.tags.includes("stack-pack")) {
        handWrittenSlugs.push(memory.frontmatter.id.replace(DATE_PREFIX, ""));
      }
    }
  }
  const overlapHints: Array<{ seeded: string; existing: string }> = [];
  const slugTokens = (slug: string): Set<string> =>
    new Set(slug.split("-").filter((t) => t.length > 3 && !["convention", "decision", "gotcha", "attempt", "architecture"].includes(t)));

  let memCount = 0;
  let sensorCount = 0;
  for (const mem of memories) {
    // Quality floor: never seed low-value starter content. A pack memory earns its place only if it
    // carries a sensor (enforceable) or is a concrete, non-generic trap. Guards against the corpus
    // being polluted with guessable "best practice" an agent already knows.
    if (!meetsSeedQualityFloor(mem.body, Boolean(mem.sensor))) continue;
    const sensor: Sensor | undefined = mem.sensor
      ? {
          kind: "regex",
          pattern: mem.sensor.pattern,
          ...(mem.sensor.flags ? { flags: mem.sensor.flags } : {}),
          // Stack rules are stack-wide: when the pack doesn't scope the sensor itself, pin an
          // explicit repo-wide glob. Leaving [] lets sensorAppliesToPath fall back to the MEMORY's
          // anchor paths — and seeds get anchored to one exemplar file later, silently shrinking
          // "never $disconnect() in serverless" to a single file (found in the 0.30.0 field test).
          paths: mem.sensor.paths ?? ["**"],
          message: mem.sensor.message,
          severity: "warn",
          autogen: false,
          last_fired: null,
        }
      : undefined;
    // Avoid doubling the stack word in the generated name/slug (e.g. a pack slug already
    // prefixed with the stack → "typescript-typescript-no-any" → "Typescript Typescript …").
    const combinedSlug = mem.slug === stack || mem.slug.startsWith(`${stack}-`)
      ? mem.slug
      : `${stack}-${mem.slug}`;
    // Stable upsert key: survives date and slug-formatting changes across versions.
    const topic = `stack-pack:${stack}:${mem.slug}`;
    const signature = `${mem.type}-${combinedSlug}`;
    if (existingTopics.has(topic) || existingSignatures.has(signature)) continue; // already seeded
    const fm = buildFrontmatter({
      type: mem.type,
      slug: combinedSlug,
      scope: "team",
      status: "validated",
      // STACK_PACK_TAG marks this as generic seed knowledge so briefing ranking
      // keeps it at `background` priority until it earns a repo-specific anchor.
      tags: [...mem.tags, STACK_PACK_TAG],
      topic,
      ...(sensor ? { sensor } : {}),
    });
    const filePath = memoryFilePath(haivePaths, "team", fm.id);
    if (existsSync(filePath)) continue; // belt-and-suspenders for same-day re-runs
    // Give the seed a clean, human title up front so the corpus normalizer doesn't synthesize an
    // ugly one from the id (e.g. "Convention Typescript No Any Prefer Unknown"). Pre-empting it with
    // a real "<Stack>: <Rule>" H1 keeps briefings readable.
    const ruleSlug = combinedSlug.startsWith(`${stack}-`) ? combinedSlug.slice(stack.length + 1) : combinedSlug;
    const titleCase = (s: string): string =>
      s.split("-").filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    const heading = `${titleCase(stack)}: ${titleCase(ruleSlug)}`;
    const titledBody = /^#{1,3}\s+\S/m.test(mem.body.trim()) ? mem.body : `# ${heading}\n\n${mem.body}`;
    const content = serializeMemory({ frontmatter: fm, body: `${titledBody}\n\n${SEED_FOOTER(stack)}` });
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, "utf8");
    existingTopics.add(topic);
    existingSignatures.add(signature);
    memCount++;
    if (sensor) sensorCount++;
    const seededTokens = slugTokens(combinedSlug);
    for (const prior of handWrittenSlugs) {
      const shared = [...slugTokens(prior)].filter((t) => seededTokens.has(t));
      if (shared.length >= 2) {
        overlapHints.push({ seeded: fm.id, existing: prior });
        break;
      }
    }
  }
  if (overlapHints.length > 0) {
    ui.warn(`${overlapHints.length} seeded lesson(s) may duplicate existing hand-written memories:`);
    for (const h of overlapHints.slice(0, 5)) {
      ui.info(`  ${h.seeded} ↔ ${h.existing}`);
    }
    ui.info("  Review with `hivelore memory conflict-candidates`, then `hivelore memory resolve-conflict`.");
  }
  return { memories: memCount, sensors: sensorCount };
}
