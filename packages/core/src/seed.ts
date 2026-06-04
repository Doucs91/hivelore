/**
 * Pure stack-detection helpers for cold-start seeding.
 *
 * Multi-language: reads package.json deps (JS/TS), requirements.txt (Python),
 * go.mod (Go), and pom.xml (Java/Spring) to produce the list of detected stacks.
 * No I/O — the caller reads the files and passes contents in, making this fully testable.
 */

export interface DetectStacksInput {
  /** Merged deps from package.json (dependencies + devDependencies). */
  packageJsonDeps?: Record<string, string>;
  /** Raw text of requirements.txt (or any requirements file). */
  requirementsTxt?: string;
  /** Raw text of go.mod. */
  goMod?: string;
  /** Raw text of pom.xml. */
  pomXml?: string;
  /** Raw text of composer.json (PHP). */
  composerJson?: string;
  /** Raw text of Gemfile (Ruby). */
  gemfile?: string;
  /** True when at least one .csproj/.sln file is present (.NET). */
  hasCsproj?: boolean;
  /** True when a Dockerfile is present. */
  hasDockerfile?: boolean;
  /** True when turbo.json is present (Turborepo). */
  hasTurboJson?: boolean;
  /** True when nx.json is present (Nx). */
  hasNxJson?: boolean;
}

export type DetectableStack =
  | "nestjs" | "nextjs" | "remix" | "react" | "express" | "fastify"
  | "prisma" | "drizzle" | "zustand" | "redux" | "reactquery" | "trpc"
  | "mongoose" | "graphql" | "vue"
  | "tailwind" | "vite" | "sveltekit" | "astro" | "typescript" | "monorepo"
  | "fastapi" | "django" | "flask"
  | "go"
  | "spring"
  | "laravel" | "rails" | "dotnet" | "docker";

const JS_DETECTORS: [DetectableStack, string[]][] = [
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
  ["vue",        ["vue", "@vue/core"]],
  ["tailwind",   ["tailwindcss"]],
  ["vite",       ["vite"]],
  ["sveltekit",  ["@sveltejs/kit"]],
  ["astro",      ["astro"]],
  ["typescript", ["typescript"]],
  ["monorepo",   ["turbo", "nx", "@nrwl/workspace", "@nx/workspace"]],
];

const PYTHON_DETECTORS: [DetectableStack, RegExp][] = [
  ["fastapi", /\bfastapi\b/i],
  ["django",  /\bdjango\b/i],
  ["flask",   /\bflask\b/i],
];

function detectFromPackageJson(deps: Record<string, string>): DetectableStack[] {
  const detected: DetectableStack[] = [];
  for (const [stack, signals] of JS_DETECTORS) {
    if (signals.some((s) => s in deps)) detected.push(stack);
  }
  // Suppress generic 'react' when a framework that includes it is already detected
  if (detected.includes("nextjs") || detected.includes("remix")) {
    return detected.filter((s) => s !== "react");
  }
  return detected;
}

function detectFromRequirementsTxt(content: string): DetectableStack[] {
  return PYTHON_DETECTORS.filter(([, re]) => re.test(content)).map(([s]) => s);
}

function detectFromGoMod(content: string): DetectableStack[] {
  // go.mod presence (has a module declaration) → go stack
  return /^\s*module\s+\S/m.test(content) ? ["go"] : [];
}

function detectFromPomXml(content: string): DetectableStack[] {
  return /org\.springframework|spring-boot/.test(content) ? ["spring"] : [];
}

function detectFromComposerJson(content: string): DetectableStack[] {
  return /laravel\/framework|illuminate\//.test(content) ? ["laravel"] : [];
}

function detectFromGemfile(content: string): DetectableStack[] {
  return /^\s*gem\s+["']rails["']/m.test(content) || /\brails\b/.test(content) ? ["rails"] : [];
}

/**
 * Detect stacks present in a project from the raw contents of its manifest files.
 * Pure — no I/O. Pass what you have; omit what you don't.
 */
export function detectStacksFromManifests(input: DetectStacksInput): DetectableStack[] {
  const seen = new Set<DetectableStack>();
  const add = (stacks: DetectableStack[]) => stacks.forEach((s) => seen.add(s));

  if (input.packageJsonDeps) add(detectFromPackageJson(input.packageJsonDeps));
  if (input.requirementsTxt) add(detectFromRequirementsTxt(input.requirementsTxt));
  if (input.goMod) add(detectFromGoMod(input.goMod));
  if (input.pomXml) add(detectFromPomXml(input.pomXml));
  if (input.composerJson) add(detectFromComposerJson(input.composerJson));
  if (input.gemfile) add(detectFromGemfile(input.gemfile));
  if (input.hasCsproj) add(["dotnet"]);
  if (input.hasDockerfile) add(["docker"]);
  if (input.hasTurboJson || input.hasNxJson) add(["monorepo"]);

  return Array.from(seen);
}
