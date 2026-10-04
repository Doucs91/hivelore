/** Keep complete instructions. If an instruction cannot fit, return navigation, never half a rule. */
export function completeExcerpt(text: string, maxChars: number): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  const units = clean.split(/\n\s*\n|(?<=[.!?])\s+(?=[A-ZÀ-Ü])/u);
  const result: string[] = [];
  let used = 0;
  for (const unit of units) {
    if (used + unit.length + (result.length ? 2 : 0) > maxChars) break;
    result.push(unit); used += unit.length + 2;
  }
  return result.join("\n\n");
}
