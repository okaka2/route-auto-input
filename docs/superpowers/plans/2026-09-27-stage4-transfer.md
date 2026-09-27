# 段階4: 引き継ぎ・配布(パスワード付き)実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 訪問先(位置・駐車・メモ・写真を含む)とお役立ち地点を、パスワードで暗号化したファイルにして LINE などで担当者へ送り、受け取った人が名簿に取り込めるようにする。あわせて、肥大した `main.ts` からバックアップの流れを切り出す。

**Architecture:** 暗号と送受信のデータ形は純粋なモジュール(`crypto.ts`・`transfer.ts`)に置き、Web Crypto 以外のブラウザ依存を持たない。画面の流れ(送るダイアログ・受け取りのダイアログ・取り込み)は `transferFlow.ts` に置き、`main.ts` とは小さな `AppContext` インターフェースでつなぐ。Task 1 で既存のバックアップの書き出し・読み込みを同じやり方で `backupFlow.ts` に移し、この形を先に作る。

**Tech Stack:** Vite + TypeScript(フレームワークなし)、IndexedDB(`idb`)、Web Crypto(PBKDF2・AES-GCM)、Web Share API(files)、Vitest + jsdom + fake-indexeddb。

**Spec:** `docs/superpowers/specs/2026-09-24-brushup-design.md` の 6章・8章。

## Global Constraints

- データは端末の中だけ。送るファイルは必ず暗号化(パスワード必須、6文字以上)。暗号化していない中身を、共有・ダウンロード・コンソール・localStorage に出さない。
- 画面の文言に禁止語(`tests/wording.test.ts` の `FORBIDDEN`: 患者・薬局・在宅・医療・利用者・ルート自動入力)を使わない。
- 文字は 14px 以上、タップ領域は 44px(`--tap-min`)以上。色は `styles.css` の変数だけ。明るい/暗いの両方で読めること。
- ダイアログの入力欄は、打った値を `state.dialog` に「描き直さずに」入れる(`setState(next, { render: false })`)。日本語の変換中は描き直さない(段階3の仕組みをそのまま使う)。
- `src/` にテスト専用の分岐やフラグを入れない。テストに固定の待ち時間(sleep)を使わない。
- TDD: テスト → 失敗の確認 → 実装 → 成功の確認 → コミット。コミットは `git -c user.name=okaka2 -c user.email=okaka2@users.noreply.github.com commit` で、末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。push は利用者の確認を得てから。
- コマンドはリポジトリ `C:\Users\owner\Desktop\route-auto-input` で実行。`npm test`、`npx vitest run tests/<name>.test.ts`、`npm run typecheck`。
- ビルドの JS(index)は目安 120KB 以内。暗号の処理は `import()` で使うときだけ読み込む。

## 設計書から変えたこと(このプランの決定)

