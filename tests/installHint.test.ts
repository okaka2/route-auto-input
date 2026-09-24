import { describe, expect, it } from 'vitest';
import { installSteps, shouldShowInstallHint } from '../src/installHint';

const now = new Date('2026-09-24T09:00:00');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe('shouldShowInstallHint', () => {
  it('ホーム画面から開いていれば出さない', () => {
    expect(shouldShowInstallHint({ standalone: true, dismissedAt: null, now })).toBe(false);
  });
  it('タブで開いていて、閉じたことが無ければ出す', () => {
    expect(shouldShowInstallHint({ standalone: false, dismissedAt: null, now })).toBe(true);
  });
  it('閉じてから7日間は出さず、7日たてばまた出す', () => {
    expect(shouldShowInstallHint({ standalone: false, dismissedAt: daysAgo(6), now })).toBe(false);
    expect(shouldShowInstallHint({ standalone: false, dismissedAt: daysAgo(7), now })).toBe(true);
  });
});

describe('installSteps', () => {
  it('iPhone は共有ボタンからの手順、PC はアドレスバーのインストール', () => {
    expect(installSteps('ios').join('')).toContain('共有');
    expect(installSteps('ios').join('')).toContain('ホーム画面に追加');
    expect(installSteps('pc').join('')).toContain('インストール');
    expect(installSteps('android').join('')).toContain('ホーム画面に追加');
  });
});
