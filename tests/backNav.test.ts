import { describe, expect, it } from 'vitest';
import { arrivedDepth, navDepth } from '../src/backNav';

describe('navDepth', () => {
  it('一覧0、訪問順・登録編集・設定・履歴1、地図2', () => {
    expect(navDepth('list', false)).toBe(0);
    expect(navDepth('order', false)).toBe(1);
    expect(navDepth('form', false)).toBe(1);
    expect(navDepth('settings', false)).toBe(1);
    expect(navDepth('history', false)).toBe(1);
    expect(navDepth('map', false)).toBe(2);
  });

  it('小窓が開いていれば1つ深い', () => {
    expect(navDepth('list', true)).toBe(1);
    expect(navDepth('order', true)).toBe(2);
    expect(navDepth('map', true)).toBe(3);
  });
});

describe('arrivedDepth', () => {
  it('{ nav: n } の n を読む', () => {
    expect(arrivedDepth({ nav: 0 })).toBe(0);
    expect(arrivedDepth({ nav: 2 })).toBe(2);
  });

  it('無い・不正な値は0', () => {
    expect(arrivedDepth(null)).toBe(0);
    expect(arrivedDepth(undefined)).toBe(0);
    expect(arrivedDepth('x')).toBe(0);
    expect(arrivedDepth({})).toBe(0);
    expect(arrivedDepth({ nav: '1' })).toBe(0);
    expect(arrivedDepth({ nav: -1 })).toBe(0);
    expect(arrivedDepth({ nav: 1.5 })).toBe(0);
    expect(arrivedDepth({ nav: Number.NaN })).toBe(0);
  });
});
