import './styles.css';
import { parseBackup, serializeBackup } from './backup';
import { MAX_STOPS_PER_ROUTE } from './config';
import {
  addPhoto,
  clearHistory,
  countPhotosByPatient,
  deleteHistoryBefore,
  deleteMeta,
  deleteOrphanPhotos,
  deletePatient,
  deletePatients,
  deletePhoto,
  deletePhotosOf,
  deleteSpot,
  getMeta,
  listAllPhotos,
  listHistory,
  listPatients,
  listPhotos,
  listSpots,
  mergePatients,
  putPhotos,
  putSpot,
  putSpots,
  replaceAllPatients,
  savePatient,
  setMeta,
  updateHistory,
  type HistoryEntry,
} from './db';
import { downloadTextFile, readTextFile } from './fileIo';
import { isShortMapsUrl, parseLocationText, pointOf } from './geoPoint';
import { dateKey, formatHistoryDate, formatVisits, keepFromDate, lastWeekSameWeekday, restoreSelection } from './history';
import { shouldShowInstallHint } from './installHint';
import { DEFAULT_MAP_PROVIDER } from './mapProviders';
import { openUrl } from './openRoute';
import { checkPassword, isUnlocked, renderPasswordGate, unlock } from './passwordGate';
import { findSimilar } from './normalize';
import { createPatient, updatePatientFields, withLocation, withVisitInfo } from './patient';
import { blobToDataUrl, dataUrlToBlob } from './photoCodec';
import { isStandaloneDisplay } from './platform';
import { isStoragePersisted, requestPersistentStorage } from './protection';
import { daysBetween, shouldRemindBackup } from './backupReminder';
import { buildRoutePlans, DEFAULT_ROUTE_ENDS, type RouteContext, type RouteEnds } from './routePlan';
import { clearSession, loadSession, saveSession } from './session';
import { buildShareText, copyText, shareText } from './share';
import { SPOT_KINDS } from './spots';
import { registerServiceWorkerUpdates } from './swUpdate';
import { applyTheme, initTheme, loadThemeSetting, saveThemeSetting } from './theme';
import {
  clearSelection,
  closeDialog,
  createInitialState,
  hasSelection,
  moveSelected,
  moveSelectedToEdge,
  openDeleteConfirm,
  openDeleteSelectedConfirm,
  openRowMenu,
  openStopMenu,
  selectAllVisible,
  selectedPatients,
  setListFilter,
  setSearchQuery,
  setSortOrder,
  toggleSelection,
  visiblePatients,
  withMessage,
  withPatients,
  withScreen,
} from './state';
import type {
  AppState,
  Dialog,
  GeoLocation,
  LocationDialog,
  Message,
  Patient,
  PatientFormDraft,
  Photo,
  SortOrder,
  Spot,
  SpotDialog,
  SpotKind,
} from './types';
import { permitsExpiringSoon } from './visitInfo';
import { validatePatientInput, validateSelection } from './validation';
import { renderDialog } from './views/dialogs';
import { renderHistory } from './views/historyView';
import { renderPatientForm } from './views/patientFormView';
import { renderPatientList } from './views/patientListView';
import { renderRouteOrder } from './views/routeOrderView';
import { renderRouteMap } from './views/routeMapView';
import { renderSelectionBar } from './views/selectionBar';
import { renderSettings, type SettingsInfo } from './views/settingsView';
import { renderTabBar, type Step } from './views/tabBar';
import type { Notice } from './views/notice';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('#app が見つかりません。');
}

// ロックの状態に関係なく、表示の設定(明るい/暗い)を先に反映する。
initTheme();

// ロックの状態に関係なく、新しいバージョンが出ていれば自動で反映する。
registerServiceWorkerUpdates();

// Escキーでダイアログを閉じる。document に付けるのは、ダイアログの背景など
// フォーカスを持てない場所をクリックすると activeElement が document.body へ移り
// (#app の外)、root へ付けたリスナーにはEscキーが届かなくなるため(#app はイベントの
// targetの子孫ではなく祖先になり、バブリングでは到達しない)。
// テストで main.ts を読み込み直すたびに document へリスナーが積み重ならないよう、
// window に前回のハンドラーを覚えておき、新しく付ける前に外す。
type WindowWithEscapeHandler = typeof window & {
  __routeAutoInputEscapeHandler?: (event: KeyboardEvent) => void;
};
const globalWindow = window as WindowWithEscapeHandler;
if (globalWindow.__routeAutoInputEscapeHandler) {
  document.removeEventListener('keydown', globalWindow.__routeAutoInputEscapeHandler);
}
function handleEscapeKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && state.dialog !== null) {
    event.preventDefault();
    closeAnyDialog();
  }
}
globalWindow.__routeAutoInputEscapeHandler = handleEscapeKeydown;
document.addEventListener('keydown', handleEscapeKeydown);

// Android の Chrome が「インストールできる」と知らせてきたイベント。ボタン1つで追加するために取っておく。
// テストで main.ts を読み込み直すたびに window へリスナーが積み重ならないよう、
// 前回のハンドラーを覚えておき、新しく付ける前に外す(Escキーのハンドラーと同じ理由)。
type WindowWithInstallPromptHandler = typeof window & {
  __routeAutoInputInstallPromptHandler?: (event: Event) => void;
};
const globalWindowForInstall = window as WindowWithInstallPromptHandler;
if (globalWindowForInstall.__routeAutoInputInstallPromptHandler) {
  window.removeEventListener('beforeinstallprompt', globalWindowForInstall.__routeAutoInputInstallPromptHandler);
}
let deferredInstallPrompt: (Event & { prompt(): Promise<void> }) | null = null;
function handleBeforeInstallPrompt(event: Event): void {
  event.preventDefault();
  deferredInstallPrompt = event as Event & { prompt(): Promise<void> };
  render();
}
globalWindowForInstall.__routeAutoInputInstallPromptHandler = handleBeforeInstallPrompt;
window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

// Googleマップへ遷移して戻ってきたときのために、選択・訪問順・開いたルートを
// localStorageから復元する(Ruling 7)。復元できた場合、開いたルートがあれば地図の画面、
// なければ訪問順の画面から始める。
const restoredSession = loadSession();
let state: AppState = restoredSession
  ? {
      ...createInitialState([]),
      selectedIds: restoredSession.selectedIds,
      // 開いたルートがあれば、地図アプリから戻ってきた状況。次に開くルートがすぐ分かるよう、
      // 地図の画面から始める。なければ、これまでどおり訪問順の画面から始める。
      screen: { name: restoredSession.opened.length > 0 ? 'map' : 'order' },
    }
  : createInitialState([]);
// 開いたルートの番号と、開いた日時(ISO 8601。日時が分からない古い記録から復元したものは '')。
const openedRoutes = new Map<number, string>(
  (restoredSession?.opened ?? []).map((route) => [route.index, route.at] as const),
);

// 保存に失敗した直後の入力値。入力内容を画面に残すため(spec §8)、
// openedRoutesと同様にAppStateの外で保持する。
let formDraft: PatientFormDraft | null = null;

// 訪問先ごとの写真の枚数。起動時と、写真の追加・削除・訪問先の削除のあとに読み直す。
let photoCounts = new Map<string, number>();

// 登録済みのお役立ち地点(トイレ・休憩など)。起動時と、登録・削除のあとに読み直す。
let spots: Spot[] = [];

// 編集フォームに出す写真(object URLつき)。フォームを開くときlistPhotosから作り、
// フォームを離れる/読み直すときに revoke する(片付けはsetState一箇所にまとめる。下記参照)。
let formPhotos: { id: string; url: string }[] = [];

// 保存/削除の二重実行防止(ボタンを連打してもDBへ二重に書き込まない)。
let savingPatient = false;
// 「保存して続けて登録」で続けて登録した人数。
let continueCount = 0;
const deletingPatientIds = new Set<string>();
let deletingSelected = false;
// お役立ち地点の保存の二重実行防止(「この位置で登録」の連打で二重に登録しない)。
let savingSpot = false;

// 「⋯」から開いたダイアログを、編集・複製・削除以外で閉じたとき、フォーカスを戻す行のid。
// お役立ち地点の登録ダイアログを閉じたときは SPOT_RETURN_ID を入れ、地図の画面の
// 「今いる場所をお役立ち地点に登録」ボタンへフォーカスを戻す。
let dialogReturnId: string | null = null;
const SPOT_RETURN_ID = '__spot-add';

