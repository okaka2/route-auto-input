import { describe, expect, it, vi } from 'vitest';
import { createReloadGate, registerServiceWorkerUpdates } from '../src/swUpdate';

describe('createReloadGate', () => {
  it('canReloadが真なら、requestですぐreloadする(待つものはない)', () => {
    const reload = vi.fn();
    const gate = createReloadGate({ canReload: () => true, reload });
    gate.request();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(gate.isPending()).toBe(false);
  });

  it('canReloadが偽なら、requestしてもreloadを呼ばず、覚えておく(isPendingが真になる)', () => {
    const reload = vi.fn();
    const gate = createReloadGate({ canReload: () => false, reload });
    gate.request();
    expect(reload).not.toHaveBeenCalled();
    expect(gate.isPending()).toBe(true);
  });

  it('待っている間にcanReloadが真になれば、checkで1回だけreloadする(もう一度checkしても呼ばない)', () => {
    const reload = vi.fn();
    let canReload = false;
    const gate = createReloadGate({ canReload: () => canReload, reload });
    gate.request();
    expect(reload).not.toHaveBeenCalled();
    canReload = true;
    gate.check();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(gate.isPending()).toBe(false);
    gate.check();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('requestより前のcheckは何もしない(まだ待っていないので)', () => {
    const reload = vi.fn();
    const gate = createReloadGate({ canReload: () => true, reload });
    gate.check();
    expect(reload).not.toHaveBeenCalled();
    expect(gate.isPending()).toBe(false);
  });
});

describe('registerServiceWorkerUpdates', () => {
  it('開発・テスト環境(本番ビルドでない)では何もせず、例外も投げない', () => {
    expect(() => registerServiceWorkerUpdates(() => {})).not.toThrow();
  });
});
