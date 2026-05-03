/**
 * Bootstrap: auto-generate .ai/project-context.md from local filesystem signals.
 *
 * Reads: package.json, README.md, directory structure (top 2 levels).
 * No AI call, no network — pure static analysis.
 */
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const IGNORE_DIRS = new Set([
  "node_modules", "dist", "build", ".next", ".nuxt", ".svelte-kit",
  ".git", "coverage", ".turbo", "out", ".cache", "tmp", "temp",
  "__pycache__", ".venv", "venv", "target", ".gradle",
]);

const FRAMEWORK_SIGNALS: Record<string, string[]> = {
  "NestJS":         ["@nestjs/core", "@nestjs/common"],
  "Next.js":        ["next"],
  "Remix":          ["@remix-run/react", "@remix-run/node"],
  "React":          ["react", "react-dom"],
  "Vue":            ["vue"],
  "Svelte":         ["svelte"],
  "SvelteKit":      ["@sveltejs/kit"],
  "Astro":          ["astro"],
  "Express":        ["express"],
  "Fastify":        ["fastify"],
  "Hono":           ["hono"],
  "tRPC":           ["@trpc/server", "@trpc/client"],
  "Prisma":         ["@prisma/client"],
  "Drizzle":        ["drizzle-orm"],
  "Redux Toolkit":  ["@reduxjs/toolkit"],
  "Zustand":        ["zustand"],
  "TanStack Query": ["@tanstack/react-query", "react-query"],
  "Mongoose":       ["mongoose"],
  "Apollo":         ["@apollo/client", "@apollo/server", "apollo-server"],
  "GraphQL":        ["graphql"],
  "Vite":           ["vite"],
  "Vitest":         ["vitest"],
  "Jest":           ["jest"],
};

const KEY_DEPS = [
  "@nestjs/jwt", "@nestjs/passport", "passport-jwt",
  "jsonwebtoken", "bcrypt", "bcryptjs",
  "stripe", "axios", "socket.io", "ws",
  "redis", "ioredis", "pg", "mysql2", "mongodb", "mongoose",
  "zod", "yup", "class-validator",
  "tailwindcss", "shadcn", "@radix-ui",
  "@vercel/ai", "ai", "openai", "@anthropic-ai/sdk",
  "typescript",
];

interface PackageJson {
  name?: string;
  description?: string;
  version?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: string[] | { packages: string[] };
}

function detectFrameworks(allDeps: Record<string, string>): string[] {
  const found: string[] = [];
  for (const [fw, signals] of Object.entries(FRAMEWORK_SIGNALS)) {
    if (signals.some((s) => allDeps[s] !== undefined)) found.push(fw);
  }
  return found;
}

function detectKeyDeps(allDeps: Record<string, string>): string[] {
  return KEY_DEPS.filter((d) => allDeps[d] !== undefined);
}

function detectLanguage(root: string): string {
  if (existsSync(path.join(root, "tsconfig.json"))) return "TypeScript";
  if (existsSync(path.join(root, "pyproject.toml")) || existsSync(path.join(root, "setup.py"))) return "Python";
  if (existsSync(path.join(root, "go.mod"))) return "Go";
  if (existsSync(path.join(root, "pom.xml")) || existsSync(path.join(root, "build.gradle"))) return "Java/Kotlin";
  if (existsSync(path.join(root, "Cargo.toml"))) return "Rust";
  if (existsSync(path.join(root, "package.json"))) return "JavaScript";
  return "Unknown";
}

function detectProjectType(frameworks: string[], scripts: Record<string, string>, isMonorepo: boolean): string {
  if (isMonorepo) {
    if (frameworks.includes("NestJS")) return "Monorepo (NestJS backend)";
    if (frameworks.includes("Next.js")) return "Monorepo (Next.js)";
    if (frameworks.includes("React")) return "Multi-package monorepo (React)";
    if (frameworks.length > 0) return `Multi-package monorepo (${frameworks.slice(0, 2).join(", ")})`;
    return "Multi-package monorepo";
  }
  if (frameworks.includes("NestJS")) return "Backend API (NestJS)";
  if (frameworks.includes("Next.js")) return "Full-stack web app (Next.js)";
  if (frameworks.includes("Remix")) return "Full-stack web app (Remix)";
  if (frameworks.includes("Express") || frameworks.includes("Fastify") || frameworks.includes("Hono")) return "Backend API";
  if (frameworks.includes("React") || frameworks.includes("Vue") || frameworks.includes("Svelte")) return "Frontend SPA";
  if (scripts["build"] && !scripts["dev"]) return "CLI tool / library";
  if (existsSync("pom.xml")) return "Java backend";
  return "Application";
}

