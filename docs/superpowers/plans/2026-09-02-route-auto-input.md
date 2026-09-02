# ルート自動入力 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 患者の氏名・住所を端末内に登録し、1〜10人を選んで訪問順を整え、Googleマップの経路画面へ渡すPWAをiPad向けに作る。

**Architecture:** サーバーを持たない完全クライアントサイドのPWA。純粋関数(ルート分割・URL生成・検証・バックアップ・状態遷移)を`src/`直下に置き、DOMを触る描画関数を`src/views/`に分ける。永続化はIndexedDBに限定し、UIから`src/db.ts`経由でのみ触る。

**Tech Stack:** Vite + TypeScript(UIフレームワークなし)、`idb`(IndexedDB)、Vitest + jsdom + fake-indexeddb、vite-plugin-pwa、GitHub Pages。

**Spec:** `docs/superpowers/specs/2026-09-02-route-auto-input-design.md`

## Global Constraints

- 患者の氏名・住所を端末外へ送信しない。サーバー通信・分析SDK・外部APIを追加しない。ネットワーク通信は、ユーザーが押した「Googleマップで開く」の遷移のみ。
- 氏名・住所を`console`へ出力しない。例外メッセージにも含めない(件数や項目名で表現する)。
- APIキーを一切使わない。
- 実行時依存(dependencies)は`idb`のみ。それ以外はすべてdevDependenciesに置く。
- URLの組み立ては`URL`と`URLSearchParams`のみを使う。手作業のパーセントエンコードは禁止。
- `MAX_STOPS_PER_ROUTE`と`MAX_SELECTION`は`src/config.ts`の1か所だけで定義し、他のファイルではimportして使う。
- タップ領域は44px以上。文字サイズは`rem`指定。
- PWAの表示名は「ルート自動入力」。リポジトリ名・フォルダ名は`route-auto-input`。GitHub Pagesのbaseパスは`/route-auto-input/`。
- 訪問順の自動最適化は行わない。ユーザーが決めた順番を保つ。
- 作業ディレクトリは`C:\Users\owner\Desktop\route-auto-input`。Node v24 / npm 11 / git 2.55 が導入済み。GitHub CLI(`gh`)は未導入のため、GitHub上の操作はブラウザで行う。

---

## File Structure

| ファイル | 責務 |
|---|---|
| `index.html` | エントリHTML。`#app`と`apple-touch-icon`のみ |
| `vite.config.ts` | baseパス、Vitest設定、PWA設定 |
| `src/main.ts` | 状態の保持、画面の描画切り替え、DBとの接続 |
| `src/types.ts` | `Patient`、`AppState`などの型 |
| `src/config.ts` | `MAX_STOPS_PER_ROUTE`、`MAX_SELECTION` |
| `src/patient.ts` | 患者オブジェクトの生成・更新(純粋関数) |
| `src/routeSplitter.ts` | 訪問先をルートへ分割(純粋関数) |
| `src/googleMapsUrl.ts` | Googleマップ用URLの生成(純粋関数) |
| `src/validation.ts` | 入力・選択の検証(純粋関数) |
| `src/backup.ts` | バックアップJSONの直列化・復元(純粋関数) |
| `src/state.ts` | 画面状態の遷移(純粋関数) |
| `src/db.ts` | IndexedDBの読み書き |
| `src/fileIo.ts` | ファイルのダウンロード・読み込み |
| `src/openRoute.ts` | URLへの遷移(テストで差し替え可能にする) |
| `src/views/patientListView.ts` | 患者一覧の描画 |
| `src/views/patientFormView.ts` | 登録/編集フォームの描画 |
| `src/views/routeOrderView.ts` | 訪問順の並べ替えとルート表示の描画 |
| `src/views/settingsView.ts` | 設定画面の描画 |
| `src/styles.css` | 全体のスタイル |
| `scripts/generate-icons.mjs` | SVGからPWAアイコンPNGを生成 |
| `.github/workflows/deploy.yml` | GitHub Pagesへのデプロイ |

---

### Task 1: プロジェクトの初期化

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`, `src/main.ts`, `src/styles.css`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `npm run dev` / `npm run build` / `npm run test` / `npm run typecheck` の4コマンド

- [ ] **Step 1: 依存をインストールする**

```bash
cd /c/Users/owner/Desktop/route-auto-input
npm init -y
npm install idb
npm install -D vite typescript vitest jsdom fake-indexeddb vite-plugin-pwa sharp
```

- [ ] **Step 2: `package.json`の`scripts`と`type`を設定する**

`package.json`を開き、`"main"`の行を削除し、以下のキーを追加する(`dependencies`と`devDependencies`はStep 1が書いたものをそのまま残す)。

```json
{
  "name": "route-auto-input",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 3: `tsconfig.json`を作る**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client", "vitest/globals"]
  },
  "include": ["src", "tests", "vite.config.ts"]
}
```

- [ ] **Step 4: `vite.config.ts`を作る**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/route-auto-input/',
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
```

- [ ] **Step 5: `.gitignore`を作る**

```gitignore
node_modules/
dist/
dev-dist/
*.local
```

- [ ] **Step 6: `index.html`を作る**

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>ルート自動入力</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 7: `src/styles.css`を作る**

```css
:root {
  --gap: 1rem;
  --tap-min: 2.75rem; /* 44px 相当 */
  --border: #d0d0d0;
  --text: #1a1a1a;
  --bg: #ffffff;
  --accent: #0b57d0;
  --danger: #b3261e;
  color-scheme: light;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--text);
  background: var(--bg);
}

#app {
  max-width: 48rem;
  margin: 0 auto;
  padding: var(--gap);
}

button,
input {
  font: inherit;
  min-height: var(--tap-min);
}

button {
  padding: 0 1rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: #f5f5f5;
  cursor: pointer;
}

button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

button.danger {
  color: var(--danger);
}

button:disabled {
  opacity: 0.4;
  cursor: default;
}

input[type='text'] {
  width: 100%;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
}

input[type='checkbox'] {
  width: var(--tap-min);
  height: var(--tap-min);
}

.message {
  padding: 0.75rem;
  border-radius: 0.5rem;
  margin-bottom: var(--gap);
}

.message.error {
  background: #fce8e6;
  color: var(--danger);
}

.message.info {
  background: #e6f0fc;
  color: var(--accent);
}
```

- [ ] **Step 8: `src/main.ts`を作る(この時点では見出しだけ)**

```ts
import './styles.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (root) {
  const heading = document.createElement('h1');
  heading.textContent = 'ルート自動入力';
  root.append(heading);
}
```

- [ ] **Step 9: `tests/smoke.test.ts`を作る**

```ts
import { describe, expect, it } from 'vitest';

describe('セットアップ', () => {
  it('テストランナーが動作する', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 10: テスト・型チェック・ビルドを通す**

```bash
npm run test && npm run typecheck && npm run build
```

期待: テスト1件がPASS、型エラーなし、`dist/`が生成される。

- [ ] **Step 11: コミット**

```bash
git add -A
git commit -m "chore: Vite + TypeScript + Vitest のプロジェクト基盤を作成"
```

---

### Task 2: 型・設定値・患者ファクトリ

**Files:**
- Create: `src/types.ts`, `src/config.ts`, `src/patient.ts`
- Test: `tests/patient.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `type Patient = { id: string; name: string; address: string; createdAt: string; updatedAt: string }`
  - `MAX_STOPS_PER_ROUTE: number`(初期値5)、`MAX_SELECTION: number`(値10)
  - `createPatient(name: string, address: string, now?: Date): Patient`
  - `updatePatientFields(patient: Patient, name: string, address: string, now?: Date): Patient`

- [ ] **Step 1: 失敗するテストを書く**

`tests/patient.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createPatient, updatePatientFields } from '../src/patient';

describe('createPatient', () => {
  it('氏名と住所の前後の空白を取り除く', () => {
    const patient = createPatient('  山田 太郎 ', ' 東京都千代田区1-1 ');
    expect(patient.name).toBe('山田 太郎');
    expect(patient.address).toBe('東京都千代田区1-1');
  });

  it('idを付与し、作成日時と更新日時を同じISO文字列にする', () => {
    const now = new Date('2026-09-02T09:00:00.000Z');
    const patient = createPatient('山田', '東京都', now);
    expect(patient.id).not.toBe('');
    expect(patient.createdAt).toBe('2026-09-02T09:00:00.000Z');
    expect(patient.updatedAt).toBe('2026-09-02T09:00:00.000Z');
  });

  it('別々に作った患者のidは重複しない', () => {
    const a = createPatient('山田', '東京都');
    const b = createPatient('鈴木', '大阪府');
    expect(a.id).not.toBe(b.id);
  });
});

describe('updatePatientFields', () => {
  it('idと作成日時を保ったまま、氏名・住所・更新日時を書き換える', () => {
    const original = createPatient('山田', '東京都', new Date('2026-09-01T00:00:00.000Z'));
    const updated = updatePatientFields(original, '山田 花子', '大阪府', new Date('2026-09-02T00:00:00.000Z'));
    expect(updated.id).toBe(original.id);
    expect(updated.createdAt).toBe('2026-09-01T00:00:00.000Z');
    expect(updated.name).toBe('山田 花子');
    expect(updated.address).toBe('大阪府');
    expect(updated.updatedAt).toBe('2026-09-02T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run tests/patient.test.ts
```

期待: FAIL(`../src/patient`が解決できない)。

- [ ] **Step 3: `src/types.ts`を作る**

```ts
export type Patient = {
  id: string;
  name: string;
  address: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
};
```

- [ ] **Step 4: `src/config.ts`を作る**

```ts
/**
 * 1本のルートに含められる地点数の上限。
 *
 * Google Maps URLs の waypoints 上限は、リンクを開くプラットフォームにより
 * モバイルブラウザで3件、それ以外で9件と変わる。確実に動く
 * 5件(出発地1 + 経由地3 + 到着地1)を初期値とし、実機で経由地9件が
 * 通ることを確認できたら 10 に変更する。ここ以外に上限を書かないこと。
 */
export const MAX_STOPS_PER_ROUTE = 5;

/** 一度に選択できる患者の上限。 */
export const MAX_SELECTION = 10;
```

- [ ] **Step 5: `src/patient.ts`を作る**

```ts
import type { Patient } from './types';

export function createPatient(name: string, address: string, now: Date = new Date()): Patient {
  const timestamp = now.toISOString();
  return {
    id: crypto.randomUUID(),
    name: name.trim(),
    address: address.trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updatePatientFields(
  patient: Patient,
  name: string,
  address: string,
  now: Date = new Date(),
): Patient {
  return {
    ...patient,
    name: name.trim(),
    address: address.trim(),
    updatedAt: now.toISOString(),
  };
}
```

- [ ] **Step 6: テストを実行して成功を確認する**

```bash
npx vitest run tests/patient.test.ts
```

期待: 4件すべてPASS。

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: 患者の型・上限設定・生成関数を追加"
```

---

### Task 3: ルート分割

**Files:**
- Create: `src/routeSplitter.ts`
- Test: `tests/routeSplitter.test.ts`

**Interfaces:**
- Consumes: なし(ジェネリックな配列操作)
- Produces: `splitIntoRoutes<T>(stops: readonly T[], maxStopsPerRoute: number): T[][]`

- [ ] **Step 1: 失敗するテストを書く**

`tests/routeSplitter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { splitIntoRoutes } from '../src/routeSplitter';

const stops = (count: number): number[] => Array.from({ length: count }, (_, i) => i + 1);