1. **ファイルは `.txt`(`text/plain`)にする**(設計書は `.hrv`)。Android の共有メニューは `text/plain` や画像などの決まった種類しか受け付けず、iPhone のファイル選択は知らない拡張子を選べないことがあるため。中身の先頭の `format: 'houmon-transfer'` で見分ける。ファイル名は `訪問先の引き継ぎ_YYYY-MM-DD.txt`。
2. **「共有で受け取ったファイルをアプリで直接開く」は今回入れない**。PWA の share_target は独自の service worker が要り、今の自動生成の仕組みを作り替えることになるため。受け取った人はファイルを保存し、設定の「読み込む」で選ぶ(読み込むが自動で見分ける)。
3. 暗号ファイルの形は `{ format: 'houmon-transfer', v: 1, iter: 200000, salt, iv, data }`(`iter` を持たせ、将来回数を変えても読めるようにする。`salt`/`iv`/`data` は base64)。
4. 受け取った訪問先は、新しく足す人には新しい id を振る(送った側の id と偶然ぶつかっても壊れないように)。「上書き」は、手元の人の id のまま中身を入れ替える。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/appContext.ts` (新規) | `main.ts` の状態を流れ(flow)から触るための小さなインターフェース。**Task 1** |
| `src/backupFlow.ts` (新規) | バックアップの書き出し・読み込み(`main.ts` から移す、動きは変えない)。**Task 1** |
| `src/crypto.ts` (新規) | パスワードからの鍵づくり・暗号化・復号、暗号ファイルの形。**Task 2** |
| `src/transfer.ts` (新規) | 送る中身の組み立てと読み取り、受け取りの突き合わせ(同じ人の検出)と取り込み計画。**Task 3** |
| `src/db.ts` | `MetaValues.sharedSecret`。**Task 4** |
| `src/views/settingsView.ts` | 「事業所の合言葉」の節、「お役立ち地点を送る」、読み込みの説明。**Task 4, 5, 6** |
| `src/fileIo.ts` | `shareOrDownloadFile(file)`。**Task 5** |
| `src/views/transferDialog.ts` (新規) | 送るダイアログ・受け取りのダイアログ(パスワード・確認・同じ人)。**Task 5, 6** |
| `src/transferFlow.ts` (新規) | 送る・受け取るの流れ。**Task 5, 6** |
| `src/types.ts`、`src/state.ts`、`src/views/dialogs.ts`、`src/views/selectionBar.ts` | ダイアログの種類と入口。**Task 5, 6** |
| `src/main.ts` | 配線だけ。 |

---

### Task 1: `AppContext` と、バックアップの流れの切り出し(動きは変えない)

**Files:** Create `src/appContext.ts`、`src/backupFlow.ts`、`tests/backupFlow.test.ts`。Modify `src/main.ts`。

**Interfaces:**
```ts
// src/appContext.ts
import type { RouteContext } from './routePlan';
import type { AppState, Message, Spot } from './types';
import type { SettingsInfo } from './views/settingsView';

/** flow のモジュールが main.ts の状態を読み書きするための口。main.ts が1つだけ作って渡す。 */
export type AppContext = {
  getState(): AppState;
  setState(next: AppState, options?: { render?: boolean }): void;
  showMessage(message: Message): void;           // setState(withMessage(...)) の近道
  getSpots(): readonly Spot[];
  getRouteContext(): RouteContext;
  setRouteContext(next: RouteContext): void;
  getSettingsInfo(): Omit<SettingsInfo, 'spots'>;
  setSettingsInfo(next: Omit<SettingsInfo, 'spots'>): void;
  clearOpenedRoutes(): void;
  reloadPatients(message?: Message): Promise<void>;
  loadSpots(): Promise<void>;
  loadPhotoCounts(): Promise<void>;
  loadPhotoBytes(): Promise<void>;
  confirm(question: string): boolean;            // window.confirm
};
```
```ts
// src/backupFlow.ts
export function createBackupFlow(ctx: AppContext): {
  handleExport(includePhotos?: boolean): Promise<void>;
  handleImport(file: File, mode: 'replace' | 'merge'): Promise<void>;
};
```
- `main.ts` の `handleExport` と `handleImport`(と、それだけが使う補助関数)を、**中身を変えずに** `backupFlow.ts` へ移す。`main.ts` は `const ctx: AppContext = { ... }` を1つ作り、`const backupFlow = createBackupFlow(ctx)` を使う。
- `window.confirm` は `ctx.confirm` 経由にする(テストでは今までどおり `vi.spyOn(window, 'confirm')` が効く — `main.ts` の ctx は `(q) => window.confirm(q)` にする)。

- [ ] **Step 1:** 移す前に、今のバックアップのテスト(`tests/main.test.ts` の書き出し・読み込み)がすべて通ることを確認し、件数を記録する。
- [ ] **Step 2:** `tests/backupFlow.test.ts` を書く: 偽の `AppContext`(`vi.fn()` と、fake-indexeddb の本物の db)で、(a) `handleExport(false)` が `downloadTextFile` に photos: null の JSON を渡す、(b) 写真の壊れた v2 ファイルの読み込みで `ctx.confirm` が呼ばれず、`ctx.showMessage` に「バックアップのファイルの写真が壊れています。」。
- [ ] **Step 3:** 失敗を確認 → 移す → `npm test && npm run typecheck`(`main.test.ts` の既存テストは1件も変えずに通ること)。
- [ ] **Step 4:** コミット — `refactor: バックアップの書き出し・読み込みを backupFlow.ts に移す`

---

### Task 2: 暗号(PBKDF2 → AES-GCM)と暗号ファイルの形

**Files:** Create `src/crypto.ts`、`tests/crypto.test.ts`。

**Interfaces:**
```ts
export const TRANSFER_FORMAT = 'houmon-transfer';
export const PBKDF2_ITERATIONS = 200_000;
export const MIN_PASSWORD_LENGTH = 6;
export type EncryptedFile = { format: typeof TRANSFER_FORMAT; v: 1; iter: number; salt: string; iv: string; data: string };
export function isEncryptedFileText(text: string): boolean;               // JSON で format が一致
export async function encryptText(plain: string, password: string, iterations?: number): Promise<string>; // EncryptedFile の JSON 文字列
export async function decryptText(fileText: string, password: string): Promise<string>;
// 失敗: パスワード違い・改ざん → Error('パスワードが違うか、ファイルが壊れています。')
//       形が違う → Error('引き継ぎのファイルではありません。')
```
- 鍵: `crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey'])` → `deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, …, { name: 'AES-GCM', length: 256 }, false, ['encrypt','decrypt'])`。`salt` 16B・`iv` 12B は `crypto.getRandomValues`。base64 は大きなデータでもスタックを溢れさせない変換(`String.fromCharCode(...大きな配列)` を使わず、区切って変換)。
- パスワードの長さの検査はここではしない(画面側)。

