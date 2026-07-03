import { readdirSync } from "node:fs";

/**
 * Case-insensitive lookup of a root doc file — repos disagree on casing
 * (README.md vs Readme.md vs readme.markdown), and a suggestion printed with
 * the wrong name fails on the first command a new user copies.
 * Returns the actual filename as it exists on disk, or undefined.
 */
export function findDocFile(root: string, stem: "readme" | "changelog"): string | undefined {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return undefined;
  }
  const re = new RegExp(`^${stem}(\\.(md|markdown|txt|rst))?$`, "i");
  return entries.find((e) => re.test(e));
}
