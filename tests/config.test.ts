import { describe, expect, it } from 'vitest';
import { MAX_SELECTION, MAX_STOPS_PER_ROUTE } from '../src/config';

describe('上限', () => {
  it('一度に30件まで選べ、1ルートは10地点', () => {
    expect(MAX_SELECTION).toBe(30);
    expect(MAX_STOPS_PER_ROUTE).toBe(10);
  });
});
