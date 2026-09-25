# 段階3: 位置の登録・駐車情報とメモと写真・お役立ち地点・バックアップv2 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 訪問先ごとの「位置(駐車場所)」「駐車情報」「メモ」「写真」と、事業所で共有できる「お役立ち地点」を基本版に入れ、バックアップを v2(写真・地点・設定を含む)にして、公開して実機で試運転できる状態にする。

**Architecture:** 計算は純粋な小さなモジュールに置く(`geoPoint.ts`: 座標の読み取り・距離・地図に渡す地点、`visitInfo.ts`: 駐車の表示・メモの要約・許可証の期限、`backup.ts`: v2 の形)。ブラウザ依存は薄い層に閉じ込め、テストでは差し替える(`geo.ts`: 位置の測定、`imageResize.ts`: 写真の縮小、`photoCodec.ts`: Blob⇔data URL)。重い処理(`geo.ts`・`imageResize.ts`)は `import()` で使うときだけ読み込む。保存は DB v4 で `photos`・`spots` ストアを足す。

**Tech Stack:** Vite + TypeScript(フレームワークなし)、IndexedDB(`idb`)、Vitest + jsdom + fake-indexeddb。

**Spec:** `docs/superpowers/specs/2026-09-24-brushup-design.md` の 5章・7章・8章(段階1・2は main に取り込み済み)。

## Global Constraints

- データは端末の中だけ。位置・写真・メモはサーバーへ送らない。地図(Googleマップ)に渡すのは「位置があれば `緯度,経度`、なければ住所」だけ(名前・メモ・写真は渡さない)。LINE共有も同じ。
- 画面の文言に禁止語(`tests/wording.test.ts` の `FORBIDDEN`: 患者・薬局・在宅・医療・利用者・ルート自動入力)を使わない。
- 文字は 14px 以上、タップ領域は 44px(`--tap-min`)以上。色は `styles.css` の変数だけ(新しい16進数の色を足さない)。明るい/暗いの両方で読めること。
- 既存データの互換: `Patient` の新しい項目はすべて任意(無ければ持たない)。DB は v3→v4 で既存のストアを壊さない。バックアップ v1 のファイルも読める。
- TDD: テスト → 失敗の確認 → 実装 → 成功の確認 → コミット。コミットは `git -c user.name=okaka2 -c user.email=okaka2@users.noreply.github.com commit` で、末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。push は利用者の確認を得てから。
- コマンドはリポジトリ `C:\Users\owner\Desktop\route-auto-input` で実行。`npm test`、`npx vitest run tests/<name>.test.ts`、`npm run typecheck`。各タスクの終わりに両方が通ること。テストに固定の待ち時間(`setTimeout` での sleep)を使わない(`vi.waitFor` で観測できる結果を待つ)。
- `src/` にテスト専用の分岐やフラグを入れない(段階2の最終レビューの方針)。
- ビルドの JS は目安 120KB(gzip 前)以内。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/types.ts` | `GeoLocation`、`Parking`、`Patient.location/parking/note`、`Dialog` の追加、`Spot`。**Task 1, 3, 5, 6** |
| `src/geoPoint.ts` (新規) | 座標の貼り付けの読み取り、2点間の距離、地図に渡す地点、精度の判定。**Task 1** |
| `src/routePlan.ts`、`src/share.ts`、`src/main.ts` | 地図に渡す地点を `pointOf` に。**Task 1** |
| `src/geo.ts` (新規) | `watchPosition` で最長10秒測り、一番よい値を返す(Geolocation を引数で受ける)。**Task 2** |
| `src/views/locationDialog.ts` (新規) | 位置の登録のダイアログ(測定・貼り付け・登録後の確認と元に戻す)。**Task 3** |
| `src/views/dialogs.ts` | `location` と `photos` の分岐、「⋯」に位置の項目。**Task 3, 5** |
| `src/views/patientListView.ts`、`routeMapView.ts` | 「位置 未登録」、ピンのボタン、駐車・メモ・写真の表示、近くのお役立ち地点。**Task 3, 4, 5, 6** |
| `src/visitInfo.ts` (新規) | 駐車の表示文、メモの要約、許可証の期限の判定。**Task 4** |
| `src/patient.ts` | `withVisitInfo`、`withLocation`。**Task 3, 4** |
| `src/views/patientFormView.ts` | 「訪問のための情報」(駐車・許可証の期限・メモの見出しボタン・写真)。**Task 4, 5** |
| `src/db.ts` | DB v4(`photos`・`spots`)、写真と地点の読み書き。**Task 5** |
| `src/imageResize.ts` (新規) | 長辺 1280px・JPEG 0.8 に縮小(Canvas を引数で受ける)。**Task 5** |
| `src/photoCodec.ts` (新規) | Blob ⇔ data URL。**Task 7** |
| `src/views/settingsView.ts` | お役立ち地点の一覧と削除、「写真も含める(約○MB)」。**Task 6, 7** |
| `src/backup.ts` | v2 の書き出しと、v1/v2 の読み込み。**Task 7** |
| `src/main.ts` | 配線。各タスク。 |

---

### Task 1: 位置の型と、座標の読み取り・距離・地図に渡す地点

**Files:**
- Modify: `src/types.ts`
- Create: `src/geoPoint.ts`、`tests/geoPoint.test.ts`
- Modify: `src/routePlan.ts`、`tests/routePlan.test.ts`、`src/share.ts`、`tests/share.test.ts`、`src/main.ts`(`confirmedShareText`)、`tests/main.test.ts`

**Interfaces:**
- Produces(`types.ts`):
```ts
export type GeoLocation = { lat: number; lng: number; accuracy: number | null; recordedAt: string; source: 'gps' | 'paste' };
export type ParkingType = 'onsite' | 'coin' | 'street_permit' | 'management_ok' | 'unknown';
export type Parking = { type: ParkingType; permitExpires?: string /* YYYY-MM-DD */ };
// Patient に追加(すべて任意):
//   location?: GeoLocation; parking?: Parking; note?: string;
```
- Produces(`geoPoint.ts`):
```ts
export const GOOD_ACCURACY_M = 20;
export const POOR_ACCURACY_M = 50;
/** 「35.68, 139.76」、Googleマップの長いURL(@lat,lng / !3dlat!4dlng / q= または query=lat,lng)から座標を読む。読めなければ null。短いURL(maps.app.goo.gl / goo.gl/maps)は null。 */
export function parseLocationText(text: string): { lat: number; lng: number } | null;
export function isShortMapsUrl(text: string): boolean;
/** 2点間の距離(メートル、ハバースイン)。 */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number;
/** 地図に渡す地点。位置があれば '35.681240,139.767120'(小数6桁)、なければ住所。 */
export function pointOf(stop: { address: string; location?: { lat: number; lng: number } }): string;
/** 'good'(20m以内)/ 'fair' / 'poor'(50m以上)。 */
export function accuracyLevel(accuracy: number): 'good' | 'fair' | 'poor';
```
- Changes: `buildRoutePlans` の `T extends { address: string; location?: { lat: number; lng: number } }` にし、`addresses` を `pointOf(stop)` で作る(事業所は今までどおり住所)。`buildShareText(points, …)` は引数名を `points` にするだけ(中身は同じ)。`main.ts` の `confirmedShareText` は `selectedPatients(state).map(pointOf)` を渡し、確認の文を「訪問先の住所または位置(N件)が、送った相手と…名前は含まれません。共有しますか?」にする。

- [ ] **Step 1: テストを書く** — `tests/geoPoint.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { accuracyLevel, distanceMeters, isShortMapsUrl, parseLocationText, pointOf } from '../src/geoPoint';

