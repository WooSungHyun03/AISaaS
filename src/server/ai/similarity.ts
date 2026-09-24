/**
 * Cheap near-duplicate detection for AI-generated blog topics — no
 * embeddings/vector infra (project rule: no new infra without a proven
 * need). Character-bigram Jaccard similarity works on normalized text
 * regardless of whitespace/tokenization, which matters for Korean topic
 * phrases that often have no natural word boundaries.
 */

function normalizeTopic(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set(value ? [value] : []);
  const grams = new Set<string>();
  for (let i = 0; i < value.length - 1; i++) grams.add(value.slice(i, i + 2));
  return grams;
}

/** Jaccard similarity of character bigrams, 0 (unrelated) .. 1 (identical after normalization). */
export function topicSimilarity(a: string, b: string): number {
  const normA = normalizeTopic(a);
  const normB = normalizeTopic(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const gramsA = bigrams(normA);
  const gramsB = bigrams(normB);
  let intersection = 0;
  for (const gram of gramsA) if (gramsB.has(gram)) intersection++;
  const union = gramsA.size + gramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export const NEAR_DUPLICATE_THRESHOLD = 0.5;

export function isNearDuplicateTopic(
  candidate: string,
  recentTopics: string[],
  threshold: number = NEAR_DUPLICATE_THRESHOLD,
): boolean {
  return recentTopics.some((topic) => topicSimilarity(candidate, topic) >= threshold);
}
