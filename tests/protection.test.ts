import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStoragePersisted, requestPersistentStorage } from '../src/protection';

afterEach(() => vi.restoreAllMocks());

function stubStorage(storage: Partial<StorageManager> | undefined) {
  Object.defineProperty(window.navigator, 'storage', { value: storage, configurable: true });
}

describe('requestPersistentStorage', () => {
  it('ブラウザが対応していれば persist() の結果を返す', async () => {
    stubStorage({ persist: vi.fn().mockResolvedValue(true) });
    expect(await requestPersistentStorage()).toBe(true);
  });
  it('対応していなければ false(例外を投げない)', async () => {
    stubStorage(undefined);
    expect(await requestPersistentStorage()).toBe(false);
  });
});

describe('isStoragePersisted', () => {
  it('対応していれば persisted() の結果、していなければ null', async () => {
    stubStorage({ persisted: vi.fn().mockResolvedValue(false) });
    expect(await isStoragePersisted()).toBe(false);
    stubStorage(undefined);
    expect(await isStoragePersisted()).toBeNull();
  });
});