describe('parseLocationText', () => {
  it.each([
    ['35.681240, 139.767120', { lat: 35.68124, lng: 139.76712 }],
    ['35.68124,139.76712', { lat: 35.68124, lng: 139.76712 }],
    [' 35.68124 , 139.76712 ', { lat: 35.68124, lng: 139.76712 }],
    ['https://www.google.com/maps/place/Tokyo/@35.6812405,139.7671248,17z/data=!3m1', { lat: 35.6812405, lng: 139.7671248 }],
    ['https://www.google.com/maps/place/X/data=!4m6!3m5!1s0x0:0x0!8m2!3d35.681!4d139.767', { lat: 35.681, lng: 139.767 }],
    ['https://www.google.com/maps?q=35.1,136.9', { lat: 35.1, lng: 136.9 }],
    ['https://www.google.com/maps/search/?api=1&query=35.1%2C136.9', { lat: 35.1, lng: 136.9 }],
  ])('%s', (text, expected) => {
    expect(parseLocationText(text)).toEqual(expected);
  });
  it('!3d!4d があれば @ より優先する(建物の位置のほうが正確)', () => {
    expect(parseLocationText('https://www.google.com/maps/place/X/@35.0,139.0,17z/data=!3d35.5!4d139.5')).toEqual({ lat: 35.5, lng: 139.5 });
  });
  it.each(['東京都千代田区', 'https://maps.app.goo.gl/AbCd', '999, 999', '', '35.1'])('読めない: %s', (text) => {
    expect(parseLocationText(text)).toBeNull();
  });
  it('短いURLを見分ける', () => {
    expect(isShortMapsUrl('https://maps.app.goo.gl/AbCd')).toBe(true);
    expect(isShortMapsUrl('https://goo.gl/maps/AbCd')).toBe(true);
    expect(isShortMapsUrl('https://www.google.com/maps/@35,139,17z')).toBe(false);
  });
});

describe('distanceMeters', () => {
  it('同じ点は0、東京駅〜有楽町駅はおよそ800m', () => {
    const tokyo = { lat: 35.681236, lng: 139.767125 };
    expect(distanceMeters(tokyo, tokyo)).toBe(0);
    const d = distanceMeters(tokyo, { lat: 35.675069, lng: 139.763328 });
    expect(d).toBeGreaterThan(700);
    expect(d).toBeLessThan(900);
  });
});

describe('pointOf', () => {
  it('位置があれば小数6桁の座標、なければ住所', () => {
    expect(pointOf({ address: '東京都1', location: { lat: 35.6812405, lng: 139.7671248 } })).toBe('35.681241,139.767125');
    expect(pointOf({ address: '東京都1' })).toBe('東京都1');
  });
});

describe('accuracyLevel', () => {
  it('20m以内は good、50m以上は poor、その間は fair', () => {
    expect(accuracyLevel(20)).toBe('good');
    expect(accuracyLevel(35)).toBe('fair');
    expect(accuracyLevel(50)).toBe('poor');
  });
});
```
`tests/routePlan.test.ts` に:
```ts
it('位置のある訪問先は座標で、ない訪問先は住所で地図に渡す', () => {
  const stops = [
    { id: 'a', address: '住所1', location: { lat: 35.1, lng: 139.1 } },
    { id: 'b', address: '住所2' },
  ];
  const [plan] = buildRoutePlans(stops, { start: 'first', end: 'last' }, null, 10);
  expect(plan!.addresses).toEqual(['35.100000,139.100000', '住所2']);
});
```
`tests/main.test.ts` の共有の確認文を検査しているテストがあれば「住所または位置」に合わせる。

- [ ] **Step 2: 失敗を確認** — `npx vitest run tests/geoPoint.test.ts tests/routePlan.test.ts` → FAIL

- [ ] **Step 3: 実装** — `src/geoPoint.ts`:
```ts
export const GOOD_ACCURACY_M = 20;
export const POOR_ACCURACY_M = 50;

type LatLng = { lat: number; lng: number };

function valid(lat: number, lng: number): LatLng | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

export function isShortMapsUrl(text: string): boolean {
  return /(^|\/\/)(maps\.app\.goo\.gl|goo\.gl\/maps)\//.test(text.trim());
}

export function parseLocationText(text: string): LatLng | null {
  const raw = text.trim();
  if (raw === '' || isShortMapsUrl(raw)) return null;
  let decoded = raw;
  try { decoded = decodeURIComponent(raw); } catch { /* そのまま使う */ }
  const patterns = [
    new RegExp(`!3d${NUM}!4d${NUM}`),
    new RegExp(`@${NUM},${NUM}`),
    new RegExp(`[?&](?:q|query)=${NUM},\\s*${NUM}`),
    new RegExp(`^${NUM}\\s*,\\s*${NUM}$`),
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match) return valid(Number(match[1]), Number(match[2]));
  }
  return null;
}

export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pointOf(stop: { address: string; location?: LatLng }): string {
  return stop.location ? `${stop.location.lat.toFixed(6)},${stop.location.lng.toFixed(6)}` : stop.address;
}

export function accuracyLevel(accuracy: number): 'good' | 'fair' | 'poor' {
  if (accuracy <= GOOD_ACCURACY_M) return 'good';
  if (accuracy >= POOR_ACCURACY_M) return 'poor';
  return 'fair';
}
```
`types.ts` に型を足す。`routePlan.ts` の型制約と `addresses` を `pointOf` に。`share.ts` の引数名。`main.ts` の `confirmedShareText`。

- [ ] **Step 4: テスト・型検査** — `npm test && npm run typecheck` → PASS

- [ ] **Step 5: コミット** — `feat: 位置の型と座標の読み取りを足し、位置があれば座標で地図を開く`

---

### Task 2: 位置の測定(watchPosition で最長10秒、一番よい値)

**Files:**
- Create: `src/geo.ts`、`tests/geo.test.ts`

**Interfaces:**
- Produces:
```ts
export type Reading = { lat: number; lng: number; accuracy: number };
export type MeasureUpdate =
  | { kind: 'reading'; best: Reading }          // より良い値が来るたび
  | { kind: 'done'; best: Reading | null }      // 10秒たった / 20m 以内になった
  | { kind: 'error'; message: string };
