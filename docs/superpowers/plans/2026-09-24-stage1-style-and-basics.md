# 段階1: スタイルチェンジ・データを守る仕組み・一覧と登録の改善 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基本版(route-auto-input)に、ダークモード対応の新しい見た目、データを守る3つの仕組み、一覧・登録・設定の使い勝手の改善を入れ、公開して実機で試運転できる状態にする。

**Architecture:** 既存の構成(純粋な `state.ts` / DOMを組み立てる `views/*.ts` / 副作用を集める `main.ts` / `db.ts`)を守る。新しい判断ロジックは純粋な小さなモジュール(`theme.ts`, `normalize.ts`, `backupReminder.ts`, `installHint.ts`)に置き、ブラウザ依存の呼び出しは薄い層(`platform.ts`, `protection.ts`)にまとめてテストで差し替える。色は `styles.css` の `:root` 変数だけで決め、暗い画面は `data-theme="dark"` と `prefers-color-scheme` の両方で上書きする。

**Tech Stack:** Vite + TypeScript(フレームワークなし)、IndexedDB(`idb`)、Vitest + jsdom + fake-indexeddb、vite-plugin-pwa。

**Spec:** `docs/superpowers/specs/2026-09-24-brushup-design.md` の 1〜3章・7章・8章。

## Global Constraints

- データは端末の中だけ。サーバーへ送らない。`localStorage`・IndexedDB に名前・住所を書くのは IndexedDB の `patients` だけ(セッションや設定には id と設定値のみ)。
- 画面の文言に禁止語(`tests/wording.test.ts` の `FORBIDDEN`: 患者・薬局・在宅・医療・利用者・ルート自動入力)を使わない。テストの変数名・コメントには使ってよい(既存の `createPatient` など)。
- 文字と背景のコントラストは、通常の文字 4.5:1 以上、部品 3:1 以上(`tests/styles.test.ts` が検査する)。どの文字も 14px(0.875rem)未満にしない。
- タップ領域は 44px(`--tap-min: 2.75rem`)以上。
- TDD: テスト → 失敗の確認 → 実装 → 成功の確認 → コミット。コミットは `git -c user.name=okaka2 -c user.email=okaka2@users.noreply.github.com commit` で行い、末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` を付ける。push は利用者の確認を得てから。
- コマンドはリポジトリ `C:\Users\owner\Desktop\route-auto-input` で実行する。テストは `npm test`、1ファイルだけなら `npx vitest run tests/<name>.test.ts`。型検査は `npm run typecheck`。
- 各タスクの終わりに `npm test` と `npm run typecheck` が通ること。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/styles.css` | 色の変数(明るい/暗い)、部品の見た目。**Task 1, 9** |
| `src/theme.ts` (新規) | 表示設定(自動/明るい/暗い)の読み書きと `<html data-theme>` への反映。**Task 1** |
| `src/db.ts` | DB バージョン 2。`meta` ストア(キー・バリュー)。**Task 2** |
| `src/protection.ts` (新規) | `navigator.storage.persist()` の薄い層。**Task 3** |
| `src/backupReminder.ts` (新規) | バックアップのお知らせを出すかの判断と、最後のバックアップの表示文。**Task 3** |
| `src/installHint.ts` (新規) | ホーム画面への追加の案内を出すかの判断と端末の種類。**Task 4** |
| `src/platform.ts` | `installPlatform()` を追加。**Task 4** |
| `src/views/notice.ts` (新規) | 一覧の上に出す1つのお知らせ(文と1〜2個のボタン)。**Task 3** |
| `src/views/settingsView.ts` | 言葉の見直し、並び、表示の切り替え、最後のバックアップ、データの保存状態。**Task 2, 3** |
| `src/types.ts` | `Patient.phone`、`AppState.listFilter/dimmedIds`、`Dialog` の追加。**Task 5, 7, 8, 10** |
| `src/state.ts` | 表示範囲の切り替え、薄く残す行、先頭へ/最後へ。**Task 5, 7** |
| `src/config.ts` | `MAX_SELECTION = 30`。**Task 6** |
| `src/views/patientListView.ts` | 上部の整理、「すべて/選択中」、帯、薄い行、電話リンク。**Task 5, 8, 9** |
| `src/views/selectionBar.ts` | 「N件選択中」を押すと選択中の表示へ。**Task 5** |
| `src/views/routeOrderView.ts` | ルートの区切り、「⋯」。**Task 6, 7** |
| `src/views/dialogs.ts` | 訪問順の「⋯」メニュー、同じ人の知らせ。**Task 7, 10** |
| `src/patient.ts`, `src/backup.ts` | 電話番号。**Task 8** |
| `src/views/patientFormView.ts` | 電話番号の欄、「保存して続けて登録」、キャンセル時の値。**Task 8, 10** |
| `src/normalize.ts` (新規) | 名前・住所の正規化と、同じ人の検出。**Task 10** |
| `src/main.ts` | すべての配線。各タスクで少しずつ。 |

---

### Task 1: 色の変数を明るい/暗いの2組にして、表示設定を切り替えられるようにする

**Files:**
- Modify: `src/styles.css:1-31`(`:root`)
- Create: `src/theme.ts`
- Modify: `tests/styles.test.ts:1-30`(トークンの読み方)
- Create: `tests/theme.test.ts`
- Modify: `src/main.ts`(起動時に `initTheme()`)
- Modify: `index.html`(`theme-color` を緑に)、`vite.config.ts`(`theme_color`)

**Interfaces:**
- Produces: `type ThemeSetting = 'auto' | 'light' | 'dark'`, `loadThemeSetting(): ThemeSetting`, `saveThemeSetting(setting): void`, `resolveTheme(setting, prefersDark: boolean): 'light' | 'dark'`, `applyTheme(setting): void`(`document.documentElement.dataset.theme` を設定)、`initTheme(): void`(読み込み+OSの変化を監視)。Task 2 の設定画面が使う。

- [ ] **Step 1: テーマの純粋な関数のテストを書く**

`tests/theme.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, loadThemeSetting, resolveTheme, saveThemeSetting } from '../src/theme';

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('resolveTheme', () => {
  it('自動は、OSが暗ければ dark、明るければ light', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });
  it('明るい/暗いを選んでいれば、OSの設定に関係なくそれに従う', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('設定の読み書き', () => {
  it('何も保存していなければ自動', () => {
    expect(loadThemeSetting()).toBe('auto');
  });
  it('保存した設定を読み戻せる', () => {
    saveThemeSetting('dark');
    expect(loadThemeSetting()).toBe('dark');
  });
  it('壊れた値は自動として扱う', () => {
    window.localStorage.setItem('route-auto-input:theme', 'purple');
    expect(loadThemeSetting()).toBe('auto');
  });
});

describe('applyTheme', () => {
  it('<html data-theme> に light か dark を入れる', () => {
    applyTheme('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/theme.test.ts`
Expected: FAIL(`../src/theme` が無い)

- [ ] **Step 3: `src/theme.ts` を書く**

```ts
/**
 * 表示の設定(自動/明るい/暗い)。
 * 「自動」はOSの設定(prefers-color-scheme)に従う。選んだ設定は localStorage に保存する。
 * 色そのものは styles.css の :root と :root[data-theme='dark'] だけで決める。
 */
export type ThemeSetting = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'route-auto-input:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function loadThemeSetting(): ThemeSetting {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveThemeSetting(setting: ThemeSetting): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    // localStorageが使えない環境では諦める。次回は自動に戻るだけ。
  }
}

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): 'light' | 'dark' {
  if (setting === 'auto') {
    return prefersDark ? 'dark' : 'light';
  }
  return setting;
}

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** 設定を <html data-theme> に反映する。 */
export function applyTheme(setting: ThemeSetting): void {
  document.documentElement.dataset.theme = resolveTheme(setting, prefersDark());
}

/** 起動時に呼ぶ。保存した設定を反映し、「自動」のときはOSの切り替えにも追従する。 */
export function initTheme(): void {
  applyTheme(loadThemeSetting());
  if (typeof window.matchMedia !== 'function') {
    return;
  }
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    applyTheme(loadThemeSetting());
  });
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run tests/theme.test.ts`
Expected: PASS(7件)

- [ ] **Step 5: `tests/styles.test.ts` を、明るい/暗いの2組を別々に検査する形に直す**

先頭の `readTokens` と `const tokens = readTokens();` を次に置き換え、`describe('色の変数')` 以降の `tokens` を使う各テストを `for (const [themeName, tokens] of Object.entries(themes))` で包む(既存の `it.each(TEXT_PAIRS)` は `describe.each` の中に移す)。

```ts
/** 指定したブロック(例: ':root {' から次の '}' まで)にある「--名前: #rrggbb;」を集める。 */
function readTokensIn(blockStart: RegExp): Record<string, string> {
  const start = css.search(blockStart);
  expect(start, `${blockStart} が styles.css にない`).toBeGreaterThanOrEqual(0);
  const body = css.slice(start, css.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const match of body.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1]!] = match[2]!;
  }
  return tokens;
}

const themes = {
  light: readTokensIn(/:root\s*\{/),
  dark: readTokensIn(/:root\[data-theme='dark'\]\s*\{/),
};
```

`describe('色の変数')` を次のように書き換える(必要な色の一覧は既存のまま):
```ts
describe.each(Object.entries(themes))('色の変数(%s)', (_themeName, tokens) => {
  it('必要な色がすべて、6桁の16進数で定義されている', () => { /* 既存のまま、tokens を使う */ });
  it.each(TEXT_PAIRS)('文字の色 %s は背景 %s に対して 4.5:1 以上', (fg, bg) => {
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
  });
  it.each(COMPONENT_PAIRS)('部品の色 %s は背景 %s に対して 3:1 以上', (fg, bg) => {
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(3);
  });
});
```

さらに、暗い画面の上書きが両方の形で書かれていることのテストを足す:
```ts
describe('暗い画面', () => {
  it('OSの設定(prefers-color-scheme)でも、明示の設定(data-theme)でも暗くなる', () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)/);
    expect(css).toMatch(/:root\[data-theme='dark'\]\s*\{/);
  });
  it('color-scheme も切り替える', () => {
    expect(css).toMatch(/:root\[data-theme='dark'\][^}]*color-scheme:\s*dark/s);
  });
});
```

- [ ] **Step 6: 失敗を確認する**

Run: `npx vitest run tests/styles.test.ts`
Expected: FAIL(`:root[data-theme='dark']` が無い)

- [ ] **Step 7: `src/styles.css` の `:root` を書き換え、暗い画面の上書きを足す**

`:root` の色をこれに置き換える(大きさの変数はそのまま):
```css
:root {
  color-scheme: light;

  --bg: #f4f5f2;
  --surface: #ffffff;
  --text: #1a1d21;
  --muted: #4a5058;
  --border: #cfd4d2;
  --border-strong: #6b7278;

  --primary: #1e6b58;
  --primary-soft: #e3efea;
  --on-primary: #ffffff;

  --success: #1f6f3a;
  --success-soft: #e4f2e8;

  --danger: #b3261e;
  --danger-soft: #fbe9e7;
  /* 大きさの変数はこのまま */
}

/* 暗い画面。OSの設定に従う(自動)場合と、設定で「暗い」を選んだ場合の両方で効く。 */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    color-scheme: dark;
    --bg: #121416;
    --surface: #1c2024;
    --text: #e6e8ea;
    --muted: #b3b9bf;
    --border: #3a4046;
    --border-strong: #8a9299;
    --primary: #4fb08f;
    --primary-soft: #1f3a32;
    --on-primary: #0e1a16;
    --success: #6cc48f;
    --success-soft: #1d3527;
    --danger: #ff8a80;
    --danger-soft: #4a1f1c;
  }
}

:root[data-theme='dark'] {
  color-scheme: dark;
  --bg: #121416;
  --surface: #1c2024;
  --text: #e6e8ea;
  --muted: #b3b9bf;
  --border: #3a4046;
  --border-strong: #8a9299;
  --primary: #4fb08f;
  --primary-soft: #1f3a32;
  --on-primary: #0e1a16;
  --success: #6cc48f;
  --success-soft: #1d3527;
  --danger: #ff8a80;
  --danger-soft: #4a1f1c;
}
```
`.overlay` の背景は `rgba(0, 0, 0, 0.4)` のままでよい(両方で効く)。

