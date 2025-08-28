// Logger utility for WebPods CLI

export interface Logger {
  debug: (message: string, meta?: any) => void;
  info: (message: string, meta?: any) => void;
  warn: (message: string, meta?: any) => void;
  error: (message: string, meta?: any) => void;
}

export function createLogger(name: string): Logger {
  const logLevel = process.env.LOG_LEVEL || "info";
  const levels = ["debug", "info", "warn", "error"];
  const currentLevelIndex = levels.indexOf(logLevel);
  const silent = process.env.CLI_SILENT === "true";

  const shouldLog = (level: string): boolean => {
    return !silent && levels.indexOf(level) >= currentLevelIndex;
  };

  const formatMessage = (
    level: string,
    message: string,
    meta?: any,
  ): string => {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : "";
    return `[${timestamp}] [${level.toUpperCase()}] [${name}] ${message}${metaStr}`;
  };

  return {
    debug: (message: string, meta?: any) => {
      if (shouldLog("debug")) {
        console.info(formatMessage("debug", message, meta));
      }
    },
    info: (message: string, meta?: any) => {
      if (shouldLog("info")) {
        console.info(formatMessage("info", message, meta));
      }
    },
    warn: (message: string, meta?: any) => {
      if (shouldLog("warn")) {
        console.warn(formatMessage("warn", message, meta));
      }
    },
    error: (message: string, meta?: any) => {
      if (shouldLog("error")) {
        console.error(formatMessage("error", message, meta));
      }
    },
  };
}

// Output utilities for CLI user messages
export interface CliOutput {
  print: (message?: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
}

export function createCliOutput(quiet?: boolean): CliOutput {
  return {
    print: (message?: string) => {
      if (!quiet) {
        console.info(message ?? "");
      }
    },
    success: (message: string) => {
      if (!quiet) {
        console.info(message);
      }
    },
    error: (message: string) => {
      console.error(message);
    },
    warn: (message: string) => {
      console.warn(message);
    },
  };
}