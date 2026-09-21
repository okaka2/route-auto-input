# 訪問ルート作成 UI/UX改善 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 既存のルート作成アプリを、業種に依存しない汎用の「訪問ルート作成」として、3ステップ(訪問先を選ぶ → 訪問順を決める → 地図で開く)で迷わず使える画面に作り直す。

**Architecture:** 保存(IndexedDB)、URL生成、ルート分割、PWAの仕組みは変えず、画面(`src/views/`)・見た目(`src/styles.css`)・画面遷移の結線(`src/main.ts`)を作り直す。画面は今までどおり「状態を受け取ってDOMを返す純粋な関数」で、`main.ts`が状態と副作用を持つ。地図サービスは`MapProvider`型の裏に隠す。

**Tech Stack:** Vite + TypeScript(UIフレームワークなし)、`idb`、Vitest + jsdom + fake-indexeddb、vite-plugin-pwa。

**Spec:** `docs/superpowers/specs/2026-09-21-ui-redesign-design.md`

## Global Constraints

- **保存形式を変えない。** IndexedDBの構造(DB名`route-auto-input`、バージョン1、ストア`patients`)、バックアップファイルの形式は一切変更しない。
- 訪問先のデータを端末外へ送信しない。ネットワーク通信は、ユーザーが押した「地図で開く」の遷移だけ。
- 氏名・住所を`console`へ出力しない。例外メッセージにも含めない。
- 実行時依存は`idb`のみ。UI部品ライブラリを追加しない。
- **画面上の文言に「患者」「薬局」「在宅」「医療」「利用者」を使わない。** 代わりに「訪問先」「行き先」「場所」「ルート」を使う。内部の識別子(`Patient`型、`patient.ts`など)と、ソースコード中のコメントは変えない。
- `MAX_STOPS_PER_ROUTE`と`MAX_SELECTION`は`src/config.ts`の1か所だけで定義し、他では import して使う。値を文言に直接書かない。
- 訪問順の自動最適化はしない。
- タップ領域は44px以上(`--tap-min: 2.75rem`)。本文は16px、補助の文字も14px(0.875rem)未満にしない。入力欄は16px以上。
- 色は`src/styles.css`の変数だけを使う。文字と背景の組み合わせは、通常の文字で4.5:1以上、枠などの部品は3:1以上。赤は「削除・警告」だけに使う。
- フォーカス表示を消さない(`outline: none`を書かない)。状態を色だけで示さない。
- 既存のテストを削らない。文言・構造が変わって直すときは、同じ振る舞いを新しい構造で検証する形に書き直し、テスト件数を減らさない。
- 既存のテスト(現在154件)が、各タスクの終わりにすべて通ること。
- 作業ディレクトリは`C:\Users\owner\Desktop\route-auto-input`、ブランチは`main`から切った作業ブランチ。Node v24 / npm 11 / git 2.55。コミットの作者は、このリポジトリの設定(`okaka2`のnoreplyアドレス)のまま。`git config`を変えない。**push しない。**
- 画面の文言は日本語。コミットメッセージも日本語で、末尾に `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` を付ける。

---

## ファイル構成

| ファイル | 責務 | 種別 |
|---|---|---|
| `src/appInfo.ts` | `APP_NAME`(アプリ名の一元管理) | 新規 |
| `src/mapProviders.ts` | `MapProvider`型と`googleMapsProvider` | 新規 |
| `src/format.ts` | `formatDateTime`(開いた日時の表示) | 新規 |
| `src/session.ts` | 開いたルートの日時の記録、旧形式の読み込み | 変更 |
| `src/types.ts` | `Screen`に`map`、`Dialog`型、`AppState.dialog` | 変更 |
| `src/state.ts` | ダイアログの開閉、`hasSelection` | 変更 |
| `src/validation.ts` | 文言(訪問先・件) | 変更 |
| `src/views/common.ts` | 画面の見出し(戻るボタン付き)、メッセージ表示 | 新規 |
| `src/views/tabBar.ts` | 下部のタブ(ステップ表示を兼ねる) | 新規 |
| `src/views/selectionBar.ts` | 下部の選択バー | 新規 |
| `src/views/dialogs.ts` | 「⋯」メニューと削除の確認 | 新規 |
| `src/views/routeMapView.ts` | 地図を開く画面(ルートのカード) | 新規 |
| `src/views/routeOrderView.ts` | 訪問順の画面 | 変更 |
| `src/views/patientListView.ts` | 訪問先を選ぶ画面 | 変更 |
| `src/views/patientFormView.ts` | 訪問先の登録・編集 | 変更 |
| `src/views/settingsView.ts` | 設定 | 変更 |
| `src/main.ts` | 結線 | 変更 |
| `src/styles.css` | 変数・全体の見た目 | 変更 |
| `index.html`、`vite.config.ts` | アプリ名の一元管理 | 変更 |
| `README.md` | 用語の更新 | 変更 |

---

### Task 1: 起動直後の読み込みが、表示中のメッセージを消す不具合の修正

公開中のアプリにもある不具合。起動直後に走る患者一覧の読み込み(`reloadPatients()`)が、終わった瞬間に`message: null`で表示中のメッセージを消す。起動した瞬間に操作すると、直後に出たエラーが消える。

**Files:**
- Modify: `src/main.ts`(`reloadPatients`)
- Test: `tests/main.test.ts`(末尾に追加)

**Interfaces:**
- Consumes: なし
- Produces: `reloadPatients(message?: Message)` — 引数を省略したときは、今のメッセージを保つ(内部関数)

- [ ] **Step 1: 失敗するテストを書く**

`tests/main.test.ts`の末尾に追加する(既存の`el`、`waitFor`などのヘルパーはこのファイルの先頭で定義済み)。

```ts
describe('起動直後の読み込み', () => {
  it('読み込みが終わっても、操作の結果として表示中のメッセージを消さない', async () => {
    await import('../src/main');
    // 起動直後のDB読み込みは、まだ終わっていない。この間に、すぐエラーが出る操作をする。
    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
    expect(el('.message')?.textContent).toContain('氏名を入力してください');

    // 読み込みが終わるのを待つ(fake-indexeddb は数ミリ秒で終わる)。
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(el('.message')?.textContent).toContain('氏名を入力してください');
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/main.test.ts -t "起動直後の読み込み"
```

期待: FAIL(読み込み完了後に`.message`が消えて`undefined`になる)。

- [ ] **Step 3: 修正する**

`src/main.ts`の`reloadPatients`を次のとおり置き換える。

```ts
/**
 * DBから患者を読み直す。message を渡したときだけ、表示中のメッセージを差し替える。
 * 省略したとき(起動直後の読み込みなど)は今のメッセージを保つ。保たないと、読み込みが
 * 終わった瞬間に、操作の結果として出たばかりのエラーや案内を消してしまう。
 */
async function reloadPatients(message?: Message): Promise<void> {
  try {
    const patients = await listPatients();
    setState({
      ...withPatients(state, patients),
      ...(message === undefined ? {} : { message }),
    });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを読み込めませんでした。' }));
  }
}
```

- [ ] **Step 4: 成功を確認する**

```bash
npx vitest run tests/main.test.ts && npm run test && npm run typecheck
```

期待: すべてPASS(154件+追加の1件)、型エラーなし。

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "fix: 起動直後の読み込みが表示中のメッセージを消す不具合を直す

読み込みの完了時に message: null で上書きしていたため、起動した瞬間に
操作すると、直後に出たエラーが消えた。message を渡したときだけ差し替える。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: アプリ名の一元管理

**Files:**
- Create: `src/appInfo.ts`, `tests/appInfo.test.ts`
- Modify: `index.html`, `vite.config.ts`, `tests/indexHtml.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `APP_NAME: string`(`'訪問ルート作成'`)、`APP_DESCRIPTION: string`。画面の見出し(Task 11)が`APP_NAME`を読む。

- [ ] **Step 1: 失敗するテストを書く**

`tests/appInfo.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { APP_DESCRIPTION, APP_NAME } from '../src/appInfo';

const FORBIDDEN_WORDS = ['患者', '薬局', '在宅', '医療', '利用者'];

describe('appInfo', () => {
  it('アプリ名は「訪問ルート作成」', () => {
    expect(APP_NAME).toBe('訪問ルート作成');
  });

  it('アプリ名と説明に、業種特有の表現を含めない', () => {
    for (const word of FORBIDDEN_WORDS) {
      expect(APP_NAME).not.toContain(word);
      expect(APP_DESCRIPTION).not.toContain(word);
    }
  });
});
```

`tests/indexHtml.test.ts`の`describe('index.html', ...)`の中(最後の`it`の後)に追加する。

```ts
  it('タイトルは APP_NAME に置き換わるプレースホルダーで、名前を直接書かない', () => {
    expect(doc.querySelector('title')?.textContent).toBe('%APP_NAME%');
  });

  it('ホーム画面用の名前も、同じプレースホルダーにする', () => {
    const title = doc.querySelector('meta[name="apple-mobile-web-app-title"]');
    expect(title?.getAttribute('content')).toBe('%APP_NAME%');
  });
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/appInfo.test.ts tests/indexHtml.test.ts
```

期待: FAIL(`src/appInfo`が解決できない、タイトルがプレースホルダーでない)。

- [ ] **Step 3: `src/appInfo.ts`を作る**

```ts
/**
 * アプリ名の一元管理。画面の見出し、index.html の <title> と
 * apple-mobile-web-app-title、PWAのマニフェストの名前は、すべてここから決まる。
 * 名称を変えるときは、この1か所だけを直す。
 */
export const APP_NAME = '訪問ルート作成';

export const APP_DESCRIPTION = '訪問先を選んで、訪問順を決めて、地図でルートを開きます。';
```

- [ ] **Step 4: `index.html`をプレースホルダーにする**

`<title>ルート自動入力</title>`を次に置き換える。

```html
    <title>%APP_NAME%</title>
```

`<meta name="apple-mobile-web-app-title" content="ルート自動入力" />`を次に置き換える。

```html
    <meta name="apple-mobile-web-app-title" content="%APP_NAME%" />