export const MEASURE_TIMEOUT_MS = 10_000;
/** 測り始める。戻り値の関数で止める。geolocation が無ければすぐ error。 */
export function startMeasuring(
  geolocation: Geolocation | undefined,
  onUpdate: (update: MeasureUpdate) => void,
  timers: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout } = { setTimeout, clearTimeout },
): () => void;
```
- 決まり: `watchPosition(success, error, { enableHighAccuracy: true, maximumAge: 0, timeout: MEASURE_TIMEOUT_MS })`。精度が前より良いときだけ `reading` を出す。精度が `GOOD_ACCURACY_M` 以下になったら `done`(止める)。10秒で `done`(止める)。エラー: `PERMISSION_DENIED`(1)→「位置情報の使用が許可されていません。端末やブラウザの設定で、このサイトの位置情報を許可してください。」、それ以外 →「位置を取得できませんでした。車の外や屋外で、もう一度試してください。」。geolocation が無い →「この端末では位置情報を使えません。」。止めた後は何も出さない(`clearWatch` と `clearTimeout`)。

- [ ] **Step 1: テスト** — `tests/geo.test.ts`(Geolocation は偽物、タイマーは `vi.useFakeTimers()`):
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEASURE_TIMEOUT_MS, startMeasuring, type MeasureUpdate } from '../src/geo';

function fakeGeo() {
  let success: PositionCallback = () => {};
  let failure: PositionErrorCallback | null | undefined;
  const geo = {
    watchPosition: vi.fn((s: PositionCallback, e?: PositionErrorCallback | null) => { success = s; failure = e; return 7; }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  } as unknown as Geolocation;
  const emit = (lat: number, lng: number, accuracy: number) =>
    success({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition);
  const fail = (code: number) => failure?.({ code, PERMISSION_DENIED: 1 } as GeolocationPositionError);
  return { geo, emit, fail };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startMeasuring', () => {
  it('良くなったときだけ reading を出し、20m 以内で done にして止める', () => {
    const { geo, emit } = fakeGeo();
    const updates: MeasureUpdate[] = [];
    startMeasuring(geo, (u) => updates.push(u));
    emit(35, 139, 60);
    emit(35, 139, 80);
    emit(35.1, 139.1, 15);
    expect(updates.map((u) => u.kind)).toEqual(['reading', 'reading', 'done']);
    expect(updates.at(-1)).toEqual({ kind: 'done', best: { lat: 35.1, lng: 139.1, accuracy: 15 } });
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
  });
  it('10秒たったら、その時点の一番よい値で done', () => {
    const { geo, emit } = fakeGeo();
    const updates: MeasureUpdate[] = [];
    startMeasuring(geo, (u) => updates.push(u));
    emit(35, 139, 40);
    vi.advanceTimersByTime(MEASURE_TIMEOUT_MS);
    expect(updates.at(-1)).toEqual({ kind: 'done', best: { lat: 35, lng: 139, accuracy: 40 } });
  });
  it('許可されていなければ、設定を促す error', () => {
    const { geo, fail } = fakeGeo();
    const updates: MeasureUpdate[] = [];
    startMeasuring(geo, (u) => updates.push(u));
    fail(1);
    expect(updates).toEqual([{ kind: 'error', message: expect.stringContaining('許可') }]);
  });
  it('geolocation が無ければすぐ error', () => {
    const updates: MeasureUpdate[] = [];
    startMeasuring(undefined, (u) => updates.push(u));
    expect(updates[0]).toEqual({ kind: 'error', message: 'この端末では位置情報を使えません。' });
  });
  it('止めた後は何も出さない', () => {
    const { geo, emit } = fakeGeo();
    const updates: MeasureUpdate[] = [];
    const stop = startMeasuring(geo, (u) => updates.push(u));
    stop();
    emit(35, 139, 10);
    vi.advanceTimersByTime(MEASURE_TIMEOUT_MS);
    expect(updates).toEqual([]);
  });
});
```

- [ ] **Step 2: 失敗を確認** — `npx vitest run tests/geo.test.ts` → FAIL
- [ ] **Step 3: 実装** — 上の決まりどおり `src/geo.ts` を書く(`GOOD_ACCURACY_M` は `geoPoint.ts` から import)。
- [ ] **Step 4: テスト・型検査** — PASS
- [ ] **Step 5: コミット** — `feat: 位置を最長10秒測り、一番よい値を使う仕組みを足す`

---

### Task 3: 位置の登録のダイアログと入口、未登録の表示

**Files:**
- Modify: `src/types.ts`(`Dialog` に `location`)、`src/state.ts`(`keepDialog`)
- Create: `src/views/locationDialog.ts`、`tests/locationDialog.test.ts`
- Modify: `src/views/dialogs.ts`、`tests/dialogs.test.ts`
- Modify: `src/patient.ts`(`withLocation`)、`tests/patient.test.ts`
- Modify: `src/views/patientListView.ts`、`src/views/routeMapView.ts`、それぞれのテスト
- Modify: `src/main.ts`、`tests/main.test.ts`、`tests/wording.test.ts`、`src/styles.css`

**Interfaces:**
- Produces:
```ts
// types.ts
export type LocationDialog = {
  kind: 'location';
  id: string;                       // 訪問先
  phase: 'idle' | 'measuring' | 'measured' | 'saved' | 'error';
  best: { lat: number; lng: number; accuracy: number } | null;
  error: string | null;
  pasteText: string;
  pasteError: string | null;
  previous: GeoLocation | null;     // 元に戻す用(saved のとき)
};
// Dialog に | LocationDialog を足す

// patient.ts
export function withLocation(patient: Patient, location: GeoLocation | null, now?: Date): Patient; // null で location を外す。updatedAt を更新

// views/locationDialog.ts
export type LocationDialogHandlers = {
  onStartMeasuring(): void;
  onSaveMeasured(): void;
  onPasteChange(text: string): void;
  onSavePasted(): void;
  onRemove(): void;       // 登録済みのとき「位置を消す」
  onUndo(): void;         // saved のとき
  onClose(): void;
};
export function renderLocationDialog(patient: Patient, dialog: LocationDialog, handlers: LocationDialogHandlers): HTMLElement[];
```
- 画面(`renderLocationDialog`)の中身:
  - 見出し「${name}の位置」。登録済みなら「登録済み: 誤差 ±Nm(9/22 登録)」と `location-check-link`「地図で確かめる」(`buildGoogleMapsUrl([pointOf(patient)])`、新しいタブ)。
  - `phase: 'idle'`: `location-measure-button`「今いる場所で登録」(primary)。注意書き「停車してから押してください。車の外や屋外のほうが正確です。」
  - `phase: 'measuring'`: 「位置を取得しています… 誤差 ±Nm」(best が無ければ「位置を取得しています…」)。`location-save-button`「この位置で登録」は best があれば押せる。精度 good なら「登録できます」、poor なら「車の外や屋外で、もう一度試してください。」
  - `phase: 'measured'`: 測り終わった状態。文言は measuring と同じ規則で、`location-save-button` と `location-measure-button`「もう一度測る」。
  - `phase: 'error'`: `error` を赤で表示し、`location-measure-button`「もう一度測る」。
  - `phase: 'saved'`: 「登録しました(誤差 ±Nm)」、`location-check-link`、`location-undo-button`「元に戻す」、`dialog-cancel`「閉じる」。
  - `saved` 以外: 折りたたみ `<details>` 「座標やURLを貼り付けて登録」に `location-paste-input`(値は `dialog.pasteText`、入力のたび `onPasteChange`)、`location-paste-save`「貼り付けた位置で登録」、`pasteError` があれば表示。
  - 登録済みで `saved` 以外なら `location-remove-button`「位置を消す」(danger)。最後に `dialog-cancel`「閉じる」。