// 位置を測っている最中なら、止めるための関数。測っていなければ null。
// 止める場所はsetState一箇所にまとめる(下記参照)。
let stopMeasuring: (() => void) | null = null;

/** 測定中なら止めて、stopMeasuringをnullに戻す(二重に止めても安全)。 */
function stopCurrentMeasuring(): void {
  stopMeasuring?.();
  stopMeasuring = null;
}

// 設定画面に出す情報(最後のバックアップ日時・データの保存状態・表示の設定・事業所)。
// spotsは含めない(この変数はDBから読み直すたびに更新される情報の置き場で、お役立ち地点は
// 別に持っている`spots`が唯一の出所。設定画面へ渡す直前に{ ...settingsInfo, spots }で合わせる)。
let settingsInfo: Omit<SettingsInfo, 'spots'> = {
  lastBackupAt: null,
  persisted: null,
  theme: loadThemeSetting(),
  office: null,
  photoBytes: 0,
};

// 出発・帰着の選び方と事業所。起動時に loadRouteContext() で読み直す(Task 3 が使う)。
let routeContext: RouteContext = { ends: DEFAULT_ROUTE_ENDS, office: null };

// 履歴(日付ごとの記録)。起動時と記録後に listHistory() で読み直す。
let historyEntries: HistoryEntry[] = [];
// loadSettingsInfo() が一度でも終わったか。終わる前はlastBackupAtがnullのままなので、
// バックアップのお知らせ(「まだバックアップがありません」)を誤って出さないためのガード。
let settingsLoaded = false;

// バックアップのお知らせで「あとで」を押した日時を覚えておくキー。
const BACKUP_LATER_KEY = 'route-auto-input:backup-later';
// ホーム画面への追加の案内で「閉じる」を押した日時を覚えておくキー。
const INSTALL_DISMISS_KEY = 'route-auto-input:install-dismissed';
// 許可証の期限のお知らせで「閉じる」を押した日時を覚えておくキー。
const PERMIT_DISMISS_KEY = 'route-auto-input:permit-dismissed';
const PERMIT_DISMISS_DAYS = 7;
// データ保護のお願い(Storage API)は、一度成功したら繰り返し頼まない。
let persistRequested = false;

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 使えない環境では諦める。
  }
}

/** 「閉じる」を押してから PERMIT_DISMISS_DAYS 日以内かどうか。 */
function isRecentlyDismissed(dismissedAt: string | null, now: Date): boolean {
  if (dismissedAt === null) {
    return false;
  }
  return now.getTime() - new Date(dismissedAt).getTime() < PERMIT_DISMISS_DAYS * 86_400_000;
}

/** 一覧の上に出すお知らせ。Task 4 でホーム画面の案内を先頭に足す。 */
function currentNotice(): Notice | null {
  if (
    shouldShowInstallHint({
      standalone: isStandaloneDisplay(),
      dismissedAt: readLocal(INSTALL_DISMISS_KEY),
      now: new Date(),
    })
  ) {
    const install = deferredInstallPrompt;
    return {
      testid: 'install-notice',
      text: 'ホーム画面に追加すると、データが消えにくくなり、アプリのように使えます。',
      actions: [
        install
          ? {
              label: 'ホーム画面に追加',
              testid: 'notice-install',
              primary: true,
              onClick: () => {
                deferredInstallPrompt = null;
                void install.prompt().catch(() => {
                  // 使い終わった、または断られた。案内は次の描画で「やり方を見る」に戻る。
                });
                render();
              },
            }
          : {
              label: 'やり方を見る',
              testid: 'notice-install-steps',
              primary: true,
              onClick: () => setState({ ...state, dialog: { kind: 'installSteps' } }),
            },
        {
          label: '閉じる',
          testid: 'notice-install-dismiss',
          onClick: () => {
            writeLocal(INSTALL_DISMISS_KEY, new Date().toISOString());
            render();
          },
        },
      ],
    };
  }
  const expiringCount = permitsExpiringSoon(state.patients, new Date());
  if (expiringCount > 0 && !isRecentlyDismissed(readLocal(PERMIT_DISMISS_KEY), new Date())) {
    return {
      testid: 'permit-notice',
      text: `許可証の期限が近い訪問先: ${expiringCount}件。期限を確かめてください。`,
      actions: [
        {
          label: '閉じる',
          testid: 'notice-permit-dismiss',
          onClick: () => {
            writeLocal(PERMIT_DISMISS_KEY, new Date().toISOString());
            render();
          },
        },
      ],
    };
  }
  if (
    settingsLoaded &&
    shouldRemindBackup({
      patientCount: state.patients.length,
      lastBackupAt: settingsInfo.lastBackupAt,
      laterAt: readLocal(BACKUP_LATER_KEY),
      now: new Date(),
    })
  ) {
    const text =
      settingsInfo.lastBackupAt === null
        ? 'まだバックアップがありません。スマホの故障や機種変更に備えて、保存しておきましょう。'
        : `最後のバックアップから${daysBetween(settingsInfo.lastBackupAt, new Date())}日たちました。スマホの故障や機種変更に備えて、保存しておきましょう。`;
    return {
      testid: 'backup-notice',
      text,
      actions: [
        { label: '今すぐバックアップ', testid: 'notice-backup', primary: true, onClick: () => { void handleExport(); } },
        {
          label: 'あとで',
          testid: 'notice-later',
          onClick: () => {
            writeLocal(BACKUP_LATER_KEY, new Date().toISOString());
            render();
          },
        },
      ],
    };
  }
  return null;
}

/** ブラウザに「このサイトのデータは消さないで」と一度だけ頼む(Task 3)。 */
function requestProtectionOnce(): void {
  if (persistRequested) {
    return;
  }
  persistRequested = true;
  void requestPersistentStorage().then((granted) => {
    settingsInfo = { ...settingsInfo, persisted: granted ? true : settingsInfo.persisted };
  });
}

/**
 * 設定画面用の情報をDBやブラウザから読み直す。一覧画面のバックアップのお知らせも
 * この情報(lastBackupAt)で出す/出さないを決めるため、どの画面でも読み直したら再描画する。
 */
async function loadSettingsInfo(): Promise<void> {
  try {
    const [lastBackupAt, persisted, photoBytes] = await Promise.all([
      getMeta('lastBackupAt'),
      isStoragePersisted(),
      sumPhotoBytes(),
    ]);
    settingsInfo = { ...settingsInfo, lastBackupAt: lastBackupAt ?? null, persisted, photoBytes };
  } catch {
    // 読み込みに失敗しても、アプリを止めない。今のsettingsInfoをそのまま使う
    // (お知らせはsettingsLoadedがtrueになった時点でlastBackupAt: nullとして出る)。
  } finally {
    settingsLoaded = true;
    render();
  }
}

/** バックアップの「写真も含める」に出す合計バイト数。読めなければ0扱い(この関数自体は例外を投げない)。 */
async function sumPhotoBytes(): Promise<number> {
  try {
    const photos = await listAllPhotos();
    return photos.reduce((sum, photo) => sum + photo.blob.size, 0);
  } catch {
    return 0;
  }
}

/** 写真を追加・削除したあと、設定画面の合計サイズだけを読み直す(ほかの設定情報はそのまま)。 */
async function loadPhotoBytes(): Promise<void> {
  const photoBytes = await sumPhotoBytes();
  settingsInfo = { ...settingsInfo, photoBytes };
  render();
}

/** 出発・帰着の選び方と事業所をDBから読み直す(Task 3 が使う)。 */
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

async function loadHistory(): Promise<void> {
  try {
    historyEntries = await listHistory();
  } catch {
    historyEntries = [];
  }
  render();
}

/** 訪問先ごとの写真の枚数をDBから読み直す。読めなくても、写真の件数バッジが出ないだけで止めない。 */
async function loadPhotoCounts(): Promise<void> {
  try {
    photoCounts = await countPhotosByPatient();
  } catch {
    // 読めなくても、地図のカードの写真バッジが出ないだけ。
  }
  render();
}