async function scanDirs(root: string, maxDepth = 2): Promise<string[]> {
  const results: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      const rel = path.relative(root, path.join(dir, entry.name));
      results.push(rel);
      await walk(path.join(dir, entry.name), depth + 1);
    }
  }
  await walk(root, 0);
  return results;
}

function inferModuleDescriptions(dirs: string[], frameworks: string[] = []): string[] {
  const known: Record<string, string> = {
    "src":           "main source directory",
    "app":           "application entrypoint / routes (Next.js App Router or similar)",
    "pages":         "file-based routing pages",
    "components":    "reusable UI components",
    "lib":           "shared utilities and helpers",
    "utils":         "utility functions",
    "hooks":         "React hooks",
    "services":      "business logic services",
    "controllers":   "HTTP controllers / route handlers",
    "modules":       "feature modules",
    "middleware":    "HTTP or business middleware",
    "guards":        "auth / access guards",
    "decorators":    "custom decorators",
    "interceptors":  "NestJS interceptors",
    "filters":       "exception filters",
    "pipes":         "validation / transformation pipes",
    "dto":           "Data Transfer Objects",
    "entities":      "ORM entities / database models",
    "prisma":        "Prisma schema and migrations",
    "migrations":    "database migrations",
    "config":        "configuration files",
    "types":         "TypeScript type definitions",
    "schemas":       "validation schemas (Zod / class-validator)",
    "test":          "tests",
    "tests":         "tests",
    "__tests__":     "tests",
    "e2e":           "end-to-end tests",
    "public":        "static public assets",
    "assets":        "static assets",
    "styles":        "global CSS / style files",
    "scripts":       "build or utility scripts",
    "docs":          "documentation",
    "docker":        "Docker configuration",
    "infra":         "infrastructure / IaC",
    "packages":      "monorepo sub-packages",
    "functions":     "serverless / edge functions",
    "api":           "API routes or client",
    "store":         "state management (Redux / Zustand / Pinia)",
    "context":       "React contexts",
    "server":        "server-side code",
    "client":        "client-side code",
    "features":      "feature-based modules",
    "routes":        "route definitions",
    "workers":       "background workers / queues",
    "auth":          "authentication / authorization",
    "users":         "user management",
    "products":      "product catalog",
    "orders":        "order management",
    "common":        "shared / common utilities",
    "shared":        "shared code across modules",
  };

  const isNestJS = frameworks.includes("NestJS");

  // NestJS pattern: src/ contains feature module subdirectories
  const srcSubdirs = dirs.filter((d) => d.startsWith("src/") && d.split("/").length === 2);
  if (isNestJS && srcSubdirs.length >= 2) {
    const result: string[] = [`- \`src/\` — main source (NestJS feature modules)`];
    for (const d of srcSubdirs.slice(0, 12)) {
      const name = d.split("/")[1]!;
      const desc = known[name.toLowerCase()] ?? "feature module";
      result.push(`  - \`${name}/\` — ${desc}`);
    }
    // Also list other top-level dirs (prisma/, docker/, etc.)
    const otherTopLevel = dirs
      .filter((d) => !d.includes("/") && d !== "src")
      .slice(0, 6);
    for (const d of otherTopLevel) {
      const desc = known[d.toLowerCase()] ?? "module";
      result.push(`- \`${d}/\` — ${desc}`);
    }
    return result;
  }

  // Monorepo pattern: packages/ contains workspace sub-packages
  const isMonorepo = dirs.some((d) => d === "packages") &&
    dirs.some((d) => d.startsWith("packages/") && d.split("/").length === 2);
  if (isMonorepo) {
    const packageSubdirs = dirs.filter((d) => d.startsWith("packages/") && d.split("/").length === 2);
    const result: string[] = [`- \`packages/\` — monorepo sub-packages`];
    for (const d of packageSubdirs.slice(0, 10)) {
      const name = d.split("/")[1]!;
      const desc = known[name.toLowerCase()] ?? "sub-package";
      result.push(`  - \`${name}/\` — ${desc}`);
    }
    const otherTopLevel = dirs
      .filter((d) => !d.includes("/") && d !== "packages")
      .slice(0, 5);
    for (const d of otherTopLevel) {
      const desc = known[d.toLowerCase()] ?? "module";
      result.push(`- \`${d}/\` — ${desc}`);
    }
    return result;
  }

  // Default: top-level dirs
  const top = dirs.filter((d) => !d.includes("/")).slice(0, 12);
  return top.map((d) => {
    const desc = known[d.toLowerCase()] ?? "module";
    return `- \`${d}/\` — ${desc}`;
  });
}

