/**
 * 実行環境の判定(地図を開く挙動の切り替えに使う)。
 */

/** ホーム画面に追加してアプリのように起動しているか(=スタンドアロン表示)。 */
export function isStandaloneDisplay(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return true;
  }
  // iOS Safariは display-mode: standalone を報告しないことがあるため、
  // 昔からある navigator.standalone も見る。
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

const MOBILE_UA_PATTERN = /Android|iPhone|iPad|iPod|Mobile/i;

/** スマートフォン・タブレットなどのモバイル端末か(UAによる簡易判定)。 */
export function isMobileDevice(): boolean {
  return MOBILE_UA_PATTERN.test(window.navigator.userAgent);
}

/**
 * 地図を別タブで開くべきか。
 * PCのブラウザで、アプリ(ホーム画面に追加した状態)を介さずに開いている場合だけtrue。
 * モバイル端末や、ホーム画面に追加したアプリでは、これまで通り同じ画面で遷移させる
 * (Googleマップアプリへの引き継ぎと、session.tsによる復元をそのまま使うため)。
 */
export function shouldOpenMapInNewTab(): boolean {
  return !isStandaloneDisplay() && !isMobileDevice();
}
