# 段階5: 批判的レビューと端末テストの手直し 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 段階1〜4の公開後のレビューと端末テストで見つかった「最優先9件」と「中くらい8件」を直す。地図に渡す住所・iPhone のデータの引っ越し・読み込みの安全さ・データベースの切れ・送る/書き出すの共有・狭い画面の見た目・戻るボタンを、1回の公開にまとめる。

**Architecture:** 判断は純粋な関数(`addressForMaps`・読み込みの計画・上書きの項目の残し方・ルートの上限・戻る記録の深さ・読み直しの門番)に置き、Vitest で先に確かめる。データベースの一続きの書き込みは `db.ts` の `applyImport` 1つにまとめ、`backupFlow`・`transferReceive` はそれを呼ぶだけにする。画面の配線は今までどおり `main.ts` の `setState` 一箇所(IME の見送り・受け取りの破棄・設定の下書きの片付けと同じ場所)に足す。

**Tech Stack:** Vite + TypeScript(フレームワークなし)、IndexedDB(`idb`)、vite-plugin-pwa 1.3.0(`virtual:pwa-register`)、Web Share API(files)、History API、Vitest + jsdom + fake-indexeddb。

**Spec:** `docs/superpowers/specs/2026-09-27-stage5-review-fixes-design.md`(1〜17章・テスト・数値表)。

## Global Constraints

- 既存テスト(1009件)を壊さない。振る舞いを変えたテストだけ、各タスクの「直す既存テスト」に書いたとおり直す。
- 画面の文言に禁止語(`tests/wording.test.ts` の `FORBIDDEN`: 患者・薬局・在宅・医療・利用者・ルート自動入力)を使わない。新しい文は全部 `tests/wording.test.ts` に足す。
- 文字は 14px 以上、タップ領域は 44px(`--tap-min`)以上。色は `styles.css` の変数(トークン)だけ。明るい/暗いの両方で読めること。
- `src/` の構成(state / views / db / flow の分離)を守る。データは端末の中だけ。
- `src/` にテスト専用の分岐やフラグを入れない。テストに固定の待ち時間(sleep)を使わない(`vi.waitFor`・Promise を待つ)。
- TDD: テスト → 失敗の確認 → 実装 → 成功の確認 → コミット。コミットは `git -c user.name=okaka2 -c user.email=okaka2@users.noreply.github.com commit` で、末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。push は利用者の確認を得てから。
- コマンドはリポジトリ `C:\Users\owner\Desktop\route-auto-input`(ブランチ `stage5-review-fixes`)で実行。`npm test`、`npx vitest run tests/<name>.test.ts`、`npm run typecheck`、`npm run build`。
- ビルドの index の JS は 120KB 以内(今 118.47KB)。重い新しい処理は `import()` で分ける。Task 8 と Task 13 の終わりに `npm run build` で大きさを見る。
- 訪問先のデータやバックアップの JSON・引き継ぎのファイルをコミットしない(テストの固定値は架空の名前・住所だけ)。

## 設計書から変えたこと・決めたこと(このプランの決定)