- 入口:
  - 一覧の「⋯」(`renderMenu`)に `dialog-location`: 未登録なら「位置を登録」、登録済みなら「位置を確かめる・やり直す」。`DialogHandlers.onOpenLocation(id)`。
  - 地図のカードの訪問先の行: 位置が無いときだけ `location-pin`(aria-label `${name}の位置を登録`、`📍` ではなく文字「位置」を 44px ボタンで)→ `RouteMapHandlers.onOpenLocation(id)`。
- 未登録の表示:
  - 一覧の行: 位置が無いとき `place-address` の下に `<span class="place-tag" data-testid="no-location">位置 未登録</span>`。
  - 地図のカード: その本の訪問先に位置の無い人が1人以上いれば `route-missing-location`「位置が未登録: N件」。
- `main.ts`:
  - `let stopMeasuring: (() => void) | null = null;`
  - `openLocation(id)`: `setState({ ...state, dialog: { kind: 'location', id, phase: 'idle', best: null, error: null, pasteText: '', pasteError: null, previous: null } })`。
  - `startLocationMeasure()`: 既存の測定を止め、`const { startMeasuring } = await import('./geo');` で読み込み、`navigator.geolocation` を渡す。更新のたび、`state.dialog` がまだ同じ id の `location` なら `phase`/`best`/`error` を書き換えて `setState`。`done` で best が null なら error「位置を取得できませんでした。車の外や屋外で、もう一度試してください。」。
  - `saveLocation(location: GeoLocation)`: 対象の訪問先を `withLocation` で保存(`savePatient`)、`reloadPatients()`、ダイアログを `phase: 'saved', previous: 元の location ?? null` に。`openedRoutes.clear()`。
  - 測定の保存は `{ ...best, accuracy: best.accuracy, recordedAt: now, source: 'gps' }`、貼り付けは `parseLocationText` → null なら `pasteError`(短いURLなら「短いURLは読めません。Googleマップで地点を長押しして、出てきた座標をコピーして貼り付けてください。」、それ以外「座標またはGoogleマップのURLを読み取れませんでした。」)、読めたら `{ lat, lng, accuracy: null, recordedAt, source: 'paste' }`。
  - `undoLocation()`: `previous` に戻す(null なら外す)して保存、ダイアログを閉じる。`removeLocation()`: `window.confirm('この訪問先の位置を消しますか?')` のあと外して保存、閉じる。
  - ダイアログを閉じる(`closeAnyDialog`・Escape・画面遷移)とき、必ず `stopMeasuring?.()`。`render()` のフォーカス復帰は既存のままでよい(入力欄は testid で復帰する)。
- `keepDialog`: `location` は id-bearing(`existingIds.has(dialog.id)`)の分岐に入る。
- CSS: `.place-tag { display: inline-block; margin-top: 0.125rem; padding: 0 0.5rem; border: 1px solid var(--border-strong); border-radius: 999px; color: var(--muted); font-size: 0.875rem; } .location-pin { min-height: var(--tap-min); padding: 0 0.75rem; } .location-status { margin: 0 0 0.75rem; font-weight: 600; } .location-status.good { color: var(--success); } .location-status.poor { color: var(--danger); } .location-paste { margin: 0.75rem 0; } .location-paste summary { min-height: var(--tap-min); display: flex; align-items: center; color: var(--primary); cursor: pointer; }`。

- [ ] **Step 1: テスト** — `tests/locationDialog.test.ts` で各 phase の表示とボタン(上の testid・文言)を検査。例:
```ts
it('measuring: 誤差を出し、20m以内なら「登録できます」、保存ボタンが押せる', () => {
  const el = wrap(renderLocationDialog(patient(), dialog({ phase: 'measuring', best: { lat: 35, lng: 139, accuracy: 12 } }), handlers()));
  expect(el.textContent).toContain('誤差 ±12m');
  expect(el.textContent).toContain('登録できます');
  expect(q<HTMLButtonElement>(el, 'location-save-button').disabled).toBe(false);
});
it('measuring: 50m以上なら屋外でやり直す案内', () => { /* accuracy 60 → 「車の外や屋外で、もう一度試してください。」 */ });
it('saved: 地図で確かめる・元に戻す・閉じる', () => { /* location-check-link の href に api=1&query=35.000000,139.000000 */ });
it('貼り付け欄は入力のたび onPasteChange、エラーを出す', () => { /* input イベント → onPasteChange('35,139'); pasteError を表示 */ });
it('登録済みなら「位置を消す」と登録日・誤差を出す', () => { /* location-remove-button */ });
```
(`wrap` は返った要素を1つの div に入れるヘルパー。`patient()` / `dialog()` / `handlers()` はテスト内で作る。)
`tests/patient.test.ts`: `withLocation` で付く・外れる・`updatedAt` が変わる・他の項目(phone など)を保つ。`tests/dialogs.test.ts`: 「⋯」に `dialog-location` があり、未登録/登録済みで文言が変わり、押すと `onOpenLocation(id)`。`location` ダイアログが `renderDialog` から描かれる。`tests/patientListView.test.ts`: 位置の無い行に `no-location`、ある行に無い。`tests/routeMapView.test.ts`: `location-pin` は位置の無い行だけ、押すと `onOpenLocation(id)`、`route-missing-location` の件数。`tests/main.test.ts`(結合): `navigator.geolocation` を偽物に差し替え(`Object.defineProperty(navigator, 'geolocation', { value: fake, configurable: true })`)、1件登録 → 「⋯」→ 位置を登録 → 今いる場所で登録 → 偽物から精度15mを出す → 自動で `measured`(done)→ 保存 → DB の訪問先に `location.source === 'gps'` → 「元に戻す」で location が消える。貼り付けの結合テストも1つ(`35.1, 139.1` → `source: 'paste'`)。`tests/wording.test.ts` に位置のダイアログの全 phase を足す。
- [ ] **Step 2: 失敗を確認**
- [ ] **Step 3: 実装**(上の Interfaces どおり)
- [ ] **Step 4: `npm test && npm run typecheck`**
- [ ] **Step 5: コミット** — `feat: 今いる場所や座標の貼り付けで訪問先の位置を登録できるようにする`

