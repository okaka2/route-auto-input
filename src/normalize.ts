import type { Patient } from './types';

/** 全角の英数字・記号を半角にする(NFKC)。 */
function toHalfWidth(text: string): string {
  return text.normalize('NFKC');
}

/** ハイフンに見える文字を '-' にそろえる(‐ - − ー ― ‑ ‒ – —)。 */
function unifyHyphens(text: string): string {
  return text.replace(/[‐\-−ー―‑‒–—]/g, '-');
}

export function normalizeAddress(address: string): string {
  return unifyHyphens(toHalfWidth(address))
    .replace(/\s+/g, '')
    .replace(/(\d+)丁目(\d+)番(\d+)号?/g, '$1-$2-$3')
    .replace(/(\d+)丁目(\d+)番?/g, '$1-$2')
    .replace(/(\d+)番地?(\d+)号?/g, '$1-$2');
}

export function normalizeName(name: string): string {
  return toHalfWidth(name).replace(/\s+/g, '').replace(/(様|さん|さま)$/u, '');
}

/** 同じ住所または同じ名前の訪問先。書き方の違いは同じとみなす。編集中の自分は除く。 */
export function findSimilar(
  patients: readonly Patient[],
  input: { name: string; address: string },
  excludeId: string | null,
): Patient[] {
  const name = normalizeName(input.name);
  const address = normalizeAddress(input.address);
  return patients.filter(
    (patient) =>
      patient.id !== excludeId &&
      (normalizeName(patient.name) === name || normalizeAddress(patient.address) === address),
  );
}