/** お役立ち地点をDBから読み直す。起動時と、登録・削除のあとに呼ぶ。新しい順(登録日時の降順)にそろえる。 */
async function loadSpots(): Promise<void> {
  try {
    spots = (await listSpots()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    spots = [];
  }
  render();
}

/** 「地図を開く」を押したとき、その日の訪問先と順番を記録する(同じ日は上書き。済の記録は保つ)。 */
async function recordTodayRoute(): Promise<void> {
  const ids = state.selectedIds;
  if (ids.length === 0) return;
  // 呼び出し後にawaitを挟むため、書き込む内容は最初のawaitより前(今の状態)で確定させておく。
  // 途中で routeContext が変わっても、この記録には影響させない。
  const ends = routeContext.ends;
  const date = dateKey(new Date());
  try {
    await updateHistory(date, (existing) => {
      const visited = Object.fromEntries(Object.entries(existing?.visited ?? {}).filter(([id]) => ids.includes(id)));
      return { date, ids: [...ids], routeEnds: ends, visited };
    });
    await loadHistory();
  } catch {
    // 記録できなくても地図は開ける。
  }
}

/** 今日の記録に残っている訪問済み(訪問先 id → 訪問済みにした日時)。記録が無ければ空。 */
function todayVisited(): Map<string, string> {
  const today = historyEntries.find((e) => e.date === dateKey(new Date()));
  return new Map(Object.entries(today?.visited ?? {}));
}

/** 地図の画面の「済」ボタン。押すたびに訪問済み/未訪問を切り替える。 */
async function toggleVisited(id: string): Promise<void> {
  const date = dateKey(new Date());
  try {
    await updateHistory(date, (existing) => {
      const base = existing ?? { date, ids: [...state.selectedIds], routeEnds: routeContext.ends, visited: {} };
      // 今日の記録に無い(=今日のルートに含まれない)訪問先は、済にできない。
      if (base.ids.length > 0 && !base.ids.includes(id)) return base;
      const visited = { ...base.visited };
      if (visited[id]) delete visited[id];
      else visited[id] = new Date().toISOString();
      return { ...base, visited };
    });
    await loadHistory();
  } catch {
    setState(withMessage(state, { kind: 'error', text: '訪問済みを記録できませんでした。' }));
  }
}

/** 履歴の画面の「コピー」。日報などに貼り付けられるよう、訪問した時刻と名前をテキストでコピーする。 */
async function copyVisits(date: string): Promise<void> {
  const entry = historyEntries.find((e) => e.date === date);
  if (!entry) return;
  const visits = formatVisits(entry, state.patients);
  if (visits === '') {
    setState(withMessage(state, { kind: 'info', text: 'まだ訪問済みがありません。' }));
    return;
  }
  try {
    await copyText(`${formatHistoryDate(date)} 訪問: ${visits}`);
    setState(withMessage(state, { kind: 'info', text: 'コピーしました。日報などに貼り付けてください。' }));
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'コピーできませんでした。' }));
  }
}

/** 設定画面の「履歴をすべて消す」。確認してから全消去する。 */
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

function lastWeekShortcut(): { date: string; count: number } | null {
  const entry = lastWeekSameWeekday(historyEntries, new Date());
  return entry ? { date: entry.date, count: entry.ids.length } : null;
}