describe('splitIntoRoutes', () => {
  it('上限ちょうどなら分割しない', () => {
    expect(splitIntoRoutes(stops(5), 5)).toEqual([[1, 2, 3, 4, 5]]);
  });

  it('上限未満なら分割しない', () => {
    expect(splitIntoRoutes(stops(2), 5)).toEqual([[1, 2]]);
  });

  it('6件は2本に分かれ、境目の地点が両方に含まれる', () => {
    expect(splitIntoRoutes(stops(6), 5)).toEqual([
      [1, 2, 3, 4, 5],
      [5, 6],
    ]);
  });

  it('10件は3本に分かれる', () => {
    expect(splitIntoRoutes(stops(10), 5)).toEqual([
      [1, 2, 3, 4, 5],
      [5, 6, 7, 8, 9],
      [9, 10],
    ]);
  });

  it('どのルートも2件以上になる', () => {
    for (let count = 2; count <= 10; count += 1) {
      for (const route of splitIntoRoutes(stops(count), 5)) {
        expect(route.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('分割しても訪問順が保たれる', () => {
    const flattened = splitIntoRoutes(stops(10), 5)
      .flatMap((route, index) => (index === 0 ? route : route.slice(1)));
    expect(flattened).toEqual(stops(10));
  });

  it('上限を10にすると10件が1本になる', () => {
    expect(splitIntoRoutes(stops(10), 10)).toHaveLength(1);
  });

  it('1件のときは1本のルートとして返す', () => {
    expect(splitIntoRoutes(stops(1), 5)).toEqual([[1]]);
  });

  it('0件のときは空配列を返す', () => {
    expect(splitIntoRoutes([], 5)).toEqual([]);
  });

  it('上限が2未満なら例外を投げる', () => {
    expect(() => splitIntoRoutes(stops(3), 1)).toThrow();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run tests/routeSplitter.test.ts
```

期待: FAIL(`../src/routeSplitter`が解決できない)。

- [ ] **Step 3: `src/routeSplitter.ts`を作る**

```ts
/**
 * 訪問順を保ったまま、1本あたり maxStopsPerRoute 件以内のルートへ分割する。
 * 分割の境目となる地点は前後どちらのルートにも含め、経路が途切れないようにする。
 */
export function splitIntoRoutes<T>(stops: readonly T[], maxStopsPerRoute: number): T[][] {
  if (maxStopsPerRoute < 2) {
    throw new Error('1ルートあたりの上限は2以上である必要があります。');
  }
  if (stops.length === 0) {
    return [];
  }
  if (stops.length <= maxStopsPerRoute) {
    return [[...stops]];
  }

  const routes: T[][] = [];
  for (let start = 0; start < stops.length - 1; start += maxStopsPerRoute - 1) {
    routes.push([...stops.slice(start, start + maxStopsPerRoute)]);
  }
  return routes;
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run tests/routeSplitter.test.ts
```

期待: 10件すべてPASS。

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: 訪問先を上限内のルートへ分割する処理を追加"
```

---

### Task 4: Googleマップ用URLの生成

**Files:**
- Create: `src/googleMapsUrl.ts`
- Test: `tests/googleMapsUrl.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `buildGoogleMapsUrl(addresses: readonly string[]): string`

- [ ] **Step 1: 失敗するテストを書く**

`tests/googleMapsUrl.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildGoogleMapsUrl } from '../src/googleMapsUrl';

describe('buildGoogleMapsUrl', () => {
  it('2件なら経路URLを作り、経由地は付けない', () => {
    const url = new URL(buildGoogleMapsUrl(['東京都千代田区1-1', '大阪市北区2-2']));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('origin')).toBe('東京都千代田区1-1');
    expect(url.searchParams.get('destination')).toBe('大阪市北区2-2');
    expect(url.searchParams.get('waypoints')).toBeNull();
    expect(url.searchParams.get('travelmode')).toBe('driving');
  });

  it('3件なら中間の1件を経由地にする', () => {
    const url = new URL(buildGoogleMapsUrl(['A市1', 'B市2', 'C市3']));
    expect(url.searchParams.get('origin')).toBe('A市1');
    expect(url.searchParams.get('waypoints')).toBe('B市2');
    expect(url.searchParams.get('destination')).toBe('C市3');
  });

  it('5件なら経由地3件を縦棒で連結する', () => {
    const url = new URL(buildGoogleMapsUrl(['A', 'B', 'C', 'D', 'E']));
    expect(url.searchParams.get('waypoints')).toBe('B|C|D');
  });

  it('縦棒はURL文字列上でエンコードされる', () => {
    const raw = buildGoogleMapsUrl(['A', 'B', 'C']);
    expect(raw).not.toContain('|');
  });

  it('日本語と空白を含む住所が往復して元に戻る', () => {
    const address = '東京都 千代田区 一番町 1-1 マンション 101';
    const url = new URL(buildGoogleMapsUrl([address, '大阪府']));
    expect(url.searchParams.get('origin')).toBe(address);
  });

  it('1件なら地点検索URLを作る', () => {
    const url = new URL(buildGoogleMapsUrl(['東京都千代田区1-1']));
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('query')).toBe('東京都千代田区1-1');
  });

  it('住所の前後の空白は取り除かれる', () => {
    const url = new URL(buildGoogleMapsUrl([' 東京都 ', ' 大阪府 ']));
    expect(url.searchParams.get('origin')).toBe('東京都');
  });

  it('空の住所が含まれると例外を投げる', () => {
    expect(() => buildGoogleMapsUrl(['東京都', '   '])).toThrow();
  });

  it('0件なら例外を投げる', () => {
    expect(() => buildGoogleMapsUrl([])).toThrow();
  });

  it('例外メッセージに住所を含めない', () => {
    try {
      buildGoogleMapsUrl(['東京都千代田区1-1', '   ']);
      expect.unreachable('例外が投げられるはず');
    } catch (error) {
      expect((error as Error).message).not.toContain('千代田');
    }
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run tests/googleMapsUrl.test.ts
```

期待: FAIL(`../src/googleMapsUrl`が解決できない)。

- [ ] **Step 3: `src/googleMapsUrl.ts`を作る**

```ts
const DIRECTIONS_BASE = 'https://www.google.com/maps/dir/';
const SEARCH_BASE = 'https://www.google.com/maps/search/';

/**
 * 訪問順に並んだ住所からGoogleマップ用のURLを作る。
 * 2件以上なら経路URL、1件なら地点検索URLを返す。
 * エンコードは URLSearchParams に任せる(日本語住所を壊さないため)。
 */
export function buildGoogleMapsUrl(addresses: readonly string[]): string {
  const trimmed = addresses.map((address) => address.trim());

  if (trimmed.length === 0) {
    throw new Error('地点が選ばれていません。');
  }
  if (trimmed.some((address) => address.length === 0)) {
    throw new Error('住所が空の地点があります。');
  }

  if (trimmed.length === 1) {
    const url = new URL(SEARCH_BASE);
    url.searchParams.set('api', '1');
    url.searchParams.set('query', trimmed[0]!);
    return url.toString();
  }

  const url = new URL(DIRECTIONS_BASE);
  url.searchParams.set('api', '1');
  url.searchParams.set('origin', trimmed[0]!);
  url.searchParams.set('destination', trimmed[trimmed.length - 1]!);

  const waypoints = trimmed.slice(1, -1);
  if (waypoints.length > 0) {
    url.searchParams.set('waypoints', waypoints.join('|'));
  }

  url.searchParams.set('travelmode', 'driving');
  return url.toString();
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run tests/googleMapsUrl.test.ts
```

期待: 10件すべてPASS。

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: Googleマップ用の経路・検索URL生成を追加"
```

---

### Task 5: 入力と選択の検証

**Files:**
- Create: `src/validation.ts`
- Test: `tests/validation.test.ts`

**Interfaces:**
- Consumes: `MAX_SELECTION`(`src/config.ts`)、`Patient`(`src/types.ts`)
- Produces:
  - `type ValidationResult = { ok: true } | { ok: false; message: string }`
  - `validatePatientInput(name: string, address: string): ValidationResult`
  - `validateSelection(count: number): ValidationResult`
  - `findDuplicateAddresses(patients: readonly Patient[]): string[]`

- [ ] **Step 1: 失敗するテストを書く**

`tests/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createPatient } from '../src/patient';
import { findDuplicateAddresses, validatePatientInput, validateSelection } from '../src/validation';

describe('validatePatientInput', () => {
  it('氏名と住所が入っていれば通る', () => {
    expect(validatePatientInput('山田', '東京都')).toEqual({ ok: true });
  });

  it('氏名が空なら通らない', () => {
    const result = validatePatientInput('   ', '東京都');
    expect(result.ok).toBe(false);
  });

  it('住所が空なら通らない', () => {
    const result = validatePatientInput('山田', '');
    expect(result.ok).toBe(false);
  });

  it('エラーメッセージに入力値そのものを含めない', () => {
    const result = validatePatientInput('山田太郎', '   ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toContain('山田太郎');
    }
  });
});

describe('validateSelection', () => {
  it('1人なら通る', () => {
    expect(validateSelection(1)).toEqual({ ok: true });
  });

  it('10人なら通る', () => {
    expect(validateSelection(10)).toEqual({ ok: true });
  });

  it('0人なら通らない', () => {
    expect(validateSelection(0).ok).toBe(false);
  });

  it('11人なら通らない', () => {
    expect(validateSelection(11).ok).toBe(false);
  });
});

describe('findDuplicateAddresses', () => {
  it('重複がなければ空配列を返す', () => {
    const patients = [createPatient('山田', '東京都'), createPatient('鈴木', '大阪府')];
    expect(findDuplicateAddresses(patients)).toEqual([]);
  });

  it('同じ住所が複数あればその住所を返す', () => {
    const patients = [
      createPatient('山田', '東京都1-1'),
      createPatient('鈴木', '大阪府2-2'),
      createPatient('佐藤', '東京都1-1'),
    ];
    expect(findDuplicateAddresses(patients)).toEqual(['東京都1-1']);
  });

  it('3件同じでも住所は1つだけ返す', () => {
    const patients = [
      createPatient('山田', '東京都1-1'),
      createPatient('鈴木', '東京都1-1'),
      createPatient('佐藤', '東京都1-1'),
    ];
    expect(findDuplicateAddresses(patients)).toEqual(['東京都1-1']);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run tests/validation.test.ts
```

期待: FAIL(`../src/validation`が解決できない)。

- [ ] **Step 3: `src/validation.ts`を作る**

```ts
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
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run tests/validation.test.ts
```

期待: 11件すべてPASS。

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: 入力値と選択件数の検証を追加"
```

---

### Task 6: バックアップの直列化と復元

**Files:**
- Create: `src/backup.ts`
- Test: `tests/backup.test.ts`

**Interfaces:**
- Consumes: `Patient`(`src/types.ts`)、`createPatient`(`src/patient.ts`)
- Produces:
  - `BACKUP_VERSION: number`(値1)
  - `serializeBackup(patients: readonly Patient[], now?: Date): string`
  - `parseBackup(text: string): Patient[]`

- [ ] **Step 1: 失敗するテストを書く**

`tests/backup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BACKUP_VERSION, parseBackup, serializeBackup } from '../src/backup';
import { createPatient } from '../src/patient';

const samplePatients = () => [
  createPatient('山田 太郎', '東京都千代田区1-1'),
  createPatient('鈴木 花子', '大阪市北区2-2'),
];

describe('serializeBackup', () => {
  it('バージョンと書き出し日時と患者一覧を含む', () => {
    const patients = samplePatients();
    const json = JSON.parse(serializeBackup(patients, new Date('2026-09-02T09:00:00.000Z')));
    expect(json.version).toBe(BACKUP_VERSION);
    expect(json.exportedAt).toBe('2026-09-02T09:00:00.000Z');
    expect(json.patients).toHaveLength(2);
  });
});

describe('parseBackup', () => {
  it('書き出したものを読み込むと同じ患者一覧に戻る', () => {
    const patients = samplePatients();
    expect(parseBackup(serializeBackup(patients))).toEqual(patients);
  });

  it('JSONとして壊れていれば例外を投げる', () => {
    expect(() => parseBackup('{ not json')).toThrow();
  });

  it('バージョンが違えば例外を投げる', () => {
    const text = JSON.stringify({ version: 999, exportedAt: '', patients: [] });
    expect(() => parseBackup(text)).toThrow();
  });

  it('patientsが配列でなければ例外を投げる', () => {
    const text = JSON.stringify({ version: BACKUP_VERSION, exportedAt: '', patients: {} });
    expect(() => parseBackup(text)).toThrow();
  });

  it('必須項目が欠けていれば例外を投げる', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [{ id: 'a', name: '山田' }],
    });
    expect(() => parseBackup(text)).toThrow();
  });

  it('例外メッセージに氏名や住所を含めない', () => {
    const text = JSON.stringify({
      version: BACKUP_VERSION,
      exportedAt: '',
      patients: [{ id: 'a', name: '山田太郎', address: '東京都千代田区1-1' }],
    });
    try {
      parseBackup(text);
      expect.unreachable('例外が投げられるはず');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toContain('山田太郎');
      expect(message).not.toContain('千代田');
    }
  });

  it('患者0件のファイルは空配列として読み込める', () => {
    expect(parseBackup(serializeBackup([]))).toEqual([]);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run tests/backup.test.ts
```

期待: FAIL(`../src/backup`が解決できない)。

- [ ] **Step 3: `src/backup.ts`を作る**

```ts
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
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run tests/backup.test.ts
```

期待: 8件すべてPASS。

- [ ] **Step 5: コミット**

```bash
git add -A
git commit -m "feat: バックアップJSONの書き出しと読み込みを追加"
```

---

### Task 7: IndexedDBによる永続化

**Files:**
- Create: `src/db.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Consumes: `Patient`(`src/types.ts`)、`createPatient`(`src/patient.ts`)
- Produces:
  - `listPatients(): Promise<Patient[]>`(登録が新しい順)
  - `savePatient(patient: Patient): Promise<void>`(新規・更新の両方)
  - `deletePatient(id: string): Promise<void>`
  - `replaceAllPatients(patients: readonly Patient[]): Promise<void>`
  - `mergePatients(patients: readonly Patient[]): Promise<void>`
  - `closeDbForTest(): Promise<void>`

- [ ] **Step 1: 失敗するテストを書く**

`tests/db.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { beforeEach, describe, expect, it } from 'vitest';
import { closeDbForTest, deletePatient, listPatients, mergePatients, replaceAllPatients, savePatient } from '../src/db';
import { createPatient, updatePatientFields } from '../src/patient';

// 接続を閉じてから消す。開いたままだと deleteDB がブロックされ、
// 前のテストのデータが次のテストへ漏れる。
beforeEach(async () => {
  await closeDbForTest();
  await deleteDB('route-auto-input');
});

describe('患者の保存と取得', () => {
  it('保存した患者を取得できる', async () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    await savePatient(patient);
    expect(await listPatients()).toEqual([patient]);
  });

  it('登録が新しい患者が先頭に来る', async () => {
    const older = createPatient('山田', '東京都', new Date('2026-09-01T00:00:00.000Z'));
    const newer = createPatient('鈴木', '大阪府', new Date('2026-09-02T00:00:00.000Z'));
    await savePatient(older);
    await savePatient(newer);
    expect((await listPatients()).map((p) => p.name)).toEqual(['鈴木', '山田']);
  });

  it('同じidで保存すると上書きされる', async () => {
    const patient = createPatient('山田', '東京都');
    await savePatient(patient);
    await savePatient(updatePatientFields(patient, '山田 花子', '大阪府'));
    const stored = await listPatients();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('山田 花子');
  });

  it('削除できる', async () => {
    const patient = createPatient('山田', '東京都');
    await savePatient(patient);
    await deletePatient(patient.id);
    expect(await listPatients()).toEqual([]);
  });
});

describe('インポート', () => {
  it('replaceAllPatientsは既存データを消してから入れ替える', async () => {
    await savePatient(createPatient('既存', '東京都'));
    const imported = [createPatient('取込1', '大阪府'), createPatient('取込2', '京都府')];
    await replaceAllPatients(imported);
    const stored = await listPatients();
    expect(stored).toHaveLength(2);
    expect(stored.map((p) => p.name).sort()).toEqual(['取込1', '取込2']);
  });

  it('mergePatientsは既存データを残したまま追加する', async () => {
    const existing = createPatient('既存', '東京都');
    await savePatient(existing);
    await mergePatients([createPatient('追加', '大阪府')]);
    expect(await listPatients()).toHaveLength(2);
  });

  it('mergePatientsは同じidを上書きする', async () => {
    const existing = createPatient('既存', '東京都');
    await savePatient(existing);
    await mergePatients([updatePatientFields(existing, '更新後', '大阪府')]);
    const stored = await listPatients();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe('更新後');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run tests/db.test.ts
```

期待: FAIL(`../src/db`が解決できない)。

- [ ] **Step 3: `src/db.ts`を作る**

```ts
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Patient } from './types';

const DB_NAME = 'route-auto-input';
const DB_VERSION = 1;
const STORE = 'patients';

interface RouteAutoInputDB extends DBSchema {
  patients: {
    key: string;
    value: Patient;
    indexes: { createdAt: string };
  };
}

let connection: Promise<IDBPDatabase<RouteAutoInputDB>> | null = null;

function getDb(): Promise<IDBPDatabase<RouteAutoInputDB>> {
  connection ??= openDB<RouteAutoInputDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
    },
  });
  return connection;
}

/**
 * テストでデータベースを作り直すために接続を閉じる。
 * 接続を開いたままにすると deleteDB がブロックされるため、必ず close する。
 */
export async function closeDbForTest(): Promise<void> {
  if (connection === null) {
    return;
  }
  const db = await connection;
  db.close();
  connection = null;
}

/** 登録が新しい順に返す。 */
export async function listPatients(): Promise<Patient[]> {
  const db = await getDb();
  const ascending = await db.getAllFromIndex(STORE, 'createdAt');
  return ascending.reverse();
}

export async function savePatient(patient: Patient): Promise<void> {
  const db = await getDb();
  await db.put(STORE, patient);
}

export async function deletePatient(id: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

/** 既存データを全消去してから入れ替える。 */
export async function replaceAllPatients(patients: readonly Patient[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  await tx.store.clear();
  for (const patient of patients) {
    await tx.store.put(patient);
  }
  await tx.done;
}

/** 既存データを残したまま、同じidは上書きして取り込む。 */
export async function mergePatients(patients: readonly Patient[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  for (const patient of patients) {
    await tx.store.put(patient);
  }
  await tx.done;
}
```

- [ ] **Step 4: テストを実行して成功を確認する**

```bash
npx vitest run tests/db.test.ts
```

期待: 7件すべてPASS。

- [ ] **Step 5: 全テストと型チェックを通す**

```bash
npm run test && npm run typecheck
```

期待: すべてPASS。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: IndexedDBによる患者データの永続化を追加"
```

---

### Task 8: 画面状態の遷移

**Files:**
- Modify: `src/types.ts`(`Screen`・`Message`・`AppState`を追加)
- Create: `src/state.ts`
- Test: `tests/state.test.ts`

**Interfaces:**
- Consumes: `MAX_SELECTION`(`src/config.ts`)、`Patient`(`src/types.ts`)
- Produces:
  - `type Screen = { name: 'list' } | { name: 'form'; patientId: string | null } | { name: 'order' } | { name: 'settings' }`
  - `type Message = { kind: 'error' | 'info'; text: string }`
  - `type AppState = { screen: Screen; patients: Patient[]; selectedIds: string[]; searchQuery: string; message: Message | null }`
  - `createInitialState(patients: Patient[]): AppState`
  - `withPatients(state: AppState, patients: Patient[]): AppState`
  - `withScreen(state: AppState, screen: Screen): AppState`
  - `withMessage(state: AppState, message: Message | null): AppState`
  - `setSearchQuery(state: AppState, query: string): AppState`
  - `toggleSelection(state: AppState, id: string): AppState`
  - `moveSelected(state: AppState, id: string, direction: -1 | 1): AppState`
  - `visiblePatients(state: AppState): Patient[]`
  - `selectedPatients(state: AppState): Patient[]`

- [ ] **Step 1: 失敗するテストを書く**

`tests/state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MAX_SELECTION } from '../src/config';
import { createPatient } from '../src/patient';
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
import type { Patient } from '../src/types';

const makePatients = (count: number): Patient[] =>
  Array.from({ length: count }, (_, i) => createPatient(`患者${i + 1}`, `東京都${i + 1}-1`));

describe('createInitialState', () => {
  it('一覧画面から始まり、選択は空', () => {
    const state = createInitialState(makePatients(2));
    expect(state.screen).toEqual({ name: 'list' });
    expect(state.selectedIds).toEqual([]);
    expect(state.searchQuery).toBe('');
    expect(state.message).toBeNull();
  });
});

describe('toggleSelection', () => {
  it('未選択の患者を選ぶと末尾に追加される', () => {
    const patients = makePatients(3);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[0]!.id);
    state = toggleSelection(state, patients[2]!.id);
    expect(state.selectedIds).toEqual([patients[0]!.id, patients[2]!.id]);
  });

  it('選択済みの患者をもう一度押すと外れる', () => {
    const patients = makePatients(2);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[0]!.id);
    state = toggleSelection(state, patients[0]!.id);
    expect(state.selectedIds).toEqual([]);
  });

  it('上限を超えて選ぼうとすると選択は変わらず、エラーメッセージが出る', () => {
    const patients = makePatients(MAX_SELECTION + 1);
    let state = createInitialState(patients);
    for (const patient of patients.slice(0, MAX_SELECTION)) {
      state = toggleSelection(state, patient.id);
    }
    const overflowed = toggleSelection(state, patients[MAX_SELECTION]!.id);
    expect(overflowed.selectedIds).toHaveLength(MAX_SELECTION);
    expect(overflowed.message?.kind).toBe('error');
  });

  it('上限まで選んでいても選択済みの解除はできる', () => {
    const patients = makePatients(MAX_SELECTION);
    let state = createInitialState(patients);
    for (const patient of patients) {
      state = toggleSelection(state, patient.id);
    }
    state = toggleSelection(state, patients[0]!.id);
    expect(state.selectedIds).toHaveLength(MAX_SELECTION - 1);
  });
});

describe('moveSelected', () => {
  it('上へ動かすと順番が入れ替わる', () => {
    const patients = makePatients(3);
    let state = createInitialState(patients);
    for (const patient of patients) {
      state = toggleSelection(state, patient.id);
    }
    state = moveSelected(state, patients[1]!.id, -1);
    expect(state.selectedIds).toEqual([patients[1]!.id, patients[0]!.id, patients[2]!.id]);
  });

  it('下へ動かすと順番が入れ替わる', () => {
    const patients = makePatients(3);
    let state = createInitialState(patients);
    for (const patient of patients) {
      state = toggleSelection(state, patient.id);
    }
    state = moveSelected(state, patients[0]!.id, 1);
    expect(state.selectedIds).toEqual([patients[1]!.id, patients[0]!.id, patients[2]!.id]);
  });

  it('先頭をさらに上へ動かしても変わらない', () => {
    const patients = makePatients(2);
    let state = createInitialState(patients);
    for (const patient of patients) {
      state = toggleSelection(state, patient.id);
    }
    const moved = moveSelected(state, patients[0]!.id, -1);
    expect(moved.selectedIds).toEqual(state.selectedIds);
  });

  it('選択していない患者を動かしても変わらない', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const moved = moveSelected(state, patients[1]!.id, -1);
    expect(moved.selectedIds).toEqual(state.selectedIds);
  });
});

describe('visiblePatients', () => {
  it('検索語がなければ全件返す', () => {
    const state = createInitialState(makePatients(3));
    expect(visiblePatients(state)).toHaveLength(3);
  });

  it('氏名で絞り込める', () => {
    const state = setSearchQuery(createInitialState(makePatients(3)), '患者2');
    expect(visiblePatients(state).map((p) => p.name)).toEqual(['患者2']);
  });

  it('住所で絞り込める', () => {
    const patients = [createPatient('山田', '東京都港区1-1'), createPatient('鈴木', '大阪市北区2-2')];
    const state = setSearchQuery(createInitialState(patients), '大阪');
    expect(visiblePatients(state).map((p) => p.name)).toEqual(['鈴木']);
  });

  it('前後の空白は無視される', () => {
    const state = setSearchQuery(createInitialState(makePatients(3)), '  患者3  ');
    expect(visiblePatients(state)).toHaveLength(1);
  });
});

describe('selectedPatients', () => {
  it('選択した順(訪問順)に返す', () => {
    const patients = makePatients(3);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[2]!.id);
    state = toggleSelection(state, patients[0]!.id);
    expect(selectedPatients(state).map((p) => p.name)).toEqual(['患者3', '患者1']);
  });
});

describe('withPatients', () => {
  it('一覧を差し替えると、いなくなった患者の選択は外れる', () => {
    const patients = makePatients(3);
    let state = createInitialState(patients);
    state = toggleSelection(state, patients[0]!.id);
    state = toggleSelection(state, patients[1]!.id);
    const next = withPatients(state, [patients[1]!]);
    expect(next.selectedIds).toEqual([patients[1]!.id]);
  });
});

describe('withScreen / withMessage', () => {
  it('画面を切り替えるとメッセージは消える', () => {
    const state = withMessage(createInitialState([]), { kind: 'error', text: 'エラー' });
    expect(withScreen(state, { name: 'settings' }).message).toBeNull();
  });

  it('メッセージを設定できる', () => {
    const state = withMessage(createInitialState([]), { kind: 'info', text: '保存しました。' });
    expect(state.message).toEqual({ kind: 'info', text: '保存しました。' });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run tests/state.test.ts
```

期待: FAIL(`../src/state`が解決できない)。

- [ ] **Step 3: `src/types.ts`に画面状態の型を追加する**

既存の`Patient`型はそのまま残し、ファイル末尾に追記する。

```ts
export type Screen =
  | { name: 'list' }
  | { name: 'form'; patientId: string | null }
  | { name: 'order' }
  | { name: 'settings' };

export type Message = { kind: 'error' | 'info'; text: string };

export type AppState = {
  screen: Screen;
  patients: Patient[];
  /** 訪問順に並んだ、選択中の患者id */
  selectedIds: string[];
  searchQuery: string;
  message: Message | null;
};
```

- [ ] **Step 4: `src/state.ts`を作る**

```ts
import { MAX_SELECTION } from './config';
import type { AppState, Message, Patient, Screen } from './types';

export function createInitialState(patients: Patient[]): AppState {
  return {
    screen: { name: 'list' },
    patients,
    selectedIds: [],
    searchQuery: '',
    message: null,
  };
}

/** DBを読み直したときに使う。存在しなくなった患者の選択は外す。 */
export function withPatients(state: AppState, patients: Patient[]): AppState {
  const existingIds = new Set(patients.map((patient) => patient.id));
  return {
    ...state,
    patients,
    selectedIds: state.selectedIds.filter((id) => existingIds.has(id)),
  };
}

export function withScreen(state: AppState, screen: Screen): AppState {
  return { ...state, screen, message: null };
}

export function withMessage(state: AppState, message: Message | null): AppState {
  return { ...state, message };
}

export function setSearchQuery(state: AppState, query: string): AppState {
  return { ...state, searchQuery: query };
}

export function toggleSelection(state: AppState, id: string): AppState {
  if (state.selectedIds.includes(id)) {
    return {
      ...state,
      selectedIds: state.selectedIds.filter((selectedId) => selectedId !== id),
      message: null,
    };
  }
  if (state.selectedIds.length >= MAX_SELECTION) {
    return {
      ...state,
      message: { kind: 'error', text: `一度に選べるのは${MAX_SELECTION}人までです。` },
    };
  }
  return { ...state, selectedIds: [...state.selectedIds, id], message: null };
}

export function moveSelected(state: AppState, id: string, direction: -1 | 1): AppState {
  const index = state.selectedIds.indexOf(id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= state.selectedIds.length) {
    return state;
  }
  const selectedIds = [...state.selectedIds];
  selectedIds[index] = state.selectedIds[target]!;
  selectedIds[target] = state.selectedIds[index]!;
  return { ...state, selectedIds };
}

export function visiblePatients(state: AppState): Patient[] {
  const query = state.searchQuery.trim();
  if (query.length === 0) {
    return state.patients;
  }
  return state.patients.filter(
    (patient) => patient.name.includes(query) || patient.address.includes(query),
  );
}

/** 訪問順に並んだ、選択中の患者。 */
export function selectedPatients(state: AppState): Patient[] {
  const byId = new Map(state.patients.map((patient) => [patient.id, patient]));
  return state.selectedIds
    .map((id) => byId.get(id))
    .filter((patient): patient is Patient => patient !== undefined);
}
```

- [ ] **Step 5: テストを実行して成功を確認する**

```bash
npx vitest run tests/state.test.ts
```

期待: 16件すべてPASS。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: 画面状態と選択・並べ替えの遷移処理を追加"
```

---

### Task 9: 患者一覧画面

**Files:**
- Create: `src/views/patientListView.ts`
- Modify: `src/styles.css`(末尾に追記)
- Test: `tests/patientListView.test.ts`

**Interfaces:**
- Consumes: `AppState`(`src/types.ts`)、`visiblePatients`(`src/state.ts`)、`MAX_SELECTION`(`src/config.ts`)
- Produces:
  - `type PatientListHandlers = { onSearch(query: string): void; onToggleSelect(id: string): void; onNew(): void; onEdit(id: string): void; onDelete(id: string): void; onNext(): void; onOpenSettings(): void }`
  - `renderPatientList(state: AppState, handlers: PatientListHandlers): HTMLElement`

- [ ] **Step 1: 失敗するテストを書く**

`tests/patientListView.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { MAX_SELECTION } from '../src/config';
import { createPatient } from '../src/patient';
import { createInitialState, setSearchQuery, toggleSelection } from '../src/state';
import { renderPatientList, type PatientListHandlers } from '../src/views/patientListView';
import type { Patient } from '../src/types';

const makePatients = (count: number): Patient[] =>
  Array.from({ length: count }, (_, i) => createPatient(`患者${i + 1}`, `東京都${i + 1}-1`));

const noopHandlers = (): PatientListHandlers => ({
  onSearch: vi.fn(),
  onToggleSelect: vi.fn(),
  onNew: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onNext: vi.fn(),
  onOpenSettings: vi.fn(),
});

describe('renderPatientList', () => {
  it('患者の行を件数ぶん描画する', () => {
    const element = renderPatientList(createInitialState(makePatients(3)), noopHandlers());
    expect(element.querySelectorAll('[data-testid="patient-row"]')).toHaveLength(3);
  });

  it('氏名と住所を表示する', () => {
    const element = renderPatientList(createInitialState(makePatients(1)), noopHandlers());
    expect(element.textContent).toContain('患者1');
    expect(element.textContent).toContain('東京都1-1');
  });

  it('登録が0件ならその旨を表示する', () => {
    const element = renderPatientList(createInitialState([]), noopHandlers());
    expect(element.textContent).toContain('まだ患者が登録されていません');
  });

  it('検索で絞り込まれた結果だけを描画する', () => {
    const state = setSearchQuery(createInitialState(makePatients(3)), '患者2');
    const element = renderPatientList(state, noopHandlers());
    expect(element.querySelectorAll('[data-testid="patient-row"]')).toHaveLength(1);
  });

  it('選択済みの患者のチェックボックスがオンになる', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    const checkbox = element.querySelector<HTMLInputElement>(`input[data-id="${patients[0]!.id}"]`);
    expect(checkbox?.checked).toBe(true);
  });

  it('チェックボックスを押すとonToggleSelectがidつきで呼ばれる', () => {
    const patients = makePatients(1);
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(patients), handlers);
    element.querySelector<HTMLInputElement>(`input[data-id="${patients[0]!.id}"]`)?.click();
    expect(handlers.onToggleSelect).toHaveBeenCalledWith(patients[0]!.id);
  });

  it('上限まで選ぶと、未選択のチェックボックスが押せなくなる', () => {
    const patients = makePatients(MAX_SELECTION + 1);
    let state = createInitialState(patients);
    for (const patient of patients.slice(0, MAX_SELECTION)) {
      state = toggleSelection(state, patient.id);
    }
    const element = renderPatientList(state, noopHandlers());
    const unselected = element.querySelector<HTMLInputElement>(
      `input[data-id="${patients[MAX_SELECTION]!.id}"]`,
    );
    expect(unselected?.disabled).toBe(true);
  });

  it('未選択のときは「次へ」が押せない', () => {
    const element = renderPatientList(createInitialState(makePatients(2)), noopHandlers());
    const next = element.querySelector<HTMLButtonElement>('[data-testid="next-button"]');
    expect(next?.disabled).toBe(true);
  });

  it('1人以上選ぶと「次へ」が押せる', () => {
    const patients = makePatients(2);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    const next = element.querySelector<HTMLButtonElement>('[data-testid="next-button"]');
    expect(next?.disabled).toBe(false);
  });

  it('選択件数を表示する', () => {
    const patients = makePatients(3);
    const state = toggleSelection(createInitialState(patients), patients[0]!.id);
    const element = renderPatientList(state, noopHandlers());
    expect(element.textContent).toContain(`1 / ${MAX_SELECTION}`);
  });

  it('上限まで選ぶと、これ以上選べない理由を表示する', () => {
    const patients = makePatients(MAX_SELECTION + 1);
    let state = createInitialState(patients);
    for (const patient of patients.slice(0, MAX_SELECTION)) {
      state = toggleSelection(state, patient.id);
    }
    const element = renderPatientList(state, noopHandlers());
    expect(element.querySelector('[data-testid="limit-hint"]')?.textContent).toContain(
      `${MAX_SELECTION}人`,
    );
  });

  it('上限に達していなければ理由は表示しない', () => {
    const element = renderPatientList(createInitialState(makePatients(2)), noopHandlers());
    expect(element.querySelector('[data-testid="limit-hint"]')).toBeNull();
  });

  it('編集ボタンでonEditが呼ばれる', () => {
    const patients = makePatients(1);
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(patients), handlers);
    element.querySelector<HTMLButtonElement>(`[data-testid="edit"][data-id="${patients[0]!.id}"]`)?.click();
    expect(handlers.onEdit).toHaveBeenCalledWith(patients[0]!.id);
  });

  it('削除ボタンでonDeleteが呼ばれる', () => {
    const patients = makePatients(1);
    const handlers = noopHandlers();
    const element = renderPatientList(createInitialState(patients), handlers);
    element.querySelector<HTMLButtonElement>(`[data-testid="delete"][data-id="${patients[0]!.id}"]`)?.click();
    expect(handlers.onDelete).toHaveBeenCalledWith(patients[0]!.id);
  });

  it('メッセージがあれば表示する', () => {
    const state = { ...createInitialState([]), message: { kind: 'error' as const, text: '保存できませんでした。' } };
    const element = renderPatientList(state, noopHandlers());
    expect(element.querySelector('.message')?.textContent).toBe('保存できませんでした。');
  });

  it('チェックボックスに患者名のラベルを付ける', () => {
    const patients = makePatients(1);
    const element = renderPatientList(createInitialState(patients), noopHandlers());
    const checkbox = element.querySelector<HTMLInputElement>(`input[data-id="${patients[0]!.id}"]`);
    expect(checkbox?.getAttribute('aria-label')).toBe('患者1 を選択');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run tests/patientListView.test.ts
```

期待: FAIL(`../src/views/patientListView`が解決できない)。

- [ ] **Step 3: `src/views/patientListView.ts`を作る**

```ts
import { MAX_SELECTION } from '../config';
import { visiblePatients } from '../state';
import type { AppState, Patient } from '../types';

export type PatientListHandlers = {
  onSearch(query: string): void;
  onToggleSelect(id: string): void;
  onNew(): void;
  onEdit(id: string): void;
  onDelete(id: string): void;
  onNext(): void;
  onOpenSettings(): void;
};

export function renderPatientList(state: AppState, handlers: PatientListHandlers): HTMLElement {
  const container = document.createElement('div');

  const header = document.createElement('div');
  header.className = 'row-between';
  const title = document.createElement('h1');
  title.textContent = 'ルート自動入力';
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.textContent = '設定';
  settingsButton.dataset.testid = 'settings-button';
  settingsButton.addEventListener('click', () => handlers.onOpenSettings());
  header.append(title, settingsButton);
  container.append(header);

  if (state.message) {
    const message = document.createElement('p');
    message.className = `message ${state.message.kind}`;
    message.textContent = state.message.text;
    container.append(message);
  }

  const search = document.createElement('input');
  search.type = 'text';
  search.value = state.searchQuery;
  search.placeholder = '氏名・住所で検索';
  search.setAttribute('aria-label', '氏名・住所で検索');
  search.dataset.testid = 'search-input';
  search.addEventListener('input', () => handlers.onSearch(search.value));
  container.append(search);

  const newButton = document.createElement('button');
  newButton.type = 'button';
  newButton.className = 'primary';
  newButton.textContent = '＋ 新規登録';
  newButton.dataset.testid = 'new-button';
  newButton.addEventListener('click', () => handlers.onNew());
  container.append(newButton);

  const patients = visiblePatients(state);
  if (patients.length === 0) {
    const empty = document.createElement('p');
    empty.textContent =
      state.patients.length === 0
        ? 'まだ患者が登録されていません。「＋ 新規登録」から追加してください。'
        : '検索に一致する患者がいません。';
    container.append(empty);
  } else {
    const list = document.createElement('ul');
    list.className = 'patient-list';
    for (const patient of patients) {
      list.append(renderRow(patient, state, handlers));
    }
    container.append(list);
  }

  if (state.selectedIds.length >= MAX_SELECTION) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.dataset.testid = 'limit-hint';
    hint.textContent = `一度に選べるのは${MAX_SELECTION}人までです。選び直すには、どれかの選択を外してください。`;
    container.append(hint);
  }

  const footer = document.createElement('div');
  footer.className = 'row-between footer';
  const count = document.createElement('span');
  count.textContent = `選択中: ${state.selectedIds.length} / ${MAX_SELECTION}`;
  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'primary';
  nextButton.textContent = '次へ(順番を決める)';
  nextButton.dataset.testid = 'next-button';
  nextButton.disabled = state.selectedIds.length === 0;
  nextButton.addEventListener('click', () => handlers.onNext());
  footer.append(count, nextButton);
  container.append(footer);

  return container;
}

function renderRow(patient: Patient, state: AppState, handlers: PatientListHandlers): HTMLElement {
  const row = document.createElement('li');
  row.className = 'patient-row';
  row.dataset.testid = 'patient-row';

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.dataset.id = patient.id;
  checkbox.checked = state.selectedIds.includes(patient.id);
  checkbox.disabled = !checkbox.checked && state.selectedIds.length >= MAX_SELECTION;
  checkbox.setAttribute('aria-label', `${patient.name} を選択`);
  checkbox.addEventListener('change', () => handlers.onToggleSelect(patient.id));

  const body = document.createElement('div');
  body.className = 'patient-body';
  const name = document.createElement('div');
  name.className = 'patient-name';
  name.textContent = patient.name;
  const address = document.createElement('div');
  address.className = 'patient-address';
  address.textContent = patient.address;
  body.append(name, address);

  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.textContent = '編集';
  editButton.dataset.testid = 'edit';
  editButton.dataset.id = patient.id;
  editButton.setAttribute('aria-label', `${patient.name} を編集`);
  editButton.addEventListener('click', () => handlers.onEdit(patient.id));

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'danger';
  deleteButton.textContent = '削除';
  deleteButton.dataset.testid = 'delete';
  deleteButton.dataset.id = patient.id;
  deleteButton.setAttribute('aria-label', `${patient.name} を削除`);
  deleteButton.addEventListener('click', () => handlers.onDelete(patient.id));

  row.append(checkbox, body, editButton, deleteButton);
  return row;
}
```

- [ ] **Step 4: `src/styles.css`の末尾にレイアウトを追記する**

```css
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

.hint {
  font-size: 0.875rem;
  color: #555;
}
```

- [ ] **Step 5: テストを実行して成功を確認する**

```bash
npx vitest run tests/patientListView.test.ts
```

期待: 16件すべてPASS。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: 患者一覧画面の描画を追加"
```

---

### Task 10: 登録・編集フォーム画面

**Files:**
- Create: `src/views/patientFormView.ts`
- Test: `tests/patientFormView.test.ts`

**Interfaces:**
- Consumes: `Patient`・`Message`(`src/types.ts`)、`buildGoogleMapsUrl`(`src/googleMapsUrl.ts`)
- Produces:
  - `type PatientFormHandlers = { onSave(name: string, address: string): void; onCancel(): void }`
  - `renderPatientForm(patient: Patient | null, message: Message | null, handlers: PatientFormHandlers): HTMLElement`

- [ ] **Step 1: 失敗するテストを書く**

`tests/patientFormView.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import { renderPatientForm, type PatientFormHandlers } from '../src/views/patientFormView';

const handlers = (): PatientFormHandlers => ({ onSave: vi.fn(), onCancel: vi.fn() });

const nameInput = (element: HTMLElement) =>
  element.querySelector<HTMLInputElement>('[data-testid="name-input"]')!;
const addressInput = (element: HTMLElement) =>
  element.querySelector<HTMLInputElement>('[data-testid="address-input"]')!;

describe('renderPatientForm', () => {
  it('新規登録では入力欄が空になる', () => {
    const element = renderPatientForm(null, null, handlers());
    expect(nameInput(element).value).toBe('');
    expect(addressInput(element).value).toBe('');
    expect(element.textContent).toContain('新規登録');
  });

  it('編集では既存の値が入る', () => {
    const patient = createPatient('山田 太郎', '東京都千代田区1-1');
    const element = renderPatientForm(patient, null, handlers());
    expect(nameInput(element).value).toBe('山田 太郎');
    expect(addressInput(element).value).toBe('東京都千代田区1-1');
    expect(element.textContent).toContain('編集');
  });

  it('保存ボタンで入力値がonSaveに渡る', () => {
    const spies = handlers();
    const element = renderPatientForm(null, null, spies);
    nameInput(element).value = '鈴木 花子';
    addressInput(element).value = '大阪市北区2-2';
    element.querySelector<HTMLButtonElement>('[data-testid="save-button"]')?.click();
    expect(spies.onSave).toHaveBeenCalledWith('鈴木 花子', '大阪市北区2-2');
  });

  it('キャンセルボタンでonCancelが呼ばれる', () => {
    const spies = handlers();
    const element = renderPatientForm(null, null, spies);
    element.querySelector<HTMLButtonElement>('[data-testid="cancel-button"]')?.click();
    expect(spies.onCancel).toHaveBeenCalled();
  });

  it('住所が空のとき地図確認リンクは無効になる', () => {
    const element = renderPatientForm(null, null, handlers());
    const link = element.querySelector<HTMLAnchorElement>('[data-testid="map-check-link"]')!;
    expect(link.hasAttribute('href')).toBe(false);
  });

  it('住所を入力すると地図確認リンクが検索URLになる', () => {
    const element = renderPatientForm(null, null, handlers());
    const address = addressInput(element);
    address.value = '東京都千代田区1-1';
    address.dispatchEvent(new Event('input'));
    const link = element.querySelector<HTMLAnchorElement>('[data-testid="map-check-link"]')!;
    const url = new URL(link.href);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
    expect(url.searchParams.get('query')).toBe('東京都千代田区1-1');
  });

  it('メッセージがあれば表示する', () => {
    const element = renderPatientForm(null, { kind: 'error', text: '氏名を入力してください。' }, handlers());
    expect(element.querySelector('.message')?.textContent).toBe('氏名を入力してください。');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run tests/patientFormView.test.ts
```

期待: FAIL(`../src/views/patientFormView`が解決できない)。

- [ ] **Step 3: `src/views/patientFormView.ts`を作る**

```ts
import { buildGoogleMapsUrl } from '../googleMapsUrl';
import type { Message, Patient } from '../types';

export type PatientFormHandlers = {
  onSave(name: string, address: string): void;
  onCancel(): void;
};

export function renderPatientForm(
  patient: Patient | null,
  message: Message | null,
  handlers: PatientFormHandlers,
): HTMLElement {
  const container = document.createElement('div');

  const title = document.createElement('h1');
  title.textContent = patient === null ? '新規登録' : '編集';
  container.append(title);

  if (message) {
    const messageElement = document.createElement('p');
    messageElement.className = `message ${message.kind}`;
    messageElement.textContent = message.text;
    container.append(messageElement);
  }

  const nameField = document.createElement('label');
  nameField.className = 'field';
  nameField.textContent = '氏名';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = patient?.name ?? '';
  nameInput.dataset.testid = 'name-input';
  nameField.append(nameInput);

  const addressField = document.createElement('label');
  addressField.className = 'field';
  addressField.textContent = '住所';
  const addressInput = document.createElement('input');
  addressInput.type = 'text';
  addressInput.value = patient?.address ?? '';
  addressInput.dataset.testid = 'address-input';
  addressField.append(addressInput);

  const mapLink = document.createElement('a');
  mapLink.textContent = 'この住所をGoogleマップで確認';
  mapLink.target = '_blank';
  mapLink.rel = 'noreferrer';
  mapLink.dataset.testid = 'map-check-link';

  const updateMapLink = (): void => {
    const address = addressInput.value.trim();
    if (address.length === 0) {
      mapLink.removeAttribute('href');
      mapLink.classList.add('disabled');
      return;
    }
    mapLink.href = buildGoogleMapsUrl([address]);
    mapLink.classList.remove('disabled');
  };
  updateMapLink();
  addressInput.addEventListener('input', updateMapLink);

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'primary';
  saveButton.textContent = '保存';
  saveButton.dataset.testid = 'save-button';
  saveButton.addEventListener('click', () => handlers.onSave(nameInput.value, addressInput.value));

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.textContent = 'キャンセル';
  cancelButton.dataset.testid = 'cancel-button';
  cancelButton.addEventListener('click', () => handlers.onCancel());

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.append(saveButton, cancelButton);

  container.append(nameField, addressField, mapLink, actions);
  return container;
}
```

- [ ] **Step 4: `src/styles.css`の末尾に追記する**

```css
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
```

- [ ] **Step 5: テストを実行して成功を確認する**

```bash
npx vitest run tests/patientFormView.test.ts
```

期待: 7件すべてPASS。

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "feat: 患者の登録・編集フォームを追加"
```

---

### Task 11: 訪問順の並べ替えとルート表示

**Files:**
- Create: `src/views/routeOrderView.ts`, `src/openRoute.ts`
- Test: `tests/routeOrderView.test.ts`

**Interfaces:**
- Consumes: `MAX_STOPS_PER_ROUTE`(`src/config.ts`)、`splitIntoRoutes`(`src/routeSplitter.ts`)、`selectedPatients`(`src/state.ts`)、`findDuplicateAddresses`(`src/validation.ts`)
- Produces:
  - `openUrl(url: string): void`(`src/openRoute.ts`)
  - `type RouteOrderHandlers = { onMove(id: string, direction: -1 | 1): void; onOpenRoute(routeIndex: number): void; onBack(): void }`
  - `renderRouteOrder(state: AppState, openedRouteIndexes: ReadonlySet<number>, handlers: RouteOrderHandlers): HTMLElement`

- [ ] **Step 1: 失敗するテストを書く**

`tests/routeOrderView.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPatient } from '../src/patient';
import { createInitialState, toggleSelection } from '../src/state';
import { renderRouteOrder, type RouteOrderHandlers } from '../src/views/routeOrderView';
import type { AppState, Patient } from '../src/types';

const handlers = (): RouteOrderHandlers => ({
  onMove: vi.fn(),
  onOpenRoute: vi.fn(),
  onBack: vi.fn(),
});

function stateWithSelection(count: number, addresses?: string[]): AppState {
  const patients: Patient[] = Array.from({ length: count }, (_, i) =>
    createPatient(`患者${i + 1}`, addresses?.[i] ?? `東京都${i + 1}-1`),
  );
  let state = createInitialState(patients);
  for (const patient of patients) {
    state = toggleSelection(state, patient.id);
  }
  return state;
}

const openButtons = (element: HTMLElement) =>
  element.querySelectorAll<HTMLButtonElement>('[data-testid="open-route"]');

describe('renderRouteOrder', () => {
  it('選択した患者を訪問順に描画する', () => {
    const element = renderRouteOrder(stateWithSelection(3), new Set(), handlers());
    const rows = element.querySelectorAll('[data-testid="stop-row"]');
    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain('患者1');
  });

  it('出発地・経由地・到着地のラベルを表示する', () => {
    const element = renderRouteOrder(stateWithSelection(3), new Set(), handlers());
    const rows = element.querySelectorAll('[data-testid="stop-row"]');
    expect(rows[0]?.textContent).toContain('出発地');
    expect(rows[1]?.textContent).toContain('経由地');
    expect(rows[2]?.textContent).toContain('到着地');
  });

  it('先頭の「上へ」と末尾の「下へ」は押せない', () => {
    const element = renderRouteOrder(stateWithSelection(3), new Set(), handlers());
    const ups = element.querySelectorAll<HTMLButtonElement>('[data-testid="move-up"]');
    const downs = element.querySelectorAll<HTMLButtonElement>('[data-testid="move-down"]');
    expect(ups[0]?.disabled).toBe(true);
    expect(downs[downs.length - 1]?.disabled).toBe(true);
    expect(ups[1]?.disabled).toBe(false);
  });

  it('「上へ」でonMoveが-1つきで呼ばれる', () => {
    const state = stateWithSelection(2);
    const spies = handlers();
    const element = renderRouteOrder(state, new Set(), spies);
    element.querySelectorAll<HTMLButtonElement>('[data-testid="move-up"]')[1]?.click();
    expect(spies.onMove).toHaveBeenCalledWith(state.selectedIds[1], -1);
  });

  it('上限以内ならルートを開くボタンは1つ', () => {
    const element = renderRouteOrder(stateWithSelection(5), new Set(), handlers());
    expect(openButtons(element)).toHaveLength(1);
    expect(openButtons(element)[0]?.textContent).toContain('Googleマップで開く');
  });

  it('上限を超えるとルートごとにボタンが並ぶ', () => {
    const element = renderRouteOrder(stateWithSelection(10), new Set(), handlers());
    expect(openButtons(element)).toHaveLength(3);
    expect(openButtons(element)[0]?.textContent).toContain('ルート1');
  });

  it('分割されたボタンに含まれる患者名を表示する', () => {
    const element = renderRouteOrder(stateWithSelection(6), new Set(), handlers());
    expect(openButtons(element)[1]?.textContent).toContain('患者5');
    expect(openButtons(element)[1]?.textContent).toContain('患者6');
  });

  it('ボタンを押すとルート番号つきでonOpenRouteが呼ばれる', () => {
    const spies = handlers();
    const element = renderRouteOrder(stateWithSelection(10), new Set(), spies);
    openButtons(element)[1]?.click();
    expect(spies.onOpenRoute).toHaveBeenCalledWith(1);
  });

  it('開いたルートには印がつく', () => {
    const element = renderRouteOrder(stateWithSelection(10), new Set([0]), handlers());
    expect(openButtons(element)[0]?.textContent).toContain('✓');
    expect(openButtons(element)[1]?.textContent).not.toContain('✓');
  });

  it('同じ住所が複数あれば警告を出す', () => {
    const element = renderRouteOrder(
      stateWithSelection(3, ['東京都1-1', '大阪府2-2', '東京都1-1']),
      new Set(),
      handlers(),
    );
    expect(element.querySelector('[data-testid="duplicate-warning"]')?.textContent).toContain('同じ住所');
  });

  it('住所に重複がなければ警告を出さない', () => {
    const element = renderRouteOrder(stateWithSelection(3), new Set(), handlers());
    expect(element.querySelector('[data-testid="duplicate-warning"]')).toBeNull();
  });

  it('戻るボタンでonBackが呼ばれる', () => {
    const spies = handlers();
    const element = renderRouteOrder(stateWithSelection(2), new Set(), spies);
    element.querySelector<HTMLButtonElement>('[data-testid="back-button"]')?.click();
    expect(spies.onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run tests/routeOrderView.test.ts
```

期待: FAIL(`../src/views/routeOrderView`が解決できない)。

- [ ] **Step 3: `src/openRoute.ts`を作る**

```ts
/** 生成したGoogleマップURLへ遷移する。Googleマップアプリがあればアプリが開く。 */
export function openUrl(url: string): void {
  window.location.href = url;
}
```

- [ ] **Step 4: `src/views/routeOrderView.ts`を作る**

```ts
import { MAX_STOPS_PER_ROUTE } from '../config';
import { splitIntoRoutes } from '../routeSplitter';
import { selectedPatients } from '../state';
import { findDuplicateAddresses } from '../validation';
import type { AppState, Patient } from '../types';

export type RouteOrderHandlers = {
  onMove(id: string, direction: -1 | 1): void;
  onOpenRoute(routeIndex: number): void;
  onBack(): void;
};

export function renderRouteOrder(
  state: AppState,
  openedRouteIndexes: ReadonlySet<number>,
  handlers: RouteOrderHandlers,
): HTMLElement {
  const container = document.createElement('div');
  const stops = selectedPatients(state);

  const title = document.createElement('h1');
  title.textContent = '訪問順を決める';
  container.append(title);

  if (state.message) {
    const message = document.createElement('p');
    message.className = `message ${state.message.kind}`;
    message.textContent = state.message.text;
    container.append(message);
  }

  const duplicates = findDuplicateAddresses(stops);
  if (duplicates.length > 0) {
    const warning = document.createElement('p');
    warning.className = 'message error';
    warning.dataset.testid = 'duplicate-warning';
    warning.textContent = '同じ住所の患者が複数含まれています。このまま開くこともできます。';
    container.append(warning);
  }

  const list = document.createElement('ol');
  list.className = 'stop-list';
  stops.forEach((patient, index) => {
    list.append(renderStopRow(patient, index, stops.length, handlers));
  });
  container.append(list);

  const routes = splitIntoRoutes(stops, MAX_STOPS_PER_ROUTE);
  if (routes.length > 1) {
    const note = document.createElement('p');
    note.textContent = `1本のルートに入れられるのは${MAX_STOPS_PER_ROUTE}地点までのため、${routes.length}本に分けます。上から順に開いてください。`;
    container.append(note);
  }

  const routeActions = document.createElement('div');
  routeActions.className = 'route-actions';
  routes.forEach((route, index) => {
    routeActions.append(renderOpenButton(route, index, routes.length, openedRouteIndexes, handlers));
  });
  container.append(routeActions);

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.textContent = '一覧へ戻る';
  backButton.dataset.testid = 'back-button';
  backButton.addEventListener('click', () => handlers.onBack());
  container.append(backButton);

  return container;
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

  const role = document.createElement('span');
  role.className = 'stop-role';
  role.textContent = index === 0 ? '出発地' : index === total - 1 ? '到着地' : '経由地';

  const body = document.createElement('div');
  body.className = 'patient-body';
  const name = document.createElement('div');
  name.className = 'patient-name';
  name.textContent = patient.name;
  const address = document.createElement('div');
  address.className = 'patient-address';
  address.textContent = patient.address;
  body.append(name, address);

  const up = document.createElement('button');
  up.type = 'button';
  up.textContent = '↑';
  up.dataset.testid = 'move-up';
  up.disabled = index === 0;
  up.setAttribute('aria-label', `${patient.name} を上へ`);
  up.addEventListener('click', () => handlers.onMove(patient.id, -1));

  const down = document.createElement('button');
  down.type = 'button';
  down.textContent = '↓';
  down.dataset.testid = 'move-down';
  down.disabled = index === total - 1;
  down.setAttribute('aria-label', `${patient.name} を下へ`);
  down.addEventListener('click', () => handlers.onMove(patient.id, 1));

  row.append(role, body, up, down);
  return row;
}

function renderOpenButton(
  route: readonly Patient[],
  index: number,
  routeCount: number,
  openedRouteIndexes: ReadonlySet<number>,
  handlers: RouteOrderHandlers,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'primary open-route';
  button.dataset.testid = 'open-route';

  const opened = openedRouteIndexes.has(index) ? '✓ ' : '';
  const names = route.map((patient) => patient.name).join(' → ');
  button.textContent =
    routeCount === 1 ? `${opened}Googleマップで開く` : `${opened}ルート${index + 1}を開く(${names})`;

  button.addEventListener('click', () => handlers.onOpenRoute(index));
  return button;
}
```

- [ ] **Step 5: `src/styles.css`の末尾に追記する**

```css
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
```

- [ ] **Step 6: テストを実行して成功を確認する**

```bash
npx vitest run tests/routeOrderView.test.ts
```

期待: 12件すべてPASS。

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: 訪問順の並べ替えとルート分割表示を追加"
```

---

### Task 12: 設定画面(エクスポート・インポート)

**Files:**
- Create: `src/fileIo.ts`, `src/views/settingsView.ts`
- Test: `tests/settingsView.test.ts`

**Interfaces:**
- Consumes: `AppState`(`src/types.ts`)
- Produces:
  - `downloadTextFile(filename: string, text: string): void`(`src/fileIo.ts`)
  - `readTextFile(file: File): Promise<string>`(`src/fileIo.ts`)
  - `type SettingsHandlers = { onExport(): void; onImport(file: File, mode: 'replace' | 'merge'): void; onBack(): void }`
  - `renderSettings(state: AppState, handlers: SettingsHandlers): HTMLElement`

- [ ] **Step 1: 失敗するテストを書く**

`tests/settingsView.test.ts`:

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

function attachFile(element: HTMLElement, file: File): void {
  const input = element.querySelector<HTMLInputElement>('[data-testid="import-input"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
}

describe('renderSettings', () => {
  it('登録件数を表示する', () => {
    const state = createInitialState([createPatient('山田', '東京都'), createPatient('鈴木', '大阪府')]);
    const element = renderSettings(state, handlers());
    expect(element.textContent).toContain('2件');
  });

  it('エクスポートボタンでonExportが呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    element.querySelector<HTMLButtonElement>('[data-testid="export-button"]')?.click();
    expect(spies.onExport).toHaveBeenCalled();
  });

  it('ファイル未選択でインポートを押すと何も起きない', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    element.querySelector<HTMLButtonElement>('[data-testid="import-button"]')?.click();
    expect(spies.onImport).not.toHaveBeenCalled();
  });

  it('既定では全置換モードでインポートする', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    attachFile(element, file);
    element.querySelector<HTMLButtonElement>('[data-testid="import-button"]')?.click();
    expect(spies.onImport).toHaveBeenCalledWith(file, 'replace');
  });

  it('追記モードを選ぶとmergeで呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    const file = new File(['{}'], 'backup.json', { type: 'application/json' });
    attachFile(element, file);
    element.querySelector<HTMLInputElement>('[data-testid="mode-merge"]')!.checked = true;
    element.querySelector<HTMLButtonElement>('[data-testid="import-button"]')?.click();
    expect(spies.onImport).toHaveBeenCalledWith(file, 'merge');
  });

  it('戻るボタンでonBackが呼ばれる', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), spies);
    element.querySelector<HTMLButtonElement>('[data-testid="back-button"]')?.click();
    expect(spies.onBack).toHaveBeenCalled();
  });

  it('メッセージがあれば表示する', () => {
    const state = { ...createInitialState([]), message: { kind: 'info' as const, text: '2件を取り込みました。' } };
    const element = renderSettings(state, handlers());
    expect(element.querySelector('.message')?.textContent).toBe('2件を取り込みました。');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認する**

```bash
npx vitest run tests/settingsView.test.ts
```

期待: FAIL(`../src/views/settingsView`が解決できない)。

- [ ] **Step 3: `src/fileIo.ts`を作る**

```ts
/** テキストをファイルとしてダウンロードさせる。 */
export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function readTextFile(file: File): Promise<string> {
  return file.text();
}
```

- [ ] **Step 4: `src/views/settingsView.ts`を作る**

```ts
import type { AppState } from '../types';

export type SettingsHandlers = {
  onExport(): void;
  onImport(file: File, mode: 'replace' | 'merge'): void;
  onBack(): void;
};

export function renderSettings(state: AppState, handlers: SettingsHandlers): HTMLElement {
  const container = document.createElement('div');

  const title = document.createElement('h1');
  title.textContent = '設定';
  container.append(title);

  if (state.message) {
    const message = document.createElement('p');
    message.className = `message ${state.message.kind}`;
    message.textContent = state.message.text;
    container.append(message);
  }

  const count = document.createElement('p');
  count.textContent = `登録されている患者: ${state.patients.length}件`;
  container.append(count);

  const exportHeading = document.createElement('h2');
  exportHeading.textContent = 'バックアップの書き出し';
  const exportNote = document.createElement('p');
  exportNote.textContent = '患者データをJSONファイルとして保存します。';
  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'primary';
  exportButton.textContent = 'エクスポート';
  exportButton.dataset.testid = 'export-button';
  exportButton.addEventListener('click', () => handlers.onExport());
  container.append(exportHeading, exportNote, exportButton);

  const importHeading = document.createElement('h2');
  importHeading.textContent = 'バックアップの読み込み';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.dataset.testid = 'import-input';
  fileInput.setAttribute('aria-label', 'バックアップファイルを選ぶ');

  const replaceRadio = document.createElement('input');
  replaceRadio.type = 'radio';
  replaceRadio.name = 'import-mode';
  replaceRadio.value = 'replace';
  replaceRadio.checked = true;
  replaceRadio.dataset.testid = 'mode-replace';
  const replaceLabel = document.createElement('label');
  replaceLabel.append(replaceRadio, document.createTextNode(' 今のデータを消して入れ替える'));

  const mergeRadio = document.createElement('input');
  mergeRadio.type = 'radio';
  mergeRadio.name = 'import-mode';
  mergeRadio.value = 'merge';
  mergeRadio.dataset.testid = 'mode-merge';
  const mergeLabel = document.createElement('label');
  mergeLabel.append(mergeRadio, document.createTextNode(' 今のデータに追加する'));

  const importButton = document.createElement('button');
  importButton.type = 'button';
  importButton.textContent = 'インポート';
  importButton.dataset.testid = 'import-button';
  importButton.addEventListener('click', () => {
    const file = fileInput.files?.[0];
    if (!file) {
      return;
    }
    handlers.onImport(file, mergeRadio.checked ? 'merge' : 'replace');
  });

  const modes = document.createElement('div');
  modes.className = 'modes';
  modes.append(replaceLabel, mergeLabel);

  container.append(importHeading, fileInput, modes, importButton);

  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.textContent = '一覧へ戻る';
  backButton.dataset.testid = 'back-button';
  backButton.addEventListener('click', () => handlers.onBack());
  container.append(backButton);

  return container;
}
```

- [ ] **Step 5: `src/styles.css`の末尾に追記する**

```css
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

- [ ] **Step 6: テストを実行して成功を確認する**

```bash
npx vitest run tests/settingsView.test.ts
```

期待: 7件すべてPASS。

- [ ] **Step 7: コミット**

```bash
git add -A
git commit -m "feat: エクスポート・インポートの設定画面を追加"
```

---

### Task 13: 画面の結線(アプリとして動かす)

**Files:**
- Modify: `src/main.ts`(Task 1で作った内容を全面的に置き換える)

**Interfaces:**
- Consumes: Task 2〜12で作ったすべてのモジュール
- Produces: 動作するアプリ本体(他のタスクから参照されるエクスポートはない)

- [ ] **Step 1: `src/main.ts`を書き換える**

```ts
import './styles.css';
import { parseBackup, serializeBackup } from './backup';
import { MAX_STOPS_PER_ROUTE } from './config';
import { deletePatient, listPatients, mergePatients, replaceAllPatients, savePatient } from './db';
import { downloadTextFile, readTextFile } from './fileIo';
import { buildGoogleMapsUrl } from './googleMapsUrl';
import { openUrl } from './openRoute';
import { createPatient, updatePatientFields } from './patient';
import { splitIntoRoutes } from './routeSplitter';
import {
  createInitialState,
  moveSelected,
  selectedPatients,
  setSearchQuery,
  toggleSelection,
  withMessage,
  withPatients,
  withScreen,
} from './state';
import type { AppState, Message, Patient } from './types';
import { validatePatientInput, validateSelection } from './validation';
import { renderPatientForm } from './views/patientFormView';
import { renderPatientList } from './views/patientListView';
import { renderRouteOrder } from './views/routeOrderView';
import { renderSettings } from './views/settingsView';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('#app が見つかりません。');
}

let state: AppState = createInitialState([]);
const openedRouteIndexes = new Set<number>();

function setState(next: AppState): void {
  state = next;
  render();
}

async function reloadPatients(message: Message | null = null): Promise<void> {
  try {
    const patients = await listPatients();
    setState({ ...withPatients(state, patients), message });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを読み込めませんでした。' }));
  }
}

function currentEditingPatient(): Patient | null {
  const screen = state.screen;
  if (screen.name !== 'form' || screen.patientId === null) {
    return null;
  }
  const id = screen.patientId;
  return state.patients.find((patient) => patient.id === id) ?? null;
}

async function handleSave(name: string, address: string): Promise<void> {
  const validation = validatePatientInput(name, address);
  if (!validation.ok) {
    setState(withMessage(state, { kind: 'error', text: validation.message }));
    return;
  }
  try {
    const existing = currentEditingPatient();
    const patient =
      existing === null ? createPatient(name, address) : updatePatientFields(existing, name, address);
    await savePatient(patient);
    setState(withScreen(state, { name: 'list' }));
    await reloadPatients({ kind: 'info', text: '保存しました。' });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを保存できませんでした。' }));
  }
}

async function handleDelete(id: string): Promise<void> {
  const patient = state.patients.find((item) => item.id === id);
  if (!patient) {
    return;
  }
  if (!window.confirm(`${patient.name} を削除します。よろしいですか?`)) {
    return;
  }
  try {
    await deletePatient(id);
    await reloadPatients({ kind: 'info', text: '削除しました。' });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを削除できませんでした。' }));
  }
}

function handleOpenRoute(routeIndex: number): void {
  const routes = splitIntoRoutes(selectedPatients(state), MAX_STOPS_PER_ROUTE);
  const route = routes[routeIndex];
  if (!route) {
    return;
  }
  try {
    const url = buildGoogleMapsUrl(route.map((patient) => patient.address));
    openedRouteIndexes.add(routeIndex);
    render();
    openUrl(url);
  } catch (error) {
    setState(withMessage(state, { kind: 'error', text: (error as Error).message }));
  }
}

function handleExport(): void {
  try {
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(`route-auto-input-${date}.json`, serializeBackup(state.patients));
    setState(withMessage(state, { kind: 'info', text: 'バックアップを書き出しました。' }));
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'バックアップを書き出せませんでした。' }));
  }
}

async function handleImport(file: File, mode: 'replace' | 'merge'): Promise<void> {
  try {
    const patients = parseBackup(await readTextFile(file));
    const question =
      mode === 'replace'
        ? `今のデータ${state.patients.length}件を消して、${patients.length}件を取り込みます。よろしいですか?`
        : `${patients.length}件を今のデータに追加します。よろしいですか?`;
    if (!window.confirm(question)) {
      return;
    }
    if (mode === 'replace') {
      await replaceAllPatients(patients);
    } else {
      await mergePatients(patients);
    }
    await reloadPatients({ kind: 'info', text: `${patients.length}件を取り込みました。` });
  } catch (error) {
    setState(withMessage(state, { kind: 'error', text: (error as Error).message }));
  }
}

function renderScreen(): HTMLElement {
  switch (state.screen.name) {
    case 'list':
      return renderPatientList(state, {
        onSearch: (query) => setState(setSearchQuery(state, query)),
        onToggleSelect: (id) => setState(toggleSelection(state, id)),
        onNew: () => setState(withScreen(state, { name: 'form', patientId: null })),
        onEdit: (id) => setState(withScreen(state, { name: 'form', patientId: id })),
        onDelete: (id) => {
          void handleDelete(id);
        },
        onNext: () => {
          const validation = validateSelection(state.selectedIds.length);
          if (!validation.ok) {
            setState(withMessage(state, { kind: 'error', text: validation.message }));
            return;
          }
          openedRouteIndexes.clear();
          setState(withScreen(state, { name: 'order' }));
        },
        onOpenSettings: () => setState(withScreen(state, { name: 'settings' })),
      });
    case 'form':
      return renderPatientForm(currentEditingPatient(), state.message, {
        onSave: (name, address) => {
          void handleSave(name, address);
        },
        onCancel: () => setState(withScreen(state, { name: 'list' })),
      });
    case 'order':
      return renderRouteOrder(state, openedRouteIndexes, {
        onMove: (id, direction) => setState(moveSelected(state, id, direction)),
        onOpenRoute: handleOpenRoute,
        onBack: () => setState(withScreen(state, { name: 'list' })),
      });
    case 'settings':
      return renderSettings(state, {
        onExport: handleExport,
        onImport: (file, mode) => {
          void handleImport(file, mode);
        },
        onBack: () => setState(withScreen(state, { name: 'list' })),
      });
  }
}

/**
 * 画面全体を作り直すため、そのままでは検索欄に1文字打つたびに
 * フォーカスが外れる。描画の前後でフォーカス位置を引き継ぐ。
 */
function render(): void {
  const active = document.activeElement;
  const testid = active instanceof HTMLElement ? active.dataset.testid : undefined;
  const caret = active instanceof HTMLInputElement ? active.selectionStart : null;

  root!.replaceChildren(renderScreen());

  if (testid === undefined) {
    return;
  }
  const restored = root!.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  if (!restored) {
    return;
  }
  restored.focus();
  if (restored instanceof HTMLInputElement && restored.type === 'text' && caret !== null) {
    restored.setSelectionRange(caret, caret);
  }
}

render();
void reloadPatients();
```

- [ ] **Step 2: 全テストと型チェックとビルドを通す**

```bash
npm run test && npm run typecheck && npm run build
```

期待: すべてのテストがPASS、型エラーなし、`dist/`が生成される。

- [ ] **Step 3: 開発サーバーで手で確かめる**

```bash
npm run dev
```

ブラウザで表示されたURLを開き、以下を上から順に確認する。

1. 「まだ患者が登録されていません」と表示される
2. 「＋ 新規登録」で氏名・住所を入れて保存 → 一覧に出る
3. 氏名を空にして保存 → 「氏名を入力してください。」が出て保存されない
4. 患者を6人登録する
5. 検索欄に文字を打っても**入力欄からフォーカスが外れない**、絞り込みが効く
6. 6人すべてを選ぶ → 「選択中: 6 / 10」と表示される
7. 「次へ」→ 訪問順の画面で↑↓を押すと順番が入れ替わる
8. 「1本のルートに入れられるのは5地点までのため、2本に分けます」と表示され、ボタンが2つ出る
9. 「ルート1を開く」を押す → Googleマップが5地点の経路で開く
10. ブラウザで戻る → 「ルート1」に✓が付いている
11. 「設定」→「エクスポート」でJSONがダウンロードされる
12. 患者を1人削除 → 確認ダイアログが出て、OKで消える
13. 「設定」→ さきほどのJSONを選び「今のデータを消して入れ替える」でインポート → 件数が戻る
14. ブラウザを再読み込みしてもデータが残っている

- [ ] **Step 4: コミット**

```bash
git add -A
git commit -m "feat: 各画面を結線してアプリとして動作させる"
```

---

### Task 14: PWA化(ホーム画面へ追加・オフライン起動)

**Files:**
- Create: `assets/icon.svg`, `scripts/generate-icons.mjs`
- Modify: `vite.config.ts`, `index.html`, `package.json`(`icons`スクリプト追加)

**Interfaces:**
- Consumes: なし
- Produces: `public/pwa-192.png`, `public/pwa-512.png`, `public/apple-touch-icon.png`、`dist/manifest.webmanifest`、`dist/sw.js`

- [ ] **Step 1: `assets/icon.svg`を作る**

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#0b57d0"/>
  <path d="M136 376 C136 288 376 304 376 216" fill="none" stroke="#ffffff" stroke-width="20"
        stroke-linecap="round" stroke-dasharray="2 40"/>
  <circle cx="136" cy="376" r="44" fill="#ffffff"/>
  <circle cx="136" cy="376" r="20" fill="#0b57d0"/>
  <circle cx="376" cy="216" r="44" fill="#ffffff"/>
  <circle cx="376" cy="216" r="20" fill="#0b57d0"/>
</svg>
```

- [ ] **Step 2: `scripts/generate-icons.mjs`を作る**

```js
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const SOURCE = 'assets/icon.svg';
const OUTPUTS = [
  { path: 'public/pwa-192.png', size: 192 },
  { path: 'public/pwa-512.png', size: 512 },
  // iOSのホーム画面用。透過なしの正方形が必要。
  { path: 'public/apple-touch-icon.png', size: 180 },
];

await mkdir('public', { recursive: true });

for (const { path, size } of OUTPUTS) {
  await sharp(SOURCE).resize(size, size).png().toFile(path);
  console.log(`generated ${path}`);
}
```

- [ ] **Step 3: `package.json`の`scripts`に追加する**

```json
"icons": "node scripts/generate-icons.mjs"
```

- [ ] **Step 4: アイコンを生成する**

```bash
npm run icons
```

期待: `public/pwa-192.png`、`public/pwa-512.png`、`public/apple-touch-icon.png`の3つが作られる。

- [ ] **Step 5: `vite.config.ts`をPWA対応に書き換える**

```ts
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/route-auto-input/',
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'ルート自動入力',
        short_name: 'ルート',
        description: '登録した患者の住所を、訪問順にGoogleマップの経路へ渡します。',
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

- [ ] **Step 6: `index.html`の`<head>`に追記する**

`<title>`の下に以下を足す。

```html
<meta name="theme-color" content="#0b57d0" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="ルート自動入力" />
<link rel="apple-touch-icon" href="/route-auto-input/apple-touch-icon.png" />
```

- [ ] **Step 7: ビルドして生成物を確認する**

```bash
npm run build && ls dist
```

期待: `dist`に`manifest.webmanifest`、`sw.js`、`pwa-192.png`、`pwa-512.png`、`apple-touch-icon.png`、`index.html`が並ぶ。

- [ ] **Step 8: 本番相当の動作を確認する**

```bash
npm run preview
```

ブラウザの開発者ツール → Application → Manifest でアプリ名が「ルート自動入力」、アイコンが表示されることを確認する。Service Workers に登録済みのワーカーがあることを確認する。

- [ ] **Step 9: 全テストと型チェックを通す**

```bash
npm run test && npm run typecheck
```

期待: すべてPASS。

- [ ] **Step 10: コミット**

```bash
git add -A
git commit -m "feat: PWAのマニフェスト・アイコン・オフライン対応を追加"
```

---

### Task 15: GitHub Pagesへの公開とREADME

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`

**Interfaces:**
- Consumes: なし
- Produces: 公開URL `https://<GitHubユーザー名>.github.io/route-auto-input/`

- [ ] **Step 1: `.github/workflows/deploy.yml`を作る**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: npm
      - run: npm ci
      - run: npm run test
      - run: npm run typecheck
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: `README.md`を作る**

````markdown
# ルート自動入力

登録した患者の住所を訪問順に並べ、Googleマップの経路画面へ渡すWebアプリ(PWA)です。
iPadのSafariで開き、ホーム画面に追加して使います。

## データの扱い

- 患者データはiPadのブラウザ内(IndexedDB)にのみ保存されます。サーバーへは送信しません。
- GitHubに公開されるのはアプリの画面だけで、患者データは含まれません。
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

## 公開の手順(初回のみ)

1. github.com で `route-auto-input` という名前のリポジトリを作る。
   **無料アカウントでGitHub Pagesを使うにはPublic(公開)にする必要がある。**
   公開されるのはアプリのコードだけで、患者データは含まれない。
2. 手元のリポジトリを繋いで push する。

   ```bash
   git branch -M main
   git remote add origin https://github.com/<GitHubユーザー名>/route-auto-input.git
   git push -u origin main
   ```

3. GitHubのリポジトリ → Settings → Pages → Build and deployment → Source を
   **GitHub Actions** に変更する。
4. Actions タブでデプロイの完了を待つ。
5. `https://<GitHubユーザー名>.github.io/route-auto-input/` が公開URL。

以降は `main` に push するたびに自動で公開される。

## iPadへの導入

1. SafariでREADMEの公開URLを開く。
2. 共有ボタン → 「ホーム画面に追加」。
3. ホーム画面のアイコンから起動する。

## 経由地の上限について

Googleマップの公式仕様では、経路URLの経由地の上限は
「モバイルブラウザで3件、それ以外で9件」と、リンクを開く環境によって変わる。

本アプリは確実に動く 5地点(出発地1 + 経由地3 + 到着地1)を1ルートの上限とし、
それを超える人数を選んだ場合はルートを自動で分割する。

上限は `src/config.ts` の `MAX_STOPS_PER_ROUTE` だけで決まる。
下の実機テストで経由地9件が通ることを確認できたら、この値を `10` に変えると
10人が1本のルートで開くようになる。

## 実機テスト(iPadで一度行う)

- [ ] Safariで公開URLを開き、「ホーム画面に追加」ができる
- [ ] ホーム画面のアイコンから起動し、氏名・住所を登録できる
- [ ] Safariを完全に終了して再起動してもデータが残っている
- [ ] 2人を選び、順番を入れ替えて、Googleマップが正しい経路で開く
- [ ] **10人を選び、分割された3本のルートがそれぞれ正しく開く**
- [ ] **経由地9件のURLを直接Safariに貼り付け、11地点の経路が表示できるか確認する**
      (表示できたら `MAX_STOPS_PER_ROUTE` を10に変更し、10人が1本で開くことを再確認する)
- [ ] Googleマップアプリを削除した状態でもWeb版が開く
- [ ] エクスポートしたファイルをインポートし直すと同じ一覧に戻る
- [ ] 機内モードでもアプリの画面自体は開く

## ドキュメント

- 設計: `docs/superpowers/specs/2026-09-02-route-auto-input-design.md`
- 実装計画: `docs/superpowers/plans/2026-09-02-route-auto-input.md`
````

- [ ] **Step 3: ブランチ名を`main`にしてコミットする**

```bash
git branch -M main
git add -A
git commit -m "chore: GitHub Pagesへのデプロイ設定とREADMEを追加"
```

- [ ] **Step 4: GitHub上の作業(利用者が行う)**

`gh`コマンドが入っていないため、以下はブラウザで行う。

1. github.com → 右上「+」→ New repository
2. Repository name に `route-auto-input`、**Public** を選ぶ(無料アカウントでPagesを使うため)
3. READMEやgitignoreの追加はチェックしない → Create repository
4. 表示されたURLを使って push する

   ```bash
   git remote add origin https://github.com/<GitHubユーザー名>/route-auto-input.git
   git push -u origin main
   ```

5. Settings → Pages → Source を「GitHub Actions」にする
6. Actions タブでデプロイ完了を待ち、公開URLを開く

- [ ] **Step 5: iPadで実機テストを行う**

READMEの「実機テスト」チェックリストを上から実施する。
`MAX_STOPS_PER_ROUTE`を変更した場合は、変更をコミットして push し、
再デプロイ後にもう一度10人のケースを確認する。

---

## 完了の定義

- `npm run test`、`npm run typecheck`、`npm run build`がすべて通る
- iPadのホーム画面から起動でき、患者の登録・選択・並べ替え・Googleマップ遷移ができる
- READMEの実機テストチェックリストがすべて埋まっている
- `MAX_STOPS_PER_ROUTE`の最終値が実機の結果に基づいて決まっている
