import type { Screen } from './types';

/**
 * 端末の戻るボタン(Android の戻る・iOS の端からのスワイプ)のための、戻る記録の深さ。
 * 一覧0、訪問順・登録編集・設定・履歴1、地図2。小窓が開いていれば+1。
 */
export function navDepth(screen: Screen['name'], hasDialog: boolean): number {
  return (screen === 'list' ? 0 : screen === 'map' ? 2 : 1) + (hasDialog ? 1 : 0);
}

/** popstate の state(`{ nav: n }`)から着いた深さを読む(無い・不正なら0)。 */
export function arrivedDepth(historyState: unknown): number {
  const nav = (historyState as { nav?: unknown } | null)?.nav;
  return typeof nav === 'number' && Number.isInteger(nav) && nav > 0 ? nav : 0;
}