1. **db の書き込み計画の型は `DbImportPlan` と呼ぶ**(設計書の例は `applyImport(plan)`)。`transfer.ts` にすでに `ImportPlan`(受け取りの計画)があり、`transferReceive.ts` が両方を使うため。
2. **自動更新は `registerType: 'autoUpdate'` のまま、`registerSW({ onNeedReload })` を使う。** vite-plugin-pwa 1.3.0 の `register.js` は、`onNeedReload` を渡すと `window.location.reload()` の代わりにそれを呼ぶ(`activated` の `isUpdate || isExternal` のとき)。`prompt` に変える必要はない。
3. **「元に戻す」の見た目は、一覧の上のお知らせ(`renderNotice`)と同じにする。** 設計書の「既存の削除の『元に戻す』」は今のコードに無い(削除は確認だけ。「元に戻す」は位置の小窓の中だけ)。
4. **「先週と同じ」「履歴から選ぶ」の知らせは、訪問順の画面に出す。** この2つは選んだ後に訪問順の画面へ移るので、「画面を移ると消える」は「操作の後の画面から移ると消える」と読む。元に戻すと、選択・順番・開いたルートの記録・出発帰着(`routeEnds`。この操作で変わるため)を戻し、画面はそのまま。
5. **上限9件は「現在地から」のルートのすべての本に使う**(`stopsPerRoute` の1か所で引く)。訪問順の画面の区切り線・説明と、ルートの分け方が食い違わないようにするため。地図の画面の「ルートを共有」は1本目がいつも現在地からなので、`MAX_STOPS_PER_ROUTE - 1` で分ける。
6. **バックアップの「保存する」は小窓(`backupSave`)にする。** 設定の画面からも、一覧のお知らせの「今すぐバックアップ」からも同じ形で出せるため。送る小窓の `ready` と同じ部品(`src/fileIo.ts` の `canShareFile`・`shareFile`・`downloadFile`・`downloadLocationHint`)を使う。`shareOrDownloadFile` は使われなくなるので消す。
7. **追加(merge)の終わりの文は「N人・お役立ち地点K件を追加しました。」**(地点が0なら「N人を追加しました。」)。**N=0 のときは何も書き込まない**(設計書の「とだけ出す」のとおり。地点・設定も入れない)。
8. **選択バーの「⋯」の中の「送る」「削除」は、今の testid(`send-selected-button`・`delete-selected-button`)を引き継ぐ。** 既存テストは「⋯」を1回押す手順を足すだけで済む。
9. **iPad の判定を足す。** iPadOS の Safari は UA が Mac と同じなので、`Macintosh` かつ `navigator.maxTouchPoints > 1` も `'ios'` とみなす(設計書「iPad を含む」)。
10. **戻る記録は `history.state` に深さ(`{ nav: n }`)を持たせて合わせる。** 数を数える変数や「次の popstate を無視する」フラグは持たない(取りこぼすと戻るが効かなくなるため)。自分で `history.go()` したときの popstate は「着いた深さ = 今の画面の深さ」なので何もしない。
11. **DB の `blocking` のときの読み直しは差し替えられる口にする**(`setDbBlockingHandler`)。既定は `location.reload()`。Task 8 で main.ts が「読み直しの門番」につなぎ、入力中は待たせる。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/addressForMaps.ts` (新規) | 地図に渡す住所から建物名・部屋番号を外す。**Task 1** |
| `src/geoPoint.ts`、`src/routePlan.ts`、`src/views/patientFormView.ts`、`src/main.ts` | 地図の URL に `addressForMaps` を通す、現在地からの上限9件。**Task 1** |
| `src/db.ts` | `withDb`・接続の作り直し(**Task 2**)、`applyImport`・写真ごとの削除・孤立した写真の掃除(**Task 3**) |
| `src/backup.ts` | 読み込みの計画 `planBackupImport`(純粋)。**Task 3, 4** |
| `src/backupFlow.ts` | 読み込みを `applyImport` に(**Task 3, 4**)、書き出しを DB から・2段階に(**Task 5**) |
| `src/transferReceive.ts` | 取り込みを `applyImport` に。**Task 3** |
| `src/fileIo.ts` | `canShareFile`・`shareFile`・`downloadFile`・`downloadLocationHint`。**Task 5**(Task 7 も使う) |
| `src/transfer.ts`、`src/config.ts`、`src/crypto.ts`、`src/views/settingsView.ts` | 上書きで手元を残す・パスワード10文字・60万回。**Task 6** |
| `src/transferFlow.ts`、`src/views/transferDialog.ts`、`src/types.ts` | 送るの `ready`。**Task 7** |
| `src/swUpdate.ts` | 読み直しの門番 `createReloadGate`。**Task 8** |
| `src/platform.ts`、`src/installHint.ts`、`src/views/dialogs.ts` | iPhone の引っ越しの案内。**Task 9** |
| `src/styles.css`、`src/views/routeMapView.ts` | 縦に長い小窓・地図の行の折り返し。**Task 10** |
| `src/views/selectionBar.ts`、`src/views/patientListView.ts`、`src/styles.css` | 選択バー1段・検索欄だけ残す。**Task 11** |
| `src/state.ts`、`src/views/routeOrderView.ts` | 見えている行だけの全解除・元に戻す。**Task 12** |
| `src/backNav.ts` (新規) | 画面と小窓から戻る記録の深さを決める。**Task 13** |
| `README.md` | 試運転で確かめること。**Task 14** |

## タスクの順番の決まり

- Task 2 → Task 3 → Task 4(`applyImport` は `withDb` を使い、merge の計画は `applyImport` に渡す)。
- Task 5 → Task 7(Task 5 で作る `fileIo.ts` の2段階の部品を Task 7 が使う。小窓の「押した処理の中で `shareFile` を呼ぶ」決まりも同じ)。
- Task 6 → Task 7(どちらも `transferFlow.ts`・`transferDialog.ts` を触る。パスワードの文を先に決める)。
- Task 2・5・7 → Task 8(DB の `blocking` と、書き出し/読み込み/送るの作業中を門番に渡す)。
- Task 11・12 → Task 13(選択バーの小窓と元に戻すの後で、`setState` に戻る記録を足す)。
- Task 14 は最後。

---

### Task 1: 地図に渡す住所から建物名を外す(§1)と、現在地からの上限9件(§8)

**Files:** Create `src/addressForMaps.ts`、`tests/addressForMaps.test.ts`。Modify `src/geoPoint.ts`(`pointOf` の住所の枝)、`src/routePlan.ts`(事業所の住所・`stopsPerRoute`)、`src/views/patientFormView.ts`(375行目あたりの「地図で確かめる」)、`src/main.ts`(`confirmedShareText`)、`tests/geoPoint.test.ts`、`tests/routePlan.test.ts`、`tests/routeOrderView.test.ts`、`tests/routeMapView.test.ts`。

**Interfaces:**
```ts
// src/addressForMaps.ts
/** Googleマップの URL を作るときだけ使う。建物名・部屋番号がはっきり分かるときだけ外し、迷う形はそのまま返す。 */
export function addressForMaps(address: string): string;
// src/geoPoint.ts(住所の枝で addressForMaps を通す)
export function pointOf(stop: { address: string; location?: LatLng }): string;
// src/routePlan.ts
export function stopsPerRoute(ends: RouteEnds, office: Office | null, maxStops: number): number;
// = maxStops - officeStopCount(ends, office) - (ends.start === 'current' ? 1 : 0)
```
- 番地: 半角・全角の数字で始まり、数字と `-` `－` `ー` `−` `‐` `丁目` `番地` `番` `号` が続く並び。番地の直前が地名の文字(漢字・かな・カナ)であること(先頭や `〒` の直後の数字=郵便番号は番地とみなさない)。
- 規則1: 番地の直後に空白(半角・全角)があり、その後ろに文字が続く → 空白から後ろを外す。ただし空白の後ろが数字で始まるなら番地の続き(例 `4丁目 6-16`)として外さない。
- 規則2: 番地の直後(空白なし)に、末尾まで `[-－ー−‐]?[英数字]+(号室|号棟|棟|階|F|Ｆ)` の部分が続く → その部分を外す。
- どちらにも当てはまらなければ、何もしない。外した結果の前後の空白は取る。外した結果は必ず番地を含む(空にならない)。
- 保存する住所・一覧や地図の画面の表示・CSV/バックアップ・引き継ぎは変えない。位置が登録済みなら今までどおり座標。

| 入力 | 出力 | 理由 |
|---|---|---|
| `神奈川県横浜市中区山下町279 グランドコート横浜レジデンス棟1203号室` | `神奈川県横浜市中区山下町279` | 規則1 |
| `東京都港区六本木6-10-1 六本木ヒルズ森タワー 5F` | `東京都港区六本木6-10-1` | 規則1(最初の空白から) |
| `東京都新宿区西新宿２丁目８−１　都庁第一本庁舎` | `東京都新宿区西新宿２丁目８−１` | 規則1・全角の数字と空白 |
| `東京都千代田区丸の内1-9-1 5階` | `東京都千代田区丸の内1-9-1` | 規則1 |
| `大阪府大阪市北区梅田1-2-3-405号室` | `大阪府大阪市北区梅田1-2-3` | 規則2 |
| `大阪府大阪市北区梅田1-2-3A棟` | `大阪府大阪市北区梅田1-2-3` | 規則2 |
| `大阪府大阪市北区梅田3番5号 梅田ハイツ` | `大阪府大阪市北区梅田3番5号` | 規則1・番/号の表記 |
| `神奈川県横浜市中区山下町279グランドコート` | そのまま | 空白なしの建物名(迷う形) |
| `東京都中央区銀座4丁目 6-16` | そのまま | 空白の後ろが数字(番地の続き) |
| `北海道札幌市中央区北1条西2丁目` | そのまま | 後ろに何も無い |
| `京都府京都市東山区清水 清水寺` | そのまま | 番地が無い |
| `グランドコート 横浜市中区山下町279` | そのまま | 建物名が番地より前 |
| `〒231-0023 神奈川県横浜市中区山下町279` | そのまま | 郵便番号は番地とみなさない |

- 使う場所: `pointOf`(ルートの地点・共有・位置の小窓の「地図で確かめる」が通る)、`buildRoutePlans` の事業所の住所(`addressForMaps(office.address)`)、登録画面の「地図で確かめる」(`DEFAULT_MAP_PROVIDER.buildUrl([addressForMaps(address)])`、1件だけの地点検索)。`buildGoogleMapsUrl` は変えない。
- 上限9件: `stopsPerRoute` で引く。訪問順の説明 `訪問先は1ルート${perRoute}件までです。` と地図の「1つのルートは最大${perRoute}地点までです。」は、この数を使うので自動で「9件まで」になる。`confirmedShareText` は `buildShareText(points, MAX_STOPS_PER_ROUTE - 1, …)`。
- [ ] **Step 1: テスト**: 上の表の全行・結果が空にならないこと(`addressForMaps.test.ts`)/`pointOf({ address: '…山下町279 グランドコート…' })` が外した住所、位置があれば座標(`geoPoint.test.ts`)/`stopsPerRoute(ends('current','last'), office, 10)` が 9、`('current','office')` が 8、`('first','last')` が 10/`buildRoutePlans(stops(10), ends('current','last'), null, 10)` が2本(9件+2件)で1本目の `addresses` が9件/事業所の住所 `東京都中央区0-0-0 本社ビル3F` が `東京都中央区0-0-0` で渡る(`routePlan.test.ts`)/訪問順の画面で現在地からなら「1ルート9件まで」(`routeOrderView.test.ts`)/地図の画面で現在地から10件選ぶと2本に分かれる(`routeMapView.test.ts`)。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test && npm run typecheck`
- **直す既存テスト:** `tests/routePlan.test.ts` の「現在地から/最後の訪問先で終わるなら減らない」(現在地の行を 9 にし、見出しを「現在地からは1件減る」に分ける)。
- [ ] **Step 5:** コミット — `fix: 地図に渡す住所から建物名を外し、現在地からのルートは1本9件までにする`

---

### Task 2: データベースのつながりを作り直せるようにする(§4)

**Files:** Modify `src/db.ts`、`src/main.ts`(`recordTodayRoute`・`toggleVisited`)、`tests/db.test.ts`、`tests/main.test.ts`。