- [ ] **Step 8: テストを通す**

Run: `npx vitest run tests/styles.test.ts`
Expected: PASS。コントラストで落ちる組み合わせがあれば、その色だけ濃く/明るく調整する(`--muted` は 4.5:1 を必ず満たすこと)。

- [ ] **Step 9: 起動時に反映し、theme-color を合わせる**

`src/main.ts` の `registerServiceWorkerUpdates();` の直前に:
```ts
import { initTheme } from './theme';
// ...
initTheme();
```
`index.html` の `<meta name="theme-color" content="#0b57d0" />` を `#1e6b58` に。`vite.config.ts` の `theme_color: '#0b57d0'` を `'#1e6b58'` に。`tests/indexHtml.test.ts` に theme-color の検査があれば `#1e6b58` に合わせる。

- [ ] **Step 10: 全体のテストと型検査**

Run: `npm test && npm run typecheck`
Expected: すべて PASS

- [ ] **Step 11: コミット**

```bash
git add src/styles.css src/theme.ts src/main.ts index.html vite.config.ts tests/theme.test.ts tests/styles.test.ts tests/indexHtml.test.ts
git commit -m "feat: 深い緑を基調にし、暗い画面(ダークモード)に対応する"
```

---

### Task 2: `meta` ストアと、設定画面の言葉・並び・表示の切り替え

**Files:**
- Modify: `src/db.ts`(バージョン 2、`meta` ストア)
- Modify: `tests/db.test.ts`
- Modify: `src/views/settingsView.ts`、`tests/settingsView.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `db.ts` に `type MetaValues = { lastBackupAt: string }`、`getMeta<K extends keyof MetaValues>(key: K): Promise<MetaValues[K] | undefined>`、`setMeta<K>(key, value): Promise<void>`。段階2以降で `office`, `routeEnds` を足す。
- Produces: `settingsView.ts` の `SettingsInfo = { lastBackupAt: string | null; persisted: boolean | null; theme: ThemeSetting }` と `renderSettings(state, info, handlers)`。`SettingsHandlers` に `onThemeChange(setting: ThemeSetting): void` を追加。

- [ ] **Step 1: `meta` ストアのテストを書く**

`tests/db.test.ts` の末尾に:
```ts
import { getMeta, setMeta } from '../src/db';

describe('meta(設定値の保存)', () => {
  it('保存していないキーは undefined', async () => {
    expect(await getMeta('lastBackupAt')).toBeUndefined();
  });
  it('保存した値を読み戻せ、同じキーは上書きされる', async () => {
    await setMeta('lastBackupAt', '2026-09-20T00:00:00.000Z');
    await setMeta('lastBackupAt', '2026-09-21T00:00:00.000Z');
    expect(await getMeta('lastBackupAt')).toBe('2026-09-21T00:00:00.000Z');
  });
});
```
(既存の import 行に `getMeta, setMeta` を足す。)

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL(`getMeta` が無い)

- [ ] **Step 3: `src/db.ts` を拡張する**

```ts
const DB_VERSION = 2;
const META_STORE = 'meta';

/** 設定値のキーと型。段階2以降で office / routeEnds などを足す。 */
export type MetaValues = {
  lastBackupAt: string;
};

interface RouteAutoInputDB extends DBSchema {
  patients: { key: string; value: Patient; indexes: { createdAt: string } };
  meta: { key: string; value: unknown };
}

function getDb() {
  connection ??= openDB<RouteAutoInputDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
      if (oldVersion < 2) {
        db.createObjectStore(META_STORE);
      }
    },
  });
  return connection;
}

export async function getMeta<K extends keyof MetaValues>(key: K): Promise<MetaValues[K] | undefined> {
  const db = await getDb();
  return (await db.get(META_STORE, key)) as MetaValues[K] | undefined;
}

export async function setMeta<K extends keyof MetaValues>(key: K, value: MetaValues[K]): Promise<void> {
  const db = await getDb();
  await db.put(META_STORE, value, key);
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS

- [ ] **Step 5: 設定画面のテストを書き換える**

`tests/settingsView.test.ts` の `handlers()` に `onThemeChange: vi.fn()` を足し、`renderSettings(state, info, handlers)` の形に全体を直す。`const info = (): SettingsInfo => ({ lastBackupAt: null, persisted: null, theme: 'auto' });` を用意し、既存の呼び出しを `renderSettings(state, info(), spies)` に。文言のテストを次に置き換え・追加:
```ts
describe('renderSettings: 言葉と並び', () => {
  it('ボタンは「書き出す」「読み込む」で、JSONという言葉を使わない', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    expect(q(element, 'export-button').textContent).toBe('書き出す');
    expect(q(element, 'import-button').textContent).toBe('読み込む');
    expect(element.textContent).not.toContain('JSON');
    expect(element.textContent).not.toContain('エクスポート');
    expect(element.textContent).not.toContain('インポート');
  });
  it('見出しの順は バックアップ → データの保存状態 → 表示 → このアプリについて', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    const headings = [...element.querySelectorAll('h2')].map((h) => h.textContent);
    expect(headings).toEqual(['バックアップ', 'データの保存状態', '表示', 'このアプリについて']);
  });
  it('最後のバックアップが無ければ「まだありません」、あれば日付と何日前か', () => {
    const none = renderSettings(createInitialState([]), info(), handlers());
    expect(none.textContent).toContain('最後のバックアップ: まだありません');
    const done = renderSettings(
      createInitialState([]),
      { ...info(), lastBackupAt: '2026-09-20T09:00:00.000Z' },
      handlers(),
      new Date('2026-09-24T09:00:00.000Z'),
    );
    expect(done.textContent).toContain('最後のバックアップ: 9月20日(4日前)');
  });
  it('データの保存状態は 保護されています / 通常 / 確認中', () => {
    const on = renderSettings(createInitialState([]), { ...info(), persisted: true }, handlers());
    expect(q(on, 'persist-status').textContent).toBe('保護されています');
    const off = renderSettings(createInitialState([]), { ...info(), persisted: false }, handlers());
    expect(q(off, 'persist-status').textContent).toBe('通常');
    const unknown = renderSettings(createInitialState([]), info(), handlers());
    expect(q(unknown, 'persist-status').textContent).toBe('確認中');
  });
  it('表示の切り替えは 自動/明るい/暗い の3択で、選ぶと onThemeChange が呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), { ...info(), theme: 'auto' }, spies);
    const radios = [...element.querySelectorAll<HTMLInputElement>('input[name="theme"]')];
    expect(radios.map((r) => r.value)).toEqual(['auto', 'light', 'dark']);
    expect(radios[0]!.checked).toBe(true);
    radios[2]!.click();
    expect(spies.onThemeChange).toHaveBeenCalledWith('dark');
  });
  it('このアプリについて に版の番号を出す', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    expect(element.textContent).toContain('版:');
  });
});
```
既存の「説明に『訪問先』の言葉を使う」テストは、期待文を `'訪問先のデータをバックアップのファイルとして保存します。'` に直す。

- [ ] **Step 6: 失敗を確認する**

Run: `npx vitest run tests/settingsView.test.ts`
Expected: FAIL

- [ ] **Step 7: `src/views/settingsView.ts` を書き換える**

```ts
import { APP_NAME, APP_VERSION } from '../appInfo';
import { formatLastBackup } from '../backupReminder';
import type { ThemeSetting } from '../theme';
import type { AppState } from '../types';
import { renderMessage, renderScreenHeader } from './common';

export type SettingsInfo = {
  /** 最後にバックアップを書き出した日時(ISO 8601)。無ければ null。 */
  lastBackupAt: string | null;
  /** ブラウザがデータの保護を約束しているか。まだ確かめていなければ null。 */
  persisted: boolean | null;
  theme: ThemeSetting;
};

export type SettingsHandlers = {
  onExport(): void;
  onImport(file: File, mode: 'replace' | 'merge'): void;
  onThemeChange(setting: ThemeSetting): void;
  onBack(): void;
};

/** 設定画面。バックアップ → データの保存状態 → 表示 → このアプリについて の順。 */
export function renderSettings(
  state: AppState,
  info: SettingsInfo,
  handlers: SettingsHandlers,
  now: Date = new Date(),
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';
  container.append(renderScreenHeader('設定', { onBack: handlers.onBack }));
  if (state.message) {
    container.append(renderMessage(state.message));
  }
  const count = document.createElement('p');
  count.className = 'hint';
  count.textContent = `登録されている訪問先: ${state.patients.length}件`;
  container.append(
    count,
    renderBackup(info, handlers, now),
    renderProtection(info),
    renderTheme(info, handlers),
    renderAbout(),
  );
  return container;
}

function renderBackup(info: SettingsInfo, handlers: SettingsHandlers, now: Date): HTMLElement {
  const card = section('バックアップ');
  const last = document.createElement('p');
  last.className = 'hint';
  last.dataset.testid = 'last-backup';
  last.textContent = `最後のバックアップ: ${info.lastBackupAt ? formatLastBackup(info.lastBackupAt, now) : 'まだありません'}`;

  const note = document.createElement('p');
  note.textContent = '訪問先のデータをバックアップのファイルとして保存します。';
  const exportButton = button('export-button', '書き出す', 'primary block', () => handlers.onExport());

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.dataset.testid = 'import-input';
  fileInput.setAttribute('aria-label', 'バックアップのファイルを選ぶ');
  const replaceRadio = radio('import-mode', 'replace', 'mode-replace', ' 今のデータを消して入れ替える');
  replaceRadio.input.checked = true;
  const mergeRadio = radio('import-mode', 'merge', 'mode-merge', ' 今のデータに追加する');
  const modes = document.createElement('fieldset');
  modes.className = 'modes';
  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = '読み込み方法';
  modes.append(legend, replaceRadio.label, mergeRadio.label);
  const importButton = button('import-button', '読み込む', 'block', () => {
    const file = fileInput.files?.[0];
    if (file) {
      handlers.onImport(file, mergeRadio.input.checked ? 'merge' : 'replace');
    }
  });
  card.append(last, note, exportButton, fileInput, modes, importButton);
  return card;
}

function renderProtection(info: SettingsInfo): HTMLElement {
  const card = section('データの保存状態');
  const status = document.createElement('p');
  const label = document.createElement('span');
  label.textContent = 'データの保存: ';
  const value = document.createElement('strong');
  value.dataset.testid = 'persist-status';
  value.textContent = info.persisted === null ? '確認中' : info.persisted ? '保護されています' : '通常';
  status.append(label, value);
  const note = document.createElement('p');
  note.className = 'hint';
  note.textContent =
    '「保護されています」なら、空き容量が少なくなってもデータが自動で消されにくくなります。' +
    'どちらの場合も、機種変更やアプリの削除に備えて、定期的にバックアップを書き出してください。';
  card.append(status, note);
  return card;
}

const THEME_OPTIONS: { value: ThemeSetting; label: string }[] = [
  { value: 'auto', label: ' 自動(端末の設定に合わせる)' },
  { value: 'light', label: ' 明るい' },
  { value: 'dark', label: ' 暗い' },
];

function renderTheme(info: SettingsInfo, handlers: SettingsHandlers): HTMLElement {
  const card = section('表示');
  const modes = document.createElement('fieldset');
  modes.className = 'modes';
  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = '表示の切り替え';
  modes.append(legend);
  for (const option of THEME_OPTIONS) {
    const item = radio('theme', option.value, `theme-${option.value}`, option.label);
    item.input.checked = option.value === info.theme;
    item.input.addEventListener('change', () => handlers.onThemeChange(option.value));
    modes.append(item.label);
  }
  card.append(modes);
  return card;
}

function renderAbout(): HTMLElement {
  const card = section('このアプリについて');
  const version = document.createElement('p');
  version.className = 'hint';
  version.textContent = `${APP_NAME} 版: ${APP_VERSION}`;
  card.append(version);
  return card;
}

function section(title: string): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card';
  const heading = document.createElement('h2');
  heading.textContent = title;
  card.append(heading);
  return card;
}

function button(testid: string, text: string, className: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.dataset.testid = testid;
  element.textContent = text;
  element.addEventListener('click', onClick);
  return element;
}

function radio(name: string, value: string, testid: string, text: string) {
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.dataset.testid = testid;
  const label = document.createElement('label');
  label.append(input, document.createTextNode(text));
  return { input, label };
}
```
`src/appInfo.ts` に `APP_VERSION` が無ければ `export const APP_VERSION = '2.0.0';` を足す(`package.json` の version も `2.0.0` に)。`formatLastBackup` は Task 3 で作るので、この時点では `src/backupReminder.ts` に先に置く:
```ts
/** 「9月20日(4日前)」のような、最後のバックアップの表示文。 */
export function formatLastBackup(lastBackupAt: string, now: Date): string {
  const at = new Date(lastBackupAt);
  const days = Math.max(0, Math.floor((startOfDay(now) - startOfDay(at)) / 86_400_000));
  const ago = days === 0 ? '今日' : `${days}日前`;
  return `${at.getMonth() + 1}月${at.getDate()}日(${ago})`;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
```

- [ ] **Step 8: `main.ts` を配線する**

`main.ts` に:
```ts
import { getMeta } from './db';
import { applyTheme, loadThemeSetting, saveThemeSetting } from './theme';
import { isStoragePersisted } from './protection'; // Task 3 で作る。今は `async () => null` の仮実装を protection.ts に置いてよい

let settingsInfo: SettingsInfo = { lastBackupAt: null, persisted: null, theme: loadThemeSetting() };

async function loadSettingsInfo(): Promise<void> {
  const [lastBackupAt, persisted] = await Promise.all([getMeta('lastBackupAt'), isStoragePersisted()]);
  settingsInfo = { ...settingsInfo, lastBackupAt: lastBackupAt ?? null, persisted };
  if (state.screen.name === 'settings') {
    render();
  }
}
```
`case 'settings'` を `renderSettings(state, settingsInfo, { ..., onThemeChange: (setting) => { saveThemeSetting(setting); applyTheme(setting); settingsInfo = { ...settingsInfo, theme: setting }; render(); } })` に。設定を開く `onOpenSettings` で `void loadSettingsInfo();` も呼ぶ。`handleExport` の成功時に `await setMeta('lastBackupAt', new Date().toISOString()); settingsInfo = { ...settingsInfo, lastBackupAt: ... }`(`handleExport` を async に)。

`src/protection.ts` の仮実装(Task 3 で本実装):
```ts
export async function isStoragePersisted(): Promise<boolean | null> {
  return null;
}
```

- [ ] **Step 9: テスト・型検査**

Run: `npm test && npm run typecheck`
Expected: PASS。`tests/wording.test.ts` の設定のテストは `renderSettings(state, { lastBackupAt: null, persisted: null, theme: 'auto' }, {...handlers, onThemeChange: noop})` に直す。

- [ ] **Step 10: コミット**

```bash
git add src/db.ts src/views/settingsView.ts src/backupReminder.ts src/protection.ts src/appInfo.ts src/main.ts package.json tests/db.test.ts tests/settingsView.test.ts tests/wording.test.ts
git commit -m "feat: 設定に表示の切り替えとデータの保存状態を足し、言葉を普段の言葉に直す"
```

---

### Task 3: 「消さないで」と頼む処理と、バックアップのお知らせ

**Files:**
- Modify: `src/protection.ts`、Create: `tests/protection.test.ts`
- Modify: `src/backupReminder.ts`、Create: `tests/backupReminder.test.ts`
- Create: `src/views/notice.ts`、`tests/notice.test.ts`
- Modify: `src/main.ts`、`src/views/patientListView.ts`(お知らせを差し込む口)

**Interfaces:**
- Produces: `requestPersistentStorage(): Promise<boolean>`(未対応なら false)、`isStoragePersisted(): Promise<boolean | null>`(未対応なら null)。
- Produces: `shouldRemindBackup(input: { patientCount: number; lastBackupAt: string | null; laterAt: string | null; now: Date }): boolean`、`BACKUP_REMIND_DAYS = 30`、`REMIND_LATER_DAYS = 7`、`REMIND_MIN_PATIENTS = 5`、`formatLastBackup`(Task 2)。
- Produces: `renderNotice(notice: Notice): HTMLElement` with `type Notice = { testid: string; text: string; actions: { label: string; testid: string; onClick(): void; primary?: boolean }[] }`。
- Produces: `PatientListHandlers` はそのまま。`renderPatientList(state, handlers, notice: Notice | null = null)` の第3引数を追加し、見出しの直下に描く。

- [ ] **Step 1: 保護のテストを書く**

`tests/protection.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isStoragePersisted, requestPersistentStorage } from '../src/protection';

afterEach(() => vi.restoreAllMocks());

function stubStorage(storage: Partial<StorageManager> | undefined) {
  Object.defineProperty(window.navigator, 'storage', { value: storage, configurable: true });
}

describe('requestPersistentStorage', () => {
  it('ブラウザが対応していれば persist() の結果を返す', async () => {
    stubStorage({ persist: vi.fn().mockResolvedValue(true) });
    expect(await requestPersistentStorage()).toBe(true);
  });
  it('対応していなければ false(例外を投げない)', async () => {
    stubStorage(undefined);
    expect(await requestPersistentStorage()).toBe(false);
  });
});

describe('isStoragePersisted', () => {
  it('対応していれば persisted() の結果、していなければ null', async () => {
    stubStorage({ persisted: vi.fn().mockResolvedValue(false) });
    expect(await isStoragePersisted()).toBe(false);
    stubStorage(undefined);
    expect(await isStoragePersisted()).toBeNull();
  });
});
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run tests/protection.test.ts`
Expected: FAIL

- [ ] **Step 3: `src/protection.ts` を本実装にする**

```ts
/**
 * ブラウザに「このサイトのデータは消さないで」と頼む(Storage API)。
 * 対応していない、または断られたときも例外は投げない。iPhoneの「7日間開かないと消える」決まりは
 * これでは防げないので、ホーム画面への追加の案内(installHint.ts)が本命。
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = window.navigator.storage;
    if (!storage || typeof storage.persist !== 'function') {
      return false;
    }
    return await storage.persist();
  } catch {
    return false;
  }
}

/** 保護されているか。確かめる手段が無ければ null。 */
export async function isStoragePersisted(): Promise<boolean | null> {
  try {
    const storage = window.navigator.storage;
    if (!storage || typeof storage.persisted !== 'function') {
      return null;
    }
    return await storage.persisted();
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: テストを通す** — Run: `npx vitest run tests/protection.test.ts` → PASS

- [ ] **Step 5: お知らせの判断のテストを書く**

`tests/backupReminder.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatLastBackup, shouldRemindBackup } from '../src/backupReminder';

