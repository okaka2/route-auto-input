import { shouldOpenMapInNewTab } from './platform';

/**
 * 生成したGoogleマップURLを開く。
 * - モバイル端末や、ホーム画面に追加したアプリ(スタンドアロン)では、これまで通り
 *   同じ画面で遷移する(Googleマップアプリがあればアプリが開く。iOSがPWAを
 *   メモリから追い出しても、session.tsの記録から戻ってこれる)。
 * - それ以外(PCのブラウザで、アプリを介さずインターネットで開いている場合)は、
 *   訪問先の一覧を残しておけるよう、別タブで開く。
 */
export function openUrl(url: string): void {
  if (shouldOpenMapInNewTab()) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  window.location.href = url;
}