**Interfaces:**
```ts
// src/db.ts
type Db = IDBPDatabase<RouteAutoInputDB>;
/** 接続を取り出して operation を行う。UnknownError・InvalidStateError なら接続を捨てて作り直し、1回だけやり直す。 */
export async function withDb<T>(operation: (db: Db) => Promise<T>): Promise<T>;
/** 新しい版が DB の更新を待っている(blocking)ときに呼ぶ。既定は () => window.location.reload()。 */
export function setDbBlockingHandler(handler: () => void): void;
```
- `getDb()` の `openDB` に `terminated() { 覚えている接続を捨てる }`、`blocking() { 接続を閉じて捨て、blockingHandler() }` を渡す。`blocked` は渡さない(何もしない=相手が閉じるのを待つ)。
- 最初の接続が失敗したら、覚えている Promise を捨てる(`opening.catch(() => { if (connection === opening) connection = null; })`。捨てるのは同じ Promise のときだけ)。
- 読み書きの関数(`getMeta` から `putSpots` まで全部、`closeDbForTest` を除く)の中身を `withDb((db) => …)` で包む。エラーの見分けは `name` で行う(fake-indexeddb の例外も `name` を持つ)。やり直しは1回だけ。2回目の失敗はそのまま投げる。
- 見えない失敗をなくす: `recordTodayRoute` の `catch` で黙らず、`toggleVisited` の文も合わせて「訪問の記録を保存できませんでした。」を出す(`withMessage(state, { kind: 'error', text })`)。
- [ ] **Step 1: テスト(`db.test.ts`)**: (a) `withDb` に、1回目は `new DOMException('closed', 'InvalidStateError')` を投げ2回目は値を返す operation を渡す → 値が返り、operation は2回呼ばれ、2回目の `db` は1回目と別の接続。(b) 2回とも投げる → 投げる(3回目は呼ばない)。(c) `TypeError` はやり直さない。(d) 先に `openDB('route-auto-input', 5)` で高い版を作っておくと `listPatients()` が失敗 → `deleteDB` 後の `listPatients()` は成功する(失敗した接続を覚えていない)。(e) `listPatients()` の後に `openDB('route-auto-input', 5)` を開くと、`setDbBlockingHandler(spy)` の spy が1回呼ばれ、版5の接続が開ける(こちらが閉じた)。`main.test.ts`: `vi.spyOn(db, 'updateHistory').mockRejectedValue(new Error('x'))` で「済」を押すと「訪問の記録を保存できませんでした。」、「地図を開く」でも同じ文が出る。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test`(2回)・`npm run typecheck`
- **直す既存テスト:** 無し(「訪問済みを記録できませんでした。」を確かめるテストは無い)。
- [ ] **Step 5:** コミット — `fix: データベースの接続が切れても作り直し、訪問の記録の失敗を知らせる`

---

### Task 3: 読み込み・受け取りを一続きの書き込みにする、写真の掃除(§5)

**Files:** Modify `src/db.ts`、`src/backupFlow.ts`、`src/transferReceive.ts`、`src/main.ts`(`handleDelete`・`handleConfirmDeleteSelected`・`startApp`)、`tests/db.test.ts`、`tests/backupFlow.test.ts`、`tests/transferFlow.test.ts`、`tests/main.test.ts`。

**Interfaces:**
```ts
// src/db.ts
export type DbImportPlan = {
  /** true なら訪問先を全部消してから patients を入れる(バックアップの入れ替え)。持ち主のいなくなった写真も同じ中で消す。 */
  replaceAll: boolean;
  /** 保存する訪問先(同じ id は上書き)。 */
  patients: readonly Patient[];
  /** 手元の写真を先に全部消す訪問先の id(入れ替え・受け取りの上書き)。 */
  replacePhotosOf: readonly string[];
  /** 入れる写真(Blob は書き込みの前に全部作っておく)。 */
  photos: readonly Photo[];
  spots: readonly Spot[];
  meta: { office?: Office; routeEnds?: RouteEnds };
};
/** patients・photos・spots・meta を1つの readwrite トランザクションで書く。途中で失敗したら何も変わらない。 */
export async function applyImport(plan: DbImportPlan): Promise<void>;
/** 訪問先とその写真を、1つのトランザクションで消す。 */
export async function deletePatient(id: string): Promise<void>;
export async function deletePatients(ids: readonly string[]): Promise<void>;
/** 名簿に無い訪問先の写真を消し、消した枚数を返す(名簿も同じトランザクションの中で読む)。 */
export async function deleteOrphanPhotos(): Promise<number>;
// src/backup.ts(Task 4 で merge を足す。ここでは replace だけ)
export function planBackupReplace(content: BackupContent, decodedPhotos: Photo[] | null): DbImportPlan;
```
- `applyImport` の中の順番: (replaceAll なら)訪問先を clear → patients を put → `replacePhotosOf` の写真を消す → photos を put → (replaceAll なら)名簿に無い写真を消す → spots を put → meta を put。`withDb` を通す。
- `planBackupReplace`: `replaceAll: true`、`patients: content.patients`、写真が null なら `replacePhotosOf: []`・`photos: []`(残る人の手元の写真は消さない。今と同じ)、写真があれば `replacePhotosOf: ファイルの訪問先の id` と `photos: decodedPhotos`、`spots: content.spots`、`meta: content.meta`。
- `backupFlow.handleImport`(入れ替え): 確認の後 `applyImport(planBackupReplace(...))` を1回呼ぶ。その後の `ctx.setRouteContext`・`ctx.setSettingsInfo` は書き込みが成功した後にまとめて行う。失敗の文は今のまま(「取り込みの途中で失敗しました。画面を最新の内容に合わせました。」)、読み直しも残す。
- `transferReceive.runImport`: `mergePatients`・`replacePhotosFor`・`putSpots` の3回を `applyImport({ replaceAll: false, patients: plan.put, replacePhotosOf: [...plan.photosByPatient.keys()], photos: [...plan.photosByPatient.values()].flat(), spots: plan.spots, meta: {} })` 1回にする。失敗の文(「取り込めませんでした。」)は今のまま。
- 削除: `handleDelete`・`handleConfirmDeleteSelected` から `deletePhotosOf` の呼び出しと、その `try/catch` を外す。
- 起動: `startApp` の `reloadPatients()` の後に `deleteOrphanPhotos()` を1回(失敗は無視。1枚以上消したら `loadPhotoCounts()`・`loadPhotoBytes()`)。`__routeAutoInputStartup` の Promise に含める(テストの後片付けと競合させない)。最初の描画は待たせない。
- 使われなくなる `replaceAllPatients`・`mergePatients`・`mergePhotosCapped`・`putPhotos`・`replacePhotosFor`・`putSpots`・`deletePhotosOf` は消す(Task 4 の後も使わない)。
- [ ] **Step 1: テスト**: `db.test.ts` — `applyImport` の入れ替え(前の訪問先・持ち主のいない写真が消え、ファイルの写真だけが入る・写真 null なら残る人の写真は残る)/追加(同じ id の上書き、`replacePhotosOf` の人だけ写真が入れ替わる)/**途中で失敗させたら何も変わらない**(入れ替えの計画の `patients` の最後に keyPath(`id`)の無い値 `{}` を混ぜて put を失敗させる → 前の訪問先・写真・地点・meta がそのまま、`applyImport` は reject)/`deletePatient`・`deletePatients` で写真も消える/`deleteOrphanPhotos()` が名簿に無い写真だけ消して枚数を返す。`backupFlow.test.ts` — 入れ替えで `applyImport` が1回だけ呼ばれる。`main.test.ts` — 起動時に持ち主のいない写真が消える。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test`(2回)・`npm run typecheck`
- **直す既存テスト:** `db.test.ts` の消す関数のテスト(`applyImport` のテストへ置き換える)。`main.test.ts` 2659行「deletePhotosOf が失敗しても…」(「訪問先を消すと写真も消える」に置き換える)。`main.test.ts` 3337行あたり(`putSpots` を失敗させるテスト)は `vi.spyOn(db, 'applyImport').mockRejectedValueOnce(new TypeError(…))` にし、同じ文と「訪問先の件数が変わらない」を確かめる。`transferFlow.test.ts` 616・963・976・989行の `mergePatients` の spy を `applyImport` に。
- [ ] **Step 5:** コミット — `fix: 読み込みと受け取りを1つのトランザクションで書き、写真の消し残しを片付ける`

---

### Task 4: バックアップの「今のデータに追加する」は、いない人だけ足す(§3)

**Files:** Modify `src/backup.ts`、`src/backupFlow.ts`、`tests/backup.test.ts`、`tests/backupFlow.test.ts`、`tests/main.test.ts`、`tests/wording.test.ts`。

