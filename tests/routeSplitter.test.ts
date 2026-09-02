import { describe, expect, it } from 'vitest';
import { splitIntoRoutes } from '../src/routeSplitter';

const stops = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);

describe('splitIntoRoutes', () => {
  it('上限ちょうどなら分割しない', () => {
    expect(splitIntoRoutes(stops(5), 5)).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('上限未満なら分割しない', () => {
    expect(splitIntoRoutes(stops(2), 5)).toEqual([[1, 2]]);
  });

  it('6件は2本に分かれ、境目の地点が両方に含まれる', () => {
    expect(splitIntoRoutes(stops(6), 5)).toEqual([
      [1, 2, 3, 4, 5],
      [5, 6],
    ]);
  });

  it('10件は3本に分かれる', () => {
    expect(splitIntoRoutes(stops(10), 5)).toEqual([
      [1, 2, 3, 4, 5],
      [5, 6, 7, 8, 9],
      [9, 10],
    ]);
  });

  it('どのルートも2件以上になる', () => {
    for (let count = 2; count <= 10; count += 1) {
      for (const route of splitIntoRoutes(stops(count), 5)) {
        expect(route.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('分割しても訪問順が保たれる', () => {
    const flattened = splitIntoRoutes(stops(10), 5)
      .flatMap((route, index) => (index === 0 ? route : route.slice(1)));
    expect(flattened).toEqual(stops(10));
  });

  it('上限を10にすると10件が1本になる', () => {
    expect(splitIntoRoutes(stops(10), 10)).toHaveLength(1);
  });

  it('1件のときは1本のルートとして返す', () => {
    expect(splitIntoRoutes(stops(1), 5)).toEqual([[1]]);
  });

  it('0件のときは空配列を返す', () => {
    expect(splitIntoRoutes([], 5)).toEqual([]);
  });

  it('上限が2未満なら例外を投げる', () => {
    expect(() => splitIntoRoutes(stops(3), 1)).toThrow();
  });
});
