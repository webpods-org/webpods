// Logger utility for WebPods CLI

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
  const silent = process.env.CLI_SILENT === "true";

  const shouldLog = (level: string): boolean => {
    return !silent && levels.indexOf(level) >= currentLevelIndex;
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

// Output utilities for CLI user messages
export interface CliOutput {
  print: (message?: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
  warning: (message: string) => void; // alias for warn
  info: (message: string) => void;
  json: (data: unknown) => void;
  yaml: (data: unknown) => void; // will output as JSON for now
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
    warning: (message: string) => {
      console.warn(message);
    },
    info: (message: string) => {
      if (!quiet) {
        console.info(message);
      }
    },
    json: (data: unknown) => {
      if (!quiet) {
        console.info(JSON.stringify(data, null, 2));
      }
    },
    yaml: (data: unknown) => {
      // For now, output as JSON. Could add YAML library later
      if (!quiet) {
        console.info(JSON.stringify(data, null, 2));
      }
    },
  };
}
