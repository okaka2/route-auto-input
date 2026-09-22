/**
 * 日時(ISO 8601)を「月/日 時:分」の形にする。端末のローカル時刻で表示する。
 * 空文字や読めない日時のときは、表示するものがないので空文字を返す(例外は投げない)。
 */
export function formatDateTime(iso: string): string {
  if (iso === '') {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${minutes}`;
}
