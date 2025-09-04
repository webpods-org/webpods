// Test logger utilities

export interface Logger {
  debug: (message: string, meta?: any) => void;
  info: (message: string, meta?: any) => void;
  warn: (message: string, meta?: any) => void;
  error: (message: string, meta?: any) => void;
}

export const consoleLogger: Logger = {
  debug: (message: string, meta?: any) => {
    console.info(`[DEBUG] ${message}`, meta || "");
  },
  info: (message: string, meta?: any) => {
    console.info(`[INFO] ${message}`, meta || "");
  },
  warn: (message: string, meta?: any) => {
    console.warn(`[WARN] ${message}`, meta || "");
  },
  error: (message: string, meta?: any) => {
    console.error(`[ERROR] ${message}`, meta || "");
  },
};

// Silent logger for tests
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// Logger that respects DEBUG environment variable
// Only shows output when DEBUG=true or DEBUG=1
export const testLogger: Logger = process.env.DEBUG === "true" || process.env.DEBUG === "1" 
  ? consoleLogger 
  : silentLogger;