function pickHistory(date: string): void {
  const entry = historyEntries.find((e) => e.date === date);
  if (!entry) return;
  const { ids, missing } = restoreSelection(entry, state.patients);
  if (ids.length === 0) {
    // 記録の訪問先が全員名簿から消えていた。選べる相手がいないので、訪問順へは進めない。
    setState(withMessage(state, { kind: 'error', text: '記録の訪問先は、すべて名簿にないため選べませんでした。' }));
    return;
  }
  routeContext = { ...routeContext, ends: entry.routeEnds };
  void setMeta('routeEnds', entry.routeEnds).catch(() => undefined);
  openedRoutes.clear();
  const next = withScreen({ ...state, selectedIds: ids }, { name: 'order' });
  setState(
    withMessage(
      next,
      missing > 0
        ? { kind: 'info', text: `${ids.length}人を選びました。${missing}人は名簿にないため選べませんでした。` }
        : { kind: 'info', text: `${ids.length}人を選びました。` },
    ),
  );
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

/** 次のdialogが、測定を続けてよい「同じ」ダイアログか(location: 同じ訪問先のid、spot: 地点のダイアログのまま)。 */
function isSameMeasuringDialog(
  dialog: Dialog | null,
  target: { kind: 'location'; id: string } | { kind: 'spot' },
): dialog is LocationDialog | SpotDialog {
  if (dialog === null) {
    return false;
  }
  if (target.kind === 'location') {
    return dialog.kind === 'location' && dialog.id === target.id;
  }
  return dialog.kind === 'spot';
}

/**
 * 位置・地点を測っている最中に、ダイアログが閉じる/画面が変わる/別の訪問先へ切り替わる
 * (いずれも次のdialogが「同じ測定中のダイアログ」でなくなる)なら、ここ一箇所で止める。
 */
function setState(next: AppState): void {
  const previousDialog = state.dialog;
  const previousScreen = state.screen;
  state = next;
  if (stopMeasuring !== null) {
    const stillSameMeasuring =
      previousDialog !== null &&
      (previousDialog.kind === 'location'
        ? isSameMeasuringDialog(next.dialog, { kind: 'location', id: previousDialog.id })
        : previousDialog.kind === 'spot' && isSameMeasuringDialog(next.dialog, { kind: 'spot' }));
    if (!stillSameMeasuring) {
      stopCurrentMeasuring();
    }
  }
  // フォームを離れる/別の訪問先の編集へ切り替わるとき、フォームの写真のobject URLを片付ける。
  const stillSameForm =
    previousScreen.name === 'form' &&
    next.screen.name === 'form' &&
    next.screen.patientId === previousScreen.patientId;
  if (previousScreen.name === 'form' && !stillSameForm) {
    replaceFormPhotos([]);
  }
  // 写真のダイアログを閉じる/urlsが作り直されたとき、そのobject URLを片付ける。
  // 同じ訪問先でも開き直せばurlsは新しい配列になるので、patientIdではなく配列そのもの
  // (参照)で「まだ同じ表示か」を見分ける(前/次でindexだけ変える再描画はurlsを使い回す)。
  const stillSamePhotosDialog =
    previousDialog !== null &&
    previousDialog.kind === 'photos' &&
    next.dialog !== null &&
    next.dialog.kind === 'photos' &&
    next.dialog.urls === previousDialog.urls;
  if (previousDialog !== null && previousDialog.kind === 'photos' && !stillSamePhotosDialog) {
    for (const url of previousDialog.urls) {
      URL.revokeObjectURL(url);
    }
  }
  render();
}

/** formPhotosを入れ替える。今持っているobject URLは、入れ替える前に必ず片付ける。 */
function replaceFormPhotos(next: { id: string; url: string }[]): void {
  for (const photo of formPhotos) {
    URL.revokeObjectURL(photo.url);
  }
  formPhotos = next;
}

function syncSession(): void {
  if (state.selectedIds.length === 0) {
    clearSession();
    return;
  }
  saveSession({
    selectedIds: state.selectedIds,
    opened: [...openedRoutes].map(([index, at]) => ({ index, at })),
    timestamp: new Date().toISOString(),
  });
}

/**
 * DBから患者を読み直す。message を渡したときだけ、表示中のメッセージを差し替える。
 * 省略したとき(起動直後の読み込みなど)は今のメッセージを保つ。保たないと、読み込みが
 * 終わった瞬間に、操作の結果として出たばかりのエラーや案内を消してしまう。
 */
async function reloadPatients(message?: Message): Promise<void> {
  try {
    const patients = await listPatients();
    const next = withPatients(state, patients);
    // withPatients は selectedIds を filter するだけで、要素を足したり並べ替えたりはしない。
    // よって長さが減っていれば、選択していた訪問先のどれかが読み直しで消えたということ。
    // そのルートの内容はもう変わっているので、開いた印は古くなる前に消す。
    if (next.selectedIds.length !== state.selectedIds.length) {
      openedRoutes.clear();
    }
    setState({
      ...next,
      ...(message === undefined ? {} : { message }),
    });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを読み込めませんでした。' }));
  }
}

function currentEditingPatient(): Patient | null {
  const screen = state.screen;
  if (screen.name !== 'form' || screen.patientId === null) {
    return null;
  }
  const id = screen.patientId;
  return state.patients.find((patient) => patient.id === id) ?? null;
}

type FormInput = PatientFormDraft;

/** 保存の入口。検証 → 同じ人の確認 → 保存。 */
async function handleSaveRequest(input: FormInput, continueAfter: boolean): Promise<void> {
  const validation = validatePatientInput(input.name, input.address);
  if (!validation.ok) {
    formDraft = input;
    setState(withMessage(state, { kind: 'error', text: validation.message }));
    return;
  }
  const editing = currentEditingPatient();
  const matches = findSimilar(state.patients, input, editing?.id ?? null);
  if (matches.length > 0) {
    formDraft = input;
    setState({ ...state, dialog: { kind: 'similar', input, matchIds: matches.map((m) => m.id), continueAfter } });
    return;
  }
  await commitSave(input, continueAfter);
}

async function commitSave(input: FormInput, continueAfter: boolean): Promise<void> {
  if (savingPatient) {
    // 保存中の二重タップ。何もしない(2件目のUUIDが発行されるのを防ぐ)。
    return;
  }
  savingPatient = true;
  try {
    const existing = currentEditingPatient();
    const patient =
      existing === null
        ? withVisitInfo(createPatient(input.name, input.address, new Date(), input.phone), input)
        : withVisitInfo(updatePatientFields(existing, input.name, input.address, new Date(), input.phone), input);
    if (existing !== null && state.selectedIds.includes(existing.id)) {
      // 選択中(=ルートに入っている)訪問先の編集。住所が変わったかもしれないので、
      // そのルートについて開いた印は古くなる前に消す。
      openedRoutes.clear();
    }
    await savePatient(patient);
    requestProtectionOnce();
    if (continueAfter && existing === null) {
      continueCount += 1;
      formDraft = { name: '', address: '', phone: '', parkingType: '', permitExpires: '', note: '' };
      setState({
        ...withScreen(state, { name: 'form', patientId: null }),
        message: { kind: 'info', text: `${patient.name}様を登録しました(続けて${continueCount}人目)` },
      });
      await reloadPatients();
      root!.querySelector<HTMLInputElement>('[data-testid="name-input"]')?.focus();
      return;
    }
    continueCount = 0;
    formDraft = null;
    setState(withScreen(state, { name: 'list' }));
    await reloadPatients({ kind: 'info', text: '保存しました。' });
  } catch {
    formDraft = input;
    setState(withMessage(state, { kind: 'error', text: 'データを保存できませんでした。' }));
  } finally {
    savingPatient = false;
  }
}

/**
 * 許可証の期限が「本当に」入力中の値として変わっているか。駐車の種類が street_permit で
 * ないときは期限の欄が隠れて意味を持たないので、値が残っていても変更扱いにしない。
 */
function isPermitExpiresDirty(input: FormInput, baseline: string, trimInput: boolean): boolean {
  if (input.parkingType !== 'street_permit') {
    return false;
  }
  const current = trimInput ? input.permitExpires.trim() : input.permitExpires;
  return current !== baseline;
}

/** フォームの「キャンセル」。入力途中なら確認してから戻る。 */
function handleFormCancel(input: FormInput): void {
  const original = currentEditingPatient();
  const dirty =
    original === null
      ? input.name.trim() !== '' ||
        input.address.trim() !== '' ||
        input.phone.trim() !== '' ||
        input.parkingType !== '' ||
        isPermitExpiresDirty(input, '', true) ||
        input.note.trim() !== ''
      : input.name !== original.name ||
        input.address !== original.address ||
        input.phone !== (original.phone ?? '') ||
        input.parkingType !== (original.parking?.type ?? '') ||
        isPermitExpiresDirty(input, original.parking?.permitExpires ?? '', false) ||
        input.note !== (original.note ?? '');
  if (dirty && !window.confirm('入力中の内容を捨てますか?')) {
    return;
  }
  continueCount = 0;
  formDraft = null;
  setState(withScreen(state, { name: 'list' }));
}

async function handleDelete(id: string): Promise<void> {
  if (deletingPatientIds.has(id)) {
    // 削除中の二重タップ。何もしない。
    return;
  }
  if (!state.patients.some((patient) => patient.id === id)) {
    closeAnyDialog();
    return;
  }
  deletingPatientIds.add(id);
  // 確認は、ここへ来る前に、確認のダイアログで「削除」を押した時点で済んでいる。
  dialogReturnId = null;
  setState(closeDialog(state));
  try {
    await deletePatient(id);
    try {
      await deletePhotosOf([id]);
    } catch {
      // 写真を消せなくても、訪問先自体の削除は済んでいるので、これ全体を失敗として扱わない
      // (孤立した写真は残るが、消えたはずのデータとして扱われるよりまし)。
    }
    await loadPhotoCounts();
    await loadPhotoBytes();
    await reloadPatients({ kind: 'info', text: '削除しました。' });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを削除できませんでした。' }));
  } finally {
    deletingPatientIds.delete(id);
  }
}

function handleSortChange(order: SortOrder): void {
  setState(setSortOrder(state, order));
}

/** 一覧の「全選択」/「全解除」。今どちらの表示かは選択の内容から決まるので、ここでも同じ判定をする。 */
function handleToggleSelectAll(): void {
  const visible = visiblePatients(state);
  const allSelected = visible.length > 0 && visible.every((patient) => state.selectedIds.includes(patient.id));
  setState(allSelected ? clearSelection(state) : selectAllVisible(state));
}

/** 選択バーの「削除」。まだ削除しない(確認のダイアログへ進む)。 */
function handleRequestDeleteSelected(): void {
  setState(openDeleteSelectedConfirm(state));
}

async function handleConfirmDeleteSelected(): Promise<void> {
  if (deletingSelected) {
    // 削除中の二重タップ。何もしない。
    return;
  }
  const ids = state.selectedIds;
  if (ids.length === 0) {
    closeAnyDialog();
    return;
  }
  deletingSelected = true;
  setState(closeDialog(state));
  try {
    await deletePatients(ids);
    try {
      await deletePhotosOf(ids);
    } catch {
      // 写真を消せなくても、訪問先自体の削除は済んでいるので、これ全体を失敗として扱わない。
    }
    await loadPhotoCounts();
    await loadPhotoBytes();
    await reloadPatients({ kind: 'info', text: `${ids.length}件を削除しました。` });
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'データを削除できませんでした。' }));
  } finally {
    deletingSelected = false;
  }
}

/** 「⋯」メニューを開く。閉じたとき、この行の「⋯」へフォーカスを戻すため、idを覚えておく。 */
function openMenu(id: string): void {
  dialogReturnId = id;
  setState(openRowMenu(state, id));
}

function closeAnyDialog(): void {
  setState(closeDialog(state));
}

/** 「⋯」または地図のカードの「位置」ボタンから、位置の登録ダイアログを開く。 */
function openLocation(id: string): void {
  dialogReturnId = id;
  setState({
    ...state,
    dialog: {
      kind: 'location',
      id,
      phase: 'idle',
      best: null,
      error: null,
      pasteText: '',
      pasteError: null,
      pasteOpen: false,
      previous: null,
    },
  });
}

/**
 * 今いる場所の測定を始める(「今いる場所で登録」「もう一度測る」)。位置・地点どちらの
 * ダイアログでも使う(対象のダイアログのkindを見て書き換える)。既存の測定は先に止める。
 */
async function startMeasure(): Promise<void> {
  stopCurrentMeasuring();
  const dialog = state.dialog;
  if (dialog?.kind !== 'location' && dialog?.kind !== 'spot') {
    return;
  }
  const target: { kind: 'location'; id: string } | { kind: 'spot' } =
    dialog.kind === 'location' ? { kind: 'location', id: dialog.id } : { kind: 'spot' };
  const { startMeasuring } = await import('./geo');
  // importの読み込み中にダイアログが閉じた/別の訪問先へ変わったかもしれないので、確かめてから始める。
  const current = state.dialog;
  if (!isSameMeasuringDialog(current, target)) {
    return;
  }
  setState({ ...state, dialog: { ...current, phase: 'measuring', best: null, error: null } });
  // importの待ち時間に二重にボタンが押されていたら、ここでもう一度止めてから始める
  // (二重に測定が走って、片方が止められなくなる漏れを防ぐ)。
  stopCurrentMeasuring();
  stopMeasuring = startMeasuring(navigator.geolocation, (update) => {
    const d = state.dialog;
    // saved になった後の更新は無視する(保存後に測定が止め切れていない場合の保険。
    // 実際に止めるのはsaveLocation/saveSpotの先頭)。
    if (!isSameMeasuringDialog(d, target) || d.phase === 'saved') {
      return;
    }
    if (update.kind === 'reading') {
      setState({ ...state, dialog: { ...d, phase: 'measuring', best: update.best, error: null } });
    } else if (update.kind === 'done') {
      if (update.best === null) {
        setState({
          ...state,
          dialog: {
            ...d,
            phase: 'error',
            best: null,
            error: '位置を取得できませんでした。車の外や屋外で、もう一度試してください。',
          },
        });
      } else {
        setState({ ...state, dialog: { ...d, phase: 'measured', best: update.best, error: null } });
      }
    } else {
      setState({ ...state, dialog: { ...d, phase: 'error', best: null, error: update.message } });
    }
  });
}

