import { DiagnosisError, fetchPublicText } from "@/server/marketing/diagnosis";

/** The name blog collectors send as User-Agent (see fetchHop in marketing/diagnosis.ts). */
export const COLLECTOR_ROBOT_NAME = "EasyMarketingDiagnosisBot";

interface Rule {
  allow: boolean;
  path: string;
}

/** Shown to the owner when a blog's robots.txt does not allow the collector. */
export const ROBOTS_DISALLOWED_REASON = "블로그가 자동 수집(robots.txt)을 허용하지 않아 측정하지 못했어요.";

const CACHE_TTL_MS = 60 * 60_000;
const cache = new Map<string, { rules: Rule[] | "DISALLOW_ALL"; expiresAt: number }>();

/** The rules that apply to `robotName` (its own group, else `*`), per RFC 9309: the most specific user-agent group wins. */
export function parseRobotsRules(text: string, robotName: string = COLLECTOR_ROBOT_NAME): Rule[] {
  const name = robotName.toLowerCase();
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (field !== "allow" && field !== "disallow")) continue;
    if (value) current.rules.push({ allow: field === "allow", path: value });
  }
  const own = groups.filter((group) => group.agents.some((agent) => agent !== "*" && name.startsWith(agent)));
  const chosen = own.length > 0 ? own : groups.filter((group) => group.agents.includes("*"));
  return chosen.flatMap((group) => group.rules);
}

function matches(path: string, pattern: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = new RegExp(`^${body.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}${anchored ? "$" : ""}`);
  return regex.test(path);
}

/** Longest matching rule wins; Allow beats Disallow on a tie; no matching rule means allowed. */
export function isPathAllowed(rules: Rule[], path: string): boolean {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!matches(path, rule.path)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
  }
  return best ? best.allow : true;
}

/**
 * Whether the collector may fetch `url` under the site's robots.txt (RFC 9309). A missing robots.txt (4xx) allows
 * everything; a server error or unreachable robots.txt is treated as "do not crawl" for this attempt, which the
 * pipeline records as a failed try and retries later. Results are cached per origin for an hour.
 */
export async function isFetchAllowedByRobots(url: string, now: number = Date.now()): Promise<boolean> {
  const target = new URL(url);
  const origin = target.origin;
  let entry = cache.get(origin);
  if (!entry || entry.expiresAt <= now) {
    let rules: Rule[] | "DISALLOW_ALL";
    try {
      rules = parseRobotsRules((await fetchPublicText(`${origin}/robots.txt`)).html);
    } catch (cause) {
      const status = cause instanceof DiagnosisError ? Number(/HTTP (\d{3})/.exec(cause.message)?.[1] ?? 0) : 0;
      if (cause instanceof DiagnosisError && (cause.code === "BLOCKED_TARGET" || cause.code === "INVALID_URL")) throw cause;
      // 4xx and a non-text answer mean "no robots rules"; 5xx, timeouts and connection errors mean "unavailable".
      rules = (status >= 400 && status < 500) || (cause instanceof DiagnosisError && cause.code === "UNSUPPORTED_CONTENT") ? [] : "DISALLOW_ALL";
    }
    entry = { rules, expiresAt: now + CACHE_TTL_MS };
    // Only a definite answer is cached for long; a transient failure is asked again on the next attempt.
    if (rules !== "DISALLOW_ALL") cache.set(origin, entry);
  }
  if (entry.rules === "DISALLOW_ALL") return false;
  return isPathAllowed(entry.rules, `${target.pathname}${target.search}`);
}

export function clearRobotsCacheForTests(): void {
  cache.clear();
}
