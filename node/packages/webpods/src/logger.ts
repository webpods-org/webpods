// Simple logger utility for WebPods

export interface Logger {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export function createLogger(name: string): Logger {
  const logLevel = process.env.LOG_LEVEL || "info";
  const levels = ["debug", "info", "warn", "error"];
  const currentLevelIndex = levels.indexOf(logLevel);

  const shouldLog = (level: string): boolean => {
    return levels.indexOf(level) >= currentLevelIndex;
  };

  const formatMessage = (
    level: string,
    message: string,
    meta?: Record<string, unknown>,
  ): string => {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] [${name}] ${message}${metaStr}`;
  };

  return {
    debug: (message: string, meta?: Record<string, unknown>) => {
      if (shouldLog("debug")) {
        console.info(formatMessage("debug", message, meta));
      }
    },
    info: (message: string, meta?: Record<string, unknown>) => {
      if (shouldLog("info")) {
        console.info(formatMessage("info", message, meta));
      }
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      if (shouldLog("warn")) {
        console.warn(formatMessage("warn", message, meta));
      }
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      if (shouldLog("error")) {
        console.error(formatMessage("error", message, meta));
      }
    },
  };
}