```

- [ ] **Step 5: `vite.config.ts`を置き換える**

```ts
import type { Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';
import { APP_DESCRIPTION, APP_NAME } from './src/appInfo';

/** index.html の %APP_NAME% を、ビルド時・開発サーバー起動時に APP_NAME へ置き換える。 */
const appNameInHtml: Plugin = {
  name: 'app-name-in-html',
  transformIndexHtml: (html) => html.replaceAll('%APP_NAME%', APP_NAME),
};

export default defineConfig({
  base: '/route-auto-input/',
  plugins: [
    appNameInHtml,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: APP_NAME,
        short_name: APP_NAME,
        description: APP_DESCRIPTION,
        lang: 'ja',
        start_url: '/route-auto-input/',
        scope: '/route-auto-input/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0b57d0',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 6: テストと型チェックを通す**

```bash
npm run test && npm run typecheck
```

期待: すべてPASS。

- [ ] **Step 7: ビルドの出力で、名前が置き換わっていることを確認する**

```bash
npm run build
grep -o '<title>[^<]*</title>' dist/index.html
grep -o 'apple-mobile-web-app-title" content="[^"]*"' dist/index.html
grep -o '"name":"[^"]*"' dist/manifest.webmanifest
grep -o '"short_name":"[^"]*"' dist/manifest.webmanifest
grep -c '%APP_NAME%' dist/index.html
```

期待: どれも「訪問ルート作成」になり、最後の`grep -c`は`0`(プレースホルダーが残っていない)。

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: アプリ名を訪問ルート作成に変え、一元管理する

APP_NAME を src/appInfo.ts の1か所に定義し、index.html のタイトルと
ホーム画面用の名前、PWAのマニフェストがそこから決まるようにした。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: 地図サービスとの連携を分離する

**Files:**
- Create: `src/mapProviders.ts`, `tests/mapProviders.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `buildGoogleMapsUrl(addresses: readonly string[]): string`(`src/googleMapsUrl.ts`)
- Produces:
  - `type MapProvider = { id: string; label: string; buildUrl(addresses: readonly string[]): string }`
  - `googleMapsProvider: MapProvider`
  - `DEFAULT_MAP_PROVIDER: MapProvider`(今は`googleMapsProvider`)

- [ ] **Step 1: 失敗するテストを書く**

`tests/mapProviders.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildGoogleMapsUrl } from '../src/googleMapsUrl';
import { DEFAULT_MAP_PROVIDER, googleMapsProvider } from '../src/mapProviders';

describe('googleMapsProvider', () => {
  it('idとラベルを持つ', () => {
    expect(googleMapsProvider.id).toBe('google');
    expect(googleMapsProvider.label).toBe('Googleマップ');
  });

  it('経路のURLは、これまでのURL生成と同じ', () => {
    const addresses = ['東京都千代田区1-1', '大阪市北区2-2', '京都市中京区3-3'];
    expect(googleMapsProvider.buildUrl(addresses)).toBe(buildGoogleMapsUrl(addresses));
  });

  it('1件のときは、地点検索のURLになる', () => {
    const url = new URL(googleMapsProvider.buildUrl(['東京都千代田区1-1']));
    expect(url.pathname).toBe('/maps/search/');
    expect(url.searchParams.get('query')).toBe('東京都千代田区1-1');
  });

  it('空の住所が含まれていれば、これまでと同じく例外を投げる', () => {
    expect(() => googleMapsProvider.buildUrl(['東京都', ' '])).toThrow();
  });
});

describe('DEFAULT_MAP_PROVIDER', () => {
  it('今はGoogleマップ', () => {
    expect(DEFAULT_MAP_PROVIDER).toBe(googleMapsProvider);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/mapProviders.test.ts
```

期待: FAIL(`../src/mapProviders`が解決できない)。

- [ ] **Step 3: `src/mapProviders.ts`を作る**

```ts
import { buildGoogleMapsUrl } from './googleMapsUrl';

/**
 * 地図サービスの差し替え口。画面は MapProvider だけを知り、URLの作り方や
 * ボタンに出すサービス名(label)は、ここで決まる。
 * Apple Maps などに対応するときは、この型の値を1つ足して DEFAULT_MAP_PROVIDER を
 * 切り替えるか、選べるようにする。
 */
export type MapProvider = {
  id: string;
  /** 「〇〇で開く」の〇〇に入る、サービスの表示名 */
  label: string;
  /** 訪問順に並んだ住所から、地図を開くURLを作る。1件なら地点検索、2件以上なら経路。 */
  buildUrl(addresses: readonly string[]): string;
};

export const googleMapsProvider: MapProvider = {
  id: 'google',
  label: 'Googleマップ',
  buildUrl: buildGoogleMapsUrl,
};

export const DEFAULT_MAP_PROVIDER: MapProvider = googleMapsProvider;
```

- [ ] **Step 4: `src/main.ts`をProvider経由にする**

import行を置き換える。

```ts
import { buildGoogleMapsUrl } from './googleMapsUrl';
```
↓
```ts
import { DEFAULT_MAP_PROVIDER } from './mapProviders';
```

`handleOpenRoute`の中の次の行を置き換える。

```ts
    const url = buildGoogleMapsUrl(route.map((patient) => patient.address));
```
↓
```ts
    const url = DEFAULT_MAP_PROVIDER.buildUrl(route.map((patient) => patient.address));
```

- [ ] **Step 5: すべて通す**

```bash
npm run test && npm run typecheck
```

期待: すべてPASS。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "refactor: 地図サービスとの連携を MapProvider に分離する

URL生成とサービス名を MapProvider にまとめ、main.ts はそれ経由で地図を開く。
Apple Maps など他のサービスを、あとから足せる形にする。挙動は変えない。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: 開いたルートの日時を記録する

**Files:**
- Modify: `src/session.ts`(全体を置き換え)、`tests/session.test.ts`(全体を置き換え)、`src/main.ts`、`tests/main.test.ts`(1行)

**Interfaces:**
- Consumes: なし
- Produces:
  - `type OpenedRoute = { index: number; at: string }`
  - `type SessionRecord = { selectedIds: string[]; opened: OpenedRoute[]; timestamp: string }`
  - `saveSession(record)`、`loadSession(now?)`、`clearSession()`(名前と役割は変えない)
  - `loadSession`は、古い形式(`openedRouteIndexes: number[]`)の記録も読み、`opened`に`at: ''`で変換して返す。

- [ ] **Step 1: 失敗するテストを書く**

`tests/session.test.ts`を、次の内容で置き換える。

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { clearSession, loadSession, saveSession, type SessionRecord } from '../src/session';

const STORAGE_KEY = 'route-auto-input:session';

beforeEach(() => {
  window.localStorage.clear();
});

const record = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  selectedIds: ['id-1', 'id-2'],
  opened: [{ index: 0, at: '2026-09-03T09:30:00.000Z' }],
  timestamp: new Date('2026-09-03T09:00:00.000Z').toISOString(),
  ...overrides,
});

describe('saveSession / loadSession', () => {
  it('保存した内容をそのまま読み込める', () => {
    saveSession(record());
    expect(loadSession(new Date('2026-09-03T10:00:00.000Z'))).toEqual(record());
  });

  it('記録がなければnullを返す', () => {
    expect(loadSession()).toBeNull();
  });

  it('氏名・住所を書き込む余地がない(idと番号と日時のみの型)', () => {
    saveSession(record());
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(Object.keys(parsed).sort()).toEqual(['opened', 'selectedIds', 'timestamp']);
  });

  it('開いたルートは、番号と日時の組で保存される', () => {
    saveSession(record({ opened: [{ index: 1, at: '2026-09-03T09:45:00.000Z' }] }));
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(parsed.opened).toEqual([{ index: 1, at: '2026-09-03T09:45:00.000Z' }]);
  });

  it('開いたルートが0件でも保存・復元できる', () => {
    saveSession(record({ opened: [] }));
    expect(loadSession(new Date('2026-09-03T10:00:00.000Z'))?.opened).toEqual([]);
  });
});

describe('古い形式(開いたルートの番号だけ)の記録', () => {
  it('読み込めて、日時は空文字になる', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selectedIds: ['id-1'],
        openedRouteIndexes: [0, 2],
        timestamp: new Date('2026-09-03T09:00:00.000Z').toISOString(),
      }),
    );
    expect(loadSession(new Date('2026-09-03T10:00:00.000Z'))).toEqual({
      selectedIds: ['id-1'],
      opened: [
        { index: 0, at: '' },
        { index: 2, at: '' },
      ],
      timestamp: '2026-09-03T09:00:00.000Z',
    });
  });

  it('古い形式でも、12時間を超えていれば破棄される', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selectedIds: [],
        openedRouteIndexes: [],
        timestamp: new Date('2026-09-03T00:00:00.000Z').toISOString(),
      }),
    );
    expect(loadSession(new Date('2026-09-03T12:00:01.000Z'))).toBeNull();
  });
});

describe('12時間の期限切れ', () => {
  it('12時間以内なら復元できる', () => {
    saveSession(record({ timestamp: new Date('2026-09-03T00:00:00.000Z').toISOString() }));
    const now = new Date('2026-09-03T11:59:59.000Z');
    expect(loadSession(now)).not.toBeNull();
  });

  it('12時間を超えると破棄される', () => {
    saveSession(record({ timestamp: new Date('2026-09-03T00:00:00.000Z').toISOString() }));
    const now = new Date('2026-09-03T12:00:01.000Z');
    expect(loadSession(now)).toBeNull();
  });
});

describe('clearSession', () => {
  it('記録を消す', () => {
    saveSession(record());
    clearSession();
    expect(loadSession()).toBeNull();
  });

  it('記録がなくても例外を投げない', () => {
    expect(() => clearSession()).not.toThrow();
  });
});

describe('壊れたデータへの耐性', () => {
  it('JSONとして壊れていればnullを返す', () => {
    window.localStorage.setItem(STORAGE_KEY, '{ not json');
    expect(loadSession()).toBeNull();
  });

  it('形式が合わなければnullを返す', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
    expect(loadSession()).toBeNull();
  });

  it('selectedIdsが配列でなければnullを返す', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ selectedIds: 'id-1', opened: [], timestamp: new Date().toISOString() }),
    );
    expect(loadSession()).toBeNull();
  });

  it('openedが配列でも、要素の形が合わなければnullを返す', () => {
    const base = { selectedIds: [], timestamp: new Date().toISOString() };
    for (const opened of [[1], [{ index: 'a', at: '' }], [{ index: 0 }], [{ index: 0.5, at: '' }], [null]]) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...base, opened }));
      expect(loadSession()).toBeNull();
    }
  });

  it('openedもopenedRouteIndexesも無ければnullを返す', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ selectedIds: [], timestamp: new Date().toISOString() }),
    );
    expect(loadSession()).toBeNull();
  });

  it('timestampが不正な日時文字列でもnullを返す', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ selectedIds: [], opened: [], timestamp: 'not-a-date' }),
    );
    expect(loadSession()).toBeNull();
  });

  it('localStorageが例外を投げても呼び出し側には伝播しない', () => {
    const original = window.localStorage.getItem;
    try {
      window.localStorage.getItem = () => {
        throw new Error('blocked');
      };
      expect(() => loadSession()).not.toThrow();
      expect(loadSession()).toBeNull();
    } finally {
      window.localStorage.getItem = original;
    }
  });

  it('saveSessionがlocalStorageの例外を飲み込む', () => {
    const original = window.localStorage.setItem;
    try {
      window.localStorage.setItem = () => {
        throw new Error('quota exceeded');
      };
      expect(() => saveSession(record())).not.toThrow();
    } finally {
      window.localStorage.setItem = original;
    }
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/session.test.ts
```

期待: FAIL(`opened`の項目がない、型が合わない)。

- [ ] **Step 3: `src/session.ts`を置き換える**

```ts
/**
 * Googleマップへ遷移して戻ってきたとき(iOSがPWAをメモリから追い出した場合を含む)に
 * 選択・訪問順・開いたルートを復元するための一時記録。`localStorage` に保存する
 * (`sessionStorage` はページの再読み込みでも失われうるため使わない)。
 *
 * 保存するのは訪問先のid(UUID)・開いたルートの番号と日時・タイムスタンプのみ。
 * 氏名・住所は絶対に書き込まない。
 */

export type OpenedRoute = {
  /** ルートの番号(0始まり) */
  index: number;
  /** 開いた日時(ISO 8601)。日時が分からない古い記録から復元したものは '' */
  at: string;
};

export type SessionRecord = {
  /** 訪問順に並んだ、選択中の訪問先のid */
  selectedIds: string[];
  opened: OpenedRoute[];
  /** 記録した日時(ISO 8601)。12時間で期限切れにする */
  timestamp: string;
};

const STORAGE_KEY = 'route-auto-input:session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function isOpenedRoute(value: unknown): value is OpenedRoute {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const route = value as Record<string, unknown>;
  return Number.isInteger(route.index) && typeof route.at === 'string';
}

/**
 * 保存された値を SessionRecord に直す。形式が合わなければ null。
 * 古い形式(開いたルートの番号だけの `openedRouteIndexes`)も読み、日時は '' にする。
 */
function toSessionRecord(value: unknown): SessionRecord | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    !Array.isArray(record.selectedIds) ||
    !record.selectedIds.every((id) => typeof id === 'string') ||
    typeof record.timestamp !== 'string'
  ) {
    return null;
  }

  let opened: OpenedRoute[];
  if (Array.isArray(record.opened)) {
    if (!record.opened.every(isOpenedRoute)) {
      return null;
    }
    opened = record.opened.map((route) => ({ index: route.index, at: route.at }));
  } else if (
    Array.isArray(record.openedRouteIndexes) &&
    record.openedRouteIndexes.every((index) => typeof index === 'number')
  ) {
    opened = record.openedRouteIndexes.map((index) => ({ index, at: '' }));
  } else {
    return null;
  }

  return { selectedIds: record.selectedIds as string[], opened, timestamp: record.timestamp };
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
 * 訪問先のidがまだ存在するかどうかはここでは確認しない
 * (`withPatients` がDB再読み込み時に自動で選択から外すため)。
 */
export function loadSession(now: Date = new Date()): SessionRecord | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = toSessionRecord(JSON.parse(raw));
    if (parsed === null) {
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
```

- [ ] **Step 4: `src/main.ts`を、開いたルートの日時を持つ形に直す**

次の5か所を置き換える(いずれもこのファイルで1か所ずつ)。

(1) 
```ts
const openedRouteIndexes = new Set<number>(restoredSession?.openedRouteIndexes ?? []);
```
↓
```ts
// 開いたルートの番号と、開いた日時(ISO 8601。日時が分からない古い記録から復元したものは '')。
const openedRoutes = new Map<number, string>(
  (restoredSession?.opened ?? []).map((route) => [route.index, route.at] as const),
);
```

(2) `syncSession`の中
```ts
    openedRouteIndexes: [...openedRouteIndexes],
```
↓
```ts
    opened: [...openedRoutes].map(([index, at]) => ({ index, at })),
```

(3) `handleOpenRoute`の中
```ts
    openedRouteIndexes.add(routeIndex);
```
↓
```ts
    openedRoutes.set(routeIndex, new Date().toISOString());
```

(4) 一覧画面の`onNext`の中
```ts
          openedRouteIndexes.clear();
```
↓
```ts
          openedRoutes.clear();
```

(5) 訪問順の画面の呼び出し
```ts
      return renderRouteOrder(state, openedRouteIndexes, {
```
↓
```ts
      return renderRouteOrder(state, new Set(openedRoutes.keys()), {
```

- [ ] **Step 5: `tests/main.test.ts`の期待を1行直す**

次の行を探して置き換える(`セッションの永続化(#1)`の最初のテストの中)。

```ts
    expect(record.openedRouteIndexes).toEqual([0]);
```
↓
```ts
    expect(record.opened).toEqual([{ index: 0, at: expect.any(String) }]);
```

- [ ] **Step 6: すべて通す**

```bash
npm run test && npm run typecheck
```

期待: すべてPASS。

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: 開いたルートの日時を端末内に記録する

記録に、ルートの番号に加えて開いた日時を持たせる。古い形式(番号のみ)の
記録も読めるようにし、日時は空として扱う。氏名・住所は含めない。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: ダイアログの状態

**Files:**
- Modify: `src/types.ts`, `src/state.ts`, `tests/state.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `type Dialog = { kind: 'rowMenu'; id: string } | { kind: 'confirmDelete'; id: string }`
  - `AppState.dialog: Dialog | null`
  - `openRowMenu(state, id): AppState`、`openDeleteConfirm(state, id): AppState`、`closeDialog(state): AppState`、`hasSelection(state): boolean`
  - `withScreen`は、ダイアログも閉じる。`withPatients`は、対象の訪問先がなくなったダイアログを閉じる。

- [ ] **Step 1: 失敗するテストを書く**

`tests/state.test.ts`のimportを置き換える。

```ts
import {
  createInitialState,
  moveSelected,
  selectedPatients,
  setSearchQuery,
  toggleSelection,
  visiblePatients,
  withMessage,
  withPatients,
  withScreen,
} from '../src/state';
```
↓
```ts
import {
  closeDialog,
  createInitialState,
  hasSelection,
  moveSelected,
  openDeleteConfirm,
  openRowMenu,
  selectedPatients,
  setSearchQuery,
  toggleSelection,
  visiblePatients,
  withMessage,
  withPatients,
  withScreen,
} from '../src/state';
```

ファイルの末尾に追加する。

```ts
describe('ダイアログの状態', () => {
  it('最初はダイアログが開いていない', () => {
    expect(createInitialState([]).dialog).toBeNull();
  });

  it('「⋯」メニューを開くと、その訪問先のメニューになる', () => {
    const state = openRowMenu(createInitialState(makePatients(2)), 'p1');
    expect(state.dialog).toEqual({ kind: 'rowMenu', id: 'p1' });
  });

  it('削除の確認を開くと、その訪問先の確認になる', () => {
    const state = openDeleteConfirm(createInitialState(makePatients(2)), 'p1');
    expect(state.dialog).toEqual({ kind: 'confirmDelete', id: 'p1' });
  });

  it('メニューから削除の確認へ切り替えられる', () => {
    let state = openRowMenu(createInitialState(makePatients(2)), 'p1');
    state = openDeleteConfirm(state, 'p1');
    expect(state.dialog?.kind).toBe('confirmDelete');
  });

  it('閉じると、ダイアログがなくなる', () => {
    const state = closeDialog(openRowMenu(createInitialState(makePatients(2)), 'p1'));
    expect(state.dialog).toBeNull();
  });

  it('開いていないときに閉じても、同じ状態を返す', () => {
    const state = createInitialState(makePatients(2));
    expect(closeDialog(state)).toBe(state);
  });

  it('画面を切り替えると、ダイアログも閉じる', () => {
    const state = withScreen(openRowMenu(createInitialState(makePatients(2)), 'p1'), { name: 'settings' });
    expect(state.dialog).toBeNull();
  });

  it('対象の訪問先がなくなったら、ダイアログを閉じる', () => {
    const patients = makePatients(2);
    const opened = openRowMenu(createInitialState(patients), patients[0]!.id);
    const next = withPatients(opened, [patients[1]!]);
    expect(next.dialog).toBeNull();
  });

  it('対象の訪問先が残っていれば、ダイアログは開いたまま', () => {
    const patients = makePatients(2);
    const opened = openRowMenu(createInitialState(patients), patients[0]!.id);
    const next = withPatients(opened, patients);
    expect(next.dialog).toEqual({ kind: 'rowMenu', id: patients[0]!.id });
  });

  it('入力の状態を書き換えない', () => {
    const state = createInitialState(makePatients(2));
    openRowMenu(state, 'p1');
    expect(state.dialog).toBeNull();
  });
});

describe('hasSelection', () => {
  it('1件も選んでいなければ false', () => {
    expect(hasSelection(createInitialState(makePatients(2)))).toBe(false);
  });

  it('1件以上選んでいれば true', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    expect(hasSelection(state)).toBe(true);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/state.test.ts
```

期待: FAIL(`openRowMenu`などが export されていない)。

- [ ] **Step 3: `src/types.ts`に型を足す**

`Message`型の定義の直前に`Dialog`型を足す。

```ts
/** 開いているダイアログ。対象の訪問先のidを持つ。 */
export type Dialog = { kind: 'rowMenu'; id: string } | { kind: 'confirmDelete'; id: string };

```

`AppState`型の`message: Message | null;`の直後に追加する。

```ts
  /** 開いているダイアログ。なければ null。 */
  dialog: Dialog | null;
```

- [ ] **Step 4: `src/state.ts`を直す**

`createInitialState`の返り値の`message: null,`の直後に`dialog: null,`を足す。

```ts
    message: null,
    dialog: null,
```

`withPatients`を置き換える。

```ts
/** DBを読み直したときに使う。存在しなくなった訪問先の選択と、その訪問先のダイアログは外す。 */
export function withPatients(state: AppState, patients: Patient[]): AppState {
  const existingIds = new Set(patients.map((patient) => patient.id));
  return {
    ...state,
    patients,
    selectedIds: state.selectedIds.filter((id) => existingIds.has(id)),
    dialog: state.dialog !== null && existingIds.has(state.dialog.id) ? state.dialog : null,
  };
}
```

`withScreen`を置き換える。

```ts
export function withScreen(state: AppState, screen: Screen): AppState {
  return { ...state, screen, message: null, dialog: null };
}
```

ファイルの末尾に追加する。

```ts
export function openRowMenu(state: AppState, id: string): AppState {
  return { ...state, dialog: { kind: 'rowMenu', id } };
}

export function openDeleteConfirm(state: AppState, id: string): AppState {
  return { ...state, dialog: { kind: 'confirmDelete', id } };
}

/** ダイアログを閉じる。開いていなければ、同じ状態をそのまま返す。 */
export function closeDialog(state: AppState): AppState {
  return state.dialog === null ? state : { ...state, dialog: null };
}

/** 訪問先を1件以上選んでいるか。 */
export function hasSelection(state: AppState): boolean {
  return state.selectedIds.length > 0;
}
```

- [ ] **Step 5: すべて通す**

```bash
npm run test && npm run typecheck
```

期待: すべてPASS。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: ダイアログ(「⋯」メニュー・削除の確認)の状態を追加する

AppState に dialog を持たせ、開く・閉じる・切り替える関数を足す。
画面の切り替えと、対象の訪問先がなくなったときにも、自動で閉じる。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---
### Task 6: デザインの基盤(色・大きさ・共通の見た目)

色と大きさを変数に集め、ボタン・入力欄・メッセージなどの共通の見た目を作り直す。文字と背景の組み合わせは、テストで実際にコントラスト比を計算して確かめる。画面ごとの見た目は、それぞれの画面のタスクで作り直す(それまでは、既存の画面用の規則を、変えずに残す)。

**Files:**
- Modify: `src/styles.css`(全体を置き換える)
- Create: `tests/styles.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: CSS変数`--bg --surface --text --muted --border --border-strong --primary --primary-soft --on-primary --success --success-soft --danger --danger-soft --radius --radius-sheet --tap-min --tap-primary --tabbar-h --selbar-h --content-max --gap`、共通のクラス`.card .message .hint .visually-hidden`、ボタンの種類`button.primary / .danger / .danger-fill / .block`。`--accent`は既存の規則のための別名(仕上げのTask 14で消す)。

- [ ] **Step 1: 失敗するテストを書く**

`tests/styles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import css from '../src/styles.css?raw';

/** :root などに書かれた「--名前: #rrggbb;」を集める。 */
function readTokens(): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of css.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1]!] = match[2]!;
  }
  return tokens;
}

/** WCAG 2.x の相対輝度。 */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

const tokens = readTokens();

// 通常の文字として使う組み合わせ(4.5:1以上)。
const TEXT_PAIRS: [string, string][] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'primary-soft'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['muted', 'primary-soft'],
  ['muted', 'success-soft'],
  ['on-primary', 'primary'],
  ['on-primary', 'success'],
  ['on-primary', 'danger'],
  ['primary', 'surface'],
  ['primary', 'bg'],
  ['primary', 'primary-soft'],
  ['success', 'success-soft'],
  ['success', 'surface'],
  ['danger', 'danger-soft'],
  ['danger', 'surface'],
];

// 文字ではない部品(入力欄の枠、チェックの枠など)として使う組み合わせ(3:1以上)。
const COMPONENT_PAIRS: [string, string][] = [
  ['border-strong', 'surface'],
  ['border-strong', 'bg'],
  ['primary', 'surface'],
];

describe('色の変数', () => {
  it('必要な色がすべて、6桁の16進数で定義されている', () => {
    const required = [
      'bg', 'surface', 'text', 'muted', 'border', 'border-strong',
      'primary', 'primary-soft', 'on-primary',
      'success', 'success-soft', 'danger', 'danger-soft',
    ];
    for (const name of required) {
      expect(tokens[name], `--${name}`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it.each(TEXT_PAIRS)('文字 --%s と背景 --%s のコントラスト比は4.5以上', (foreground, background) => {
    expect(contrast(tokens[foreground]!, tokens[background]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(COMPONENT_PAIRS)('部品の色 --%s と背景 --%s のコントラスト比は3以上', (foreground, background) => {
    expect(contrast(tokens[foreground]!, tokens[background]!)).toBeGreaterThanOrEqual(3);
  });
});

describe('フォーカス表示', () => {
  it(':focus-visible で目立つ枠を出す', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*3px solid/);
  });

  it('フォーカスの枠を消す指定がない', () => {
    expect(css).not.toMatch(/outline\s*:\s*(none|0)\b/);
  });
});

describe('大きさの変数', () => {
  it('タップ領域は44px以上(2.75rem)', () => {
    expect(css).toMatch(/--tap-min:\s*2\.75rem/);
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/styles.test.ts
```

期待: FAIL(`--surface`などが未定義、`:focus-visible`がない)。

- [ ] **Step 3: `vite.config.ts`で、テストから`styles.css`を読めるようにする**

Vitest は、標準では CSS ファイルを処理せず、`?raw`で読み込んでも空文字になる(そのままでは、上のテストが読むCSSが空になる)。`test`の設定に、`styles.css`だけを処理の対象にする指定を足す。

```ts
  test: {
    environment: 'jsdom',
    globals: true,
  },
```
↓
```ts
  test: {
    environment: 'jsdom',
    globals: true,
    // Vitest は標準では CSS を処理せず、?raw で読んでも空文字になる。
    // 色のコントラスト検査(tests/styles.test.ts)で styles.css を読めるようにする。
    css: { include: [/styles.css/] },
  },
```

- [ ] **Step 4: `src/styles.css`を、次の内容で置き換える**

```css
/* ===== 色・大きさの変数(色はここだけで決める) ===== */
:root {
  color-scheme: light;

  --bg: #f5f7fa;
  --surface: #ffffff;
  --text: #1f2328;
  --muted: #5f6368;
  --border: #d8dce1;
  --border-strong: #80868b;

  --primary: #0b57d0;
  --primary-soft: #e8f0fe;
  --on-primary: #ffffff;

  --success: #187a34;
  --success-soft: #e6f4ea;

  --danger: #c5221f;
  --danger-soft: #fce8e6;

  --radius: 0.625rem;
  --radius-sheet: 0.75rem;

  --tap-min: 2.75rem; /* 44px */
  --tap-primary: 3.25rem; /* 52px */
  --tabbar-h: 3.5rem;
  --selbar-h: 4rem;
  --content-max: 44rem;
  --gap: 1rem;

  /* 既存の画面用の規則が使っている別名。使われなくなったら消す。 */
  --accent: var(--primary);
}

/* ===== 全体 ===== */
* {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  font-family: system-ui, -apple-system, 'Hiragino Sans', 'Yu Gothic', sans-serif;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--text);
  background: var(--bg);
}

/* ダイアログを開いている間は、背後をスクロールさせない。 */
body.dialog-open {
  overflow: hidden;
}

h1,
h2 {
  line-height: 1.3;
}

/* ===== 共通の部品 ===== */
button,
input {
  font: inherit;
}

button {
  min-height: var(--tap-min);
  padding: 0 1rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

button:disabled {
  opacity: 0.45;
  cursor: default;
}

button.primary {
  min-height: var(--tap-primary);
  border-color: var(--primary);
  background: var(--primary);
  color: var(--on-primary);
  font-weight: 600;
}

button.danger {
  border-color: var(--danger);
  color: var(--danger);
}

button.danger-fill {
  min-height: var(--tap-primary);
  border-color: var(--danger);
  background: var(--danger);
  color: var(--on-primary);
  font-weight: 600;
}

button.block {
  width: 100%;
}

input[type='text'],
input[type='search'],
input[type='password'] {
  width: 100%;
  min-height: var(--tap-min);
  padding: 0 0.75rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--text);
  font-size: 1rem;
}

/* キーボードで操作する人のために、フォーカスの枠は必ず出す。 */
:focus-visible {
  outline: 3px solid var(--primary);
  outline-offset: 2px;
}

/* 画面には出さず、スクリーンリーダーとキーボードには残す。 */
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}

.message {
  margin: 0 0 var(--gap);
  padding: 0.75rem 1rem;
  border-radius: var(--radius);
  font-weight: 500;
}

.message.error {
  background: var(--danger-soft);
  color: var(--danger);
}

.message.info {
  background: var(--primary-soft);
  color: var(--primary);
}

.hint {
  margin: 0 0 var(--gap);
  color: var(--muted);
  font-size: 0.9375rem;
}

.card {
  margin-bottom: var(--gap);
  padding: var(--gap);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.card h2 {
  margin: 0 0 0.5rem;
  font-size: 1.125rem;
}

/* ===== 以下は、既存の画面用の規則。画面ごとの作り直しで、順に置き換えて消す ===== */
#app {
  max-width: 48rem;
  margin: 0 auto;
  padding: var(--gap);
}

input[type='checkbox'] {
  width: var(--tap-min);
  height: var(--tap-min);
}

.row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
}

.footer {
  position: sticky;
  bottom: 0;
  padding: var(--gap) 0;
  background: var(--bg);
  border-top: 1px solid var(--border);
}

.patient-list {
  list-style: none;
  margin: var(--gap) 0;
  padding: 0;
}

.patient-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}

.patient-body {
  flex: 1;
  min-width: 0;
}

.patient-name {
  font-weight: 600;
}

.patient-address {
  font-size: 0.875rem;
  color: #555;
  overflow-wrap: anywhere;
}

.field {
  display: block;
  margin-bottom: var(--gap);
  font-weight: 600;
}

.field input {
  display: block;
  margin-top: 0.25rem;
  font-weight: 400;
}

.actions {
  display: flex;
  gap: 0.75rem;
  margin-top: var(--gap);
}

a.disabled {
  color: #999;
  pointer-events: none;
  text-decoration: none;
}

.map-check {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap-min);
}

.stop-list {
  list-style: none;
  margin: var(--gap) 0;
  padding: 0;
}

.stop-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
}

.stop-role {
  flex: 0 0 4.5rem;
  font-size: 0.75rem;
  color: #555;
}

.route-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin-bottom: var(--gap);
}

.open-route {
  min-height: 3.5rem;
  text-align: left;
  padding: 0.5rem 1rem;
}

.modes {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.75rem 0;
}

.modes label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: var(--tap-min);
}
```

- [ ] **Step 5: すべて通す**

```bash
npm run test && npm run typecheck && npm run build
```

期待: すべてPASS(`tests/styles.test.ts`の新しいテストを含む)。ビルドが通る。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: デザインの基盤(色・大きさの変数と共通の見た目)を整える

背景は薄いグレー、メインは青、完了は緑、削除・警告は赤の変数を定義し、
ボタン・入力欄・メッセージ・フォーカス表示の共通の見た目を作り直す。
文字と背景の組み合わせは、テストでコントラスト比を計算して確かめる。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: 共通の見出し・下部のタブ・選択バー

3つのステップ画面が共有する部品を作る。ここでは部品とテストだけを作り、`main.ts`への組み込みは、Task 9〜11で画面と一緒に行う。

**Files:**
- Create: `src/views/common.ts`, `src/views/tabBar.ts`, `src/views/selectionBar.ts`
- Create: `tests/common.test.ts`, `tests/tabBar.test.ts`, `tests/selectionBar.test.ts`
- Modify: `src/styles.css`(末尾に追記)

**Interfaces:**
- Consumes: `Message`型(`src/types.ts`)
- Produces:
  - `renderScreenHeader(title: string, options?: { onBack?: () => void }): HTMLElement` — 戻るボタン(`data-testid="back-button"`)は`onBack`があるときだけ出る
  - `renderMessage(message: Message): HTMLElement` — `<p class="message error|info" role="status">`
  - `type Step = 'list' | 'order' | 'map'`、`type TabBarHandlers = { onSelect(step: Step): void }`
  - `renderTabBar(current: Step, hasSelection: boolean, handlers: TabBarHandlers): HTMLElement` — タブのボタンは`data-testid="tab-list" | "tab-order" | "tab-map"`
  - `type SelectionBarHandlers = { onNext(): void }`
  - `renderSelectionBar(count: number, handlers: SelectionBarHandlers): HTMLElement | null` — `count`が0なら`null`。ボタンは`data-testid="next-button"`、件数は`data-testid="selection-count"`

- [ ] **Step 1: 失敗するテストを書く**

`tests/common.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { renderMessage, renderScreenHeader } from '../src/views/common';

describe('renderScreenHeader', () => {
  it('見出しを h1 で表示する', () => {
    const header = renderScreenHeader('訪問順を決める');
    expect(header.querySelector('h1')?.textContent).toBe('訪問順を決める');
  });

  it('onBack を渡さなければ、戻るボタンは出ない', () => {
    const header = renderScreenHeader('訪問順を決める');
    expect(header.querySelector('[data-testid="back-button"]')).toBeNull();
  });

  it('onBack を渡すと戻るボタンが出て、押すと呼ばれる', () => {
    const onBack = vi.fn();
    const header = renderScreenHeader('訪問順を決める', { onBack });
    header.querySelector<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('戻るボタンには、目的が分かる名前(aria-label)を付ける', () => {
    const header = renderScreenHeader('訪問順を決める', { onBack: vi.fn() });
    expect(header.querySelector('[data-testid="back-button"]')?.getAttribute('aria-label')).toBe('戻る');
  });
});

describe('renderMessage', () => {
  it('種類のクラスと本文を持つ', () => {
    const message = renderMessage({ kind: 'error', text: '保存できませんでした。' });
    expect(message.classList.contains('message')).toBe(true);
    expect(message.classList.contains('error')).toBe(true);
    expect(message.textContent).toBe('保存できませんでした。');
  });

  it('お知らせは info のクラスを持つ', () => {
    const message = renderMessage({ kind: 'info', text: '保存しました。' });
    expect(message.classList.contains('info')).toBe(true);
  });

  it('VoiceOverに読み上げられるよう role=status を持つ', () => {
    expect(renderMessage({ kind: 'info', text: 'a' }).getAttribute('role')).toBe('status');
  });
});
```

`tests/tabBar.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { renderTabBar, type TabBarHandlers } from '../src/views/tabBar';

const handlers = (): TabBarHandlers => ({ onSelect: vi.fn() });
const tab = (element: HTMLElement, step: string) =>
  element.querySelector<HTMLButtonElement>(`[data-testid="tab-${step}"]`)!;

describe('renderTabBar', () => {
  it('3つのステップを、番号つきで順番に表示する', () => {
    const element = renderTabBar('list', true, handlers());
    const labels = [...element.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).toEqual(['①訪問先を選ぶ', '②訪問順', '③地図を開く']);
  });

  it('ナビゲーションには、ステップだと分かる名前が付く', () => {
    const element = renderTabBar('list', true, handlers());
    expect(element.tagName).toBe('NAV');
    expect(element.getAttribute('aria-label')).toBe('ステップ');
  });

  it('今のステップだけに aria-current=step と current のクラスが付く', () => {
    const element = renderTabBar('order', true, handlers());
    expect(tab(element, 'order').getAttribute('aria-current')).toBe('step');
    expect(tab(element, 'order').classList.contains('current')).toBe(true);
    for (const other of ['list', 'map']) {
      expect(tab(element, other).hasAttribute('aria-current')).toBe(false);
      expect(tab(element, other).classList.contains('current')).toBe(false);
    }
  });

  it('訪問先を1件も選んでいないあいだは、訪問順と地図のタブを押せない', () => {
    const element = renderTabBar('list', false, handlers());
    expect(tab(element, 'list').disabled).toBe(false);
    expect(tab(element, 'order').disabled).toBe(true);
    expect(tab(element, 'map').disabled).toBe(true);
  });

  it('1件以上選んでいれば、すべてのタブを押せる', () => {
    const element = renderTabBar('list', true, handlers());
    for (const step of ['list', 'order', 'map']) {
      expect(tab(element, step).disabled).toBe(false);
    }
  });

  it('タブを押すと、そのステップで onSelect が呼ばれる', () => {
    const spies = handlers();
    const element = renderTabBar('list', true, spies);
    tab(element, 'map').click();
    expect(spies.onSelect).toHaveBeenCalledWith('map');
  });

  it('押せないタブを押しても、onSelect は呼ばれない', () => {
    const spies = handlers();
    const element = renderTabBar('list', false, spies);
    tab(element, 'order').click();
    expect(spies.onSelect).not.toHaveBeenCalled();
  });
});
```

`tests/selectionBar.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { renderSelectionBar, type SelectionBarHandlers } from '../src/views/selectionBar';

const handlers = (): SelectionBarHandlers => ({ onNext: vi.fn() });

describe('renderSelectionBar', () => {
  it('1件も選んでいなければ、何も出さない(null)', () => {
    expect(renderSelectionBar(0, handlers())).toBeNull();
  });

  it('選択件数を「3件選択中」の形で表示する', () => {
    const element = renderSelectionBar(3, handlers())!;
    expect(element.querySelector('[data-testid="selection-count"]')?.textContent).toBe('3件選択中');
  });

  it('「訪問順を決める →」のボタンを出し、押すと onNext が呼ばれる', () => {
    const spies = handlers();
    const element = renderSelectionBar(1, spies)!;
    const button = element.querySelector<HTMLButtonElement>('[data-testid="next-button"]')!;
    expect(button.textContent).toBe('訪問順を決める →');
    button.click();
    expect(spies.onNext).toHaveBeenCalledTimes(1);
  });

  it('スクリーンリーダーに、選択中の内容であることが伝わる名前を付ける', () => {
    const element = renderSelectionBar(2, handlers())!;
    expect(element.getAttribute('role')).toBe('region');
    expect(element.getAttribute('aria-label')).toBe('選択中の訪問先');
  });

  it('件数が変わっても、その件数を表示する', () => {
    const element = renderSelectionBar(10, handlers())!;
    expect(element.textContent).toContain('10件選択中');
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/common.test.ts tests/tabBar.test.ts tests/selectionBar.test.ts
```

期待: FAIL(各モジュールが解決できない)。

- [ ] **Step 3: `src/views/common.ts`を作る**

```ts
import type { Message } from '../types';

export type HeaderOptions = {
  /** 渡したときだけ、左に「‹ 戻る」ボタンを出す。 */
  onBack?: () => void;
};

/**
 * 訪問順・地図・設定の画面が共有する見出し。左に戻るボタン、中央に見出し。
 * 3列にして、見出しが常に中央に来るようにする(戻るボタンの有無で位置が変わらない)。
 */
export function renderScreenHeader(title: string, options: HeaderOptions = {}): HTMLElement {
  const header = document.createElement('header');
  header.className = 'screen-header';

  if (options.onBack) {
    const onBack = options.onBack;
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'header-back';
    back.textContent = '‹ 戻る';
    back.dataset.testid = 'back-button';
    back.setAttribute('aria-label', '戻る');
    back.addEventListener('click', () => onBack());
    header.append(back);
  } else {
    header.append(document.createElement('span'));
  }

  const heading = document.createElement('h1');
  heading.className = 'screen-title';
  heading.textContent = title;
  header.append(heading, document.createElement('span'));
  return header;
}

/** 操作の結果(エラー・お知らせ)を表示する。VoiceOverに読み上げられるよう role=status を付ける。 */
export function renderMessage(message: Message): HTMLElement {
  const element = document.createElement('p');
  element.className = `message ${message.kind}`;
  element.setAttribute('role', 'status');
  element.textContent = message.text;
  return element;
}
```

- [ ] **Step 4: `src/views/tabBar.ts`を作る**

```ts
export type Step = 'list' | 'order' | 'map';

export type TabBarHandlers = {
  onSelect(step: Step): void;
};

const STEPS: { step: Step; number: string; label: string }[] = [
  { step: 'list', number: '①', label: '訪問先を選ぶ' },
  { step: 'order', number: '②', label: '訪問順' },
  { step: 'map', number: '③', label: '地図を開く' },
];

/**
 * 下部のタブ。3つのステップを番号つきで並べ、今のステップを強調する。
 * 移動のためのタブであり、「今どのステップか」を示すステップ表示を兼ねる。
 * 訪問先を1件も選んでいないあいだは、訪問順と地図のタブを押せなくする。
 */
export function renderTabBar(
  current: Step,
  hasSelection: boolean,
  handlers: TabBarHandlers,
): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'tabbar';
  nav.setAttribute('aria-label', 'ステップ');
  nav.dataset.testid = 'tabbar';

  const list = document.createElement('ul');
  for (const { step, number, label } of STEPS) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = step === current ? 'tab current' : 'tab';
    button.dataset.testid = `tab-${step}`;
    button.disabled = step !== 'list' && !hasSelection;
    if (step === current) {
      button.setAttribute('aria-current', 'step');
    }

    const numberElement = document.createElement('span');
    numberElement.className = 'tab-number';
    numberElement.setAttribute('aria-hidden', 'true');
    numberElement.textContent = number;
    const labelElement = document.createElement('span');
    labelElement.textContent = label;
    button.append(numberElement, labelElement);

    button.addEventListener('click', () => handlers.onSelect(step));
    item.append(button);
    list.append(item);
  }
  nav.append(list);
  return nav;
}
```

- [ ] **Step 5: `src/views/selectionBar.ts`を作る**

```ts
export type SelectionBarHandlers = {
  onNext(): void;
};

/**
 * 訪問先を1件以上選んでいるときに、下部に固定して出す選択バー。
 * 件数と「訪問順を決める →」。1件も選んでいなければ null(何も出さない)。
 */
export function renderSelectionBar(
  count: number,
  handlers: SelectionBarHandlers,
): HTMLElement | null {
  if (count === 0) {
    return null;
  }

  const bar = document.createElement('div');
  bar.className = 'selection-bar';
  bar.dataset.testid = 'selection-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', '選択中の訪問先');

  const label = document.createElement('span');
  label.className = 'selection-count';
  label.dataset.testid = 'selection-count';
  label.textContent = `${count}件選択中`;

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'primary';
  next.dataset.testid = 'next-button';
  next.textContent = '訪問順を決める →';
  next.addEventListener('click', () => handlers.onNext());

  bar.append(label, next);
  return bar;
}
```

- [ ] **Step 6: `src/styles.css`の末尾に追記する**

```css

/* ===== 画面の骨組み・共通の見出し・下部のタブと選択バー ===== */
.app-shell {
  max-width: var(--content-max);
  margin: 0 auto;
  padding: var(--gap) calc(var(--gap) + env(safe-area-inset-right)) var(--gap)
    calc(var(--gap) + env(safe-area-inset-left));
}

/* 下部に固定するバーに、一覧の最後が隠れないよう、バーの高さぶんの余白を取る。 */
.app-shell.with-tabbar {
  padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom) + var(--gap));
}

.app-shell.with-selection {
  padding-bottom: calc(var(--tabbar-h) + var(--selbar-h) + env(safe-area-inset-bottom) + var(--gap));
}

.screen-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.5rem;
  min-height: 3.5rem;
  margin-bottom: 0.5rem;
}

.screen-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 700;
  text-align: center;
}

.header-back {
  justify-self: start;
  padding: 0 0.5rem;
  border: none;
  background: transparent;
  color: var(--primary);
  font-weight: 600;
}

.bottom-stack {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
  padding-bottom: env(safe-area-inset-bottom);
  border-top: 1px solid var(--border);
  background: var(--surface);
}

.bottom-stack > * {
  max-width: var(--content-max);
  margin: 0 auto;
}

.selection-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
  min-height: var(--selbar-h);
  padding: 0.5rem calc(var(--gap) + env(safe-area-inset-right)) 0.5rem
    calc(var(--gap) + env(safe-area-inset-left));
  border-bottom: 1px solid var(--border);
}

.selection-count {
  font-weight: 600;
}

.tabbar ul {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin: 0;
  padding: 0;
  list-style: none;
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.125rem;
  width: 100%;
  min-height: var(--tabbar-h);
  padding: 0.25rem;
  border: none;
  border-top: 3px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 0.875rem;
}

.tab-number {
  font-size: 1.125rem;
  font-weight: 700;
}

.tab.current {
  border-top-color: var(--primary);
  color: var(--primary);
  font-weight: 700;
}
```

- [ ] **Step 7: すべて通す**

```bash
npm run test && npm run typecheck && npm run build
```

期待: すべてPASS。

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: 共通の見出し・下部のタブ・選択バーを追加する

3つのステップ画面が共有する部品。タブは番号つきでステップ表示を兼ね、
訪問先を選ぶまでは訪問順と地図を押せない。選択バーは1件以上で件数を出す。
画面への組み込みは、各画面の作り直しと一緒に行う。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: ダイアログ(「⋯」メニューと削除の確認)

**Files:**
- Create: `src/views/dialogs.ts`, `tests/dialogs.test.ts`
- Modify: `src/styles.css`(末尾に追記)

**Interfaces:**
- Consumes: `AppState`(`dialog`、`patients`)、`Patient`
- Produces:
  - `type DialogHandlers = { onEdit(id): void; onDuplicate(id): void; onRequestDelete(id): void; onConfirmDelete(id): void; onClose(): void }`
  - `renderDialog(state: AppState, handlers: DialogHandlers): HTMLElement | null` — `state.dialog`が`null`、または対象の訪問先がなければ`null`
  - ボタンの`data-testid`: `dialog-edit` / `dialog-duplicate` / `dialog-delete` / `dialog-cancel` / `dialog-confirm-delete`。ダイアログ本体は`data-testid="dialog"`、背景は`data-testid="dialog-overlay"`

- [ ] **Step 1: 失敗するテストを書く**

`tests/dialogs.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import { closeDialog, createInitialState, openDeleteConfirm, openRowMenu } from '../src/state';
import { renderDialog, type DialogHandlers } from '../src/views/dialogs';

const handlers = (): DialogHandlers => ({
  onEdit: vi.fn(),
  onDuplicate: vi.fn(),
  onRequestDelete: vi.fn(),
  onConfirmDelete: vi.fn(),
  onClose: vi.fn(),
});

const patient = createPatient('山田 太郎', '東京都千代田区1-1');
const base = () => createInitialState([patient]);

const button = (element: HTMLElement, testid: string) =>
  element.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!;

describe('renderDialog: 出さない場合', () => {
  it('ダイアログが開いていなければ null', () => {
    expect(renderDialog(base(), handlers())).toBeNull();
  });

  it('閉じた後は null', () => {
    expect(renderDialog(closeDialog(openRowMenu(base(), patient.id)), handlers())).toBeNull();
  });

  it('対象の訪問先が見つからなければ null', () => {
    expect(renderDialog(openRowMenu(base(), 'unknown-id'), handlers())).toBeNull();
  });
});

describe('renderDialog: 「⋯」メニュー', () => {
  const open = (spies = handlers()) => renderDialog(openRowMenu(base(), patient.id), spies)!;

  it('見出しに訪問先の名前を出す', () => {
    expect(open().querySelector('#dialog-title')?.textContent).toBe('山田 太郎');
  });

  it('編集・複製して登録・削除・キャンセルの4つのボタンを、この順に出す', () => {
    const element = open();
    const labels = ['dialog-edit', 'dialog-duplicate', 'dialog-delete', 'dialog-cancel'].map(
      (testid) => button(element, testid).textContent,
    );
    expect(labels).toEqual(['編集', '複製して登録', '削除', 'キャンセル']);
    expect([...element.querySelectorAll('button')]).toHaveLength(4);
  });

  it('削除ボタンは赤(danger)で表示する', () => {
    expect(button(open(), 'dialog-delete').classList.contains('danger')).toBe(true);
  });

  it('編集を押すと、訪問先のidつきで onEdit が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-edit').click();
    expect(spies.onEdit).toHaveBeenCalledWith(patient.id);
  });

  it('複製して登録を押すと、訪問先のidつきで onDuplicate が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-duplicate').click();
    expect(spies.onDuplicate).toHaveBeenCalledWith(patient.id);
  });

  it('削除を押すと、この時点では削除せず、確認へ進むための onRequestDelete が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-delete').click();
    expect(spies.onRequestDelete).toHaveBeenCalledWith(patient.id);
    expect(spies.onConfirmDelete).not.toHaveBeenCalled();
  });

  it('キャンセルを押すと onClose が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-cancel').click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('renderDialog: 削除の確認', () => {
  const open = (spies = handlers()) => renderDialog(openDeleteConfirm(base(), patient.id), spies)!;

  it('「この訪問先を削除しますか?」と、対象の名前を出す', () => {
    const element = open();
    expect(element.querySelector('#dialog-title')?.textContent).toBe('この訪問先を削除しますか?');
    expect(element.querySelector('[data-testid="dialog-target"]')?.textContent).toBe('山田 太郎');
  });

  it('キャンセルと削除の2つだけを出す', () => {
    const element = open();
    expect(button(element, 'dialog-cancel').textContent).toBe('キャンセル');
    expect(button(element, 'dialog-confirm-delete').textContent).toBe('削除');
    expect([...element.querySelectorAll('button')]).toHaveLength(2);
  });

  it('削除ボタンは赤(danger-fill)で表示する', () => {
    expect(button(open(), 'dialog-confirm-delete').classList.contains('danger-fill')).toBe(true);
  });

  it('削除を押すと、訪問先のidつきで onConfirmDelete が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-confirm-delete').click();
    expect(spies.onConfirmDelete).toHaveBeenCalledWith(patient.id);
  });

  it('キャンセルを押すと、削除せずに onClose が呼ばれる', () => {
    const spies = handlers();
    button(open(spies), 'dialog-cancel').click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
    expect(spies.onConfirmDelete).not.toHaveBeenCalled();
  });
});

describe('renderDialog: アクセシビリティ', () => {
  it('role=dialog、aria-modal=true で、見出しが名前になる', () => {
    const element = renderDialog(openRowMenu(base(), patient.id), handlers())!;
    const dialog = element.querySelector('[data-testid="dialog"]')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const labelledBy = dialog.getAttribute('aria-labelledby')!;
    expect(element.querySelector(`#${labelledBy}`)?.textContent).toBe('山田 太郎');
  });

  it('Tabキーでフォーカスがダイアログの外へ出ない(最後の次は最初へ)', () => {
    const element = renderDialog(openRowMenu(base(), patient.id), handlers())!;
    document.body.append(element);
    try {
      const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')];
      const last = buttons[buttons.length - 1]!;
      last.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      last.dispatchEvent(event);
      expect(document.activeElement).toBe(buttons[0]);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      element.remove();
    }
  });

  it('Shift+Tabで、最初の前は最後へ戻る', () => {
    const element = renderDialog(openRowMenu(base(), patient.id), handlers())!;
    document.body.append(element);
    try {
      const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')];
      const first = buttons[0]!;
      first.focus();
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      first.dispatchEvent(event);
      expect(document.activeElement).toBe(buttons[buttons.length - 1]);
      expect(event.defaultPrevented).toBe(true);
    } finally {
      element.remove();
    }
  });

  it('途中のボタンでのTabキーは、そのまま(ブラウザの動作に任せる)', () => {
    const element = renderDialog(openRowMenu(base(), patient.id), handlers())!;
    document.body.append(element);
    try {
      const buttons = [...element.querySelectorAll<HTMLButtonElement>('button')];
      buttons[1]!.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      buttons[1]!.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    } finally {
      element.remove();
    }
  });
});

describe('renderDialog: 背景', () => {
  it('ダイアログの外側(背景)を押すと onClose が呼ばれる', () => {
    const spies = handlers();
    const element = renderDialog(openRowMenu(base(), patient.id), spies)!;
    element.click();
    expect(spies.onClose).toHaveBeenCalledTimes(1);
  });

  it('ダイアログの内側を押しても、閉じない', () => {
    const spies = handlers();
    const element = renderDialog(openRowMenu(base(), patient.id), spies)!;
    element.querySelector<HTMLElement>('#dialog-title')!.click();
    element.querySelector<HTMLElement>('[data-testid="dialog"]')!.click();
    expect(spies.onClose).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/dialogs.test.ts
```

期待: FAIL(`../src/views/dialogs`が解決できない)。

- [ ] **Step 3: `src/views/dialogs.ts`を作る**

```ts
import type { AppState, Patient } from '../types';

export type DialogHandlers = {
  onEdit(id: string): void;
  onDuplicate(id: string): void;
  /** 「削除」を押した。まだ削除しない(確認のダイアログへ進む)。 */
  onRequestDelete(id: string): void;
  /** 確認のダイアログで「削除」を押した。ここで初めて削除を実行する。 */
  onConfirmDelete(id: string): void;
  onClose(): void;
};

/**
 * 開いているダイアログを描画する。なければ(または対象の訪問先が見つからなければ)null。
 *
 * - 「⋯」メニュー: 編集 / 複製して登録 / 削除(赤) / キャンセル
 * - 削除の確認: 「この訪問先を削除しますか?」 [キャンセル] [削除(赤)]
 *
 * フォーカスの移動(開いたら最初のボタン、閉じたら「⋯」へ戻す)と、Escキーで閉じる処理は、
 * 画面全体を描き直す main.ts の側で行う。ここではTabキーの巡回だけを面倒みる。
 */
export function renderDialog(state: AppState, handlers: DialogHandlers): HTMLElement | null {
  const dialog = state.dialog;
  if (dialog === null) {
    return null;
  }
  const patient = state.patients.find((item) => item.id === dialog.id);
  if (patient === undefined) {
    return null;
  }

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.dataset.testid = 'dialog-overlay';
  // 背景(ダイアログの外側)を押したら閉じる。内側の押下では閉じない。
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      handlers.onClose();
    }
  });

  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.dataset.testid = 'dialog';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'dialog-title');
  sheet.addEventListener('keydown', trapFocus);

  if (dialog.kind === 'rowMenu') {
    sheet.append(...renderMenu(patient, handlers));
  } else {
    sheet.append(...renderConfirmDelete(patient, handlers));
  }

  overlay.append(sheet);
  return overlay;
}

function renderMenu(patient: Patient, handlers: DialogHandlers): HTMLElement[] {
  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = patient.name;

  const list = document.createElement('ul');
  list.className = 'sheet-actions';
  const actions: { testid: string; label: string; className?: string; onClick: () => void }[] = [
    { testid: 'dialog-edit', label: '編集', onClick: () => handlers.onEdit(patient.id) },
    { testid: 'dialog-duplicate', label: '複製して登録', onClick: () => handlers.onDuplicate(patient.id) },
    {
      testid: 'dialog-delete',
      label: '削除',
      className: 'danger',
      onClick: () => handlers.onRequestDelete(patient.id),
    },
    { testid: 'dialog-cancel', label: 'キャンセル', onClick: () => handlers.onClose() },
  ];
  for (const action of actions) {
    const item = document.createElement('li');
    item.append(actionButton(action.label, action.testid, action.onClick, action.className));
    list.append(item);
  }
  return [title, list];
}

function renderConfirmDelete(patient: Patient, handlers: DialogHandlers): HTMLElement[] {
  const title = document.createElement('h2');
  title.id = 'dialog-title';
  title.className = 'sheet-title';
  title.textContent = 'この訪問先を削除しますか?';

  const target = document.createElement('p');
  target.className = 'sheet-text';
  target.dataset.testid = 'dialog-target';
  target.textContent = patient.name;

  const buttons = document.createElement('div');
  buttons.className = 'sheet-buttons';
  buttons.append(
    actionButton('キャンセル', 'dialog-cancel', () => handlers.onClose()),
    actionButton('削除', 'dialog-confirm-delete', () => handlers.onConfirmDelete(patient.id), 'danger-fill'),
  );
  return [title, target, buttons];
}

function actionButton(
  label: string,
  testid: string,
  onClick: () => void,
  className?: string,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.testid = testid;
  if (className) {
    button.className = className;
  }
  button.addEventListener('click', onClick);
  return button;
}

/** Tabキーでフォーカスがダイアログの外へ出ないよう、最後の次は最初へ、最初の前は最後へ回す。 */
function trapFocus(event: KeyboardEvent): void {
  if (event.key !== 'Tab') {
    return;
  }
  const sheet = event.currentTarget as HTMLElement;
  const buttons = [...sheet.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (first === undefined || last === undefined) {
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
```

- [ ] **Step 4: `src/styles.css`の末尾に追記する**

```css

/* ===== ダイアログ(「⋯」メニュー・削除の確認) ===== */
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 0 var(--gap) calc(var(--gap) + env(safe-area-inset-bottom));
  background: rgba(0, 0, 0, 0.4);
}

.sheet {
  width: 100%;
  max-width: 28rem;
  padding: var(--gap);
  border-radius: var(--radius-sheet);
  background: var(--surface);
}

@media (min-width: 48rem) {
  .overlay {
    align-items: center;
  }
}

.sheet-title {
  margin: 0 0 0.75rem;
  font-size: 1.125rem;
  text-align: center;
  overflow-wrap: anywhere;
}

.sheet-text {
  margin: 0 0 var(--gap);
  color: var(--muted);
  text-align: center;
  overflow-wrap: anywhere;
}

.sheet-actions {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sheet-actions button {
  width: 100%;
  min-height: var(--tap-primary);
}

.sheet-buttons {
  display: flex;
  gap: 0.75rem;
}

.sheet-buttons button {
  flex: 1;
  min-height: var(--tap-primary);
}
```

- [ ] **Step 5: すべて通す**

```bash
npm run test && npm run typecheck && npm run build
```

期待: すべてPASS。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: 「⋯」メニューと削除の確認のダイアログを追加する

メニューは編集・複製して登録・削除(赤)・キャンセル。削除は必ず確認の
ダイアログを通す。role=dialog・Tabキーの巡回・背景を押して閉じる動作を持つ。
画面への組み込みは、訪問先を選ぶ画面の作り直しと一緒に行う。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---
### Task 9: 地図を開く画面(ルートのカード)

ルートを開く操作を、訪問順の画面から、新しい「地図を開く」画面へ移す。この画面は、ルートをカードで表示し、「次に開くルート」を最も目立たせる。この時点では、訪問順の画面はまだ作り直さない(古い画面のまま動く)ので、この画面へ入る操作は、Googleマップから戻ったあとの復元(開いたルートが記録されているとき)だけ。訪問順の画面からの入口は、Task 10で作る。

**Files:**
- Create: `src/format.ts`, `tests/format.test.ts`, `src/views/routeMapView.ts`, `tests/routeMapView.test.ts`
- Modify: `src/types.ts`, `src/main.ts`, `tests/main.test.ts`, `src/styles.css`

**Interfaces:**
- Consumes: `MapProvider`(Task 3)、`renderScreenHeader`・`renderMessage`(Task 7)、`splitIntoRoutes`、`selectedPatients`、`MAX_STOPS_PER_ROUTE`
- Produces:
  - `formatDateTime(iso: string): string` — `'9/21 14:32'`の形(端末のローカル時刻)。空文字や読めない日時は`''`
  - `Screen`に`{ name: 'map' }`
  - `type RouteMapHandlers = { onOpenRoute(routeIndex: number): void; onBack(): void; onChooseStops(): void }`
  - `renderRouteMap(state: AppState, opened: ReadonlyMap<number, string>, provider: MapProvider, handlers: RouteMapHandlers): HTMLElement`
  - 画面の`data-testid`: `map-summary`、`route-card`(`data-id`はルート番号、`data-state`は`done | next | later`)、`route-status`、`open-route`(`data-id`はルート番号)、`choose-stops-button`

- [ ] **Step 1: 失敗するテストを書く**

`tests/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../src/format';

// 端末のタイムゾーンに左右されないよう、ローカル時刻の成分から日時を作る。
const local = (month: number, day: number, hour: number, minute: number): string =>
  new Date(2026, month - 1, day, hour, minute).toISOString();

describe('formatDateTime', () => {
  it('月/日 時:分の形にする', () => {
    expect(formatDateTime(local(9, 21, 14, 32))).toBe('9/21 14:32');
  });

  it('分は2桁にそろえ、月・日・時は0を付けない', () => {
    expect(formatDateTime(local(1, 5, 9, 5))).toBe('1/5 9:05');
  });

  it('空文字なら空文字を返す', () => {
    expect(formatDateTime('')).toBe('');
  });

  it('読めない日時なら空文字を返し、例外を投げない', () => {
    expect(formatDateTime('いつか')).toBe('');
  });
});
```

`tests/routeMapView.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { MAX_STOPS_PER_ROUTE } from '../src/config';
import { googleMapsProvider, type MapProvider } from '../src/mapProviders';
import { createPatient } from '../src/patient';
import { splitIntoRoutes } from '../src/routeSplitter';
import { createInitialState } from '../src/state';
import type { AppState, Patient } from '../src/types';
import { renderRouteMap, type RouteMapHandlers } from '../src/views/routeMapView';

const handlers = (): RouteMapHandlers => ({
  onOpenRoute: vi.fn(),
  onBack: vi.fn(),
  onChooseStops: vi.fn(),
});

function makeStops(count: number): Patient[] {
  return Array.from({ length: count }, (_, i) => createPatient(`場所${i + 1}`, `東京都${i + 1}-1`));
}

/**
 * ルート分割の挙動を見るテスト用に、選択件数の上限(MAX_SELECTION)にかかわらず
 * 好きな件数を選択済みにした状態を、直接組み立てる。
 */
function stateWithSelection(count: number): AppState {
  const patients = makeStops(count);
  return { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
}

const render = (
  state: AppState,
  opened: ReadonlyMap<number, string> = new Map(),
  spies: RouteMapHandlers = handlers(),
  provider: MapProvider = googleMapsProvider,
) => renderRouteMap(state, opened, provider, spies);

const cards = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('[data-testid="route-card"]')];
const openButtons = (element: HTMLElement) =>
  element.querySelectorAll<HTMLButtonElement>('[data-testid="open-route"]');

// 上限の2倍なら、必ず2本以上に分かれる。
const SPLIT_COUNT = MAX_STOPS_PER_ROUTE * 2;
const routeCountFor = (count: number) => splitIntoRoutes(makeStops(count), MAX_STOPS_PER_ROUTE).length;

const OPENED_AT = new Date(2026, 8, 21, 14, 32).toISOString();

describe('renderRouteMap: 全体', () => {
  it('見出しは「地図を開く」', () => {
    expect(render(stateWithSelection(2)).querySelector('h1')?.textContent).toBe('地図を開く');
  });

  it('戻るボタンで onBack が呼ばれる', () => {
    const spies = handlers();
    render(stateWithSelection(2), new Map(), spies)
      .querySelector<HTMLButtonElement>('[data-testid="back-button"]')!
      .click();
    expect(spies.onBack).toHaveBeenCalledTimes(1);
  });

  it('メッセージ領域は VoiceOver に読み上げられるよう role=status を持つ', () => {
    const state = { ...stateWithSelection(2), message: { kind: 'error' as const, text: 'エラー' } };
    expect(render(state).querySelector('.message')?.getAttribute('role')).toBe('status');
  });

  it('選択件数を「N件の訪問先が選択されています。」で出す', () => {
    const element = render(stateWithSelection(3));
    expect(element.querySelector('[data-testid="map-summary"]')?.textContent).toContain(
      '3件の訪問先が選択されています。',
    );
  });
});

describe('renderRouteMap: ルートの分割', () => {
  it('上限ちょうどなら、カードは1枚で、分割の説明は出ない', () => {
    const element = render(stateWithSelection(MAX_STOPS_PER_ROUTE));
    expect(cards(element)).toHaveLength(1);
    expect(element.textContent).not.toContain('に分割します');
  });

  it('上限を超えると、ルートの本数ぶんのカードが並び、分割の説明に本数と上限が入る', () => {
    const expectedCount = routeCountFor(SPLIT_COUNT);
    expect(expectedCount).toBeGreaterThan(1);
    const element = render(stateWithSelection(SPLIT_COUNT));
    expect(cards(element)).toHaveLength(expectedCount);
    const summary = element.querySelector('[data-testid="map-summary"]')?.textContent ?? '';
    expect(summary).toContain(`${expectedCount}つのルートに分割します。`);
    expect(summary).toContain(`1つのルートは最大${MAX_STOPS_PER_ROUTE}地点までです。`);
    expect(summary).toContain('上から順に開いてください。');
  });

  it('カードに、ルート番号・地点数・名前の並びを出す', () => {
    const stops = makeStops(SPLIT_COUNT);
    const state = { ...createInitialState(stops), selectedIds: stops.map((p) => p.id) };
    const routes = splitIntoRoutes(stops, MAX_STOPS_PER_ROUTE);
    const element = render(state);
    routes.forEach((route, index) => {
      const card = cards(element)[index]!;
      expect(card.querySelector('.route-title')?.textContent).toBe(`ルート${index + 1}`);
      expect(card.querySelector('.route-count')?.textContent).toBe(`${route.length}地点`);
      expect(card.querySelector('.route-names')?.textContent).toBe(
        route.map((patient) => patient.name).join(' → '),
      );
    });
  });

  it('境目の訪問先は、前後どちらのルートにも含まれる', () => {
    const stops = makeStops(MAX_STOPS_PER_ROUTE + 1);
    const state = { ...createInitialState(stops), selectedIds: stops.map((p) => p.id) };
    const routes = splitIntoRoutes(stops, MAX_STOPS_PER_ROUTE);
    expect(routes).toHaveLength(2);
    const element = render(state);
    const boundary = routes[0]![routes[0]!.length - 1]!.name;
    expect(cards(element)[0]!.textContent).toContain(boundary);
    expect(cards(element)[1]!.textContent).toContain(boundary);
  });
});

describe('renderRouteMap: 開いたルートの状態', () => {
  it('何も開いていなければ、最初のルートが「次に開く」で、残りは後回しの表示', () => {
    const element = render(stateWithSelection(SPLIT_COUNT));
    const states = cards(element).map((card) => card.dataset.state);
    expect(states[0]).toBe('next');
    for (const state of states.slice(1)) {
      expect(state).toBe('later');
    }
  });

  it('「次に開く」のカードだけに、そのラベルが付く', () => {
    const element = render(stateWithSelection(SPLIT_COUNT));
    const labelled = cards(element).filter((card) => card.querySelector('.route-next-label') !== null);
    expect(labelled).toHaveLength(1);
    expect(labelled[0]).toBe(cards(element)[0]);
    expect(labelled[0]!.querySelector('.route-next-label')?.textContent).toBe('次に開く');
  });

  it('開いたルートは、「✓ Googleマップで開きました」と開いた日時を表示する', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, OPENED_AT]]));
    const card = cards(element)[0]!;
    expect(card.dataset.state).toBe('done');
    const status = card.querySelector('[data-testid="route-status"]')?.textContent ?? '';
    expect(status).toContain('✓ Googleマップで開きました');
    expect(status).toContain('9/21 14:32');
  });

  it('開いたルートのボタンは「もう一度開く」', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, OPENED_AT]]));
    expect(openButtons(element)[0]?.textContent).toBe('もう一度開く');
  });

  it('最初のルートを開いたら、2番目が「次に開く」になる', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, OPENED_AT]]));
    const states = cards(element).map((card) => card.dataset.state);
    expect(states[0]).toBe('done');
    expect(states[1]).toBe('next');
  });

  it('すべて開いたら、「次に開く」は無く、すべて「開きました」になる', () => {
    const count = routeCountFor(SPLIT_COUNT);
    const opened = new Map(Array.from({ length: count }, (_, i) => [i, OPENED_AT] as const));
    const element = render(stateWithSelection(SPLIT_COUNT), opened);
    expect(cards(element).every((card) => card.dataset.state === 'done')).toBe(true);
    expect(element.querySelector('.route-next-label')).toBeNull();
  });

  it('日時が空(古い記録)なら、開いたことは出すが日時は出さない', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, '']]));
    const card = cards(element)[0]!;
    expect(card.dataset.state).toBe('done');
    expect(card.querySelector('[data-testid="route-status"]')?.textContent).toContain('開きました');
    expect(card.querySelector('.route-time')).toBeNull();
  });

  it('途中のルートだけ開いていても、最初の未開封が「次に開く」', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[1, OPENED_AT]]));
    const states = cards(element).map((card) => card.dataset.state);
    expect(states[0]).toBe('next');
    expect(states[1]).toBe('done');
  });
});

