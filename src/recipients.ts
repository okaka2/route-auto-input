import type { Patient } from './types';

/**
 * 「山田 太郎様ほか2人」のような、送る相手の説明。0人なら空文字。
 * 送る/受け取りのダイアログの見出し・確認の文で使う。引き継ぎの中身の組み立て・読み取り
 * (transfer.ts)は使うときだけ import() で読み込むので、画面の表示に要るこれだけを分けてある。
 */
export function describeRecipients(patients: readonly Patient[]): string {
  const [firstPatient] = patients;
  if (firstPatient === undefined) {
    return '';
  }
  const first = `${firstPatient.name}様`;
  return patients.length === 1 ? first : `${first}ほか${patients.length - 1}人`;
}
