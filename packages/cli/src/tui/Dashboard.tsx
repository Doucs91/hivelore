import { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import {
  loadMemoriesFromDir,
  resolveHaivePaths,
  serializeMemory,
  type LoadedMemory,
} from "@hiveai/core";

type FilterStatus = "all" | "draft" | "proposed" | "validated" | "stale" | "rejected";
const FILTERS: FilterStatus[] = ["all", "draft", "proposed", "validated", "stale", "rejected"];
const LIST_H = 12;

function statusColor(status: string): "green" | "yellow" | "red" | undefined {
  if (status === "validated") return "green";
  if (status === "proposed" || status === "stale") return "yellow";
  if (status === "rejected") return "red";
  return undefined;
}

interface Props {
  root: string;
}

export function Dashboard({ root }: Props) {
  const { exit } = useApp();
  const paths = resolveHaivePaths(root);

  const [memories, setMemories] = useState<LoadedMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterIdx, setFilterIdx] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [flash, setFlash] = useState<{ text: string; color: "green" | "red" } | null>(null);

  const filter: FilterStatus = FILTERS[filterIdx] ?? "all";

  const reload = useCallback(async () => {
    if (!existsSync(paths.memoriesDir)) {
      setLoading(false);
      return;
    }
    setMemories(await loadMemoriesFromDir(paths.memoriesDir));
    setLoading(false);
  }, [paths.memoriesDir]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const filtered = memories.filter((m) => {
    const s = m.memory.frontmatter.status;
    if (filter === "all") return s !== "rejected";
    return s === filter;
  });

  const selected = filtered[cursor];

  const counts = memories.reduce<Record<string, number>>((acc, m) => {
    const s = m.memory.frontmatter.status;
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  const flash_ = (text: string, color: "green" | "red" = "green") => {
    setFlash({ text, color });
    setTimeout(() => setFlash(null), 2000);
  };

  const doApprove = useCallback(async () => {
    if (!selected) return;
    const fm = selected.memory.frontmatter;
    if (fm.status === "validated") { flash_("Already validated"); return; }
    await writeFile(
      selected.filePath,
      serializeMemory({ frontmatter: { ...fm, status: "validated" as const }, body: selected.memory.body }),
      "utf8",
    );
    flash_(`✓ Approved ${fm.id.slice(0, 32)}…`);
    const prev = cursor;
    await reload();
    setCursor(prev);
  }, [selected, cursor, reload]);

  const doReject = useCallback(async () => {
    if (!selected) return;
    const fm = selected.memory.frontmatter;
    if (fm.status === "rejected") { flash_("Already rejected", "red"); return; }
    await writeFile(
      selected.filePath,
      serializeMemory({ frontmatter: { ...fm, status: "rejected" as const }, body: selected.memory.body }),
      "utf8",
    );
    flash_(`✗ Rejected ${fm.id.slice(0, 32)}…`, "red");
    await reload();
    setCursor((c) => Math.min(c, Math.max(0, filtered.length - 2)));
  }, [selected, filtered.length, reload]);

  useInput((input, key) => {
    if (input === "q") { exit(); return; }
    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(filtered.length - 1, c + 1));
    if (key.tab) {
      setFilterIdx((i) => (i + 1) % FILTERS.length);
      setCursor(0);
    }
    if (input === "a") void doApprove();
    if (input === "r") void doReject();
  });

  if (loading) {
    return <Text dimColor>Loading memories…</Text>;
  }

  if (!existsSync(paths.memoriesDir)) {
    return <Text color="red">No .ai/memories found — run `haive init` first.</Text>;
  }

  // Compute scrolling window
  const half = Math.floor(LIST_H / 2);
  const start = Math.max(0, Math.min(cursor - half, Math.max(0, filtered.length - LIST_H)));
  const visible = filtered.slice(start, start + LIST_H);

  const v = counts["validated"] ?? 0;
  const p = counts["proposed"] ?? 0;
  const d = counts["draft"] ?? 0;
  const s = counts["stale"] ?? 0;
  const rej = counts["rejected"] ?? 0;

  return (
    <Box flexDirection="column">

      {/* ── Header ── */}
      <Box borderStyle="round" paddingX={1} gap={2}>
        <Text bold color="cyan">hAIve</Text>
        <Text dimColor>{root}</Text>
        <Text>  </Text>
        <Text color="green">✓ {v}</Text>
        <Text> · </Text>
        <Text color={p > 0 ? "yellow" : undefined}>~ {p}</Text>
        <Text> · </Text>
        <Text dimColor>· {d}</Text>
        {s > 0 && <><Text> · </Text><Text color="yellow">⚠ {s}</Text></>}
        {rej > 0 && <><Text> · </Text><Text color="red">✗ {rej}</Text></>}
      </Box>

      {/* ── Filter bar ── */}
      <Box paddingX={1} gap={2}>
        {FILTERS.map((f) => (
          <Text key={f} color={filter === f ? "cyan" : undefined} bold={filter === f}>
            {filter === f ? `[${f}]` : f}
          </Text>
        ))}
        <Text dimColor>  tab→cycle</Text>
      </Box>

      {/* ── List + Preview ── */}
      <Box>

        {/* List panel */}
        <Box flexDirection="column" width={64} borderStyle="single" paddingX={1}>
          <Text bold dimColor>{`MEMORIES  ${filtered.length}/${memories.length}`}</Text>
          {filtered.length === 0 ? (
            <Text dimColor>  (no memories)</Text>
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

        {/* Preview panel */}
        <Box flexDirection="column" width={36} borderStyle="single" paddingX={1}>
          <Text bold dimColor>PREVIEW</Text>
          {selected ? (
            <>
              <Text color="cyan">
                {selected.memory.frontmatter.scope}/{selected.memory.frontmatter.type}
              </Text>
              <Text color={statusColor(selected.memory.frontmatter.status)}>
                {selected.memory.frontmatter.status}
              </Text>
              <Text> </Text>
              {selected.memory.body
                .split("\n")
                .slice(0, LIST_H - 1)
                .map((line, i) => (
                  <Text key={i} wrap="truncate-end">
                    {line || " "}
                  </Text>
                ))}
            </>
          ) : (
            <Text dimColor>select a memory</Text>
          )}
        </Box>

      </Box>

      {/* ── Flash message ── */}
      {flash && (
        <Box paddingX={1}>
          <Text color={flash.color}>{flash.text}</Text>
        </Box>
      )}

      {/* ── Footer ── */}
      <Box paddingX={1}>
        <Text dimColor>
          ↑↓ navigate  [tab] filter  [a] approve  [r] reject  [q] quit
        </Text>
      </Box>

    </Box>
  );
}
