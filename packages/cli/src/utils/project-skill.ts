/**
 * The Hivelore agent skill, written into the project (`.claude/skills/hivelore/SKILL.md`) so every
 * Claude Code agent working in the repository knows WHEN Hivelore helps — a correction, unfamiliar
 * code, a red CI — without an instruction file telling it to call anything.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderHiveloreSkill } from "@hivelore/core";

export async function writeProjectSkill(root: string): Promise<string | null> {
  const file = path.join(root, ".claude", "skills", "hivelore", "SKILL.md");
  const content = renderHiveloreSkill();
  try {
    if (existsSync(file) && (await readFile(file, "utf8")) === content) return null;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, "utf8");
    return file;
  } catch {
    return null;
  }
}