describe('renderRouteMap: ボタン', () => {
  it('ボタンを押すと、ルート番号つきで onOpenRoute が呼ばれる', () => {
    const spies = handlers();
    const element = render(stateWithSelection(SPLIT_COUNT), new Map(), spies);
    openButtons(element)[1]?.click();
    expect(spies.onOpenRoute).toHaveBeenCalledWith(1);
  });

  it('ボタンはルート番号を data-id に持つ(フォーカス復元用)', () => {
    const element = render(stateWithSelection(SPLIT_COUNT));
    openButtons(element).forEach((button, index) => {
      expect(button.dataset.id).toBe(String(index));
    });
  });

  it('ボタンの文言は、地図サービスの名前から作る', () => {
    const provider: MapProvider = { ...googleMapsProvider, label: 'テスト地図' };
    const element = render(stateWithSelection(2), new Map(), handlers(), provider);
    expect(openButtons(element)[0]?.textContent).toBe('テスト地図で開く');
  });

  it('ボタンには、どのルートを開くのかが分かる名前(aria-label)を付ける', () => {
    const element = render(stateWithSelection(SPLIT_COUNT), new Map([[0, OPENED_AT]]));
    expect(openButtons(element)[0]?.getAttribute('aria-label')).toBe('ルート1をもう一度開く');
    expect(openButtons(element)[1]?.getAttribute('aria-label')).toBe('ルート2をGoogleマップで開く');
  });

  it('「次に開く」のボタンは青(primary)で目立たせる', () => {
    const element = render(stateWithSelection(SPLIT_COUNT));
    expect(openButtons(element)[0]?.classList.contains('primary')).toBe(true);
    expect(openButtons(element)[1]?.classList.contains('primary')).toBe(false);
  });
});

