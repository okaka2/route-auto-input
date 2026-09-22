/**
 * サービスワーカーの更新を、開いた人の操作なしで反映する。
 * 新しいバージョンが見つかったら、ページを自動で1回だけ再読み込みする
 * (vite-plugin-pwaのregisterType: 'autoUpdate' の動作。vite.config.tsの
 * injectRegister: false と対になっていて、既定の「ただ登録するだけ」の
 * 自動注入スクリプトの代わりに、こちらで登録する)。
 *
 * ビルドしたサイト(本番)でだけ実際に登録する。開発サーバー・テストでは
 * サービスワーカー自体を使わないため、何もしない。
 */
export function registerServiceWorkerUpdates(): void {
  if (!import.meta.env.PROD) {
    return;
  }
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}