---

### Task 4: 駐車情報とメモ(登録・表示・許可証の期限のお知らせ)

**Files:**
- Create: `src/visitInfo.ts`、`tests/visitInfo.test.ts`
- Modify: `src/patient.ts`(`withVisitInfo`)、`src/backup.ts`(`parking`・`note` を読む)、`src/views/patientFormView.ts`、`src/views/routeMapView.ts`、`src/main.ts`、`src/types.ts`(`Dialog` の `similar.input` の型)、各テスト、`src/styles.css`

**Interfaces:**
- Produces(`visitInfo.ts`):
```ts
export const PARKING_OPTIONS: { value: ParkingType | ''; label: string }[] = [
  { value: '', label: '未設定' },
  { value: 'onsite', label: '敷地内OK' },
  { value: 'coin', label: 'コインパーキング' },
  { value: 'street_permit', label: '路上(許可証あり)' },
  { value: 'management_ok', label: '管理会社に許可済み' },
  { value: 'unknown', label: '不明' },
];
/** ルートのカードに出す短い表示。未設定・不明なら null。 */
export function parkingBadge(parking: Parking | undefined): { icon: 'P' | '許'; text: string } | null;
// onsite → { icon:'P', text:'敷地内OK' } / coin → { 'P', 'コインP' } / street_permit → { '許', '路上・許可証' } / management_ok → { 'P', '管理会社OK' }
export const NOTE_HEADINGS = ['駐車場', '入口', 'インターホン', '鍵', '注意'] as const;
/** メモの1行目の要約。「駐車場」「入口」で始まる行を優先、なければ最初の空でない行。空なら ''。 */
export function noteSummary(note: string | undefined): string;
export const PERMIT_NOTICE_DAYS = 30;
/** 期限が今日から30日以内(過ぎたものを含む)の許可証を持つ訪問先の数。 */
export function permitsExpiringSoon(patients: readonly Patient[], now: Date): number;
```
- Produces(`patient.ts`): `withVisitInfo(patient, info: { parkingType: ParkingType | ''; permitExpires: string; note: string }): Patient` — `parkingType` が '' なら `parking` を外す。'street_permit' 以外なら `permitExpires` を持たない。`note` は trim して空なら外す。
- フォーム: `PatientFormDraft` と `FormInput` を `{ name; address; phone; parkingType: ParkingType | ''; permitExpires: string; note: string }` に広げる。**ハンドラーは値のまとまり1つを受け取る形に変える**: `onSave(values: PatientFormDraft)`、`onSaveAndContinue(values)`、`onCancel(values)`。`Dialog` の `similar.input` も `PatientFormDraft` 型にする。画面の下に `<section class="visit-info">` 見出し「訪問のための情報」:
  - `parking-select`(上の選択肢)。`permit-expires-input`(`type="date"`、ラベル「許可証の期限」)は `parking-select` が `street_permit` のときだけ表示(select の change で表示/非表示を切り替える。値は保持)。
  - `note-input`(`<textarea rows="4">`、ラベル「メモ」、placeholder「例) 駐車場: 北側のコインパーキング」)。その上に見出しボタン `note-heading-<見出し>`(駐車場・入口・インターホン・鍵・注意)。押すと、メモの末尾に(空でなく改行で終わっていなければ改行を足して)「見出し: 」を足し、textarea にフォーカスして末尾へカーソル。
  - 「続けて登録」のとき、ラベルと同じく駐車情報とメモは**引き継がない**(空に戻す)。
- ルートのカードの訪問先の行: 名前の下に小さな行 `route-stop-info`: `parkingBadge` があれば `<span class="parking-badge" data-testid="parking-badge">P</span> コインP`、`noteSummary` が空でなければ ` / ${summary}`(40文字で切って「…」)。どちらも無ければ行を出さない。
- 許可証の期限のお知らせ: `currentNotice()` のホーム画面の案内の次、バックアップのお知らせの前に、`permitsExpiringSoon > 0` かつ「閉じる」から7日以上たっていれば `permit-notice`「許可証の期限が近い訪問先: N件。期限を確かめてください。」、`notice-permit-dismiss`「閉じる」(`route-auto-input:permit-dismissed` に日時)。
- バックアップ(v1 のまま): `toPatient` が `parking`(type が選択肢のどれか。permitExpires は `YYYY-MM-DD` のときだけ)と `note`(空でない文字列)を読む。v2 は Task 7。

- [ ] **Step 1: テスト** — `tests/visitInfo.test.ts`:
```ts
it('parkingBadge', () => {
  expect(parkingBadge({ type: 'coin' })).toEqual({ icon: 'P', text: 'コインP' });
  expect(parkingBadge({ type: 'street_permit', permitExpires: '2027-03-31' })).toEqual({ icon: '許', text: '路上・許可証' });
  expect(parkingBadge({ type: 'unknown' })).toBeNull();
  expect(parkingBadge(undefined)).toBeNull();
});
it('noteSummary は駐車場・入口の行を優先', () => {
  expect(noteSummary('インターホン: 2回\n入口: B棟の裏口\n駐車場: 北側')).toBe('駐車場: 北側');
  expect(noteSummary('インターホン: 2回\n入口: B棟の裏口')).toBe('入口: B棟の裏口');
  expect(noteSummary('\n  鍵: ポスト  \n')).toBe('鍵: ポスト');
  expect(noteSummary(undefined)).toBe('');
});
it('permitsExpiringSoon は30日以内と期限切れを数える', () => {
  const now = new Date(2026, 8, 25);
  const p = (permitExpires?: string, type: ParkingType = 'street_permit') => ({ ...createPatient('a', 'b'), parking: { type, ...(permitExpires ? { permitExpires } : {}) } });
  expect(permitsExpiringSoon([p('2026-10-25'), p('2026-10-26'), p('2026-09-01'), p(undefined), p('2026-10-01', 'coin')], now)).toBe(2);
});
```
`tests/patient.test.ts`: `withVisitInfo` の付く/外れる(parkingType '' → parking 無し、coin → permitExpires 無し、note 空白 → note 無し)。`tests/patientFormView.test.ts`: 新しい項目の表示、許可証の期限は street_permit のときだけ見える、見出しボタンで「駐車場: 」が足される(既存の値の後に改行つき)、`onSave` に全項目のまとまりが渡る(既存のテストは `(name, address, phone)` の形から `expect.objectContaining({ name, address, phone })` に直す)。`tests/routeMapView.test.ts`: `route-stop-info` と `parking-badge`。`tests/backup.test.ts`: parking/note の往復と、壊れた値は無視。`tests/main.test.ts`: 駐車「コインパーキング」とメモを入れて保存 → 地図のカードに出る。許可証の期限が近い訪問先があるとお知らせが出る(`dismissInstallNotice()` の後)。`tests/wording.test.ts` のフォーム・お知らせを更新。
- [ ] **Step 2〜4**: 失敗の確認 → 実装 → `npm test && npm run typecheck`
- [ ] **Step 5: コミット** — `feat: 訪問先に駐車情報とメモを登録し、ルートのカードに出す`

