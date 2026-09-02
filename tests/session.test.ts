import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession, type SessionRecord } from '../src/session';

const STORAGE_KEY = 'route-auto-input:session';

beforeEach(() => {
  window.localStorage.clear();
});

const record = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  selectedIds: ['id-1', 'id-2'],
  openedRouteIndexes: [0],
  timestamp: new Date('2026-09-03T09:00:00.000Z').toISOString(),
  ...overrides,
});

describe('saveSession / loadSession', () => {
  it('保存した内容をそのまま読み込める', () => {
    saveSession(record());
    expect(loadSession(new Date('2026-09-03T10:00:00.000Z'))).toEqual(record());
  });

  it('記録がなければnullを返す', () => {
    expect(loadSession()).toBeNull();
  });

  it('氏名・住所を書き込む余地がない(idと番号とタイムスタンプのみの型)', () => {
    saveSession(record());
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(Object.keys(parsed).sort()).toEqual(['openedRouteIndexes', 'selectedIds', 'timestamp']);
  });
});

describe('12時間の期限切れ', () => {
  it('12時間以内なら復元できる', () => {
    saveSession(record({ timestamp: new Date('2026-09-03T00:00:00.000Z').toISOString() }));
    const now = new Date('2026-09-03T11:59:59.000Z');
    expect(loadSession(now)).not.toBeNull();
  });

  it('12時間を超えると破棄される', () => {
    saveSession(record({ timestamp: new Date('2026-09-03T00:00:00.000Z').toISOString() }));
    const now = new Date('2026-09-03T12:00:01.000Z');
    expect(loadSession(now)).toBeNull();
  });
});

describe('clearSession', () => {
  it('記録を消す', () => {
    saveSession(record());
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it('記録がなくても例外を投げない', () => {
    expect(() => clearSession()).not.toThrow();
  });
});

describe('壊れたデータへの耐性', () => {
  it('JSONとして壊れていればnullを返す', () => {
    window.localStorage.setItem(STORAGE_KEY, '{ not json');
    expect(loadSession()).toBeNull();
  });

  it('形式が合わなければnullを返す', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
    expect(loadSession()).toBeNull();
  });

  it('selectedIdsが配列でなければnullを返す', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ selectedIds: 'id-1', openedRouteIndexes: [], timestamp: new Date().toISOString() }),
    );
    expect(loadSession()).toBeNull();
  });

  it('timestampが不正な日時文字列でもnullを返す', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ selectedIds: [], openedRouteIndexes: [], timestamp: 'not-a-date' }),
    );
    expect(loadSession()).toBeNull();
  });

  it('localStorageが例外を投げても呼び出し側には伝播しない', () => {
    const original = window.localStorage.getItem;
    try {
      window.localStorage.getItem = () => {
        throw new Error('blocked');
      };
      expect(() => loadSession()).not.toThrow();
      expect(loadSession()).toBeNull();
    } finally {
      window.localStorage.getItem = original;
    }
  });

  it('saveSessionがlocalStorageの例外を飲み込む', () => {
    const original = window.localStorage.setItem;
    try {
      window.localStorage.setItem = () => {
        throw new Error('quota exceeded');
      };
      expect(() => saveSession(record())).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
