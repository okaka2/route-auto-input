import type { Patient } from './types';

export const BACKUP_VERSION = 1;

type BackupFile = {
  version: number;
  exportedAt: string;
  patients: Patient[];
};

const REQUIRED_KEYS = ['id', 'name', 'address', 'createdAt', 'updatedAt'] as const;

export function serializeBackup(patients: readonly Patient[], now: Date = new Date()): string {
  const data: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    patients: [...patients],
  };
  return JSON.stringify(data, null, 2);
}

export function parseBackup(text: string): Patient[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('ファイルを読み取れませんでした。JSON形式ではありません。');
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('バックアップファイルの形式が正しくありません。');
  }

  const record = data as Record<string, unknown>;
  if (record.version !== BACKUP_VERSION) {
    throw new Error('対応していないバージョンのバックアップファイルです。');
  }
  if (!Array.isArray(record.patients)) {
    throw new Error('バックアップファイルの形式が正しくありません。');
  }

  return record.patients.map((item, index) => toPatient(item, index));
}

function toPatient(item: unknown, index: number): Patient {
  if (typeof item !== 'object' || item === null) {
    throw new Error(`${index + 1}件目のデータが壊れています。`);
  }

  const record = item as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    const value = record[key];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`${index + 1}件目のデータに不足している項目があります。`);
    }
  }

  return {
    id: record.id as string,
    name: record.name as string,
    address: record.address as string,
    createdAt: record.createdAt as string,
    updatedAt: record.updatedAt as string,
  };
}