describe('renderRouteMap: 訪問先が選ばれていないとき', () => {
  it('案内と「訪問先を選ぶ」ボタンを出し、ルートのカードは出さない', () => {
    const spies = handlers();
    const element = render(createInitialState([]), new Map(), spies);
    expect(element.textContent).toContain('訪問先が選ばれていません');
    expect(cards(element)).toHaveLength(0);
    element.querySelector<HTMLButtonElement>('[data-testid="choose-stops-button"]')!.click();
    expect(spies.onChooseStops).toHaveBeenCalledTimes(1);
  });
});
```

`tests/main.test.ts`に、次の変更を加える。

(1) `セッションの永続化(#1)`の最初のテストの題名と、最後の3行を直す。

```ts
  it('選択・訪問順・開いたルートがlocalStorageに残り、再起動後に訪問順の画面から復元される', async () => {
```
↓
```ts
  it('選択・訪問順・開いたルートがlocalStorageに残り、再起動後に地図の画面から復元される', async () => {
```

```ts
    // 復元直後は一覧画面ではなく訪問順の画面から始まる
    expect(el('h1')?.textContent).toBe('訪問順を決める');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(2));
    expect(el('[data-testid="open-route"]')?.textContent).toContain('✓');
```
↓
```ts
    // 開いたルートがあるので、次に開くルートがすぐ分かるよう、地図の画面から始まる
    expect(el('h1')?.textContent).toBe('地図を開く');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="route-card"]')).toHaveLength(1));
    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
```

(2) ファイルの末尾に追加する。

```ts
describe('地図を開く画面', () => {
  async function seedOnePatient(): Promise<{ id: string }> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('場所A', '東京都千代田区1-1');
    await savePatient(patient);
    return { id: patient.id };
  }

  function writeSession(record: object): void {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ timestamp: new Date().toISOString(), ...record }),
    );
  }

  it('開いたルートが記録されていれば、地図の画面から始まり、開いた日時を表示する', async () => {
    const { id } = await seedOnePatient();
    writeSession({
      selectedIds: [id],
      opened: [{ index: 0, at: new Date(2026, 8, 21, 14, 32).toISOString() }],
    });

    await import('../src/main');

    expect(el('h1')?.textContent).toBe('地図を開く');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="route-card"]')).toHaveLength(1));
    expect(el('[data-testid="route-status"]')?.textContent).toContain('9/21 14:32');
  });

  it('古い形式(番号だけ)の記録でも、開いたルートがあれば地図の画面から始まる', async () => {
    const { id } = await seedOnePatient();
    writeSession({ selectedIds: [id], openedRouteIndexes: [0] });

    await import('../src/main');

    expect(el('h1')?.textContent).toBe('地図を開く');
    await waitFor(() => expect(el('[data-testid="route-status"]')).not.toBeNull());
    expect(el('.route-time')).toBeNull();
  });

  it('開いたルートが無ければ、これまでどおり訪問順の画面から始まる', async () => {
    const { id } = await seedOnePatient();
    writeSession({ selectedIds: [id], opened: [] });

    await import('../src/main');

    expect(el('h1')?.textContent).toBe('訪問順を決める');
    await waitFor(() => expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(1));
  });

  it('「もう一度開く」で、地図を開く遷移が呼ばれる', async () => {
    const { id } = await seedOnePatient();
    writeSession({ selectedIds: [id], opened: [{ index: 0, at: new Date().toISOString() }] });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    const { openUrl } = await import('../src/openRoute');

    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();

    expect(openUrl).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(openUrl).mock.calls[0]?.[0])).toContain('google.com/maps');
  });

  it('戻るを押すと、訪問順の画面へ戻る', async () => {
    const { id } = await seedOnePatient();
    writeSession({ selectedIds: [id], opened: [{ index: 0, at: '' }] });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="back-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();

    expect(el('h1')?.textContent).toBe('訪問順を決める');
  });

  it('選択がなくなっていても地図の画面が開け、「訪問先を選ぶ」から一覧へ進める', async () => {
    writeSession({ selectedIds: ['gone-id'], opened: [{ index: 0, at: '' }] });

    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="choose-stops-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="choose-stops-button"]')!.click();

    // 一覧の画面へ移った(この時点の一覧は、まだ作り直していない古い画面)。
    await waitFor(() => expect(el('[data-testid="new-button"]')).not.toBeNull());
    expect(el('h1')?.textContent).not.toBe('地図を開く');
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/format.test.ts tests/routeMapView.test.ts tests/main.test.ts
```

期待: FAIL(`../src/format`と`../src/views/routeMapView`が解決できない、地図の画面がない)。

- [ ] **Step 3: `src/types.ts`の`Screen`に`map`を足す**

```ts
export type Screen =
  | { name: 'list' }
  | { name: 'form'; patientId: string | null }
  | { name: 'order' }
  | { name: 'settings' };
```
↓
```ts
export type Screen =
  | { name: 'list' }
  | { name: 'form'; patientId: string | null }
  | { name: 'order' }
  | { name: 'map' }
  | { name: 'settings' };
```

- [ ] **Step 4: `src/format.ts`を作る**

```ts
/**
 * 日時(ISO 8601)を「月/日 時:分」の形にする。端末のローカル時刻で表示する。
 * 空文字や読めない日時のときは、表示するものがないので空文字を返す(例外は投げない)。
 */
export function formatDateTime(iso: string): string {
  if (iso === '') {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${minutes}`;
}
```

- [ ] **Step 5: `src/views/routeMapView.ts`を作る**

```ts
import { MAX_STOPS_PER_ROUTE } from '../config';
import { formatDateTime } from '../format';
import type { MapProvider } from '../mapProviders';
import { splitIntoRoutes } from '../routeSplitter';
import { selectedPatients } from '../state';
import type { AppState, Patient } from '../types';
import { renderMessage, renderScreenHeader } from './common';

export type RouteMapHandlers = {
  onOpenRoute(routeIndex: number): void;
  onBack(): void;
  onChooseStops(): void;
};

/** done: 開いた / next: 次に開く(最初の未開封) / later: それ以降 */
type CardState = 'done' | 'next' | 'later';

/**
 * 「地図を開く」画面。選んだ訪問先を、ルートごとのカードで表示する。
 * 上限を超えるときは、既存のルート分割で複数のカードになる。
 * 次に開くルートを最も目立たせ、開いたルートは「✓ 開きました」と日時で示す。
 *
 * @param opened 開いたルートの番号 → 開いた日時(ISO 8601。不明なら '')
 */
export function renderRouteMap(
  state: AppState,
  opened: ReadonlyMap<number, string>,
  provider: MapProvider,
  handlers: RouteMapHandlers,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';
  container.append(renderScreenHeader('地図を開く', { onBack: handlers.onBack }));

  if (state.message) {
    container.append(renderMessage(state.message));
  }

  const stops = selectedPatients(state);
  if (stops.length === 0) {
    container.append(renderEmpty(handlers));
    return container;
  }

  const routes = splitIntoRoutes(stops, MAX_STOPS_PER_ROUTE);
  container.append(renderSummary(stops.length, routes.length));

  // 最初の未開封が「次に開く」。すべて開いていれば -1(「次に開く」は無い)。
  const nextIndex = routes.findIndex((_, index) => !opened.has(index));
  const cards = document.createElement('div');
  cards.className = 'route-cards';
  routes.forEach((route, index) => {
    const cardState: CardState = opened.has(index) ? 'done' : index === nextIndex ? 'next' : 'later';
    cards.append(renderRouteCard(route, index, cardState, opened.get(index) ?? '', provider, handlers));
  });
  container.append(cards);
  return container;
}

function renderEmpty(handlers: RouteMapHandlers): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card empty-card';

  const text = document.createElement('p');
  text.textContent = '訪問先が選ばれていません。';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary block';
  button.dataset.testid = 'choose-stops-button';
  button.textContent = '訪問先を選ぶ';
  button.addEventListener('click', () => handlers.onChooseStops());

  card.append(text, button);
  return card;
}

function renderSummary(stopCount: number, routeCount: number): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card summary-card';
  card.dataset.testid = 'map-summary';

  const count = document.createElement('p');
  count.className = 'summary-count';
  count.textContent = `${stopCount}件の訪問先が選択されています。`;
  card.append(count);

  if (routeCount > 1) {
    const split = document.createElement('p');
    split.className = 'summary-split';
    split.textContent = `${routeCount}つのルートに分割します。1つのルートは最大${MAX_STOPS_PER_ROUTE}地点までです。上から順に開いてください。`;
    card.append(split);
  }
  return card;
}

