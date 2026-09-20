type LogContext = Record<string, unknown>;

function format(level: string, message: string, context?: LogContext) {
  const entry = { level, message, time: new Date().toISOString(), ...context };
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
