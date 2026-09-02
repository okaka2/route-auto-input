import { MAX_SELECTION } from './config';
import type { Patient } from './types';

export type ValidationResult = { ok: true } | { ok: false; message: string };

export function validatePatientInput(name: string, address: string): ValidationResult {
  if (name.trim().length === 0) {
    return { ok: false, message: '氏名を入力してください。' };
  }
  if (address.trim().length === 0) {
    return { ok: false, message: '住所を入力してください。' };
  }
  return { ok: true };
}

export function validateSelection(count: number): ValidationResult {
  if (count === 0) {
    return { ok: false, message: '患者を1人以上選んでください。' };
  }
  if (count > MAX_SELECTION) {
    return { ok: false, message: `一度に選べるのは${MAX_SELECTION}人までです。` };
  }
  return { ok: true };
}

/** 同じ住所が複数の患者に登録されている場合、その住所を返す。 */
export function findDuplicateAddresses(patients: readonly Patient[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const patient of patients) {
    const address = patient.address.trim();
    if (seen.has(address)) {
      duplicated.add(address);
    } else {
      seen.add(address);
    }
  }
  return [...duplicated];
}
