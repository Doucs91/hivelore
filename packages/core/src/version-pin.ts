/**
 * Repository-pinned CLI version — pure helpers. See `cliVersion` in {@link HaiveConfig}.
 */
import { compareVersions } from "./version-order.js";

export type PinVerdict = "match" | "older" | "newer" | "unpinned";

/** How the running CLI relates to the repository's pin. Only "older" needs action. */
export function pinVerdict(running: string, pinned: string | undefined): PinVerdict {
  if (!pinned?.trim()) return "unpinned";
  const c = compareVersions(running.replace(/^v/, ""), pinned.trim().replace(/^v/, ""));
  return c === 0 ? "match" : c < 0 ? "older" : "newer";
}

/** Raise the pin to `version`, never lower it (a newer teammate must not downgrade the repo). */
export function nextPin(current: string | undefined, version: string): string {
  return current && compareVersions(current.replace(/^v/, ""), version.replace(/^v/, "")) >= 0 ? current : version;
}
