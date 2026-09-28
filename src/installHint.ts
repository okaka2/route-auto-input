import type { InstallPlatform } from './platform';

export const INSTALL_HINT_DISMISS_DAYS = 7;

/** タブで開いているときだけ、7日に1回まで案内する。 */
export function shouldShowInstallHint(input: {
  standalone: boolean;
  dismissedAt: string | null;
  now: Date;
}): boolean {
  if (input.standalone) return false;
  if (input.dismissedAt === null) return true;
  return input.now.getTime() - new Date(input.dismissedAt).getTime() >= INSTALL_HINT_DISMISS_DAYS * 86_400_000;
}

export function installSteps(platform: InstallPlatform, options?: { withBackup?: boolean }): string[] {
  const steps = ((): string[] => {
    switch (platform) {
      case 'ios':
        return [
          '画面の下(または上)にある「共有」ボタン(四角から矢印が出ている印)を押します。',
          '出てきた一覧を下にたどり、「ホーム画面に追加」を押します。',
          '右上の「追加」を押します。ホーム画面にアイコンができます。',
        ];
      case 'android':
        return [
          'ブラウザの右上の「⋮」を押します。',
          '「ホーム画面に追加」または「アプリをインストール」を押します。',
          '「追加」を押します。ホーム画面にアイコンができます。',
        ];
      default:
        return [
          'アドレスバーの右端にある「インストール」の印(画面に下向き矢印)を押します。',
          '「インストール」を押します。デスクトップやスタートメニューから開けるようになります。',
        ];
    }
  })();
  // iPhone/iPadはSafariとホーム画面のアプリでデータが別々になるため、追加する前に
  // バックアップを書き出し、追加した後のアプリで読み込み直す案内を前後に足す(iOS以外は無視)。
  if (platform !== 'ios' || !options?.withBackup) {
    return steps;
  }
  return [
    '設定 → バックアップを書き出す(写真も含める)。',
    ...steps,
    '追加したアプリを開いたら、設定の「読み込む」でこのファイルを読み込んでください。',
  ];
}

/**
 * ホーム画面のアプリを開いたら訪問先が0件だった(=Safariのデータが引き継がれていない)ときに、
 * バックアップの読み込みを案内するかどうか。読み込み前(patientsLoadedがfalse)に一瞬0件と
 * 見えるだけの状態では出さない。
 */
export function shouldShowMovedDataHint(input: {
  platform: InstallPlatform;
  standalone: boolean;
  patientsLoaded: boolean;
  patientCount: number;
  dismissed: boolean;
}): boolean {
  return (
    input.platform === 'ios' &&
    input.standalone &&
    input.patientsLoaded &&
    input.patientCount === 0 &&
    !input.dismissed
  );
}