function renderRouteCard(
  route: readonly Patient[],
  index: number,
  cardState: CardState,
  openedAt: string,
  provider: MapProvider,
  handlers: RouteMapHandlers,
): HTMLElement {
  const card = document.createElement('section');
  card.className = `route-card ${cardState}`;
  card.dataset.testid = 'route-card';
  card.dataset.state = cardState;
  card.dataset.id = String(index);

  const head = document.createElement('div');
  head.className = 'route-card-head';
  const title = document.createElement('h2');
  title.className = 'route-title';
  title.textContent = `ルート${index + 1}`;
  const count = document.createElement('span');
  count.className = 'route-count';
  count.textContent = `${route.length}地点`;
  head.append(title, count);
  if (cardState === 'next') {
    const label = document.createElement('span');
    label.className = 'route-next-label';
    label.textContent = '次に開く';
    head.append(label);
  }
  card.append(head);

  const names = document.createElement('p');
  names.className = 'route-names';
  names.textContent = route.map((patient) => patient.name).join(' → ');
  card.append(names);

  if (cardState === 'done') {
    const status = document.createElement('p');
    status.className = 'route-status';
    status.dataset.testid = 'route-status';
    const text = document.createElement('span');
    text.textContent = `✓ ${provider.label}で開きました`;
    status.append(text);
    const time = formatDateTime(openedAt);
    if (time !== '') {
      const timeElement = document.createElement('span');
      timeElement.className = 'route-time';
      timeElement.textContent = time;
      status.append(timeElement);
    }
    card.append(status);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.testid = 'open-route';
  button.dataset.id = String(index);
  if (cardState === 'done') {
    button.textContent = 'もう一度開く';
    button.setAttribute('aria-label', `ルート${index + 1}をもう一度開く`);
  } else {
    button.className = cardState === 'next' ? 'primary block' : 'block';
    button.textContent = `${provider.label}で開く`;
    button.setAttribute('aria-label', `ルート${index + 1}を${provider.label}で開く`);
  }
  button.addEventListener('click', () => handlers.onOpenRoute(index));
  card.append(button);

  return card;
}
```

- [ ] **Step 6: `src/main.ts`に、地図の画面を組み込む**

import行を足す(`renderRouteOrder`のimportの下)。

```ts
import { renderRouteMap } from './views/routeMapView';
```

復元した記録から、最初の画面を決める部分を置き換える。

```ts
let state: AppState = restoredSession
  ? { ...createInitialState([]), selectedIds: restoredSession.selectedIds, screen: { name: 'order' } }
  : createInitialState([]);
```
↓
```ts
let state: AppState = restoredSession
  ? {
      ...createInitialState([]),
      selectedIds: restoredSession.selectedIds,
      // 開いたルートがあれば、地図アプリから戻ってきた状況。次に開くルートがすぐ分かるよう、
      // 地図の画面から始める。なければ、これまでどおり訪問順の画面から始める。
      screen: { name: restoredSession.opened.length > 0 ? 'map' : 'order' },
    }
  : createInitialState([]);
```

`renderScreen`の`switch`の、`case 'order':`ブロックの直後(`case 'settings':`の前)に追加する。

```ts
    case 'map':
      return renderRouteMap(state, new Map(openedRoutes), DEFAULT_MAP_PROVIDER, {
        onOpenRoute: handleOpenRoute,
        onBack: () => setState(withScreen(state, { name: 'order' })),
        onChooseStops: () => setState(withScreen(state, { name: 'list' })),
      });
```

- [ ] **Step 7: `src/styles.css`の末尾に追記する**

```css

/* ===== 地図を開く画面(ルートのカード) ===== */
.summary-card p {
  margin: 0;
}

.summary-card .summary-count {
  font-weight: 600;
}

.summary-card .summary-split {
  margin-top: 0.25rem;
  color: var(--muted);
}

.empty-card p {
  margin: 0 0 var(--gap);
}

.route-cards {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.route-card {
  padding: var(--gap);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

/* 次に開くルート: 青い枠と薄い青の背景で、最も目立たせる。 */
.route-card.next {
  border: 2px solid var(--primary);
  background: var(--primary-soft);
}

/* 開いたルート: 緑。 */
.route-card.done {
  border-color: var(--success);
  background: var(--success-soft);
}

.route-card-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.25rem 0.75rem;
}

.route-title {
  margin: 0;
  font-size: 1.25rem;
}

.route-count {
  color: var(--muted);
}

.route-next-label {
  margin-left: auto;
  padding: 0.125rem 0.75rem;
  border-radius: 999px;
  background: var(--primary);
  color: var(--on-primary);
  font-size: 0.875rem;
  font-weight: 600;
}

.route-names {
  margin: 0.5rem 0 var(--gap);
  overflow-wrap: anywhere;
}

.route-status {
  margin: 0.5rem 0 0.75rem;
  color: var(--success);
  font-weight: 600;
}

.route-time {
  margin-left: 0.5rem;
  color: var(--muted);
  font-weight: 400;
}
```

- [ ] **Step 8: すべて通す**

```bash
npm run test && npm run typecheck && npm run build
```

期待: すべてPASS。

- [ ] **Step 9: コミット**

```bash
git add -A
git commit -m "feat: 地図を開く画面を追加し、ルートをカードで表示する

次に開くルートを青で最も目立たせ、開いたルートは緑で「✓ 開きました」と
日時を表示する。開いたルートが記録されていれば、地図アプリから戻ったとき、
この画面から始まる。ルート分割と地図サービス経由のURL生成は既存のまま使う。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: 訪問順の画面

訪問順を、START / GOAL と大きな番号でつないだ縦の並びにし、「この順番で地図を開く →」で地図の画面へ進める。ルートを開くボタンは地図の画面へ移ったので、この画面からは無くなる。▲▼での並べ替えは残す。

**Files:**
- Modify: `src/views/routeOrderView.ts`(全体を置き換え)、`tests/routeOrderView.test.ts`(全体を置き換え)、`src/main.ts`、`tests/main.test.ts`、`src/styles.css`

**Interfaces:**
- Consumes: `renderScreenHeader`・`renderMessage`(Task 7)、`selectedPatients`、`findDuplicateAddresses`
- Produces:
  - `type RouteOrderHandlers = { onMove(id: string, direction: -1 | 1): void; onAddStops(): void; onOpenMap(): void; onBack(): void }`
  - `renderRouteOrder(state: AppState, handlers: RouteOrderHandlers): HTMLElement`(第2引数だった`openedRouteIndexes`はなくなる)
  - `data-testid`: `stop-row`、`stop-badge`、`move-up` / `move-down`(`data-id`は訪問先のid)、`duplicate-warning`、`add-stops-button`、`open-map-button`、`back-button`

- [ ] **Step 1: 失敗するテストを書く**

`tests/routeOrderView.test.ts`を、次の内容で置き換える。ルートを開く・分割に関する既存のテストは、Task 9で`tests/routeMapView.test.ts`へ移してある。

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import { createInitialState } from '../src/state';
import { renderRouteOrder, type RouteOrderHandlers } from '../src/views/routeOrderView';
import type { AppState, Patient } from '../src/types';

const handlers = (): RouteOrderHandlers => ({
  onMove: vi.fn(),
  onAddStops: vi.fn(),
  onOpenMap: vi.fn(),
  onBack: vi.fn(),
});

function makeStops(count: number, addresses?: string[]): Patient[] {
  return Array.from({ length: count }, (_, i) =>
    createPatient(`場所${i + 1}`, addresses?.[i] ?? `東京都${i + 1}-1`),
  );
}

function stateWithSelection(count: number, addresses?: string[]): AppState {
  const patients = makeStops(count, addresses);
  return { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
}

const rows = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('[data-testid="stop-row"]')];
const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T =>
  element.querySelector<T>(`[data-testid="${testid}"]`)!;

describe('renderRouteOrder: 訪問順の並び', () => {
  it('見出しは「訪問順を決める」', () => {
    expect(renderRouteOrder(stateWithSelection(3), handlers()).querySelector('h1')?.textContent).toBe(
      '訪問順を決める',
    );
  });

  it('選択した訪問先を訪問順に描画する', () => {
    const element = renderRouteOrder(stateWithSelection(3), handlers());
    expect(rows(element)).toHaveLength(3);
    expect(rows(element)[0]?.textContent).toContain('場所1');
    expect(rows(element)[2]?.textContent).toContain('場所3');
  });

  it('名前と住所を表示する', () => {
    const element = renderRouteOrder(stateWithSelection(1), handlers());
    expect(rows(element)[0]?.querySelector('.stop-name')?.textContent).toBe('場所1');
    expect(rows(element)[0]?.querySelector('.stop-address')?.textContent).toBe('東京都1-1');
  });

  it('各行に、訪問順の番号(1, 2, 3…)を大きく表示する', () => {
    const element = renderRouteOrder(stateWithSelection(3), handlers());
    const numbers = rows(element).map((row) => row.querySelector('.stop-number')?.textContent);
    expect(numbers).toEqual(['1', '2', '3']);
  });

  it('先頭に START、末尾に GOAL のバッジを付け、途中にはバッジを付けない', () => {
    const element = renderRouteOrder(stateWithSelection(3), handlers());
    const badges = rows(element).map((row) => row.querySelector('[data-testid="stop-badge"]')?.textContent);
    expect(badges).toEqual(['START', undefined, 'GOAL']);
  });

  it('2件のときは、1件目が START、2件目が GOAL', () => {
    const element = renderRouteOrder(stateWithSelection(2), handlers());
    const badges = rows(element).map((row) => row.querySelector('[data-testid="stop-badge"]')?.textContent);
    expect(badges).toEqual(['START', 'GOAL']);
  });

  it('1件だけのときは START / GOAL を出さず、その場所を開くことを案内する', () => {
    const element = renderRouteOrder(stateWithSelection(1), handlers());
    expect(element.querySelector('[data-testid="stop-badge"]')).toBeNull();
    expect(element.textContent).toContain('1件だけのときは、その場所を地図で開きます。');
  });

  it('2件以上のときは、1件だけの案内を出さない', () => {
    const element = renderRouteOrder(stateWithSelection(2), handlers());
    expect(element.textContent).not.toContain('1件だけのとき');
  });
});

describe('renderRouteOrder: 並べ替え(▲▼)', () => {
  it('先頭の「上へ」と末尾の「下へ」は押せない', () => {
    const element = renderRouteOrder(stateWithSelection(3), handlers());
    const ups = element.querySelectorAll<HTMLButtonElement>('[data-testid="move-up"]');
    const downs = element.querySelectorAll<HTMLButtonElement>('[data-testid="move-down"]');
    expect(ups[0]?.disabled).toBe(true);
    expect(downs[downs.length - 1]?.disabled).toBe(true);
    expect(ups[1]?.disabled).toBe(false);
    expect(downs[0]?.disabled).toBe(false);
  });

  it('「上へ」で onMove が -1 つきで呼ばれる', () => {
    const state = stateWithSelection(2);
    const spies = handlers();
    const element = renderRouteOrder(state, spies);
    element.querySelectorAll<HTMLButtonElement>('[data-testid="move-up"]')[1]?.click();
    expect(spies.onMove).toHaveBeenCalledWith(state.selectedIds[1], -1);
  });

  it('「下へ」で onMove が +1 つきで呼ばれる', () => {
    const state = stateWithSelection(2);
    const spies = handlers();
    const element = renderRouteOrder(state, spies);
    element.querySelectorAll<HTMLButtonElement>('[data-testid="move-down"]')[0]?.click();
    expect(spies.onMove).toHaveBeenCalledWith(state.selectedIds[0], 1);
  });

  it('↑↓ボタンは、その行の訪問先のid を data-id に持つ(フォーカス復元用)', () => {
    const state = stateWithSelection(3);
    const element = renderRouteOrder(state, handlers());
    const ups = element.querySelectorAll<HTMLButtonElement>('[data-testid="move-up"]');
    const downs = element.querySelectorAll<HTMLButtonElement>('[data-testid="move-down"]');
    state.selectedIds.forEach((id, i) => {
      expect(ups[i]?.dataset.id).toBe(id);
      expect(downs[i]?.dataset.id).toBe(id);
    });
  });

  it('↑↓ボタンには、どの訪問先の操作かが分かる名前(aria-label)を付ける', () => {
    const element = renderRouteOrder(stateWithSelection(2), handlers());
    expect(q(element, 'move-up').getAttribute('aria-label')).toBe('場所1を上へ');
    expect(q(element, 'move-down').getAttribute('aria-label')).toBe('場所1を下へ');
  });

  it('並べ替えの案内文を出す', () => {
    const element = renderRouteOrder(stateWithSelection(2), handlers());
    expect(element.querySelector('[data-testid="order-hint"]')?.textContent).toContain('▲▼');
  });
});

describe('renderRouteOrder: 警告とメッセージ', () => {
  it('同じ住所が複数あれば警告を出す', () => {
    const element = renderRouteOrder(
      stateWithSelection(3, ['東京都1-1', '大阪府2-2', '東京都1-1']),
      handlers(),
    );
    expect(q(element, 'duplicate-warning').textContent).toContain('同じ住所の訪問先');
  });

  it('住所に重複がなければ警告を出さない', () => {
    const element = renderRouteOrder(stateWithSelection(3), handlers());
    expect(element.querySelector('[data-testid="duplicate-warning"]')).toBeNull();
  });

  it('重複の警告があっても、地図を開くボタンは押せる(ブロックしない)', () => {
    const element = renderRouteOrder(
      stateWithSelection(2, ['東京都1-1', '東京都1-1']),
      handlers(),
    );
    expect(q<HTMLButtonElement>(element, 'open-map-button').disabled).toBe(false);
  });

  it('メッセージ領域は VoiceOver に読み上げられるよう role=status を持つ', () => {
    const state = { ...stateWithSelection(2), message: { kind: 'error' as const, text: 'エラー' } };
    const element = renderRouteOrder(state, handlers());
    expect(element.querySelector('.message')?.getAttribute('role')).toBe('status');
  });
});

describe('renderRouteOrder: 操作', () => {
  it('戻るボタンで onBack が呼ばれる', () => {
    const spies = handlers();
    q<HTMLButtonElement>(renderRouteOrder(stateWithSelection(2), spies), 'back-button').click();
    expect(spies.onBack).toHaveBeenCalledTimes(1);
  });

  it('「＋ 訪問先を追加」で onAddStops が呼ばれる', () => {
    const spies = handlers();
    const button = q<HTMLButtonElement>(renderRouteOrder(stateWithSelection(2), spies), 'add-stops-button');
    expect(button.textContent).toBe('＋ 訪問先を追加');
    button.click();
    expect(spies.onAddStops).toHaveBeenCalledTimes(1);
  });

  it('主要ボタン「この順番で地図を開く →」で onOpenMap が呼ばれる', () => {
    const spies = handlers();
    const button = q<HTMLButtonElement>(renderRouteOrder(stateWithSelection(2), spies), 'open-map-button');
    expect(button.textContent).toBe('この順番で地図を開く →');
    expect(button.classList.contains('primary')).toBe(true);
    button.click();
    expect(spies.onOpenMap).toHaveBeenCalledTimes(1);
  });
});

describe('renderRouteOrder: 訪問先が選ばれていないとき', () => {
  it('案内を出し、地図を開くボタンは出さない。追加のボタンは出す', () => {
    const element = renderRouteOrder(createInitialState([]), handlers());
    expect(element.textContent).toContain('訪問先が選ばれていません');
    expect(rows(element)).toHaveLength(0);
    expect(element.querySelector('[data-testid="open-map-button"]')).toBeNull();
    expect(element.querySelector('[data-testid="add-stops-button"]')).not.toBeNull();
  });
});
```

`tests/main.test.ts`に、次の変更を加える。

(1) `セッションの永続化(#1)`の最初のテストで、訪問順の画面からルートを開く部分を、地図の画面を経由する形に直す。

```ts
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();

    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();

    const raw = window.localStorage.getItem(SESSION_KEY);
```
↓
```ts
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();

    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();

    const raw = window.localStorage.getItem(SESSION_KEY);
```

(2) `describe('訪問順画面の再入場(#6)', ...)`のブロック全体を、次で置き換える(ブロックの終わりの`});`まで)。

```ts
describe('開いたルートの印(#6)', () => {
  /** 訪問先を count 件登録し、すべて選んで、地図の画面からルートを1つ開いた状態にする。 */
  async function openFirstRoute(count: number): Promise<{ ids: string[] }> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patients = Array.from({ length: count }, (_, i) =>
      createPatient(`場所${i + 1}`, `東京都千代田区${i + 1}-1`),
    );
    for (const patient of patients) {
      await savePatient(patient);
    }

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(count));
    for (const patient of patients) {
      el<HTMLInputElement>(`input[data-id="${patient.id}"]`)!.click();
    }
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-map-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="open-route"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();

    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
    return { ids: patients.map((patient) => patient.id) };
  }

  it('訪問順へ戻って、もう一度地図を開いても、開いたルートの印は残る', async () => {
    await openFirstRoute(1);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(el('h1')?.textContent).toBe('訪問順を決める');
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();

    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
  });

  it('訪問先の選択を変えると、開いたルートの印が消える', async () => {
    const { ids } = await openFirstRoute(1);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 訪問順 → 一覧
    el<HTMLInputElement>(`input[data-id="${ids[0]}"]`)!.click(); // 選択を外す
    el<HTMLInputElement>(`input[data-id="${ids[0]}"]`)!.click(); // 選び直す
    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();

    expect(el('[data-testid="route-status"]')).toBeNull();
    expect(el('[data-testid="route-card"]')?.getAttribute('data-state')).toBe('next');
  });

  it('訪問順を並べ替えると、開いたルートの印が消える', async () => {
    await openFirstRoute(2);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    el<HTMLButtonElement>('[data-testid="move-down"]')!.click(); // 1件目を下へ
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();

    expect(el('[data-testid="route-status"]')).toBeNull();
  });

  it('先頭の▲は押せず、何も変わらないので、開いたルートの印は残る', async () => {
    await openFirstRoute(2);

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click(); // 地図 → 訪問順
    // 先頭の▲は押せない(disabled)ので、押しても何も起きない。
    el<HTMLButtonElement>('[data-testid="move-up"]')!.click();
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();

    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/routeOrderView.test.ts tests/main.test.ts
```

期待: FAIL(新しい`renderRouteOrder`の形が違う、`open-map-button`がない)。

- [ ] **Step 3: `src/views/routeOrderView.ts`を置き換える**

```ts
import { selectedPatients } from '../state';
import type { AppState, Patient } from '../types';
import { findDuplicateAddresses } from '../validation';
import { renderMessage, renderScreenHeader } from './common';

export type RouteOrderHandlers = {
  onMove(id: string, direction: -1 | 1): void;
  /** 「＋ 訪問先を追加」。訪問先を選ぶ画面へ戻る。 */
  onAddStops(): void;
  /** 「この順番で地図を開く →」。地図を開く画面へ進む。 */
  onOpenMap(): void;
  onBack(): void;
};

/**
 * 訪問順の画面。START から GOAL までを、番号つきの縦の並びで示し、▲▼で並べ替える。
 * 訪問順の自動最適化はしない。ユーザーが決めた順番のまま、地図の画面へ渡す。
 */
export function renderRouteOrder(state: AppState, handlers: RouteOrderHandlers): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';
  container.append(renderScreenHeader('訪問順を決める', { onBack: handlers.onBack }));

  if (state.message) {
    container.append(renderMessage(state.message));
  }

  const stops = selectedPatients(state);

  if (findDuplicateAddresses(stops).length > 0) {
    // ブロックはしない。注意だけを出して、そのまま開けるようにする。
    const warning = renderMessage({
      kind: 'error',
      text: '⚠ 同じ住所の訪問先が複数含まれています。このまま開くこともできます。',
    });
    warning.dataset.testid = 'duplicate-warning';
    container.append(warning);
  }

  if (stops.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = '訪問先が選ばれていません。「＋ 訪問先を追加」から選んでください。';
    container.append(empty, renderAddButton(handlers));
    return container;
  }

  if (stops.length === 1) {
    const single = document.createElement('p');
    single.className = 'hint';
    single.textContent = '1件だけのときは、その場所を地図で開きます。';
    container.append(single);
  }

  const list = document.createElement('ol');
  list.className = 'stop-timeline';
  stops.forEach((patient, index) => {
    list.append(renderStopRow(patient, index, stops.length, handlers));
  });
  container.append(list);

  const hint = document.createElement('p');
  hint.className = 'order-hint';
  hint.dataset.testid = 'order-hint';
  hint.textContent = '▲▼ボタンで、順番を入れ替えられます。';
  container.append(hint);

  const actions = document.createElement('div');
  actions.className = 'order-actions';
  const openMap = document.createElement('button');
  openMap.type = 'button';
  openMap.className = 'primary block';
  openMap.dataset.testid = 'open-map-button';
  openMap.textContent = 'この順番で地図を開く →';
  openMap.addEventListener('click', () => handlers.onOpenMap());
  actions.append(renderAddButton(handlers), openMap);
  container.append(actions);

  return container;
}

function renderAddButton(handlers: RouteOrderHandlers): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'block';
  button.dataset.testid = 'add-stops-button';
  button.textContent = '＋ 訪問先を追加';
  button.addEventListener('click', () => handlers.onAddStops());
  return button;
}

function renderStopRow(
  patient: Patient,
  index: number,
  total: number,
  handlers: RouteOrderHandlers,
): HTMLElement {
  const row = document.createElement('li');
  row.className = 'stop-row';
  row.dataset.testid = 'stop-row';

  const rail = document.createElement('div');
  rail.className = 'stop-rail';
  const number = document.createElement('span');
  number.className = 'stop-number';
  number.setAttribute('aria-hidden', 'true');
  number.textContent = String(index + 1);
  rail.append(number);

  const body = document.createElement('div');
  body.className = 'stop-body';
  // 1件だけのときは、始点も終点もないので、バッジを出さない。
  if (total > 1 && (index === 0 || index === total - 1)) {
    const badge = document.createElement('span');
    badge.className = index === 0 ? 'stop-badge start' : 'stop-badge goal';
    badge.dataset.testid = 'stop-badge';
    badge.textContent = index === 0 ? 'START' : 'GOAL';
    body.append(badge);
  }
  const name = document.createElement('div');
  name.className = 'stop-name';
  name.textContent = patient.name;
  const address = document.createElement('div');
  address.className = 'stop-address';
  address.textContent = patient.address;
  body.append(name, address);

  const move = document.createElement('div');
  move.className = 'stop-move';
  const up = document.createElement('button');
  up.type = 'button';
  up.textContent = '▲';
  up.dataset.testid = 'move-up';
  up.dataset.id = patient.id;
  up.disabled = index === 0;
  up.setAttribute('aria-label', `${patient.name}を上へ`);
  up.addEventListener('click', () => handlers.onMove(patient.id, -1));
  const down = document.createElement('button');
  down.type = 'button';
  down.textContent = '▼';
  down.dataset.testid = 'move-down';
  down.dataset.id = patient.id;
  down.disabled = index === total - 1;
  down.setAttribute('aria-label', `${patient.name}を下へ`);
  down.addEventListener('click', () => handlers.onMove(patient.id, 1));
  move.append(up, down);

  row.append(rail, body, move);
  return row;
}
```

- [ ] **Step 4: `src/main.ts`の訪問順の画面を、新しい形につなぐ**

`case 'order':`のブロックを置き換える。

```ts
    case 'order':
      return renderRouteOrder(state, new Set(openedRoutes.keys()), {
        onMove: (id, direction) => setState(moveSelected(state, id, direction)),
        onOpenRoute: handleOpenRoute,
        onBack: () => setState(withScreen(state, { name: 'list' })),
      });
```
↓
```ts
    case 'order':
      return renderRouteOrder(state, {
        onMove: (id, direction) => {
          const next = moveSelected(state, id, direction);
          // 順番が実際に変わったときだけ、開いたルートの印を消す(端の▲▼は何も変えない)。
          if (next.selectedIds !== state.selectedIds) {
            openedRoutes.clear();
          }
          setState(next);
        },
        onAddStops: () => setState(withScreen(state, { name: 'list' })),
        onOpenMap: () => setState(withScreen(state, { name: 'map' })),
        onBack: () => setState(withScreen(state, { name: 'list' })),
      });
```

一覧画面の`onToggleSelect`を置き換える(選択が実際に変わったときだけ印を消す)。

```ts
        onToggleSelect: (id) => setState(toggleSelection(state, id)),
```
↓
```ts
        onToggleSelect: (id) => {
          const next = toggleSelection(state, id);
          // 選択が実際に変わったときだけ、開いたルートの印を消す(上限で選べなかったときは変えない)。
          if (next.selectedIds !== state.selectedIds) {
            openedRoutes.clear();
          }
          setState(next);
        },
```

一覧画面の`onNext`から、印を消す行を削除する(選択や順番を変えていなければ、印は残す)。

```ts
          openedRoutes.clear();
          setState(withScreen(state, { name: 'order' }));
```
↓
```ts
          setState(withScreen(state, { name: 'order' }));
```

- [ ] **Step 5: `src/styles.css`を直す**

次の既存の規則を、すべて削除する: `.stop-list`、`.stop-row`、`.stop-role`、`.route-actions`、`.open-route`(いずれも、`/* ===== 以下は、既存の画面用の規則 ... */`の下にある)。

末尾に追記する。

```css

/* ===== 訪問順の画面 ===== */
.stop-timeline {
  margin: var(--gap) 0;
  padding: 0;
  list-style: none;
}

.stop-row {
  position: relative;
  display: grid;
  grid-template-columns: 2.5rem 1fr auto;
  align-items: start;
  gap: 0.75rem;
  padding-bottom: 1.25rem;
}

/* 番号の丸から次の行の丸へ伸びる、縦のつなぎ線。 */
.stop-row:not(:last-child)::before {
  position: absolute;
  top: 2.5rem;
  bottom: 0;
  left: 1.25rem;
  width: 2px;
  margin-left: -1px;
  background: var(--border-strong);
  content: '';
}

.stop-number {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  border-radius: 50%;
  background: var(--primary);
  color: var(--on-primary);
  font-size: 1.125rem;
  font-weight: 700;
}

.stop-body {
  min-width: 0;
}

.stop-badge {
  display: inline-block;
  margin-bottom: 0.125rem;
  padding: 0 0.5rem;
  border-radius: 0.375rem;
  color: var(--on-primary);
  font-size: 0.875rem;
  font-weight: 700;
}

.stop-badge.start {
  background: var(--primary);
}

.stop-badge.goal {
  background: var(--success);
}

.stop-name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.stop-address {
  color: var(--muted);
  font-size: 0.9375rem;
  overflow-wrap: anywhere;
}

.stop-move {
  display: flex;
  gap: 0.5rem;
}

.stop-move button {
  min-width: var(--tap-min);
  padding: 0;
}

.order-hint {
  margin: 0 0 var(--gap);
  padding: 0.75rem 1rem;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius);
  background: var(--surface);
  color: var(--muted);
  font-size: 0.9375rem;
}

.order-actions {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
```

- [ ] **Step 6: すべて通す**

```bash
npm run test && npm run typecheck && npm run build
```

期待: すべてPASS。

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: 訪問順の画面を、START/GOALと番号でつないだ並びに作り直す

大きな番号の丸と縦の線で順番を示し、先頭にSTART、末尾にGOALを付ける。
▲▼での並べ替えは残す。「この順番で地図を開く →」で地図の画面へ進む。
開いたルートの印は、選択や順番が実際に変わったときだけ消す。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---
### Task 11: 訪問先を選ぶ画面と、下部のタブ・選択バー・ダイアログの結線

一覧を「訪問先を選ぶ」画面に作り直し、これまでに作った部品(タブ・選択バー・ダイアログ)を`main.ts`に組み込む。3つのステップ画面(選ぶ・訪問順・地図)がそろうのはこのタスクで、下部のタブもここで有効になる。

**Files:**
- Modify: `src/views/patientListView.ts`(全体を置き換え)、`tests/patientListView.test.ts`(全体を置き換え)、`src/main.ts`、`tests/main.test.ts`、`src/state.ts`、`src/validation.ts`、`tests/state.test.ts`、`tests/validation.test.ts`、`src/styles.css`

**Interfaces:**
- Consumes: `APP_NAME`(Task 2)、`renderMessage`(Task 7)、`renderTabBar`・`renderSelectionBar`(Task 7)、`renderDialog`(Task 8)、`openRowMenu`・`openDeleteConfirm`・`closeDialog`・`hasSelection`(Task 5)
- Produces:
  - `type PatientListHandlers = { onSearch(query: string): void; onClearSearch(): void; onToggleSelect(id: string): void; onNew(): void; onOpenMenu(id: string): void; onOpenSettings(): void }`
  - `renderPatientList(state: AppState, handlers: PatientListHandlers): HTMLElement`
  - `data-testid`: `settings-button`、`search-input`、`search-clear`、`new-button`、`patient-row`、`patient-checkbox`(`data-id`は訪問先のid)、`row-menu`(`data-id`は訪問先のid)、`limit-hint`、`empty-text`
  - 選択の文言は「N件」(「人」ではない)

- [ ] **Step 1: 失敗するテストを書く**

`tests/patientListView.test.ts`を、次の内容で置き換える。既存のテストの振る舞い(IME、上限、フォーカス復元用の属性、role=status など)は、すべてこのファイルに引き継いでいる。「次へ」ボタンと選択件数の表示は選択バーへ(`tests/selectionBar.test.ts`)、「編集」「削除」ボタンは「⋯」メニューへ(`tests/dialogs.test.ts`)移った。

```ts
import { describe, expect, it, vi } from 'vitest';
import { APP_NAME } from '../src/appInfo';
import { MAX_SELECTION } from '../src/config';
import { createPatient } from '../src/patient';
import { createInitialState, setSearchQuery, toggleSelection } from '../src/state';
import { renderPatientList, type PatientListHandlers } from '../src/views/patientListView';
import type { Patient } from '../src/types';

const makePatients = (count: number): Patient[] =>
  Array.from({ length: count }, (_, i) => createPatient(`場所${i + 1}`, `東京都${i + 1}-1`));

const noopHandlers = (): PatientListHandlers => ({
  onSearch: vi.fn(),
  onClearSearch: vi.fn(),
  onToggleSelect: vi.fn(),
  onNew: vi.fn(),
  onOpenMenu: vi.fn(),
  onOpenSettings: vi.fn(),
});

const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T =>
  element.querySelector<T>(`[data-testid="${testid}"]`)!;
const rows = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('[data-testid="patient-row"]')];
const checkboxFor = (element: HTMLElement, id: string) =>
  element.querySelector<HTMLInputElement>(`input[data-id="${id}"]`)!;

/** change イベントは要素が document に接続されていないと発火しないため、一時的に接続して実行する。 */
function withAttached(element: HTMLElement, run: () => void): void {
  document.body.append(element);
  try {
    run();
  } finally {
    element.remove();
  }
}

describe('renderPatientList: 一覧の内容', () => {
  it('見出しにアプリ名を出す', () => {
    const element = renderPatientList(createInitialState([]), noopHandlers());
    expect(element.querySelector('h1')?.textContent).toBe(APP_NAME);
  });

  it('訪問先の行を件数ぶん描画する', () => {
    const element = renderPatientList(createInitialState(makePatients(3)), noopHandlers());
    expect(rows(element)).toHaveLength(3);
  });

  it('名前と住所を表示する', () => {
    const element = renderPatientList(createInitialState(makePatients(1)), noopHandlers());
    expect(element.textContent).toContain('場所1');
    expect(element.textContent).toContain('東京都1-1');
  });

  it('登録が0件なら、登録を促す案内を表示する', () => {
    const element = renderPatientList(createInitialState([]), noopHandlers());
    expect(q(element, 'empty-text').textContent).toContain('まだ訪問先が登録されていません');
  });

  it('検索で絞り込まれた結果だけを描画する', () => {
    const state = setSearchQuery(createInitialState(makePatients(3)), '場所2');
    const element = renderPatientList(state, noopHandlers());
    expect(rows(element)).toHaveLength(1);
  });

  it('検索の結果が0件なら「該当する訪問先がありません」と表示する', () => {
    const state = setSearchQuery(createInitialState(makePatients(3)), 'どこにもない');
    const element = renderPatientList(state, noopHandlers());
    expect(rows(element)).toHaveLength(0);
    expect(q(element, 'empty-text').textContent).toBe('該当する訪問先がありません');
  });

  it('「＋ 訪問先を登録」ボタンを出し、押すと onNew が呼ばれる', () => {
    const handlers = noopHandlers();
    const button = q<HTMLButtonElement>(renderPatientList(createInitialState([]), handlers), 'new-button');
    expect(button.textContent).toBe('＋ 訪問先を登録');
    expect(button.classList.contains('primary')).toBe(true);
    button.click();
    expect(handlers.onNew).toHaveBeenCalledTimes(1);
  });

  it('設定ボタンには「設定」という名前(aria-label)を付け、押すと onOpenSettings が呼ばれる', () => {
    const handlers = noopHandlers();
    const button = q<HTMLButtonElement>(
      renderPatientList(createInitialState([]), handlers),
      'settings-button',
    );
    expect(button.getAttribute('aria-label')).toBe('設定');
    button.click();
    expect(handlers.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('メッセージがあれば表示し、VoiceOver に読み上げられるよう role=status を持つ', () => {
    const state = { ...createInitialState([]), message: { kind: 'error' as const, text: '保存できませんでした。' } };
    const element = renderPatientList(state, noopHandlers());
    expect(element.querySelector('.message')?.textContent).toBe('保存できませんでした。');
    expect(element.querySelector('.message')?.getAttribute('role')).toBe('status');
  });

  it('選択件数や「次へ」のボタンは、この画面には出さない(下部の選択バーが担当)', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    expect(element.querySelector('[data-testid="next-button"]')).toBeNull();
    expect(element.textContent).not.toContain('選択中');
  });
});

describe('renderPatientList: 選択', () => {
  it('選択済みの訪問先のチェックボックスがオンになる', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    expect(checkboxFor(element, patients[0]!.id).checked).toBe(true);
    expect(checkboxFor(element, patients[1]!.id).checked).toBe(false);
  });

  it('選択した行だけに selected のクラスが付く(色以外の印はチェックマークが担う)', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    expect(rows(element)[0]!.classList.contains('selected')).toBe(true);
    expect(rows(element)[1]!.classList.contains('selected')).toBe(false);
  });

  it('チェックボックスを押すと onToggleSelect が id つきで呼ばれる', () => {
    const patients = makePatients(1);
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(patients), handlers);
    withAttached(element, () => {
      checkboxFor(element, patients[0]!.id).click();
      expect(handlers.onToggleSelect).toHaveBeenCalledWith(patients[0]!.id);
    });
  });

  it('行全体(名前や住所の部分)を押しても選択できる', () => {
    const patients = makePatients(1);
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(patients), handlers);
    withAttached(element, () => {
      element.querySelector<HTMLElement>('.place-name')!.click();
      expect(handlers.onToggleSelect).toHaveBeenCalledTimes(1);
      expect(handlers.onToggleSelect).toHaveBeenCalledWith(patients[0]!.id);
    });
  });

  it('チェックボックスは本物の input[type=checkbox] で、キーボードの操作対象から外れていない', () => {
    const patients = makePatients(1);
    const element = renderPatientList(createInitialState(patients), noopHandlers());
    const checkbox = checkboxFor(element, patients[0]!.id);
    expect(checkbox.type).toBe('checkbox');
    expect(checkbox.getAttribute('tabindex')).not.toBe('-1');
    expect(checkbox.hidden).toBe(false);
  });

  it('上限まで選ぶと、未選択のチェックボックスが押せなくなり、その行は disabled の表示になる', () => {
    const patients = makePatients(MAX_SELECTION + 1);
    let state = createInitialState(patients);
    for (const patient of patients.slice(0, MAX_SELECTION)) {
      state = toggleSelection(state, patient.id);
    }
    const element = renderPatientList(state, noopHandlers());
    const unselected = patients[MAX_SELECTION]!;
    expect(checkboxFor(element, unselected.id).disabled).toBe(true);
    expect(checkboxFor(element, unselected.id).closest('li')!.classList.contains('disabled')).toBe(true);
    // 選択済みの行は、解除できるよう押せるまま。
    expect(checkboxFor(element, patients[0]!.id).disabled).toBe(false);
  });

  it('上限まで選ぶと、これ以上選べない理由を「N件」で表示する', () => {
    const patients = makePatients(MAX_SELECTION + 1);
    let state = createInitialState(patients);
    for (const patient of patients.slice(0, MAX_SELECTION)) {
      state = toggleSelection(state, patient.id);
    }
    const element = renderPatientList(state, noopHandlers());
    expect(q(element, 'limit-hint').textContent).toContain(`${MAX_SELECTION}件`);
  });

  it('上限に達していなければ理由は表示しない', () => {
    const element = renderPatientList(createInitialState(makePatients(2)), noopHandlers());
    expect(element.querySelector('[data-testid="limit-hint"]')).toBeNull();
  });

  it('チェックボックスは data-testid と data-id の両方を持つ(フォーカス復元用)', () => {
    const patients = makePatients(1);
    const element = renderPatientList(createInitialState(patients), noopHandlers());
    expect(checkboxFor(element, patients[0]!.id).dataset.testid).toBe('patient-checkbox');
  });

  it('チェックボックスに、どの訪問先か分かる名前(aria-label)を付ける', () => {
    const patients = makePatients(1);
    const element = renderPatientList(createInitialState(patients), noopHandlers());
    expect(checkboxFor(element, patients[0]!.id).getAttribute('aria-label')).toBe('場所1を選択');
  });
});

describe('renderPatientList: 「⋯」メニュー', () => {
  it('各行の右に「⋯」ボタンを出し、どの訪問先のメニューか分かる名前を付ける', () => {
    const patients = makePatients(2);
    const element = renderPatientList(createInitialState(patients), noopHandlers());
    const buttons = element.querySelectorAll<HTMLButtonElement>('[data-testid="row-menu"]');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.textContent).toBe('⋯');
    expect(buttons[0]!.dataset.id).toBe(patients[0]!.id);
    expect(buttons[0]!.getAttribute('aria-label')).toBe('場所1のメニューを開く');
  });

  it('押すと onOpenMenu が id つきで呼ばれる。選択は変わらない', () => {
    const patients = makePatients(1);
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(patients), handlers);
    withAttached(element, () => {
      q<HTMLButtonElement>(element, 'row-menu').click();
      expect(handlers.onOpenMenu).toHaveBeenCalledWith(patients[0]!.id);
      expect(handlers.onToggleSelect).not.toHaveBeenCalled();
    });
  });

  it('「⋯」は、行全体の選択(ラベル)の外にある', () => {
    const element = renderPatientList(createInitialState(makePatients(1)), noopHandlers());
    const label = element.querySelector('label')!;
    expect(label.contains(q(element, 'row-menu'))).toBe(false);
  });

  it('「編集」「削除」のボタンを、行に常時は表示しない', () => {
    const element = renderPatientList(createInitialState(makePatients(2)), noopHandlers());
    expect(element.querySelector('[data-testid="edit"]')).toBeNull();
    expect(element.querySelector('[data-testid="delete"]')).toBeNull();
  });
});

describe('renderPatientList: 検索', () => {
  it('検索欄に「名前・住所で検索」のプレースホルダーと名前を付ける', () => {
    const search = q<HTMLInputElement>(renderPatientList(createInitialState([]), noopHandlers()), 'search-input');
    expect(search.placeholder).toBe('名前・住所で検索');
    expect(search.getAttribute('aria-label')).toBe('名前・住所で検索');
  });

  it('検索欄には、今の検索語が入る', () => {
    const state = setSearchQuery(createInitialState([]), '世田谷');
    expect(q<HTMLInputElement>(renderPatientList(state, noopHandlers()), 'search-input').value).toBe('世田谷');
  });

  it('IME変換中は onSearch を呼ばない', () => {
    const handlers = noopHandlers();
    const search = q<HTMLInputElement>(renderPatientList(createInitialState([]), handlers), 'search-input');
    search.dispatchEvent(new Event('compositionstart'));
    search.value = 'やま';
    search.dispatchEvent(new Event('input'));
    expect(handlers.onSearch).not.toHaveBeenCalled();
  });

  it('IME変換が確定(compositionend)すると、確定した文字列で onSearch が呼ばれる', () => {
    const handlers = noopHandlers();
    const search = q<HTMLInputElement>(renderPatientList(createInitialState([]), handlers), 'search-input');
    search.dispatchEvent(new Event('compositionstart'));
    search.value = 'やまだ';
    search.dispatchEvent(new Event('input'));
    search.dispatchEvent(new Event('compositionend'));
    expect(handlers.onSearch).toHaveBeenCalledWith('やまだ');
    expect(handlers.onSearch).toHaveBeenCalledTimes(1);
  });

  it('IME変換を伴わない入力では、input のたびに onSearch が呼ばれる', () => {
    const handlers = noopHandlers();
    const search = q<HTMLInputElement>(renderPatientList(createInitialState([]), handlers), 'search-input');
    search.value = 'a';
    search.dispatchEvent(new Event('input'));
    expect(handlers.onSearch).toHaveBeenCalledWith('a');
  });

  it('検索語が空のときは、クリアボタンを出さない', () => {
    const element = renderPatientList(createInitialState(makePatients(1)), noopHandlers());
    expect(element.querySelector('[data-testid="search-clear"]')).toBeNull();
  });

  it('検索語があるときは、クリアボタンを出し、押すと onClearSearch が呼ばれる', () => {
    const handlers = noopHandlers();
    const state = setSearchQuery(createInitialState(makePatients(1)), '場所');
    const clear = q<HTMLButtonElement>(renderPatientList(state, handlers), 'search-clear');
    expect(clear.getAttribute('aria-label')).toBe('検索をクリア');
    clear.click();
    expect(handlers.onClearSearch).toHaveBeenCalledTimes(1);
  });
});
```

`tests/main.test.ts`に、次の変更を加える。

(1) ファイル先頭のimportに追加する(`serializeBackup`のimportの下)。

```ts
import { APP_NAME } from '../src/appInfo';
```

(2) `afterEach`の先頭に、テスト間にスパイを持ち越さない処理を足す(持ち越すと、前のテストで記録された呼び出しのせいで、待つべき処理を待たずに検証が通ってしまう)。

```ts
afterEach(async () => {
  // main.tsが内部で使っている(今のモジュールキャッシュ上の)db接続を閉じる。
```
↓
```ts
afterEach(async () => {
  // spyOn をテスト間に持ち越さない(持ち越すと、前のテストで記録された呼び出しのせいで、
  // 待つべき処理を待たずに検証が通ってしまう)。
  vi.restoreAllMocks();
  // main.tsが内部で使っている(今のモジュールキャッシュ上の)db接続を閉じる。
```

(3) `入力内容の保持(#2)`の2番目のテスト(編集中の入力)で、編集ボタンを押す行を、メニュー経由に直す。

```ts
    el<HTMLButtonElement>(`[data-testid="edit"][data-id="${patient.id}"]`)!.click();
```
↓
```ts
    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-edit"]')!.click();
```

(4) `二重タップ防止(#7)`の2番目のテスト(`削除ボタンを連打しても確認ダイアログは一度しか出ない`)を、次で置き換える(テストの終わりの`});`まで)。

```ts
  it('削除の確認で「削除」を連打しても、削除は1回だけで、標準の確認ダイアログは出ない', async () => {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);

    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(1));

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${patient.id}"]`)!.click();
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();
    const confirmButton = el<HTMLButtonElement>('[data-testid="dialog-confirm-delete"]')!;
    confirmButton.click();
    confirmButton.click();

    await waitFor(() => expect(rows()).toHaveLength(0));
    expect(el('.message')?.textContent).toContain('削除しました');
    expect(confirmSpy).not.toHaveBeenCalled();
  });