**Interfaces:**
```ts
// src/backup.ts
export type LocalSnapshot = {
  patientIds: ReadonlySet<string>;
  spotIds: ReadonlySet<string>;
  hasOffice: boolean;
  hasRouteEnds: boolean;
};
export type MergePlan = { write: DbImportPlan; added: number; kept: number; spotsAdded: number };
/** 手元に同じ id がいない人だけ足す。写真は足した人の分だけ(1人3枚まで)、地点は無い id だけ、meta は手元が未設定のときだけ。 */
export function planBackupMerge(content: BackupContent, decodedPhotos: Photo[] | null, local: LocalSnapshot): MergePlan;
export function mergeConfirmText(added: number, kept: number): string;
export function mergeDoneText(added: number, spotsAdded: number): string;
export function mergeNothingText(kept: number): string;
```
- 手元の様子は画面の state ではなく DB から読む(`listPatients`・`listSpots`・`getMeta('office')`・`getMeta('routeEnds')`)。
- `write`: `replaceAll: false`、`patients: 新しい人`、`replacePhotosOf: []`、`photos: 新しい人の写真(ファイルの順で1人 MAX_PHOTOS_PER_PATIENT 枚まで)`、`spots: 無い id だけ`、`meta: 未設定の項目だけ`。
- 文:
  - 確認 `mergeConfirmText`: 「N人を追加します(手元にいるM人はそのまま)。よろしいですか?」。M=0 なら「N人を追加します。よろしいですか?」。
  - N=0: 確認を出さず、何も書かず、`mergeNothingText` を info で出す:「追加する訪問先はありませんでした(手元にいるM人はそのまま)。」。M=0(ファイルが0人)なら括弧を書かず「追加する訪問先はありませんでした。」。
  - 終わり `mergeDoneText`: 「N人を追加しました。」、地点があれば「N人・お役立ち地点K件を追加しました。」。
- 入れ替え(replace)の文は今のまま。
- [ ] **Step 1: テスト**: `backup.test.ts` — 手元にいる人は `write.patients` に入らない/写真は新しい人の分だけ・4枚目は入らない/地点は重複 id を除く/office・routeEnds は手元が未設定のときだけ/`added`・`kept` の数/3つの文(M=0・N=0 を含む)。`main.test.ts` — 手元の人の位置・メモ・許可証の期限を変えたあと、同じ人を含むバックアップを「今のデータに追加する」で読むと、手元の値が残り、新しい人だけ増える/確認の文/N=0 で確認が出ず知らせだけ/事業所が設定済みなら上書きされない。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test && npm run typecheck`
- **直す既存テスト:** `main.test.ts` 3233行あたりの `mode-merge` のテスト(上書きを期待している部分と、確認の文「${n}件…を今のデータに追加します」)。`backupFlow.test.ts` の追加の確認文。
- [ ] **Step 5:** コミット — `fix: バックアップの追加では手元の訪問先を上書きせず、いない人だけ足す`

---

### Task 5: バックアップの書き出しを DB から・2段階にする(§7)

**Files:** Modify `src/fileIo.ts`、`src/backupFlow.ts`、`src/types.ts`、`src/state.ts`(`keepDialog`)、`src/views/dialogs.ts`、`src/main.ts`、`tests/fileIo.test.ts`、`tests/backupFlow.test.ts`、`tests/dialogs.test.ts`、`tests/main.test.ts`、`tests/wording.test.ts`。

**Interfaces:**
```ts
// src/fileIo.ts(送る小窓の ready も同じ部品を使う = Task 7)
export function canShareFile(file: File): boolean;               // navigator.canShare({ files: [file] }) が真
/** 押した処理の中から直接呼ぶ。最初の await より前に navigator.share を呼ぶ。AbortError は 'cancelled'。 */
export function shareFile(file: File): Promise<'shared' | 'cancelled' | 'failed'>;
export function downloadFile(file: File): void;                    // 今の非公開の関数を export
export function downloadLocationHint(platform: InstallPlatform): string;
// ios: 「ファイルは「ファイル」アプリの「ダウンロード」に入ります。」
// android: 「ファイルは「ダウンロード」に入ります。」 pc: 「ファイルはダウンロードのフォルダに入ります。」
// types.ts
export type BackupSaveDialog = {
  kind: 'backupSave';
  phase: 'ready' | 'done';
  fileName: string;
  canShare: boolean;
  result: 'shared' | 'downloaded' | null;   // done のとき
};
// backupFlow.ts
createBackupFlow(ctx, hooks): {
  handleExport(includePhotos?: boolean): Promise<void>;  // ファイルを作って backupSave(ready) を開く
  saveExport(): void;                                    // 「保存する」。押した処理の中から呼ぶ
  discardExport(): void;                                 // 小窓が backupSave でなくなったとき(main.ts の setState)
  handleImport(file: File, mode: 'replace' | 'merge'): Promise<void>;
  isWorking(): boolean;                                  // 読み込みの書き込み中(Task 8)
};
```
- `handleExport`: DB から `listPatients`・(写真を含めるなら)`listAllPhotos`・`listSpots`・`getMeta('office')`・`getMeta('routeEnds')` を読む。読めなければ「データを読めなかったので書き出しませんでした。」、訪問先0件なら「書き出す訪問先がありません。」(どちらも `ctx.showMessage` の error、ファイルは作らない)。作った `File`(`route-auto-input-YYYY-MM-DD.json`、`application/json`)は flow の中の変数に持ち、state には入れない。
- 小窓(ready): 見出し「バックアップのファイルができました」、`backup-save-button`「保存する」(primary)、`dialog-cancel`「やめる」。共有できない端末では `backup-save-hint` に `downloadLocationHint(installPlatform())`。
- `saveExport`: 共有できれば `shareFile` → 'shared' なら記録して done/'cancelled' なら ready のまま(記録しない)/'failed' ならダウンロードへ。共有できなければ `downloadFile` して記録して done。記録 = `setMeta('lastBackupAt')` と `settingsInfo`(失敗しても done は出す。今と同じ)。
- done: `backup-done-text`「バックアップを保存しました。」(共有)/「バックアップのファイルを保存しました。」+ 保存先の案内(ダウンロード)、`dialog-cancel`「閉じる」。
- `downloadTextFile` と `shareOrDownloadFile` は使われなくなるので消す(Task 7 の後も使わない)。
- main.ts: `setState` に「前の小窓が `backupSave` で次がそうでない → `backupFlow.discardExport()`」を、受け取りの破棄の隣に足す。`RETURN_TARGETS` に `__backup: 'export-button'`。一覧のお知らせの「今すぐバックアップ」も `handleExport()` を呼ぶ(小窓が開く)。`keepDialog` は `backupSave` をそのまま残す。
- [ ] **Step 1: テスト**: `fileIo.test.ts` — `canShareFile`(canShare 無し/偽/真)、`shareFile` が await より前に `navigator.share` を呼ぶ(呼び出しの直後、同期で spy が1回)・AbortError で 'cancelled'・その他で 'failed'、`downloadLocationHint` の3種。`backupFlow.test.ts` — 画面の state に訪問先がいても DB が0件なら「書き出す訪問先がありません。」/`listPatients` が失敗すると「データを読めなかったので書き出しませんでした。」で `lastBackupAt` は変わらない/共有を取り消すと記録しない/共有・ダウンロードで記録する。`main.test.ts` — 設定の「書き出す」→ 小窓 →「保存する」でファイルの中身が DB の内容、「最後のバックアップ」が変わる。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test`(2回)・`npm run typecheck`
- **直す既存テスト:** `backupFlow.test.ts` 53行(`downloadTextFile` の spy → 小窓と `downloadFile`)、`main.test.ts` 2981〜2998行(書き出し)、`notice-backup` を押すテスト、`fileIo.test.ts` の `shareOrDownloadFile`・`downloadTextFile`。
- [ ] **Step 5:** コミット — `fix: バックアップはデータベースから書き出し、「保存する」で共有かダウンロードを選べるようにする`

---

### Task 6: 引き継ぎの上書きで手元の項目を残す(§9)、パスワードの強さ(§10)

**Files:** Modify `src/transfer.ts`(`overwritePatient`)、`src/config.ts`、`src/crypto.ts`、`src/transferFlow.ts`、`src/views/transferDialog.ts`、`src/views/settingsView.ts`、`src/main.ts`(`loadSettingsInfo`・`handleSaveSharedSecret`)、`tests/transfer.test.ts`、`tests/crypto.test.ts`、`tests/transferFlow.test.ts`、`tests/transferDialog.test.ts`、`tests/settingsView.test.ts`、`tests/main.test.ts`、`tests/wording.test.ts`。