---

### Task 5: 写真(DB v4・縮小・登録・表示)

**Files:**
- Modify: `src/db.ts`(v4: `photos`・`spots`)、`tests/db.test.ts`
- Create: `src/imageResize.ts`、`tests/imageResize.test.ts`
- Modify: `src/types.ts`(`Photo`・`Spot`・`Dialog` に `photos`)、`src/views/patientFormView.ts`、`src/views/dialogs.ts`、`src/views/routeMapView.ts`、`src/main.ts`、各テスト、`src/styles.css`

**Interfaces:**
- Produces(`types.ts`):
```ts
export type Photo = { id: string; patientId: string; blob: Blob; createdAt: string };
export type SpotKind = 'toilet' | 'rest' | 'store' | 'parking' | 'other';
export type Spot = { id: string; kind: SpotKind; note: string; location: GeoLocation; createdAt: string };
// Dialog に | { kind: 'photos'; patientId: string; urls: string[]; index: number }
```
- Produces(`db.ts`、DB_VERSION 4。`oldVersion < 4` で `photos`(keyPath 'id'、index 'patientId')と `spots`(keyPath 'id')を作る):
```ts
export const MAX_PHOTOS_PER_PATIENT = 3;
export async function listPhotos(patientId: string): Promise<Photo[]>;          // createdAt 昇順
export async function countPhotosByPatient(): Promise<Map<string, number>>;
export async function addPhoto(photo: Photo): Promise<void>;                    // 3枚を超えるなら Error('写真は1件につき3枚までです。')
export async function deletePhoto(id: string): Promise<void>;
export async function deletePhotosOf(patientIds: readonly string[]): Promise<void>;
export async function listAllPhotos(): Promise<Photo[]>;
export async function putPhotos(photos: readonly Photo[]): Promise<void>;        // バックアップの読み込み用(上書き)
export async function deleteOrphanPhotos(validPatientIds: ReadonlySet<string>): Promise<number>;
export async function listSpots(): Promise<Spot[]>;  export async function putSpot(spot: Spot): Promise<void>;
export async function deleteSpot(id: string): Promise<void>;  export async function putSpots(spots: readonly Spot[]): Promise<void>;
```
- Produces(`imageResize.ts`):
```ts
export const MAX_EDGE_PX = 1280;
export const JPEG_QUALITY = 0.8;
/** 長辺が maxEdge を超えるときだけ縮める。 */
export function fitWithin(width: number, height: number, maxEdge?: number): { width: number; height: number };
export type ResizeDeps = {
  decode(file: Blob): Promise<{ width: number; height: number; source: CanvasImageSource; close?(): void }>;
  createCanvas(width: number, height: number): { getContext(type: '2d'): CanvasRenderingContext2D | null; toBlob(cb: (b: Blob | null) => void, type: string, quality: number): void };
};
/** 縮小して JPEG の Blob にする(Canvas に描き直すので撮影場所などの情報は残らない)。 */
export function resizeImage(file: Blob, deps?: ResizeDeps): Promise<Blob>;
// 既定の deps: decode = createImageBitmap(file, { imageOrientation: 'from-image' }) / createCanvas = document.createElement('canvas') に width/height を入れる
// 失敗したら Error('写真を読み込めませんでした。')
```
- フォーム(編集のときだけ): 「訪問のための情報」の最後に「写真(3枚まで)」。サムネイル `photo-thumb`(`<img>`、`alt="写真N"`)+各 `photo-delete`「削除」、3枚未満なら `photo-add`(`<label>` の中に `<input type="file" accept="image/*" capture="environment" data-testid="photo-input">`、見た目は「写真を追加」ボタン)。撮影時の注意「表札や人が写らないようにしてください。」。新規登録のときは「保存したあと、編集から写真を追加できます。」とだけ出す。`renderPatientForm(patient, draft, message, handlers, photos: readonly { id: string; url: string }[] = [])`、ハンドラー `onAddPhoto(file: File)`、`onDeletePhoto(id: string)`。
- ルートのカードの行: 写真があれば `photo-count`「写真 N」ボタン → `onOpenPhotos(patientId)`。`renderRouteMap(..., visited, photoCounts: ReadonlyMap<string, number>, handlers)`(visited の後ろ)。
- 写真のダイアログ(`photos`): `photo-view` の `<img>`(urls[index])、`photo-prev`「‹ 前」/`photo-next`「次 ›」(端で押せない)、「N / M」、`dialog-cancel`「閉じる」。`DialogHandlers.onPhotoIndex(index)`。
- `main.ts`:
  - `let photoCounts = new Map<string, number>()`(起動時と写真の追加・削除・訪問先の削除のあとに `countPhotosByPatient()`)。
  - `let formPhotos: { id: string; url: string }[] = []`(編集フォームを開くとき `listPhotos` から `URL.createObjectURL`。フォームを離れるとき・読み直すとき `URL.revokeObjectURL`)。
  - `addPhotoFromFile(file)`: `const { resizeImage } = await import('./imageResize');` → `addPhoto({ id: crypto.randomUUID(), patientId, blob, createdAt })` → フォームの写真と件数を読み直す。失敗はメッセージ。
  - `openPhotos(patientId)`: `listPhotos` → object URL → ダイアログ。閉じるとき revoke。
  - 訪問先の削除(1件・一括)のあと `deletePhotosOf(ids)`。
- CSS: `.photo-list { display: flex; flex-wrap: wrap; gap: 0.5rem; } .photo-item { display: flex; flex-direction: column; gap: 0.25rem; width: 6rem; } .photo-item img { width: 6rem; height: 6rem; object-fit: cover; border-radius: var(--radius); border: 1px solid var(--border); } .photo-add { display: inline-flex; align-items: center; justify-content: center; min-height: var(--tap-min); padding: 0 1rem; border: 1px solid var(--primary); border-radius: var(--radius); color: var(--primary); cursor: pointer; } .photo-view img { display: block; max-width: 100%; max-height: 60vh; margin: 0 auto var(--gap); border-radius: var(--radius); }`(`60vh` は画面の高さに合わせるため可)。