```

(5) `セッションの永続化(#1)`の`12時間より古いセッションは復元せず一覧画面から始まる`で、見出しの期待を直す。

```ts
    expect(el('h1')?.textContent).toBe('ルート自動入力');
```
↓
```ts
    expect(el('h1')?.textContent).toBe(APP_NAME);
```

(6) ファイルの末尾に追加する。

```ts
describe('訪問先を選ぶ画面と下部のバー', () => {
  async function seedPlaces(count: number): Promise<string[]> {
    const { savePatient } = await import('../src/db');
    const { createPatient } = await import('../src/patient');
    const ids: string[] = [];
    for (let i = 1; i <= count; i += 1) {
      const patient = createPatient(`場所${i}`, `東京都千代田区${i}-1`);
      await savePatient(patient);
      ids.push(patient.id);
    }
    return ids;
  }

  async function startWithPlaces(count: number): Promise<string[]> {
    const ids = await seedPlaces(count);
    await import('../src/main');
    await waitFor(() => expect(rows()).toHaveLength(count));
    return ids;
  }

  const checkbox = (id: string) => el<HTMLInputElement>(`input[data-id="${id}"]`)!;
  const openMenuFor = (id: string) =>
    el<HTMLButtonElement>(`[data-testid="row-menu"][data-id="${id}"]`)!.click();

  it('見出しにアプリ名を出す', async () => {
    // 起動直後のDB読み込みが終わるまで待つ(待たずに終えると、その読み込みが次のテストへ漏れる)。
    await startWithPlaces(1);
    expect(el('h1')?.textContent).toBe(APP_NAME);
  });

  it('行全体をタップして選択でき、選択バーに件数が出て、もう一度タップすると外れる', async () => {
    const [first] = await startWithPlaces(2);
    expect(el('[data-testid="selection-bar"]')).toBeNull();

    el<HTMLElement>('.place-name')!.click(); // 行の名前の部分をタップ

    expect(checkbox(first!).checked).toBe(true);
    expect(rows()[0]!.classList.contains('selected')).toBe(true);
    expect(el('[data-testid="selection-count"]')?.textContent).toBe('1件選択中');

    el<HTMLElement>('.place-name')!.click();

    expect(el('[data-testid="selection-bar"]')).toBeNull();
  });

  it('選択バーの「訪問順を決める →」で、訪問順の画面へ進む', async () => {
    const [first] = await startWithPlaces(2);
    checkbox(first!).click();

    el<HTMLButtonElement>('[data-testid="next-button"]')!.click();

    expect(el('h1')?.textContent).toBe('訪問順を決める');
  });

  it('「⋯」を押すとメニューが開き、最初のボタンにフォーカスが移り、選択は変わらない', async () => {
    const [first] = await startWithPlaces(1);

    openMenuFor(first!);

    expect(el('[data-testid="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(el('[data-testid="dialog-edit"]'));
    expect(checkbox(first!).checked).toBe(false);
    expect(document.body.classList.contains('dialog-open')).toBe(true);
  });

  it('メニューを「キャンセル」で閉じると、フォーカスが元の「⋯」へ戻り、背後のスクロール止めも外れる', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(el(`[data-testid="row-menu"][data-id="${first}"]`));
    expect(document.body.classList.contains('dialog-open')).toBe(false);
  });

  it('Escキーでメニューが閉じる', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el('[data-testid="dialog-edit"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
    );

    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('メニューの外側(背景)を押すと閉じる', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLElement>('[data-testid="dialog-overlay"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('メニューの「編集」で、その訪問先の編集フォームが開き、名前と住所が入っている', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLButtonElement>('[data-testid="dialog-edit"]')!.click();

    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('場所1');
    expect(el<HTMLInputElement>('[data-testid="address-input"]')!.value).toBe('東京都千代田区1-1');
    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('メニューの「複製して登録」で、名前と住所を写した新規フォームが開き、保存すると別の訪問先として増える', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLButtonElement>('[data-testid="dialog-duplicate"]')!.click();

    expect(el<HTMLInputElement>('[data-testid="name-input"]')!.value).toBe('場所1');
    expect(el<HTMLInputElement>('[data-testid="address-input"]')!.value).toBe('東京都千代田区1-1');

    el<HTMLButtonElement>('[data-testid="save-button"]')!.click();
    await waitFor(() => expect(rows()).toHaveLength(2));
    // 元の訪問先はそのまま残っている。
    expect(checkbox(first!)).not.toBeNull();
  });

  it('メニューの「削除」を押しても、すぐには削除せず、確認のダイアログが出る', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);

    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();

    expect(el('#dialog-title')?.textContent).toBe('この訪問先を削除しますか?');
    expect(rows()).toHaveLength(1);
  });

  it('削除の確認で「キャンセル」すると、削除されず、フォーカスは「⋯」へ戻る', async () => {
    const [first] = await startWithPlaces(1);
    openMenuFor(first!);
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();

    el<HTMLButtonElement>('[data-testid="dialog-cancel"]')!.click();

    expect(el('[data-testid="dialog"]')).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(document.activeElement).toBe(el(`[data-testid="row-menu"][data-id="${first}"]`));
  });

  it('削除の確認で「削除」を押すと、その訪問先が消えて、お知らせが出る', async () => {
    const [first, second] = await startWithPlaces(2);
    openMenuFor(first!);
    el<HTMLButtonElement>('[data-testid="dialog-delete"]')!.click();

    el<HTMLButtonElement>('[data-testid="dialog-confirm-delete"]')!.click();

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(checkbox(second!)).not.toBeNull();
    expect(el('.message')?.textContent).toContain('削除しました');
    expect(el('[data-testid="dialog"]')).toBeNull();
  });

  it('検索で絞り込め、0件のときは案内が出て、クリアボタンで元に戻り、検索欄にフォーカスが戻る', async () => {
    await startWithPlaces(3);
    const search = () => el<HTMLInputElement>('[data-testid="search-input"]')!;

    search().value = '場所2';
    search().dispatchEvent(new Event('input'));
    expect(rows()).toHaveLength(1);

    search().value = 'どこにもない';
    search().dispatchEvent(new Event('input'));
    expect(rows()).toHaveLength(0);
    expect(el('[data-testid="empty-text"]')?.textContent).toBe('該当する訪問先がありません');

    el<HTMLButtonElement>('[data-testid="search-clear"]')!.click();

    expect(rows()).toHaveLength(3);
    expect(search().value).toBe('');
    expect(document.activeElement).toBe(search());
  });

  it('下部のタブは3つのステップを示し、訪問先を選ぶまでは、訪問順と地図のタブを押せない', async () => {
    const [first] = await startWithPlaces(1);
    expect(el('[data-testid="tab-list"]')?.getAttribute('aria-current')).toBe('step');
    expect(el<HTMLButtonElement>('[data-testid="tab-order"]')!.disabled).toBe(true);
    expect(el<HTMLButtonElement>('[data-testid="tab-map"]')!.disabled).toBe(true);

    checkbox(first!).click();

    expect(el<HTMLButtonElement>('[data-testid="tab-order"]')!.disabled).toBe(false);
    expect(el<HTMLButtonElement>('[data-testid="tab-map"]')!.disabled).toBe(false);
  });

  it('タブで、訪問順・地図・訪問先を選ぶ、の間を移動できる', async () => {
    const [first] = await startWithPlaces(1);
    checkbox(first!).click();

    el<HTMLButtonElement>('[data-testid="tab-order"]')!.click();
    expect(el('h1')?.textContent).toBe('訪問順を決める');
    expect(el('[data-testid="tab-order"]')?.getAttribute('aria-current')).toBe('step');

    el<HTMLButtonElement>('[data-testid="tab-map"]')!.click();
    expect(el('h1')?.textContent).toBe('地図を開く');

    el<HTMLButtonElement>('[data-testid="tab-list"]')!.click();
    expect(el('h1')?.textContent).toBe(APP_NAME);
  });

  it('タブで移動しても、開いたルートの印は消えない', async () => {
    const [first] = await startWithPlaces(1);
    checkbox(first!).click();
    el<HTMLButtonElement>('[data-testid="tab-map"]')!.click();
    el<HTMLButtonElement>('[data-testid="open-route"]')!.click();
    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');

    el<HTMLButtonElement>('[data-testid="tab-list"]')!.click();
    el<HTMLButtonElement>('[data-testid="tab-map"]')!.click();

    expect(el('[data-testid="route-status"]')?.textContent).toContain('開きました');
  });

  it('設定・登録の画面には、下部のタブを出さない', async () => {
    await startWithPlaces(1);
    expect(el('[data-testid="tabbar"]')).not.toBeNull();

    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    expect(el('[data-testid="tabbar"]')).toBeNull();

    el<HTMLButtonElement>('[data-testid="back-button"]')!.click();
    expect(el('[data-testid="tabbar"]')).not.toBeNull();

    el<HTMLButtonElement>('[data-testid="new-button"]')!.click();
    expect(el('[data-testid="tabbar"]')).toBeNull();
  });

  it('選択バーは、訪問先を選んだ一覧の画面にだけ出て、訪問順の画面には出ない', async () => {
    const [first] = await startWithPlaces(1);
    checkbox(first!).click();
    expect(el('[data-testid="selection-bar"]')).not.toBeNull();

    el<HTMLButtonElement>('[data-testid="tab-order"]')!.click();

    expect(el('[data-testid="selection-bar"]')).toBeNull();
    expect(el('[data-testid="tabbar"]')).not.toBeNull();
  });

  it('選択バーとタブがあるとき、内容の下に十分な余白を取るクラスが付く', async () => {
    const [first] = await startWithPlaces(1);
    expect(el('.app-shell')?.classList.contains('with-tabbar')).toBe(true);

    checkbox(first!).click();

    expect(el('.app-shell')?.classList.contains('with-selection')).toBe(true);
  });
});
```

`tests/state.test.ts`の末尾に追加する。

```ts
describe('選択上限の文言', () => {
  it('上限を超えて選ぼうとしたとき、「N件まで」と案内する', () => {
    const patients = makePatients(MAX_SELECTION + 1);
    let state = createInitialState(patients);
    for (const patient of patients.slice(0, MAX_SELECTION)) {
      state = toggleSelection(state, patient.id);
    }
    const overflowed = toggleSelection(state, patients[MAX_SELECTION]!.id);
    expect(overflowed.message?.text).toBe(`一度に選べるのは${MAX_SELECTION}件までです。`);
  });
});
```

`tests/validation.test.ts`の末尾に追加する。あわせて、ファイル先頭のimportに`import { MAX_SELECTION } from '../src/config';`が無ければ足す。

```ts
describe('選択の文言(訪問先・件)', () => {
  it('0件のとき「訪問先を1件以上選んでください。」', () => {
    expect(validateSelection(0)).toEqual({ ok: false, message: '訪問先を1件以上選んでください。' });
  });

  it('上限を超えたとき「一度に選べるのはN件までです。」', () => {
    expect(validateSelection(MAX_SELECTION + 1)).toEqual({
      ok: false,
      message: `一度に選べるのは${MAX_SELECTION}件までです。`,
    });
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/patientListView.test.ts tests/state.test.ts tests/validation.test.ts tests/main.test.ts
```

期待: FAIL(新しい`renderPatientList`の形が違う、文言が「人」のまま、`row-menu`がない、など)。

- [ ] **Step 3: 文言を直す**

`src/state.ts`の`toggleSelection`の中を置き換える。

```ts
      message: { kind: 'error', text: `一度に選べるのは${MAX_SELECTION}人までです。` },
```
↓
```ts
      message: { kind: 'error', text: `一度に選べるのは${MAX_SELECTION}件までです。` },
```

`src/validation.ts`の`validateSelection`の2か所を置き換える。

```ts
    return { ok: false, message: '患者を1人以上選んでください。' };
```
↓
```ts
    return { ok: false, message: '訪問先を1件以上選んでください。' };
```

```ts
    return { ok: false, message: `一度に選べるのは${MAX_SELECTION}人までです。` };
```
↓
```ts
    return { ok: false, message: `一度に選べるのは${MAX_SELECTION}件までです。` };
```

- [ ] **Step 4: `src/views/patientListView.ts`を置き換える**

```ts
import { APP_NAME } from '../appInfo';
import { MAX_SELECTION } from '../config';
import { visiblePatients } from '../state';
import type { AppState, Patient } from '../types';
import { renderMessage } from './common';

export type PatientListHandlers = {
  onSearch(query: string): void;
  /** 検索欄のクリアボタン。検索語を空にし、検索欄へフォーカスを戻すのは呼び出し側。 */
  onClearSearch(): void;
  onToggleSelect(id: string): void;
  onNew(): void;
  /** 行の「⋯」。編集・複製・削除は、開いたメニューの中にある。 */
  onOpenMenu(id: string): void;
  onOpenSettings(): void;
};

/**
 * 「訪問先を選ぶ」画面。名前・住所で検索し、行全体をタップして選ぶ。
 * 編集・複製・削除は、行の右端の「⋯」から開くメニューに置き、通常の操作では誤って触れないようにする。
 * 選択件数と「訪問順を決める →」は、下部の選択バー(main.ts が重ねる)が担当する。
 */
export function renderPatientList(state: AppState, handlers: PatientListHandlers): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';

  // 見出しと検索欄は、一覧をスクロールしても上部に残す(sticky)。
  const head = document.createElement('div');
  head.className = 'list-head';
  head.append(renderTitleRow(handlers), renderSearch(state, handlers));
  container.append(head);

  if (state.message) {
    container.append(renderMessage(state.message));
  }

  const newButton = document.createElement('button');
  newButton.type = 'button';
  newButton.className = 'primary block';
  newButton.dataset.testid = 'new-button';
  newButton.textContent = '＋ 訪問先を登録';
  newButton.addEventListener('click', () => handlers.onNew());
  container.append(newButton);

  const patients = visiblePatients(state);
  if (patients.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint empty-text';
    empty.dataset.testid = 'empty-text';
    empty.textContent =
      state.patients.length === 0
        ? 'まだ訪問先が登録されていません。「＋ 訪問先を登録」から追加してください。'
        : '該当する訪問先がありません';
    container.append(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'place-list';
    for (const patient of patients) {
      list.append(renderRow(patient, state, handlers));
    }
    container.append(list);
  }

  if (state.selectedIds.length >= MAX_SELECTION) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.dataset.testid = 'limit-hint';
    hint.textContent = `一度に選べるのは${MAX_SELECTION}件までです。選び直すには、どれかの選択を外してください。`;
    container.append(hint);
  }

  return container;
}

function renderTitleRow(handlers: PatientListHandlers): HTMLElement {
  const row = document.createElement('div');
  row.className = 'list-title-row';

  const title = document.createElement('h1');
  title.className = 'list-title';
  title.textContent = APP_NAME;

  const settings = document.createElement('button');
  settings.type = 'button';
  settings.className = 'icon-button';
  settings.dataset.testid = 'settings-button';
  settings.setAttribute('aria-label', '設定');
  // U+FE0E は、絵文字ではなく文字の見た目で出すための指定。
  settings.textContent = '⚙︎';
  settings.addEventListener('click', () => handlers.onOpenSettings());

  row.append(title, settings);
  return row;
}

function renderSearch(state: AppState, handlers: PatientListHandlers): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'search';

  const search = document.createElement('input');
  search.type = 'text';
  search.value = state.searchQuery;
  search.placeholder = '名前・住所で検索';
  search.setAttribute('aria-label', '名前・住所で検索');
  search.dataset.testid = 'search-input';
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.enterKeyHint = 'search';
  search.setAttribute('autocapitalize', 'none');

  // IME変換中に画面全体を再描画すると入力欄が作り直され、変換セッションが
  // 壊れる(Safariは変換中もinputを発火するため)。変換が終わるまでは
  // onSearchを呼ばず、compositionendで確定した文字列を渡す。
  let isComposing = false;
  search.addEventListener('compositionstart', () => {
    isComposing = true;
  });
  search.addEventListener('compositionend', () => {
    isComposing = false;
    handlers.onSearch(search.value);
  });
  search.addEventListener('input', () => {
    if (isComposing) {
      return;
    }
    handlers.onSearch(search.value);
  });
  wrapper.append(search);

  // 文字があるときだけ、消すためのボタンを出す。
  if (state.searchQuery !== '') {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'search-clear';
    clear.dataset.testid = 'search-clear';
    clear.setAttribute('aria-label', '検索をクリア');
    clear.textContent = '×';
    clear.addEventListener('click', () => handlers.onClearSearch());
    wrapper.append(clear);
  }
  return wrapper;
}

function renderRow(patient: Patient, state: AppState, handlers: PatientListHandlers): HTMLElement {
  const selected = state.selectedIds.includes(patient.id);
  // 上限に達しているとき、未選択の行は選べない。
  const atLimit = !selected && state.selectedIds.length >= MAX_SELECTION;

  const row = document.createElement('li');
  row.className = `place-row${selected ? ' selected' : ''}${atLimit ? ' disabled' : ''}`;
  row.dataset.testid = 'patient-row';

  // 行全体をラベルにして、どこをタップしても選択・解除できるようにする。
  // 本物のチェックボックスを画面の外へ隠して持たせ、キーボードとスクリーンリーダーの操作を保つ。
  const main = document.createElement('label');
  main.className = 'place-main';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'visually-hidden';
  checkbox.dataset.testid = 'patient-checkbox';
  checkbox.dataset.id = patient.id;
  checkbox.checked = selected;
  checkbox.disabled = atLimit;
  checkbox.setAttribute('aria-label', `${patient.name}を選択`);
  checkbox.addEventListener('change', () => handlers.onToggleSelect(patient.id));

  // 見た目のチェック。色だけに頼らないよう、選択時は ✓ を出す(CSS)。
  const check = document.createElement('span');
  check.className = 'check';
  check.setAttribute('aria-hidden', 'true');

  const text = document.createElement('span');
  text.className = 'place-text';
  const name = document.createElement('span');
  name.className = 'place-name';
  name.textContent = patient.name;
  const address = document.createElement('span');
  address.className = 'place-address';
  address.textContent = patient.address;
  text.append(name, address);

  main.append(checkbox, check, text);

  // 「⋯」は、行の選択(ラベル)の外に置く。押しても選択は変わらない。
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'more';
  more.dataset.testid = 'row-menu';
  more.dataset.id = patient.id;
  more.setAttribute('aria-label', `${patient.name}のメニューを開く`);
  more.setAttribute('aria-haspopup', 'dialog');
  more.textContent = '⋯';
  more.addEventListener('click', () => handlers.onOpenMenu(patient.id));

  row.append(main, more);
  return row;
}
```

- [ ] **Step 5: `src/main.ts`に、タブ・選択バー・ダイアログを組み込む**

(a) `./state`のimportに、次を足す(アルファベット順の位置は問わない)。

```ts
import {
  closeDialog,
  createInitialState,
  hasSelection,
  moveSelected,
  openDeleteConfirm,
  openRowMenu,
  selectedPatients,
  setSearchQuery,
  toggleSelection,
  withMessage,
  withPatients,
  withScreen,
} from './state';
```

view のimportに、次の3行を足す。

```ts
import { renderDialog } from './views/dialogs';
import { renderSelectionBar } from './views/selectionBar';
import { renderTabBar, type Step } from './views/tabBar';
```

(b) `const deletingPatientIds = new Set<string>();`の直後に追加する。

```ts

// 「⋯」から開いたダイアログを、編集・複製・削除以外で閉じたとき、フォーカスを戻す行のid。
let dialogReturnId: string | null = null;
```

(c) `root`が見つかったことを確かめる`if (!root) { throw ... }`の直後に追加する。

```ts

// Escキーでダイアログを閉じる。document ではなく root に付けるのは、テストで main.ts を
// 読み込み直すたびに、document へリスナーが積み重ならないようにするため。
root.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.dialog !== null) {
    event.preventDefault();
    closeAnyDialog();
  }
});
```

(d) `handleDelete`を、次で置き換える(関数全体)。

```ts
async function handleDelete(id: string): Promise<void> {
  if (deletingPatientIds.has(id)) {
    // 削除中の二重タップ。何もしない。
    return;
  }
  if (!state.patients.some((patient) => patient.id === id)) {
    closeAnyDialog();
    return;
  }
  deletingPatientIds.add(id);
  // 確認は、ここへ来る前に、確認のダイアログで「削除」を押した時点で済んでいる。
  dialogReturnId = null;
  setState(closeDialog(state));
  try {
    await deletePatient(id);
    await reloadPatients({ kind: 'info', text: '削除しました。' });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを削除できませんでした。' }));
  } finally {
    deletingPatientIds.delete(id);
  }
}

/** 「⋯」メニューを開く。閉じたとき、この行の「⋯」へフォーカスを戻すため、idを覚えておく。 */
function openMenu(id: string): void {
  dialogReturnId = id;
  setState(openRowMenu(state, id));
}

function closeAnyDialog(): void {
  setState(closeDialog(state));
}

function handleEdit(id: string): void {
  dialogReturnId = null;
  formDraft = null;
  setState(withScreen(state, { name: 'form', patientId: id }));
}

/** 名前と住所を写した状態の、新規登録フォームを開く(保存すると別の訪問先になる)。 */
function handleDuplicate(id: string): void {
  const source = state.patients.find((patient) => patient.id === id);
  if (!source) {
    closeAnyDialog();
    return;
  }
  dialogReturnId = null;
  formDraft = { name: source.name, address: source.address };
  setState(withScreen(state, { name: 'form', patientId: null }));
}

/** 選択バーの「訪問順を決める →」。 */
function handleNext(): void {
  const validation = validateSelection(state.selectedIds.length);
  if (!validation.ok) {
    setState(withMessage(state, { kind: 'error', text: validation.message }));
    return;
  }
  setState(withScreen(state, { name: 'order' }));
}

/** 下部のタブに出す3つのステップのうち、今の画面がどれか。設定・登録の画面は null(タブを出さない)。 */
function currentStep(): Step | null {
  switch (state.screen.name) {
    case 'list':
    case 'order':
    case 'map':
      return state.screen.name;
    default:
      return null;
  }
}

function handleSelectStep(step: Step): void {
  if (step === currentStep()) {
    return;
  }
  // 訪問先を選ぶまでは、訪問順と地図へは進めない。
  if (step !== 'list' && !hasSelection(state)) {
    return;
  }
  setState(withScreen(state, { name: step }));
}
```

(e) `renderScreen`の`case 'list':`のブロック(`case 'form':`の直前まで)を、次で置き換える。

```ts
    case 'list':
      return renderPatientList(state, {
        onSearch: (query) => setState(setSearchQuery(state, query)),
        onClearSearch: () => {
          setState(setSearchQuery(state, ''));
          // クリアボタンは消えるので、検索欄へフォーカスを戻す。
          root!.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus();
        },
        onToggleSelect: (id) => {
          const next = toggleSelection(state, id);
          // 選択が実際に変わったときだけ、開いたルートの印を消す(上限で選べなかったときは変えない)。
          if (next.selectedIds !== state.selectedIds) {
            openedRoutes.clear();
          }
          setState(next);
        },
        onNew: () => {
          formDraft = null;
          setState(withScreen(state, { name: 'form', patientId: null }));
        },
        onOpenMenu: openMenu,
        onOpenSettings: () => setState(withScreen(state, { name: 'settings' })),
      });
```

(f) `renderScreen`関数の直後に、次の`renderApp`関数を追加する。

```ts
/** 画面本体に、下部の固定バー(選択バーとタブ)とダイアログを重ねて、アプリ全体を作る。 */
function renderApp(): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.append(renderScreen());

  const step = currentStep();
  if (step !== null) {
    const selectionBar =
      step === 'list' ? renderSelectionBar(state.selectedIds.length, { onNext: handleNext }) : null;
    // 固定バーに、内容の最後が隠れないよう、余白を取るクラスを付ける。
    shell.classList.add(selectionBar ? 'with-selection' : 'with-tabbar');

    const stack = document.createElement('div');
    stack.className = 'bottom-stack';
    if (selectionBar) {
      stack.append(selectionBar);
    }
    stack.append(renderTabBar(step, hasSelection(state), { onSelect: handleSelectStep }));
    shell.append(stack);
  }

  const dialog = renderDialog(state, {
    onEdit: handleEdit,
    onDuplicate: handleDuplicate,
    onRequestDelete: (id) => setState(openDeleteConfirm(state, id)),
    onConfirmDelete: (id) => {
      void handleDelete(id);
    },
    onClose: closeAnyDialog,
  });
  if (dialog) {
    shell.append(dialog);
  }
  return shell;
}
```

(g) `render`関数(直前の説明コメントを含む関数全体)を、次で置き換える。

```ts
/**
 * 画面全体を作り直すため、そのままでは検索欄に1文字打つたびにフォーカスが外れる。
 * 描画の前後でフォーカス位置を引き継ぐ。ダイアログは、開いたら最初のボタンへ、
 * 閉じたら開いた元の「⋯」へ、フォーカスを移す。
 */
function render(): void {
  const active = document.activeElement;
  const testid = active instanceof HTMLElement ? active.dataset.testid : undefined;
  const rowId = active instanceof HTMLElement ? active.dataset.id : undefined;
  const caret = active instanceof HTMLInputElement ? active.selectionStart : null;
  const hadDialog = root!.querySelector('[data-testid="dialog"]') !== null;

  root!.replaceChildren(renderApp());
  // ダイアログを開いている間は、背後をスクロールさせない。
  document.body.classList.toggle('dialog-open', state.dialog !== null);
  syncSession();

  const dialog = root!.querySelector<HTMLElement>('[data-testid="dialog"]');
  if (dialog) {
    dialog.querySelector<HTMLElement>('button')?.focus();
    return;
  }
  if (hadDialog && dialogReturnId !== null) {
    root!
      .querySelector<HTMLElement>(`[data-testid="row-menu"][data-id="${dialogReturnId}"]`)
      ?.focus();
    dialogReturnId = null;
    return;
  }

  if (testid === undefined) {
    return;
  }
  const selector =
    rowId === undefined
      ? `[data-testid="${testid}"]`
      : `[data-testid="${testid}"][data-id="${rowId}"]`;
  const restored = root!.querySelector<HTMLElement>(selector);
  if (!restored) {
    return;
  }
  restored.focus();
  if (restored instanceof HTMLInputElement && restored.type === 'text' && caret !== null) {
    restored.setSelectionRange(caret, caret);
  }
}
```

- [ ] **Step 6: `src/styles.css`を直す**

次の既存の規則を、すべて削除する: `#app`、`input[type='checkbox']`、`.row-between`、`.footer`、`.patient-list`、`.patient-row`、`.patient-body`、`.patient-name`、`.patient-address`。

末尾に追記する。

```css

/* ===== 訪問先を選ぶ画面 ===== */
input::placeholder {
  color: var(--muted);
  opacity: 1;
}

.list-head {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 0.5rem 0;
  background: var(--bg);
}

.list-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gap);
  min-height: 3rem;
}

.list-title {
  margin: 0;
  font-size: 1.375rem;
}

.icon-button {
  min-width: var(--tap-min);
  padding: 0;
  border: none;
  background: transparent;
  color: var(--primary);
  font-size: 1.5rem;
}

.search {
  position: relative;
}

.search input {
  padding-right: var(--tap-min);
}

.search-clear {
  position: absolute;
  top: 50%;
  right: 0;
  width: var(--tap-min);
  padding: 0;
  border: none;
  background: transparent;
  color: var(--muted);
  font-size: 1.5rem;
  transform: translateY(-50%);
}

.place-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: var(--gap) 0;
  padding: 0;
  list-style: none;
}

.place-row {
  display: flex;
  align-items: stretch;
  border: 1px solid var(--border);
  border-left: 4px solid transparent;
  border-radius: var(--radius);
  background: var(--surface);
  overflow: hidden;
}

/* 選択した行: 薄い青の背景・左の青いライン・チェックマークの3つで示す。 */
.place-row.selected {
  border-left-color: var(--primary);
  background: var(--primary-soft);
}

.place-row.disabled {
  opacity: 0.6;
}

.place-main {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
  min-height: 4rem;
  padding: 0.75rem;
  cursor: pointer;
}

.place-row.disabled .place-main {
  cursor: default;
}

.check {
  display: grid;
  flex: none;
  width: 1.75rem;
  height: 1.75rem;
  place-items: center;
  border: 2px solid var(--border-strong);
  border-radius: 0.5rem;
  background: var(--surface);
  color: var(--on-primary);
  font-weight: 700;
}

.place-row.selected .check {
  border-color: var(--primary);
  background: var(--primary);
}

.place-row.selected .check::after {
  content: '✓';
}

/* キーボードで選ぶときのフォーカスの枠は、見た目のチェックに出す。 */
input:focus-visible + .check {
  outline: 3px solid var(--primary);
  outline-offset: 2px;
}

.place-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.place-name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.place-address {
  display: -webkit-box;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.9375rem;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.more {
  flex: none;
  width: var(--tap-min);
  padding: 0;
  border: none;
  border-radius: 0;
  background: transparent;
  color: var(--muted);
  font-size: 1.5rem;
}
```

- [ ] **Step 7: すべて通す**

```bash
npm run test && npm run typecheck && npm run build
```

期待: すべてPASS。

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: 訪問先を選ぶ画面を作り直し、タブ・選択バー・ダイアログをつなぐ

行全体のタップで選択でき、選択は薄い青の背景・左のライン・チェックの3つで示す。
編集・複製・削除は「⋯」のメニューへ移し、削除は必ず確認を通す。検索欄にクリアボタンを付け、
選択件数と「訪問順を決める →」は下部の選択バーに固定する。下部のタブが有効になる。
選択の上限の文言を「人」から「件」に改める。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---
### Task 12: 訪問先の登録・編集フォーム

見出しの行に「キャンセル」と「保存」を置き、入力欄は名前と住所の2つにする。住所が空のときは保存できない(現在の動作を維持する)。

**Files:**
- Modify: `src/views/patientFormView.ts`(全体を置き換え)、`tests/patientFormView.test.ts`(全体を置き換え)、`src/validation.ts`、`tests/validation.test.ts`、`tests/main.test.ts`、`src/styles.css`

**Interfaces:**
- Consumes: `DEFAULT_MAP_PROVIDER`(Task 3)、`renderMessage`(Task 7)
- Produces:
  - `type PatientFormDraft = { name: string; address: string }`、`type PatientFormHandlers = { onSave(name: string, address: string): void; onCancel(): void }`(型は変えない)
  - `renderPatientForm(patient: Patient | null, draft: PatientFormDraft | null, message: Message | null, handlers: PatientFormHandlers): HTMLElement`(引数は変えない)
  - `data-testid`: `name-input`、`address-input`、`save-button`、`cancel-button`、`map-check-link`
  - 入力の検証メッセージ: 名前が空 →「名前を入力してください。」

- [ ] **Step 1: 失敗するテストを書く**

`tests/patientFormView.test.ts`を、次の内容で置き換える。既存のテストの振る舞い(下書き、地図確認リンク、role=status など)は、すべて引き継いでいる。

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import { renderPatientForm, type PatientFormHandlers } from '../src/views/patientFormView';

const handlers = (): PatientFormHandlers => ({ onSave: vi.fn(), onCancel: vi.fn() });

const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T =>
  element.querySelector<T>(`[data-testid="${testid}"]`)!;
const nameInput = (element: HTMLElement) => q<HTMLInputElement>(element, 'name-input');
const addressInput = (element: HTMLElement) => q<HTMLInputElement>(element, 'address-input');

describe('renderPatientForm: 見出しと入力欄', () => {
  it('新規登録では、見出しが「訪問先を登録」で、入力欄が空になる', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(element.querySelector('h1')?.textContent).toBe('訪問先を登録');
    expect(nameInput(element).value).toBe('');
    expect(addressInput(element).value).toBe('');
  });

  it('編集では、見出しが「訪問先を編集」で、既存の値が入る', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const element = renderPatientForm(patient, null, null, handlers());
    expect(element.querySelector('h1')?.textContent).toBe('訪問先を編集');
    expect(nameInput(element).value).toBe('山田 太郎');
    expect(addressInput(element).value).toBe('東京都千代田区1-1');
  });

  it('入力欄は、名前と住所の2つだけ', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const inputs = [...element.querySelectorAll('input')];
    expect(inputs).toHaveLength(2);
    expect(inputs.map((input) => input.dataset.testid)).toEqual(['name-input', 'address-input']);
  });

  it('名前と住所は、必須と分かる表示を持つ', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(element.querySelectorAll('.required')).toHaveLength(2);
    expect(nameInput(element).getAttribute('aria-required')).toBe('true');
    expect(addressInput(element).getAttribute('aria-required')).toBe('true');
  });

  it('入力欄のラベルは「名前」「住所」', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const labels = [...element.querySelectorAll('.field-label')].map((label) => label.textContent);
    expect(labels[0]).toContain('名前');
    expect(labels[1]).toContain('住所');
  });

  it('プレースホルダーに入力例を出す', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(nameInput(element).placeholder).toContain('山田');
    expect(addressInput(element).placeholder).toContain('東京都');
  });
});