/** 測った/貼り付けた位置を保存する共通処理。保存後、ダイアログを saved にする。 */
async function saveLocation(location: GeoLocation): Promise<void> {
  const dialog = state.dialog;
  if (dialog?.kind !== 'location') {
    return;
  }
  // 測定中に保存したら、そこで測定を止める(止めないと、この後の更新がsaved状態を上書きしてしまう)。
  stopCurrentMeasuring();
  const patient = state.patients.find((item) => item.id === dialog.id);
  if (!patient) {
    closeAnyDialog();
    return;
  }
  const previous = patient.location ?? null;
  try {
    await savePatient(withLocation(patient, location));
    requestProtectionOnce();
    openedRoutes.clear();
    await reloadPatients();
    const current = state.dialog;
    if (current?.kind === 'location' && current.id === dialog.id) {
      setState({ ...state, dialog: { ...current, phase: 'saved', previous } });
    }
  } catch {
    setState(withMessage(state, { kind: 'error', text: '位置を保存できませんでした。' }));
  }
}

/** 測った位置(dialog.best)で登録する。 */
function saveMeasuredLocation(): void {
  const dialog = state.dialog;
  if (dialog?.kind !== 'location' || dialog.best === null) {
    return;
  }
  void saveLocation({ ...dialog.best, recordedAt: new Date().toISOString(), source: 'gps' });
}

/** 貼り付け欄の入力を読み取り、登録する。読めなければ pasteError を出す。 */
function savePastedLocation(): void {
  const dialog = state.dialog;
  if (dialog?.kind !== 'location') {
    return;
  }
  const point = parseLocationText(dialog.pasteText);
  if (point === null) {
    const message = isShortMapsUrl(dialog.pasteText)
      ? '短いURLは読めません。Googleマップで地点を長押しして、出てきた座標をコピーして貼り付けてください。'
      : '座標またはGoogleマップのURLを読み取れませんでした。';
    setState({ ...state, dialog: { ...dialog, pasteError: message } });
    return;
  }
  void saveLocation({ lat: point.lat, lng: point.lng, accuracy: null, recordedAt: new Date().toISOString(), source: 'paste' });
}

/** 貼り付け欄への入力のたび呼ばれる。値を保ち、直前のエラー表示は消す。 */
function changePasteText(text: string): void {
  const dialog = state.dialog;
  if (dialog?.kind !== 'location') {
    return;
  }
  setState({ ...state, dialog: { ...dialog, pasteText: text, pasteError: null } });
}

/**
 * 貼り付け欄(details)の開閉(toggleイベント)。開閉した状態を再描画のたびに保つ。
 *
 * 本物のブラウザでは、toggleイベントは手で開閉したときだけでなく、openプロパティを
 * スクリプトから変えたとき(views/locationDialog.tsのrenderPasteSectionがdetails.openを
 * 描画のたびに立て直す処理)にも飛ぶ。ここで無条件にsetStateすると、
 * 再描画→details.openを立て直す→toggleが飛ぶ→setState→再描画…と無限に回ってしまう。
 * すでに描画されている開閉(pasteOpen/pasteText/pasteErrorから決まる実際の見た目)と
 * 変わらないtoggleは無視する。
 * (テキストが入っている状態で閉じようとすると、pasteOpenはfalseになるが、
 * テキストがある間は開いたままになる。これは仕様として許容する。)
 */
function togglePasteSection(open: boolean): void {
  const dialog = state.dialog;
  if (dialog?.kind !== 'location') {
    return;
  }
  const effectiveOpen = dialog.pasteOpen || dialog.pasteText !== '' || dialog.pasteError !== null;
  if (open === effectiveOpen) {
    return;
  }
  setState({ ...state, dialog: { ...dialog, pasteOpen: open } });
}

/** saved のときの「元に戻す」。保存前の位置(previous、無ければ外す)に戻して閉じる。 */
async function undoLocation(): Promise<void> {
  const dialog = state.dialog;
  if (dialog?.kind !== 'location') {
    return;
  }
  const patient = state.patients.find((item) => item.id === dialog.id);
  if (!patient) {
    closeAnyDialog();
    return;
  }
  try {
    await savePatient(withLocation(patient, dialog.previous));
    openedRoutes.clear();
    setState(closeDialog(state));
    await reloadPatients();
  } catch {
    setState(withMessage(state, { kind: 'error', text: '元に戻せませんでした。' }));
  }
}

/** 登録済みの位置を消す(「位置を消す」)。確認してから外す。 */
async function removeLocation(): Promise<void> {
  const dialog = state.dialog;
  if (dialog?.kind !== 'location') {
    return;
  }
  if (!window.confirm('この訪問先の位置を消しますか?')) {
    return;
  }
  const patient = state.patients.find((item) => item.id === dialog.id);
  if (!patient) {
    closeAnyDialog();
    return;
  }
  try {
    await savePatient(withLocation(patient, null));
    openedRoutes.clear();
    setState(closeDialog(state));
    await reloadPatients();
  } catch {
    setState(withMessage(state, { kind: 'error', text: '位置を消せませんでした。' }));
  }
}

/** 地図の画面の「今いる場所をお役立ち地点に登録」。お役立ち地点の登録ダイアログを開く。 */
function openSpotDialog(): void {
  dialogReturnId = SPOT_RETURN_ID;
  setState({
    ...state,
    dialog: { kind: 'spot', phase: 'idle', best: null, error: null, spotKind: SPOT_KINDS[0]!.value, note: '' },
  });
}

/** お役立ち地点の登録: 種類・メモの入力のたび呼ばれる。値を再描画のあいだ保つ。 */
function changeSpotDraft(draft: { spotKind: SpotKind; note: string }): void {
  const dialog = state.dialog;
  if (dialog?.kind !== 'spot') {
    return;
  }
  setState({ ...state, dialog: { ...dialog, spotKind: draft.spotKind, note: draft.note } });
}

/** 測った位置と、そのときのspotKind・noteでお役立ち地点として登録する。 */
async function saveSpot(): Promise<void> {
  const dialog = state.dialog;
  if (dialog?.kind !== 'spot' || dialog.best === null) {
    return;
  }
  if (savingSpot) {
    // 保存中の二重タップ。何もしない(2件目のUUIDが発行されるのを防ぐ)。
    return;
  }
  savingSpot = true;
  // 測定中に保存したら、そこで測定を止める(止めないと、この後の更新がsaved状態を上書きしてしまう)。
  stopCurrentMeasuring();
  const spot: Spot = {
    id: crypto.randomUUID(),
    kind: dialog.spotKind,
    note: dialog.note.trim(),
    location: { ...dialog.best, recordedAt: new Date().toISOString(), source: 'gps' },
    createdAt: new Date().toISOString(),
  };
  try {
    await putSpot(spot);
    requestProtectionOnce();
    await loadSpots();
    const current = state.dialog;
    if (current?.kind === 'spot') {
      setState({ ...state, dialog: { ...current, phase: 'saved' } });
    }
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'お役立ち地点を保存できませんでした。' }));
  } finally {
    savingSpot = false;
  }
}

/** 設定画面のお役立ち地点の「削除」。確認してから消す。 */
async function handleDeleteSpot(id: string): Promise<void> {
  if (!window.confirm('この地点を消しますか?')) {
    return;
  }
  try {
    await deleteSpot(id);
    await loadSpots();
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'お役立ち地点を消せませんでした。' }));
  }
}

function handleEdit(id: string): void {
  dialogReturnId = null;
  formDraft = null;
  setState(withScreen(state, { name: 'form', patientId: id }));
  void loadFormPhotos(id);
}

/** 編集フォームの写真を読み直す(listPhotos → object URL)。もう別の画面/別の訪問先に移っていたら、
 * 作ったURLは使わずに片付ける(handleEditを連打した場合などの取り違え防止)。 */
async function loadFormPhotos(patientId: string): Promise<void> {
  let next: { id: string; url: string }[] = [];
  try {
    next = (await listPhotos(patientId)).map((photo) => ({ id: photo.id, url: URL.createObjectURL(photo.blob) }));
  } catch {
    next = [];
  }
  const screen = state.screen;
  if (screen.name !== 'form' || screen.patientId !== patientId) {
    for (const photo of next) {
      URL.revokeObjectURL(photo.url);
    }
    return;
  }
  replaceFormPhotos(next);
  render();
}