**Interfaces:**
```ts
// config.ts
export const MIN_PASSWORD_LENGTH = 10;
// crypto.ts(新しく作るファイルだけ。iter が書いてあるので 200,000 回の今のファイルも開ける。上限 MAX_ITERATIONS 2,000,000 は変えない)
export const PBKDF2_ITERATIONS = 600_000;
// settingsView.ts
export type SettingsInfo = { /* 今の項目 */ sharedSecretShort: boolean }; // 保存済みの合言葉が10文字未満
```
- 上書き(§9): 名前・住所は送り手の値。電話・位置・駐車・メモは、送り手が未設定(`undefined` または空文字)なら手元の値を残す。駐車が送り手にあっても、種類が `street_permit` で期限が無く、手元が `street_permit` で期限があれば、手元の期限を残す。写真の決まり(0枚なら手元を残す)は変えない。
- パスワード(§10):
  - 送る小窓・設定の合言葉の説明: 「10文字以上。言葉をつなげると覚えやすくなります(例: さくら訪問2026秋)」。短いときの文: 「パスワードは10文字以上にしてください。」・「10文字以上にしてください。」(`MIN_PASSWORD_LENGTH` から作る今の形のまま)。
  - `loadSettingsInfo` で `sharedSecretShort = sharedSecret !== undefined && sharedSecret.length < MIN_PASSWORD_LENGTH`。
  - 送る: `openSend` で `sharedSecretShort` なら `useSharedSecret: false` と `error: '事業所の合言葉が短いので、10文字以上に変えてください。'` で開く。`resolvePassword` でも読んだ合言葉が短ければ同じにする(開いた後に変わった場合)。
  - 受け取り: 短い合言葉でも今までどおり自動で試す(変えない)。
  - 設定: 設定済みで短ければ「設定されています」の下に `shared-secret-short`「10文字以上に変えてください」(error の色)。保存すると `sharedSecretShort: false`。
- 既定の回数を使う結合テスト(送ってから `decryptText` する `main.test.ts` のもの)は1回あたり時間が延びるので、そのテストの `vi.waitFor` の timeout を 10000 にする(待ち時間を固定するのではなく、上限を延ばす)。
- [ ] **Step 1: テスト**: `transfer.test.ts` — 送り手に電話・位置・駐車・メモが無い上書きで手元の値が残る/送り手にあれば送り手の値/許可証の期限の残し方/名前・住所は送り手。`crypto.test.ts` — 既定の回数で作ったファイルの `iter` が 600000、`iter: 200000` のファイルが開ける。`transferFlow.test.ts` — 9文字のパスワードは「パスワードは10文字以上にしてください。」/保存済みの合言葉が `'short-123'`(9文字)なら、開いたとき `useSharedSecret: false` と短い旨の error/受け取りは短い合言葉で自動で開ける。`settingsView.test.ts` — `sharedSecretShort` の表示、説明の文。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test`(2回)・`npm run typecheck`
- **直す既存テスト:** `transfer.test.ts` の「送られてきた側に無い項目は外す」上書きのテスト。`crypto.test.ts` の「既定の回数は 200,000」。`main.test.ts` 1556・1570行(「6文字以上」「空白で始まる6文字」→ 10文字)、1690〜1874行ほかの `'abcdef'`(→ `'sakura-2026'` などの10文字以上)、1712行(「6文字未満」→「10文字未満」)。`transferFlow.test.ts`・`transferDialog.test.ts`・`settingsView.test.ts` の6文字の値と文。
- [ ] **Step 5:** コミット — `fix: 引き継ぎの上書きで手元の項目を残し、パスワードを10文字以上・反復60万回にする`

---

### Task 7: 「送る」を2段階にする(§11)

**Files:** Modify `src/types.ts`、`src/transferFlow.ts`、`src/views/transferDialog.ts`、`src/views/dialogs.ts`(`DialogHandlers`)、`src/state.ts`、`src/main.ts`、`tests/transferFlow.test.ts`、`tests/transferDialog.test.ts`、`tests/main.test.ts`、`tests/wording.test.ts`。

**Interfaces:**
```ts
// types.ts
export type TransferSendDialog = { /* 今の項目 */ phase: 'form' | 'working' | 'ready' | 'done'; canShare: boolean };
// transferFlow.ts
createTransferFlow(ctx): {
  /* 今の関数 */
  submitSend(): Promise<void>;   // 「ファイルを作る」: form → working → ready(window.confirm はしない)
  shareSendFile(): void;         // ready の「LINEなどで送る」。押した処理の中から呼ぶ(shareFile を最初に呼ぶ)
  saveSendFile(): void;          // ready の「ファイルを保存」(downloadFile)
  discardSendFile(): void;       // 小窓が transferSend でなくなったとき(main.ts の setState)
};
// dialogs.ts の DialogHandlers に足す
onSendShare(): void; onSendSave(): void;
```
- 流れ: form の `transfer-send-button` の文を「ファイルを作る」に変える → `submitSend`(パスワードの検査 → `working`「ファイルを作っています…」(`transfer-working-text`)→ 写真の変換・`serializePayload`・`encryptText`・`new File(…)` → flow の変数 `readyFile` に持つ → `ready`、`canShare: canShareFile(file)`)。
- ready の画面: 共有できれば `transfer-share-button`「LINEなどで送る」(primary)。できなければ `transfer-save-button`「ファイルを保存」(primary)と `transfer-save-hint`(`downloadLocationHint(installPlatform())`)。どちらも `dialog-cancel`「やめる」。上の注意書き(`transfer-warning`)は ready でも出す。
- `shareSendFile`: `shareFile(readyFile)` → 'shared' で done(`shared: true`)/'cancelled' で ready のまま(もう一度押せる)/'failed' で `downloadFile` して done(`shared: false`)。`saveSendFile`: `downloadFile` → done。`saveAsShared` の保存は done にするときに行う(今と同じ場所)。
- done の文は今のまま(「送りました。」/「ファイルを保存しました。LINE などで送ってください。」)。ダウンロードのときは下に保存先の案内も出す。
- `CONFIRM_MESSAGE` と `ctx.confirm` の呼び出しを消す。`File` は state に入れない。main.ts の `setState` で「前の小窓が `transferSend` で次が違う → `transferFlow.discardSendFile()`」。
- `closeAnyDialog` の working のガードは今のまま(ready は閉じられる)。
- [ ] **Step 1: テスト**: `transferFlow.test.ts` — `submitSend` の後 `phase: 'ready'`、`ctx.confirm` を呼ばない/ready で `shareSendFile` を呼ぶと、同じ同期区間で `navigator.share` が呼ばれる(`shareSendFile()` の直後に spy が1回)/取り消しで ready のまま/`saveSendFile` で done/小窓を閉じた後の `shareSendFile` は何もしない。`transferDialog.test.ts` — 各 phase のボタンと文。`main.test.ts` — 1人を「⋯」から送る:「ファイルを作る」→「LINEなどで送る」→ 共有の偽物に渡った File を `decryptText` すると名前・メモ・位置・写真が入っている/共有できない端末では「ファイルを保存」と保存先の案内。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test`(2回)・`npm run typecheck`
- **直す既存テスト:** `transferFlow.test.ts` 190〜260行(confirm を確かめるもの → 「confirm は呼ばない」1件に)。`transferDialog.test.ts` の「送る」ボタンの文。`main.test.ts` の送るテスト(1690〜1960行: `window.confirm` の spy を外し、`transfer-share-button` を押す手順を足す。1771行の「確認で『キャンセル』なら何も作らない」は削除)。
- [ ] **Step 5:** コミット — `fix: 送るはファイルを作ってから「LINEなどで送る」を押す2段階にし、共有画面が確実に開くようにする`

---

### Task 8: 自動更新の読み直しを待たせる(§6)

**Files:** Modify `src/swUpdate.ts`、`src/main.ts`、`tests/swUpdate.test.ts`。

