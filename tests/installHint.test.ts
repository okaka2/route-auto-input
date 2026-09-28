import { describe, expect, it } from 'vitest';
import { installSteps, shouldShowInstallHint, shouldShowMovedDataHint } from '../src/installHint';

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

  it('引数を1つだけ渡す今までの呼び出しは変わらない(3手順)', () => {
    expect(installSteps('ios')).toHaveLength(3);
  });

  it('iOSでwithBackup:trueなら、前後にバックアップの案内が付いて5手順になる', () => {
    const steps = installSteps('ios', { withBackup: true });
    expect(steps).toHaveLength(5);
    expect(steps[0]).toContain('設定 → バックアップを書き出す(写真も含める)');
    expect(steps[4]).toContain('読み込む');
  });

  it('iOS以外はwithBackup:trueでも無視して普段の手順のまま', () => {
    expect(installSteps('android', { withBackup: true })).toHaveLength(installSteps('android').length);
    expect(installSteps('pc', { withBackup: true })).toHaveLength(installSteps('pc').length);
  });
});

describe('shouldShowMovedDataHint', () => {
  const base = {
    platform: 'ios' as const,
    standalone: true,
    patientsLoaded: true,
    patientCount: 0,
    dismissed: false,
  };

  it('iOSのホーム画面アプリで、読み込み済みかつ0件、閉じていなければ出す', () => {
    expect(shouldShowMovedDataHint(base)).toBe(true);
  });

  it('iOS以外なら出さない', () => {
    expect(shouldShowMovedDataHint({ ...base, platform: 'pc' })).toBe(false);
    expect(shouldShowMovedDataHint({ ...base, platform: 'android' })).toBe(false);
  });

  it('ホーム画面のアプリ(standalone)でなければ出さない', () => {
    expect(shouldShowMovedDataHint({ ...base, standalone: false })).toBe(false);
  });

  it('読み込みが終わる前は出さない(一瞬の0件を防ぐ)', () => {
    expect(shouldShowMovedDataHint({ ...base, patientsLoaded: false })).toBe(false);
  });

  it('1件以上あれば出さない', () => {
    expect(shouldShowMovedDataHint({ ...base, patientCount: 1 })).toBe(false);
  });

  it('閉じたあとは出さない', () => {
    expect(shouldShowMovedDataHint({ ...base, dismissed: true })).toBe(false);
  });
});