describe('renderPatientForm: 保存とキャンセル', () => {
  it('見出しの行の左に「キャンセル」、右に「保存」がある', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const header = element.querySelector('.form-header')!;
    expect(header.firstElementChild).toBe(q(element, 'cancel-button'));
    expect(header.lastElementChild).toBe(q(element, 'save-button'));
    expect(q(element, 'cancel-button').textContent).toBe('キャンセル');
    expect(q(element, 'save-button').textContent).toBe('保存');
  });

  it('保存ボタンで、入力値が onSave に渡る', () => {
    const spies = handlers();
    const element = renderPatientForm(null, null, null, spies);
    nameInput(element).value = '鈴木 花子';
    addressInput(element).value = '大阪市北区2-2';
    q<HTMLButtonElement>(element, 'save-button').click();
    expect(spies.onSave).toHaveBeenCalledWith('鈴木 花子', '大阪市北区2-2');
  });

  it('キャンセルボタンで onCancel が呼ばれる', () => {
    const spies = handlers();
    const element = renderPatientForm(null, null, null, spies);
    q<HTMLButtonElement>(element, 'cancel-button').click();
    expect(spies.onCancel).toHaveBeenCalled();
  });
});

describe('renderPatientForm: 住所の地図での確認', () => {
  it('住所が空のとき、地図確認リンクは無効になる(href が無い)', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(q<HTMLAnchorElement>(element, 'map-check-link').hasAttribute('href')).toBe(false);
  });

  it('住所を入力すると、地図確認リンクが検索URLになる', () => {
    const element = renderPatientForm(null, null, null, handlers());
    const address = addressInput(element);
    address.value = '東京都千代田区1-1';
    address.dispatchEvent(new Event('input'));
    const url = new URL(q<HTMLAnchorElement>(element, 'map-check-link').href);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('query')).toBe('東京都千代田区1-1');
  });

  it('リンクの文言は、地図サービスの名前から作る', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(q(element, 'map-check-link').textContent).toBe('この住所をGoogleマップで確認');
  });

  it('地図確認リンクにタップ領域確保用のクラスがつく', () => {
    const element = renderPatientForm(null, null, null, handlers());
    expect(q(element, 'map-check-link').classList.contains('map-check')).toBe(true);
  });
});

describe('renderPatientForm: メッセージと下書き', () => {
  it('メッセージがあれば表示する', () => {
    const element = renderPatientForm(null, null, { kind: 'error', text: '名前を入力してください。' }, handlers());
    expect(element.querySelector('.message')?.textContent).toBe('名前を入力してください。');
  });

  it('メッセージ領域は VoiceOver に読み上げられるよう role=status を持つ', () => {
    const element = renderPatientForm(null, null, { kind: 'error', text: '名前を入力してください。' }, handlers());
    expect(element.querySelector('.message')?.getAttribute('role')).toBe('status');
  });

  it('draft があれば、新規登録でも patient より優先して表示する(入力内容を残す)', () => {
    const draft = { name: '入力途中の名前', address: '入力途中の住所' };
    const element = renderPatientForm(null, draft, null, handlers());
    expect(nameInput(element).value).toBe('入力途中の名前');
    expect(addressInput(element).value).toBe('入力途中の住所');
  });

  it('draft があれば、編集中の既存値より優先して表示する', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const draft = { name: '編集途中の名前', address: '' };
    const element = renderPatientForm(patient, draft, null, handlers());
    expect(nameInput(element).value).toBe('編集途中の名前');
    expect(addressInput(element).value).toBe('');
    // 見出しは draft ではなく patient の有無で決まる
    expect(element.querySelector('h1')?.textContent).toBe('訪問先を編集');
  });
});
```

`tests/validation.test.ts`の末尾に追加する。

```ts
describe('入力の文言(名前・住所)', () => {
  it('名前が空のとき「名前を入力してください。」', () => {
    expect(validatePatientInput('  ', '東京都')).toEqual({ ok: false, message: '名前を入力してください。' });
  });

  it('住所が空のとき「住所を入力してください。」', () => {
    expect(validatePatientInput('山田', '')).toEqual({ ok: false, message: '住所を入力してください。' });
  });
});
```

`tests/main.test.ts`の`起動直後の読み込み`のテストの期待を直す(2か所)。

```ts
    expect(el('.message')?.textContent).toContain('氏名を入力してください');
```
↓(2か所とも)
```ts
    expect(el('.message')?.textContent).toContain('名前を入力してください');
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/patientFormView.test.ts tests/validation.test.ts tests/main.test.ts
```

期待: FAIL(見出しが「新規登録」のまま、`.form-header`がない、メッセージが「氏名」のまま)。

- [ ] **Step 3: `src/validation.ts`の文言を直す**

```ts
    return { ok: false, message: '氏名を入力してください。' };
```
↓
```ts
    return { ok: false, message: '名前を入力してください。' };
```

- [ ] **Step 4: `src/views/patientFormView.ts`を置き換える**

```ts
import { DEFAULT_MAP_PROVIDER } from '../mapProviders';
import type { Message, Patient } from '../types';
import { renderMessage } from './common';

export type PatientFormDraft = { name: string; address: string };

export type PatientFormHandlers = {
  onSave(name: string, address: string): void;
  onCancel(): void;
};

/**
 * 訪問先の登録・編集フォーム。入力項目は名前と住所だけ。
 * 住所は地図へ渡すために欠かせないので、保存できるのは、名前と住所がそろっているときだけ(検証は呼び出し側)。
 *
 * `draft` は保存に失敗した直後の入力値(または複製元の値)。渡された場合は `patient` の値より
 * 優先して表示し、入力内容を画面に残す。
 */
export function renderPatientForm(
  patient: Patient | null,
  draft: PatientFormDraft | null,
  message: Message | null,
  handlers: PatientFormHandlers,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';

  const nameInput = textInput('name-input', draft?.name ?? patient?.name ?? '', '例) 山田 太郎');
  const addressInput = textInput(
    'address-input',
    draft?.address ?? patient?.address ?? '',
    '例) 東京都世田谷区桜丘1-2-3',
  );

  // 見出しの行: 左に「キャンセル」、中央に見出し、右に「保存」。
  const header = document.createElement('header');
  header.className = 'form-header';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'header-link cancel';
  cancel.dataset.testid = 'cancel-button';
  cancel.textContent = 'キャンセル';
  cancel.addEventListener('click', () => handlers.onCancel());

  const title = document.createElement('h1');
  title.className = 'screen-title';
  title.textContent = patient === null ? '訪問先を登録' : '訪問先を編集';

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'header-link save';
  save.dataset.testid = 'save-button';
  save.textContent = '保存';
  save.addEventListener('click', () => handlers.onSave(nameInput.value, addressInput.value));

  header.append(cancel, title, save);
  container.append(header);

  if (message) {
    container.append(renderMessage(message));
  }

  container.append(field('名前', nameInput), field('住所', addressInput), renderMapCheck(addressInput));
  return container;
}

function textInput(testid: string, value: string, placeholder: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = 'off';
  input.dataset.testid = testid;
  input.setAttribute('aria-required', 'true');
  return input;
}

/** ラベル(名前と「必須」の表示)で入力欄を包む。 */
function field(labelText: string, input: HTMLInputElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'field';

  const caption = document.createElement('span');
  caption.className = 'field-label';
  caption.append(document.createTextNode(labelText));
  const required = document.createElement('span');
  required.className = 'required';
  required.textContent = '必須';
  caption.append(required);

  label.append(caption, input);
  return label;
}

/** 入力した住所を、地図サービスで確認するためのリンク。住所が空のあいだは、押せない。 */
function renderMapCheck(addressInput: HTMLInputElement): HTMLAnchorElement {
  const link = document.createElement('a');
  link.textContent = `この住所を${DEFAULT_MAP_PROVIDER.label}で確認`;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.dataset.testid = 'map-check-link';
  link.className = 'map-check';

  const update = (): void => {
    const address = addressInput.value.trim();
    if (address.length === 0) {
      link.removeAttribute('href');
      link.classList.add('disabled');
      return;
    }
    link.href = DEFAULT_MAP_PROVIDER.buildUrl([address]);
    link.classList.remove('disabled');
  };
  update();
  addressInput.addEventListener('input', update);
  return link;
}
```

- [ ] **Step 5: `src/styles.css`を直す**

次の既存の規則を削除する: `.field`、`.field input`、`.actions`。

`a.disabled`と`.map-check`の規則を、次で置き換える。

```css
a.disabled {
  color: var(--muted);
  pointer-events: none;
  text-decoration: none;
}

.map-check {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap-min);
  color: var(--primary);
}
```

末尾に追記する。

```css

/* ===== 訪問先の登録・編集フォーム ===== */
.form-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.5rem;
  min-height: 3.5rem;
  margin-bottom: 0.5rem;
}

.header-link {
  padding: 0 0.5rem;
  border: none;
  background: transparent;
  color: var(--primary);
  font-weight: 600;
}

.header-link.cancel {
  justify-self: start;
}

.header-link.save {
  justify-self: end;
  font-weight: 700;
}

.field {
  display: block;
  margin-bottom: var(--gap);
}

.field-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  font-weight: 600;
}

.required {
  padding: 0 0.5rem;
  border-radius: 0.375rem;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 0.875rem;
  font-weight: 600;
}
```

- [ ] **Step 6: すべて通す**

```bash
npm run test && npm run typecheck && npm run build
```

期待: すべてPASS。

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: 訪問先の登録・編集フォームを作り直す

見出しの行に「キャンセル」と「保存」を置き、入力は名前と住所の2つだけにする。
どちらも必須と表示し、入力例を出す。住所の確認リンクは地図サービスの名前から作る。
検証メッセージの「氏名」を「名前」に改める。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: 設定画面

今ある書き出し・読み込みの機能をそのまま残し、他の画面と見た目をそろえ、文言を直す。

**Files:**
- Modify: `src/views/settingsView.ts`(全体を置き換え)、`tests/settingsView.test.ts`(全体を置き換え)、`src/styles.css`

**Interfaces:**
- Consumes: `renderScreenHeader`・`renderMessage`(Task 7)
- Produces:
  - `type SettingsHandlers = { onExport(): void; onImport(file: File, mode: 'replace' | 'merge'): void; onBack(): void }`(型は変えない)
  - `renderSettings(state: AppState, handlers: SettingsHandlers): HTMLElement`(引数は変えない)
  - `data-testid`: `export-button`、`import-input`、`import-button`、`mode-replace`、`mode-merge`、`back-button`

- [ ] **Step 1: 失敗するテストを書く**

`tests/settingsView.test.ts`を、次の内容で置き換える。既存のテストの振る舞いは、すべて引き継いでいる。

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import { createInitialState } from '../src/state';
import { renderSettings, type SettingsHandlers } from '../src/views/settingsView';

const handlers = (): SettingsHandlers => ({
  onExport: vi.fn(),
  onImport: vi.fn(),
  onBack: vi.fn(),
});

const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T =>
  element.querySelector<T>(`[data-testid="${testid}"]`)!;

function attachFile(element: HTMLElement, file: File): void {
  Object.defineProperty(q(element, 'import-input'), 'files', { value: [file], configurable: true });
}

describe('renderSettings: 全体', () => {
  it('見出しは「設定」で、戻るボタンがある', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    expect(element.querySelector('h1')?.textContent).toBe('設定');
    q<HTMLButtonElement>(element, 'back-button').click();
    expect(spies.onBack).toHaveBeenCalledTimes(1);
  });

  it('登録件数を「登録されている訪問先: N件」で表示する', () => {
    const state = createInitialState([createPatient('山田', '東京都'), createPatient('鈴木', '大阪府')]);
    const element = renderSettings(state, handlers());
    expect(element.textContent).toContain('登録されている訪問先: 2件');
  });

  it('メッセージがあれば表示する', () => {
    const state = { ...createInitialState([]), message: { kind: 'info' as const, text: '2件を取り込みました。' } };
    const element = renderSettings(state, handlers());
    expect(element.querySelector('.message')?.textContent).toBe('2件を取り込みました。');
  });

  it('メッセージ領域は VoiceOver に読み上げられるよう role=status を持つ', () => {
    const state = { ...createInitialState([]), message: { kind: 'info' as const, text: '2件を取り込みました。' } };
    const element = renderSettings(state, handlers());
    expect(element.querySelector('.message')?.getAttribute('role')).toBe('status');
  });
});

describe('renderSettings: 書き出し', () => {
  it('エクスポートボタンで onExport が呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    q<HTMLButtonElement>(element, 'export-button').click();
    expect(spies.onExport).toHaveBeenCalled();
  });

  it('説明に「訪問先」の言葉を使う', () => {
    const element = renderSettings(createInitialState([]), handlers());
    expect(element.textContent).toContain('訪問先のデータをJSONファイルとして保存します。');
  });
});

describe('renderSettings: 読み込み', () => {
  it('ファイル未選択でインポートを押しても、何も起きない', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    q<HTMLButtonElement>(element, 'import-button').click();
    expect(spies.onImport).not.toHaveBeenCalled();
  });

  it('既定では、今のデータを消して入れ替える(replace)モードでインポートする', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    attachFile(element, file);
    q<HTMLButtonElement>(element, 'import-button').click();
    expect(spies.onImport).toHaveBeenCalledWith(file, 'replace');
  });

  it('追加(merge)モードを選ぶと、merge で呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    attachFile(element, file);
    q<HTMLInputElement>(element, 'mode-merge').checked = true;
    q<HTMLButtonElement>(element, 'import-button').click();
    expect(spies.onImport).toHaveBeenCalledWith(file, 'merge');
  });

  it('読み込み方法の選択肢は、グループの名前(legend)を持つ', () => {
    const element = renderSettings(createInitialState([]), handlers());
    const group = element.querySelector('fieldset.modes')!;
    expect(group.querySelector('legend')?.textContent).toBe('読み込み方法');
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2);
  });

  it('ファイル選択欄に名前(aria-label)を付ける', () => {
    const element = renderSettings(createInitialState([]), handlers());
    expect(q(element, 'import-input').getAttribute('aria-label')).toBe('バックアップファイルを選ぶ');
  });
});
```