**Interfaces:**
```ts
// src/swUpdate.ts
export type ReloadGate = {
  /** 新しい版が有効になった(onNeedReload)・DB の blocking。読み直してよければすぐ、だめなら覚えておく。 */
  request(): void;
  /** 覚えていて、今は読み直してよければ読み直す。main.ts の setState の最後で毎回呼ぶ。 */
  check(): void;
  isPending(): boolean;
};
export function createReloadGate(options: { canReload(): boolean; reload(): void }): ReloadGate;
/** 本番だけ registerSW({ immediate: true, onNeedReload }) を呼ぶ。 */
export function registerServiceWorkerUpdates(onNeedReload: () => void): void;
```
- main.ts: `const reloadGate = createReloadGate({ canReload: isSafeToReload, reload: () => window.location.reload() })`、`registerServiceWorkerUpdates(() => reloadGate.request())`、`setDbBlockingHandler(() => reloadGate.request())`(Task 2 の口)。
- `isSafeToReload()`: `state.screen.name !== 'form' && state.dialog === null && !savingPatient && !deletingSelected && deletingPatientIds.size === 0 && !savingSpot && !backupFlow.isWorking()`(小窓の `working` は `dialog !== null` に含まれる)。
- `setState` の最後(描き直しの判定の前、`render: false` でも)に `reloadGate.check()`。`onImport` は `backupFlow.handleImport(...).finally(() => reloadGate.check())`。
- 待っていることは画面に出さない。
- 待たせている間に古い版の後から読むファイル(`crypto`・`transfer`・`transferReceive` のチャンク)が消えていても、今の `catch` の文(「送るファイルを作れませんでした。」「引き継ぎのファイルを開けませんでした。」)が出る。README の試運転に入れる(Task 14)。
- [ ] **Step 1: テスト(`swUpdate.test.ts`)**: `canReload` が真なら `request` ですぐ `reload`/偽なら呼ばず `isPending()` が真 → `canReload` を真にして `check` で1回だけ `reload` → もう一度 `check` しても呼ばない/`request` の前の `check` は何もしない。`registerServiceWorkerUpdates(fn)` は本番でないと何もしない。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test && npm run typecheck`、`npm run build` で index の大きさを記録。
- **直す既存テスト:** `swUpdate.test.ts` の既存1件(引数を渡す形に)。
- [ ] **Step 5:** コミット — `fix: 新しい版への読み直しを、入力中・小窓・書き込み中は待たせる`

---

### Task 9: iPhone のホーム画面追加の前と後の案内(§2)

**Files:** Modify `src/platform.ts`、`src/installHint.ts`、`src/views/dialogs.ts`(`renderInstallSteps`)、`src/views/settingsView.ts`(バックアップの節に `data-testid="backup-section"`)、`src/main.ts`(`currentNotice`)、`tests/platform.test.ts`、`tests/installHint.test.ts`、`tests/dialogs.test.ts`、`tests/main.test.ts`、`tests/wording.test.ts`。

**Interfaces:**
```ts
// platform.ts(iPadOS の Mac と同じ UA も 'ios')
export function installPlatform(): InstallPlatform;
// installHint.ts
export function installSteps(platform: InstallPlatform, options?: { withBackup?: boolean }): string[];
export function shouldShowMovedDataHint(input: {
  platform: InstallPlatform; standalone: boolean; patientsLoaded: boolean; patientCount: number; dismissed: boolean;
}): boolean; // ios かつ standalone かつ読み込み済みで0件かつ閉じていない
```
- 追加前: `installSteps('ios', { withBackup: true })` は、先頭に「設定 → バックアップを書き出す(写真も含める)」、その後に今の3つ、最後に「追加したアプリを開いたら、設定の『読み込む』でこのファイルを読み込んでください」。`renderInstallSteps` は `state.patients.length > 0` のとき `withBackup: true`(ios 以外は無視)。
- 追加後: `currentNotice` の先頭で `shouldShowMovedDataHint` が真なら、`testid: 'moved-data-notice'`、文「Safari で使っていた場合は、書き出したバックアップのファイルを読み込むと、今までの訪問先が入ります。」、`notice-moved-import`「読み込む画面へ」(primary: 設定の画面を開き `loadSettingsInfo()`、描いた後に `[data-testid="backup-section"]` を `scrollIntoView({ block: 'start' })`)、`notice-moved-dismiss`「閉じる」(localStorage `route-auto-input:moved-data-dismissed` に日時。以後出さない)。
- `patientsLoaded`: main.ts に `let patientsLoaded = false`、`reloadPatients` が1回終わったら(成功・失敗とも)真。読み込み前に0件で案内が一瞬出るのを防ぐ。
- テストでは `navigator.userAgent`・`navigator.standalone`・`maxTouchPoints` を `Object.defineProperty` で差し替え、`Element.prototype.scrollIntoView = vi.fn()`(jsdom に無い)。
- [ ] **Step 1: テスト**: `platform.test.ts` — iPhone/Android/Windows/`Macintosh`+`maxTouchPoints 5`=ios/`Macintosh`+0=pc。`installHint.test.ts` — `withBackup` の手順が5つで1番目と5番目の文/`shouldShowMovedDataHint` の各条件。`main.test.ts` — iPhone のホーム画面アプリで0件なら案内 →「読み込む画面へ」で設定が開き `scrollIntoView` が呼ばれる/「閉じる」で以後出ない/1件以上なら出ない/Safari で1件以上なら手順の小窓に「バックアップを書き出す」。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test && npm run typecheck`
- **直す既存テスト:** `installHint.test.ts` は形を変えない(引数1つの呼び出しは今までどおり)。`dialogs.test.ts` の手順の件数を数えるものがあれば、ios で `patients` が空の場合に限る。
- [ ] **Step 5:** コミット — `feat: iPhone でホーム画面に追加する前と後に、バックアップでデータを移す案内を出す`

---

### Task 10: 縦に長い小窓(§12)と、地図の画面の行の折り返し(§13)

**Files:** Modify `src/styles.css`、`src/views/routeMapView.ts`(`renderStops`)、`tests/styles.test.ts`、`tests/routeMapView.test.ts`。