// addPhotoFromFileで、そのまま利用者に見せてよいとわかっているメッセージだけを通す。
// それ以外(DOMExceptionやimport(チャンク読み込み)の失敗など、英語や技術的な内容を
// 含みうるもの)は、汎用のメッセージに丸める。
const KNOWN_PHOTO_ERROR_MESSAGES = new Set(['写真を読み込めませんでした。', '写真は1件につき3枚までです。']);

/** フォームの「写真を追加」。縮小してからDBへ追加し、フォームの写真と地図の件数バッジを読み直す。 */
async function addPhotoFromFile(file: File): Promise<void> {
  const screen = state.screen;
  if (screen.name !== 'form' || screen.patientId === null) {
    return;
  }
  const patientId = screen.patientId;
  try {
    const { resizeImage } = await import('./imageResize');
    const blob = await resizeImage(file);
    // 縮小している間に、この訪問先自体が削除されているかもしれない。
    if (!state.patients.some((patient) => patient.id === patientId)) {
      return;
    }
    await addPhoto({ id: crypto.randomUUID(), patientId, blob, createdAt: new Date().toISOString() });
    await loadFormPhotos(patientId);
    await loadPhotoCounts();
    await loadPhotoBytes();
  } catch (error) {
    const message =
      error instanceof Error && KNOWN_PHOTO_ERROR_MESSAGES.has(error.message)
        ? error.message
        : '写真を追加できませんでした。';
    setState(withMessage(state, { kind: 'error', text: message }));
  }
}

/** フォームの写真の「削除」。 */
async function deleteFormPhoto(id: string): Promise<void> {
  const screen = state.screen;
  if (screen.name !== 'form' || screen.patientId === null) {
    return;
  }
  const patientId = screen.patientId;
  try {
    await deletePhoto(id);
    await loadFormPhotos(patientId);
    await loadPhotoCounts();
    await loadPhotoBytes();
  } catch {
    setState(withMessage(state, { kind: 'error', text: '写真を削除できませんでした。' }));
  }
}

/** 地図のカードの「写真 N」。listPhotosから写真のダイアログを開く。閉じるときのrevokeはsetState一箇所にまとめる。 */
async function openPhotos(patientId: string): Promise<void> {
  dialogReturnId = patientId;
  try {
    const photos = await listPhotos(patientId);
    const urls = photos.map((photo) => URL.createObjectURL(photo.blob));
    // 読み込んでいる間に、地図の画面を離れた/別のダイアログが開いたかもしれない。
    // そのときは、せっかく作ったobject URLをここで片付けて、何も表示しない。
    if (state.screen.name !== 'map' || state.dialog !== null) {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
      dialogReturnId = null;
      return;
    }
    if (urls.length === 0) {
      dialogReturnId = null;
      return;
    }
    setState({ ...state, dialog: { kind: 'photos', patientId, urls, index: 0 } });
  } catch {
    dialogReturnId = null;
    setState(withMessage(state, { kind: 'error', text: '写真を読み込めませんでした。' }));
  }
}

/** 写真のダイアログの「前」「次」。 */
function setPhotoIndex(index: number): void {
  const dialog = state.dialog;
  if (dialog?.kind !== 'photos') {
    return;
  }
  if (index < 0 || index >= dialog.urls.length) {
    return;
  }
  setState({ ...state, dialog: { ...dialog, index } });
}

/** 名前と住所を写した状態の、新規登録フォームを開く(保存すると別の訪問先になる)。 */
function handleDuplicate(id: string): void {
  const source = state.patients.find((patient) => patient.id === id);
  if (!source) {
    closeAnyDialog();
    return;
  }
  dialogReturnId = null;
  formDraft = {
    name: source.name,
    address: source.address,
    phone: source.phone ?? '',
    parkingType: source.parking?.type ?? '',
    permitExpires: source.parking?.permitExpires ?? '',
    note: source.note ?? '',
  };
  setState(withScreen(state, { name: 'form', patientId: null }));
}

/** 選択バーの「訪問順を決める →」。 */
function handleNext(): void {
  const validation = validateSelection(state.selectedIds.length);
  if (!validation.ok) {
    setState(withMessage(state, { kind: 'error', text: validation.message }));
    return;
  }
  setState(withScreen(state, { name: 'order' }));
}

/** 下部のタブに出す3つのステップのうち、今の画面がどれか。設定・登録の画面は null(タブを出さない)。 */
function currentStep(): Step | null {
  switch (state.screen.name) {
    case 'list':
    case 'order':
    case 'map':
      return state.screen.name;
    default:
      return null;
  }
}

function handleSelectStep(step: Step): void {
  if (step === currentStep()) {
    return;
  }
  // 訪問先を選ぶまでは、訪問順と地図へは進めない。
  if (step !== 'list' && !hasSelection(state)) {
    return;
  }
  setState(withScreen(state, { name: step }));
}

function handleOpenRoute(routeIndex: number): void {
  const plans = buildRoutePlans(selectedPatients(state), routeContext.ends, routeContext.office, MAX_STOPS_PER_ROUTE);
  const plan = plans[routeIndex];
  if (!plan) {
    return;
  }
  try {
    const url = DEFAULT_MAP_PROVIDER.buildUrl(plan.addresses, { fromCurrentLocation: plan.fromCurrentLocation });
    openedRoutes.set(routeIndex, new Date().toISOString());
    render();
    openUrl(url);
  } catch (error) {
    const message = error instanceof Error ? error.message : '地図を開けませんでした。';
    setState(withMessage(state, { kind: 'error', text: message }));
  }
}

/** 訪問順の画面の出発・帰着の選択を変える。 */
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

/**
 * 地図の画面の「ルートを共有」。住所が送信先へ渡るので、先に確認を取る。
 * スマホでは共有メニュー(LINEなど)、それが無いPCなどではクリップボードへコピーする。
 */
async function handleShareRoutes(): Promise<void> {
  const text = confirmedShareText();
  if (text === null) {
    return;
  }
  try {
    const result = await shareText(text);
    if (result === 'copied') {
      showCopiedMessage();
    }
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'ルートを共有できませんでした。' }));
  }
}

/** 地図の画面の「リンクをコピー」。共有メニューを使わず、必ずコピーする(PC向け)。 */
async function handleCopyRouteLink(): Promise<void> {
  const text = confirmedShareText();
  if (text === null) {
    return;
  }
  try {
    await copyText(text);
    showCopiedMessage();
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'リンクをコピーできませんでした。' }));
  }
}

/** 住所または位置が送信先へ渡ることを確認し、許可されたら共有用のテキストを返す。取りやめなら null。 */
function confirmedShareText(): string | null {
  const points = selectedPatients(state).map(pointOf);
  if (points.length === 0) {
    return null;
  }
  const question =
    `訪問先の住所または位置(${points.length}件)が、送った相手と、送るのに使うアプリ(LINEなど)に渡ります。` +
    '名前は含まれません。共有しますか?';
  if (!window.confirm(question)) {
    return null;
  }
  return buildShareText(points, MAX_STOPS_PER_ROUTE, DEFAULT_MAP_PROVIDER);
}

function showCopiedMessage(): void {
  setState(
    withMessage(state, {
      kind: 'info',
      text: 'ルートのURLをコピーしました。LINEなどに貼り付けて送ってください。',
    }),
  );
}

async function handleExport(includePhotos = true): Promise<void> {
  try {
    const photos = includePhotos
      ? await Promise.all(
          (await listAllPhotos()).map(async (photo) => ({
            id: photo.id,
            patientId: photo.patientId,
            dataUrl: await blobToDataUrl(photo.blob),
            createdAt: photo.createdAt,
          })),
        )
      : null;
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `route-auto-input-${date}.json`,
      serializeBackup({
        patients: state.patients,
        photos,
        spots,
        meta: { office: routeContext.office ?? undefined, routeEnds: routeContext.ends },
      }),
    );
  } catch {
    setState(withMessage(state, { kind: 'error', text: 'バックアップを書き出せませんでした。' }));
    return;
  }
  // 最後にバックアップした日時の記録は付随的なもの。ここが失敗しても、
  // ファイルの書き出し自体は成功しているので、成功として扱う(lastBackupAtは更新しない)。
  try {
    const lastBackupAt = new Date().toISOString();
    await setMeta('lastBackupAt', lastBackupAt);
    settingsInfo = { ...settingsInfo, lastBackupAt };
  } catch {
    // 記録できなかっただけ。書き出し自体は成功しているので、下のメッセージは変えない。
  }
  setState(withMessage(state, { kind: 'info', text: 'バックアップを書き出しました。' }));
}

