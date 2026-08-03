/**
 * Minimal structured JSON logger — one line per event, machine-parseable.
 * Deliberately hand-rolled for the challenge; in production this would be
 * pino (or the platform logger) with redaction and transports.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

const SEVERITY: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function isLevel(value: string | undefined): value is Level {
  return value !== undefined && value in SEVERITY;
}

/** LOG_LEVEL is case-insensitive; anything unrecognised falls back to "info". */
function minimumSeverity(): number {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  return SEVERITY[isLevel(configured) ? configured : 'info'];
}

function write(level: Level, message: string, fields: Record<string, unknown>): void {
  if (SEVERITY[level] < minimumSeverity()) return;

  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...fields,
  });
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

const at =
  (level: Level) =>
  (message: string, fields: Record<string, unknown> = {}) =>
    write(level, message, fields);

export const logger = {
  debug: at('debug'),
  info: at('info'),
  warn: at('warn'),
  error: at('error'),
};
