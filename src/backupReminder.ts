/** 「9月20日(4日前)」のような、最後のバックアップの表示文。 */
export function formatLastBackup(lastBackupAt: string, now: Date): string {
  const at = new Date(lastBackupAt);
  const days = Math.max(0, Math.floor((startOfDay(now) - startOfDay(at)) / 86_400_000));
  const ago = days === 0 ? '今日' : `${days}日前`;
  return `${at.getMonth() + 1}月${at.getDate()}日(${ago})`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
