# 段階2: 出発地・帰着地・履歴から選ぶ・訪問済みと時刻 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 事業所からの出発・帰着を含むルート、履歴からの呼び出し(先週の同じ曜日)、訪問済みの時刻の記録を基本版に入れ、公開して実機で試運転できる状態にする。

**Architecture:** 純粋な計算は新しい小さなモジュール(`routePlan.ts`: 出発地・帰着地を含めたルートの組み立て、`history.ts`: 履歴の日付・曜日・復元)に置く。保存は `db.ts` の `meta`(事業所・出発帰着の選び方)と新しい `history` ストア(DB v3)。画面は既存の views の流儀(handlers を受け取って DOM を組む)で、履歴は新しい画面 `historyView.ts`。副作用の配線は `main.ts`。

**Tech Stack:** Vite + TypeScript(フレームワークなし)、IndexedDB(`idb`)、Vitest + jsdom + fake-indexeddb。

**Spec:** `docs/superpowers/specs/2026-09-24-brushup-design.md` の 4章・7章・8章(段階1は main の ca875de に取り込み済み)。

## Global Constraints

- データは端末の中だけ。サーバーへ送らない。履歴に入れるのは訪問先の id・順番・出発帰着の選び方・時刻だけ(名前・住所は入れない)。`localStorage` には設定値とフラグだけ。
- 画面の文言に禁止語(`tests/wording.test.ts` の `FORBIDDEN`: 患者・薬局・在宅・医療・利用者・ルート自動入力)を使わない。
- 文字は 14px 以上、タップ領域は 44px(`--tap-min`)以上。色は `styles.css` の変数だけ(新しい16進数の色を足さない)。
- ルートの共有(LINE)は今までどおり受け取る人の現在地から始め、事業所は送らない。
- TDD: テスト → 失敗の確認 → 実装 → 成功の確認 → コミット。コミットは `git -c user.name=okaka2 -c user.email=okaka2@users.noreply.github.com commit` で、末尾に `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。push は利用者の確認を得てから。
- コマンドはリポジトリ `C:\Users\owner\Desktop\route-auto-input` で実行。`npm test`、`npx vitest run tests/<name>.test.ts`、`npm run typecheck`。各タスクの終わりに両方が通ること。
- `MAX_STOPS_PER_ROUTE`(10)は変えない。出発地・帰着地に事業所を使う分だけ、1ルートに入る訪問先が減る。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `src/routePlan.ts` (新規) | 出発地・帰着地の型、1ルートの訪問先の上限、ルートごとの地点の組み立て。**Task 1** |
| `src/db.ts` | `MetaValues` に `office`・`routeEnds`。DB v3 で `history` ストア。**Task 2, 4** |
| `src/views/settingsView.ts` | 先頭に「出発地・帰着地」(事業所の登録)。「データの保存状態」に「履歴をすべて消す」。**Task 2, 6** |
| `src/views/routeOrderView.ts` | 上に出発・帰着の選択。区切りは実効の上限で。**Task 3** |
| `src/views/routeMapView.ts` | カードに出発・帰着の表示、各訪問先に「済」。**Task 3, 6** |
| `src/history.ts` (新規) | 日付キー、曜日、先週の同じ曜日、復元、古い記録の判定、日報の文。**Task 4** |
| `src/views/historyView.ts` (新規) | 履歴の画面(一覧・曜日の絞り込み・詳細・この人たちを選ぶ・コピー)。**Task 5, 6** |
| `src/views/patientListView.ts` | 「履歴から選ぶ」「先週の○曜日と同じ(N人)」。**Task 5** |
| `src/types.ts` | `Screen` に `history`。**Task 5** |
| `src/main.ts` | 読み込み・保存・配線。各タスク。 |

---

### Task 1: 出発地・帰着地を含めたルートの組み立て(純粋な関数)

**Files:**
- Create: `src/routePlan.ts`、`tests/routePlan.test.ts`

**Interfaces:**
- Produces:
```ts
export type Office = { name: string; address: string };
export type RouteStart = 'office' | 'current' | 'first';
export type RouteEnd = 'office' | 'last';
export type RouteEnds = { start: RouteStart; end: RouteEnd };
export const DEFAULT_ROUTE_ENDS: RouteEnds = { start: 'first', end: 'last' };
/** 事業所を使う地点の数(0〜2)。事業所が未登録なら office の指定は無視して 0 と数える。 */
export function officeStopCount(ends: RouteEnds, office: Office | null): number;
/** 1ルートに入れられる訪問先の数。 */
export function stopsPerRoute(ends: RouteEnds, office: Office | null, maxStops: number): number;
export type RoutePlan<T> = {
  stops: T[];                 // このルートの訪問先(分割の境目は前後に重なる)
  addresses: string[];        // 地図に渡す住所の並び(事業所を含む)
  fromCurrentLocation: boolean; // 1本目で「現在地から」のときだけ true
  startLabel: string;         // '事業所から' | '現在地から' | ''(1件目の訪問先から)
  endLabel: string;           // '事業所へ戻る' | ''
};
/** 訪問順の訪問先を、出発地・帰着地を含めてルートごとに組み立てる。 */
export function buildRoutePlans<T extends { address: string }>(stops: readonly T[], ends: RouteEnds, office: Office | null, maxStops: number): RoutePlan<T>[];
```
- 使い方の約束: 1本目だけ出発地(事業所の住所を先頭に足す/現在地なら `fromCurrentLocation`)、最後の1本だけ帰着地(事業所の住所を末尾に足す)。途中のルートは `splitIntoRoutes` の重なりで前のルートの最後から続く。事業所が未登録のときは `start: 'office'` は `'first'`、`end: 'office'` は `'last'` として扱う。

- [ ] **Step 1: テストを書く**

`tests/routePlan.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildRoutePlans, officeStopCount, stopsPerRoute, type Office, type RouteEnds } from '../src/routePlan';

const office: Office = { name: '事業所', address: '東京都中央区0-0-0' };
const stops = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, address: `住所${i + 1}` }));
const ends = (start: RouteEnds['start'], end: RouteEnds['end']): RouteEnds => ({ start, end });

describe('officeStopCount / stopsPerRoute', () => {
  it('事業所を出発と帰着に使えば2地点ぶん減る', () => {
    expect(officeStopCount(ends('office', 'office'), office)).toBe(2);
    expect(stopsPerRoute(ends('office', 'office'), office, 10)).toBe(8);
  });
  it('現在地から/最後の訪問先で終わるなら減らない', () => {
    expect(stopsPerRoute(ends('current', 'last'), office, 10)).toBe(10);
    expect(stopsPerRoute(ends('first', 'last'), null, 10)).toBe(10);
  });
  it('事業所が未登録なら office の指定は無視する', () => {
    expect(officeStopCount(ends('office', 'office'), null)).toBe(0);
  });
});

