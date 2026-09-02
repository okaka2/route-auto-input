/**
 * Googleマップへ遷移して戻ってきたとき(iOSがPWAをメモリから追い出した場合を含む)に
 * 選択・訪問順・開いたルートを復元するための一時記録。`localStorage` に保存する
 * (Ruling 7: `sessionStorage` はページの再読み込みでも失われうるため使わない)。
 *
 * 保存するのは患者id(UUID)・開いたルート番号・タイムスタンプのみ。
 * 氏名・住所は絶対に書き込まない。
 */

export type SessionRecord = {
  /** 訪問順に並んだ、選択中の患者id */
  selectedIds: string[];
  openedRouteIndexes: number[];
  /** ISO 8601 */
  timestamp: string;
};

const STORAGE_KEY = 'route-auto-input:session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.selectedIds) &&
    record.selectedIds.every((id) => typeof id === 'string') &&
    Array.isArray(record.openedRouteIndexes) &&
    record.openedRouteIndexes.every((index) => typeof index === 'number') &&
    typeof record.timestamp === 'string'
  );
}

/** 保存に失敗しても(プライベートブラウズ等で使えない場合も)例外を投げない。 */
export function saveSession(record: SessionRecord): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorageが使えない環境では諦める。復元できないだけで、他の動作には影響しない。
  }
}

export function clearSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 同上。
  }
}

/**
 * 記録を読み込む。次のいずれかに該当すれば `null` を返す:
 * 記録がない、壊れている(形式が合わない)、`now` から12時間より古い。
 * 患者idがまだ存在するかどうかはここでは確認しない
 * (`withPatients` がDB再読み込み時に自動で選択から外すため)。
 */
export function loadSession(now: Date = new Date()): SessionRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isSessionRecord(parsed)) {
      return null;
    }
    const savedAt = new Date(parsed.timestamp).getTime();
    if (Number.isNaN(savedAt) || now.getTime() - savedAt > MAX_AGE_MS) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
