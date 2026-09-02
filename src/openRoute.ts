/** 生成したGoogleマップURLへ遷移する。Googleマップアプリがあればアプリが開く。 */
export function openUrl(url: string): void {
  window.location.href = url;
}