- `.sheet` に、`max-height: calc(100vh - 2rem - env(safe-area-inset-top) - env(safe-area-inset-bottom));` を先に、次の行に `max-height: calc(100dvh - 2rem - env(safe-area-inset-top) - env(safe-area-inset-bottom));`、`overflow-y: auto;`、`overscroll-behavior: contain;`。
- 初期フォーカスは `focus()` のブラウザの既定のスクロールに任せる(Task 14 の通しの確認で見る。見えなければ `render()` のフォーカスの後に `scrollIntoView({ block: 'nearest' })` を足す)。
- 地図の行: `renderStops` の ☎・写真・位置・済 を `<div class="route-stop-actions">` にまとめる(名前の欄 `.route-stop-main` と2つの子にする)。CSS: `.route-stops li { flex-wrap: wrap; }`、`.route-stop-main { flex: 1 1 8em; min-width: min(8em, 100%); }`、`.route-stop-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-left: auto; }`。入りきらなければボタンが名前の下の2段目に回る。
- [ ] **Step 1: テスト**: `styles.test.ts` — `.sheet` の `max-height` が `100vh` の行の後に `100dvh` の行、`overflow-y: auto`、`overscroll-behavior: contain`/`.route-stops li` に `flex-wrap: wrap`、`.route-stop-main` に `min-width: min(8em, 100%)`。`routeMapView.test.ts` — 行の子が `.route-stop-main` と `.route-stop-actions` の2つで、☎・写真・位置・済は後者の中。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test && npm run typecheck`
- **直す既存テスト:** `routeMapView.test.ts` で `li` の直接の子のボタンを数えるものがあれば `.route-stop-actions` の中を数える。
- [ ] **Step 5:** コミット — `fix: 縦に長い小窓をスクロールでき、地図の画面で名前が隠れないようにする`

---

### Task 11: 選択バーを1段に、一覧の上に残すのは検索欄だけ(§17)

**Files:** Modify `src/views/selectionBar.ts`、`src/types.ts`(`Dialog` に `{ kind: 'selectionMenu' }`)、`src/state.ts`(`keepDialog`)、`src/views/dialogs.ts`、`src/views/patientListView.ts`、`src/styles.css`、`src/main.ts`、`tests/selectionBar.test.ts`、`tests/dialogs.test.ts`、`tests/patientListView.test.ts`、`tests/styles.test.ts`、`tests/main.test.ts`、`tests/wording.test.ts`。

**Interfaces:**
```ts
// selectionBar.ts
export type SelectionBarHandlers = {
  onNext(): void;
  onShowSelected(): void;
  /** 「⋯」。送る・削除の小窓を開く。 */
  onOpenMenu(): void;
};
// dialogs.ts の DialogHandlers に足す
onSendSelected(): void; onRequestDeleteSelected(): void;
```
- 選択バー: `selection-count`「N件選択中」・`selection-menu-button`「⋯」(`aria-label`「選択中の訪問先の操作」、`aria-haspopup="dialog"`)・`next-button`「訪問順を決める →」の1段。
- 小窓 `selectionMenu`(行の「⋯」と同じ `sheet-actions` の形): 見出し「N件選択中」、`send-selected-button`「送る」、`delete-selected-button`「削除」(danger)、`dialog-cancel`「キャンセル」。「送る」は送る小窓に、「削除」は今の確認の小窓に置き換わる。`keepDialog` は選択が1件以上なら残す。
- `RETURN_TARGETS`: `__send-selected` の戻り先を `selection-menu-button` にし、`__selection-menu: 'selection-menu-button'` を足す(削除の確認を閉じたときも「⋯」へ戻る)。
- 一覧: `.list-head` から検索の行を出し、`.screen` の直接の子として `head → list-search-row → list-controls` の順に並べる(sticky は親の中でしか効かないため)。`.list-head` の `position: sticky` を外し、`.list-search-row { position: sticky; top: 0; z-index: 10; background: var(--bg); padding: 0.5rem 0; }`。
- CSS: `--selbar-h` は `4rem` の1つだけ。`@media (max-width: 30rem)` から `--selbar-h: 7.5rem`・`.selection-actions` の2つの指定と、その上の説明のコメントを消す(同じ `@media` の `.ends-panel .ends-row` は残す)。`.selection-bar` の `flex-wrap: wrap` を `nowrap` に、`.selection-actions` は「⋯」と「訪問順を決める →」の2つ。
- [ ] **Step 1: テスト**: `selectionBar.test.ts` — testid の並びが `['selection-count', 'selection-menu-button', 'next-button']`。`dialogs.test.ts` — `selectionMenu` の中身。`styles.test.ts` — `--selbar-h` の定義が1つだけ・`@media (max-width: 30rem)` に `--selbar-h` が無い・`.list-search-row` が sticky・`.list-head` が sticky でない。`patientListView.test.ts` — 検索の行が `.list-head` の外。`main.test.ts` —「⋯」→「送る」で選択中の全員の送る小窓/「⋯」→「削除」で件数つきの確認/閉じるとフォーカスが「⋯」へ。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test && npm run typecheck`
- **直す既存テスト:** `selectionBar.test.ts` 44・61行。`styles.test.ts` 154〜172行の選択バーの2件(2段の指定を確かめている)。`main.test.ts` 1204〜1251行(`delete-selected-button` の前に `selection-menu-button` を押す)、1846〜1862行と1945〜1961行(送る。フォーカスの戻り先は `selection-menu-button`)。
- [ ] **Step 5:** コミット — `fix: 選択バーを1段にして「⋯」から送る・削除を選び、一覧の上に残すのを検索欄だけにする`

---

### Task 12: 「全解除」「先週と同じ」「履歴から選ぶ」の元に戻す(§14)

**Files:** Modify `src/state.ts`、`src/views/routeOrderView.ts`(お知らせを受け取る)、`src/main.ts`、`tests/state.test.ts`、`tests/routeOrderView.test.ts`、`tests/main.test.ts`、`tests/wording.test.ts`。

**Interfaces:**
```ts
// state.ts
/** 見えている行だけ選択を外す。検索していなければ今の clearSelection と同じ(全部外し、表示を「すべて」へ)。 */
export function clearVisibleSelection(state: AppState): AppState;
// main.ts(AppState の外に持つ。openedRoutes と同じ扱い)
type SelectionUndo = {
  text: '選択を外しました' | '選択を置き換えました';
  before: { selectedIds: string[]; opened: [number, string][]; routeEnds: RouteEnds };
  after: readonly string[];          // 操作の後の selectedIds(この配列のままの間だけ出す)
  screen: Screen['name'];            // 操作の後の画面
};
let selectionUndo: SelectionUndo | null = null;
// routeOrderView.ts
export function renderRouteOrder(state: AppState, context: RouteContext, handlers: RouteOrderHandlers, notice?: Notice | null): HTMLElement;
```
- `handleToggleSelectAll`: 全解除のときは `clearVisibleSelection`。全選択/全解除の判定は今のまま(見えている行)。外す前が0件なら知らせを出さない。
- `pickHistory`(先週と同じ・履歴から選ぶ): 確認なし。置き換える前の選択が1件以上なら「選択を置き換えました」。
- 知らせ: `renderNotice({ testid: 'undo-notice', text, actions: [{ label: '元に戻す', testid: 'undo-button', primary: true, onClick: undoSelection }] })`。一覧では `currentNotice()` より先に、訪問順では見出しの下に出す。
- 作る時点: `setState` を呼ぶ前に、`after` へ次の state の `selectedIds`(同じ配列)を、`screen` へ次の画面の名前を入れて作る。
- 消える: `setState` の中で `selectionUndo && (next.selectedIds !== selectionUndo.after || next.screen.name !== selectionUndo.screen)` なら `null`(次に選択を変える・画面を移る)。
- `undoSelection`: `openedRoutes` を `before.opened` に、`routeContext.ends` を `before.routeEnds` に戻し(`setMeta('routeEnds')` も)、`setState({ ...state, selectedIds: before.selectedIds, dimmedIds: [], message: null })`、`selectionUndo = null`。画面はそのまま。
- [ ] **Step 1: テスト**: `state.test.ts` —「山田」で検索中に全解除すると、見えている人だけ外れ、ほかの選択は残る/検索なしなら全部外れて listFilter が 'all'。`main.test.ts` — 3人選んで全解除 →「選択を外しました」→「元に戻す」で3人・同じ順番/0件のときは出ない/別の人を選ぶと消える/先週と同じで置き換え → 訪問順の画面に「選択を置き換えました」→「元に戻す」で前の選択と順番と出発帰着、開いたルートの印も戻る/設定に移ると消える。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test && npm run typecheck`
- **直す既存テスト:** `main.test.ts` の全解除のテスト(検索中の全解除で全部外れることを期待しているものがあれば、見えている行だけに)。`state.test.ts` の `clearSelection` は変えない。
- [ ] **Step 5:** コミット — `feat: 全解除と「先週と同じ」「履歴から選ぶ」を、知らせの「元に戻す」で取り消せるようにする`

---

### Task 13: 戻るボタン(§15)と、画面を移ったら一番上から(§16)

**Files:** Create `src/backNav.ts`、`tests/backNav.test.ts`。Modify `src/main.ts`、`src/views/patientFormView.ts`(値の読み出しを export)、`tests/main.test.ts`。

**Interfaces:**
```ts
// src/backNav.ts
/** 戻る記録の深さ。一覧0、訪問順・登録編集・設定・履歴1、地図2。小窓が開いていれば+1。 */
export function navDepth(screen: Screen['name'], hasDialog: boolean): number;
/** popstate の state から着いた深さを読む(無ければ0)。 */
export function arrivedDepth(historyState: unknown): number;
// patientFormView.ts
export function readPatientFormValues(root: ParentNode): PatientFormDraft | null; // 登録画面が無ければ null
// main.ts
function syncBackStack(): void;          // setState の中で毎回。今の深さ current と navDepth(state) を合わせる
function handlePopState(event: PopStateEvent): void;
```
- 記録: `history.pushState({ nav: n }, '')`。main.ts は「今いる記録の深さ」`backDepth` を持つ。起動時(`startApp`)に `backDepth = arrivedDepth(history.state)`、`history.state` が無ければ `replaceState({ nav: 0 }, '')`、続けて `syncBackStack()`(地図から始まれば2つ積む)。
- `syncBackStack()`: `target = navDepth(state.screen.name, state.dialog !== null)`。`target > backDepth` なら差の数だけ `pushState({ nav: backDepth + 1 … target })`。`target < backDepth` なら `history.go(target - backDepth)`(アプリの中の「戻る」「キャンセル」「閉じる」・Esc・背景で閉じたとき。二重に戻らない)。その後 `backDepth = target`。
- `handlePopState`: `arrived = arrivedDepth(event.state)`、`backDepth = arrived`。`navDepth(今) <= arrived` なら何もしない(自分の `history.go` で着いた)。そうでなければ次を1段ずつ、今の深さが `arrived` 以下になるか、進めなくなるまで:
  1. 小窓が開いていれば `closeAnyDialog()`(`working` なら閉じない)。
  2. 登録・編集なら `handleFormCancel(readPatientFormValues(root) ?? formDraft ?? 空の下書き)`(「入力中の内容を捨てますか?」でいいえならとどまる)。
  3. 訪問順→一覧、地図→訪問順、設定・履歴→一覧(アプリの中の「戻る」と同じ)。
  この処理の間は、`setState` の中の `syncBackStack()` を止める(同期の処理の中だけの `handlingPop`。1段ごとに積んだり戻したりしないため)。最後に `syncBackStack()` を1回(とどまったときは記録を積み直す)。一覧で何も開いていなければ深さ0なので何もしない(ブラウザの既定どおり出る)。
- リスナーは Esc と同じやり方で `window.__routeAutoInputPopStateHandler` に覚え、読み込み直しで積み重ならないようにする。
- 地図から戻ってきたとき(`loadSession` での復元)の選択・順番は変えない。
- §16: `render()` で、前に描いた画面の名前(`lastRenderedScreen`)と `state.screen.name` が違うときだけ `window.scrollTo(0, 0)`。同じ画面の描き直し(選択・入力・GPS・履歴の日付を開く)では動かさない。Task 9 の「読み込む画面へ」は描いた後に `scrollIntoView` するので、この後に効く。
- テスト: `main.test.ts` の `beforeEach` で `window.scrollTo = vi.fn()`(jsdom に無い)、`history.replaceState(null, '')`。
- [ ] **Step 1: テスト**: `backNav.test.ts` — 各画面と小窓の深さ、`arrivedDepth` の不正な値は0。`main.test.ts`(`window.dispatchEvent(new PopStateEvent('popstate', { state: { nav: n } }))`): 一覧で「⋯」→ 戻るで小窓が閉じる/訪問順 → 戻るで一覧/地図 → 戻るで訪問順/登録で入力中に戻る →「入力中の内容を捨てますか?」でいいえならとどまり `pushState` が呼ばれる、はいなら一覧/送るの `working` 中は閉じない/訪問順の「戻る」ボタンで `history.go(-1)` が1回だけ呼ばれ、続く `{ nav: 0 }` の popstate では何も起きない/一覧 → 設定で `scrollTo(0, 0)`、一覧で行を選んでも呼ばれない。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test`(2回)・`npm run typecheck`、`npm run build` で index の大きさを記録。
- **直す既存テスト:** 無し(`beforeEach` に2行足すだけ)。
- [ ] **Step 5:** コミット — `feat: 端末の戻るボタンで小窓を閉じ・前の画面へ戻れるようにし、画面を移ったら一番上から出す`

