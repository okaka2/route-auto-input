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

  it('↑↓ボタンはその行の患者idをdata-idに持つ(フォーカス復元用)', () => {
    const state = stateWithSelection(3);
    const element = renderRouteOrder(state, new Set(), handlers());
    const ups = element.querySelectorAll<HTMLButtonElement>('[data-testid="move-up"]');
    const downs = element.querySelectorAll<HTMLButtonElement>('[data-testid="move-down"]');
    state.selectedIds.forEach((id, i) => {
      expect(ups[i]?.dataset.id).toBe(id);
      expect(downs[i]?.dataset.id).toBe(id);
    });
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

  it('ルートを開くボタンはインデックスをdata-idに持つ(フォーカス復元用)', () => {
    const element = renderRouteOrder(stateWithSelection(10), new Set(), handlers());
    const buttons = openButtons(element);
    buttons.forEach((button, i) => {
      expect(button.dataset.id).toBe(String(i));
    });
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
