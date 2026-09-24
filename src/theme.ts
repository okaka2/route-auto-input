/**
 * 表示の設定(自動/明るい/暗い)。
 * 「自動」はOSの設定(prefers-color-scheme)に従う。選んだ設定は localStorage に保存する。
 * 色そのものは styles.css の :root と :root[data-theme='dark'] だけで決める。
 */
export type ThemeSetting = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'route-auto-input:theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export function loadThemeSetting(): ThemeSetting {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveThemeSetting(setting: ThemeSetting): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, setting);
  } catch {
    // localStorageが使えない環境では諦める。次回は自動に戻るだけ。
  }
}

export function resolveTheme(setting: ThemeSetting, prefersDark: boolean): 'light' | 'dark' {
  if (setting === 'auto') {
    return prefersDark ? 'dark' : 'light';
  }
  return setting;
}

function prefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** 設定を <html data-theme> に反映する。 */
export function applyTheme(setting: ThemeSetting): void {
  document.documentElement.dataset.theme = resolveTheme(setting, prefersDark());
}

/** 起動時に呼ぶ。保存した設定を反映し、「自動」のときはOSの切り替えにも追従する。 */
export function initTheme(): void {
  applyTheme(loadThemeSetting());
  if (typeof window.matchMedia !== 'function') {
    return;
  }
  window.matchMedia(DARK_QUERY).addEventListener('change', () => {
    applyTheme(loadThemeSetting());
  });
}
