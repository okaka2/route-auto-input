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

export function installSteps(platform: InstallPlatform): string[] {
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
}