- [ ] **Step 1: テスト** — `tests/imageResize.test.ts`: `fitWithin(4000, 3000)` → `{ width: 1280, height: 960 }`、`fitWithin(800, 600)` → そのまま、縦長も。`resizeImage` は偽の deps で、canvas の大きさが fitWithin どおり・`toBlob` に `'image/jpeg', 0.8` が渡る・`close()` が呼ばれる・`getContext` が null なら「写真を読み込めませんでした。」。`tests/db.test.ts`: 写真の追加・一覧(古い順)・4枚目で Error・件数の Map・訪問先ごとの削除・孤立した写真の削除・地点の追加/一覧/削除/上書き。v3→v4 の移行で既存の patients/meta/history が残ること(v3 で開いて書いてから閉じ、v4 で開き直す)。`tests/patientFormView.test.ts`: 編集のとき写真の欄(サムネイル・削除・追加)、3枚なら追加が無い、新規では案内だけ、ファイルを選ぶと `onAddPhoto(file)`。`tests/dialogs.test.ts`: 写真のダイアログの前/次/端/件数表示。`tests/routeMapView.test.ts`: `photo-count`。`tests/main.test.ts`(結合): `vi.mock('../src/imageResize', …)` で `resizeImage` を `async (f) => new Blob(['x'], { type: 'image/jpeg' })` に差し替え、`URL.createObjectURL`/`revokeObjectURL` をスタブ、編集 → 写真を追加 → DB に1枚・フォームにサムネイル → 訪問先を削除 → 写真も消える。
- [ ] **Step 2〜4**: 失敗の確認 → 実装 → `npm test && npm run typecheck`
- [ ] **Step 5: コミット** — `feat: 訪問先に写真を3枚まで登録し、ルートのカードから見られるようにする`

---

### Task 6: お役立ち地点(登録・一覧と削除・近くに表示)

**Files:**
- Modify: `src/types.ts`(`Dialog` に `spot`)、`src/views/locationDialog.ts`(地点用の中身)、`src/views/dialogs.ts`、`src/views/routeMapView.ts`、`src/views/settingsView.ts`、`src/main.ts`、各テスト、`src/styles.css`
- Create: `src/spots.ts`、`tests/spots.test.ts`

**Interfaces:**
- Produces(`spots.ts`):
```ts
export const SPOT_KINDS: { value: SpotKind; label: string }[] = [
  { value: 'toilet', label: 'トイレ' }, { value: 'rest', label: '休憩' }, { value: 'store', label: 'コンビニ' },
  { value: 'parking', label: 'コインパーキング' }, { value: 'other', label: 'そのほか' },
];
export const NEARBY_METERS = 500;
/** 位置のある訪問先のどれかから 500m 以内の地点を、一番近い距離の順に。 */
export function nearbySpots(spots: readonly Spot[], stops: readonly { location?: { lat: number; lng: number } }[]): { spot: Spot; meters: number }[];
export function spotLabel(kind: SpotKind): string;
```
- ダイアログ: `{ kind: 'spot'; phase: 'idle' | 'measuring' | 'measured' | 'saved' | 'error'; best; error; spotKind: SpotKind; note: string }`。中身は位置のダイアログと同じ測定の部分(`locationDialog.ts` の測定部分を関数 `renderMeasure(phase, best, error, handlers)` に切り出して両方で使う)+ 種類の `spot-kind-select` と一言メモの `spot-note-input`(入力のたび `onSpotDraft({ spotKind, note })` で state に保つ)+ `spot-save-button`「この位置で登録」。貼り付けは地点では出さない。`saved` は「登録しました」と `dialog-cancel`「閉じる」。
- 地図の画面: カードの下、共有の上に `nearby-spots` の節「近くのお役立ち地点」(`nearbySpots` が空なら節ごと出さない)。各行「トイレ(約120m) 一言メモ」を `<a>`(`buildGoogleMapsUrl([lat,lng])`、新しいタブ)。節の最後に `spot-add-button`「今いる場所をお役立ち地点に登録」。**地点が1つも無いときも** `spot-add-button` だけは出す(節の見出しは「お役立ち地点」)。
- 設定: 「データの保存状態」の前に節「お役立ち地点」: 一覧(種類・メモ・登録日)と各 `spot-delete`「削除」(confirm「この地点を消しますか?」)、空なら「まだありません。地図を開く画面の下から登録できます。」。`SettingsInfo.spots: Spot[]`、`SettingsHandlers.onDeleteSpot(id)`。
- `main.ts`: `let spots: Spot[] = []`(起動時に `listSpots`)。測定は Task 3 の `startLocationMeasure` を `location` と `spot` の両方で使えるように一般化する(対象のダイアログの kind を見て書き換える)。保存は `putSpot({ id: crypto.randomUUID(), kind, note: note.trim(), location: { ...best, recordedAt, source: 'gps' }, createdAt })`。
- CSS: `.nearby-spots ul { margin: 0; padding: 0; list-style: none; } .nearby-spots li a { display: flex; align-items: center; min-height: var(--tap-min); gap: 0.5rem; color: var(--primary); }`。

- [ ] **Step 1: テスト** — `tests/spots.test.ts`: 500m 以内だけ・近い順・位置の無い訪問先は無視・複数の訪問先のうち一番近い距離。ダイアログ・地図・設定の表示テスト。`tests/main.test.ts`(結合): 偽の geolocation で地点を登録 → 設定に出る → 位置のある訪問先を選んで地図を開く画面に「近くのお役立ち地点」→ 設定で削除。`tests/wording.test.ts` に地点のダイアログ・節を足す。
- [ ] **Step 2〜4**: 失敗の確認 → 実装 → `npm test && npm run typecheck`
- [ ] **Step 5: コミット** — `feat: トイレや休憩の場所をお役立ち地点として登録し、ルートの近くに出す`

---

### Task 7: バックアップ v2(写真を含めるか選べる・地点・設定)

**Files:**
- Create: `src/photoCodec.ts`、`tests/photoCodec.test.ts`
- Modify: `src/backup.ts`、`tests/backup.test.ts`、`src/views/settingsView.ts`、`tests/settingsView.test.ts`、`src/main.ts`、`tests/main.test.ts`

**Interfaces:**
- Produces(`photoCodec.ts`): `blobToDataUrl(blob): Promise<string>`(FileReader)、`dataUrlToBlob(dataUrl): Blob`(`data:<type>;base64,` を解く。壊れていれば Error('写真のデータが壊れています。'))。
- Produces(`backup.ts`):
```ts
export const BACKUP_VERSION = 2;
export type BackupPhoto = { id: string; patientId: string; dataUrl: string; createdAt: string };
export type BackupContent = {
  patients: Patient[];
  photos: BackupPhoto[] | null;        // 写真を含めなかった(または v1)なら null
  spots: Spot[];
  meta: { office?: Office; routeEnds?: RouteEnds };
};
export function serializeBackup(content: BackupContent, now?: Date): string;
export function parseBackup(text: string): BackupContent;   // v1 → { patients, photos: null, spots: [], meta: {} }
```
  - `toPatient` は Task 4 までの項目に加えて `location`(lat/lng が数・範囲内、accuracy は数か null、recordedAt 文字列、source が 'gps'|'paste')を読む。壊れた `location`/`parking`/`note` は無視(訪問先自体は読む)。
  - 写真・地点・meta は形が合うものだけ読み、合わないものは捨てる(1件でもあれば読む)。
  - バージョンが 1 でも 2 でもなければ今までどおり「対応していないバージョンのバックアップファイルです。」。
