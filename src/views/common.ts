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
