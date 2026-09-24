import { describe, expect, it, vi } from 'vitest';
import { MAX_STOPS_PER_ROUTE } from '../src/config';
import { createPatient } from '../src/patient';
import { DEFAULT_ROUTE_ENDS, type Office, type RouteContext } from '../src/routePlan';
import { createInitialState } from '../src/state';
import { renderRouteOrder, type RouteOrderHandlers } from '../src/views/routeOrderView';
import type { AppState, Patient } from '../src/types';

const handlers = (): RouteOrderHandlers => ({
  onMove: vi.fn(),
  onOpenStopMenu: vi.fn(),
  onAddStops: vi.fn(),
  onOpenMap: vi.fn(),
  onBack: vi.fn(),
  onEndsChange: vi.fn(),
});

const office: Office = { name: '本店', address: '東京都中央区1-1' };
const context = (office: Office | null = null, ends = DEFAULT_ROUTE_ENDS): RouteContext => ({ ends, office });

function makeStops(count: number, addresses?: string[]): Patient[] {
  return Array.from({ length: count }, (_, i) =>
    createPatient(`場所${i + 1}`, addresses?.[i] ?? `東京都${i + 1}-1`),
  );
}

function stateWithSelection(count: number, addresses?: string[]): AppState {
  const patients = makeStops(count, addresses);
  return { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
}

const selectedState = stateWithSelection;

const rows = (element: HTMLElement) =>
  [...element.querySelectorAll<HTMLElement>('[data-testid="stop-row"]')];
const q = <T extends HTMLElement = HTMLElement>(element: HTMLElement, testid: string): T =>
  element.querySelector<T>(`[data-testid="${testid}"]`)!;

describe('renderRouteOrder: 訪問順の並び', () => {
  it('見出しは「訪問順を決める」', () => {
    expect(renderRouteOrder(stateWithSelection(3), context(), handlers()).querySelector('h1')?.textContent).toBe(
      '訪問順を決める',
    );
  });

  it('選択した訪問先を訪問順に描画する', () => {
    const element = renderRouteOrder(stateWithSelection(3), context(), handlers());
    expect(rows(element)).toHaveLength(3);
    expect(rows(element)[0]?.textContent).toContain('場所1');
    expect(rows(element)[2]?.textContent).toContain('場所3');
  });

  it('名前と住所を表示する', () => {
    const element = renderRouteOrder(stateWithSelection(1), context(), handlers());
    expect(rows(element)[0]?.querySelector('.stop-name')?.textContent).toBe('場所1');
    expect(rows(element)[0]?.querySelector('.stop-address')?.textContent).toBe('東京都1-1');
  });

  it('各行に、訪問順の番号(1, 2, 3…)を大きく表示する', () => {
    const element = renderRouteOrder(stateWithSelection(3), context(), handlers());
    const numbers = rows(element).map((row) => row.querySelector('.stop-number')?.textContent);
    expect(numbers).toEqual(['1', '2', '3']);
  });

  it('先頭に START、末尾に GOAL のバッジを付け、途中にはバッジを付けない', () => {
    const element = renderRouteOrder(stateWithSelection(3), context(), handlers());
    const badges = rows(element).map((row) => row.querySelector('[data-testid="stop-badge"]')?.textContent);
    expect(badges).toEqual(['START', undefined, 'GOAL']);
  });

  it('2件のときは、1件目が START、2件目が GOAL', () => {
    const element = renderRouteOrder(stateWithSelection(2), context(), handlers());
    const badges = rows(element).map((row) => row.querySelector('[data-testid="stop-badge"]')?.textContent);
    expect(badges).toEqual(['START', 'GOAL']);
  });

  it('1件だけのときは START / GOAL を出さず、その場所を開くことを案内する', () => {
    const element = renderRouteOrder(stateWithSelection(1), context(), handlers());
    expect(element.querySelector('[data-testid="stop-badge"]')).toBeNull();
    expect(element.textContent).toContain('1件だけのときは、その場所を地図で開きます。');
  });

  it('2件以上のときは、1件だけの案内を出さない', () => {
    const element = renderRouteOrder(stateWithSelection(2), context(), handlers());
    expect(element.textContent).not.toContain('1件だけのとき');
  });
});

describe('renderRouteOrder: 並べ替え(▲▼)', () => {
  it('先頭の「上へ」と末尾の「下へ」は押せない', () => {
    const element = renderRouteOrder(stateWithSelection(3), context(), handlers());
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
    const element = renderRouteOrder(state, context(), spies);
    element.querySelectorAll<HTMLButtonElement>('[data-testid="move-up"]')[1]?.click();
    expect(spies.onMove).toHaveBeenCalledWith(state.selectedIds[1], -1);
  });

  it('「下へ」で onMove が +1 つきで呼ばれる', () => {
    const state = stateWithSelection(2);
    const spies = handlers();
    const element = renderRouteOrder(state, context(), spies);
    element.querySelectorAll<HTMLButtonElement>('[data-testid="move-down"]')[0]?.click();
    expect(spies.onMove).toHaveBeenCalledWith(state.selectedIds[0], 1);
  });

  it('↑↓ボタンは、その行の訪問先のid を data-id に持つ(フォーカス復元用)', () => {
    const state = stateWithSelection(3);
    const element = renderRouteOrder(state, context(), handlers());
    const ups = element.querySelectorAll<HTMLButtonElement>('[data-testid="move-up"]');
    const downs = element.querySelectorAll<HTMLButtonElement>('[data-testid="move-down"]');
    state.selectedIds.forEach((id, i) => {
      expect(ups[i]?.dataset.id).toBe(id);
      expect(downs[i]?.dataset.id).toBe(id);
    });
  });

  it('↑↓ボタンには、どの訪問先の操作かが分かる名前(aria-label)を付ける', () => {
    const element = renderRouteOrder(stateWithSelection(2), context(), handlers());
    expect(q(element, 'move-up').getAttribute('aria-label')).toBe('場所1を上へ');
    expect(q(element, 'move-down').getAttribute('aria-label')).toBe('場所1を下へ');
  });

  it('並べ替えの案内文を出す', () => {
    const element = renderRouteOrder(stateWithSelection(2), context(), handlers());
    expect(element.querySelector('[data-testid="order-hint"]')?.textContent).toContain('▲▼');
  });
});

describe('renderRouteOrder: 「⋯」メニュー', () => {
  it('各行に「⋯」があり、押すと onOpenStopMenu が id つきで呼ばれる', () => {
    const state = stateWithSelection(2);
    const spies = handlers();
    const element = renderRouteOrder(state, context(), spies);
    const menus = [...element.querySelectorAll<HTMLButtonElement>('[data-testid="stop-menu"]')];
    expect(menus).toHaveLength(2);
    state.selectedIds.forEach((id, i) => {
      expect(menus[i]?.dataset.id).toBe(id);
    });
    menus[0]!.click();
    expect(spies.onOpenStopMenu).toHaveBeenCalledWith(state.selectedIds[0]);
  });
});

describe('renderRouteOrder: 警告とメッセージ', () => {
  it('同じ住所が複数あれば警告を出す', () => {
    const element = renderRouteOrder(
      stateWithSelection(3, ['東京都1-1', '大阪府2-2', '東京都1-1']),
      context(),
      handlers(),
    );
    expect(q(element, 'duplicate-warning').textContent).toContain('同じ住所の訪問先');
  });

  it('住所に重複がなければ警告を出さない', () => {
    const element = renderRouteOrder(stateWithSelection(3), context(), handlers());
    expect(element.querySelector('[data-testid="duplicate-warning"]')).toBeNull();
  });

  it('重複の警告があっても、地図を開くボタンは押せる(ブロックしない)', () => {
    const element = renderRouteOrder(
      stateWithSelection(2, ['東京都1-1', '東京都1-1']),
      context(),
      handlers(),
    );
    expect(q<HTMLButtonElement>(element, 'open-map-button').disabled).toBe(false);
  });

  it('メッセージ領域は VoiceOver に読み上げられるよう role=status を持つ', () => {
    const state = { ...stateWithSelection(2), message: { kind: 'error' as const, text: 'エラー' } };
    const element = renderRouteOrder(state, context(), handlers());
    expect(element.querySelector('.message')?.getAttribute('role')).toBe('status');
  });
});

describe('renderRouteOrder: 操作', () => {
  it('戻るボタンで onBack が呼ばれる', () => {
    const spies = handlers();
    q<HTMLButtonElement>(renderRouteOrder(stateWithSelection(2), context(), spies), 'back-button').click();
    expect(spies.onBack).toHaveBeenCalledTimes(1);
  });

  it('「＋ 訪問先を追加」で onAddStops が呼ばれる', () => {
    const spies = handlers();
    const button = q<HTMLButtonElement>(renderRouteOrder(stateWithSelection(2), context(), spies), 'add-stops-button');
    expect(button.textContent).toBe('＋ 訪問先を追加');
    button.click();
    expect(spies.onAddStops).toHaveBeenCalledTimes(1);
  });

  it('主要ボタン「この順番で地図を開く →」で onOpenMap が呼ばれる', () => {
    const spies = handlers();
    const button = q<HTMLButtonElement>(renderRouteOrder(stateWithSelection(2), context(), spies), 'open-map-button');
    expect(button.textContent).toBe('この順番で地図を開く →');
    expect(button.classList.contains('primary')).toBe(true);
    button.click();
    expect(spies.onOpenMap).toHaveBeenCalledTimes(1);
  });
});

describe('renderRouteOrder: ルートの区切り', () => {
  function makePatients(count: number): Patient[] {
    return Array.from({ length: count }, (_, i) =>
      createPatient(`場所${i + 1}`, `東京都${i + 1}-1`),
    );
  }

  it('1ルートの上限を超えると、区切りの行「── ここからルート2 ──」を出す', () => {
    const patients = makePatients(MAX_STOPS_PER_ROUTE + 2);
    const state = { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
    const element = renderRouteOrder(state, context(), handlers());
    const dividers = [...element.querySelectorAll('[data-testid="route-divider"]')];
    expect(dividers).toHaveLength(1);
    expect(dividers[0]!.textContent).toBe('── ここからルート2 ──');
    // 区切りは、上限件目の行の直後にある
    const items = [...element.querySelectorAll<HTMLElement>('.stop-timeline > li')];
    expect(items[MAX_STOPS_PER_ROUTE]!.dataset.testid).toBe('route-divider');
  });

  it('上限以内なら区切りは出ない', () => {
    const patients = makePatients(3);
    const state = { ...createInitialState(patients), selectedIds: patients.map((p) => p.id) };
    expect(renderRouteOrder(state, context(), handlers()).querySelector('[data-testid="route-divider"]')).toBeNull();
  });
});

describe('renderRouteOrder: 訪問先が選ばれていないとき', () => {
  it('案内を出し、地図を開くボタンは出さない。追加のボタンは出す', () => {
    const element = renderRouteOrder(createInitialState([]), context(), handlers());
    expect(element.textContent).toContain('訪問先が選ばれていません');
    expect(rows(element)).toHaveLength(0);
    expect(element.querySelector('[data-testid="open-map-button"]')).toBeNull();
    expect(element.querySelector('[data-testid="add-stops-button"]')).not.toBeNull();
  });
});

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
    const items = [...element.querySelectorAll<HTMLElement>('.stop-timeline > li')];
    expect(items[8]!.dataset.testid).toBe('route-divider');
    expect(element.textContent).toContain('訪問先は1ルート8件まで');
  });
});
