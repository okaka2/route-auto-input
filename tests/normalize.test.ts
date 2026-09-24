import { describe, expect, it } from 'vitest';
import { findSimilar, normalizeAddress, normalizeName } from '../src/normalize';
import { createPatient } from '../src/patient';

describe('normalizeAddress', () => {
  it.each([
    ['東京都 世田谷区 桜丘１－２－３', '東京都世田谷区桜丘1-2-3'],
    ['東京都世田谷区桜丘1丁目2番3号', '東京都世田谷区桜丘1-2-3'],
    ['東京都世田谷区桜丘1ー2−3', '東京都世田谷区桜丘1-2-3'],
    ['東京都世田谷区桜丘1-2-3 ○○マンション101', '東京都世田谷区桜丘1-2-3○○マンション101'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected);
  });
});

describe('normalizeName', () => {
  it('空白と末尾の敬称を除き、全角英数を半角にする', () => {
    expect(normalizeName('山田 太郎 様')).toBe('山田太郎');
    expect(normalizeName('山田太郎さん')).toBe('山田太郎');
    expect(normalizeName('ＡＢＣ商店')).toBe('ABC商店');
  });
});

describe('findSimilar', () => {
  const a = createPatient('山田 太郎', '東京都世田谷区桜丘1-2-3');
  const b = createPatient('佐藤 花子', '東京都世田谷区桜丘1-2-3 A棟201');
  it('同じ住所(書き方が違っても)を見つける', () => {
    expect(findSimilar([a, b], { name: '鈴木', address: '東京都世田谷区桜丘１丁目２番３号' }, null)).toEqual([a]);
  });
  it('同じ名前(敬称の有無が違っても)を見つける', () => {
    expect(findSimilar([a, b], { name: '山田太郎様', address: '大阪府' }, null)).toEqual([a]);
  });
  it('建物名・部屋番号が違えば別扱い', () => {
    expect(findSimilar([a, b], { name: '鈴木', address: '東京都世田谷区桜丘1-2-3 A棟202' }, null)).toEqual([]);
  });
  it('編集中の自分は除く', () => {
    expect(findSimilar([a], { name: a.name, address: a.address }, a.id)).toEqual([]);
  });
});
