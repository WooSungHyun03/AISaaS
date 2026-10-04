type LogContext = Record<string, unknown>;

const SENSITIVE_KEY = /(token|secret|password|passwd|authorization|api[_-]?key|credential|cookie|private[_-]?key)/i;
const MAX_DEPTH = 4;
const MAX_STRING = 2_000;

/**
 * Production debugging needs context (run id, business id, feature, error
 * code), but never secrets: any value stored under a key that looks sensitive
 * is replaced, long strings are cut, and nesting is bounded.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Error) return { name: value.name, message: redact(value.message, depth + 1) };
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? "[redacted]" : redact(item, depth + 1)]),
  );
}

function format(level: string, message: string, context?: LogContext) {
  const entry = { level, message, time: new Date().toISOString(), ...(context ? (redact(context) as LogContext) : {}) };
  return JSON.stringify(entry);
}

export const logger = {
  info(message: string, context?: LogContext) {
    console.log(format("info", message, context));
  },
  warn(message: string, context?: LogContext) {
    console.warn(format("warn", message, context));
  },
  error(message: string, context?: LogContext) {
    console.error(format("error", message, context));
  },
};
