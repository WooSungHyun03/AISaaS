/**
 * The values of a list in order, each once (compared ignoring case and surrounding spaces). AI-written keyword and tag
 * lists can repeat a value; used as React keys such a list renders duplicated or missing badges.
 */
export function uniqueTexts(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
