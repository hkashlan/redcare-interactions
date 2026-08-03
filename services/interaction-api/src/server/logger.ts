/**
 * Minimal structured JSON logger — one line per event, machine-parseable.
 * Deliberately hand-rolled for the challenge; in production this would be
 * pino (or the platform logger) with redaction and log levels from config.
 */

type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, fields: Record<string, unknown>): void {
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

export const logger = {
  info: (message: string, fields: Record<string, unknown> = {}) => write('info', message, fields),
  warn: (message: string, fields: Record<string, unknown> = {}) => write('warn', message, fields),
  error: (message: string, fields: Record<string, unknown> = {}) => write('error', message, fields),
};
