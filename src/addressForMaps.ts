/**
 * Google マップの URL を作るときだけ、住所から建物名・部屋番号を外す。
 * 保存する住所・一覧や地図の画面の表示・CSV/バックアップ・引き継ぎでは使わない
 * (これらは patient.address をそのまま使う)。
 *
 * 番地: 半角・全角の数字で始まり、数字と - － ー − ‐ 丁目 番地 番 号 が続く並び。
 * 番地の直前は地名の文字(漢字・かな・カナ)であること(先頭や郵便番号は番地とみなさない)。
 *
 * - 規則1: 番地の直後に空白(半角・全角)があり、その後ろに文字が続く → 空白から後ろを外す。
 *   ただし空白の後ろが番地の続き(数字と - 丁目 番地 番 号 だけで末尾まで埋まる)なら外さない。
 * - 規則2: 番地の直後(空白なし)に、末尾まで [-－ー−‐]?[英数字]+(号室|号棟|棟|階|F|Ｆ) が
 *   続く → その部分を外す。
 * - どちらにも当てはまらなければ、何もしない。
 */

const DIGIT = '[0-9０-９]';
const DASH = '[-－ー−‐]';
const CHIMEI = '[一-鿿぀-ゟ゠-ヿ]';
const KEYWORD = '(?:丁目|番地|番|号)';
const SEP = `(?:${DASH}|${KEYWORD})`;
const NUMSEG = `${DIGIT}+`;
/** 番地本体: 数字で始まり、区切り(ダッシュ類・丁目・番地・番・号)ごとに数字が続いてもよい。 */
const BANCHI = `${NUMSEG}(?:${SEP}(?:${NUMSEG})?)*`;
const SPACE = '[ 　]';
const ALNUM = '[A-Za-z0-9０-９]';
const SUFFIX_WORD = '(?:号室|号棟|棟|階|F|Ｆ)';

const DIGIT_RE = new RegExp(`^${DIGIT}$`);
const CHIMEI_RE = new RegExp(`^${CHIMEI}$`);
const BANCHI_START_RE = new RegExp(`^${BANCHI}`);
const BANCHI_FULL_RE = new RegExp(`^${BANCHI}$`);
const SPACE_START_RE = new RegExp(`^${SPACE}`);
const SPACE_TRIM_RE = new RegExp(`^${SPACE}+`);
const NUMSEG_START_RE = new RegExp(`^${NUMSEG}`);
const UNIT_START_RE = new RegExp(`^${SEP}(?:${NUMSEG})?`);
const RULE2_SUFFIX_RE = new RegExp(`^${DASH}?${ALNUM}+${SUFFIX_WORD}$`);

/**
 * text は数字で始まる(番地の先頭)。番地として区切れる位置を、短い順(数字のみ)から
 * 長い順(区切り文字ごとに1件ずつ足す)へ並べて返す。「1-2-3-405号室」のような、
 * 号室などの部屋番号と紛らわしい形でも、区切り単位を丸ごと戻すことで判定できるようにする
 * (数字の一部だけを戻すと「1-2-3-40」+「5号室」のような誤った分け方になってしまう)。
 */
function banchiSplitPoints(text: string): number[] {
  const first = text.match(NUMSEG_START_RE)!;
  const points = [first[0].length];
  let pos = first[0].length;
  for (;;) {
    const unit = text.slice(pos).match(UNIT_START_RE);
    if (!unit) {
      break;
    }
    pos += unit[0].length;
    points.push(pos);
  }
  return points;
}

/** Googleマップの URL を作るときだけ使う。建物名・部屋番号がはっきり分かるときだけ外し、迷う形はそのまま返す。 */
export function addressForMaps(address: string): string {
  let start = -1;
  for (let i = 1; i < address.length; i++) {
    if (DIGIT_RE.test(address[i]!) && CHIMEI_RE.test(address[i - 1]!)) {
      start = i;
      break;
    }
  }
  if (start === -1) {
    return address; // 番地が無い
  }

  const tail = address.slice(start);
  const greedyMatch = tail.match(BANCHI_START_RE);
  if (!greedyMatch) {
    return address;
  }
  const banchiEnd = start + greedyMatch[0].length;
  const after = address.slice(banchiEnd);

  if (after === '') {
    return address; // 後ろに何も無い
  }

  if (SPACE_START_RE.test(after)) {
    const rest = after.replace(SPACE_TRIM_RE, '');
    if (rest !== '' && BANCHI_FULL_RE.test(rest)) {
      return address; // 空白の後ろが番地の続き
    }
    return address.slice(0, banchiEnd).trim();
  }

  // 規則2: 長い番地から順に試し、末尾まで「部屋番号らしき部分」になる区切りを探す。
  const splitPoints = banchiSplitPoints(tail);
  for (let i = splitPoints.length - 1; i >= 0; i--) {
    const end = splitPoints[i]!;
    const suffix = tail.slice(end);
    if (RULE2_SUFFIX_RE.test(suffix)) {
      return (address.slice(0, start) + tail.slice(0, end)).trim();
    }
  }

  return address; // どちらにも当てはまらない
}