- [ ] **Step 2: 失敗を確認する**

```bash
npx vitest run tests/settingsView.test.ts
```

期待: FAIL(見出しがない、文言が「患者」のまま、`fieldset.modes`がない)。

- [ ] **Step 3: `src/views/settingsView.ts`を置き換える**

```ts
import type { AppState } from '../types';
import { renderMessage, renderScreenHeader } from './common';

export type SettingsHandlers = {
  onExport(): void;
  onImport(file: File, mode: 'replace' | 'merge'): void;
  onBack(): void;
};

/** 設定画面。登録件数の表示と、バックアップの書き出し・読み込み。 */
export function renderSettings(state: AppState, handlers: SettingsHandlers): HTMLElement {
  const container = document.createElement('div');
  container.className = 'screen';
  container.append(renderScreenHeader('設定', { onBack: handlers.onBack }));

  if (state.message) {
    container.append(renderMessage(state.message));
  }

  const count = document.createElement('p');
  count.className = 'hint';
  count.textContent = `登録されている訪問先: ${state.patients.length}件`;
  container.append(count, renderExport(handlers), renderImport(handlers));
  return container;
}

function renderExport(handlers: SettingsHandlers): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card';

  const heading = document.createElement('h2');
  heading.textContent = 'バックアップの書き出し';
  const note = document.createElement('p');
  note.textContent = '訪問先のデータをJSONファイルとして保存します。';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary block';
  button.dataset.testid = 'export-button';
  button.textContent = 'エクスポート';
  button.addEventListener('click', () => handlers.onExport());

  card.append(heading, note, button);
  return card;
}

function renderImport(handlers: SettingsHandlers): HTMLElement {
  const card = document.createElement('section');
  card.className = 'card';

  const heading = document.createElement('h2');
  heading.textContent = 'バックアップの読み込み';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.dataset.testid = 'import-input';
  fileInput.setAttribute('aria-label', 'バックアップファイルを選ぶ');

  const replaceRadio = radio('replace', 'mode-replace', ' 今のデータを消して入れ替える');
  replaceRadio.input.checked = true;
  const mergeRadio = radio('merge', 'mode-merge', ' 今のデータに追加する');

  const modes = document.createElement('fieldset');
  modes.className = 'modes';
  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = '読み込み方法';
  modes.append(legend, replaceRadio.label, mergeRadio.label);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'block';
  button.dataset.testid = 'import-button';
  button.textContent = 'インポート';
  button.addEventListener('click', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    handlers.onImport(file, mergeRadio.input.checked ? 'merge' : 'replace');
  });

  card.append(heading, fileInput, modes, button);
  return card;
}

function radio(
  value: string,
  testid: string,
  text: string,
): { input: HTMLInputElement; label: HTMLLabelElement } {
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'import-mode';
  input.value = value;
  input.dataset.testid = testid;
  const label = document.createElement('label');
  label.append(input, document.createTextNode(text));
  return { input, label };
}
```

- [ ] **Step 4: `src/styles.css`を直す**

`.modes`と`.modes label`の既存の規則を、次で置き換える。

```css
.modes {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin: 0.75rem 0;
  padding: 0;
  border: 0;
}

.modes label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: var(--tap-min);
}
```

- [ ] **Step 5: すべて通す**

```bash
npm run test && npm run typecheck && npm run build
```

期待: すべてPASS。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: 設定画面を、他の画面と見た目をそろえて作り直す

書き出し・読み込み(入れ替え/追加の選択を含む)の機能はそのまま残し、
見出しと戻るボタン、カード表示にする。文言を「訪問先」に改める。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: 仕上げ(用語の検査・整理・READMEと、実際の画面での確認)

**Files:**
- Create: `tests/wording.test.ts`
- Modify: `tests/styles.test.ts`、`src/styles.css`、`README.md`

**Interfaces:**
- Consumes: すべての画面と部品
- Produces: 画面の文言に禁止語が出ないことを守るテスト、文字の大きさのテスト、更新したREADME

- [ ] **Step 1: 用語のテストを書く**

`tests/wording.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_SELECTION } from '../src/config';
import { createPatient } from '../src/patient';
import {
  createInitialState,
  openDeleteConfirm,
  openRowMenu,
  setSearchQuery,
  toggleSelection,
} from '../src/state';
import type { AppState, Patient } from '../src/types';
import { validatePatientInput, validateSelection } from '../src/validation';
import { googleMapsProvider } from '../src/mapProviders';
import { renderDialog } from '../src/views/dialogs';
import { renderPatientForm } from '../src/views/patientFormView';
import { renderPatientList } from '../src/views/patientListView';
import { renderRouteMap } from '../src/views/routeMapView';
import { renderRouteOrder } from '../src/views/routeOrderView';
import { renderSelectionBar } from '../src/views/selectionBar';
import { renderSettings } from '../src/views/settingsView';
import { renderTabBar } from '../src/views/tabBar';

// 画面に出してはいけない、業種特有の表現と、以前のアプリ名。
const FORBIDDEN = ['患者', '薬局', '在宅', '医療', '利用者', 'ルート自動入力'];

function expectClean(label: string, text: string): void {
  for (const word of FORBIDDEN) {
    expect(text, `${label} に「${word}」が含まれている`).not.toContain(word);
  }
}

const noop = () => undefined;
const listHandlers = {
  onSearch: noop,
  onClearSearch: noop,
  onToggleSelect: noop,
  onNew: noop,
  onOpenMenu: noop,
  onOpenSettings: noop,
};
const dialogHandlers = {
  onEdit: noop,
  onDuplicate: noop,
  onRequestDelete: noop,
  onConfirmDelete: noop,
  onClose: noop,
};

function places(count: number): Patient[] {
  return Array.from({ length: count }, (_, i) => createPatient(`場所${i + 1}`, `東京都${i + 1}-1`));
}

function selected(patients: Patient[]): AppState {
  return { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
}

describe('画面の文言(禁止語が出ない)', () => {
  it('一覧: 空・通常・選択・検索なし・上限・メッセージ・検索語あり', () => {
    const many = places(MAX_SELECTION + 1);
    let atLimit = createInitialState(many);
    for (const place of many.slice(0, MAX_SELECTION)) {
      atLimit = toggleSelection(atLimit, place.id);
    }
    const states: AppState[] = [
      createInitialState([]),
      createInitialState(places(3)),
      toggleSelection(createInitialState(places(3)), places(3)[0]!.id),
      setSearchQuery(createInitialState(places(3)), 'どこにもない'),
      setSearchQuery(createInitialState(places(3)), '場所'),
      atLimit,
      { ...createInitialState(places(1)), message: { kind: 'error', text: 'x' } },
    ];
    states.forEach((state, index) => {
      expectClean(`一覧#${index}`, renderPatientList(state, listHandlers).outerHTML);
    });
  });

  it('ダイアログ: 「⋯」メニュー・削除の確認', () => {
    const patients = places(1);
    const base = createInitialState(patients);
    expectClean('メニュー', renderDialog(openRowMenu(base, patients[0]!.id), dialogHandlers)!.outerHTML);
    expectClean('削除の確認', renderDialog(openDeleteConfirm(base, patients[0]!.id), dialogHandlers)!.outerHTML);
  });

  it('登録・編集フォーム: 新規・編集・下書き・メッセージ', () => {
    const handlers = { onSave: noop, onCancel: noop };
    const patient = createPatient('場所1', '東京都1-1');
    expectClean('新規', renderPatientForm(null, null, null, handlers).outerHTML);
    expectClean('編集', renderPatientForm(patient, null, null, handlers).outerHTML);
    expectClean('下書き', renderPatientForm(null, { name: 'a', address: 'b' }, null, handlers).outerHTML);
    expectClean(
      'メッセージ',
      renderPatientForm(null, null, { kind: 'error', text: 'x' }, handlers).outerHTML,
    );
  });

  it('訪問順: 0件・1件・複数件・同じ住所', () => {
    const handlers = { onMove: noop, onAddStops: noop, onOpenMap: noop, onBack: noop };
    const same = places(2).map((place) => ({ ...place, address: '東京都1-1' }));
    for (const [label, state] of [
      ['0件', createInitialState([])],
      ['1件', selected(places(1))],
      ['3件', selected(places(3))],
      ['同じ住所', selected(same)],
    ] as const) {
      expectClean(`訪問順(${label})`, renderRouteOrder(state, handlers).outerHTML);
    }
  });

  it('地図: 0件・1本・分割・開いた後', () => {
    const handlers = { onOpenRoute: noop, onBack: noop, onChooseStops: noop };
    const at = new Date(2026, 8, 21, 14, 32).toISOString();
    for (const [label, state, opened] of [
      ['0件', createInitialState([]), new Map<number, string>()],
      ['1本', selected(places(3)), new Map<number, string>()],
      ['分割', selected(places(12)), new Map<number, string>()],
      ['開いた後', selected(places(12)), new Map<number, string>([[0, at]])],
    ] as const) {
      expectClean(`地図(${label})`, renderRouteMap(state, opened, googleMapsProvider, handlers).outerHTML);
    }
  });

  it('設定・タブ・選択バー', () => {
    expectClean(
      '設定',
      renderSettings(createInitialState(places(2)), { onExport: noop, onImport: noop, onBack: noop }).outerHTML,
    );
    expectClean('タブ', renderTabBar('list', true, { onSelect: noop }).outerHTML);
    expectClean('選択バー', renderSelectionBar(3, { onNext: noop })!.outerHTML);
  });

  it('検証メッセージ', () => {
    for (const result of [
      validatePatientInput('', 'x'),
      validatePatientInput('x', ''),
      validateSelection(0),
      validateSelection(MAX_SELECTION + 1),
    ]) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expectClean('検証メッセージ', result.message);
      }
    }
  });
});

describe('ソースコード中の文字列(禁止語が出ない)', () => {
  // src 配下の全ての .ts を、文字列として読む。コメントは除いて、文字列リテラルだけを調べる。
  const sources = import.meta.glob('../src/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  function stringLiterals(source: string): string[] {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const pattern = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
    return withoutComments.match(pattern) ?? [];
  }

  it('画面に出る文字列に、禁止語を使っていない', () => {
    const entries = Object.entries(sources);
    expect(entries.length).toBeGreaterThan(10);
    for (const [path, source] of entries) {
      for (const literal of stringLiterals(source)) {
        expectClean(`${path} の文字列 ${literal}`, literal);
      }
    }
  });
});
```

- [ ] **Step 2: 文字の大きさと整理のテストを足す**

`tests/styles.test.ts`の末尾に追加する。

```ts
describe('文字の大きさ', () => {
  it('どの文字も、14px(0.875rem)未満にしない', () => {
    for (const match of css.matchAll(/font-size:\s*([0-9.]+)rem/g)) {
      expect(Number(match[1]), match[0]).toBeGreaterThanOrEqual(0.875);
    }
  });

  it('入力欄は16px以上(iOSのSafariで、入力時に画面が拡大されない)', () => {
    expect(css).toMatch(/input\[type='text'\][^}]*font-size:\s*1rem/s);
  });
});

describe('整理', () => {
  it('使われなくなった別名 --accent が残っていない', () => {
    expect(css).not.toContain('--accent');
  });
});
```

- [ ] **Step 3: 失敗を確認する**

```bash
npx vitest run tests/wording.test.ts tests/styles.test.ts
```

期待: `wording.test.ts`は、これまでのタスクで文言を直し終えていれば、通る。`styles.test.ts`の「別名 --accent」だけが FAIL する。もし`wording.test.ts`が失敗したら、その画面・文字列に禁止語が残っているので、Step 4の前に、該当箇所の文言を「訪問先」などに直す(画面の文言だけ。識別子とコメントは変えない)。

- [ ] **Step 4: `--accent`を整理する**

`src/styles.css`で、`var(--accent)`を使っている箇所があれば`var(--primary)`に置き換え、`:root`の次の2行(コメントと定義)を削除する。

```css
  /* 既存の画面用の規則が使っている別名。使われなくなったら消す。 */
  --accent: var(--primary);
```

確認する。

```bash
grep -n "accent" src/styles.css
```

期待: 出力なし。

- [ ] **Step 5: 使われていないCSSのクラスを探して、消す**

```bash
node -e "
const fs = require('fs');
const css = fs.readFileSync('src/styles.css', 'utf8');
const sources = fs.readdirSync('src/views').map((f) => fs.readFileSync('src/views/' + f, 'utf8'))
  .concat(fs.readFileSync('src/main.ts', 'utf8')).join('\n');
const names = [...new Set([...css.matchAll(/\.([a-z][a-z0-9-]*)/g)].map((m) => m[1]))];
console.log('未使用の可能性があるクラス:', names.filter((n) => !sources.includes(n)));
"
```

期待: `[]`。何か出たら、そのクラスを使っていないか(ソースを検索して)確かめたうえで、`src/styles.css`の該当する規則を削除する。

- [ ] **Step 6: `README.md`を置き換える**

```markdown
# 訪問ルート作成

複数の訪問先を選び、訪問順を決めて、地図アプリ(Googleマップ)でルートを開くWebアプリ(PWA)です。
iPad・iPhone・PCのブラウザで使えます。ホーム画面に追加すると、アプリのように起動できます。

## 使い方(3ステップ)

1. **訪問先を選ぶ** — 名前と住所を登録しておき、行をタップして選びます。名前・住所で検索できます。
2. **訪問順を決める** — ▲▼で順番を入れ替えます。
3. **地図を開く** — 「この順番で地図を開く」から、Googleマップでルートを開きます。
   地点が多いときは、ルートが自動で分かれます。次に開くルートが青く目立ちます。

## データの扱い

- 訪問先のデータは、お使いの端末のブラウザ内(IndexedDB)にのみ保存されます。サーバーへは送信しません。
- GitHubに公開されるのはアプリの画面だけで、訪問先のデータは含まれません。
- 地図を開くときだけ、必要な住所が、URLとしてGoogleマップへ渡されます。
- Safariの「Webサイトデータを消去」を行うとデータは消えます。設定画面から定期的にエクスポートしてください。

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm run test       # テスト
npm run typecheck  # 型チェック
npm run build      # 本番ビルド
npm run icons      # assets/icon.svg から PWA アイコンを生成
```

アプリ名は `src/appInfo.ts` の `APP_NAME` の1か所で決まります(画面の見出し、`<title>`、ホーム画面の名前、マニフェスト)。
地図サービスは `src/mapProviders.ts` の `MapProvider` で差し替えられます。

## 公開の手順(初回のみ)

1. github.com で `route-auto-input` という名前のリポジトリを作る。
   **無料アカウントでGitHub Pagesを使うにはPublic(公開)にする必要がある。**
   公開されるのはアプリのコードだけで、訪問先のデータは含まれない。
2. GitHubのリポジトリ → Settings → Pages → Build and deployment → Source を
   **GitHub Actions** に変更する(空のリポジトリでも設定できる)。
3. 手元のリポジトリを繋いで push する。

   ```bash
   git branch -M main
   git remote add origin https://github.com/<GitHubユーザー名>/route-auto-input.git
   git push -u origin main
   ```

4. Actions タブでデプロイの完了を待つ。
   **手順2を先に済ませていても、初回の実行が失敗(赤いX)になることがある。**
   その場合はActionsタブから失敗したワークフローを開き、「Re-run jobs」で
   再実行すれば通常は成功する。
5. `https://<GitHubユーザー名>.github.io/route-auto-input/` が公開URL。

以降は `main` に push するたびに自動で公開される。

## ホーム画面への追加

1. SafariでREADMEの公開URLを開く。
2. 共有ボタン → 「ホーム画面に追加」。
3. ホーム画面のアイコンから起動する。

すでにホーム画面に追加してある場合、アイコンの名前は、追加し直すまで古いままです。

## 経由地の上限について

Googleマップの公式仕様では、経路URLの経由地の上限は
「モバイルブラウザで3件、それ以外で9件」と、リンクを開く環境によって変わる。

本アプリは確実に動く 5地点(出発地1 + 経由地3 + 到着地1)を1ルートの上限とし、
それを超える件数を選んだ場合はルートを自動で分割する。

上限は `src/config.ts` の `MAX_STOPS_PER_ROUTE` だけで決まる。
下の実機テストで経由地9件が通ることを確認できたら、この値を `10` に変えると
10件が1本のルートで開くようになる。

## 実機テスト(iPad・iPhoneで一度行う)

- [ ] Safariで公開URLを開き、「ホーム画面に追加」ができる(名前は「訪問ルート作成」)
- [ ] ホーム画面のアイコンから起動すると、アドレスバーのない(standalone)表示になる
- [ ] 下部のタブと選択バーが、ホームインジケータと重ならない
- [ ] 横向きにしても崩れない
- [ ] 訪問先を登録でき、Safariを完全に終了して再起動してもデータが残っている
- [ ] 行全体をタップして選択できる。「⋯」から編集・複製して登録・削除ができ、削除の前に確認が出る
- [ ] 検索欄でひらがなを入力して、漢字に変換できる(キーボードが出ても、下部のバーが邪魔にならない)
- [ ] 2件を選び、順番を入れ替えて、Googleマップが正しい経路で開く
- [ ] **10件を選び、分割されたルートがそれぞれ正しく開く**(本数は`MAX_STOPS_PER_ROUTE`により変わる)
- [ ] ルートを開いてから戻ると、次に開くルートが目立っている
- [ ] **経由地9件のURLを直接Safariに貼り付け、11地点の経路が表示できるか確認する**
      (表示できたら `MAX_STOPS_PER_ROUTE` を10に変更し、10件が1本で開くことを再確認する)
- [ ] Googleマップアプリを削除した状態でもWeb版が開く
- [ ] エクスポートしたファイルをインポートし直すと同じ一覧に戻る
- [ ] 機内モードでもアプリの画面自体は開く
- [ ] 更新のあとも、これまでに登録した訪問先がそのまま残っている

## ドキュメント

- 設計: `docs/superpowers/specs/2026-09-02-route-auto-input-design.md`、`docs/superpowers/specs/2026-09-21-ui-redesign-design.md`
- 実装計画: `docs/superpowers/plans/2026-09-02-route-auto-input.md`、`docs/superpowers/plans/2026-09-21-ui-redesign.md`
```

- [ ] **Step 7: すべて通す**

```bash
npm run test && npm run typecheck && npm run build
```

期待: すべてPASS。ビルドの後、次を確認する。

```bash
ls dist
grep -o '"name":"[^"]*"' dist/manifest.webmanifest
grep -c "viewport-fit=cover" dist/index.html
```

期待: `dist`に`index.html`、`manifest.webmanifest`、`sw.js`、3つのPNGがある。マニフェストの名前は「訪問ルート作成」。`viewport-fit=cover`は`1`。

- [ ] **Step 8: 実際の画面で確認する**

ビルドした画面を、幅を変えて実際に表示し、崩れがないかを確かめる。ブラウザの操作には、ブラウザ用のツール(`mcp__Claude_Browser__*`)を使う。

1. プレビューのサーバーを、バックグラウンドで起動する。

   ```bash
   npm run preview -- --port 4173
   ```

2. ブラウザで`http://localhost:4173/route-auto-input/`を開く(`preview_start`に`url`を渡す)。最初に開いたときに、データベースが作られる。
3. ページの中で、次のJavaScriptを実行して、9件の訪問先を登録し、ページを再読み込みする(`javascript_tool`)。

   ```js
   await new Promise((resolve, reject) => {
     const open = indexedDB.open('route-auto-input', 1);
     open.onsuccess = () => {
       const db = open.result;
       const tx = db.transaction('patients', 'readwrite');
       const store = tx.objectStore('patients');
       const names = ['山田 太郎', '佐藤 花子', '鈴木 一郎', '高橋 美咲', '田中 健二', '伊藤 裕子', '渡辺 直樹', '中村 京子', '加藤 大輔'];
       names.forEach((name, i) => {
         const at = new Date(Date.now() - i * 60000).toISOString();
         store.put({ id: crypto.randomUUID(), name, address: `東京都世田谷区桜丘${i + 1}-2-3 サンプルマンション${100 + i}号室`, createdAt: at, updatedAt: at });
       });
       tx.oncomplete = () => { db.close(); resolve(); };
       tx.onerror = () => reject(tx.error);
     };
     open.onerror = () => reject(open.error);
   });
   location.reload();
   ```

4. 次の4つの幅で、それぞれ確認する(`resize_window`。375は`mobile`、768は`tablet`、1024×768と1280×800は幅と高さを指定する)。**各幅で、次の操作をして、スクリーンショットを撮る。**
   - 訪問先を選ぶ画面で、3件を選ぶ(選択バーとタブが出る)
   - 一番下までスクロールして、最後の行が選択バーやタブに隠れていないか
   - 「⋯」メニューと、削除の確認
   - 「訪問順を決める →」で訪問順の画面、「この順番で地図を開く →」で地図の画面
   - 9件をすべて選んで、地図の画面でルートが分割されること(2本のカード、最初が「次に開く」)
   - 登録フォーム、設定画面

5. 各幅で、次のJavaScriptを実行して、結果を記録する。

   ```js
   ({
     横スクロールがない: document.documentElement.scrollWidth <= window.innerWidth,
     幅: window.innerWidth,
     内容の幅: document.querySelector('.app-shell')?.getBoundingClientRect().width,
     下部バーの下端が画面の下端: (() => {
       const stack = document.querySelector('.bottom-stack');
       return stack ? Math.round(stack.getBoundingClientRect().bottom) === window.innerHeight : null;
     })(),
     最後の行が下部バーに隠れていない: (() => {
       window.scrollTo(0, document.body.scrollHeight);
       const rows = document.querySelectorAll('.place-row');
       const stack = document.querySelector('.bottom-stack');
       if (!rows.length || !stack) return null;
       return rows[rows.length - 1].getBoundingClientRect().bottom <= stack.getBoundingClientRect().top + 1;
     })(),
   })
   ```

6. **崩れ(はみ出し、重なり、読めない文字、押しにくいボタン)が見つかったら、`src/styles.css`を直す。** 直した内容と、直した理由をレポートに書く。CSS以外(画面の構造や振る舞い)を直す必要が出たら、直さずに、レポートに書いて止める。
7. 確認が終わったら、ウィンドウの大きさを`desktop`に戻し(`resize_window`の`preset: 'desktop'`)、プレビューのサーバーを止める。

- [ ] **Step 9: コミット**

```bash
git add -A
git commit -m "chore: 用語の検査・整理・READMEの更新と、実画面での確認

画面の文言に「患者」「薬局」「在宅」「医療」「利用者」が出ないことをテストで守る。
文字の大きさ(14px以上)のテストを足し、使われなくなった別名とCSSを整理する。
READMEを新しい用語と使い方に改める。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## 完了の定義

- `npm run test`、`npm run typecheck`、`npm run build`がすべて通る(テスト件数は、着手前の154件より増えている)
- 画面の文言に「患者」「薬局」「在宅」「医療」「利用者」が出ない(`tests/wording.test.ts`で守る)
- 3つのステップ(訪問先を選ぶ → 訪問順を決める → 地図を開く)を、下部のタブで行き来できる
- 375px、768px、1024px、1280pxの表示で崩れがない(Task 14のStep 8の記録がある)
- 既存のデータ(バージョン1のIndexedDB)が、そのまま読める
- 実機(iPad・iPhone)で確認する項目が、READMEの「実機テスト」にそろっている
