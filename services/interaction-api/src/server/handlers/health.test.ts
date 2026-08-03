import { describe, expect, it } from 'vitest';
import { handleHealth } from './health';

describe('handleHealth', () => {
  it('returns 200 with status ok', async () => {
    const response = await handleHealth(new Request('http://test/api/health'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
  });
});
