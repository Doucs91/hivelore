import type { MemoryFrontmatter } from "./types.js";
import { pathsOverlap } from "./relevance.js";

/**
 * Progressive disclosure for `skill` memories.
 *
 * Skills are reusable playbooks. Surfacing all of them on every briefing wastes the
 * instruction budget and buries the relevant one. A skill with an `activation` block
 * is disclosed ONLY when it is relevant to the current task/files; a skill without
 * one keeps the legacy always-eligible behavior. This module is pure (no I/O).
 */

export interface ActivationContext {
  task?: string;
  files?: string[];
}

export interface SkillActivation {
  applicable: boolean;
  activated: boolean;
  reasons: string[];
}

export function isSkill(fm: Pick<MemoryFrontmatter, "type">): boolean {
  return fm.type === "skill";
}

/**
 * Decide whether a skill should be disclosed for the given context.
 * For non-skills, or skills with no `activation` block, returns `activated: true`
 * (never suppress them). Otherwise activates on `always`, a keyword substring match
 * against the task, or a glob match against the edited files.
 */
export function evaluateSkillActivation(
  fm: Pick<MemoryFrontmatter, "type" | "activation">,
  ctx: ActivationContext,
): SkillActivation {
  if (!isSkill(fm)) return { applicable: false, activated: true, reasons: [] };
  const act = fm.activation;
  if (!act) return { applicable: false, activated: true, reasons: ["no-activation"] };

  const reasons: string[] = [];
  if (act.always) reasons.push("always");

  const task = (ctx.task ?? "").toLowerCase();
  if (task) {
    for (const kw of act.keywords) {
      if (kw && task.includes(kw.toLowerCase())) {
        reasons.push(`keyword:${kw}`);
        break;
      }
    }
  }

  const files = ctx.files ?? [];
  if (files.length > 0) {
    outer: for (const glob of act.globs) {
      for (const f of files) {
        if (pathsOverlap(glob, f)) {
          reasons.push(`glob:${glob}`);
          break outer;
        }
      }
    }
  }

  return { applicable: true, activated: reasons.length > 0, reasons };
}

/** Convenience: true when a skill defines activation triggers that the context does NOT satisfy. */
export function isSkillSuppressed(
  fm: Pick<MemoryFrontmatter, "type" | "activation">,
  ctx: ActivationContext,
): boolean {
  const result = evaluateSkillActivation(fm, ctx);
  return result.applicable && !result.activated;
}