const now = new Date('2026-09-24T09:00:00');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

describe('shouldRemindBackup', () => {
  it('一度もバックアップしておらず、5件以上なら出す', () => {
    expect(shouldRemindBackup({ patientCount: 5, lastBackupAt: null, laterAt: null, now })).toBe(true);
    expect(shouldRemindBackup({ patientCount: 4, lastBackupAt: null, laterAt: null, now })).toBe(false);
  });
  it('前回から30日たてば、件数に関係なく出す', () => {
    expect(shouldRemindBackup({ patientCount: 1, lastBackupAt: daysAgo(30), laterAt: null, now })).toBe(true);
    expect(shouldRemindBackup({ patientCount: 100, lastBackupAt: daysAgo(29), laterAt: null, now })).toBe(false);
  });
  it('「あとで」を押してから7日間は出さない', () => {
    expect(shouldRemindBackup({ patientCount: 10, lastBackupAt: null, laterAt: daysAgo(6), now })).toBe(false);
    expect(shouldRemindBackup({ patientCount: 10, lastBackupAt: null, laterAt: daysAgo(7), now })).toBe(true);
  });
});

describe('formatLastBackup', () => {
  it('月日と何日前かを出す。今日なら「今日」', () => {
    expect(formatLastBackup(daysAgo(4), now)).toBe('9月20日(4日前)');
    expect(formatLastBackup(now.toISOString(), now)).toBe('9月24日(今日)');
  });
});
```

- [ ] **Step 6: 失敗を確認する** — Run: `npx vitest run tests/backupReminder.test.ts` → FAIL(`shouldRemindBackup` が無い)

- [ ] **Step 7: `src/backupReminder.ts` に判断を足す**

```ts
export const BACKUP_REMIND_DAYS = 30;
export const REMIND_LATER_DAYS = 7;
export const REMIND_MIN_PATIENTS = 5;

const DAY_MS = 86_400_000;

export function shouldRemindBackup(input: {
  patientCount: number;
  lastBackupAt: string | null;
  laterAt: string | null;
  now: Date;
}): boolean {
  if (input.laterAt !== null && input.now.getTime() - new Date(input.laterAt).getTime() < REMIND_LATER_DAYS * DAY_MS) {
    return false;
  }
  if (input.lastBackupAt === null) {
    return input.patientCount >= REMIND_MIN_PATIENTS;
  }
  return input.now.getTime() - new Date(input.lastBackupAt).getTime() >= BACKUP_REMIND_DAYS * DAY_MS;
}
```

- [ ] **Step 8: テストを通す** — Run: `npx vitest run tests/backupReminder.test.ts` → PASS

- [ ] **Step 9: お知らせの部品のテストを書く**

`tests/notice.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import { renderNotice } from '../src/views/notice';

