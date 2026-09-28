/**
 * サービスワーカーの更新を、開いた人の操作なしで反映する。
 * 新しいバージョンが見つかったら、ページを自動で1回だけ再読み込みする
 * (vite-plugin-pwaのregisterType: 'autoUpdate' の動作。vite.config.tsの
 * injectRegister: false と対になっていて、既定の「ただ登録するだけ」の
 * 自動注入スクリプトの代わりに、こちらで登録する)。
 *
 * ただし、入力中(フォームの画面)・小窓を開いている最中・保存や削除やバックアップの
 * 取り込みが書き込んでいる最中に読み直すと、入力していた内容や進行中の処理を失って
 * しまう。そこで、読み直してよい状況かどうかをReloadGateで判定し、だめなときは
 * 覚えておいて、安全になった(setStateのたび呼ばれるcheck())ときに読み直す(Task 8)。
 */
export type ReloadGate = {
  /** 新しい版が有効になった(onNeedReload)・DBが更新を待っている(blocking)ときに呼ぶ。
   * 読み直してよければすぐ、だめなら覚えておく。 */
  request(): void;
  /** 覚えていて、今は読み直してよければ読み直す。main.tsのsetStateの最後で毎回呼ぶ。 */
  check(): void;
  isPending(): boolean;
};

export function createReloadGate(options: { canReload(): boolean; reload(): void }): ReloadGate {
  let pending = false;
  return {
    request(): void {
      if (options.canReload()) {
        options.reload();
        return;
      }
      pending = true;
    },
    check(): void {
      if (!pending) {
        return;
      }
      if (options.canReload()) {
        pending = false;
        options.reload();
      }
    },
    isPending(): boolean {
      return pending;
    },
  };
}

/**
 * 本番だけ registerSW({ immediate: true, onNeedReload }) を呼ぶ。開発サーバー・テストでは
 * サービスワーカー自体を使わないため、何もしない。
 *
 * onNeedReloadを渡すと、vite-plugin-pwa(registerType: 'autoUpdate')は新しい版が有効になった
 * ときに自分でwindow.location.reload()せず、代わりにonNeedReloadを呼ぶ
 * (node_modules/vite-plugin-pwa/dist/client/build/register.js の auto 分岐を参照)。
 */
export function registerServiceWorkerUpdates(onNeedReload: () => void): void {
  if (!import.meta.env.PROD) {
    return;
  }
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true, onNeedReload });
  });
}