/** インポートの確認に出す「(写真M枚・お役立ち地点K件)」。0件の部分は書かず、両方0なら空文字。 */
function backupExtrasLabel(photoCount: number, spotCount: number): string {
  const parts: string[] = [];
  if (photoCount > 0) {
    parts.push(`写真${photoCount}枚`);
  }
  if (spotCount > 0) {
    parts.push(`お役立ち地点${spotCount}件`);
  }
  return parts.length > 0 ? `(${parts.join('・')})` : '';
}

async function handleImport(file: File, mode: 'replace' | 'merge'): Promise<void> {
  let writeStarted = false;
  try {
    const content = parseBackup(await readTextFile(file));

    // 書き込みを始める前に、写真を1枚ずつ全部デコードしておく(dataUrlToBlobは形が
    // 正しくてもbase64の中身が壊れていれば例外を投げる)。ここで1枚でも壊れていれば、
    // 訪問先の入れ替え・追加より前に中断して、何も変えない。
    let decodedPhotos: Photo[] | null;
    try {
      decodedPhotos =
        content.photos === null
          ? null
          : content.photos.map((photo) => ({
              id: photo.id,
              patientId: photo.patientId,
              blob: dataUrlToBlob(photo.dataUrl),
              createdAt: photo.createdAt,
            }));
    } catch {
      setState(withMessage(state, { kind: 'error', text: 'バックアップのファイルの写真が壊れています。' }));
      return;
    }

    // 確認の件数は、実際に取り込まれる訪問先に属する写真だけを数える
    // (入れ替えならファイルの訪問先だけ、追加ならファイル+今の訪問先)。
    const fileIds = new Set(content.patients.map((patient) => patient.id));
    const countedIds =
      mode === 'replace' ? fileIds : new Set([...fileIds, ...state.patients.map((patient) => patient.id)]);
    const photoCount = decodedPhotos?.filter((photo) => countedIds.has(photo.patientId)).length ?? 0;
    const extras = backupExtrasLabel(photoCount, content.spots.length);
    const question =
      mode === 'replace'
        ? `今のデータ${state.patients.length}件を消して、${content.patients.length}件${extras}を取り込みます。よろしいですか?`
        : `${content.patients.length}件${extras}を今のデータに追加します。よろしいですか?`;
    if (!window.confirm(question)) {
      return;
    }

    writeStarted = true;
    if (mode === 'replace') {
      await replaceAllPatients(content.patients);
    } else {
      await mergePatients(content.patients);
    }
    // 写真がnullのとき(書き出す側で外した、または旧version 1のバックアップ)は、
    // 既存の写真に一切触れない(消さない)。
    if (decodedPhotos !== null) {
      await putPhotos(decodedPhotos);
    }
    await putSpots(content.spots);
    if (content.meta.office !== undefined) {
      const office = content.meta.office;
      await setMeta('office', office);
      routeContext = { ...routeContext, office };
      settingsInfo = { ...settingsInfo, office };
    }
    if (content.meta.routeEnds !== undefined) {
      const routeEnds = content.meta.routeEnds;
      await setMeta('routeEnds', routeEnds);
      routeContext = { ...routeContext, ends: routeEnds };
    }
    openedRoutes.clear();
    const importedPatients = await listPatients();
    await deleteOrphanPhotos(new Set(importedPatients.map((patient) => patient.id)));
    await loadSpots();
    await loadPhotoCounts();
    await loadPhotoBytes();
    await reloadPatients({ kind: 'info', text: `${content.patients.length}件を取り込みました。` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'データを取り込めませんでした。';
    if (writeStarted) {
      // 訪問先の入れ替え・追加が始まったあとに失敗した場合、DBには一部だけ書き込まれている
      // ことがあるので、画面をその実際の状態に合わせ直す(訪問先・地点・写真の件数/サイズ)。
      await loadSpots();
      await loadPhotoCounts();
      await loadPhotoBytes();
      await reloadPatients({ kind: 'error', text: message });
    } else {
      setState(withMessage(state, { kind: 'error', text: message }));
    }
  }
}

function renderScreen(): HTMLElement {
  switch (state.screen.name) {
    case 'list':
      return renderPatientList(state, {
        onSearch: (query) => setState(setSearchQuery(state, query)),
        onClearSearch: () => {
          setState(setSearchQuery(state, ''));
          // クリアボタンは消えるので、検索欄へフォーカスを戻す。
          root!.querySelector<HTMLInputElement>('[data-testid="search-input"]')?.focus();
        },
        onToggleSelect: (id) => {
          const next = toggleSelection(state, id);
          // 選択が実際に変わったときだけ、開いたルートの印を消す(上限で選べなかったときは変えない)。
          if (next.selectedIds !== state.selectedIds) {
            openedRoutes.clear();
          }
          setState(next);
        },
        onSortChange: handleSortChange,
        onToggleSelectAll: handleToggleSelectAll,
        onNew: () => {
          continueCount = 0;
          formDraft = null;
          setState(withScreen(state, { name: 'form', patientId: null }));
        },
        onOpenMenu: openMenu,
        onOpenSettings: () => {
          setState(withScreen(state, { name: 'settings' }));
          void loadSettingsInfo();
        },
        onFilterChange: (filter) => setState(setListFilter(state, filter)),
        onSearchAll: () => setState(setListFilter(setSearchQuery(state, state.searchQuery), 'all')),
        onOpenHistory: () => setState(withScreen(state, { name: 'history', openDate: null, weekday: null })),
        onPickLastWeek: () => {
          const s = lastWeekShortcut();
          if (s) pickHistory(s.date);
        },
      }, currentNotice(), lastWeekShortcut());
    case 'form':
      return renderPatientForm(
        currentEditingPatient(),
        formDraft,
        state.message,
        {
          onSave: (values) => {
            void handleSaveRequest(values, false);
          },
          onSaveAndContinue: (values) => {
            void handleSaveRequest(values, true);
          },
          onCancel: (values) => {
            handleFormCancel(values);
          },
          onAddPhoto: (file) => {
            void addPhotoFromFile(file);
          },
          onDeletePhoto: (id) => {
            void deleteFormPhoto(id);
          },
        },
        formPhotos,
      );
    case 'order':
      return renderRouteOrder(state, routeContext, {
        onMove: (id, direction) => {
          const next = moveSelected(state, id, direction);
          // 順番が実際に変わったときだけ、開いたルートの印を消す(端の▲▼は何も変えない)。
          if (next.selectedIds !== state.selectedIds) {
            openedRoutes.clear();
          }
          setState(next);
        },
        onOpenStopMenu: (id) => {
          dialogReturnId = id;
          setState(openStopMenu(state, id));
        },
        onAddStops: () => setState(withScreen(state, { name: 'list' })),
        onOpenMap: () => {
          setState(withScreen(state, { name: 'map' }));
          void recordTodayRoute();
        },
        onBack: () => setState(withScreen(state, { name: 'list' })),
        onEndsChange: (ends) => {
          void handleEndsChange(ends);
        },
      });
    case 'map':
      return renderRouteMap(
        state,
        new Map(openedRoutes),
        DEFAULT_MAP_PROVIDER,
        routeContext,
        todayVisited(),
        photoCounts,
        spots,
        {
          onOpenRoute: handleOpenRoute,
          onBack: () => setState(withScreen(state, { name: 'order' })),
          onChooseStops: () => setState(withScreen(state, { name: 'list' })),
          onShare: () => {
            void handleShareRoutes();
          },
          onCopyLink: () => {
            void handleCopyRouteLink();
          },
          onToggleVisited: (id) => {
            void toggleVisited(id);
          },
          onOpenLocation: openLocation,
          onOpenPhotos: (id) => {
            void openPhotos(id);
          },
          onAddSpot: openSpotDialog,
        },
      );
    case 'settings':
      return renderSettings(state, { ...settingsInfo, spots }, {
        onExport: (includePhotos) => {
          void handleExport(includePhotos);
        },
        onImport: (file, mode) => {
          void handleImport(file, mode);
        },
        onThemeChange: (setting) => {
          saveThemeSetting(setting);
          applyTheme(setting);
          settingsInfo = { ...settingsInfo, theme: setting };
          render();
        },
        onBack: () => setState(withScreen(state, { name: 'list' })),
        onSaveOffice: (name, address) => {
          void handleSaveOffice(name, address);
        },
        onClearOffice: () => {
          void handleClearOffice();
        },
        onClearHistory: () => {
          void handleClearHistory();
        },
        onDeleteSpot: (id) => {
          void handleDeleteSpot(id);
        },
      });
    case 'history':
      return renderHistory(state, historyEntries, {
        onOpenEntry: (d) =>
          setState({
            ...state,
            screen: { name: 'history', openDate: d, weekday: state.screen.name === 'history' ? state.screen.weekday : null },
          }),
        onFilterWeekday: (w) => setState({ ...state, screen: { name: 'history', openDate: null, weekday: w } }),
        onPick: pickHistory,
        onCopyVisits: (d) => {
          void copyVisits(d);
        },
        onBack: () => setState(withScreen(state, { name: 'list' })),
      });
  }
}

/** 画面本体に、下部の固定バー(選択バーとタブ)とダイアログを重ねて、アプリ全体を作る。 */
function renderApp(): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.append(renderScreen());

  const step = currentStep();
  if (step !== null) {
    const selectionBar =
      step === 'list'
        ? renderSelectionBar(state.selectedIds.length, {
            onNext: handleNext,
            onDeleteSelected: handleRequestDeleteSelected,
            onShowSelected: () => setState(setListFilter(state, 'selected')),
          })
        : null;
    // 固定バーに、内容の最後が隠れないよう、余白を取るクラスを付ける。
    shell.classList.add(selectionBar ? 'with-selection' : 'with-tabbar');

    const stack = document.createElement('div');
    stack.className = 'bottom-stack';
    if (selectionBar) {
      stack.append(selectionBar);
    }
    stack.append(renderTabBar(step, hasSelection(state), { onSelect: handleSelectStep }));
    shell.append(stack);
  }

  const dialog = renderDialog(state, {
    onEdit: handleEdit,
    onDuplicate: handleDuplicate,
    onRequestDelete: (id) => setState(openDeleteConfirm(state, id)),
    onConfirmDelete: (id) => {
      void handleDelete(id);
    },
    onConfirmDeleteSelected: () => {
      void handleConfirmDeleteSelected();
    },
    onMoveToTop: (id) => {
      openedRoutes.clear();
      setState(moveSelectedToEdge(state, id, 'top'));
    },
    onMoveToBottom: (id) => {
      openedRoutes.clear();
      setState(moveSelectedToEdge(state, id, 'bottom'));
    },
    onSaveAnyway: () => {
      const d = state.dialog;
      if (d?.kind === 'similar') {
        setState(closeDialog(state));
        void commitSave(d.input, d.continueAfter);
      }
    },
    onOpenExisting: (id) => {
      continueCount = 0;
      formDraft = null;
      setState(withScreen(state, { name: 'form', patientId: id }));
      void loadFormPhotos(id);
    },
    onOpenLocation: openLocation,
    onStartMeasuring: () => {
      void startMeasure();
    },
    onSaveMeasured: saveMeasuredLocation,
    onPasteChange: changePasteText,
    onPasteToggle: togglePasteSection,
    onSavePasted: savePastedLocation,
    onRemove: () => {
      void removeLocation();
    },
    onUndo: () => {
      void undoLocation();
    },
    onSpotDraft: changeSpotDraft,
    onSaveSpot: () => {
      void saveSpot();
    },
    onPhotoIndex: setPhotoIndex,
    onClose: closeAnyDialog,
  });
  if (dialog) {
    shell.append(dialog);
  }
  return shell;
}

/**
 * 画面全体を作り直すため、そのままでは検索欄に1文字打つたびにフォーカスが外れる。
 * 描画の前後でフォーカス位置を引き継ぐ。ダイアログは、開いたら最初のボタンへ、
 * 閉じたら開いた元の「⋯」へ、フォーカスを移す。ただし、同じダイアログが開いたまま
 * 再描画した場合(貼り付け欄への入力など)は、直前にフォーカスしていた要素(同じtestid)が
 * まだあれば、そこへフォーカスと入力位置を戻す(無ければ、新しく開いたときと同じ最初のボタンへ)。
 */
function render(): void {
  const active = document.activeElement;
  const testid = active instanceof HTMLElement ? active.dataset.testid : undefined;
  const rowId = active instanceof HTMLElement ? active.dataset.id : undefined;
  const caret = active instanceof HTMLInputElement ? active.selectionStart : null;
  const hadDialog = root!.querySelector('[data-testid="dialog"]') !== null;

  root!.replaceChildren(renderApp());
  // ダイアログを開いている間は、背後をスクロールさせない。
  document.body.classList.toggle('dialog-open', state.dialog !== null);
  syncSession();

  const dialog = root!.querySelector<HTMLElement>('[data-testid="dialog"]');
  if (dialog) {
    if (hadDialog && testid !== undefined) {
      const selector =
        rowId === undefined ? `[data-testid="${testid}"]` : `[data-testid="${testid}"][data-id="${rowId}"]`;
      const restored = dialog.querySelector<HTMLElement>(selector);
      // 直前にフォーカスしていたのと同じtestidの要素が、再描画後は押せなく(disabled に)
      // なっていることがある(写真の前/次を端まで押した場合など)。その場合は
      // 「見つからなかった」ものとして扱い、下の既定のフォーカス(最初の押せるボタン)へ回す。
      const restoredIsDisabled = restored instanceof HTMLButtonElement && restored.disabled;
      if (restored && !restoredIsDisabled) {
        restored.focus();
        if (restored instanceof HTMLInputElement && restored.type === 'text' && caret !== null) {
          restored.setSelectionRange(caret, caret);
        }
        return;
      }
    }
    dialog.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    return;
  }
  if (hadDialog && dialogReturnId === SPOT_RETURN_ID) {
    // 地図の画面の「今いる場所をお役立ち地点に登録」から開いた(特定の行に紐づかない)。
    root!.querySelector<HTMLElement>('[data-testid="spot-add-button"]')?.focus();
    dialogReturnId = null;
    return;
  }
  if (hadDialog && dialogReturnId !== null) {
    root!
      .querySelector<HTMLElement>(
        `[data-testid="row-menu"][data-id="${dialogReturnId}"], [data-testid="stop-menu"][data-id="${dialogReturnId}"], [data-testid="location-pin"][data-id="${dialogReturnId}"], [data-testid="photo-count"][data-id="${dialogReturnId}"]`,
      )
      ?.focus();
    dialogReturnId = null;
    return;
  }

  if (testid === undefined) {
    return;
  }
  const selector =
    rowId === undefined
      ? `[data-testid="${testid}"]`
      : `[data-testid="${testid}"][data-id="${rowId}"]`;
  const restored = root!.querySelector<HTMLElement>(selector);
  if (!restored) {
    return;
  }
  restored.focus();
  if (restored instanceof HTMLInputElement && restored.type === 'text' && caret !== null) {
    restored.setSelectionRange(caret, caret);
  }
}

/**
 * 起動時の読み込みがすべて終わったかどうか。テストが(閉じたDB接続を誤って開き直したり
 * しないよう)後片付けの前に待てるよう、window に置く。
 */
type WindowWithStartup = typeof window & { __routeAutoInputStartup?: Promise<void> };

/** ロック画面を通過してから、いつもどおりアプリ本体を描画・読み込みする。 */
function startApp(): void {
  render();
  const startup = Promise.allSettled([
    reloadPatients(),
    loadSettingsInfo(),
    loadRouteContext(),
    deleteHistoryBefore(keepFromDate(new Date())).catch(() => undefined).then(() => loadHistory()),
    loadPhotoCounts(),
    loadSpots(),
  ]).then(() => undefined);
  (window as WindowWithStartup).__routeAutoInputStartup = startup;
  void startup;
}

/**
 * 合言葉の入力。正しければ解錠してアプリ本体へ、違えばエラーつきでロック画面を出し直す。
 * (本物のログインではない。src/passwordGate.ts を参照。)
 */
function handlePasswordSubmit(password: string): void {
  if (checkPassword(password)) {
    unlock();
    startApp();
    return;
  }
  root!.replaceChildren(renderPasswordGate({ onSubmit: handlePasswordSubmit }, true));
  root!.querySelector<HTMLInputElement>('[data-testid="password-input"]')?.focus();
}

if (isUnlocked()) {
  startApp();
} else {
  root!.replaceChildren(renderPasswordGate({ onSubmit: handlePasswordSubmit }, false));
}