describe('renderNotice', () => {
  it('文と、ボタンを出す。ボタンを押すと onClick が呼ばれる', () => {
    const onClick = vi.fn();
    const element = renderNotice({
      testid: 'backup-notice',
      text: '最後のバックアップから35日たちました。',
      actions: [{ label: '今すぐバックアップ', testid: 'notice-backup', onClick, primary: true }],
    });
    expect(element.dataset.testid).toBe('backup-notice');
    expect(element.getAttribute('role')).toBe('status');
    expect(element.textContent).toContain('35日');
    const button = element.querySelector<HTMLButtonElement>('[data-testid="notice-backup"]')!;
    expect(button.className).toContain('primary');
    button.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 10: 失敗を確認する** — Run: `npx vitest run tests/notice.test.ts` → FAIL

- [ ] **Step 11: `src/views/notice.ts` を書く**

```ts
export type NoticeAction = { label: string; testid: string; onClick(): void; primary?: boolean };
export type Notice = { testid: string; text: string; actions: NoticeAction[] };

/** 一覧の上に出す1つのお知らせ(ホーム画面への追加・バックアップなど)。同時に1つだけ出す。 */
export function renderNotice(notice: Notice): HTMLElement {
  const box = document.createElement('div');
  box.className = 'notice';
  box.dataset.testid = notice.testid;
  box.setAttribute('role', 'status');
  const text = document.createElement('p');
  text.className = 'notice-text';
  text.textContent = notice.text;
  const actions = document.createElement('div');
  actions.className = 'notice-actions';
  for (const action of notice.actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action.primary ? 'primary' : '';
    button.dataset.testid = action.testid;
    button.textContent = action.label;
    button.addEventListener('click', () => action.onClick());
    actions.append(button);
  }
  box.append(text, actions);
  return box;
}
```
`styles.css` に:
```css
.notice {
  margin: 0 0 var(--gap);
  padding: 0.75rem 1rem;
  border: 1px solid var(--primary);
  border-radius: var(--radius);
  background: var(--primary-soft);
}
.notice-text { margin: 0 0 0.5rem; }
.notice-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
```

- [ ] **Step 12: テストを通す** — Run: `npx vitest run tests/notice.test.ts` → PASS

- [ ] **Step 13: 一覧に差し込み、`main.ts` を配線する**

`patientListView.ts`: `renderPatientList(state, handlers, notice: Notice | null = null)` とし、`container.append(head);` の直後に `if (notice) container.append(renderNotice(notice));`。

`main.ts`:
```ts
import { requestPersistentStorage } from './protection';
import { shouldRemindBackup } from './backupReminder';
import type { Notice } from './views/notice';

const BACKUP_LATER_KEY = 'route-auto-input:backup-later';
let persistRequested = false;

function readLocal(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* 使えない環境では諦める */ }
}

/** 一覧の上に出すお知らせ。Task 4 でホーム画面の案内を先頭に足す。 */
function currentNotice(): Notice | null {
  if (
    shouldRemindBackup({
      patientCount: state.patients.length,
      lastBackupAt: settingsInfo.lastBackupAt,
      laterAt: readLocal(BACKUP_LATER_KEY),
      now: new Date(),
    })
  ) {
    const text =
      settingsInfo.lastBackupAt === null
        ? 'まだバックアップがありません。スマホの故障や機種変更に備えて、保存しておきましょう。'
        : `最後のバックアップから${daysSince(settingsInfo.lastBackupAt)}日たちました。スマホの故障や機種変更に備えて、保存しておきましょう。`;
    return {
      testid: 'backup-notice',
      text,
      actions: [
        { label: '今すぐバックアップ', testid: 'notice-backup', primary: true, onClick: () => { void handleExport(); } },
        { label: 'あとで', testid: 'notice-later', onClick: () => { writeLocal(BACKUP_LATER_KEY, new Date().toISOString()); render(); } },
      ],
    };
  }
  return null;
}

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
```
`case 'list'` の呼び出しを `renderPatientList(state, {...}, currentNotice())` に。起動時の `startApp()` で `void loadSettingsInfo();` も呼ぶ(お知らせの判断に `lastBackupAt` が要る)。`handleSave` の成功後に:
```ts
if (!persistRequested) {
  persistRequested = true;
  void requestPersistentStorage().then((granted) => {
    settingsInfo = { ...settingsInfo, persisted: granted ? true : settingsInfo.persisted };
  });
}
```

- [ ] **Step 14: `main.test.ts` に結合テストを足す**

```ts
describe('バックアップのお知らせ', () => {
  it('5件登録すると、お知らせが出て「あとで」で消える', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    for (let i = 1; i <= 5; i += 1) {
      el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
      el<HTMLInputElement>('[data-testid="name-input"]')!.value = `場所${i}`;
      el<HTMLInputElement>('[data-testid="address-input"]')!.value = `東京都${i}`;
      el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
      await waitFor(() => expect(rows()).toHaveLength(i));
    }
    await waitFor(() => expect(el('[data-testid="backup-notice"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="notice-later"]')!.click();
    expect(el('[data-testid="backup-notice"]')).toBeNull();
  });
});
```

- [ ] **Step 15: 全体のテスト・型検査** — Run: `npm test && npm run typecheck` → PASS

- [ ] **Step 16: コミット**

```bash
git add src/protection.ts src/backupReminder.ts src/views/notice.ts src/views/patientListView.ts src/main.ts src/styles.css tests/protection.test.ts tests/backupReminder.test.ts tests/notice.test.ts tests/main.test.ts
git commit -m "feat: データの保護を頼み、バックアップのお知らせを出す"
```

---

### Task 4: ホーム画面への追加の案内

**Files:**
- Create: `src/installHint.ts`、`tests/installHint.test.ts`
- Modify: `src/platform.ts`、`tests/platform.test.ts`
- Modify: `src/main.ts`、`src/views/dialogs.ts`(手順の表示)

**Interfaces:**
- Produces: `platform.ts` に `type InstallPlatform = 'android' | 'ios' | 'pc'`、`installPlatform(): InstallPlatform`。
- Produces: `installHint.ts` に `shouldShowInstallHint(input: { standalone: boolean; dismissedAt: string | null; now: Date }): boolean`、`INSTALL_HINT_DISMISS_DAYS = 7`、`installSteps(platform: InstallPlatform): string[]`。
- Produces: `Dialog` に `{ kind: 'installSteps' }` を追加、`dialogs.ts` が `installSteps(installPlatform())` を箇条書きで出す。

- [ ] **Step 1: テストを書く**

`tests/installHint.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { installSteps, shouldShowInstallHint } from '../src/installHint';

const now = new Date('2026-09-24T09:00:00');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

describe('shouldShowInstallHint', () => {
  it('ホーム画面から開いていれば出さない', () => {
    expect(shouldShowInstallHint({ standalone: true, dismissedAt: null, now })).toBe(false);
  });
  it('タブで開いていて、閉じたことが無ければ出す', () => {
    expect(shouldShowInstallHint({ standalone: false, dismissedAt: null, now })).toBe(true);
  });
  it('閉じてから7日間は出さず、7日たてばまた出す', () => {
    expect(shouldShowInstallHint({ standalone: false, dismissedAt: daysAgo(6), now })).toBe(false);
    expect(shouldShowInstallHint({ standalone: false, dismissedAt: daysAgo(7), now })).toBe(true);
  });
});

describe('installSteps', () => {
  it('iPhone は共有ボタンからの手順、PC はアドレスバーのインストール', () => {
    expect(installSteps('ios').join('')).toContain('共有');
    expect(installSteps('ios').join('')).toContain('ホーム画面に追加');
    expect(installSteps('pc').join('')).toContain('インストール');
    expect(installSteps('android').join('')).toContain('ホーム画面に追加');
  });
});
```
`tests/platform.test.ts` に:
```ts
import { installPlatform } from '../src/platform';
describe('installPlatform', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 'ios'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile', 'android'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120', 'pc'],
  ])('%s → %s', (ua, expected) => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
    expect(installPlatform()).toBe(expected);
  });
});
```

- [ ] **Step 2: 失敗を確認する** — Run: `npx vitest run tests/installHint.test.ts tests/platform.test.ts` → FAIL

- [ ] **Step 3: 実装する**

`src/platform.ts` に追加:
```ts
export type InstallPlatform = 'android' | 'ios' | 'pc';

/** ホーム画面への追加の手順を出し分けるための端末の種類。 */
export function installPlatform(): InstallPlatform {
  const ua = window.navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'pc';
}
```
`src/installHint.ts`:
```ts
import type { InstallPlatform } from './platform';

export const INSTALL_HINT_DISMISS_DAYS = 7;

/** タブで開いているときだけ、7日に1回まで案内する。 */
export function shouldShowInstallHint(input: { standalone: boolean; dismissedAt: string | null; now: Date }): boolean {
  if (input.standalone) return false;
  if (input.dismissedAt === null) return true;
  return input.now.getTime() - new Date(input.dismissedAt).getTime() >= INSTALL_HINT_DISMISS_DAYS * 86_400_000;
}

export function installSteps(platform: InstallPlatform): string[] {
  switch (platform) {
    case 'ios':
      return [
        '画面の下(または上)にある「共有」ボタン(四角から矢印が出ている印)を押します。',
        '出てきた一覧を下にたどり、「ホーム画面に追加」を押します。',
        '右上の「追加」を押します。ホーム画面にアイコンができます。',
      ];
    case 'android':
      return [
        'ブラウザの右上の「⋮」を押します。',
        '「ホーム画面に追加」または「アプリをインストール」を押します。',
        '「追加」を押します。ホーム画面にアイコンができます。',
      ];
    default:
      return [
        'アドレスバーの右端にある「インストール」の印(画面に下向き矢印)を押します。',
        '「インストール」を押します。デスクトップやスタートメニューから開けるようになります。',
      ];
  }
}
```

- [ ] **Step 4: テストを通す** — Run: `npx vitest run tests/installHint.test.ts tests/platform.test.ts` → PASS

- [ ] **Step 5: 手順のダイアログと `main.ts` の配線**

`types.ts` の `Dialog` に `| { kind: 'installSteps' }`。`dialogs.ts` の `renderDialog` で `dialog.kind === 'installSteps'` なら `renderInstallSteps(handlers)`:
```ts
import { installSteps } from '../installHint';
import { installPlatform } from '../platform';

function renderInstallSteps(handlers: DialogHandlers): HTMLElement[] {
  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = 'ホーム画面に追加する';
  const list = document.createElement('ol');
  list.className = 'sheet-steps';
  for (const step of installSteps(installPlatform())) {
    const item = document.createElement('li');
    item.textContent = step;
    list.append(item);
  }
  const buttons = document.createElement('div');
  buttons.className = 'sheet-buttons';
  buttons.append(actionButton('閉じる', 'dialog-cancel', () => handlers.onClose()));
  return [title, list, buttons];
}
```
`state.ts` の `keepDialog` は `dialog.kind === 'installSteps'` を `dialog` のまま返す(`confirmDeleteSelected` の直前に `if (dialog.kind === 'installSteps') return dialog;`)。`styles.css` に `.sheet-steps { margin: 0 0 var(--gap); padding-left: 1.25rem; } .sheet-steps li { margin-bottom: 0.5rem; }`。

`main.ts`:
```ts
import { shouldShowInstallHint } from './installHint';
import { isStandaloneDisplay } from './platform';
const INSTALL_DISMISS_KEY = 'route-auto-input:install-dismissed';
// Android の Chrome が「インストールできる」と知らせてきたイベント。ボタン1つで追加するために取っておく。
let deferredInstallPrompt: (Event & { prompt(): Promise<void> }) | null = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredInstallPrompt = event as Event & { prompt(): Promise<void> };
  render();
});
```
`currentNotice()` の先頭に:
```ts
if (shouldShowInstallHint({ standalone: isStandaloneDisplay(), dismissedAt: readLocal(INSTALL_DISMISS_KEY), now: new Date() })) {
  const install = deferredInstallPrompt;
  return {
    testid: 'install-notice',
    text: 'ホーム画面に追加すると、データが消えにくくなり、アプリのように使えます。',
    actions: [
      install
        ? { label: 'ホーム画面に追加', testid: 'notice-install', primary: true, onClick: () => { void install.prompt(); deferredInstallPrompt = null; } }
        : { label: 'やり方を見る', testid: 'notice-install-steps', primary: true, onClick: () => setState({ ...state, dialog: { kind: 'installSteps' } }) },
      { label: '閉じる', testid: 'notice-install-dismiss', onClick: () => { writeLocal(INSTALL_DISMISS_KEY, new Date().toISOString()); render(); } },
    ],
  };
}
```
`tests/main.test.ts` の `beforeEach` は `localStorage.clear()` しているので、既存テストで `install-notice` が出る。既存テストが `[data-testid="patient-row"]` 等を数えるだけなら影響しないが、`.message` や `role=status` を数えるテストがあれば `install-notice` を除くように直す。結合テストを1つ足す:
```ts
it('タブで開いていると、ホーム画面への追加の案内が出て、閉じると消える', async () => {
  await import('../src/main');
  await waitFor(() => expect(el('[data-testid="install-notice"]')).not.toBeNull());
  el<HTMLButtonElement>('[data-testid="notice-install-dismiss"]')!.click();
  expect(el('[data-testid="install-notice"]')).toBeNull();
});
```
`tests/wording.test.ts` のダイアログのテストに `renderDialog({ ...base, dialog: { kind: 'installSteps' } }, dialogHandlers)` を足す。

- [ ] **Step 6: テスト・型検査** — Run: `npm test && npm run typecheck` → PASS

- [ ] **Step 7: コミット**

```bash
git add src/installHint.ts src/platform.ts src/types.ts src/state.ts src/views/dialogs.ts src/main.ts src/styles.css tests/installHint.test.ts tests/platform.test.ts tests/main.test.ts tests/wording.test.ts
git commit -m "feat: タブで開いているときに、ホーム画面への追加を案内する"
```

---

### Task 5: 「すべて/選択中」の切り替え、帯、薄く残す行、選択バーからの導線

**Files:**
- Modify: `src/types.ts`、`src/state.ts`、`tests/state.test.ts`
- Modify: `src/views/patientListView.ts`、`tests/patientListView.test.ts`
- Modify: `src/views/selectionBar.ts`、`tests/selectionBar.test.ts`
- Modify: `src/main.ts`、`src/styles.css`

**Interfaces:**
- Produces: `AppState.listFilter: 'all' | 'selected'`、`AppState.dimmedIds: string[]`。`setListFilter(state, filter): AppState`(切り替え時に `dimmedIds` を空に。誰も選んでいなければ 'selected' にしない)、`toggleSelection` は「選択中」表示中に外した id を `dimmedIds` に足し、選び直せば外す。`visiblePatients` は `listFilter === 'selected'` なら `selectedIds ∪ dimmedIds` の中から検索する。`withScreen` は `dimmedIds` を空にし `listFilter` を 'all' に戻す。
- Produces: `SelectionBarHandlers.onShowSelected(): void`(「N件選択中」を押す)。
- Produces: `PatientListHandlers.onFilterChange(filter: 'all' | 'selected'): void`、`onSearchAll(): void`(帯の「すべてから探す」)。

- [ ] **Step 1: state のテストを書く**

`tests/state.test.ts` に:
```ts
import { setListFilter } from '../src/state';

describe('表示範囲(すべて/選択中)', () => {
  it('最初は すべて', () => {
    expect(createInitialState([]).listFilter).toBe('all');
    expect(createInitialState([]).dimmedIds).toEqual([]);
  });
  it('選択中に切り替えると、選んだ人だけが見える', () => {
    const patients = makePatients(3);
    let state = toggleSelection(createInitialState(patients), patients[1]!.id);
    state = setListFilter(state, 'selected');
    expect(visiblePatients(state).map((p) => p.id)).toEqual([patients[1]!.id]);
  });
  it('誰も選んでいなければ、選択中には切り替わらない', () => {
    const state = setListFilter(createInitialState(makePatients(2)), 'selected');
    expect(state.listFilter).toBe('all');
  });
  it('選択中の表示でチェックを外しても、その行は薄く残り(見える)、選び直せば戻る', () => {
    const patients = makePatients(2);
    let state = toggleSelection(createInitialState(patients), patients[0]!.id);
    state = setListFilter(state, 'selected');
    state = toggleSelection(state, patients[0]!.id);
    expect(state.selectedIds).toEqual([]);
    expect(state.dimmedIds).toEqual([patients[0]!.id]);
    expect(visiblePatients(state).map((p) => p.id)).toEqual([patients[0]!.id]);
    state = toggleSelection(state, patients[0]!.id);
    expect(state.dimmedIds).toEqual([]);
  });
  it('すべてに戻すと、薄い行は消える', () => {
    const patients = makePatients(2);
    let state = toggleSelection(createInitialState(patients), patients[0]!.id);
    state = setListFilter(state, 'selected');
    state = toggleSelection(state, patients[0]!.id);
    state = setListFilter(state, 'all');
    expect(state.dimmedIds).toEqual([]);
    expect(visiblePatients(state)).toHaveLength(2);
  });
  it('選択中の表示で検索すると、選んだ人の中から探す', () => {
    const patients = makePatients(3);
    let state = toggleSelection(createInitialState(patients), patients[0]!.id);
    state = setListFilter(state, 'selected');
    state = setSearchQuery(state, '患者3');
    expect(visiblePatients(state)).toEqual([]);
  });
  it('画面を移ると すべて に戻る', () => {
    const patients = makePatients(1);
    let state = toggleSelection(createInitialState(patients), patients[0]!.id);
    state = setListFilter(state, 'selected');
    state = withScreen(state, { name: 'order' });
    expect(state.listFilter).toBe('all');
  });
});
```

- [ ] **Step 2: 失敗を確認する** — Run: `npx vitest run tests/state.test.ts` → FAIL

- [ ] **Step 3: `types.ts` と `state.ts` を直す**

`types.ts` の `AppState` に:
```ts
  /** 一覧に出す範囲。'selected' は選んだ人だけ(薄く残す行を含む)。 */
  listFilter: 'all' | 'selected';
  /** 「選択中」の表示でチェックを外した行。表示を切り替えるまでは薄く残す。 */
  dimmedIds: string[];
```
`state.ts`:
```ts
export function createInitialState(patients: Patient[]): AppState {
  return { screen: { name: 'list' }, patients, selectedIds: [], searchQuery: '', sortOrder: 'registered', message: null, dialog: null, listFilter: 'all', dimmedIds: [] };
}

export function withScreen(state: AppState, screen: Screen): AppState {
  return { ...state, screen, message: null, dialog: null, listFilter: 'all', dimmedIds: [] };
}

export function setListFilter(state: AppState, listFilter: 'all' | 'selected'): AppState {
  if (listFilter === 'selected' && state.selectedIds.length === 0) {
    return state;
  }
  return { ...state, listFilter, dimmedIds: [] };
}

export function toggleSelection(state: AppState, id: string): AppState {
  if (state.selectedIds.includes(id)) {
    return {
      ...state,
      selectedIds: state.selectedIds.filter((selectedId) => selectedId !== id),
      dimmedIds: state.listFilter === 'selected' ? [...state.dimmedIds, id] : state.dimmedIds,
      message: null,
    };
  }
  if (state.selectedIds.length >= MAX_SELECTION) {
    return { ...state, message: { kind: 'error', text: `一度に選べるのは${MAX_SELECTION}件までです。` } };
  }
  return { ...state, selectedIds: [...state.selectedIds, id], dimmedIds: state.dimmedIds.filter((d) => d !== id), message: null };
}

export function visiblePatients(state: AppState): Patient[] {
  const query = state.searchQuery.trim();
  const scope =
    state.listFilter === 'selected'
      ? state.patients.filter((p) => state.selectedIds.includes(p.id) || state.dimmedIds.includes(p.id))
      : state.patients;
  const matched = query.length === 0 ? scope : scope.filter((p) => p.name.includes(query) || p.address.includes(query));
  if (state.sortOrder === 'registered') return matched;
  const key = state.sortOrder === 'name' ? 'name' : 'address';
  return [...matched].sort((a, b) => jaCollator.compare(a[key], b[key]));
}
```
`withPatients` でも `dimmedIds` を `existingIds` で filter する。`clearSelection` は `dimmedIds: []`、`listFilter: 'all'` に戻す。

- [ ] **Step 4: テストを通す** — Run: `npx vitest run tests/state.test.ts` → PASS

- [ ] **Step 5: 一覧と選択バーのテストを書く**

`tests/patientListView.test.ts` の `handlers()` に `onFilterChange: vi.fn(), onSearchAll: vi.fn()` を足し:
```ts
describe('すべて/選択中の切り替え', () => {
  it('件数つきの2つの切り替えを出し、押すと onFilterChange が呼ばれる', () => {
    const patients = makePatients(3);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const spies = handlers();
    const element = renderPatientList(state, spies);
    expect(q(element, 'filter-all').textContent).toBe('すべて 3');
    expect(q(element, 'filter-selected').textContent).toBe('選択中 1');
    expect(q(element, 'filter-all').getAttribute('aria-pressed')).toBe('true');
    q<HTMLButtonElement>(element, 'filter-selected').click();
    expect(spies.onFilterChange).toHaveBeenCalledWith('selected');
  });
  it('誰も選んでいなければ「選択中」は押せない', () => {
    const element = renderPatientList(createInitialState(makePatients(2)), handlers());
    expect(q<HTMLButtonElement>(element, 'filter-selected').disabled).toBe(true);
  });
  it('選択中の表示では帯を出し、「すべてに戻る」で onFilterChange("all")', () => {
    const patients = makePatients(2);
    let state = toggleSelection(createInitialState(patients), patients[0]!.id);
    state = setListFilter(state, 'selected');
    const spies = handlers();
    const element = renderPatientList(state, spies);
    expect(q(element, 'filter-band').textContent).toContain('選択中の1人を表示しています');
    q<HTMLButtonElement>(element, 'filter-band-all').click();
    expect(spies.onFilterChange).toHaveBeenCalledWith('all');
  });
  it('薄く残す行には dimmed クラスが付く', () => {
    const patients = makePatients(1);
    let state = toggleSelection(createInitialState(patients), patients[0]!.id);
    state = setListFilter(state, 'selected');
    state = toggleSelection(state, patients[0]!.id);
    const row = renderPatientList(state, handlers()).querySelector('[data-testid="patient-row"]')!;
    expect(row.className).toContain('dimmed');
  });
  it('選択中の表示で検索に当たらなければ「すべてから探す」を出す', () => {
    const patients = makePatients(2);
    let state = toggleSelection(createInitialState(patients), patients[0]!.id);
    state = setListFilter(state, 'selected');
    state = setSearchQuery(state, '患者2');
    const spies = handlers();
    const element = renderPatientList(state, spies);
    expect(element.textContent).toContain('選択中には見つかりません');
    q<HTMLButtonElement>(element, 'search-all-button').click();
    expect(spies.onSearchAll).toHaveBeenCalled();
  });
});
```
`tests/selectionBar.test.ts` に:
```ts
it('「N件選択中」を押すと onShowSelected が呼ばれる', () => {
  const onShowSelected = vi.fn();
  const bar = renderSelectionBar(2, { onNext: vi.fn(), onDeleteSelected: vi.fn(), onShowSelected })!;
  bar.querySelector<HTMLButtonElement>('[data-testid="selection-count"]')!.click();
  expect(onShowSelected).toHaveBeenCalled();
});
```
(既存の `handlers` に `onShowSelected: vi.fn()` を足す。`selection-count` は `<button>` になる。)

- [ ] **Step 6: 失敗を確認する** — Run: `npx vitest run tests/patientListView.test.ts tests/selectionBar.test.ts` → FAIL

- [ ] **Step 7: 一覧を実装する**

`patientListView.ts`:
- `PatientListHandlers` に `onFilterChange(filter: 'all' | 'selected'): void; onSearchAll(): void;`
- `renderPatientList` で `head.append(renderTitleRow, renderSearch, renderListControls, renderFilterToggle(state, handlers))`。`state.listFilter === 'selected'` なら `container.append(renderFilterBand(state, handlers))` を一覧の直前に。
- 空のときの文言: `state.listFilter === 'selected' && state.searchQuery.trim() !== ''` なら「選択中には見つかりません。」と `search-all-button`(「すべてから探す」)を出す。
```ts
function renderFilterToggle(state: AppState, handlers: PatientListHandlers): HTMLElement {
  const group = document.createElement('div');
  group.className = 'segmented';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', '表示する範囲');
  const all = segment('filter-all', `すべて ${state.patients.length}`, state.listFilter === 'all', () => handlers.onFilterChange('all'));
  const selected = segment('filter-selected', `選択中 ${state.selectedIds.length}`, state.listFilter === 'selected', () => handlers.onFilterChange('selected'));
  selected.disabled = state.selectedIds.length === 0;
  group.append(all, selected);
  return group;
}

function segment(testid: string, text: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `segment${pressed ? ' pressed' : ''}`;
  button.dataset.testid = testid;
  button.setAttribute('aria-pressed', String(pressed));
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function renderFilterBand(state: AppState, handlers: PatientListHandlers): HTMLElement {
  const band = document.createElement('div');
  band.className = 'filter-band';
  band.dataset.testid = 'filter-band';
  const text = document.createElement('span');
  text.textContent = `選択中の${state.selectedIds.length}人を表示しています`;
  const back = document.createElement('button');
  back.type = 'button';
  back.dataset.testid = 'filter-band-all';
  back.textContent = 'すべてに戻る';
  back.addEventListener('click', () => handlers.onFilterChange('all'));
  band.append(text, back);
  return band;
}
```
`renderRow` の className に `${state.dimmedIds.includes(patient.id) ? ' dimmed' : ''}` を足す。

`selectionBar.ts`: `label` を `<button type="button" class="selection-count">` にし、`addEventListener('click', () => handlers.onShowSelected())`。

`styles.css`:
```css
.segmented { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 0.5rem; border: 1px solid var(--border-strong); border-radius: var(--radius); overflow: hidden; }
.segment { min-height: var(--tap-min); border: none; border-radius: 0; background: var(--surface); color: var(--text); font-weight: 600; }
.segment.pressed { background: var(--primary); color: var(--on-primary); }
.filter-band { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin: 0 0 0.5rem; padding: 0.5rem 0.75rem; border-radius: var(--radius); background: var(--primary-soft); color: var(--text); font-weight: 600; }
.filter-band button { min-height: var(--tap-min); border-color: var(--primary); color: var(--primary); background: var(--surface); }
.place-row.dimmed { opacity: 0.55; }
.selection-count { border: none; background: transparent; color: var(--text); font-weight: 600; padding: 0 0.5rem; }
```

- [ ] **Step 8: `main.ts` の配線**

`case 'list'` に `onFilterChange: (filter) => setState(setListFilter(state, filter))`, `onSearchAll: () => setState(setListFilter(setSearchQuery(state, state.searchQuery), 'all'))`(検索語は残す)。選択バーに `onShowSelected: () => setState(setListFilter(state, 'selected'))`。

- [ ] **Step 9: テスト・型検査** — Run: `npm test && npm run typecheck` → PASS(`wording.test.ts` の `listHandlers` に2つの noop を足す)

- [ ] **Step 10: コミット**

```bash
git add src/types.ts src/state.ts src/views/patientListView.ts src/views/selectionBar.ts src/main.ts src/styles.css tests/state.test.ts tests/patientListView.test.ts tests/selectionBar.test.ts tests/wording.test.ts
git commit -m "feat: 一覧に「すべて/選択中」の切り替えを足し、選んだ人だけを確かめられるようにする"
```

---

### Task 6: 選べる件数を30件にし、訪問順にルートの区切りを出す

**Files:**
- Modify: `src/config.ts`、`src/views/routeOrderView.ts`、`tests/routeOrderView.test.ts`、`tests/state.test.ts`(上限のテストは定数を参照しているのでそのまま通る)

- [ ] **Step 1: テストを書く**

`tests/routeOrderView.test.ts` に:
```ts
import { MAX_STOPS_PER_ROUTE } from '../src/config';
it('1ルートの上限を超えると、区切りの行「── ここからルート2 ──」を出す', () => {
  const patients = makePatients(MAX_STOPS_PER_ROUTE + 2);
  const state = { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
  const element = renderRouteOrder(state, handlers());
  const dividers = [...element.querySelectorAll('[data-testid="route-divider"]')];
  expect(dividers).toHaveLength(1);
  expect(dividers[0]!.textContent).toBe('── ここからルート2 ──');
  // 区切りは、上限件目の行の直後にある
  const items = [...element.querySelectorAll('.stop-timeline > li')];
  expect(items[MAX_STOPS_PER_ROUTE]!.dataset.testid).toBe('route-divider');
});
it('上限以内なら区切りは出ない', () => {
  const patients = makePatients(3);
  const state = { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
  expect(renderRouteOrder(state, handlers()).querySelector('[data-testid="route-divider"]')).toBeNull();
});
```
`tests/config.test.ts`(無ければ新規):
```ts
import { describe, expect, it } from 'vitest';
import { MAX_SELECTION, MAX_STOPS_PER_ROUTE } from '../src/config';
describe('上限', () => {
  it('一度に30件まで選べ、1ルートは10地点', () => {
    expect(MAX_SELECTION).toBe(30);
    expect(MAX_STOPS_PER_ROUTE).toBe(10);
  });
});
```

- [ ] **Step 2: 失敗を確認する** — Run: `npx vitest run tests/routeOrderView.test.ts tests/config.test.ts` → FAIL

- [ ] **Step 3: 実装する**

`config.ts`: `export const MAX_SELECTION = 30;` とコメントを「1ルートの上限(MAX_STOPS_PER_ROUTE)を超えた分は、routeSplitter が自動で複数のルートに分ける」に直す。

`routeOrderView.ts` の行を並べるループで、`index > 0 && index % MAX_STOPS_PER_ROUTE === 0` のときに区切りを先に足す:
```ts
if (index > 0 && index % MAX_STOPS_PER_ROUTE === 0) {
  const divider = document.createElement('li');
  divider.className = 'route-divider';
  divider.dataset.testid = 'route-divider';
  divider.setAttribute('aria-label', `ここからルート${index / MAX_STOPS_PER_ROUTE + 1}`);
  divider.textContent = `── ここからルート${index / MAX_STOPS_PER_ROUTE + 1} ──`;
  list.append(divider);
}
```
`styles.css`: `.route-divider { padding: 0.25rem 0 1rem; color: var(--muted); font-weight: 600; text-align: center; }`。

一覧の `limit-hint` の文言「一度に選べるのは30件までです。」はそのまま(定数を使う)。`patientListView.ts` の `MAX_SELECTION` 到達の hint も同じ。

- [ ] **Step 4: テスト・型検査** — Run: `npm test && npm run typecheck` → PASS。`README.md` の「一度に選べる件数」の記述を 30 に直す。

- [ ] **Step 5: コミット**

```bash
git add src/config.ts src/views/routeOrderView.ts src/styles.css README.md tests/routeOrderView.test.ts tests/config.test.ts
git commit -m "feat: 一度に30件まで選べるようにし、訪問順にルートの区切りを出す"
```

---

### Task 7: 訪問順の「⋯」に「先頭へ」「最後へ」

**Files:**
- Modify: `src/types.ts`(`Dialog` に `{ kind: 'stopMenu'; id: string }`)、`src/state.ts`、`tests/state.test.ts`
- Modify: `src/views/routeOrderView.ts`、`tests/routeOrderView.test.ts`
- Modify: `src/views/dialogs.ts`、`tests/dialogs.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `moveSelectedToEdge(state, id, edge: 'top' | 'bottom'): AppState`、`openStopMenu(state, id): AppState`。
- Produces: `RouteOrderHandlers.onOpenStopMenu(id: string): void`。`DialogHandlers.onMoveToTop(id)`, `onMoveToBottom(id)`。

- [ ] **Step 1: テストを書く**

`tests/state.test.ts`:
```ts
import { moveSelectedToEdge, openStopMenu } from '../src/state';
describe('moveSelectedToEdge', () => {
  it('先頭へ/最後へ動かせる。すでに端なら同じ状態', () => {
    const patients = makePatients(3);
    const base = { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
    expect(moveSelectedToEdge(base, patients[2]!.id, 'top').selectedIds).toEqual([patients[2]!.id, patients[0]!.id, patients[1]!.id]);
    expect(moveSelectedToEdge(base, patients[0]!.id, 'bottom').selectedIds).toEqual([patients[1]!.id, patients[2]!.id, patients[0]!.id]);
    expect(moveSelectedToEdge(base, patients[0]!.id, 'top')).toBe(base);
  });
  it('openStopMenu は stopMenu ダイアログを開く', () => {
    const patients = makePatients(1);
    expect(openStopMenu(createInitialState(patients), patients[0]!.id).dialog).toEqual({ kind: 'stopMenu', id: patients[0]!.id });
  });
});
```
`tests/routeOrderView.test.ts`: 各行に `[data-testid="stop-menu"][data-id]` があり、押すと `onOpenStopMenu(id)`。
`tests/dialogs.test.ts`:
```ts
it('訪問順の「⋯」: 先頭へ / 最後へ / キャンセル', () => {
  const patients = makePatients(2);
  const state = { ...createInitialState(patients), selectedIds: patients.map((p) => p.id), dialog: { kind: 'stopMenu' as const, id: patients[1]!.id } };
  const spies = handlers();
  const element = renderDialog(state, spies)!;
  element.querySelector<HTMLButtonElement>('[data-testid="dialog-move-top"]')!.click();
  expect(spies.onMoveToTop).toHaveBeenCalledWith(patients[1]!.id);
  element.querySelector<HTMLButtonElement>('[data-testid="dialog-move-bottom"]')!.click();
  expect(spies.onMoveToBottom).toHaveBeenCalledWith(patients[1]!.id);
});
```

- [ ] **Step 2: 失敗を確認する** — Run: `npx vitest run tests/state.test.ts tests/routeOrderView.test.ts tests/dialogs.test.ts` → FAIL

- [ ] **Step 3: 実装する**

`state.ts`:
```ts
export function moveSelectedToEdge(state: AppState, id: string, edge: 'top' | 'bottom'): AppState {
  const index = state.selectedIds.indexOf(id);
  if (index === -1) return state;
  if ((edge === 'top' && index === 0) || (edge === 'bottom' && index === state.selectedIds.length - 1)) return state;
  const rest = state.selectedIds.filter((s) => s !== id);
  return { ...state, selectedIds: edge === 'top' ? [id, ...rest] : [...rest, id], dialog: null };
}
export function openStopMenu(state: AppState, id: string): AppState {
  return { ...state, dialog: { kind: 'stopMenu', id } };
}
```
`routeOrderView.ts` の `move` に、▲▼の後ろに `stop-menu` ボタン(`⋯`, aria-label `${patient.name}の順番のメニュー`)を足し `handlers.onOpenStopMenu(patient.id)`。
`dialogs.ts` に `renderStopMenu(patient, handlers)`: 見出しは名前、`sheet-actions` に 先頭へ(`dialog-move-top`)/最後へ(`dialog-move-bottom`)/キャンセル(`dialog-cancel`)。`renderDialog` の分岐に `dialog.kind === 'stopMenu'` を足す。
`main.ts`: `case 'order'` に `onOpenStopMenu: (id) => { dialogReturnId = id; setState(openStopMenu(state, id)); }`; ダイアログの `onMoveToTop: (id) => { openedRoutes.clear(); setState(moveSelectedToEdge(state, id, 'top')); }`, `onMoveToBottom` 同様。`render()` のフォーカス復帰は `row-menu` 固定なので、`stop-menu` にも戻すよう `[data-testid="row-menu"], [data-testid="stop-menu"]` の両方を探す。

- [ ] **Step 4: テスト・型検査** — Run: `npm test && npm run typecheck` → PASS(`wording.test.ts` の handlers に noop を足す)

- [ ] **Step 5: コミット**

```bash
git add src/types.ts src/state.ts src/views/routeOrderView.ts src/views/dialogs.ts src/main.ts tests/state.test.ts tests/routeOrderView.test.ts tests/dialogs.test.ts tests/wording.test.ts
git commit -m "feat: 訪問順の「⋯」から先頭へ・最後へ動かせるようにする"
```

---

### Task 8: 電話番号の欄と、一覧・ルートからの電話

**Files:**
- Modify: `src/types.ts`(`phone?: string`)、`src/patient.ts`、`tests/patient.test.ts`
- Modify: `src/backup.ts`、`tests/backup.test.ts`
- Modify: `src/views/patientFormView.ts`、`tests/patientFormView.test.ts`
- Modify: `src/views/patientListView.ts`、`src/views/routeMapView.ts`、それぞれのテスト
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `createPatient(name, address, now = new Date(), phone = '')`、`updatePatientFields(patient, name, address, now = new Date(), phone = '')`。空なら `phone` を持たない。
- Produces: `PatientFormDraft = { name: string; address: string; phone: string }`、`PatientFormHandlers.onSave(name, address, phone)`。
- Produces: `formatPhoneHref(phone: string): string`(`tel:` + 数字と+だけ)を `src/format.ts` に。

- [ ] **Step 1: テストを書く**

`tests/patient.test.ts`:
```ts
it('電話番号は、あれば trim して持ち、空なら持たない', () => {
  expect(createPatient('a', 'b', new Date(), ' 03-1234-5678 ').phone).toBe('03-1234-5678');
  expect('phone' in createPatient('a', 'b')).toBe(false);
  const updated = updatePatientFields(createPatient('a', 'b', new Date(), '090'), 'a', 'b', new Date(), '');
  expect('phone' in updated).toBe(false);
});
```
`tests/backup.test.ts`: 電話番号つきの訪問先を `serializeBackup` → `parseBackup` で往復して `phone` が残ること、`phone` が無い古いデータも読めること。
`tests/format.test.ts`: `formatPhoneHref('03-1234-5678')` → `'tel:0312345678'`、`formatPhoneHref('+81 90 1234 5678')` → `'tel:+819012345678'`。
`tests/patientFormView.test.ts`: 「入力欄は、名前と住所の2つだけ」を「名前・住所・電話番号の3つ」に直し(`['name-input','address-input','phone-input']`)、電話番号のラベルに「必須」が無いこと、`onSave` が `(name, address, phone)` で呼ばれること。
`tests/patientListView.test.ts`: 電話番号がある行に `a[href^="tel:"]`(`data-testid="phone-link"`)があり、無い行には無いこと。
`tests/routeMapView.test.ts`: ルートのカードの名前の横に同じリンク。

- [ ] **Step 2: 失敗を確認する** — Run: `npm test` → 該当のテストが FAIL

- [ ] **Step 3: 実装する**

`types.ts`: `Patient` に `phone?: string;`。
`patient.ts`:
```ts
export function createPatient(name: string, address: string, now: Date = new Date(), phone = ''): Patient {
  const timestamp = now.toISOString();
  const trimmedPhone = phone.trim();
  return { id: crypto.randomUUID(), name: name.trim(), address: address.trim(), createdAt: timestamp, updatedAt: timestamp, ...(trimmedPhone ? { phone: trimmedPhone } : {}) };
}
export function updatePatientFields(patient: Patient, name: string, address: string, now: Date = new Date(), phone = ''): Patient {
  const { phone: _old, ...rest } = patient;
  const trimmedPhone = phone.trim();
  return { ...rest, name: name.trim(), address: address.trim(), updatedAt: now.toISOString(), ...(trimmedPhone ? { phone: trimmedPhone } : {}) };
}
```
`backup.ts` の `toPatient`: `...(typeof record.phone === 'string' && record.phone !== '' ? { phone: record.phone } : {})`。
`format.ts`: `export function formatPhoneHref(phone: string): string { return `tel:${phone.replace(/[^\d+]/g, '')}`; }`。
`patientFormView.ts`: `phoneInput = textInput('phone-input', draft?.phone ?? patient?.phone ?? '', '例) 03-1234-5678')` に `input.type = 'tel'`、`aria-required` を付けない(`textInput` に `required = true` の引数を足す)。`field('電話番号(任意)', phoneInput, false)`。`onSave(nameInput.value, addressInput.value, phoneInput.value)`。`styles.css` の `input[type='text']` のセレクタに `input[type='tel']` を足す。
`patientListView.ts` の `renderRow`: `patient.phone` があれば `place-text` の後ろに `<a class="phone-link" data-testid="phone-link" href=formatPhoneHref(phone) aria-label="${name}に電話">☎</a>`(ラベルの外、`more` の前に置く)。`routeMapView.ts` の `route-names` は名前の連結なので、カードに `route-phones`(名前 ☎ の並び)は足さず、**訪問順の画面**(`routeOrderView.ts` の `stop-body`)に電話リンクを足す方が自然。仕様は「一覧・ルートのカードから」なので、`routeMapView.ts` の各カードの下に小さな「電話: 山田様 ☎ / 佐藤様 ☎」の行(`route-phones`、電話があるときだけ)を足す。
`main.ts`: `handleSave(name, address, phone)`、`formDraft` に `phone`、`createPatient(name, address, new Date(), phone)` / `updatePatientFields(existing, name, address, new Date(), phone)`、複製は `phone: source.phone ?? ''`。
`styles.css`: `.phone-link { display: inline-flex; align-items: center; justify-content: center; min-width: var(--tap-min); min-height: var(--tap-min); color: var(--primary); text-decoration: none; font-size: 1.25rem; }`。

- [ ] **Step 4: テスト・型検査** — Run: `npm test && npm run typecheck` → PASS

- [ ] **Step 5: コミット**

```bash
git add src/types.ts src/patient.ts src/backup.ts src/format.ts src/views/patientFormView.ts src/views/patientListView.ts src/views/routeMapView.ts src/main.ts src/styles.css tests/patient.test.ts tests/backup.test.ts tests/format.test.ts tests/patientFormView.test.ts tests/patientListView.test.ts tests/routeMapView.test.ts
git commit -m "feat: 電話番号を登録し、一覧とルートのカードから電話をかけられるようにする"
```

---

### Task 9: 一覧の上部の整理と文字の大きさ

**Files:**
- Modify: `src/views/patientListView.ts`、`tests/patientListView.test.ts`、`src/styles.css`、`tests/styles.test.ts`

- [ ] **Step 1: テストを書く**

`tests/patientListView.test.ts`:
```ts
it('上部は 見出し → 登録ボタン → 検索+全選択 → 並び替え+すべて/選択中 の順', () => {
  const element = renderPatientList(createInitialState(makePatients(1)), handlers());
  const head = element.querySelector('.list-head')!;
  const rows = [...head.children].map((c) => c.className);
  expect(rows).toEqual(['list-title-row', 'list-new-row', 'list-search-row', 'list-controls']);
  expect(head.querySelector('[data-testid="new-button"]')).not.toBeNull();
  expect(head.querySelector('.list-search-row [data-testid="select-all-button"]')).not.toBeNull();
  expect(head.querySelector('.list-controls [data-testid="filter-all"]')).not.toBeNull();
});
```
`tests/styles.test.ts`:
```ts
it('訪問先の名前は 18px(1.125rem)以上、本文は 16px', () => {
  expect(css).toMatch(/\.place-name\s*\{[^}]*font-size:\s*1\.125rem/s);
  expect(css).toMatch(/body\s*\{[^}]*font-size:\s*1rem/s);
});
```

- [ ] **Step 2: 失敗を確認する** — Run: `npx vitest run tests/patientListView.test.ts tests/styles.test.ts` → FAIL

- [ ] **Step 3: 実装する**

`patientListView.ts` の `renderPatientList`: `head.append(renderTitleRow(handlers), renderNewRow(handlers), renderSearchRow(state, handlers), renderListControls(state, handlers))`。
- `renderNewRow`: `div.list-new-row` に既存の `new-button`(`primary block`)を移す(本体側の `container.append(newButton)` は削除)。段階2で「履歴から選ぶ」をこの行の左に足す。
- `renderSearchRow`: `div.list-search-row` に `renderSearch(...)` と `select-all` ボタン(小さく `class="select-all small"`)。
- `renderListControls`: `div.list-controls` に並び替えの `select` と `renderFilterToggle(...)`(Task 5 のものをここへ移す)。
`styles.css`:
```css
.list-new-row { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
.list-search-row { display: flex; gap: 0.5rem; align-items: center; margin-top: 0.5rem; }
.list-search-row .search { flex: 1; }
button.select-all.small { min-height: var(--tap-min); padding: 0 0.75rem; white-space: nowrap; }
.list-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.5rem; padding: 0; }
.segmented { margin-top: 0; }
.place-name { font-size: 1.125rem; font-weight: 600; }
.place-address { color: var(--muted); font-size: 1rem; }
```
既存の `.list-controls` の padding 指定は削除。

- [ ] **Step 4: テスト・型検査** — Run: `npm test && npm run typecheck` → PASS

- [ ] **Step 5: 開発サーバーで見た目を確認する**

`.claude/launch.json` の `route-auto-input-dev` を `preview_start` で起動し、スマホ幅(375px)と、明るい/暗いの両方でスクリーンショットを撮る(`resize_window` の `colorScheme`)。文字が読めるか、ボタンが重なっていないかを見る。気になる点は CSS だけで直す。

- [ ] **Step 6: コミット**

```bash
git add src/views/patientListView.ts src/styles.css tests/patientListView.test.ts tests/styles.test.ts
git commit -m "style: 一覧の上部を整理し、名前の文字を大きくする"
```

---

### Task 10: 「保存して続けて登録」と、同じ人の知らせ

**Files:**
- Create: `src/normalize.ts`、`tests/normalize.test.ts`
- Modify: `src/types.ts`(`Dialog` に `similar`)、`src/views/dialogs.ts`、`tests/dialogs.test.ts`
- Modify: `src/views/patientFormView.ts`、`tests/patientFormView.test.ts`
- Modify: `src/main.ts`、`tests/main.test.ts`

**Interfaces:**
- Produces: `normalizeName(name): string`、`normalizeAddress(address): string`、`findSimilar(patients, input: { name: string; address: string }, excludeId: string | null): Patient[]`(同じ住所または同じ名前。正規化して比べる)。
- Produces: `Dialog` に `{ kind: 'similar'; input: { name: string; address: string; phone: string }; matchIds: string[]; continueAfter: boolean }`。`DialogHandlers.onSaveAnyway(): void`、`onOpenExisting(id: string): void`。
- Produces: `PatientFormHandlers.onSaveAndContinue(name, address, phone): void`、`onCancel(name, address, phone): void`(入力中の値を渡す)。`renderPatientForm` は新規(`patient === null`)のときだけ `save-continue-button` を入力欄の直下に出す。

- [ ] **Step 1: 正規化のテストを書く**

`tests/normalize.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { findSimilar, normalizeAddress, normalizeName } from '../src/normalize';
import { createPatient } from '../src/patient';

describe('normalizeAddress', () => {
  it.each([
    ['東京都 世田谷区 桜丘１－２－３', '東京都世田谷区桜丘1-2-3'],
    ['東京都世田谷区桜丘1丁目2番3号', '東京都世田谷区桜丘1-2-3'],
    ['東京都世田谷区桜丘1ー2−3', '東京都世田谷区桜丘1-2-3'],
    ['東京都世田谷区桜丘1-2-3 ○○マンション101', '東京都世田谷区桜丘1-2-3○○マンション101'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected);
  });
});

describe('normalizeName', () => {
  it('空白と末尾の敬称を除き、全角英数を半角にする', () => {
    expect(normalizeName('山田 太郎 様')).toBe('山田太郎');
    expect(normalizeName('山田太郎さん')).toBe('山田太郎');
    expect(normalizeName('ＡＢＣ商店')).toBe('ABC商店');
  });
});

describe('findSimilar', () => {
  const a = createPatient('山田 太郎', '東京都世田谷区桜丘1-2-3');
  const b = createPatient('佐藤 花子', '東京都世田谷区桜丘1-2-3 A棟201');
  it('同じ住所(書き方が違っても)を見つける', () => {
    expect(findSimilar([a, b], { name: '鈴木', address: '東京都世田谷区桜丘１丁目２番３号' }, null)).toEqual([a]);
  });
  it('同じ名前(敬称の有無が違っても)を見つける', () => {
    expect(findSimilar([a, b], { name: '山田太郎様', address: '大阪府' }, null)).toEqual([a]);
  });
  it('建物名・部屋番号が違えば別扱い', () => {
    expect(findSimilar([a, b], { name: '鈴木', address: '東京都世田谷区桜丘1-2-3 A棟202' }, null)).toEqual([]);
  });
  it('編集中の自分は除く', () => {
    expect(findSimilar([a], { name: a.name, address: a.address }, a.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: 失敗を確認する** — Run: `npx vitest run tests/normalize.test.ts` → FAIL

- [ ] **Step 3: `src/normalize.ts` を書く**

```ts
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
```
注: `ー`(長音)をハイフン扱いにすると「ローソン」のような名前は壊れるが、住所の数字の間でだけ問題になる。名前には `unifyHyphens` を使わない。

- [ ] **Step 4: テストを通す** — Run: `npx vitest run tests/normalize.test.ts` → PASS

- [ ] **Step 5: フォームとダイアログのテストを書く**

`tests/patientFormView.test.ts`:
```ts
it('新規のときだけ「保存して続けて登録」を入力欄の下に出し、押すと onSaveAndContinue', () => {
  const spies = handlers();
  const element = renderPatientForm(null, null, null, spies);
  nameInput(element).value = '山田';
  addressInput(element).value = '東京都';
  q<HTMLButtonElement>(element, 'save-continue-button').click();
  expect(spies.onSaveAndContinue).toHaveBeenCalledWith('山田', '東京都', '');
  expect(renderPatientForm(createPatient('a', 'b'), null, null, handlers()).querySelector('[data-testid="save-continue-button"]')).toBeNull();
});
it('キャンセルは、入力中の値を渡す', () => {
  const spies = handlers();
  const element = renderPatientForm(null, null, null, spies);
  nameInput(element).value = '途中';
  q<HTMLButtonElement>(element, 'cancel-button').click();
  expect(spies.onCancel).toHaveBeenCalledWith('途中', '', '');
});
```
(`handlers()` に `onSaveAndContinue: vi.fn()` を足す。)

`tests/dialogs.test.ts`:
```ts
it('同じ人の知らせ: 見つかった人を出し、そのまま登録/登録済みを開く/戻って直す', () => {
  const existing = createPatient('山田 太郎', '東京都1-2-3');
  const state = {
    ...createInitialState([existing]),
    dialog: { kind: 'similar' as const, input: { name: '山田太郎', address: '大阪府', phone: '' }, matchIds: [existing.id], continueAfter: false },
  };
  const spies = handlers();
  const element = renderDialog(state, spies)!;
  expect(element.textContent).toContain('同じ名前か住所の訪問先があります');
  expect(element.textContent).toContain('山田 太郎');
  element.querySelector<HTMLButtonElement>('[data-testid="dialog-save-anyway"]')!.click();
  expect(spies.onSaveAnyway).toHaveBeenCalled();
  element.querySelector<HTMLButtonElement>('[data-testid="dialog-open-existing"]')!.click();
  expect(spies.onOpenExisting).toHaveBeenCalledWith(existing.id);
  element.querySelector<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();
  expect(spies.onClose).toHaveBeenCalled();
});
```

- [ ] **Step 6: 失敗を確認する** — Run: `npx vitest run tests/patientFormView.test.ts tests/dialogs.test.ts` → FAIL

- [ ] **Step 7: フォームとダイアログを実装する**

`patientFormView.ts`:
- `PatientFormHandlers = { onSave(name, address, phone): void; onSaveAndContinue(name, address, phone): void; onCancel(name, address, phone): void }`。
- `cancel` の click は `handlers.onCancel(nameInput.value, addressInput.value, phoneInput.value)`。
- 入力欄の後ろに、新規のときだけ:
```ts
if (patient === null) {
  const actions = document.createElement('div');
  actions.className = 'form-actions';
  const save = button('form-save-button', '保存', 'primary', () => handlers.onSave(nameInput.value, addressInput.value, phoneInput.value));
  const cont = button('save-continue-button', '保存して続けて登録', '', () => handlers.onSaveAndContinue(nameInput.value, addressInput.value, phoneInput.value));
  actions.append(save, cont);
  container.append(actions);
}
```
(`button` ヘルパーは settingsView と同じ形をこのファイルにも置く。) `styles.css`: `.form-actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: var(--gap); } .form-actions button { flex: 1 1 10rem; min-height: var(--tap-primary); }`。

`types.ts`: `Dialog` に `| { kind: 'similar'; input: { name: string; address: string; phone: string }; matchIds: string[]; continueAfter: boolean }`。`state.ts` の `keepDialog`: `similar` は `matchIds` を `existingIds` で filter し、空になったら null。
`dialogs.ts`: `DialogHandlers` に `onSaveAnyway(): void; onOpenExisting(id: string): void;`。`renderSimilar(state, dialog, handlers)`:
```ts
function renderSimilar(state: AppState, dialog: Extract<Dialog, { kind: 'similar' }>, handlers: DialogHandlers): HTMLElement[] {
  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = '同じ名前か住所の訪問先があります';
  const list = document.createElement('ul');
  list.className = 'sheet-list';
  const matches = dialog.matchIds.map((id) => state.patients.find((p) => p.id === id)).filter((p): p is Patient => p !== undefined);
  for (const match of matches) {
    const item = document.createElement('li');
    item.textContent = `${match.name}(${match.address})`;
    list.append(item);
  }
  const actions = document.createElement('ul');
  actions.className = 'sheet-actions';
  const first = matches[0];
  const entries = [
    { testid: 'dialog-save-anyway', label: 'そのまま登録', onClick: () => handlers.onSaveAnyway() },
    ...(first ? [{ testid: 'dialog-open-existing', label: '登録済みを開く', onClick: () => handlers.onOpenExisting(first.id) }] : []),
    { testid: 'dialog-cancel', label: '戻って直す', onClick: () => handlers.onClose() },
  ];
  for (const entry of entries) {
    const item = document.createElement('li');
    item.append(actionButton(entry.label, entry.testid, entry.onClick));
    actions.append(item);
  }
  return [title, list, actions];
}
```
`styles.css`: `.sheet-list { margin: 0 0 var(--gap); padding-left: 1.25rem; overflow-wrap: anywhere; }`。

- [ ] **Step 8: `main.ts` の流れを組む**

```ts
import { findSimilar } from './normalize';
let continueCount = 0; // 「保存して続けて登録」で続けて登録した人数

type FormInput = { name: string; address: string; phone: string };

/** 保存の入口。検証 → 同じ人の確認 → 保存。 */
async function handleSaveRequest(input: FormInput, continueAfter: boolean): Promise<void> {
  const validation = validatePatientInput(input.name, input.address);
  if (!validation.ok) {
    formDraft = input;
    setState(withMessage(state, { kind: 'error', text: validation.message }));
    return;
  }
  const editing = currentEditingPatient();
  const matches = findSimilar(state.patients, input, editing?.id ?? null);
  if (matches.length > 0) {
    formDraft = input;
    setState({ ...state, dialog: { kind: 'similar', input, matchIds: matches.map((m) => m.id), continueAfter } });
    return;
  }
  await commitSave(input, continueAfter);
}

async function commitSave(input: FormInput, continueAfter: boolean): Promise<void> {
  if (savingPatient) return;
  savingPatient = true;
  try {
    const existing = currentEditingPatient();
    const patient = existing === null
      ? createPatient(input.name, input.address, new Date(), input.phone)
      : updatePatientFields(existing, input.name, input.address, new Date(), input.phone);
    if (existing !== null && state.selectedIds.includes(existing.id)) openedRoutes.clear();
    await savePatient(patient);
    requestProtectionOnce(); // Task 3 の persist
    if (continueAfter && existing === null) {
      continueCount += 1;
      formDraft = { name: '', address: '', phone: '' };
      setState({ ...withScreen(state, { name: 'form', patientId: null }), message: { kind: 'info', text: `${patient.name}様を登録しました(続けて${continueCount}人目)` } });
      await reloadPatients();
      root!.querySelector<HTMLInputElement>('[data-testid="name-input"]')?.focus();
      return;
    }
    continueCount = 0;
    formDraft = null;
    setState(withScreen(state, { name: 'list' }));
    await reloadPatients({ kind: 'info', text: '保存しました。' });
  } catch {
    formDraft = input;
    setState(withMessage(state, { kind: 'error', text: 'データを保存できませんでした。' }));
  } finally {
    savingPatient = false;
  }
}

function handleFormCancel(input: FormInput): void {
  const original = currentEditingPatient();
  const dirty = original === null
    ? input.name.trim() !== '' || input.address.trim() !== '' || input.phone.trim() !== ''
    : input.name !== original.name || input.address !== original.address || input.phone !== (original.phone ?? '');
  if (dirty && !window.confirm('入力中の内容を捨てますか?')) return;
  continueCount = 0;
  formDraft = null;
  setState(withScreen(state, { name: 'list' }));
}
```
`case 'form'`: `onSave: (n, a, p) => void handleSaveRequest({ name: n, address: a, phone: p }, false)`, `onSaveAndContinue: (...) => void handleSaveRequest({...}, true)`, `onCancel: (n, a, p) => handleFormCancel({...})`。ダイアログの `onSaveAnyway: () => { const d = state.dialog; if (d?.kind === 'similar') { setState(closeDialog(state)); void commitSave(d.input, d.continueAfter); } }`, `onOpenExisting: (id) => { continueCount = 0; formDraft = null; setState(withScreen(state, { name: 'form', patientId: id })); }`。`withScreen` はダイアログを閉じるので `similar` も消える。`onNew` で `continueCount = 0`。既存の `handleSave` は削除し、`reloadPatients` の `message` 引数は続けて登録のときに渡さない(上書きしない)。

`tests/main.test.ts` に結合テストを2つ:
```ts
it('保存して続けて登録すると、フォームが空のまま残り、件数のお知らせが出る', async () => {
  await import('../src/main');
  await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
  el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
  el<HTMLInputElement>('[data-testid="name-input"]')!.value = '山田';
  el<HTMLInputElement>('[data-testid="address-input"]')!.value = '東京都1';
  el<HTMLButtonElement>('[data-testid="save-continue-button"]')!.click();
  await waitFor(() => expect(el('.message')?.textContent).toContain('山田様を登録しました(続けて1人目)'));
  expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('');
});
it('同じ住所があれば知らせ、「そのまま登録」で保存される', async () => {
  await import('../src/main');
  await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
  for (const name of ['山田', '佐藤']) {
    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLInputElement>('[data-testid="name-input"]')!.value = name;
    el<HTMLInputElement>('[data-testid="address-input"]')!.value = '東京都１－２－３';
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
    if (name === '佐藤') {
      await waitFor(() => expect(el('[data-testid="dialog-save-anyway"]')).not.toBeNull());
      el<HTMLButtonElement>('[data-testid="dialog-save-anyway"]')!.click();
    }
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
  }
  await waitFor(() => expect(rows()).toHaveLength(2));
});
```

- [ ] **Step 9: テスト・型検査** — Run: `npm test && npm run typecheck` → PASS(`wording.test.ts` のフォーム・ダイアログの handlers を更新し、`similar` ダイアログの文言も検査に足す)

- [ ] **Step 10: コミット**

```bash
git add src/normalize.ts src/types.ts src/state.ts src/views/dialogs.ts src/views/patientFormView.ts src/main.ts src/styles.css tests/normalize.test.ts tests/dialogs.test.ts tests/patientFormView.test.ts tests/main.test.ts tests/wording.test.ts
git commit -m "feat: 保存して続けて登録できるようにし、同じ名前や住所があれば知らせる"
```

---

### Task 11: 仕上げ(ビルドの重さ・実機で確かめる項目・README)

**Files:**
- Modify: `README.md`、`docs/superpowers/plans/2026-09-24-stage1-style-and-basics.md`(この節のチェック)

- [ ] **Step 1: ビルドして重さを確かめる**

Run: `npm run build` → `dist/assets/index-*.js` の大きさを見る。目安 120KB 以内(段階1では 60KB 前後のはず)。

- [ ] **Step 2: 開発サーバーで通しの動作を見る**

`preview_start`(`route-auto-input-dev`)で、次を確認してスクリーンショットを残す:
- 明るい/暗い(`resize_window` の `colorScheme`)の両方で、一覧・登録・訪問順・設定
- ホーム画面の案内 → 「やり方を見る」の手順 → 閉じる
- 5件登録 → バックアップのお知らせ → 「今すぐバックアップ」で設定の「最後のバックアップ」が今日になる
- 「選択中」の切り替え・帯・薄い行・「N件選択中」からの切り替え
- 訪問順の「⋯」→ 先頭へ/最後へ、11件以上での区切り
- 続けて登録、同じ住所の知らせ、電話リンク

- [ ] **Step 3: README を更新する**

「主な機能」に、表示の切り替え(ダークモード)、データの保存状態、バックアップのお知らせ、ホーム画面の案内、すべて/選択中、30件、電話番号、続けて登録、同じ人の知らせ を追記。

- [ ] **Step 4: 実機で確かめる項目(公開後に利用者が行う)**

以下を README の「試運転で確かめること」として書く:
- iPhone Safari(タブ): 案内が出る → 共有 → ホーム画面に追加 → ホーム画面から開くと案内が出ない
- Android Chrome: 「ホーム画面に追加」ボタン1つで追加できる
- PC Chrome/Edge: 「やり方を見る」の手順が合っている。アドレスバーのインストールで追加できる
- 昼の屋外と夜の車内で、明るい/暗いの両方が読める
- 設定「データの保存」が「保護されています」になる(Android/PC)。iPhoneは「通常」または「確認中」でもよい
- 5件以上で1か月後にお知らせが出る(端末の日付を進めて確認してもよい)
- 電話リンクで電話アプリが開く

- [ ] **Step 5: コミット(push は利用者の確認を得てから)**

```bash
git add README.md
git commit -m "docs: 段階1の機能と、試運転で確かめることを README に書く"
```

---

## Self-Review

**Spec coverage(1〜3章・7章・8章):**
- 1.1 色・コントラスト → Task 1 / 1.2 切り替え → Task 1, 2 / 1.3 画面の整理・文字の大きさ → Task 9(「履歴から選ぶ」は段階2)
- 2 ホーム画面の案内 → Task 4 / 「消さないで」 → Task 3 / バックアップのお知らせ → Task 3 / 同時に1つ(ホーム画面が優先) → Task 4 の `currentNotice()` の順序
- 3.1 表示範囲・薄い行・検索範囲・30件・区切り・先頭へ/最後へ → Task 5, 6, 7
- 3.2 電話・続けて登録・同じ人・正規化・キャンセルの確認 → Task 8, 10
- 3.3 設定の言葉・並び・最後のバックアップ → Task 2, 3(「出発地・帰着地」の節は段階2で先頭に足す)
- 7 DB バージョン 2・meta → Task 2(`history`/`photos`/`spots` は段階2・3で足す。`upgrade` の `oldVersion` 分岐で足せる形にしてある)
- 8 純粋な関数を先にテスト・ブラウザ依存は薄い層・実機の項目・ビルドの重さ → 各 Task、Task 11

**Placeholder scan:** なし(すべてのコード・テストを記載)。
**Type consistency:** `SettingsInfo`(Task 2/3)、`Notice`(Task 3/4)、`listFilter/dimmedIds`(Task 5/9)、`FormInput`・`PatientFormHandlers`(Task 8/10)、`Dialog` の追加(Task 4/7/10)の名前を確認済み。`requestProtectionOnce()` は Task 3 Step 13 の「persistRequested」の処理を関数にまとめたもの(Task 10 で参照するため、Task 3 で `function requestProtectionOnce(): void` として定義する)。
