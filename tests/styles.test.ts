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
