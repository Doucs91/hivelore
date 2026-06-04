import { describe, expect, it } from "vitest";
import { detectStacksFromManifests } from "../src/seed.js";
import { proposeSeedsFromCommits } from "../src/seed-git.js";

// ── detectStacksFromManifests ────────────────────────────────────────────────

describe("detectStacksFromManifests", () => {
  describe("package.json detection", () => {
    it("detects nestjs from @nestjs/core", () => {
      const result = detectStacksFromManifests({ packageJsonDeps: { "@nestjs/core": "^10.0.0" } });
      expect(result).toContain("nestjs");
    });

    it("detects nextjs and suppresses react", () => {
      const result = detectStacksFromManifests({ packageJsonDeps: { next: "^14.0.0", react: "^18.0.0" } });
      expect(result).toContain("nextjs");
      expect(result).not.toContain("react");
    });

    it("detects remix and suppresses react", () => {
      const result = detectStacksFromManifests({ packageJsonDeps: { "@remix-run/react": "^2.0.0", react: "^18.0.0" } });
      expect(result).toContain("remix");
      expect(result).not.toContain("react");
    });

    it("detects react standalone when no framework is present", () => {
      const result = detectStacksFromManifests({ packageJsonDeps: { react: "^18.0.0" } });
      expect(result).toContain("react");
    });

    it("detects prisma from @prisma/client", () => {
      const result = detectStacksFromManifests({ packageJsonDeps: { "@prisma/client": "^5.0.0" } });
      expect(result).toContain("prisma");
    });

    it("detects multiple stacks from one package.json", () => {
      const result = detectStacksFromManifests({
        packageJsonDeps: { "@nestjs/core": "^10", "@prisma/client": "^5", "@trpc/server": "^11" },
      });
      expect(result).toContain("nestjs");
      expect(result).toContain("prisma");
      expect(result).toContain("trpc");
    });

    it("returns empty array for no matching deps", () => {
      const result = detectStacksFromManifests({ packageJsonDeps: { lodash: "^4.0.0" } });
      expect(result).toHaveLength(0);
    });

    it("detects new JS stacks (tailwind, vite, sveltekit, astro, typescript, monorepo)", () => {
      expect(detectStacksFromManifests({ packageJsonDeps: { tailwindcss: "^3" } })).toContain("tailwind");
      expect(detectStacksFromManifests({ packageJsonDeps: { vite: "^5" } })).toContain("vite");
      expect(detectStacksFromManifests({ packageJsonDeps: { "@sveltejs/kit": "^2" } })).toContain("sveltekit");
      expect(detectStacksFromManifests({ packageJsonDeps: { astro: "^4" } })).toContain("astro");
      expect(detectStacksFromManifests({ packageJsonDeps: { typescript: "^5" } })).toContain("typescript");
      expect(detectStacksFromManifests({ packageJsonDeps: { turbo: "^2" } })).toContain("monorepo");
    });
  });

  describe("new manifest detection (PHP / Ruby / .NET / Docker / monorepo)", () => {
    it("detects laravel from composer.json", () => {
      expect(detectStacksFromManifests({ composerJson: '{"require":{"laravel/framework":"^11"}}' })).toContain("laravel");
    });
    it("detects rails from a Gemfile", () => {
      expect(detectStacksFromManifests({ gemfile: 'gem "rails", "~> 7.1"\n' })).toContain("rails");
    });
    it("detects dotnet from a .csproj presence flag", () => {
      expect(detectStacksFromManifests({ hasCsproj: true })).toContain("dotnet");
    });
    it("detects docker from a Dockerfile presence flag", () => {
      expect(detectStacksFromManifests({ hasDockerfile: true })).toContain("docker");
    });
    it("detects monorepo from turbo.json or nx.json", () => {
      expect(detectStacksFromManifests({ hasTurboJson: true })).toContain("monorepo");
      expect(detectStacksFromManifests({ hasNxJson: true })).toContain("monorepo");
    });
  });

  describe("requirements.txt detection", () => {
    it("detects fastapi", () => {
      const result = detectStacksFromManifests({ requirementsTxt: "fastapi==0.110.0\nuvicorn\n" });
      expect(result).toContain("fastapi");
    });

    it("detects django", () => {
      const result = detectStacksFromManifests({ requirementsTxt: "Django>=4.2\npsycopg2\n" });
      expect(result).toContain("django");
    });

    it("detects flask", () => {
      const result = detectStacksFromManifests({ requirementsTxt: "flask==3.0.0\n" });
      expect(result).toContain("flask");
    });

    it("is case-insensitive for python packages", () => {
      const result = detectStacksFromManifests({ requirementsTxt: "FastAPI==0.110.0\n" });
      expect(result).toContain("fastapi");
    });
  });

  describe("go.mod detection", () => {
    it("detects go from a valid go.mod", () => {
      const result = detectStacksFromManifests({ goMod: "module github.com/myorg/myapp\n\ngo 1.21\n" });
      expect(result).toContain("go");
    });

    it("returns empty for content without a module declaration", () => {
      const result = detectStacksFromManifests({ goMod: "just some text\n" });
      expect(result).not.toContain("go");
    });
  });

  describe("pom.xml detection", () => {
    it("detects spring from spring-boot groupId", () => {
      const pom = `<project><parent><groupId>org.springframework.boot</groupId></parent></project>`;
      const result = detectStacksFromManifests({ pomXml: pom });
      expect(result).toContain("spring");
    });

    it("detects spring from spring-boot artifactId", () => {
      const pom = `<dependency><artifactId>spring-boot-starter-web</artifactId></dependency>`;
      const result = detectStacksFromManifests({ pomXml: pom });
      expect(result).toContain("spring");
    });

    it("does not detect spring from unrelated pom.xml", () => {
      const pom = `<project><groupId>com.example</groupId></project>`;
      const result = detectStacksFromManifests({ pomXml: pom });
      expect(result).not.toContain("spring");
    });
  });

  describe("multi-language detection", () => {
    it("combines JS and Python stacks", () => {
      const result = detectStacksFromManifests({
        packageJsonDeps: { "react": "^18.0.0" },
        requirementsTxt: "fastapi==0.110.0\n",
      });
      expect(result).toContain("react");
      expect(result).toContain("fastapi");
    });

    it("deduplicates stacks if somehow present in multiple sources", () => {
      const result = detectStacksFromManifests({
        packageJsonDeps: { "@nestjs/core": "^10.0.0" },
        requirementsTxt: "fastapi==0.110.0\n",
      });
      const nestjsCount = result.filter((s) => s === "nestjs").length;
      expect(nestjsCount).toBe(1);
    });

    it("handles all inputs undefined gracefully", () => {
      const result = detectStacksFromManifests({});
      expect(result).toHaveLength(0);
    });
  });
});

