/**
 * Minimal keyword-based categorizer for directory tools. Good enough to
 * seed a category until Dev3 replaces it with something smarter (e.g. an
 * AI-assisted classification pass over the description/topics).
 */
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  automation: ["automation", "workflow", "no-code", "n8n", "zapier"],
  framework: ["framework", "sdk", "library", "agent"],
  backend: ["database", "backend", "baas", "auth", "postgres"],
  "ai-model": ["llm", "model", "inference", "fine-tune"],
};

export function classifyCategory(description: string, tags: string[] = []): string {
  const haystack = `${description} ${tags.join(" ")}`.toLowerCase();

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => haystack.includes(keyword))) {
      return category;
    }
  }

  return "other";
}