- 設定の書き出し: `書き出す` の上に `<label><input type="checkbox" data-testid="include-photos" checked> 写真も含める(約N.NMB)</label>`(写真が無ければチェックごと出さない)。`SettingsInfo.photoBytes: number`(`listAllPhotos` の blob.size の合計 × 4/3、表示は MB 小数1桁、0.1 未満は「約0.1MB未満」)。`SettingsHandlers.onExport(includePhotos: boolean)`。
- `main.ts`:
  - `handleExport(includePhotos = true)`: `serializeBackup({ patients, photos: includePhotos ? await Promise.all(listAllPhotos().map(→ dataUrl)) : null, spots, meta: { office, routeEnds } })`。お知らせの「今すぐバックアップ」は写真を含める。
  - `handleImport`: 確認の文に「写真M枚・お役立ち地点K件」も入れる(0 なら書かない)。取り込み順: 訪問先(replace/merge は今までどおり)→ `photos` が null でなければ `putPhotos`(data URL を Blob に)→ `putSpots` → meta があれば `setMeta` と `routeContext`/`settingsInfo` を更新 → `deleteOrphanPhotos(新しい訪問先の id)` → 読み直し(訪問先・件数・地点)。**写真が null のときは既存の写真に触れない**(残す)。
- 7章の「旧形式(version 1)も読める」を満たす。

- [ ] **Step 1: テスト** — `tests/photoCodec.test.ts`: Blob → data URL → Blob で中身と type が同じ。壊れた data URL で Error。`tests/backup.test.ts`: v2 の往復(位置・駐車・メモ・写真・地点・meta)、写真 null の往復、v1 のファイルが読める、壊れた location は外して読む、壊れた写真だけ捨てる、version 3 は拒否。`tests/settingsView.test.ts`: `include-photos` と MB 表示、写真0なら出ない、チェックを外して書き出すと `onExport(false)`。`tests/main.test.ts`(結合): 写真つきで書き出したファイルの中身(`downloadTextFile` をスパイして JSON を読む)に photos がある・外すと null。写真なしのファイルを「入れ替える」で読み込んでも既存の写真が残る。v2 のファイルの読み込みで地点と事業所が入る。
- [ ] **Step 2〜4**: 失敗の確認 → 実装 → `npm test && npm run typecheck`
- [ ] **Step 5: コミット** — `feat: バックアップを v2 にし、写真・お役立ち地点・事業所の設定も書き出せるようにする`

---

### Task 8: 仕上げ(軽さ・README)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: ビルド** — `npm run build`。`dist/assets/` に `geo-*.js` と `imageResize-*.js` が別のファイルとして出ていること(使うときだけ読み込まれる)、`index-*.js` の大きさを記録(目安 120KB 以内)。`dist/` はコミットしない。
- [ ] **Step 2: 通しの確認(コントローラーが dev サーバーで行う)** — 位置の登録(偽の位置情報は使えないので、貼り付けで)→ 地図のURLが座標になる → 駐車・メモ → カードの表示 → 写真(PCでファイルを選ぶ)→ 写真のダイアログ → お役立ち地点(貼り付けは無いので、登録のダイアログが開き、許可のエラー表示が出ることまで)→ バックアップ v2 の書き出しと読み込み。明るい/暗いの両方。
- [ ] **Step 3: README** — 「主な機能」に 位置の登録(今いる場所・座標の貼り付け)、駐車情報とメモ、写真、許可証の期限のお知らせ、お役立ち地点、バックアップ v2(写真を含めるか選べる)を追記。「試運転で確かめること」に: 車を停めた場所で「今いる場所で登録」→ 誤差の表示 → 次からその位置へ案内される/Googleマップで長押しした座標の貼り付け/写真の撮影と縮小(1枚が数百KBになる)/許可証の期限のお知らせ/お役立ち地点が近くに出る/写真を含めた・含めないバックアップの読み込み。
- [ ] **Step 4: コミット** — `docs: 段階3の機能と、試運転で確かめることを README に書く`

---

## Self-Review

**Spec coverage(5章・7章・8章):**
- 5.1 位置の型・入口(カードのピン・「⋯」)・10秒の測定と誤差の表示・20m/50m の案内・登録後の確かめと元に戻す・貼り付け(座標・長いURL・短いURLは案内)・未登録の表示・地図と共有に座標 → Task 1, 2, 3
- 5.2 駐車の型・許可証の期限・メモと見出しボタン・写真(別ストア・3枚・撮影・縮小1280/0.8・Exif が落ちる)・カードの表示(駐車・メモの優先・写真の枚数→拡大)・期限のお知らせ・書き出しで写真を含めるか選ぶ・写真なしの読み込みで既存を残す → Task 4, 5, 7
- 5.3 地点の型・今いる場所で登録・500m 以内を近い順に表示・押すと地図・バックアップに含める → Task 6, 7
- 5.4 位置・縮小を `import()`・一覧に写真を載せない → Task 3, 5, 8
- 7 DB v4 の `photos`・`spots`、バックアップ v2 と v1 の読み込み → Task 5, 7
- 8 純粋な関数を先に・ブラウザ依存は差し替え・実機の確認 → 各タスク、Task 8

**決めたこと(設計書に無かった細部):**
- 「元に戻す」は数秒で消える表示ではなく、登録後のダイアログの中に出す(閉じるまで押せる)。タイマーでの消去を作らずに済み、押し損ねも無い。
- 写真は既存の訪問先の編集のときだけ追加できる(新規では「保存したあと、編集から」と案内)。写真は訪問先の id に結びつくため。
- 「続けて登録」では駐車情報・メモを引き継がない(ラベルと違い、人ごとに違うため)。
- 事業所の位置(緯度・経度)は今回入れない(事業所は住所で十分なことが多い)。
- 一覧の「位置 未登録」は小さく控えめに出す(設計書どおり表示はする)。

**Placeholder scan:** Task 3〜7 は画面のコードを全文ではなく「testid・文言・構造・ハンドラー名」で指定している。実装者は既存の views(`settingsView.ts` の `section`/`button`、`dialogs.ts` の `actionButton`)の書き方に合わせる。テストは各 Step 1 に書いた検査項目をそのままテストにする。

**Type consistency:** `GeoLocation`・`Parking`(Task 1)を Task 3〜7 が使う。`LocationDialog` の phase は Task 6 の `spot` と同じ語。`renderRouteMap(state, opened, provider, context, visited, photoCounts, handlers)`(Task 5 で photoCounts を足す)。`PatientFormDraft` は Task 4 で広げ、Task 5 は `renderPatientForm` の第5引数に写真を足す。`serializeBackup(content)` の形は Task 7 で変わる(それまでの呼び出しは `serializeBackup(state.patients)`)。
