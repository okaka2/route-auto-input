import type { Parking, ParkingType, Patient } from './types';

export const PARKING_OPTIONS: { value: ParkingType | ''; label: string }[] = [
  { value: '', label: '未設定' },
  { value: 'onsite', label: '敷地内OK' },
  { value: 'coin', label: 'コインパーキング' },
  { value: 'street_permit', label: '路上(許可証あり)' },
  { value: 'management_ok', label: '管理会社に許可済み' },
  { value: 'unknown', label: '不明' },
];

const PARKING_BADGES: Record<ParkingType, { icon: 'P' | '許'; text: string } | null> = {
  onsite: { icon: 'P', text: '敷地内OK' },
  coin: { icon: 'P', text: 'コインP' },
  street_permit: { icon: '許', text: '路上・許可証' },
  management_ok: { icon: 'P', text: '管理会社OK' },
  unknown: null,
};

/** ルートのカードに出す短い表示。未設定・不明なら null。 */
export function parkingBadge(parking: Parking | undefined): { icon: 'P' | '許'; text: string } | null {
  if (!parking) {
    return null;
  }
  return PARKING_BADGES[parking.type] ?? null;
}

/** 'YYYY-MM-DD' の形かどうか(許可証の期限の欄で、backup.ts と patient.ts が共有するチェック)。 */
export function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export const NOTE_HEADINGS = ['駐車場', '入口', 'インターホン', '鍵', '注意'] as const;

// noteSummary で優先する見出し。「駐車場」「入口」の順で、あればその行を使う。
const PRIORITY_HEADINGS = ['駐車場', '入口'];

/** メモの1行目の要約。「駐車場」「入口」で始まる行を優先、なければ最初の空でない行。空なら ''。 */
export function noteSummary(note: string | undefined): string {
  if (!note) {
    return '';
  }
  const lines = note
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) {
    return '';
  }
  for (const heading of PRIORITY_HEADINGS) {
    const found = lines.find((line) => line.startsWith(heading));
    if (found) {
      return found;
    }
  }
  return lines[0]!;
}

export const PERMIT_NOTICE_DAYS = 30;

/** 期限が今日から30日以内(過ぎたものを含む)の許可証を持つ訪問先の数。 */
export function permitsExpiringSoon(patients: readonly Patient[], now: Date): number {
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate() + PERMIT_NOTICE_DAYS).getTime();
  return patients.filter((patient) => {
    const parking = patient.parking;
    if (!parking || parking.type !== 'street_permit' || !parking.permitExpires) {
      return false;
    }
    const expires = new Date(`${parking.permitExpires}T00:00:00`).getTime();
    return expires <= limit;
  }).length;
}