// ── proposeSeedsFromCommits ──────────────────────────────────────────────────

describe("proposeSeedsFromCommits", () => {
  it("proposes a seed from a Revert commit", () => {
    const commits = [
      { sha: "abc1234", subject: 'Revert "Add caching layer"', files: ["src/cache.ts"] },
    ];
    const proposals = proposeSeedsFromCommits(commits, 10);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.what).toBe("Add caching layer");
    expect(proposals[0]!.kind).toBe("revert");
    expect(proposals[0]!.paths).toEqual(["src/cache.ts"]);
  });

  it("proposes a seed from a hotfix commit", () => {
    const commits = [
      { sha: "def5678", subject: "hotfix: broken auth middleware", files: ["src/auth.ts"] },
    ];
    const proposals = proposeSeedsFromCommits(commits, 10);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.kind).toBe("fixup");
  });

  it("ignores non-revert, non-hotfix commits", () => {
    const commits = [
      { sha: "aaa1111", subject: "feat: add user profile page" },
      { sha: "bbb2222", subject: "docs: update README" },
      { sha: "ccc3333", subject: "chore: bump deps" },
    ];
    expect(proposeSeedsFromCommits(commits, 10)).toHaveLength(0);
  });

  it("deduplicates by slug", () => {
    const commits = [
      { sha: "aaa1111", subject: 'Revert "Add caching layer"' },
      { sha: "bbb2222", subject: 'Revert "Add caching layer"' },
    ];
    const proposals = proposeSeedsFromCommits(commits, 10);
    expect(proposals).toHaveLength(1);
  });

  it("respects the limit", () => {
    const commits = Array.from({ length: 10 }, (_, i) => ({
      sha: `sha${i}`,
      subject: `Revert "Change ${i}"`,
    }));
    expect(proposeSeedsFromCommits(commits, 3)).toHaveLength(3);
  });

  it("caps paths at 8 per proposal", () => {
    const files = Array.from({ length: 12 }, (_, i) => `src/file${i}.ts`);
    const commits = [{ sha: "abc1234", subject: 'Revert "Big refactor"', files }];
    const proposals = proposeSeedsFromCommits(commits, 10);
    expect(proposals[0]!.paths.length).toBeLessThanOrEqual(8);
  });
});