---

### Task 14: 仕上げ(ビルド・README・通しの確認)

- [ ] `npm test`(2回)・`npm run typecheck`・`npm run build`。index の JS が 120KB 以内、`crypto-*.js`・`transfer-*.js`・`transferReceive-*.js` が別のファイルのままであることを記録。120KB を超えたら、`backupFlow.ts` を `import()` にする(「書き出す」「読み込む」「今すぐバックアップ」を押したときに読み込む。「保存する」を押す時には読み込み済みなので、共有は押した処理の中のまま)。
- [ ] 通しの確認(コントローラーが本番と同じビルドを手元で動かす。320×568・375×667・667×375(横向き)、明るい/暗い):
  - 送る(合言葉なし)・位置の登録(貼り付けを開いた状態)・受け取りの同じ人の画面で、小窓の一番上と一番下に届く。初期フォーカスが見える。
  - 地図の画面で、長い名前・☎・写真あり・済 HH:MM でも名前が1行以上の幅で見え、はみ出さない(320・375)。
  - 375×553・320×568 で、1人以上選んだとき一覧が2行以上見える。検索欄だけが上に残る。
  - 「⋯」→ 送る/削除、全解除 →「元に戻す」、先週と同じ →「元に戻す」。
  - 戻る(ブラウザの戻る)で小窓 → 画面の順に戻り、一覧で止まらずに出る。画面を移ると一番上から。
  - 書き出す →「保存する」(PC はダウンロードと保存先の案内)、送る →「ファイルを作る」→「ファイルを保存」。
  - 現在地からで10件選ぶと2本に分かれ、説明が「9件まで」。
- [ ] README の「試運転で確かめること」に足す: iPhone のホーム画面追加の案内とバックアップの受け渡し(Safari で書き出し →「"ファイル"に保存」→ ホーム画面のアプリで「読み込む画面へ」)/「LINEなどで送る」で共有画面が出る/建物名つきの住所の案内先(例: 山下町279 の建物名つき)/現在地からの9件ルートで経由地がすべて出る/Googleマップから戻って「済」を繰り返す(保存できないと「訪問の記録を保存できませんでした。」)/Android の戻るボタン/横向きの送る画面/新しい版の公開直後に送る・受け取ると失敗の文が出ることがある(もう一度開けば直る)。「主な機能」に、戻るボタン・元に戻す・保存するの2段階を1行ずつ。
- [ ] コミット — `docs: 段階5の手直しと、試運転で確かめることを README に書く`

---

## Self-Review

- §1 建物名を外す → Task 1(`addressForMaps`・`pointOf`・事業所・登録画面の地図、表の例)。
- §2 iPhone の案内(追加前の手順・追加後のカード・端末の判定) → Task 9。
- §3 追加(いない人だけ・写真・地点・meta・確認と終わりの文・N=0) → Task 4。
- §4 DB のつながり(terminated・blocking・blocked・失敗の Promise を捨てる・`withDb` の1回のやり直し・訪問の記録の失敗の文) → Task 2(blocking の読み直しは Task 8 で門番へ)。
- §5 一続きの書き込み・削除と写真・起動時の掃除 → Task 3。
- §6 自動更新を待たせる → Task 8(決定2)。
- §7 書き出しを DB から・2段階・記録の時点 → Task 5(決定6)。
- §8 経由地の数(9件・説明の文) → Task 1(決定5)。
- §9 上書きで手元を残す → Task 6。
- §10 パスワード10文字・60万回・短い合言葉・説明 → Task 6。
- §11 送るの2段階(ready・共有/保存・保存先の案内・confirm をやめる・File は flow の中・取り消しで ready) → Task 7(部品は Task 5)。
- §12 縦に長い小窓 → Task 10(確認は Task 14)。
- §13 地図の行の折り返し → Task 10(確認は Task 14)。
- §14 見えている行だけの全解除・元に戻す → Task 12(決定3・4)。
- §15 戻るボタン → Task 13(決定10)。
- §16 画面を移ったら一番上から → Task 13。
- §17 選択バー1段・検索欄だけ sticky → Task 11(決定8)。
- テストと確かめ方(純粋な関数を先に・jsdom・禁止語・fake-indexeddb で途中の失敗・通しの確認・README) → 各タスクの Step 1、Task 3 の「途中で失敗させたら何も変わらない」、Task 14。
- 数値表: `MIN_PASSWORD_LENGTH` 10・`PBKDF2_ITERATIONS` 600,000 → Task 6/現在地からの上限9 → Task 1/`--selbar-h` 1段 → Task 11。
- 型のつながり: `withDb`(Task 2)を `applyImport`(Task 3)が使う。`DbImportPlan`(Task 3)を `planBackupMerge`(Task 4)と `transferReceive` が作る。`canShareFile`・`shareFile`・`downloadFile`・`downloadLocationHint`(Task 5)を Task 7 が使う。`setDbBlockingHandler`(Task 2)と `backupFlow.isWorking`(Task 5)を Task 8 の門番が使う。`selectionMenu`(Task 11)と `SelectionUndo`(Task 12)の後に、Task 13 が `setState` へ戻る記録を足す。
