import { describe, expect, it } from 'vitest';
import css from '../src/styles.css?raw';

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

const themes = {
  light: readTokensIn(/:root\s*\{/),
  dark: readTokensIn(/:root\[data-theme='dark'\]\s*\{/),
};

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

describe.each(Object.entries(themes))('色の変数(%s)', (_themeName, tokens) => {
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

  it.each(TEXT_PAIRS)('文字の色 %s は背景 %s に対して 4.5:1 以上', (fg, bg) => {
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(COMPONENT_PAIRS)('部品の色 %s は背景 %s に対して 3:1 以上', (fg, bg) => {
    expect(contrast(tokens[fg]!, tokens[bg]!)).toBeGreaterThanOrEqual(3);
  });
});

describe('暗い画面', () => {
  it('OSの設定(prefers-color-scheme)でも、明示の設定(data-theme)でも暗くなる', () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)/);
    expect(css).toMatch(/:root\[data-theme='dark'\]\s*\{/);
  });
  it('color-scheme も切り替える', () => {
    expect(css).toMatch(/:root\[data-theme='dark'\][^}]*color-scheme:\s*dark/s);
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

describe('一覧の上部の文字の大きさ', () => {
  it('訪問先の名前は 18px(1.125rem)以上、本文は 16px', () => {
    expect(css).toMatch(/\.place-name\s*\{[^}]*font-size:\s*1\.125rem/s);
    expect(css).toMatch(/body\s*\{[^}]*font-size:\s*1rem/s);
  });
});

/**
 * source の position にある '{' から、対応する '}' までの中身を取り出す(入れ子のルール
 * (@media の中の .selector { ... } など)があっても、最初に出てくる '}' で切ってしまわないように、
 * 深さを数えて対応する閉じ括弧を探す)。
 */
function blockAt(source: string, openBraceIndex: number): string {
  let depth = 0;
  for (let i = openBraceIndex; i < source.length; i += 1) {
    if (source[i] === '{') {
      depth += 1;
    } else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(openBraceIndex + 1, i);
      }
    }
  }
  throw new Error('波括弧が閉じていない');
}

describe('選択バー', () => {
  it('通常の幅では1行に収まる(.selection-actionsはflex-basis: 100%にしない)', () => {
    const start = css.indexOf('.selection-actions {');
    expect(start, '.selection-actions が styles.css にない').toBeGreaterThanOrEqual(0);
    const block = blockAt(css, css.indexOf('{', start));
    expect(block).not.toContain('100%');
  });

  it('狭い画面(30rem以下)では、選択件数の下にボタンの行が回り込み、選択バーの高さもその分広げる', () => {
    const mediaStart = css.indexOf('@media (max-width: 30rem)');
    expect(mediaStart, '@media (max-width: 30rem) が styles.css にない').toBeGreaterThanOrEqual(0);
    const mediaBlock = blockAt(css, css.indexOf('{', mediaStart));
    expect(mediaBlock).toMatch(/--selbar-h:\s*7\.5rem/);
    expect(mediaBlock).toMatch(/\.selection-actions\s*\{[^}]*flex:\s*1 1 100%/s);
  });

  it('狭い画面でも通常の幅でも、選択件数の下にボタンの行が回り込めるようにしておく(flex-wrap: wrap)', () => {
    expect(css).toMatch(/\.selection-bar\s*\{[^}]*flex-wrap:\s*wrap/s);
  });
});

describe('訪問順の画面の出発・帰着(狭い画面で横にはみ出さない)', () => {
  it('.ends-row は、中身の幅で広がる素の 1fr 1fr ではなく、minmax(0, 1fr) の2列にする', () => {
    const start = css.indexOf('\n.ends-row {');
    expect(start, '.ends-row が styles.css にない').toBeGreaterThanOrEqual(0);
    const block = blockAt(css, css.indexOf('{', start));
    expect(block).not.toMatch(/grid-template-columns:\s*1fr 1fr/);
    expect(block).toMatch(/grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  });

  it('選択欄は列の幅いっぱい(width: 100%)にする', () => {
    expect(css).toMatch(/\.ends-field select\s*\{[^}]*width:\s*100%/s);
  });

  it('狭い画面(30rem以下)では1列にする(後ろにある .ends-row の定義に負けない詳しさで)', () => {
    const mediaStart = css.indexOf('@media (max-width: 30rem)');
    expect(mediaStart, '@media (max-width: 30rem) が styles.css にない').toBeGreaterThanOrEqual(0);
    const mediaBlock = blockAt(css, css.indexOf('{', mediaStart));
    // この @media は .ends-row の定義より前にあるので、素の .ends-row では後ろの2列に負ける。
    expect(mediaStart).toBeLessThan(css.indexOf('\n.ends-row {'));
    expect(mediaBlock).toMatch(/\.ends-panel \.ends-row\s*\{[^}]*grid-template-columns:\s*1fr\s*;/s);
  });
});
