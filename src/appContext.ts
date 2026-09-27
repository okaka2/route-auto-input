import type { RouteContext } from './routePlan';
import type { AppState, Message, Spot } from './types';
import type { SettingsInfo } from './views/settingsView';

/** flow のモジュールが main.ts の状態を読み書きするための口。main.ts が1つだけ作って渡す。 */
export type AppContext = {
  getState(): AppState;
  setState(next: AppState, options?: { render?: boolean }): void;
  showMessage(message: Message): void; // setState(withMessage(...)) の近道
  getSpots(): readonly Spot[];
  getRouteContext(): RouteContext;
  setRouteContext(next: RouteContext): void;
  getSettingsInfo(): Omit<SettingsInfo, 'spots'>;
  setSettingsInfo(next: Omit<SettingsInfo, 'spots'>): void;
  clearOpenedRoutes(): void;
  reloadPatients(message?: Message): Promise<void>;
  loadSpots(): Promise<void>;
  loadPhotoCounts(): Promise<void>;
  loadPhotoBytes(): Promise<void>;
  confirm(question: string): boolean; // window.confirm
};