describe('buildRoutePlans', () => {
  it('事業所から出て事業所へ戻る1本のルート', () => {
    const [plan] = buildRoutePlans(stops(3), ends('office', 'office'), office, 10);
    expect(plan!.addresses).toEqual([office.address, '住所1', '住所2', '住所3', office.address]);
    expect(plan!.fromCurrentLocation).toBe(false);
    expect(plan!.startLabel).toBe('事業所から');
    expect(plan!.endLabel).toBe('事業所へ戻る');
  });
  it('現在地から出発なら1本目だけ fromCurrentLocation で、事業所の住所は先頭に足さない', () => {
    const plans = buildRoutePlans(stops(12), ends('current', 'office'), office, 10);
    expect(plans).toHaveLength(2);
    expect(plans[0]!.fromCurrentLocation).toBe(true);
    expect(plans[0]!.addresses[0]).toBe('住所1');
    expect(plans[1]!.fromCurrentLocation).toBe(false);
    expect(plans[1]!.addresses.at(-1)).toBe(office.address);
    expect(plans[0]!.addresses.at(-1)).not.toBe(office.address);
  });
  it('分割の境目は前後のルートに重なり、事業所ぶんだけ訪問先が減る', () => {
    const plans = buildRoutePlans(stops(9), ends('office', 'office'), office, 10);
    expect(plans).toHaveLength(2);
    expect(plans[0]!.stops.map((s) => s.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
    expect(plans[1]!.stops.map((s) => s.id)).toEqual(['p8', 'p9']);
    expect(plans[0]!.addresses).toHaveLength(9);
    expect(plans[1]!.addresses).toEqual(['住所8', '住所9', office.address]);
  });
  it('1件目の訪問先から/最後の訪問先で終わるなら住所だけ', () => {
    const [plan] = buildRoutePlans(stops(2), ends('first', 'last'), office, 10);
    expect(plan!.addresses).toEqual(['住所1', '住所2']);
    expect(plan!.startLabel).toBe('');
    expect(plan!.endLabel).toBe('');
  });
  it('事業所が未登録なら office の指定を無視する', () => {
    const [plan] = buildRoutePlans(stops(2), ends('office', 'office'), null, 10);
    expect(plan!.addresses).toEqual(['住所1', '住所2']);
  });
  it('0件なら空', () => {
    expect(buildRoutePlans([], ends('office', 'office'), office, 10)).toEqual([]);
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run tests/routePlan.test.ts` → FAIL(モジュールが無い)

- [ ] **Step 3: `src/routePlan.ts` を書く**

```ts
import { splitIntoRoutes } from './routeSplitter';

export type Office = { name: string; address: string };
export type RouteStart = 'office' | 'current' | 'first';
export type RouteEnd = 'office' | 'last';
export type RouteEnds = { start: RouteStart; end: RouteEnd };

export const DEFAULT_ROUTE_ENDS: RouteEnds = { start: 'first', end: 'last' };

/** 事業所が未登録なら、事業所を使う指定は「1件目の訪問先から」「最後の訪問先で終わる」に読み替える。 */
function effectiveEnds(ends: RouteEnds, office: Office | null): RouteEnds {
  if (office !== null) {
    return ends;
  }
  return { start: ends.start === 'office' ? 'first' : ends.start, end: 'last' };
}

export function officeStopCount(ends: RouteEnds, office: Office | null): number {
  const e = effectiveEnds(ends, office);
  return (e.start === 'office' ? 1 : 0) + (e.end === 'office' ? 1 : 0);
}

export function stopsPerRoute(ends: RouteEnds, office: Office | null, maxStops: number): number {
  return maxStops - officeStopCount(ends, office);
}

export type RoutePlan<T> = {
  stops: T[];
  addresses: string[];
  fromCurrentLocation: boolean;
  startLabel: string;
  endLabel: string;
};

/**
 * 訪問順の訪問先を、出発地・帰着地を含めてルートごとに組み立てる。
 * 1本目だけ出発地を付け、最後の1本だけ帰着地を付ける。途中は前のルートの最後の訪問先から続く。
 */
export function buildRoutePlans<T extends { address: string }>(
  stops: readonly T[],
  ends: RouteEnds,
  office: Office | null,
  maxStops: number,
): RoutePlan<T>[] {
  const e = effectiveEnds(ends, office);
  const routes = splitIntoRoutes(stops, stopsPerRoute(e, office, maxStops));
  return routes.map((route, index) => {
    const first = index === 0;
    const last = index === routes.length - 1;
    const addresses = route.map((stop) => stop.address);
    if (first && e.start === 'office' && office) {
      addresses.unshift(office.address);
    }
    if (last && e.end === 'office' && office) {
      addresses.push(office.address);
    }
    return {
      stops: [...route],
      addresses,
      fromCurrentLocation: first && e.start === 'current',
      startLabel: first ? (e.start === 'office' ? '事業所から' : e.start === 'current' ? '現在地から' : '') : '',
      endLabel: last && e.end === 'office' ? '事業所へ戻る' : '',
    };
  });
}
```
注: `splitIntoRoutes` は上限が 2 未満だと例外を投げる。`maxStops` は 10 固定で事業所は最大 2 なので 8 以上になり問題ない。

- [ ] **Step 4: テストを通す** — Run: `npx vitest run tests/routePlan.test.ts` → PASS

- [ ] **Step 5: コミット**
```bash
git add src/routePlan.ts tests/routePlan.test.ts
git commit -m "feat: 出発地・帰着地を含めてルートを組み立てる関数を足す"
```

---

### Task 2: 事業所と出発・帰着の選び方を保存し、設定に「出発地・帰着地」を足す

**Files:**
- Modify: `src/db.ts`(`MetaValues`)、`tests/db.test.ts`
- Modify: `src/views/settingsView.ts`、`tests/settingsView.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Produces: `MetaValues` に `office: Office`、`routeEnds: RouteEnds`。`getMeta('office')` / `setMeta('office', …)` / 新規 `deleteMeta(key)`。
- Produces: `SettingsInfo` に `office: Office | null`。`SettingsHandlers` に `onSaveOffice(name: string, address: string): void`、`onClearOffice(): void`。
- Produces: `main.ts` に `let routeContext: { ends: RouteEnds; office: Office | null }`(起動時に `loadRouteContext()` で読む。Task 3 が使う)。

- [ ] **Step 1: db のテスト**

`tests/db.test.ts` に追加:
```ts
import { deleteMeta } from '../src/db';
describe('meta: 事業所と出発・帰着', () => {
  it('事業所を保存・削除できる', async () => {
    await setMeta('office', { name: '本店', address: '東京都中央区1-1' });
    expect(await getMeta('office')).toEqual({ name: '本店', address: '東京都中央区1-1' });
    await deleteMeta('office');
    expect(await getMeta('office')).toBeUndefined();
  });
  it('出発・帰着の選び方を保存できる', async () => {
    await setMeta('routeEnds', { start: 'office', end: 'last' });
    expect(await getMeta('routeEnds')).toEqual({ start: 'office', end: 'last' });
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run tests/db.test.ts` → FAIL

- [ ] **Step 3: `src/db.ts`**
```ts
import type { Office, RouteEnds } from './routePlan';
export type MetaValues = {
  lastBackupAt: string;
  office: Office;
  routeEnds: RouteEnds;
};
export async function deleteMeta(key: keyof MetaValues): Promise<void> {
  const db = await getDb();
  await db.delete(META_STORE, key);
}
```

- [ ] **Step 4: テストを通す** — Run: `npx vitest run tests/db.test.ts` → PASS

- [ ] **Step 5: 設定画面のテスト**

`tests/settingsView.test.ts` の `info()` に `office: null`、`handlers()` に `onSaveOffice: vi.fn(), onClearOffice: vi.fn()` を足し:
```ts
describe('renderSettings: 出発地・帰着地', () => {
  it('見出しの先頭が「出発地・帰着地」になる', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    expect(element.querySelector('h2')?.textContent).toBe('出発地・帰着地');
  });
  it('未登録なら入力欄と「保存」、登録済みなら名前・住所と「消す」を出す', () => {
    const none = renderSettings(createInitialState([]), info(), handlers());
    expect(q<HTMLInputElement>(none, 'office-name-input').value).toBe('');
    expect(q(none, 'office-save-button').textContent).toBe('保存');
    const saved = renderSettings(createInitialState([]), { ...info(), office: { name: '本店', address: '東京都中央区1-1' } }, handlers());
    expect(q<HTMLInputElement>(saved, 'office-name-input').value).toBe('本店');
    expect(q<HTMLInputElement>(saved, 'office-address-input').value).toBe('東京都中央区1-1');
    expect(q(saved, 'office-clear-button')).not.toBeNull();
  });
  it('「保存」で onSaveOffice(name, address)、「消す」で onClearOffice', () => {
    const spies = handlers();
    const element = renderSettings(createInitialState([]), { ...info(), office: { name: '本店', address: 'X' } }, spies);
    q<HTMLInputElement>(element, 'office-name-input').value = '支店';
    q<HTMLInputElement>(element, 'office-address-input').value = '大阪府';
    q<HTMLButtonElement>(element, 'office-save-button').click();
    expect(spies.onSaveOffice).toHaveBeenCalledWith('支店', '大阪府');
    q<HTMLButtonElement>(element, 'office-clear-button').click();
    expect(spies.onClearOffice).toHaveBeenCalled();
  });
  it('説明に、訪問順の画面で出発・帰着を選べることを書く', () => {
    const element = renderSettings(createInitialState([]), info(), handlers());
    expect(element.textContent).toContain('訪問順の画面で');
  });
});
```
既存の「見出しの順」テストは `['出発地・帰着地', 'バックアップ', 'データの保存状態', '表示', 'このアプリについて']` に直す。

- [ ] **Step 6: 失敗を確認** — Run: `npx vitest run tests/settingsView.test.ts` → FAIL

- [ ] **Step 7: `settingsView.ts` に節を足す**
```ts
import type { Office } from '../routePlan';
export type SettingsInfo = { lastBackupAt: string | null; persisted: boolean | null; theme: ThemeSetting; office: Office | null };
export type SettingsHandlers = { /* 既存 */ onSaveOffice(name: string, address: string): void; onClearOffice(): void; };

function renderOffice(info: SettingsInfo, handlers: SettingsHandlers): HTMLElement {
  const card = section('出発地・帰着地');
  const note = document.createElement('p');
  note.textContent = '事業所を登録すると、訪問順の画面で「事業所から出発」「事業所へ戻る」を選べます。';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = info.office?.name ?? '';
  nameInput.placeholder = '例) 本店';
  nameInput.dataset.testid = 'office-name-input';
  nameInput.setAttribute('aria-label', '事業所の名前');
  const addressInput = document.createElement('input');
  addressInput.type = 'text';
  addressInput.value = info.office?.address ?? '';
  addressInput.placeholder = '例) 東京都中央区1-2-3';
  addressInput.dataset.testid = 'office-address-input';
  addressInput.setAttribute('aria-label', '事業所の住所');
  const fields = document.createElement('div');
  fields.className = 'office-fields';
  fields.append(labelled('名前', nameInput), labelled('住所', addressInput));
  const buttons = document.createElement('div');
  buttons.className = 'office-buttons';
  buttons.append(button('office-save-button', '保存', 'primary', () => handlers.onSaveOffice(nameInput.value, addressInput.value)));
  if (info.office) {
    buttons.append(button('office-clear-button', '消す', '', () => handlers.onClearOffice()));
  }
  card.append(note, fields, buttons);
  return card;
}

function labelled(text: string, input: HTMLInputElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'field';
  const caption = document.createElement('span');
  caption.className = 'field-label';
  caption.textContent = text;
  label.append(caption, input);
  return label;
}
```
`renderSettings` の `container.append(count, renderOffice(info, handlers), renderBackup(...), ...)`。`styles.css`: `.office-fields { display: flex; flex-direction: column; gap: 0.75rem; margin: 0.75rem 0; } .office-buttons { display: flex; gap: 0.75rem; } .office-buttons button { flex: 1; }`。

- [ ] **Step 8: `main.ts` の配線**
```ts
import { deleteMeta } from './db';
import { DEFAULT_ROUTE_ENDS, type Office, type RouteEnds } from './routePlan';

let routeContext: { ends: RouteEnds; office: Office | null } = { ends: DEFAULT_ROUTE_ENDS, office: null };

async function loadRouteContext(): Promise<void> {
  try {
    const [ends, office] = await Promise.all([getMeta('routeEnds'), getMeta('office')]);
    routeContext = { ends: ends ?? DEFAULT_ROUTE_ENDS, office: office ?? null };
  } catch {
    // 読めなければ既定のまま。
  }
  settingsInfo = { ...settingsInfo, office: routeContext.office };
  render();
}

async function handleSaveOffice(name: string, address: string): Promise<void> {
  const office = { name: name.trim(), address: address.trim() };
  if (office.name === '' || office.address === '') {
    setState(withMessage(state, { kind: 'error', text: '事業所の名前と住所を入力してください。' }));
    return;
  }
  try {
    await setMeta('office', office);
    routeContext = { ...routeContext, office };
    settingsInfo = { ...settingsInfo, office };
    openedRoutes.clear();
    setState(withMessage(state, { kind: 'info', text: '事業所を保存しました。' }));
  } catch {
    setState(withMessage(state, { kind: 'error', text: '事業所を保存できませんでした。' }));
  }
}

async function handleClearOffice(): Promise<void> {
  try {
    await deleteMeta('office');
    routeContext = { ...routeContext, office: null };
    settingsInfo = { ...settingsInfo, office: null };
    openedRoutes.clear();
    setState(withMessage(state, { kind: 'info', text: '事業所を消しました。' }));
  } catch {
    setState(withMessage(state, { kind: 'error', text: '事業所を消せませんでした。' }));
  }
}
```
`settingsInfo` の初期値に `office: null`。`startApp()` で `void loadRouteContext();`。`case 'settings'` に `onSaveOffice: (n, a) => { void handleSaveOffice(n, a); }`, `onClearOffice: () => { void handleClearOffice(); }`。`tests/wording.test.ts` の設定の呼び出しに `office: null` と2つの noop を足す。

- [ ] **Step 9: 結合テスト**(`tests/main.test.ts`)
```ts
describe('事業所の登録', () => {
  it('設定で事業所を保存すると、開き直しても残る', async () => {
    await import('../src/main');
    await waitFor(() => expect(el('[data-testid="settings-button"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="settings-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="office-name-input"]')).not.toBeNull());
    el<HTMLInputElement>('[data-testid="office-name-input"]')!.value = '本店';
    el<HTMLInputElement>('[data-testid="office-address-input"]')!.value = '東京都中央区1-1';
    el<HTMLButtonElement>('[data-testid="office-save-button"]')!.click();
    await waitFor(() => expect(el('.message')?.textContent).toContain('事業所を保存しました'));
    const db = await import('../src/db');
    expect(await db.getMeta('office')).toEqual({ name: '本店', address: '東京都中央区1-1' });
  });
});
```

- [ ] **Step 10: 全体** — Run: `npm test && npm run typecheck` → PASS

- [ ] **Step 11: コミット**
```bash
git add src/db.ts src/views/settingsView.ts src/main.ts src/styles.css tests/db.test.ts tests/settingsView.test.ts tests/main.test.ts tests/wording.test.ts
git commit -m "feat: 設定で事業所を登録できるようにする"
```

---

### Task 3: 訪問順の画面で出発・帰着を選び、地図はそのルートで開く

**Files:**
- Modify: `src/views/routeOrderView.ts`、`tests/routeOrderView.test.ts`
- Modify: `src/views/routeMapView.ts`、`tests/routeMapView.test.ts`
- Modify: `src/main.ts`、`tests/main.test.ts`、`src/styles.css`

**Interfaces:**
- Produces: `RouteContext = { ends: RouteEnds; office: Office | null }` を `src/routePlan.ts` に export し、`renderRouteOrder(state, context: RouteContext, handlers)`、`renderRouteMap(state, opened, provider, context: RouteContext, handlers)` に引数を追加。
- Produces: `RouteOrderHandlers.onEndsChange(ends: RouteEnds): void`。
- Produces: `main.ts` の `handleOpenRoute` は `buildRoutePlans(selectedPatients(state), routeContext.ends, routeContext.office, MAX_STOPS_PER_ROUTE)` の `plan.addresses` と `{ fromCurrentLocation: plan.fromCurrentLocation }` で URL を作る。共有(`confirmedShareText`)は変えない。

- [ ] **Step 1: 訪問順の画面のテスト**

`tests/routeOrderView.test.ts` の `handlers()` に `onEndsChange: vi.fn()`、全呼び出しを `renderRouteOrder(state, context, handlers)` に。`const context = (office: Office | null = null, ends = DEFAULT_ROUTE_ENDS): RouteContext => ({ ends, office });`
```ts
describe('出発・帰着の選択', () => {
  it('出発は 事業所/現在地/1件目、帰着は 事業所に戻る/最後の訪問先で終わる の選択肢', () => {
    const element = renderRouteOrder(selectedState(3), context(office), handlers());
    const start = q<HTMLSelectElement>(element, 'route-start-select');
    const end = q<HTMLSelectElement>(element, 'route-end-select');
    expect([...start.options].map((o) => o.value)).toEqual(['office', 'current', 'first']);
    expect([...end.options].map((o) => o.value)).toEqual(['office', 'last']);
    expect(start.value).toBe('first');
  });
  it('事業所が未登録なら事業所の選択肢は押せず、案内を出す', () => {
    const element = renderRouteOrder(selectedState(3), context(null), handlers());
    const start = q<HTMLSelectElement>(element, 'route-start-select');
    expect(start.options[0]!.disabled).toBe(true);
    expect(element.textContent).toContain('設定で事業所を登録すると');
  });
  it('変えると onEndsChange に新しい選び方が渡る', () => {
    const spies = handlers();
    const element = renderRouteOrder(selectedState(3), context(office), spies);
    const end = q<HTMLSelectElement>(element, 'route-end-select');
    end.value = 'office';
    end.dispatchEvent(new Event('change'));
    expect(spies.onEndsChange).toHaveBeenCalledWith({ start: 'first', end: 'office' });
  });
  it('事業所を出発と帰着に使うと、区切りが8件ごとになり、案内に「8件まで」と出る', () => {
    const element = renderRouteOrder(selectedState(9), context(office, { start: 'office', end: 'office' }), handlers());
    const items = [...element.querySelectorAll('.stop-timeline > li')];
    expect(items[8]!.dataset.testid).toBe('route-divider');
    expect(element.textContent).toContain('訪問先は1ルート8件まで');
  });
});
```
(`selectedState(n)` = n件を全部選んだ state。既存テストのヘルパーに合わせる。)

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run tests/routeOrderView.test.ts` → FAIL

- [ ] **Step 3: `routeOrderView.ts`**
- import `stopsPerRoute, type RouteContext, type RouteEnds, type RouteStart, type RouteEnd` from `'../routePlan'`。
- 見出しの直後(メッセージの後)に `renderEndsPanel(context, handlers)`:
```ts
const START_OPTIONS: { value: RouteStart; label: string; needsOffice: boolean }[] = [
  { value: 'office', label: '事業所から出発', needsOffice: true },
  { value: 'current', label: '現在地から出発', needsOffice: false },
  { value: 'first', label: '1件目の訪問先から', needsOffice: false },
];
const END_OPTIONS: { value: RouteEnd; label: string; needsOffice: boolean }[] = [
  { value: 'office', label: '事業所に戻る', needsOffice: true },
  { value: 'last', label: '最後の訪問先で終わる', needsOffice: false },
];

function renderEndsPanel(context: RouteContext, handlers: RouteOrderHandlers): HTMLElement {
  const panel = document.createElement('section');
  panel.className = 'card ends-panel';
  panel.dataset.testid = 'ends-panel';
  const hasOffice = context.office !== null;
  const start = selectFor('route-start-select', '出発', START_OPTIONS, context.ends.start, hasOffice);
  const end = selectFor('route-end-select', '帰着', END_OPTIONS, context.ends.end, hasOffice);
  start.addEventListener('change', () => handlers.onEndsChange({ start: start.value as RouteStart, end: end.value as RouteEnd }));
  end.addEventListener('change', () => handlers.onEndsChange({ start: start.value as RouteStart, end: end.value as RouteEnd }));
  const row = document.createElement('div');
  row.className = 'ends-row';
  row.append(labelled('出発', start), labelled('帰着', end));
  panel.append(row);
  if (!hasOffice) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = '設定で事業所を登録すると、事業所から出発・事業所に戻るを選べます。';
    panel.append(hint);
  }
  return panel;
}

function selectFor<V extends string>(testid: string, label: string, options: { value: V; label: string; needsOffice: boolean }[], current: V, hasOffice: boolean): HTMLSelectElement {
  const select = document.createElement('select');
  select.dataset.testid = testid;
  select.setAttribute('aria-label', label);
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    element.disabled = option.needsOffice && !hasOffice;
    select.append(element);
  }
  select.value = current;
  return select;
}

function labelled(text: string, select: HTMLSelectElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'ends-field';
  const caption = document.createElement('span');
  caption.className = 'field-label';
  caption.textContent = text;
  label.append(caption, select);
  return label;
}
```
- 区切りは `const perRoute = stopsPerRoute(context.ends, context.office, MAX_STOPS_PER_ROUTE);` を使い、`index % perRoute === 0` と `ルート${index / perRoute + 1}`。
- `order-hint` の文言を `▲▼ボタンで、順番を入れ替えられます。訪問先は1ルート${perRoute}件までです。` に。
- `styles.css`: `.ends-panel { padding: 0.75rem var(--gap); } .ends-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; } .ends-field { display: flex; flex-direction: column; gap: 0.25rem; } .ends-field select { min-height: var(--tap-min); padding: 0 0.5rem; border: 1px solid var(--border-strong); border-radius: var(--radius); background: var(--surface); color: var(--text); font-size: 1rem; }`。

- [ ] **Step 4: テストを通す** — Run: `npx vitest run tests/routeOrderView.test.ts` → PASS

- [ ] **Step 5: 地図の画面のテスト**

`tests/routeMapView.test.ts`: 呼び出しを `renderRouteMap(state, opened, provider, context, handlers)` に。
```ts
it('出発・帰着の指定を、1本目と最後のカードに出す', () => {
  const state = selectedState(12);
  const element = renderRouteMap(state, new Map(), googleMapsProvider, { ends: { start: 'office', end: 'office' }, office }, handlers());
  const cards = [...element.querySelectorAll('[data-testid="route-card"]')];
  expect(cards).toHaveLength(2);
  expect(cards[0]!.querySelector('[data-testid="route-ends"]')?.textContent).toBe('事業所から');
  expect(cards[1]!.querySelector('[data-testid="route-ends"]')?.textContent).toBe('事業所へ戻る');
});
it('指定が無ければ出発・帰着の行は出ない', () => {
  const element = renderRouteMap(selectedState(3), new Map(), googleMapsProvider, { ends: DEFAULT_ROUTE_ENDS, office: null }, handlers());
  expect(element.querySelector('[data-testid="route-ends"]')).toBeNull();
});
it('分割は事業所ぶんを引いた件数で行う', () => {
  const element = renderRouteMap(selectedState(9), new Map(), googleMapsProvider, { ends: { start: 'office', end: 'office' }, office }, handlers());
  expect(element.querySelectorAll('[data-testid="route-card"]')).toHaveLength(2);
  expect(element.querySelector('[data-testid="map-summary"]')?.textContent).toContain('最大8地点');
});
```

- [ ] **Step 6: 失敗を確認** — Run: `npx vitest run tests/routeMapView.test.ts` → FAIL

- [ ] **Step 7: `routeMapView.ts`**
- `renderRouteMap(state, opened, provider, context, handlers)`。`const plans = buildRoutePlans(stops, context.ends, context.office, MAX_STOPS_PER_ROUTE);` を `splitIntoRoutes` の代わりに使い、`renderSummary(stops.length, plans.length, stopsPerRoute(...))` の文言を `1つのルートは最大${perRoute}地点までです`。
- `renderRouteCard(plan, index, …)`: `plan.stops` で名前、`plan.startLabel`/`plan.endLabel` が空でなければ `<p class="route-ends" data-testid="route-ends">` に(両方あれば `事業所から → 事業所へ戻る` と ' → ' でつなぐ)。

- [ ] **Step 8: テストを通す** — Run: `npx vitest run tests/routeMapView.test.ts` → PASS

- [ ] **Step 9: `main.ts`**
```ts
import { buildRoutePlans, type RouteEnds } from './routePlan';

function handleOpenRoute(routeIndex: number): void {
  const plans = buildRoutePlans(selectedPatients(state), routeContext.ends, routeContext.office, MAX_STOPS_PER_ROUTE);
  const plan = plans[routeIndex];
  if (!plan) return;
  try {
    const url = DEFAULT_MAP_PROVIDER.buildUrl(plan.addresses, { fromCurrentLocation: plan.fromCurrentLocation });
    openedRoutes.set(routeIndex, new Date().toISOString());
    render();
    openUrl(url);
  } catch (error) { /* 既存のまま */ }
}

async function handleEndsChange(ends: RouteEnds): Promise<void> {
  routeContext = { ...routeContext, ends };
  openedRoutes.clear();
  render();
  try {
    await setMeta('routeEnds', ends);
  } catch {
    // 保存に失敗しても、この起動中は選んだ内容で動く。
  }
}
```
`case 'order'`: `renderRouteOrder(state, routeContext, { …, onEndsChange: (ends) => { void handleEndsChange(ends); } })`。`case 'map'`: `renderRouteMap(state, new Map(openedRoutes), DEFAULT_MAP_PROVIDER, routeContext, {...})`。`tests/wording.test.ts` の訪問順・地図の呼び出しに `{ ends: DEFAULT_ROUTE_ENDS, office: null }` と `{ ends: { start: 'office', end: 'office' }, office: { name: '本店', address: '東京都1' } }` の両方を通す(文言の検査)。

- [ ] **Step 10: 結合テスト**(`tests/main.test.ts`)
```ts
it('事業所から出発を選ぶと、地図のURLの origin が事業所の住所になる', async () => {
  const db = await import('../src/db');
  await db.setMeta('office', { name: '本店', address: '東京都中央区1-1' });
  await db.setMeta('routeEnds', { start: 'office', end: 'last' });
  await db.closeDbForTest();
  await import('../src/main');
  // 2件登録して選び、地図を開く(既存テストの手順を流用)
  // ... 登録・選択・訪問順→地図→open-route を押す
  const { openUrl } = await import('../src/openRoute');
  const url = new URL(vi.mocked(openUrl).mock.calls[0]![0]);
  expect(url.searchParams.get('origin')).toBe('東京都中央区1-1');
});
```

- [ ] **Step 11: 全体** — Run: `npm test && npm run typecheck` → PASS

- [ ] **Step 12: コミット**
```bash
git add src/routePlan.ts src/views/routeOrderView.ts src/views/routeMapView.ts src/main.ts src/styles.css tests/routeOrderView.test.ts tests/routeMapView.test.ts tests/main.test.ts tests/wording.test.ts
git commit -m "feat: 訪問順の画面で出発地・帰着地を選び、そのルートで地図を開く"
```

---

### Task 4: 履歴の保存(DB v3)と、日付・曜日・復元の純粋な関数

**Files:**
- Modify: `src/db.ts`、`tests/db.test.ts`
- Create: `src/history.ts`、`tests/history.test.ts`

**Interfaces:**
- Produces(`db.ts`):
```ts
export type HistoryEntry = { date: string /* YYYY-MM-DD */; ids: string[]; routeEnds: RouteEnds; visited: Record<string, string /* ISO */> };
export async function getHistory(date: string): Promise<HistoryEntry | undefined>;
export async function putHistory(entry: HistoryEntry): Promise<void>;
export async function listHistory(): Promise<HistoryEntry[]>;   // 新しい日付が先
export async function deleteHistoryBefore(date: string): Promise<number>; // 消した件数
export async function clearHistory(): Promise<void>;
```
- Produces(`history.ts`):
```ts
export const HISTORY_KEEP_DAYS = 56; // 8週間
export function dateKey(now: Date): string;                     // ローカル日付 'YYYY-MM-DD'
export function weekdayOf(date: string): number;                // 0=日 … 6=土
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
export function formatHistoryDate(date: string): string;        // '9/22(月)'
export function keepFromDate(now: Date): string;                // now − 56日 の dateKey(これより前を消す)
export function lastWeekSameWeekday(entries: readonly HistoryEntry[], now: Date): HistoryEntry | null; // 7日前の記録があれば
export function restoreSelection(entry: HistoryEntry, patients: readonly Patient[]): { ids: string[]; missing: number };
export function formatVisits(entry: HistoryEntry, patients: readonly Patient[]): string; // '9:12 山田 太郎 → 10:05 佐藤 花子'(訪問順、済のみ、時刻順)
```

- [ ] **Step 1: 純粋な関数のテスト**

`tests/history.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '../src/db';
import { dateKey, formatHistoryDate, formatVisits, keepFromDate, lastWeekSameWeekday, restoreSelection, weekdayOf } from '../src/history';
import { createPatient } from '../src/patient';

const entry = (date: string, ids: string[], visited: Record<string, string> = {}): HistoryEntry => ({ date, ids, routeEnds: { start: 'first', end: 'last' }, visited });

describe('日付', () => {
  it('dateKey はローカル日付の YYYY-MM-DD', () => {
    expect(dateKey(new Date(2026, 8, 22, 23, 59))).toBe('2026-09-22');
    expect(dateKey(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
  });
  it('曜日と表示', () => {
    expect(weekdayOf('2026-09-22')).toBe(2);
    expect(formatHistoryDate('2026-09-22')).toBe('9/22(火)');
  });
  it('keepFromDate は56日前', () => {
    expect(keepFromDate(new Date(2026, 8, 25))).toBe('2026-07-31');
  });
});

describe('lastWeekSameWeekday', () => {
  it('7日前の記録があれば返す', () => {
    const entries = [entry('2026-09-22', ['a']), entry('2026-09-18', ['b'])];
    expect(lastWeekSameWeekday(entries, new Date(2026, 8, 29))?.date).toBe('2026-09-22');
    expect(lastWeekSameWeekday(entries, new Date(2026, 8, 28))).toBeNull();
  });
});

describe('restoreSelection', () => {
  it('名簿にある人だけを順番どおりに返し、無い人を数える', () => {
    const a = createPatient('a', 'x');
    const b = createPatient('b', 'y');
    const result = restoreSelection(entry('2026-09-22', [b.id, 'gone', a.id]), [a, b]);
    expect(result.ids).toEqual([b.id, a.id]);
    expect(result.missing).toBe(1);
  });
});

describe('formatVisits', () => {
  it('済の人だけを時刻順に「時:分 名前」で並べる', () => {
    const a = createPatient('山田 太郎', 'x');
    const b = createPatient('佐藤 花子', 'y');
    const c = createPatient('鈴木', 'z');
    const e = entry('2026-09-22', [a.id, b.id, c.id], {
      [b.id]: new Date(2026, 8, 22, 10, 5).toISOString(),
      [a.id]: new Date(2026, 8, 22, 9, 12).toISOString(),
    });
    expect(formatVisits(e, [a, b, c])).toBe('9:12 山田 太郎 → 10:05 佐藤 花子');
  });
  it('済が無ければ空文字', () => {
    expect(formatVisits(entry('2026-09-22', []), [])).toBe('');
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run tests/history.test.ts` → FAIL

- [ ] **Step 3: `src/history.ts`**
```ts
import type { HistoryEntry } from './db';
import type { Patient } from './types';

export const HISTORY_KEEP_DAYS = 56;
export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

export function dateKey(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function parseKey(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

export function weekdayOf(date: string): number {
  return parseKey(date).getDay();
}

export function formatHistoryDate(date: string): string {
  const d = parseKey(date);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_LABELS[d.getDay()]})`;
}

export function keepFromDate(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - HISTORY_KEEP_DAYS);
  return dateKey(d);
}

export function lastWeekSameWeekday(entries: readonly HistoryEntry[], now: Date): HistoryEntry | null {
  const target = dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7));
  return entries.find((entry) => entry.date === target) ?? null;
}

export function restoreSelection(entry: HistoryEntry, patients: readonly Patient[]): { ids: string[]; missing: number } {
  const existing = new Set(patients.map((p) => p.id));
  const ids = entry.ids.filter((id) => existing.has(id));
  return { ids, missing: entry.ids.length - ids.length };
}

export function formatVisits(entry: HistoryEntry, patients: readonly Patient[]): string {
  const byId = new Map(patients.map((p) => [p.id, p]));
  return Object.entries(entry.visited)
    .map(([id, at]) => ({ name: byId.get(id)?.name, at: new Date(at) }))
    .filter((v): v is { name: string; at: Date } => v.name !== undefined && !Number.isNaN(v.at.getTime()))
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((v) => `${v.at.getHours()}:${pad(v.at.getMinutes())} ${v.name}`)
    .join(' → ');
}
```

- [ ] **Step 4: テストを通す** — Run: `npx vitest run tests/history.test.ts` → PASS

- [ ] **Step 5: db のテスト**(`tests/db.test.ts`)
```ts
import { clearHistory, deleteHistoryBefore, getHistory, listHistory, putHistory, type HistoryEntry } from '../src/db';
const h = (date: string): HistoryEntry => ({ date, ids: ['a'], routeEnds: { start: 'first', end: 'last' }, visited: {} });
describe('history', () => {
  it('日付をキーに保存・上書きし、新しい順に一覧できる', async () => {
    await putHistory(h('2026-09-20'));
    await putHistory(h('2026-09-22'));
    await putHistory({ ...h('2026-09-22'), ids: ['b'] });
    expect((await listHistory()).map((e) => e.date)).toEqual(['2026-09-22', '2026-09-20']);
    expect((await getHistory('2026-09-22'))?.ids).toEqual(['b']);
  });
  it('指定の日付より前を消し、件数を返す', async () => {
    await putHistory(h('2026-07-01'));
    await putHistory(h('2026-08-15'));
    await putHistory(h('2026-09-22'));
    expect(await deleteHistoryBefore('2026-07-31')).toBe(1);
    expect((await listHistory()).map((e) => e.date)).toEqual(['2026-09-22', '2026-08-15']);
    await clearHistory();
    expect(await listHistory()).toEqual([]);
  });
});
```

- [ ] **Step 6: 失敗を確認** — Run: `npx vitest run tests/db.test.ts` → FAIL

- [ ] **Step 7: `src/db.ts`**
```ts
const DB_VERSION = 3;
const HISTORY_STORE = 'history';
export type HistoryEntry = { date: string; ids: string[]; routeEnds: RouteEnds; visited: Record<string, string> };
interface RouteAutoInputDB extends DBSchema {
  patients: {...};
  meta: {...};
  history: { key: string; value: HistoryEntry };
}
// upgrade に追加:
if (oldVersion < 3) {
  db.createObjectStore(HISTORY_STORE, { keyPath: 'date' });
}
export async function getHistory(date: string) { const db = await getDb(); return db.get(HISTORY_STORE, date); }
export async function putHistory(entry: HistoryEntry) { const db = await getDb(); await db.put(HISTORY_STORE, entry); }
export async function listHistory() { const db = await getDb(); return (await db.getAll(HISTORY_STORE)).reverse(); }
export async function deleteHistoryBefore(date: string): Promise<number> {
  const db = await getDb();
  const keys = await db.getAllKeys(HISTORY_STORE, IDBKeyRange.upperBound(date, true));
  const tx = db.transaction(HISTORY_STORE, 'readwrite');
  for (const key of keys) await tx.store.delete(key);
  await tx.done;
  return keys.length;
}
export async function clearHistory() { const db = await getDb(); await db.clear(HISTORY_STORE); }
```
(`getAll` はキー順=日付文字列の昇順なので `reverse()` で新しい順。)

- [ ] **Step 8: テストを通す** — Run: `npm test && npm run typecheck` → PASS

- [ ] **Step 9: コミット**
```bash
git add src/db.ts src/history.ts tests/db.test.ts tests/history.test.ts
git commit -m "feat: 訪問の履歴を保存する仕組みと、日付・復元の関数を足す"
```

---

### Task 5: 「地図を開く」で記録し、履歴の画面から前回と同じ人を選ぶ

**Files:**
- Modify: `src/types.ts`(`Screen` に `{ name: 'history'; openDate: string | null; weekday: number | null }`)
- Create: `src/views/historyView.ts`、`tests/historyView.test.ts`
- Modify: `src/views/patientListView.ts`、`tests/patientListView.test.ts`
- Modify: `src/main.ts`、`tests/main.test.ts`、`src/styles.css`、`tests/wording.test.ts`

**Interfaces:**
- Produces:
```ts
export type HistoryHandlers = {
  onOpenEntry(date: string | null): void;      // 行を押す(もう一度で閉じる)
  onFilterWeekday(weekday: number | null): void;
  onPick(date: string): void;                  // 「この人たちを選ぶ」
  onCopyVisits(date: string): void;            // Task 6 で使う。今は空の実装でよい
  onBack(): void;
};
export function renderHistory(state: AppState, entries: readonly HistoryEntry[], handlers: HistoryHandlers): HTMLElement;
```
- Produces: `PatientListHandlers.onOpenHistory(): void`、`onPickLastWeek(): void`。`renderPatientList(state, handlers, notice, lastWeek: { date: string; count: number } | null = null)`。
- Produces(`main.ts`): `let historyEntries: HistoryEntry[] = []`(起動時と記録後に `listHistory()`)、`recordTodayRoute()`(「地図を開く」で当日を上書き。`visited` は既存を保つ)、`pickHistory(date)`。

- [ ] **Step 1: 履歴の画面のテスト**

`tests/historyView.test.ts`:
```ts
import { describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../src/db';
import { createPatient } from '../src/patient';
import { createInitialState } from '../src/state';
import { renderHistory, type HistoryHandlers } from '../src/views/historyView';

const handlers = (): HistoryHandlers => ({ onOpenEntry: vi.fn(), onFilterWeekday: vi.fn(), onPick: vi.fn(), onCopyVisits: vi.fn(), onBack: vi.fn() });
const q = <T extends HTMLElement = HTMLElement>(e: HTMLElement, t: string) => e.querySelector<T>(`[data-testid="${t}"]`)!;
const a = createPatient('山田 太郎', 'x'); const b = createPatient('佐藤 花子', 'y'); const c = createPatient('鈴木', 'z'); const d = createPatient('高橋', 'w');
const entry = (date: string, ids: string[]): HistoryEntry => ({ date, ids, routeEnds: { start: 'first', end: 'last' }, visited: {} });
const screen = (openDate: string | null = null, weekday: number | null = null) => ({ ...createInitialState([a, b, c, d]), screen: { name: 'history' as const, openDate, weekday } });

describe('renderHistory', () => {
  it('日付・曜日・人数・先頭3人を行に出す', () => {
    const element = renderHistory(screen(), [entry('2026-09-22', [a.id, b.id, c.id, d.id])], handlers());
    const row = q(element, 'history-row');
    expect(row.textContent).toContain('9/22(火)');
    expect(row.textContent).toContain('4人');
    expect(row.textContent).toContain('山田 太郎・佐藤 花子・鈴木…');
  });
  it('記録が無ければ案内', () => {
    expect(renderHistory(screen(), [], handlers()).textContent).toContain('まだ記録がありません');
  });
  it('曜日で絞り込める(押すと onFilterWeekday、選択中は aria-pressed)', () => {
    const spies = handlers();
    const element = renderHistory(screen(null, 2), [entry('2026-09-22', [a.id]), entry('2026-09-23', [b.id])], spies);
    expect(element.querySelectorAll('[data-testid="history-row"]')).toHaveLength(1);
    const tue = element.querySelector<HTMLButtonElement>('[data-testid="weekday-2"]')!;
    expect(tue.getAttribute('aria-pressed')).toBe('true');
    tue.click();
    expect(spies.onFilterWeekday).toHaveBeenCalledWith(null);
  });
  it('行を押すと onOpenEntry(date)、開いた行には全員と「この人たちを選ぶ」', () => {
    const spies = handlers();
    const closed = renderHistory(screen(), [entry('2026-09-22', [a.id, b.id])], spies);
    q<HTMLButtonElement>(closed, 'history-row').click();
    expect(spies.onOpenEntry).toHaveBeenCalledWith('2026-09-22');
    const open = renderHistory(screen('2026-09-22'), [entry('2026-09-22', [a.id, b.id])], spies);
    expect(q(open, 'history-detail').textContent).toContain('1. 山田 太郎');
    expect(q(open, 'history-detail').textContent).toContain('2. 佐藤 花子');
    q<HTMLButtonElement>(open, 'history-pick').click();
    expect(spies.onPick).toHaveBeenCalledWith('2026-09-22');
  });
  it('名簿にない人は「(名簿にありません)」と出す', () => {
    const open = renderHistory(screen('2026-09-22'), [entry('2026-09-22', [a.id, 'gone'])], handlers());
    expect(q(open, 'history-detail').textContent).toContain('(名簿にありません)');
  });
});
```

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run tests/historyView.test.ts` → FAIL

- [ ] **Step 3: `src/views/historyView.ts`**
```ts
import type { HistoryEntry } from '../db';
import { formatHistoryDate, formatVisits, WEEKDAY_LABELS, weekdayOf } from '../history';
import type { AppState } from '../types';
import { renderMessage, renderScreenHeader } from './common';

export type HistoryHandlers = {
  onOpenEntry(date: string | null): void;
  onFilterWeekday(weekday: number | null): void;
  onPick(date: string): void;
  onCopyVisits(date: string): void;
  onBack(): void;
};

/** 履歴の画面。日付ごとの記録を新しい順に並べ、曜日で絞り込み、開いた記録から同じ人を選び直せる。 */
export function renderHistory(state: AppState, entries: readonly HistoryEntry[], handlers: HistoryHandlers): HTMLElement {
  const screen = state.screen.name === 'history' ? state.screen : { openDate: null, weekday: null };
  const container = document.createElement('div');
  container.className = 'screen';
  container.append(renderScreenHeader('履歴から選ぶ', { onBack: handlers.onBack }));
  if (state.message) container.append(renderMessage(state.message));
  container.append(renderWeekdayFilter(screen.weekday, handlers));

  const shown = screen.weekday === null ? entries : entries.filter((e) => weekdayOf(e.date) === screen.weekday);
  if (shown.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = entries.length === 0 ? 'まだ記録がありません。地図を開くと、その日の訪問先が記録されます。' : 'この曜日の記録はありません。';
    container.append(empty);
    return container;
  }
  const list = document.createElement('ul');
  list.className = 'history-list';
  for (const entry of shown) {
    list.append(renderEntry(entry, entry.date === screen.openDate, state, handlers));
  }
  container.append(list);
  return container;
}

function renderWeekdayFilter(current: number | null, handlers: HistoryHandlers): HTMLElement {
  const row = document.createElement('div');
  row.className = 'weekday-filter';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', '曜日で絞り込む');
  WEEKDAY_LABELS.forEach((label, weekday) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `segment${current === weekday ? ' pressed' : ''}`;
    button.dataset.testid = `weekday-${weekday}`;
    button.setAttribute('aria-pressed', String(current === weekday));
    button.textContent = label;
    button.addEventListener('click', () => handlers.onFilterWeekday(current === weekday ? null : weekday));
    row.append(button);
  });
  return row;
}

function renderEntry(entry: HistoryEntry, open: boolean, state: AppState, handlers: HistoryHandlers): HTMLElement {
  const byId = new Map(state.patients.map((p) => [p.id, p]));
  const names = entry.ids.map((id) => byId.get(id)?.name ?? null);
  const item = document.createElement('li');
  item.className = `history-item${open ? ' open' : ''}`;

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'history-row';
  row.dataset.testid = 'history-row';
  row.setAttribute('aria-expanded', String(open));
  const head = document.createElement('span');
  head.className = 'history-head';
  head.textContent = `${formatHistoryDate(entry.date)}  ${entry.ids.length}人`;
  const preview = document.createElement('span');
  preview.className = 'history-preview';
  const shown = names.filter((n): n is string => n !== null).slice(0, 3);
  preview.textContent = shown.join('・') + (names.length > 3 ? '…' : '');
  row.append(head, preview);
  row.addEventListener('click', () => handlers.onOpenEntry(open ? null : entry.date));
  item.append(row);

  if (open) {
    const detail = document.createElement('div');
    detail.className = 'history-detail';
    detail.dataset.testid = 'history-detail';
    const ol = document.createElement('ol');
    ol.className = 'history-names';
    names.forEach((name, index) => {
      const li = document.createElement('li');
      li.textContent = `${index + 1}. ${name ?? '(名簿にありません)'}`;
      ol.append(li);
    });
    detail.append(ol);
    const visits = formatVisits(entry, state.patients);
    if (visits !== '') {
      const p = document.createElement('p');
      p.className = 'history-visits';
      p.dataset.testid = 'history-visits';
      p.textContent = `訪問: ${visits}`;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.dataset.testid = 'history-copy';
      copy.textContent = 'コピー';
      copy.addEventListener('click', () => handlers.onCopyVisits(entry.date));
      detail.append(p, copy);
    }
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'primary block';
    pick.dataset.testid = 'history-pick';
    pick.textContent = 'この人たちを選ぶ';
    pick.addEventListener('click', () => handlers.onPick(entry.date));
    detail.append(pick);
    item.append(detail);
  }
  return item;
}
```
`styles.css`: `.weekday-filter { display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.25rem; margin-bottom: var(--gap); } .weekday-filter .segment { border: 1px solid var(--border-strong); border-radius: var(--radius); } .history-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.75rem; } .history-row { display: flex; flex-direction: column; align-items: flex-start; gap: 0.25rem; width: 100%; min-height: var(--tap-primary); padding: 0.75rem var(--gap); text-align: left; } .history-head { font-weight: 700; font-size: 1.125rem; } .history-preview { color: var(--muted); } .history-detail { padding: 0.75rem var(--gap) var(--gap); border: 1px solid var(--border); border-top: none; border-radius: 0 0 var(--radius) var(--radius); background: var(--surface); } .history-names { margin: 0 0 0.75rem; padding-left: 0; list-style: none; } .history-visits { margin: 0 0 0.5rem; overflow-wrap: anywhere; }`。

- [ ] **Step 4: テストを通す** — Run: `npx vitest run tests/historyView.test.ts` → PASS

- [ ] **Step 5: 一覧のボタンのテスト**(`tests/patientListView.test.ts`)
```ts
it('「履歴から選ぶ」を登録ボタンの左に出し、先週の同じ曜日があれば近道も出す', () => {
  const spies = handlers();
  const element = renderPatientList(createInitialState(makePatients(1)), spies, null, { date: '2026-09-22', count: 8 });
  const row = element.querySelector('.list-new-row')!;
  expect(row.children[0]!.getAttribute('data-testid')).toBe('history-button');
  expect(row.children[1]!.getAttribute('data-testid')).toBe('new-button');
  q<HTMLButtonElement>(element, 'history-button').click();
  expect(spies.onOpenHistory).toHaveBeenCalled();
  const shortcut = q<HTMLButtonElement>(element, 'last-week-button');
  expect(shortcut.textContent).toBe('先週の火曜日と同じ(8人)');
  shortcut.click();
  expect(spies.onPickLastWeek).toHaveBeenCalled();
});
it('先週の記録が無ければ近道は出ない', () => {
  expect(renderPatientList(createInitialState([]), handlers()).querySelector('[data-testid="last-week-button"]')).toBeNull();
});
```
(`handlers()` に `onOpenHistory: vi.fn(), onPickLastWeek: vi.fn()`。)

- [ ] **Step 6: 失敗を確認** — Run: `npx vitest run tests/patientListView.test.ts` → FAIL

- [ ] **Step 7: `patientListView.ts`**
- `renderPatientList(state, handlers, notice = null, lastWeek: { date: string; count: number } | null = null)`。
- `renderNewRow`: `history-button`(「履歴から選ぶ」、class `block`)を `new-button` の前に。`new-button` は `primary block` のまま。
- `lastWeek` があれば `.list-new-row` の直後に `div.list-shortcut-row` を足し、`last-week-button`(`先週の${WEEKDAY_LABELS[weekdayOf(lastWeek.date)]}曜日と同じ(${lastWeek.count}人)`)。
- `styles.css`: `.list-new-row > button { flex: 1; } .list-shortcut-row { margin-top: 0.5rem; } .list-shortcut-row button { width: 100%; border-color: var(--primary); color: var(--primary); }`。

- [ ] **Step 8: `types.ts` / `state.ts` / `main.ts`**
- `Screen` に `| { name: 'history'; openDate: string | null; weekday: number | null }`。`currentStep()` は既定で null(タブを出さない)。
- `main.ts`:
```ts
import { getHistory, listHistory, putHistory, type HistoryEntry } from './db';
import { dateKey, lastWeekSameWeekday, restoreSelection } from './history';

let historyEntries: HistoryEntry[] = [];

async function loadHistory(): Promise<void> {
  try { historyEntries = await listHistory(); } catch { historyEntries = []; }
  render();
}

/** 「地図を開く」を押したとき、その日の訪問先と順番を記録する(同じ日は上書き。済の記録は保つ)。 */
async function recordTodayRoute(): Promise<void> {
  const ids = state.selectedIds;
  if (ids.length === 0) return;
  const date = dateKey(new Date());
  try {
    const existing = await getHistory(date);
    const visited = Object.fromEntries(Object.entries(existing?.visited ?? {}).filter(([id]) => ids.includes(id)));
    await putHistory({ date, ids: [...ids], routeEnds: routeContext.ends, visited });
    await loadHistory();
  } catch {
    // 記録できなくても地図は開ける。
  }
}

function lastWeekShortcut(): { date: string; count: number } | null {
  const entry = lastWeekSameWeekday(historyEntries, new Date());
  return entry ? { date: entry.date, count: entry.ids.length } : null;
}

function pickHistory(date: string): void {
  const entry = historyEntries.find((e) => e.date === date);
  if (!entry) return;
  const { ids, missing } = restoreSelection(entry, state.patients);
  routeContext = { ...routeContext, ends: entry.routeEnds };
  openedRoutes.clear();
  const next = withScreen({ ...state, selectedIds: ids }, { name: 'order' });
  setState(withMessage(next, missing > 0 ? { kind: 'info', text: `${ids.length}人を選びました。${missing}人は名簿にないため選べませんでした。` } : { kind: 'info', text: `${ids.length}人を選びました。` }));
}
```
- `case 'order'` の `onOpenMap`: `() => { setState(withScreen(state, { name: 'map' })); void recordTodayRoute(); }`。
- `case 'list'`: `onOpenHistory: () => setState(withScreen(state, { name: 'history', openDate: null, weekday: null }))`, `onPickLastWeek: () => { const s = lastWeekShortcut(); if (s) pickHistory(s.date); }`; 第4引数に `lastWeekShortcut()`。
- `case 'history'`: `renderHistory(state, historyEntries, { onOpenEntry: (d) => setState({ ...state, screen: { name: 'history', openDate: d, weekday: state.screen.name === 'history' ? state.screen.weekday : null } }), onFilterWeekday: (w) => setState({ ...state, screen: { name: 'history', openDate: null, weekday: w } }), onPick: pickHistory, onCopyVisits: () => {}, onBack: () => setState(withScreen(state, { name: 'list' })) })`。
- `startApp()` で `void loadHistory();`。
- `tests/wording.test.ts` に履歴の画面(空・1件・開いた状態)を足す。

- [ ] **Step 9: 結合テスト**(`tests/main.test.ts`)
```ts
describe('履歴から選ぶ', () => {
  it('地図を開くと今日の記録ができ、履歴の画面から同じ人を選び直せる', async () => {
    await import('../src/main');
    // 2件登録 → 全選択 → 訪問順 → 「この順番で地図を開く」
    // ...
    el<HTMLButtonElement>('[data-testid="open-map-button"]')!.click();
    const db = await import('../src/db');
    await waitFor(async () => expect((await db.listHistory()).length).toBe(1));
    // 一覧へ戻り、選択を解除してから履歴で選び直す
    el<HTMLButtonElement>('[data-testid="tab-list"]')!.click();
    // 全解除
    el<HTMLButtonElement>('[data-testid="select-all-button"]')!.click(); // 全解除
    el<HTMLButtonElement>('[data-testid="history-button"]')!.click();
    await waitFor(() => expect(el('[data-testid="history-row"]')).not.toBeNull());
    el<HTMLButtonElement>('[data-testid="history-row"]')!.click();
    el<HTMLButtonElement>('[data-testid="history-pick"]')!.click();
    await waitFor(() => expect(el('[data-testid="stop-row"]')).not.toBeNull());
    expect(document.querySelectorAll('[data-testid="stop-row"]')).toHaveLength(2);
  });
});
```

- [ ] **Step 10: 全体** — Run: `npm test && npm run typecheck` → PASS

- [ ] **Step 11: コミット**
```bash
git add src/types.ts src/views/historyView.ts src/views/patientListView.ts src/main.ts src/styles.css tests/historyView.test.ts tests/patientListView.test.ts tests/main.test.ts tests/wording.test.ts
git commit -m "feat: 地図を開いた日の訪問先を記録し、履歴から同じ人を選び直せるようにする"
```

---

### Task 6: 訪問済みと時刻、日報のコピー、古い履歴の削除

**Files:**
- Modify: `src/views/routeMapView.ts`、`tests/routeMapView.test.ts`
- Modify: `src/views/settingsView.ts`、`tests/settingsView.test.ts`
- Modify: `src/main.ts`、`tests/main.test.ts`、`src/styles.css`

**Interfaces:**
- Produces: `renderRouteMap(state, opened, provider, context, visited: ReadonlyMap<string, string>, handlers)`(訪問先 id → 済の時刻)。`RouteMapHandlers.onToggleVisited(id: string): void`。各訪問先に `visited-toggle`(`data-id`)。済なら「済 9:12」、未なら「済」。
- Produces: `SettingsHandlers.onClearHistory(): void`(「データの保存状態」に `clear-history-button`「履歴をすべて消す」)。
- Produces(`main.ts`): `toggleVisited(id)`、`copyVisits(date)`、起動時に `deleteHistoryBefore(keepFromDate(new Date()))`。

- [ ] **Step 1: 地図のカードのテスト**(`tests/routeMapView.test.ts`)
```ts
it('各訪問先に「済」ボタンがあり、済なら時刻を出す。押すと onToggleVisited(id)', () => {
  const state = selectedState(2);
  const [a, b] = state.patients;
  const visited = new Map([[a!.id, new Date(2026, 8, 22, 9, 12).toISOString()]]);
  const spies = handlers();
  const element = renderRouteMap(state, new Map(), googleMapsProvider, ctx(), visited, spies);
  const buttons = [...element.querySelectorAll<HTMLButtonElement>('[data-testid="visited-toggle"]')];
  expect(buttons).toHaveLength(2);
  expect(buttons[0]!.textContent).toBe('済 9:12');
  expect(buttons[0]!.getAttribute('aria-pressed')).toBe('true');
  expect(buttons[1]!.textContent).toBe('済');
  buttons[1]!.click();
  expect(spies.onToggleVisited).toHaveBeenCalledWith(b!.id);
});
```
(`renderRouteCard` の名前の並び `route-names` を、訪問先ごとの行 `ul.route-stops > li`(名前+電話リンク+済ボタン)に置き換える。既存の `route-names` を参照するテストは `route-stops` の文字列に合わせて直す。Task 8 で足した `route-phones` の行は不要になるので、電話リンクを各行に移して `route-phones` は削除する。)

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run tests/routeMapView.test.ts` → FAIL

- [ ] **Step 3: `routeMapView.ts`**
```ts
function renderStops(route: readonly Patient[], visited: ReadonlyMap<string, string>, handlers: RouteMapHandlers): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'route-stops';
  list.dataset.testid = 'route-stops';
  for (const patient of route) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'route-stop-name';
    name.textContent = patient.name;
    item.append(name);
    if (patient.phone) {
      const phone = document.createElement('a');
      phone.className = 'phone-link';
      phone.dataset.testid = 'phone-link';
      phone.href = formatPhoneHref(patient.phone);
      phone.setAttribute('aria-label', `${patient.name}に電話`);
      phone.textContent = '☎';
      item.append(phone);
    }
    const at = visited.get(patient.id);
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = `visited-toggle${at ? ' done' : ''}`;
    toggle.dataset.testid = 'visited-toggle';
    toggle.dataset.id = patient.id;
    toggle.setAttribute('aria-pressed', String(at !== undefined));
    toggle.setAttribute('aria-label', `${patient.name}を訪問済みにする`);
    toggle.textContent = at ? `済 ${formatTime(at)}` : '済';
    toggle.addEventListener('click', () => handlers.onToggleVisited(patient.id));
    item.append(toggle);
    list.append(item);
  }
  return list;
}
```
`formatTime(iso)` は `src/format.ts` に `export function formatTime(iso: string): string`(`'9:12'`。読めなければ '')を足し、テスト(`tests/format.test.ts`)も1つ足す。`styles.css`: `.route-stops { margin: 0.5rem 0 var(--gap); padding: 0; list-style: none; } .route-stops li { display: flex; align-items: center; gap: 0.5rem; min-height: var(--tap-min); } .route-stop-name { flex: 1; overflow-wrap: anywhere; } .visited-toggle { min-height: var(--tap-min); padding: 0 0.75rem; white-space: nowrap; } .visited-toggle.done { border-color: var(--success); background: var(--success-soft); color: var(--success); font-weight: 700; }`。

- [ ] **Step 4: テストを通す** — Run: `npx vitest run tests/routeMapView.test.ts tests/format.test.ts` → PASS

- [ ] **Step 5: 設定のテスト**(`tests/settingsView.test.ts`)
```ts
it('「データの保存状態」に「履歴をすべて消す」があり、押すと onClearHistory', () => {
  const spies = handlers();
  const element = renderSettings(createInitialState([]), info(), spies);
  q<HTMLButtonElement>(element, 'clear-history-button').click();
  expect(spies.onClearHistory).toHaveBeenCalled();
});
```
`renderProtection` の末尾に `<p class="hint">訪問の履歴(誰をどの順で回ったか・訪問した時刻)は8週間で自動的に消えます。</p>` と `button('clear-history-button', '履歴をすべて消す', 'danger', () => handlers.onClearHistory())`。

- [ ] **Step 6: `main.ts`**
```ts
import { clearHistory, deleteHistoryBefore } from './db';
import { formatVisits, keepFromDate } from './history';

function todayVisited(): Map<string, string> {
  const today = historyEntries.find((e) => e.date === dateKey(new Date()));
  return new Map(Object.entries(today?.visited ?? {}));
}

async function toggleVisited(id: string): Promise<void> {
  const date = dateKey(new Date());
  try {
    const existing = (await getHistory(date)) ?? { date, ids: [...state.selectedIds], routeEnds: routeContext.ends, visited: {} };
    const visited = { ...existing.visited };
    if (visited[id]) delete visited[id]; else visited[id] = new Date().toISOString();
    await putHistory({ ...existing, visited });
    await loadHistory();
  } catch {
    setState(withMessage(state, { kind: 'error', text: '訪問済みを記録できませんでした。' }));
  }
}

async function copyVisits(date: string): Promise<void> {
  const entry = historyEntries.find((e) => e.date === date);
  if (!entry) return;
  try {
    await copyText(`${formatHistoryDate(date)} 訪問: ${formatVisits(entry, state.patients)}`);
    setState(withMessage(state, { kind: 'info', text: 'コピーしました。日報などに貼り付けてください。' }));
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'コピーできませんでした。' }));
  }
}

async function handleClearHistory(): Promise<void> {
  if (!window.confirm('訪問の履歴をすべて消しますか?')) return;
  try {
    await clearHistory();
    await loadHistory();
    setState(withMessage(state, { kind: 'info', text: '履歴を消しました。' }));
  } catch {
    setState(withMessage(state, { kind: 'error', text: '履歴を消せませんでした。' }));
  }
}
```
- `startApp()`: `void deleteHistoryBefore(keepFromDate(new Date())).catch(() => undefined).then(() => loadHistory());`(`loadHistory` の呼び出しはこれに一本化)。
- `case 'map'`: `renderRouteMap(state, new Map(openedRoutes), DEFAULT_MAP_PROVIDER, routeContext, todayVisited(), { …, onToggleVisited: (id) => { void toggleVisited(id); } })`。
- `case 'history'` の `onCopyVisits: (d) => { void copyVisits(d); }`。
- `case 'settings'` に `onClearHistory: () => { void handleClearHistory(); }`。
- `tests/wording.test.ts` の地図の呼び出しに `new Map()` の引数と noop を足す。

- [ ] **Step 7: 結合テスト**(`tests/main.test.ts`)
```ts
it('地図の画面で「済」を押すと、履歴に時刻が残り、もう一度押すと消える', async () => {
  // 1件登録 → 選択 → 訪問順 → 地図を開く画面へ
  // ...
  el<HTMLButtonElement>('[data-testid="visited-toggle"]')!.click();
  const db = await import('../src/db');
  await waitFor(async () => expect(Object.keys((await db.listHistory())[0]!.visited)).toHaveLength(1));
  await waitFor(() => expect(el('[data-testid="visited-toggle"]')!.textContent).toMatch(/^済 \d+:\d{2}$/));
  el<HTMLButtonElement>('[data-testid="visited-toggle"]')!.click();
  await waitFor(async () => expect(Object.keys((await db.listHistory())[0]!.visited)).toHaveLength(0));
});
it('起動時に56日より古い履歴を消す', async () => {
  const db = await import('../src/db');
  await db.putHistory({ date: '2020-01-01', ids: [], routeEnds: { start: 'first', end: 'last' }, visited: {} });
  await db.closeDbForTest();
  await import('../src/main');
  await waitFor(async () => expect(await db.listHistory()).toEqual([]));
});
```

- [ ] **Step 8: 全体** — Run: `npm test && npm run typecheck` → PASS

- [ ] **Step 9: コミット**
```bash
git add src/views/routeMapView.ts src/views/settingsView.ts src/main.ts src/format.ts src/styles.css tests/routeMapView.test.ts tests/settingsView.test.ts tests/format.test.ts tests/main.test.ts tests/wording.test.ts
git commit -m "feat: ルートの画面で訪問済みと時刻を記録し、履歴からコピーできるようにする"
```

---

### Task 7: 仕上げ(README・ビルド・通しの確認)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: ビルド** — Run: `npm run build` → `dist/assets/index-*.js` の大きさを記録(目安 120KB 以内)。`dist/` はコミットしない。
- [ ] **Step 2: 通しの確認(コントローラーが dev サーバーで行う)** — 事業所の登録 → 訪問順で「事業所から/事業所に戻る」→ 区切りが8件 → 地図のカードに出発・帰着 → 開くとURLに事業所 → 「済」→ 履歴に時刻 → 一覧の「先週の○曜日と同じ」(端末の日付を変えずに確認できる範囲で)→ 履歴の画面の曜日の絞り込み → コピー → 設定の「履歴をすべて消す」。明るい/暗いの両方。
- [ ] **Step 3: README** — 「主な機能」に 出発地・帰着地、履歴から選ぶ(8週間)、訪問済みと時刻・コピー を追記。「試運転で確かめること」に、事業所を登録してのルート、先週の同じ曜日の近道、済の時刻、履歴の自動削除 を追記。
- [ ] **Step 4: コミット**
```bash
git add README.md
git commit -m "docs: 段階2の機能と、試運転で確かめることを README に書く"
```

---

## Self-Review

**Spec coverage(4章・7章・8章):**
- 4.1 事業所の登録・出発/帰着の選択・前回の保持・URLの組み立て・分割時の扱い・上限8件の表示・共有は現状どおり → Task 1, 2, 3
- 4.2 記録のタイミング・中身・一覧の入口と近道・履歴の画面(日付/曜日/人数/先頭3人・絞り込み・全員と順番・この人たちを選ぶ)・名簿にない人・8週間で削除・設定の「履歴をすべて消す」 → Task 4, 5, 6
- 4.3 「済」と時刻・取り消し・履歴の表示とコピー → Task 6
- 7 DB v3 `history`、`meta` の office/routeEnds → Task 2, 4(バックアップへの office/routeEnds の同梱は「段階3の写真」と一緒に version 2 へ上げるときに行う — 今回は入れない)
- 8 純粋な関数を先にテスト(routePlan/history)、ブラウザ依存なし、実機の確認項目 → Task 7

**Placeholder scan:** Task 3 Step 10 と Task 5 Step 9・Task 6 Step 7 の「// ...」は「既存テストと同じ登録・選択の手順を書く」ことを指す(実装者は `tests/main.test.ts` の既存の流れを写す)。それ以外に空欄なし。

**Type consistency:** `RouteContext`(Task 3 で routePlan.ts に export、`{ ends, office }`)、`HistoryEntry`(db.ts)、`renderRouteMap` の引数の順(state, opened, provider, context, visited, handlers — Task 3 で context を足し、Task 6 で visited を足す)、`SettingsInfo.office`、`lastWeekShortcut()` の形 `{ date, count }` を確認済み。