function readmeExcerpt(readme: string): string {
  const lines = readme.split("\n");
  // Skip the first h1, grab description paragraph
  let inContent = false;
  const kept: string[] = [];
  for (const line of lines) {
    if (!inContent && line.trim().startsWith("#")) { inContent = true; continue; }
    if (!inContent) continue;
    if (kept.length >= 6) break;
    if (line.trim()) kept.push(line.trim());
  }
  return kept.join(" ").slice(0, 400);
}

export async function generateBootstrapContext(root: string): Promise<string> {
  // 1. package.json
  let pkg: PackageJson = {};
  const pkgPath = path.join(root, "package.json");
  if (existsSync(pkgPath)) {
    try { pkg = JSON.parse(await readFile(pkgPath, "utf8")) as PackageJson; } catch { /* ignore */ }
  }

  const allDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const frameworks = detectFrameworks(allDeps);
  const keyDeps = detectKeyDeps(allDeps);
  const language = detectLanguage(root);
  const isMonorepo = pkg.workspaces !== undefined &&
    (Array.isArray(pkg.workspaces) ? pkg.workspaces.length > 0 : true);
  const projectType = detectProjectType(frameworks, pkg.scripts ?? {}, isMonorepo);
  const projectName = pkg.name ?? path.basename(root);
  const projectDesc = pkg.description ?? "";

  // 2. README excerpt
  let readmeSummary = "";
  for (const name of ["README.md", "readme.md", "README"]) {
    const p = path.join(root, name);
    if (existsSync(p)) {
      try {
        const content = await readFile(p, "utf8");
        readmeSummary = readmeExcerpt(content);
        break;
      } catch { /* ignore */ }
    }
  }

  // 3. Directory structure
  const dirs = await scanDirs(root, 2);
  const moduleLines = inferModuleDescriptions(dirs, frameworks);

  // 4. Scripts analysis
  const scripts = pkg.scripts ?? {};
  const scriptLines = Object.entries(scripts)
    .filter(([k]) => ["build", "dev", "start", "test", "lint", "deploy"].includes(k))
    .map(([k, v]) => `- \`${k}\`: ${v}`)
    .slice(0, 6);

  // 5. Tech stack summary
  const stackParts: string[] = [language];
  if (frameworks.length) stackParts.push(...frameworks);
  const techStack = stackParts.join(", ");

  // 6. Key dependencies (notable ones)
  const notableDeps = Object.keys(allDeps)
    .filter((d) => !d.startsWith("@types/") && !["typescript", "eslint", "prettier", "jest"].includes(d))
    .filter((d) => !["react", "react-dom", "next", "vue", "express"].includes(d)) // already in frameworks
    .slice(0, 10)
    .map((d) => `\`${d}\``);

  const lines: string[] = [
    `# Project context — ${projectName}`,
    "",
    `> Auto-generated by \`haive init --bootstrap\`. Review and refine — especially the Architecture and Gotchas sections.`,
    "",
    `## Overview`,
    `**Type:** ${projectType}`,
    `**Tech stack:** ${techStack}`,
    ...(projectDesc ? [`**Description:** ${projectDesc}`] : []),
    ...(readmeSummary ? [`**From README:** ${readmeSummary}`] : []),
    "",
    `## Architecture`,
    `TODO — fill in the high-level architecture (inferred structure below, verify manually):`,
    "",
    ...(moduleLines.length ? moduleLines : ["TODO — no clear structure detected."]),
    "",
    `## Key modules`,
    `TODO — describe the purpose of the main modules. The directory scan found:`,
    ...dirs.filter((d) => !d.includes("/")).slice(0, 8).map((d) => `- \`${d}/\``),
    "",
    `## Conventions`,
    `TODO — fill in coding conventions (naming, patterns, file layout).`,
    "",
    ...(scriptLines.length ? [
      `**Available scripts:**`,
      ...scriptLines,
      "",
    ] : []),
    ...(keyDeps.length ? [
      `**Key dependencies in use:** ${keyDeps.map((d) => `\`${d}\``).join(", ")}`,
      "",
    ] : []),
    ...(notableDeps.length ? [
      `**Other notable packages:** ${notableDeps.join(", ")}`,
      "",
    ] : []),
    `## Glossary`,
    `TODO — domain terms and what they mean here.`,
    "",
    `## Gotchas`,
    `TODO — known traps, surprising behavior, things newcomers stub their toes on.`,
    `(Run \`haive memory import-changelog\` or \`haive memory import README.md\` to seed these automatically.)`,
    "",
  ];

  return lines.join("\n");
}
