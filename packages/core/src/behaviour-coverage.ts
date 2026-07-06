/**
 * Behaviour-harness coverage — the missing MEASURE for the branch Hivelore leads.
 *
 * The maintainability harness has a visible metric (anchor coverage in `doctor`), and the bootstrap
 * gate reports memory/sensor coverage per area. But the *behaviour* harness — command/test sensors
 * that route a real oracle to a lesson, optionally proven RED on the incident — had no coverage
 * number, so its progress was invisible. This module answers three questions per main code area:
 *   1. Is there ANY behavioural oracle (a `kind: shell|test` sensor) guarding it?
 *   2. Is that oracle ARMED (severity `block`, so it actually refuses the repeat)?
 *   3. Is it PROVEN (red_proven — the oracle demonstrably fails on the incident state)?
 *
 * Pure domain logic: no I/O. The caller loads memories + the code-map and passes them in. Area
 * derivation is shared with the bootstrap gate ({@link deriveMainAreas}) so the "N main areas" count
 * is identical everywhere it is reported.
 */
import type { LoadedMemory } from "./loader.js";
import {
  anchorMatchesComponent,
  componentOf,
  deriveMainAreas,
  isProductionCodeFile,
} from "./bootstrap-state.js";
import { globToRegExp, isGlobPath } from "./relevance.js";

/** One behavioural oracle sensor (kind shell|test) and the main areas it reaches. */
export interface BehaviourOracleInfo {
  memory_id: string;
  kind: "shell" | "test";
  /** `block` = armed (refuses the repeat); `warn` = advisory only. */
  severity: "block" | "warn";
  /** The oracle demonstrably failed on the recorded incident state at arming time. */
  red_proven: boolean;
  /** Main code areas this oracle guards (by anchor or by sensor scope). */
  areas: string[];
}

export interface BehaviourCoverageMetrics {
  /** Canonical main code areas (same set the bootstrap gate uses). */
  mainAreas: string[];
  /** Areas guarded by at least one behavioural oracle of any severity. */
  areasWithOracle: string[];
  /** Areas guarded by at least one ARMED (block) behavioural oracle. */
  areasWithArmedOracle: string[];
  /** Areas guarded by at least one red-proven behavioural oracle. */
  areasWithRedProven: string[];
  /** Main areas with NO behavioural oracle at all. */
  uncoveredAreas: string[];
  /** Every behavioural oracle sensor found, with the areas it reaches. */
  oracles: BehaviourOracleInfo[];
  totalOracles: number;
  /** Oracles at `block` severity. */
  armedOracles: number;
  /** Oracles with red_proven === true. */
  redProvenOracles: number;
}

export interface BehaviourCoverageInput {
  memories: LoadedMemory[];
  /** Raw code file paths from the code-map (this module filters to production files). */
  codeFiles: string[];
}

/**
 * A behavioural oracle guards an area when its carrying memory is anchored into that area, OR its
 * sensor `paths` scope (plain dir or glob) reaches a production file in that area — the same
 * "credit a scoped sensor" rule the bootstrap gate applies to block sensors.
 */
function oracleReachesArea(m: LoadedMemory, area: string, productionInArea: string[]): boolean {
  const fm = m.memory.frontmatter;
  if (fm.anchor.paths.some((p) => anchorMatchesComponent(p, area))) return true;
  const scopes = fm.sensor?.paths ?? [];
  return scopes.some((raw) => {
    const scope = raw.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!scope) return false;
    if (isGlobPath(scope)) {
      const re = globToRegExp(scope);
      return productionInArea.some((f) => re.test(f));
    }
    return anchorMatchesComponent(scope, area);
  });
}

/** Assess how much of the repo's behaviour surface is guarded by armed, proven oracles. */
export function assessBehaviourCoverage(input: BehaviourCoverageInput): BehaviourCoverageMetrics {
  const mainAreas = deriveMainAreas(input.codeFiles);
  const production = input.codeFiles.filter(isProductionCodeFile);
  const filesByArea = new Map<string, string[]>();
  for (const area of mainAreas) {
    filesByArea.set(area, production.filter((f) => componentOf(f) === area));
  }

  const oracleMemories = input.memories.filter((m) => {
    const s = m.memory.frontmatter.sensor;
    if (!s || (s.kind !== "shell" && s.kind !== "test")) return false;
    const status = m.memory.frontmatter.status;
    return status === "validated" || status === "proposed";
  });

  const oracles: BehaviourOracleInfo[] = oracleMemories.map((m) => {
    const s = m.memory.frontmatter.sensor!;
    const areas = mainAreas.filter((area) => oracleReachesArea(m, area, filesByArea.get(area) ?? []));
    return {
      memory_id: m.memory.frontmatter.id,
      kind: s.kind === "shell" ? "shell" : "test",
      severity: s.severity === "block" ? "block" : "warn",
      red_proven: s.red_proven === true,
      areas,
    };
  });

  const areasWith = (predicate: (o: BehaviourOracleInfo) => boolean): string[] =>
    mainAreas.filter((area) => oracles.some((o) => o.areas.includes(area) && predicate(o)));

  const areasWithOracle = areasWith(() => true);
  const areasWithArmedOracle = areasWith((o) => o.severity === "block");
  const areasWithRedProven = areasWith((o) => o.red_proven);
  const uncoveredAreas = mainAreas.filter((area) => !areasWithOracle.includes(area));

  return {
    mainAreas,
    areasWithOracle,
    areasWithArmedOracle,
    areasWithRedProven,
    uncoveredAreas,
    oracles,
    totalOracles: oracles.length,
    armedOracles: oracles.filter((o) => o.severity === "block").length,
    redProvenOracles: oracles.filter((o) => o.red_proven).length,
  };
}

/** One-line human summary for a receipt / status line (no leading label). */
export function renderBehaviourCoverageLine(m: BehaviourCoverageMetrics): string {
  if (m.mainAreas.length === 0) return "no main code areas detected";
  if (m.totalOracles === 0) {
    return `0/${m.mainAreas.length} area(s) guarded by a behavioural oracle (no test/shell sensors yet)`;
  }
  return (
    `${m.areasWithOracle.length}/${m.mainAreas.length} area(s) guarded by a behavioural oracle ` +
    `(${m.areasWithArmedOracle.length} armed, ${m.areasWithRedProven.length} red-proven)`
  );
}
