export const BACKUP_REMIND_DAYS = 30;
export const REMIND_LATER_DAYS = 7;
export const REMIND_MIN_PATIENTS = 5;

const DAY_MS = 86_400_000;

/** 一覧の上に、バックアップのお知らせを出すべきか。 */
export function shouldRemindBackup(input: {
  patientCount: number;
  lastBackupAt: string | null;
  laterAt: string | null;
  now: Date;
}): boolean {
  if (input.laterAt !== null && input.now.getTime() - new Date(input.laterAt).getTime() < REMIND_LATER_DAYS * DAY_MS) {
    return false;
  }
  if (input.lastBackupAt === null) {
    return input.patientCount >= REMIND_MIN_PATIENTS;
  }
  return input.now.getTime() - new Date(input.lastBackupAt).getTime() >= BACKUP_REMIND_DAYS * DAY_MS;
}

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