- [ ] **Step 1: テスト**(`iterations` はテストでは 1000 を渡して速くする):
```ts
it('暗号化して同じパスワードで戻せる(日本語・大きな中身も)', async () => {
  const plain = JSON.stringify({ x: 'あいう'.repeat(50_000) });
  const file = await encryptText(plain, 'secret-123', 1000);
  expect(isEncryptedFileText(file)).toBe(true);
  expect(file).not.toContain('あいう');
  expect(await decryptText(file, 'secret-123')).toBe(plain);
});
it('パスワードが違えば、決まった文で失敗する', async () => {
  const file = await encryptText('x', 'secret-123', 1000);
  await expect(decryptText(file, 'secret-124')).rejects.toThrow('パスワードが違うか、ファイルが壊れています。');
});
it('中身を1文字変えると失敗する(改ざんの検出)', async () => { /* data の一部を書き換えて同じ失敗 */ });
it('同じ中身でも毎回ちがう暗号になる(salt と iv が毎回変わる)', async () => { /* 2回の data・salt・iv が違う */ });
it('ほかの JSON や壊れた文字列は、引き継ぎのファイルではない', async () => {
  expect(isEncryptedFileText('{"version":2,"patients":[]}')).toBe(false);
  await expect(decryptText('abc', 'secret-123')).rejects.toThrow('引き継ぎのファイルではありません。');
});
it('既定の回数は 200,000 回で、ファイルに iter として残る', async () => { /* encryptText(plain, pw) の JSON の iter === 200000(このテストだけ既定値。時間がかかってよい) */ });
```
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test && npm run typecheck`
- [ ] **Step 5:** コミット — `feat: 引き継ぎファイルのためのパスワード暗号(PBKDF2・AES-GCM)を足す`

---

### Task 3: 送る中身の組み立て・読み取りと、受け取りの突き合わせ

**Files:** Create `src/transfer.ts`、`tests/transfer.test.ts`。(`src/backup.ts` の `toPatient`・`toBackupPhoto`・`toSpot` 相当を再利用できるよう、必要なら export する。)

**Interfaces:**
```ts
export type TransferPayload = {
  kind: 'houmon-transfer-payload';
  v: 1;
  sentAt: string;
  patients: Patient[];               // 送る訪問先(id は送った側のもの)
  photos: BackupPhoto[] | null;      // 含めないなら null
  spots: Spot[];                     // 含めないなら []
};
export function serializePayload(payload: Omit<TransferPayload, 'kind' | 'v'>): string;
export function parsePayload(text: string): TransferPayload;   // 形が違えば Error('引き継ぎのファイルの中身を読めませんでした。')。壊れた写真・地点は1件ずつ捨てる(backup.ts と同じ決まり)
/** 「山田様ほか2人」。0人なら ''。 */
export function describeRecipients(patients: readonly Patient[]): string;
export type Conflict = { incoming: Patient; existing: Patient };
/** 正規化した名前「と」住所が両方一致する人を、同じ人とみなす(normalize.ts)。 */
export function findConflicts(incoming: readonly Patient[], existing: readonly Patient[]): { conflicts: Conflict[]; fresh: Patient[] };
export type ConflictChoice = 'overwrite' | 'addNew' | 'skip';
export type ImportPlan = {
  put: Patient[];                       // 保存する訪問先(上書きは手元の id、新規は新しい id)
  photosByPatient: Map<string, Photo[]>; // 保存先の id → 写真(新しい id を振った Photo)。写真を含めないなら空
  spots: Spot[];                         // 手元に同じ id が無いものだけ
};
export function planImport(
  payload: TransferPayload, decodedPhotos: Photo[] | null, existing: readonly Patient[], existingSpotIds: ReadonlySet<string>,
  choices: ReadonlyMap<string /* incoming id */, ConflictChoice>, newId: () => string, now: Date,
): ImportPlan;
```
- 上書き: 手元の人の `id`・`createdAt` を残し、名前・住所・電話・位置・駐車・メモは送られてきたものにする(送られてきた側に無い項目は外す)。`updatedAt` は now。
- 写真: 上書き・新規とも、その人の写真は `photosByPatient` に入れ(最大3枚、送られた順)、保存時に `replacePhotosFor([id], photos)` で入れ替える。写真を含めないファイル(`photos: null`)なら、上書きでも手元の写真は残す。
- `skip` の人と、その写真は入れない。

- [ ] **Step 1: テスト**: payload の往復・壊れた写真を捨てる・`describeRecipients`(1人「山田様」、3人「山田様ほか2人」)・同じ人の検出(全角/空白/「様」の違いでも一致、住所だけ一致は別人)・`planImport` の上書き/別に追加/やめる/写真なしの上書きで写真が入らない/新規は新しい id で写真の patientId も付け替わる/地点は重複 id を除く/写真は最大3枚。
- [ ] **Step 2〜4:** 失敗の確認 → 実装 → `npm test && npm run typecheck`
- [ ] **Step 5:** コミット — `feat: 引き継ぎで送る中身と、受け取ったときの同じ人の突き合わせを足す`

---

### Task 4: 事業所の合言葉

**Files:** Modify `src/db.ts`(`MetaValues.sharedSecret: string`)、`src/views/settingsView.ts`、`src/main.ts`、各テスト、`tests/wording.test.ts`。

- 設定の「データの保存状態」の前に節「事業所の合言葉」:
  - 説明「引き継ぎのファイルを送るとき・受け取るときに、自動で使うパスワードです。事業所の人どうしで同じものにしておくと、毎回入力しなくて済みます。6文字以上。」
  - 未設定: `shared-secret-input`(type password、`autocomplete="new-password"`)と `shared-secret-save`「保存」。6文字未満なら「6文字以上にしてください。」。
  - 設定済み: 「設定されています」と `shared-secret-change`「変える」(入力欄を出す)・`shared-secret-clear`「消す」(confirm「事業所の合言葉を消しますか?」)。合言葉そのものは画面に出さない。
  - 入力欄の値は `settingsInfo` に描き直さずに保つ(`include-photos` と同じやり方)。
- `SettingsInfo.hasSharedSecret: boolean`(起動時の `loadSettingsInfo` で `getMeta('sharedSecret')` の有無)。合言葉の文字列そのものは `settingsInfo` に入れない(使うときに `getMeta` で読む)。
- [ ] テスト(表示・保存・6文字未満・変える・消す・画面に文字列が出ないこと)→ 実装 → `npm test && npm run typecheck` → コミット `feat: 引き継ぎに使う「事業所の合言葉」を設定できるようにする`

---

### Task 5: 送る(入口・ダイアログ・暗号化・共有かダウンロード)

**Files:** Create `src/views/transferDialog.ts`、`src/transferFlow.ts`、それぞれのテスト。Modify `src/types.ts`(`Dialog` に `transferSend`)、`src/state.ts`(`keepDialog`)、`src/views/dialogs.ts`(「⋯」に `dialog-send`「この訪問先を送る」)、`src/views/selectionBar.ts`(`send-selected-button`「送る」)、`src/views/settingsView.ts`(お役立ち地点の節に `send-spots-button`「お役立ち地点を送る」、地点が1件以上のとき)、`src/fileIo.ts`、`src/main.ts`、`src/styles.css`、`tests/wording.test.ts`。

**Interfaces:**
```ts
// types.ts
export type TransferSendDialog = {
  kind: 'transferSend';
  patientIds: string[];          // 空ならお役立ち地点だけを送る
  includePhotos: boolean;        // 既定 true(写真がある人がいるときだけ選べる)
  includeSpots: boolean;         // 既定: patientIds が空なら true、そうでなければ false
  useSharedSecret: boolean;      // 合言葉が保存されていれば既定 true
  password: string;
  passwordConfirm: string;
  saveAsShared: boolean;         // 「この合言葉を事業所の合言葉として保存する」
  phase: 'form' | 'working' | 'done';
  error: string | null;
};
// fileIo.ts
/** 共有メニュー(files)が使えれば共有し、使えなければダウンロードする。取りやめたら 'cancelled'。 */
export async function shareOrDownloadFile(file: File): Promise<'shared' | 'downloaded' | 'cancelled'>;
// transferFlow.ts
export function createTransferFlow(ctx: AppContext): {
  openSend(patientIds: string[], options?: { spotsOnly?: boolean }): Promise<void>;
  updateSendDraft(patch: Partial<Pick<TransferSendDialog, 'includePhotos' | 'includeSpots' | 'useSharedSecret' | 'password' | 'passwordConfirm' | 'saveAsShared'>>): void; // 描き直さない
  submitSend(): Promise<void>;
  // Task 6 で受け取りを足す
};
```
- ダイアログの中身(`renderTransferSendDialog`):
  - 見出し「${describeRecipients}を送る」(地点だけなら「お役立ち地点を送る」)。
  - 注意(常に表示、太字): 「名前・住所・電話・位置・駐車・メモ(と、含めれば写真)が相手に渡ります。」。
  - `transfer-include-photos`「写真も含める」(対象に写真のある人がいるときだけ)、`transfer-include-spots`「お役立ち地点も含める(N件)」(地点が1件以上で、訪問先を送るとき)。
  - 合言葉が保存されていれば `transfer-use-shared`「事業所の合言葉を使う」(既定オン)。オフ、または保存されていなければ `transfer-password` と `transfer-password-confirm`(type password)と `transfer-save-shared`「この合言葉を事業所の合言葉として保存する」。
  - 案内「パスワードは、LINE とは別の方法(口頭・電話など)で伝えてください。パスワードを忘れると、だれにも開けません。」
  - `transfer-send-button`「送る」(primary)と `dialog-cancel`「やめる」。`error` があれば赤で。`working` のときはボタンを押せない。`done` は「送りました」または「ファイルを保存しました。LINE などで送ってください。」と `dialog-cancel`「閉じる」。
- `submitSend`: パスワードを決める(共有の合言葉を使うなら `getMeta('sharedSecret')`、そうでなければ入力。6文字未満・確認と不一致ならエラー)→ `ctx.confirm('名前・住所・写真などが相手に渡ります。送りますか?')` → `working` → 対象の訪問先・写真(`listPhotos`→`blobToDataUrl`)・地点で `serializePayload` → `const { encryptText } = await import('./crypto')` → `new File([text], `訪問先の引き継ぎ_${YYYY-MM-DD}.txt`, { type: 'text/plain' })` → `shareOrDownloadFile` → `done`(取りやめなら `form` に戻す)。`saveAsShared` なら成功後に `setMeta('sharedSecret', pw)`。失敗は「送るファイルを作れませんでした。」。二重押し防止。
- 入口: 一覧の「⋯」→ `dialog-send`、選択バー → `send-selected-button`(選択中の全員)、設定 → `send-spots-button`(地点だけ)。
- パスワードの入力は `updateSendDraft`(描き直さない)。フォーカスは testid で戻る。
- CSS: `.transfer-warning { font-weight: 700; } .transfer-options { display: flex; flex-direction: column; gap: 0.5rem; margin: 0.75rem 0; } .transfer-options label { display: flex; align-items: center; gap: 0.5rem; min-height: var(--tap-min); }`。選択バーは3つのボタンが 375px に収まるよう、送るボタンは `padding: 0 0.75rem`。
- [ ] テスト: `tests/transferDialog.test.ts`(表示の出し分け・文言・ボタン)、`tests/fileIo.test.ts`(`navigator.canShare`/`share` がある/ない/AbortError)、`tests/main.test.ts` 結合(1人を「⋯」から送る → 共有の偽物に渡った File の中身が暗号化されていて、同じパスワードで `decryptText` → `parsePayload` すると名前・メモ・位置・写真が入っている/パスワード6文字未満・不一致のエラー/合言葉を使う/地点だけを送る/確認で「キャンセル」なら何も作らない)。`crypto` の回数は結合テストでも既定のままでよい(1回あたり数百ms)が、遅ければ `tests` 側で `vi.mock('../src/crypto', …)` を使わず、そのまま待つ。
- [ ] 実装 → `npm test`(2回)・`npm run typecheck` → コミット `feat: 訪問先やお役立ち地点を、パスワード付きのファイルにして送れるようにする`

---

### Task 6: 受け取る(読み込むが自動で見分ける・パスワード・確認・同じ人)

**Files:** Modify `src/backupFlow.ts`(読み込んだ文字が引き継ぎのファイルなら transferFlow に渡す)、`src/transferFlow.ts`、`src/views/transferDialog.ts`、`src/types.ts`(`Dialog` に `transferReceive`)、`src/state.ts`、`src/views/dialogs.ts`、`src/views/settingsView.ts`(読み込みの input の `accept` を外す/説明に「引き継ぎのファイル(.txt)もここから読み込めます」)、`src/main.ts`、各テスト。

**Interfaces:**
```ts
export type TransferReceiveDialog = {
  kind: 'transferReceive';
  fileText: string;              // 暗号化されたままの文字列(復号した中身は state に置かない)
  phase: 'password' | 'confirm' | 'conflict' | 'working' | 'done';
  password: string;
  error: string | null;
  summary: string;               // 「山田様ほか2人・お役立ち地点1件」
  conflictIndex: number;         // phase 'conflict' のとき、何人目の同じ人か
  conflicts: { incomingName: string; incomingAddress: string; existingName: string; existingAddress: string }[];
  result: string | null;         // done の文
};
// transferFlow に足す
openReceive(fileText: string): Promise<void>;  // 合言葉があれば先に試し、合えば confirm へ。合わなければ password へ
updateReceivePassword(password: string): void; // 描き直さない
submitReceivePassword(): Promise<void>;        // 違えば error「パスワードが違うか、ファイルが壊れています。何度でもやり直せます。」
confirmReceive(): Promise<void>;               // 同じ人がいれば conflict へ、いなければ取り込む
chooseConflict(choice: ConflictChoice): Promise<void>; // 1人ずつ。最後の人のあと取り込む
```
- 復号した payload と、写真を Blob にしたものは `transferFlow` のモジュール内の変数に持ち、`state` には入れない(ダイアログを閉じたら捨てる)。
- パスワードの画面: 「パスワードを入れてください。」、`receive-password`(type password)、`receive-password-submit`「開く」、案内「パスワードを忘れると開けません。送った人に確かめてください。」、`error`。
- 確認の画面: 「${summary}を名簿に追加しますか?」、`receive-confirm`「追加する」、`dialog-cancel`「やめる」。
- 同じ人の画面: 「同じ訪問先がすでにあります(N/M)」、手元「${name}(${address})」と受け取った「${name}(${address})」、`conflict-overwrite`「上書き」・`conflict-add`「別に追加」・`conflict-skip`「この人は追加しない」。
- 取り込み: `planImport` → `mergePatients(put)` → 各 `replacePhotosFor([id], photos)`(写真を含むファイルのときだけ)→ `putSpots(spots)` → `ctx.loadSpots/loadPhotoCounts/loadPhotoBytes/reloadPatients` → `done`「N人を追加し、M人を上書きしました。」(0 の部分は書かない。地点があれば「お役立ち地点K件」も)。失敗は「取り込めませんでした。」とし、書き始めていたら読み直す(backupFlow と同じ)。
- 読み込み(`backupFlow.handleImport`): 最初に `isEncryptedFileText(text)` を見て、引き継ぎのファイルなら `transferFlow.openReceive(text)` に渡して終わる(入れ替え/追加の選択は使わない)。
- [ ] テスト: ダイアログの各 phase の表示、`tests/main.test.ts` 結合 — Task 5 で作ったファイルを読み込む → パスワード違い → やり直し → 確認 → 追加(新しい id、写真・位置・メモが入る)/合言葉の自動使用でパスワード画面を飛ばす/同じ人が2人いて「上書き」と「この人は追加しない」/写真を含まないファイルの上書きで手元の写真が残る/普通のバックアップ JSON は今までどおり。`tests/wording.test.ts` に全 phase。
- [ ] 実装 → `npm test`(2回)・`npm run typecheck` → コミット `feat: 引き継ぎのファイルを読み込んで、パスワードで開き、名簿に取り込めるようにする`

---

### Task 7: 仕上げ(軽さ・README)

- [ ] `npm run build`: `crypto-*.js` が別のファイルになっていること、index の大きさ(目安 120KB 以内)を記録。
- [ ] 通しの確認(コントローラー): 1人を送る(PCなのでダウンロード)→ そのファイルを読み込む → パスワード → 同じ人の上書き。地点だけを送る。合言葉の設定。明るい/暗い。
- [ ] README: 「主な機能」に 引き継ぎ・配布(パスワード付き、事業所の合言葉)を追記。「試運転で確かめること」に: スマホで「送る」→ LINE にファイルが添付できる/受け取った側でファイルを保存して、設定の「読み込む」から開ける/パスワード違いの案内/同じ人の上書き/写真を含めた・含めない。設計書から変えたこと(`.txt`、共有からの直接起動は無し)も書く。
- [ ] コミット `docs: 段階4の機能と、試運転で確かめることを README に書く`

---

## Self-Review

- 6章: 入口3つ(「⋯」・選択バー・設定)→ Task 5/中身と写真の選択・地点 → Task 3, 5/送る前の確認 → Task 5/パスワード6文字以上・合言葉の保存と自動使用・別の方法で伝える案内 → Task 4, 5, 6/PBKDF2 200,000回・salt 16B・AES-GCM iv 12B・ファイルの形 → Task 2(形に `format`・`iter` を追加)/Web Share(files)→ ダウンロード → Task 5/受け取り(読み込む・パスワードのやり直し・忘れたら開けない・確認文・同じ人を1人ずつ上書き/別に追加/やめる)→ Task 6/暗号なしのバックアップは残す → Task 1, 6(読み込むが見分ける)。
- 変えたこと: `.txt`・共有からの直接起動なし(理由は冒頭)。
- 型: `AppContext`(Task 1)を Task 5, 6 が使う。`TransferPayload`・`planImport`(Task 3)を Task 6 が使う。`TransferSendDialog`/`TransferReceiveDialog` の phase 名は画面の testid と対応。
