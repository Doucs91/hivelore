import { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import {
  getUsage,
  isDecaying,
  loadMemoriesFromDir,
  loadUsageIndex,
  resolveHaivePaths,
  serializeMemory,
  type LoadedMemory,
  type UsageIndex,
} from "@hivelore/core";

type Screen = "memories" | "health" | "stats";
type FilterStatus = "all" | "draft" | "proposed" | "validated" | "stale" | "rejected";
const FILTERS: FilterStatus[] = ["all", "draft", "proposed", "validated", "stale", "rejected"];
const LIST_H = 14;

function statusColor(status: string): "green" | "yellow" | "red" | undefined {
  if (status === "validated") return "green";
  if (status === "proposed" || status === "stale") return "yellow";
  if (status === "rejected") return "red";
  return undefined;
}

interface Props { root: string; }

export function Dashboard({ root }: Props) {
  const { exit } = useApp();
  const paths = resolveHaivePaths(root);

  const [screen, setScreen] = useState<Screen>("memories");
  const [memories, setMemories] = useState<LoadedMemory[]>([]);
  const [usage, setUsage] = useState<UsageIndex>({ version: 1, updated_at: "", by_id: {} });
  const [loading, setLoading] = useState(true);
  const [filterIdx, setFilterIdx] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [flash, setFlash] = useState<{ text: string; color: "green" | "red" | "yellow" } | null>(null);

  const filter: FilterStatus = FILTERS[filterIdx] ?? "all";

  const reload = useCallback(async () => {
    setLoading(true);
    const [mems, u] = await Promise.all([
      existsSync(paths.memoriesDir) ? loadMemoriesFromDir(paths.memoriesDir) : Promise.resolve([]),
      loadUsageIndex(paths),
    ]);
    setMemories(mems);
    setUsage(u);
    setLoading(false);
  }, [paths.memoriesDir]);

  useEffect(() => { void reload(); }, [reload]);

  // ── Derived data ──────────────────────────────────────────────────────
  const nonRecap = memories.filter((m) => m.memory.frontmatter.type !== "session_recap");

  const filtered = nonRecap.filter((m) => {
    const s = m.memory.frontmatter.status;
    if (filter === "all") return s !== "rejected";
    return s === filter;
  });

  const staleMemories = nonRecap.filter((m) => m.memory.frontmatter.status === "stale");
  const anchorless = nonRecap.filter(
    (m) =>
      m.memory.frontmatter.anchor.paths.length === 0 &&
      m.memory.frontmatter.anchor.symbols.length === 0 &&
      m.memory.frontmatter.status !== "rejected",
  );
  const pending = nonRecap.filter((m) => m.memory.frontmatter.status === "proposed");

  // Top-5 by read_count
  const topRead = [...nonRecap]
    .map((m) => ({ m, u: getUsage(usage, m.memory.frontmatter.id) }))
    .filter(({ u }) => u.read_count > 0)
    .sort((a, b) => b.u.read_count - a.u.read_count)
    .slice(0, 5);

  // Decaying memories
  const decaying = nonRecap.filter(({ memory: mem }) => {
    const u = getUsage(usage, mem.frontmatter.id);
    return isDecaying(u, mem.frontmatter.created_at);
  });

  const selected = filtered[cursor];

  const counts = nonRecap.reduce<Record<string, number>>((acc, m) => {
    acc[m.memory.frontmatter.status] = (acc[m.memory.frontmatter.status] ?? 0) + 1;
    return acc;
  }, {});

  const flash_ = (text: string, color: "green" | "red" | "yellow" = "green") => {
    setFlash({ text, color });
    setTimeout(() => setFlash(null), 2500);
  };

  // ── Actions ───────────────────────────────────────────────────────────
  const doStatusChange = useCallback(async (newStatus: "validated" | "rejected") => {
    if (!selected) return;
    const fm = selected.memory.frontmatter;
    if (fm.status === newStatus) { flash_(`Already ${newStatus}`, "yellow"); return; }
    await writeFile(
      selected.filePath,
      serializeMemory({ frontmatter: { ...fm, status: newStatus }, body: selected.memory.body }),
      "utf8",
    );
    const label = newStatus === "validated" ? "✓ Approved" : "✗ Rejected";
    const color = newStatus === "validated" ? "green" : "red";
    flash_(`${label}: ${fm.id.slice(0, 40)}`, color);
    const prev = cursor;
    await reload();
    setCursor(Math.min(prev, Math.max(0, filtered.length - 2)));
  }, [selected, cursor, filtered.length, reload]);

  // Promote = move personal → team (scope change) + set status proposed
  const doPromote = useCallback(async () => {
    if (!selected) return;
    const fm = selected.memory.frontmatter;
    if (fm.scope === "team") { flash_("Already team scope", "yellow"); return; }
    const teamDir = path.join(path.dirname(path.dirname(selected.filePath)), "team");
    const newFilePath = path.join(teamDir, path.basename(selected.filePath));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(teamDir, { recursive: true });
    await writeFile(
      newFilePath,
      serializeMemory({
        frontmatter: { ...fm, scope: "team" as const, status: "proposed" as const },
        body: selected.memory.body,
      }),
      "utf8",
    );
    await unlink(selected.filePath);
    flash_(`↑ Promoted to team: ${fm.id.slice(0, 36)}`, "yellow");
    await reload();
    setCursor((c) => Math.max(0, c - 1));
  }, [selected, reload]);

  const doDelete = useCallback(async () => {
    if (!selected) return;
    const fm = selected.memory.frontmatter;
    await unlink(selected.filePath);
    flash_(`🗑 Deleted: ${fm.id.slice(0, 40)}`, "red");
    await reload();
    setCursor((c) => Math.max(0, c - 1));
  }, [selected, reload]);

  useInput((input, key) => {
    if (input === "q") { exit(); return; }
    if (input === "1") { setScreen("memories"); setCursor(0); return; }
    if (input === "2") { setScreen("health"); return; }
    if (input === "3") { setScreen("stats"); return; }

    if (screen === "memories") {
      if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
      if (key.downArrow) setCursor((c) => Math.min(filtered.length - 1, c + 1));
      if (key.tab) { setFilterIdx((i) => (i + 1) % FILTERS.length); setCursor(0); }
      if (input === "a") void doStatusChange("validated");
      if (input === "r") void doStatusChange("rejected");
      if (input === "p") void doPromote();
      if (input === "d") void doDelete();
    }
  });

  if (loading) return <Text dimColor>Loading memories…</Text>;
  if (!existsSync(paths.memoriesDir)) {
    return <Text color="red">No .ai/memories found — run `hivelore init` first.</Text>;
  }

  // ── Header (shared) ───────────────────────────────────────────────────
  const v = counts["validated"] ?? 0;
  const p = counts["proposed"] ?? 0;
  const d = counts["draft"] ?? 0;
  const st = counts["stale"] ?? 0;
  const rej = counts["rejected"] ?? 0;

  const Header = () => (
    <Box borderStyle="round" paddingX={1} gap={2}>
      <Text bold color="cyan">Hivelore</Text>
      <Text dimColor>{root.length > 40 ? "…" + root.slice(-38) : root}</Text>
      <Text>  </Text>
      <Text color="green">✓ {v}</Text>
      <Text color={p > 0 ? "yellow" : undefined}>  ~ {p}</Text>
      <Text dimColor>  · {d}</Text>
      {st > 0 && <Text color="yellow">  ⚠ {st}</Text>}
      {rej > 0 && <Text color="red">  ✗ {rej}</Text>}
    </Box>
  );

  const ScreenTabs = () => (
    <Box paddingX={1} gap={3} marginBottom={0}>
      {(["memories", "health", "stats"] as Screen[]).map((s, i) => (
        <Text key={s} color={screen === s ? "cyan" : undefined} bold={screen === s}>
          [{i + 1}] {screen === s ? `[${s}]` : s}
        </Text>
      ))}
      <Text dimColor>  [q] quit</Text>
    </Box>
  );

  const FlashBar = () => flash
    ? <Box paddingX={1}><Text color={flash.color}>{flash.text}</Text></Box>
    : null;

  // ── Screen: Memories ─────────────────────────────────────────────────
  if (screen === "memories") {
    const half = Math.floor(LIST_H / 2);
    const start = Math.max(0, Math.min(cursor - half, Math.max(0, filtered.length - LIST_H)));
    const visible = filtered.slice(start, start + LIST_H);

    return (
      <Box flexDirection="column">
        <Header />
        <ScreenTabs />

        {/* Filter bar */}
        <Box paddingX={1} gap={2} marginBottom={0}>
          {FILTERS.map((f) => (
            <Text key={f} color={filter === f ? "cyan" : undefined} bold={filter === f}>
              {filter === f ? `[${f}]` : f}
            </Text>
          ))}
          <Text dimColor>  [tab] cycle</Text>
        </Box>

        {/* List + Preview */}
        <Box>
          <Box flexDirection="column" width={64} borderStyle="single" paddingX={1}>
            <Text bold dimColor>{`MEMORIES  ${filtered.length}/${nonRecap.length}`}</Text>
            {filtered.length === 0 ? (
              <Text dimColor>  (no memories in this filter)</Text>
            ) : (
              visible.map((m, vi) => {
                const absIdx = start + vi;
                const fm = m.memory.frontmatter;
                const sel = absIdx === cursor;
                const idShort = fm.id.length > 43 ? fm.id.slice(0, 40) + "…" : fm.id;
                return (
                  <Box key={fm.id}>
                    <Text color={sel ? "cyan" : undefined} bold={sel}>
                      {sel ? "▶ " : "  "}
                      {idShort.padEnd(43)}
                    </Text>
                    <Text color={statusColor(fm.status)}>{fm.status.slice(0, 9)}</Text>
                  </Box>
                );
              })
            )}
          </Box>

          {/* Preview */}
          <Box flexDirection="column" width={40} borderStyle="single" paddingX={1}>
            <Text bold dimColor>PREVIEW</Text>
            {selected ? (
              <>
                <Text bold>{selected.memory.frontmatter.id.slice(0, 36)}</Text>
                <Text color="cyan">
                  {selected.memory.frontmatter.scope}/{selected.memory.frontmatter.type}
                  {selected.memory.frontmatter.module ? ` [${selected.memory.frontmatter.module}]` : ""}
                </Text>
                <Text color={statusColor(selected.memory.frontmatter.status)}>
                  {selected.memory.frontmatter.status}
                  {selected.memory.frontmatter.revision_count ? ` (rev ${selected.memory.frontmatter.revision_count})` : ""}
                </Text>
                <Text dimColor>tags: {selected.memory.frontmatter.tags.slice(0, 5).join(", ") || "(none)"}</Text>
                <Text> </Text>
                {selected.memory.body
                  .split("\n")
                  .slice(0, LIST_H - 4)
                  .map((line, i) => (
                    <Text key={i} wrap="truncate-end">{line || " "}</Text>
                  ))}
              </>
            ) : (
              <Text dimColor>select a memory</Text>
            )}
          </Box>
        </Box>

        <FlashBar />
        <Box paddingX={1}>
          <Text dimColor>↑↓ navigate  [tab] filter  [a] approve  [r] reject  [p] promote personal→team  [d] delete</Text>
        </Box>
      </Box>
    );
  }

  // ── Screen: Health ────────────────────────────────────────────────────
  if (screen === "health") {
    return (
      <Box flexDirection="column">
        <Header />
        <ScreenTabs />
        <Box gap={2}>

          {/* Stale memories */}
          <Box flexDirection="column" width={40} borderStyle="single" paddingX={1}>
            <Text bold color={staleMemories.length > 0 ? "yellow" : "green"}>
              ⚠ STALE  ({staleMemories.length})
            </Text>
            {staleMemories.length === 0
              ? <Text dimColor>  All memories are fresh</Text>
              : staleMemories.slice(0, LIST_H).map((m) => (
                <Text key={m.memory.frontmatter.id} wrap="truncate-end" color="yellow">
                  {m.memory.frontmatter.id.slice(0, 36)}
                </Text>
              ))
            }
            {staleMemories.length > LIST_H && (
              <Text dimColor>  … +{staleMemories.length - LIST_H} more</Text>
            )}
          </Box>

          <Box flexDirection="column" gap={1}>
            {/* Pending review */}
            <Box flexDirection="column" width={44} borderStyle="single" paddingX={1}>
              <Text bold color={pending.length > 0 ? "yellow" : "green"}>
                ~ PENDING REVIEW  ({pending.length})
              </Text>
              {pending.length === 0
                ? <Text dimColor>  No memories pending review</Text>
                : pending.slice(0, 6).map((m) => (
                  <Text key={m.memory.frontmatter.id} wrap="truncate-end">
                    {m.memory.frontmatter.id.slice(0, 40)}
                  </Text>
                ))
              }
            </Box>

            {/* Anchorless */}
            <Box flexDirection="column" width={44} borderStyle="single" paddingX={1}>
              <Text bold dimColor>⊘ ANCHORLESS  ({anchorless.length})</Text>
              <Text dimColor>  No paths/symbols — staleness undetectable</Text>
              {anchorless.slice(0, 5).map((m) => (
                <Text key={m.memory.frontmatter.id} wrap="truncate-end" dimColor>
                  {m.memory.frontmatter.id.slice(0, 40)}
                </Text>
              ))}
              {anchorless.length > 5 && (
                <Text dimColor>  … +{anchorless.length - 5} more</Text>
              )}
            </Box>
          </Box>
        </Box>

        <Box paddingX={1} marginTop={1}>
          <Text dimColor>
            Run `hivelore memory verify --update` to recheck anchors  |  `hivelore memory update &lt;id&gt; --paths &lt;files&gt;` to add anchors
          </Text>
        </Box>
        <FlashBar />
      </Box>
    );
  }

  // ── Screen: Stats ─────────────────────────────────────────────────────
  return (
    <Box flexDirection="column">
      <Header />
      <ScreenTabs />
      <Box gap={2}>

        {/* Top read */}
        <Box flexDirection="column" width={44} borderStyle="single" paddingX={1}>
          <Text bold dimColor>📖 TOP READ MEMORIES</Text>
          {topRead.length === 0
            ? <Text dimColor>  No read data yet (use `get_briefing`)</Text>
            : topRead.map(({ m, u }) => (
              <Box key={m.memory.frontmatter.id}>
                <Text wrap="truncate-end">
                  {m.memory.frontmatter.id.slice(0, 32).padEnd(32)}
                </Text>
                <Text color="cyan">  ×{u.read_count}</Text>
              </Box>
            ))
          }
        </Box>

        <Box flexDirection="column" gap={1}>
          {/* Decaying */}
          <Box flexDirection="column" width={44} borderStyle="single" paddingX={1}>
            <Text bold color={decaying.length > 0 ? "yellow" : "green"}>
              ⏳ DECAYING (not read in 90d)  ({decaying.length})
            </Text>
            {decaying.length === 0
              ? <Text dimColor>  All memories are actively used</Text>
              : decaying.slice(0, 5).map((m) => (
                <Text key={m.memory.frontmatter.id} wrap="truncate-end" color="yellow">
                  {m.memory.frontmatter.id.slice(0, 40)}
                </Text>
              ))
            }
          </Box>

          {/* Memory totals */}
          <Box flexDirection="column" width={44} borderStyle="single" paddingX={1}>
            <Text bold dimColor>📊 MEMORY TOTALS</Text>
            <Text>  Validated:  <Text color="green">{v}</Text></Text>
            <Text>  Proposed:   <Text color="yellow">{p}</Text></Text>
            <Text>  Draft:      <Text dimColor>{d}</Text></Text>
            <Text>  Stale:      <Text color="yellow">{st}</Text></Text>
            <Text>  Rejected:   <Text color="red">{rej}</Text></Text>
            <Text>  Total:      <Text bold>{nonRecap.length}</Text></Text>
          </Box>
        </Box>
      </Box>
      <FlashBar />
    </Box>
  );
}
