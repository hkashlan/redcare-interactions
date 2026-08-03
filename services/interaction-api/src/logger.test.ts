import { afterEach, describe, expect, it, vi } from 'vitest';
import { logger } from './logger';

const originalLevel = process.env.LOG_LEVEL;

afterEach(() => {
  process.env.LOG_LEVEL = originalLevel;
  vi.restoreAllMocks();
});

function capture(level: string | undefined) {
  if (level === undefined) delete process.env.LOG_LEVEL;
  else process.env.LOG_LEVEL = level;

  return {
    out: vi.spyOn(console, 'log').mockImplementation(() => {}),
    err: vi.spyOn(console, 'error').mockImplementation(() => {}),
  };
}

describe('logger', () => {
  it('writes one line of parseable JSON with level, time and fields', () => {
    const { out } = capture('info');

    logger.info('served', { requestId: 'req-1', count: 2 });

    expect(out).toHaveBeenCalledTimes(1);
    const line = JSON.parse(out.mock.calls[0]?.[0] as string);
    expect(line).toMatchObject({ level: 'info', message: 'served', requestId: 'req-1', count: 2 });
    expect(Date.parse(line.time)).not.toBeNaN();
  });

  it('sends errors to stderr and everything else to stdout', () => {
    const { out, err } = capture('debug');

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(out).toHaveBeenCalledTimes(3);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('defaults to info, suppressing debug', () => {
    const { out } = capture(undefined);

    logger.debug('quiet');
    logger.info('loud');

    expect(out).toHaveBeenCalledTimes(1);
  });

  it('filters by severity rather than toggling debug only', () => {
    const { out, err } = capture('error');

    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(out).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('accepts the level in any case', () => {
    const { out } = capture('DEBUG');

    logger.debug('shown');

    expect(out).toHaveBeenCalledTimes(1);
  });

  it('falls back to info for an unrecognised level', () => {
    const { out } = capture('verbose');

    logger.debug('hidden');
    logger.info('shown');

    expect(out).toHaveBeenCalledTimes(1);
  });
});
