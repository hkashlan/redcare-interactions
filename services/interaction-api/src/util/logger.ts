import { consola, LogLevels, type LogType } from 'consola';
import { useRuntimeConfig } from 'nitro/runtime-config';

/**
 * Consola gives the levels, the `LOG_LEVEL` filtering and the call sites; the
 * one reporter makes it emit a single JSON line per event instead of consola's
 * default human formatting, which wraps objects over several lines — one log
 * record per line is what a collector needs.
 *
 * `LOG_LEVEL` names a consola type (debug/info/warn/error); anything else falls
 * back to info.
 */

const { logLevel } = useRuntimeConfig();

export const logger = consola.create({
  level: LogLevels[String(logLevel).toLowerCase() as LogType] ?? LogLevels.info,
  reporters: [
    {
      log: ({ type, date, args: [message, fields] }) =>
        console.log(JSON.stringify({ level: type, time: date.toISOString(), message, ...fields })),
    },
  ],
});
