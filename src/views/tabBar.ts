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
