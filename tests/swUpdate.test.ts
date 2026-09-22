import { describe, expect, it } from 'vitest';
import { registerServiceWorkerUpdates } from '../src/swUpdate';

describe('registerServiceWorkerUpdates', () => {
  it('開発・テスト環境(本番ビルドでない)では何もせず、例外も投げない', () => {
    expect(() => registerServiceWorkerUpdates()).not.toThrow();
  });
});
