import type { Logger } from "./types.js";

/** No-op logger used by default so the library stays silent unless configured. */
export const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Minimal structured console logger, handy for examples and local dev. */
export function createConsoleLogger(prefix = "[webhooks]"): Logger {
  const fmt = (msg: string, meta?: Record<string, unknown>) =>
    meta ? `${prefix} ${msg} ${JSON.stringify(meta)}` : `${prefix} ${msg}`;
  return {
    debug: (m, meta) => console.debug(fmt(m, meta)),
    info: (m, meta) => console.info(fmt(m, meta)),
    warn: (m, meta) => console.warn(fmt(m, meta)),
    error: (m, meta) => console.error(fmt(m, meta)),
  };
}
