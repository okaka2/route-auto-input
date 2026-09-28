import './styles.css';
import type { AppContext } from './appContext';
import { MAX_STOPS_PER_ROUTE, MIN_PASSWORD_LENGTH } from './config';
// backupFlow.ts・transferFlow.ts はアプリを開いただけでは使わないので、初めて書き出す/読み込む/
// 送る/受け取るときに import() で読み込む(本体を軽くする。型だけはここで使う)。
import type { createBackupFlow } from './backupFlow';
import type { createTransferFlow } from './transferFlow';
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
  deleteSpot,
  getMeta,
  listAllPhotos,
  listHistory,
  listPatients,
  listPhotos,
  listSpots,
  putSpot,
  savePatient,
  setDbBlockingHandler,
  setMeta,
  updateHistory,
  type HistoryEntry,
} from './db';
import { isShortMapsUrl, parseLocationText, pointOf } from './geoPoint';
import { dateKey, formatHistoryDate, formatVisits, keepFromDate, lastWeekSameWeekday, restoreSelection } from './history';
import { shouldShowInstallHint, shouldShowMovedDataHint } from './installHint';
import { DEFAULT_MAP_PROVIDER } from './mapProviders';
import { openUrl } from './openRoute';
import { checkPassword, isUnlocked, renderPasswordGate, unlock } from './passwordGate';
import { findSimilar } from './normalize';
import { createPatient, updatePatientFields, withLocation, withVisitInfo } from './patient';
import { installPlatform, isStandaloneDisplay } from './platform';
import { isStoragePersisted, requestPersistentStorage } from './protection';
import { daysBetween, shouldRemindBackup } from './backupReminder';
import { arrivedDepth, navDepth } from './backNav';
import { buildRoutePlans, DEFAULT_ROUTE_ENDS, type RouteContext, type RouteEnds } from './routePlan';
import { clearSession, loadSession, saveSession } from './session';
import { buildShareText, copyText, shareText } from './share';
import { SPOT_KINDS } from './spots';
import { createReloadGate, registerServiceWorkerUpdates } from './swUpdate';
import { applyTheme, initTheme, loadThemeSetting, saveThemeSetting } from './theme';
import {
  clearVisibleSelection,
  closeDialog,
  createInitialState,
  hasSelection,
  moveSelected,
  moveSelectedToEdge,
  openDeleteConfirm,
  openDeleteSelectedConfirm,
  openRowMenu,
  openSelectionMenu,
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
  Screen,
  SortOrder,
  Spot,
  SpotDialog,
  SpotKind,
} from './types';
import { permitsExpiringSoon } from './visitInfo';
import { validatePatientInput, validateSelection } from './validation';
import { renderDialog } from './views/dialogs';
import { renderHistory } from './views/historyView';
import { readPatientFormValues, renderPatientForm } from './views/patientFormView';
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

/**
 * 今すぐ読み直しても安全か(Task 8)。入力中の画面(フォーム)・小窓を開いている最中
 * (送る/受け取るの小窓のworkingはdialog !== nullに含まれる)・保存や削除やお役立ち地点の
 * 登録やバックアップの取り込みが書き込んでいる最中は、安全ではない。
 */
function isSafeToReload(): boolean {
  return (
    state.screen.name !== 'form' &&
    state.dialog === null &&
    !savingPatient &&
    !deletingSelected &&
    deletingPatientIds.size === 0 &&
    !savingSpot &&
    !(backupFlowInstance?.isWorking() ?? false)
  );
}

// 新しい版が有効になった・DBが更新を待っている(blocking)ときに、安全なら(入力中・小窓・
// 書き込み中でなければ)すぐ、そうでなければ安全になるまで待ってから読み直す(Task 8)。
// 待っていることは画面には出さない。
const reloadGate = createReloadGate({ canReload: isSafeToReload, reload: () => window.location.reload() });

// ロックの状態に関係なく、新しいバージョンが出ていれば自動で反映する(ただし安全なときまで待つ)。
registerServiceWorkerUpdates(() => reloadGate.request());
// DBの更新がこのタブの古いトランザクションで止まっている(blocking)ときも、同じ待ち合わせで読み直す(Task 2の口)。
setDbBlockingHandler(() => reloadGate.request());

// Escキーでダイアログを閉じる。document に付けるのは、ダイアログの背景など
// フォーカスを持てない場所をクリックすると activeElement が document.body へ移り
// (#app の外)、root へ付けたリスナーにはEscキーが届かなくなるため(#app はイベントの
// targetの子孫ではなく祖先になり、バブリングでは到達しない)。
// テストで main.ts を読み込み直すたびに document へリスナーが積み重ならないよう、
// window に前回のハンドラーを覚えておき、新しく付ける前に外す。
type WindowWithEscapeHandler = typeof window & {
  __routeAutoInputEscapeHandler?: (event: KeyboardEvent) => void;
  __routeAutoInputPopStateHandler?: (event: PopStateEvent) => void;
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
// 端末の戻るボタン(Android の戻る・iOS の端からのスワイプ。handlePopState)。Escキーと同じ理由で、
// 前回のハンドラーを外しておく。付けるのは、ロックの画面を上書きしないよう startApp で。
if (globalWindow.__routeAutoInputPopStateHandler) {
  window.removeEventListener('popstate', globalWindow.__routeAutoInputPopStateHandler);
}

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

// 「全解除」「先週と同じ」「履歴から選ぶ」の直後だけ持つ、元に戻すための記録(Task 12)。
// openedRoutesと同様にAppStateの外で持つ。次に選択を変える・画面を移るとsetStateの中で消す。
type SelectionUndo = {
  text: '選択を外しました' | '選択を置き換えました';
  before: { selectedIds: string[]; opened: [number, string][]; routeEnds: RouteEnds };
  after: readonly string[];
  screen: Screen['name'];
};
let selectionUndo: SelectionUndo | null = null;

// 保存に失敗した直後の入力値。入力内容を画面に残すため(spec §8)、
// openedRoutesと同様にAppStateの外で保持する。
let formDraft: PatientFormDraft | null = null;
const EMPTY_FORM_DRAFT: PatientFormDraft = { name: '', address: '', phone: '', parkingType: '', permitExpires: '', note: '' };

// 端末の戻るボタンのための、今いる戻る記録(history の { nav: n })の深さ(Task 13。backNav.ts参照)。
// handlingPopは、popstateを処理している最中(同期の処理の中だけ)。その間はsetStateの中で
// 1段ごとに記録を積んだり戻したりせず、最後にまとめて1回だけ合わせる。
let backDepth = 0;
let handlingPop = false;
// 自分で出した戻る(history.go)の時刻。着く(popstate)までは次の戻るを出さない。着かないまま
// GO_WAIT_MS たったら(戻る先が無かったなど)、待つのをやめる(IME変換中の安全弁と同じ考え方)。
let goSentAt: number | null = null;
const GO_WAIT_MS = 1000;
// 前に描いた画面の名前。画面が変わったときだけ一番上から出す(render参照)。
let lastRenderedScreen: Screen['name'] | null = null;

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
// 特定の行に紐づかない入口(お役立ち地点の登録・選択バーの「⋯」/設定からの「送る」)から開いたときは、
// 下のRETURN_TARGETSにあるキーを入れておくと、閉じたときにそのtestidのボタンへフォーカスを戻す。
let dialogReturnId: string | null = null;
const SPOT_RETURN_ID = '__spot-add';
const SELECTION_MENU_RETURN_ID = '__selection-menu';
const SEND_SELECTED_RETURN_ID = '__send-selected';
const SEND_SPOTS_RETURN_ID = '__send-spots';
const RECEIVE_RETURN_ID = '__receive';
const BACKUP_RETURN_ID = '__backup';
const RETURN_TARGETS: Record<string, string> = {
  [SPOT_RETURN_ID]: 'spot-add-button',
  // 選択バーの「⋯」の小窓から開いた送るダイアログ・削除の確認も、閉じれば「⋯」へ戻る
  // (「送る」「削除」自体は、小窓が閉じたときには既に無いため)。
  [SELECTION_MENU_RETURN_ID]: 'selection-menu-button',
  [SEND_SELECTED_RETURN_ID]: 'selection-menu-button',
  [SEND_SPOTS_RETURN_ID]: 'send-spots-button',
  [RECEIVE_RETURN_ID]: 'import-button',
  [BACKUP_RETURN_ID]: 'export-button',
};

// 位置を測っている最中なら、止めるための関数。測っていなければ null。
// 止める場所はsetState一箇所にまとめる(下記参照)。
let stopMeasuring: (() => void) | null = null;

/** 測定中なら止めて、stopMeasuringをnullに戻す(二重に止めても安全)。 */
function stopCurrentMeasuring(): void {
  stopMeasuring?.();
  stopMeasuring = null;
}

// 位置の貼り付け欄・地点のメモ欄がIME変換中(compositionstart〜compositionend)かどうか。
// 変換中にGPSの読み取り更新などでsetStateが割り込んで画面を作り直すと、変換中の文字が
// 消えてしまうので、変換中はsetStateでの再描画をここで見送る(下記setState参照)。
// composingStartedAtは、compositionendの取りこぼし(タブが裏に回るなど)で万一戻らなかった
// ときの安全弁に使う時刻。renderDeferredは、見送った再描画があるかどうか
// (変換確定時に1回だけまとめて描く)。
let composing = false;
let composingStartedAt = 0;
let renderDeferred = false;
const MAX_COMPOSING_MS = 30_000;

/** 位置の貼り付け欄・地点のメモ欄のIME変換の開始/終了(onComposingChange)。 */
function handleComposingChange(next: boolean): void {
  if (next) {
    composing = true;
    composingStartedAt = Date.now();
    return;
  }
  // compositionendの直前に、確定した値がonPasteChange/onSpotDraft経由でもう
  // setState済み(呼び出し順はviews/locationDialog.ts参照)。ここではその後で、
  // 見送っていた再描画があればまとめて1回だけ行う。
  composing = false;
  if (renderDeferred) {
    renderDeferred = false;
    render();
  }
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
  includePhotos: true,
  hasSharedSecret: false,
  sharedSecretShort: false,
  sharedSecretDraft: '',
  sharedSecretEditing: false,
};

// 出発・帰着の選び方と事業所。起動時に loadRouteContext() で読み直す(Task 3 が使う)。
let routeContext: RouteContext = { ends: DEFAULT_ROUTE_ENDS, office: null };

// 履歴(日付ごとの記録)。起動時と記録後に listHistory() で読み直す。
let historyEntries: HistoryEntry[] = [];
// loadSettingsInfo() が一度でも終わったか。終わる前はlastBackupAtがnullのままなので、
// バックアップのお知らせ(「まだバックアップがありません」)を誤って出さないためのガード。
let settingsLoaded = false;
// reloadPatients() が一度でも終わったか(成功・失敗とも)。終わる前は訪問先が0件のままなので、
// Safariとホーム画面アプリでデータが分かれている案内(moved-data-notice)を誤って
// 一瞬出さないためのガード。
let patientsLoaded = false;

// バックアップのお知らせで「あとで」を押した日時を覚えておくキー。
const BACKUP_LATER_KEY = 'route-auto-input:backup-later';
// ホーム画面への追加の案内で「閉じる」を押した日時を覚えておくキー。
const INSTALL_DISMISS_KEY = 'route-auto-input:install-dismissed';
// Safari→ホーム画面アプリのデータ移行案内で「閉じる」を押した日時を覚えておくキー
// (7日で復活する他の案内と違い、一度閉じたら以後ずっと出さない)。
const MOVED_DATA_DISMISS_KEY = 'route-auto-input:moved-data-dismissed';
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
  // iPhone/iPadは、Safariとホーム画面に追加したアプリでデータが別々になる。追加後のアプリを
  // 開いて0件だったら、Safari側のバックアップを読み込む案内を他の案内より先に出す(Task 9)。
  if (
    shouldShowMovedDataHint({
      platform: installPlatform(),
      standalone: isStandaloneDisplay(),
      patientsLoaded,
      patientCount: state.patients.length,
      dismissed: readLocal(MOVED_DATA_DISMISS_KEY) !== null,
    })
  ) {
    return {
      testid: 'moved-data-notice',
      text: 'Safari で使っていた場合は、書き出したバックアップのファイルを読み込むと、今までの訪問先が入ります。',
      actions: [
        {
          label: '読み込む画面へ',
          testid: 'notice-moved-import',
          primary: true,
          onClick: () => {
            setState(withScreen(state, { name: 'settings' }));
            void loadSettingsInfo();
            root!.querySelector('[data-testid="backup-section"]')?.scrollIntoView({ block: 'start' });
          },
        },
        {
          label: '閉じる',
          testid: 'notice-moved-dismiss',
          onClick: () => {
            writeLocal(MOVED_DATA_DISMISS_KEY, new Date().toISOString());
            render();
          },
        },
      ],
    };
  }
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
        {
          label: '今すぐバックアップ',
          testid: 'notice-backup',
          primary: true,
          onClick: () => {
            dialogReturnId = BACKUP_RETURN_ID;
            void handleExportClick();
          },
        },
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

/** 「全解除」「先週と同じ」「履歴から選ぶ」の直前の状態を記録する(元に戻す用、Task 12)。 */
function captureSelectionBefore(): SelectionUndo['before'] {
  return {
    selectedIds: state.selectedIds,
    opened: [...openedRoutes] as [number, string][],
    routeEnds: routeContext.ends,
  };
}

/**
 * 「全解除」「先週と同じ」「履歴から選ぶ」の直後に出す、「元に戻す」つきの知らせ(Task 12)。
 * 一覧では、このお知らせを currentNotice() より先に出す(同時には出さない。同じ1箇所に出す)。
 */
function selectionUndoNotice(): Notice | null {
  if (!selectionUndo) {
    return null;
  }
  return {
    testid: 'undo-notice',
    text: selectionUndo.text,
    actions: [{ label: '元に戻す', testid: 'undo-button', primary: true, onClick: undoSelection }],
  };
}

/** 知らせの「元に戻す」。選択・順番・出発帰着・開いたルートの印を、操作の直前へ戻す。画面は移らない。 */
function undoSelection(): void {
  if (!selectionUndo) {
    return;
  }
  const { before } = selectionUndo;
  openedRoutes.clear();
  for (const [index, at] of before.opened) {
    openedRoutes.set(index, at);
  }
  routeContext = { ...routeContext, ends: before.routeEnds };
  void setMeta('routeEnds', before.routeEnds).catch(() => undefined);
  setState({ ...state, selectedIds: before.selectedIds, dimmedIds: [], message: null });
  selectionUndo = null;
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
    const [lastBackupAt, persisted, photoBytes, sharedSecret] = await Promise.all([
      getMeta('lastBackupAt'),
      isStoragePersisted(),
      sumPhotoBytes(),
      getMeta('sharedSecret'),
    ]);
    settingsInfo = {
      ...settingsInfo,
      lastBackupAt: lastBackupAt ?? null,
      persisted,
      photoBytes,
      hasSharedSecret: sharedSecret !== undefined,
      sharedSecretShort: sharedSecret !== undefined && sharedSecret.length < MIN_PASSWORD_LENGTH,
    };
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
    // 記録できなくても地図は開けるが、黙っていると「済」が保存されているように見えてしまうため知らせる。
    setState(withMessage(state, { kind: 'error', text: '訪問の記録を保存できませんでした。' }));
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
    setState(withMessage(state, { kind: 'error', text: '訪問の記録を保存できませんでした。' }));
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
  // 置き換える前の選択が1件以上あれば、元に戻せるよう先に記録しておく(Task 12)。
  const hadSelection = state.selectedIds.length > 0;
  const before = captureSelectionBefore();
  routeContext = { ...routeContext, ends: entry.routeEnds };
  void setMeta('routeEnds', entry.routeEnds).catch(() => undefined);
  openedRoutes.clear();
  const next = withScreen({ ...state, selectedIds: ids }, { name: 'order' });
  if (hadSelection) {
    selectionUndo = { text: '選択を置き換えました', before, after: next.selectedIds, screen: next.screen.name };
  }
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

/**
 * 設定の「事業所の合言葉」の「保存」。MIN_PASSWORD_LENGTH文字未満なら保存せずメッセージだけ出す。
 * 長さの数え方は、送るダイアログで「この合言葉を事業所の合言葉として保存する」ときと同じにする
 * (空白も1文字と数え、前後を削らない。保存する値そのものの長さで決める)。
 */
async function handleSaveSharedSecret(value: string): Promise<void> {
  if (value.length < MIN_PASSWORD_LENGTH) {
    setState(withMessage(state, { kind: 'error', text: `${MIN_PASSWORD_LENGTH}文字以上にしてください。` }));
    return;
  }
  try {
    await setMeta('sharedSecret', value);
    settingsInfo = {
      ...settingsInfo,
      hasSharedSecret: true,
      sharedSecretShort: false,
      sharedSecretDraft: '',
      sharedSecretEditing: false,
    };
    setState(withMessage(state, { kind: 'info', text: '事業所の合言葉を保存しました。' }));
  } catch {
    setState(withMessage(state, { kind: 'error', text: '事業所の合言葉を保存できませんでした。' }));
  }
}

/** 設定の「事業所の合言葉」の「消す」。確認してから消す。 */
async function handleClearSharedSecret(): Promise<void> {
  if (!window.confirm('事業所の合言葉を消しますか?')) return;
  try {
    await deleteMeta('sharedSecret');
    settingsInfo = {
      ...settingsInfo,
      hasSharedSecret: false,
      sharedSecretShort: false,
      sharedSecretDraft: '',
      sharedSecretEditing: false,
    };
    setState(withMessage(state, { kind: 'info', text: '事業所の合言葉を消しました。' }));
  } catch {
    setState(withMessage(state, { kind: 'error', text: '事業所の合言葉を消せませんでした。' }));
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
 *
 * options.render: false を渡すと、片付け(measuringの停止・formPhotos/写真ダイアログの
 * revoke)はいつもどおり行うが、最後のrender()だけ省く。地点メモの入力中(Important 3)のような
 * draftだけの変更で使う: 画面を作り直さないので、入力中のIME変換やフォーカス・キャレット位置が
 * (再描画によるDOM作り直しが起きないぶん)そのまま保たれる。
 */
function setState(next: AppState, options?: { render?: boolean }): void {
  const previousDialog = state.dialog;
  const previousScreen = state.screen;
  state = next;
  // 選択の「元に戻す」の記録(Task 12)は、次に選択を変える・画面を移るとここで消える。
  if (selectionUndo && (next.selectedIds !== selectionUndo.after || next.screen.name !== selectionUndo.screen)) {
    selectionUndo = null;
  }
  // 受け取りのダイアログが閉じる/別のダイアログに変わるなら、復号した中身(transferFlowの中に
  // だけ持っている)をここ一箇所で捨てる。途中で閉じて読み込み直しても、前の続きから始めない。
  if (previousDialog?.kind === 'transferReceive' && next.dialog?.kind !== 'transferReceive') {
    transferFlowInstance?.discardReceive();
  }
  // バックアップの保存の小窓が閉じる/別のダイアログに変わるなら、書き出したファイル
  // (backupFlowの中にだけ持っている)をここ一箇所で捨てる。
  if (previousDialog?.kind === 'backupSave' && next.dialog?.kind !== 'backupSave') {
    backupFlowInstance?.discardExport();
  }
  // 送るダイアログが閉じる/別のダイアログに変わるなら、readyでできたファイル(transferFlowの中に
  // だけ持っている)をここ一箇所で捨てる。
  if (previousDialog?.kind === 'transferSend' && next.dialog?.kind !== 'transferSend') {
    transferFlowInstance?.discardSendFile();
  }
  // 設定画面を離れるときは、合言葉の入力中の内容(sharedSecretDraft)と「変える」で
  // 出した入力欄(sharedSecretEditing)を引きずらない。次に設定画面を開いたときに
  // 前回の入力が残っていたり、未設定なのに入力欄が引っ込んだままになるのを防ぐ。
  if (next.screen.name !== 'settings' && (settingsInfo.sharedSecretDraft !== '' || settingsInfo.sharedSecretEditing)) {
    settingsInfo = { ...settingsInfo, sharedSecretDraft: '', sharedSecretEditing: false };
  }
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
  // IME変換中(composing)の安全弁: compositionendを取りこぼす等で30秒たっても変換中の
  // ままなら、変換中とみなすのをやめる(そうしないと再描画がずっと止まったままになる)。
  if (composing && Date.now() - composingStartedAt > MAX_COMPOSING_MS) {
    composing = false;
    renderDeferred = false;
  }
  // 変換中に、ダイアログが閉じる/別のダイアログに変わる/画面が変わるなら、変換中フラグを
  // 引きずらない(compositionendの取りこぼしで、次に開いたダイアログの再描画まで
  // 止めてしまわないように)。
  if (composing) {
    const stillComposingDialog =
      previousDialog !== null &&
      (previousDialog.kind === 'location'
        ? isSameMeasuringDialog(next.dialog, { kind: 'location', id: previousDialog.id })
        : previousDialog.kind === 'spot' && isSameMeasuringDialog(next.dialog, { kind: 'spot' }));
    if (!stillComposingDialog || previousScreen.name !== next.screen.name) {
      composing = false;
      renderDeferred = false;
    }
  }
  // 戻る記録を今の画面・小窓に合わせる(Task 13)。読み直しの確かめより前に済ませておく。
  if (!handlingPop) {
    syncBackStack();
  }
  // 新しい版への読み直しを待たせているなら、ここで安全になったか確かめる
  // (render: falseの変更でも、書き込み中フラグなどが変わることがあるので毎回呼ぶ)(Task 8)。
  reloadGate.check();
  if (options?.render === false) {
    return;
  }
  // 変換中は、他の要因(GPSの読み取り更新など)によるsetStateで画面を作り直すと、
  // 変換中の文字が消えてしまう。stateそのものはいつもどおり更新しつつ、再描画だけ
  // onComposingChange(false)まで見送り、変換の確定時にまとめて1回だけ行う。
  if (composing) {
    renderDeferred = true;
    return;
  }
  render();
}

/**
 * 戻る記録の深さを、今の画面・小窓の深さに合わせる。深くなったら差の数だけ積み、浅くなったら
 * (アプリの中の「戻る」「キャンセル」「閉じる」・Esc・背景で閉じたとき)その分だけ戻る(二重に戻らない)。
 * 戻る(history.go)は、着く(popstate)までは次を出さない。着いたらhandlePopStateで合わせ直す
 * (続けて戻ったときに、途中で着いた深さから余計に戻ってアプリを出ないように)。
 */
function syncBackStack(): void {
  if (goSentAt !== null && Date.now() - goSentAt < GO_WAIT_MS) {
    return;
  }
  goSentAt = null;
  const target = navDepth(state.screen.name, state.dialog !== null);
  for (let depth = backDepth + 1; depth <= target; depth++) {
    history.pushState({ nav: depth }, '');
  }
  if (target < backDepth) {
    goSentAt = Date.now();
    history.go(target - backDepth);
  }
  backDepth = target;
}

/**
 * 端末の戻るボタン。着いた深さになるまで、アプリの中の「戻る」と同じことを1段ずつ行う:
 * 小窓を閉じる(送る/受け取るのworking中は閉じない)→登録・編集はキャンセルと同じ
 * (入力中なら確認し、いいえならとどまる)→訪問順・設定・履歴は一覧へ、地図は訪問順へ。
 * 最後にsyncBackStackで合わせる(進めなかったら記録を積み直し、ブラウザの「進む」で深く着いたら
 * すぐ戻す)。自分のhistory.goが着いたときは、合わせ直すだけ。
 */
function handlePopState(event: PopStateEvent): void {
  backDepth = arrivedDepth(event.state);
  if (goSentAt !== null && Date.now() - goSentAt < GO_WAIT_MS) {
    goSentAt = null;
    syncBackStack();
    return;
  }
  handlingPop = true;
  try {
    while (navDepth(state.screen.name, state.dialog !== null) > backDepth) {
      const before = state;
      if (state.dialog !== null) {
        closeAnyDialog();
      } else if (state.screen.name === 'form') {
        handleFormCancel(readPatientFormValues(root!) ?? formDraft ?? EMPTY_FORM_DRAFT);
      } else {
        setState(withScreen(state, { name: state.screen.name === 'map' ? 'order' : 'list' }));
      }
      if (state === before) {
        break;
      }
    }
  } finally {
    handlingPop = false;
  }
  syncBackStack();
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
    // 読み込みが(成功で)終わったことを、この後のsetState/renderが見えるように先に立てる
    // (moved-data-notice: 0件が読み込み前の一瞬なのか、読み込んだ結果0件なのかを区別する)。
    patientsLoaded = true;
    setState({
      ...next,
      ...(message === undefined ? {} : { message }),
    });
  } catch {
    patientsLoaded = true;
    setState(withMessage(state, { kind: 'error', text: 'データを読み込めませんでした。' }));
  }
}

/** バックアップの書き出し・読み込みの流れ(backupFlow.ts)が、main.tsの状態を読み書きするための口。 */
const ctx: AppContext = {
  getState: () => state,
  setState,
  showMessage: (message) => setState(withMessage(state, message)),
  getSpots: () => spots,
  getRouteContext: () => routeContext,
  setRouteContext: (next) => {
    routeContext = next;
  },
  getSettingsInfo: () => settingsInfo,
  setSettingsInfo: (next) => {
    settingsInfo = next;
  },
  clearOpenedRoutes: () => openedRoutes.clear(),
  reloadPatients,
  loadSpots,
  loadPhotoCounts,
  loadPhotoBytes,
  confirm: (question) => window.confirm(question),
};

type BackupFlow = ReturnType<typeof createBackupFlow>;
const BACKUP_FLOW_LOAD_FAILED_MESSAGE = 'バックアップの処理を読み込めませんでした。';

type TransferFlow = ReturnType<typeof createTransferFlow>;
const TRANSFER_FLOW_LOAD_FAILED_MESSAGE = '送受信の処理を読み込めませんでした。';

// backupFlow.ts は初めて書き出す/読み込むときに import() で読み込む(本体を軽くする)。
// 読み込めたものは backupFlowInstance に持ち、以後はそれを直接使う(Task 8の isWorking()も
// これを同期で読む)。読み込みに失敗したら null のままにして、次のクリックでやり直せるようにする。
let backupFlowInstance: BackupFlow | null = null;
let backupFlowLoad: Promise<BackupFlow> | null = null;

// transferFlow.ts も同じやり方で、初めて送る/受け取るときに import() で読み込む。読み込んだ
// あとは transferFlowInstance を直接使う(「LINEなどで送る」のように押した処理の中から
// navigator.shareを同期で呼ぶ必要がある箇所は、ready の小窓が出た時点でもう読み込み済みなので、
// そこだけ transferFlowInstance を直接(オプショナルチェーンで)読む)。
let transferFlowInstance: TransferFlow | null = null;
let transferFlowLoad: Promise<TransferFlow> | null = null;

function loadBackupFlow(): Promise<BackupFlow> {
  backupFlowLoad ??= import('./backupFlow')
    .then(({ createBackupFlow }) => {
      const flow = createBackupFlow(ctx, {
        // 読み込むで引き継ぎのファイル(パスワード付き)が選ばれたら、受け取りの流れに回す。
        onTransferFile: (text) => {
          dialogReturnId = RECEIVE_RETURN_ID;
          void ensureTransferFlow().then((flow) => flow?.openReceive(text));
        },
      });
      backupFlowInstance = flow;
      return flow;
    })
    .catch((error: unknown) => {
      // 読み込めなかった。次のクリックでやり直せるよう、読み込み中の記録を消す。
      backupFlowLoad = null;
      throw error;
    });
  return backupFlowLoad;
}

function loadTransferFlow(): Promise<TransferFlow> {
  transferFlowLoad ??= import('./transferFlow')
    .then(({ createTransferFlow }) => {
      const flow = createTransferFlow(ctx);
      transferFlowInstance = flow;
      return flow;
    })
    .catch((error: unknown) => {
      // 読み込めなかった。次のクリックでやり直せるよう、読み込み中の記録を消す。
      transferFlowLoad = null;
      throw error;
    });
  return transferFlowLoad;
}

async function ensureBackupFlow(): Promise<BackupFlow | null> {
  try {
    return await loadBackupFlow();
  } catch {
    ctx.showMessage({ kind: 'error', text: BACKUP_FLOW_LOAD_FAILED_MESSAGE });
    return null;
  }
}

async function ensureTransferFlow(): Promise<TransferFlow | null> {
  try {
    return await loadTransferFlow();
  } catch {
    ctx.showMessage({ kind: 'error', text: TRANSFER_FLOW_LOAD_FAILED_MESSAGE });
    return null;
  }
}

function handleExportClick(includePhotos?: boolean): Promise<void> {
  return ensureBackupFlow().then((flow) => flow?.handleExport(includePhotos));
}

function handleImportClick(file: File, mode: 'replace' | 'merge'): Promise<void> {
  return ensureBackupFlow().then((flow) => flow?.handleImport(file, mode));
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
      formDraft = EMPTY_FORM_DRAFT;
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

/**
 * 一覧の「全選択」/「全解除」。今どちらの表示かは選択の内容から決まるので、ここでも同じ判定をする。
 * 「全解除」は、見えている行だけを外す(clearVisibleSelection、Task 12)。外す前が0件なら
 * (実際には起きないが、念のため)元に戻す知らせは出さない。
 */
function handleToggleSelectAll(): void {
  const visible = visiblePatients(state);
  const allSelected = visible.length > 0 && visible.every((patient) => state.selectedIds.includes(patient.id));
  if (!allSelected) {
    setState(selectAllVisible(state));
    return;
  }
  const hadSelection = state.selectedIds.length > 0;
  const before = captureSelectionBefore();
  const next = clearVisibleSelection(state);
  if (hadSelection) {
    selectionUndo = { text: '選択を外しました', before, after: next.selectedIds, screen: next.screen.name };
  }
  setState(next);
}

/** 選択バーの「⋯」の小窓の「削除」。まだ削除しない(確認のダイアログへ進む)。 */
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

/**
 * Escキー・背景クリック・「やめる」共通の「閉じる」。送るダイアログが送信中(working)の間は、
 * 暗号化・共有/ダウンロードの途中で状態を消してしまわないよう、閉じない
 * (「やめる」ボタン自体もworking中は押せなくしてあるが、Escキーや背景クリックはボタンの
 * disabledに関係なく効いてしまうため、ここでも防ぐ)。
 */
function closeAnyDialog(): void {
  const dialog = state.dialog;
  if ((dialog?.kind === 'transferSend' || dialog?.kind === 'transferReceive') && dialog.phase === 'working') {
    return;
  }
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

/**
 * お役立ち地点の登録: 種類・メモの入力のたび呼ばれる。値をstateに保つが、draftだけの変更なので
 * 再描画はしない(Important 3)。GPSの読み取り更新(startMeasureのonUpdate)は引き続き
 * 通常どおりsetStateで再描画され、そのときにこのdraftの内容も一緒に反映される。
 */
function changeSpotDraft(draft: { spotKind: SpotKind; note: string }): void {
  const dialog = state.dialog;
  if (dialog?.kind !== 'spot') {
    return;
  }
  setState({ ...state, dialog: { ...dialog, spotKind: draft.spotKind, note: draft.note } }, { render: false });
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

/**
 * フォームの「写真を追加」。縮小してからDBへ追加し、フォームの写真と地図の件数バッジを読み直す。
 * 読み込み・保存のあいだに何度もrender()が挟まる(loadFormPhotos/loadPhotoCounts/loadPhotoBytes)ため、
 * 先にformDraftへ今の入力値(values)を入れておく。こうすると、そのあいだの再描画でも
 * フォームはformDraftから組み立てられ、入力中の名前・住所・メモなどが消えない(Critical 1)。
 */
async function addPhotoFromFile(file: File, values: PatientFormDraft): Promise<void> {
  const screen = state.screen;
  if (screen.name !== 'form' || screen.patientId === null) {
    return;
  }
  const patientId = screen.patientId;
  formDraft = values;
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

/** フォームの写真の「削除」。addPhotoFromFileと同じ理由でformDraftを先に入れる(Critical 1)。 */
async function deleteFormPhoto(id: string, values: PatientFormDraft): Promise<void> {
  const screen = state.screen;
  if (screen.name !== 'form' || screen.patientId === null) {
    return;
  }
  const patientId = screen.patientId;
  formDraft = values;
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
  return buildShareText(points, MAX_STOPS_PER_ROUTE - 1, DEFAULT_MAP_PROVIDER);
}

function showCopiedMessage(): void {
  setState(
    withMessage(state, {
      kind: 'info',
      text: 'ルートのURLをコピーしました。LINEなどに貼り付けて送ってください。',
    }),
  );
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
      }, selectionUndoNotice() ?? currentNotice(), lastWeekShortcut());
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
          onAddPhoto: (file, values) => {
            void addPhotoFromFile(file, values);
          },
          onDeletePhoto: (id, values) => {
            void deleteFormPhoto(id, values);
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
      }, selectionUndoNotice());
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
          dialogReturnId = BACKUP_RETURN_ID;
          void handleExportClick(includePhotos);
        },
        onIncludePhotosChange: (value) => {
          // draftだけの変更なので再描画はしない(Minor 7)。setState/renderを経由しなくても、
          // 次にrender()が(他の理由で)呼ばれたとき、この値を読んだ設定画面が作られる。
          settingsInfo = { ...settingsInfo, includePhotos: value };
        },
        onImport: (file, mode) => {
          // 取り込みの書き込み中はisSafeToReloadがfalseになる(backupFlowInstance.isWorking())。
          // 終わったら、待たせていた読み直しがあれば行う(Task 8)。
          void handleImportClick(file, mode).finally(() => reloadGate.check());
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
        onSendSpots: () => {
          dialogReturnId = SEND_SPOTS_RETURN_ID;
          void ensureTransferFlow().then((flow) => flow?.openSend([], { spotsOnly: true }));
        },
        onSharedSecretDraftChange: (value) => {
          // draftだけの変更なので再描画はしない(onIncludePhotosChangeと同じ)。
          settingsInfo = { ...settingsInfo, sharedSecretDraft: value };
        },
        onSharedSecretSave: (value) => {
          void handleSaveSharedSecret(value);
        },
        onSharedSecretChange: () => {
          settingsInfo = { ...settingsInfo, sharedSecretEditing: true, sharedSecretDraft: '' };
          render();
        },
        onSharedSecretClear: () => {
          void handleClearSharedSecret();
        },
        onSharedSecretCancel: () => {
          settingsInfo = { ...settingsInfo, sharedSecretEditing: false, sharedSecretDraft: '' };
          render();
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
            onShowSelected: () => setState(setListFilter(state, 'selected')),
            onOpenMenu: () => {
              dialogReturnId = SELECTION_MENU_RETURN_ID;
              setState(openSelectionMenu(state));
            },
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
    onSendSelected: () => {
      dialogReturnId = SEND_SELECTED_RETURN_ID;
      const ids = state.selectedIds;
      void ensureTransferFlow().then((flow) => flow?.openSend(ids));
    },
    onRequestDeleteSelected: handleRequestDeleteSelected,
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
    onOpenSend: (id) => {
      void ensureTransferFlow().then((flow) => flow?.openSend([id]));
    },
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
    onComposingChange: handleComposingChange,
    onSaveSpot: () => {
      void saveSpot();
    },
    onPhotoIndex: setPhotoIndex,
    // 以下は送る/受け取るの小窓がすでに出ているときだけ呼ばれる。その時点で transferFlow は
    // 読み込み済み(小窓自体が transferFlow の openSend/openReceive で出るため)なので、
    // ここでは transferFlowInstance を同期でオプショナルチェーンして使う(backupFlowInstance と同じやり方)。
    onSendDraft: (patch) => transferFlowInstance?.updateSendDraft(patch),
    onSubmit: () => {
      void transferFlowInstance?.submitSend();
    },
    onSendShare: () => {
      // 押した処理の中から直接呼ぶ(navigator.shareを同期で呼ぶ必要があるため、awaitを挟まない)。
      transferFlowInstance?.shareSendFile();
    },
    onSendSave: () => {
      transferFlowInstance?.saveSendFile();
    },
    onReceivePassword: (password) => transferFlowInstance?.updateReceivePassword(password),
    onReceiveSubmit: () => {
      void transferFlowInstance?.submitReceivePassword();
    },
    onReceiveConfirm: () => {
      void transferFlowInstance?.confirmReceive();
    },
    onReceiveConflict: (choice) => {
      void transferFlowInstance?.chooseConflict(choice);
    },
    onSaveExport: () => {
      // 押した処理の中から直接呼ぶ(navigator.shareを同期で呼ぶ必要があるため、awaitを挟まない)。
      // この小窓は backupFlow.handleExport が読み込んだ後にしか出ないので、読み込み済みのはず。
      backupFlowInstance?.saveExport();
    },
    onClose: closeAnyDialog,
  }, { photoCounts, spotCount: spots.length, hasSharedSecret: settingsInfo.hasSharedSecret });
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
  // 画面を移ったときだけ一番上から出す(同じ画面の描き直しでは動かさない)。
  if (lastRenderedScreen !== state.screen.name) {
    lastRenderedScreen = state.screen.name;
    window.scrollTo(0, 0);
  }
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
    // data-autofocus な要素(例: 位置を保存した直後の「地図で確かめる」リンク)があれば、
    // 先頭の押せるボタンより優先する(Minor 5。無いと、保存直後は先頭のボタンである
    // 「元に戻す」へフォーカスが移り、Enterキーでうっかり元に戻してしまう)。
    const autofocus = dialog.querySelector<HTMLElement>('[data-autofocus]');
    if (autofocus) {
      autofocus.focus();
      return;
    }
    dialog.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    return;
  }
  if (hadDialog && dialogReturnId !== null && dialogReturnId in RETURN_TARGETS) {
    // 特定の行に紐づかない入口(お役立ち地点の登録・選択バー/設定からの「送る」)から開いた。
    root!.querySelector<HTMLElement>(`[data-testid="${RETURN_TARGETS[dialogReturnId]}"]`)?.focus();
    dialogReturnId = null;
    return;
  }
  if (hadDialog && dialogReturnId !== null) {
    const returnTarget = root!.querySelector<HTMLElement>(
      `[data-testid="row-menu"][data-id="${dialogReturnId}"], [data-testid="stop-menu"][data-id="${dialogReturnId}"], [data-testid="location-pin"][data-id="${dialogReturnId}"], [data-testid="photo-count"][data-id="${dialogReturnId}"]`,
    );
    if (returnTarget) {
      returnTarget.focus();
    } else {
      // 位置を新しく登録した直後などは、開いた元の位置ピン自体が(位置が付いたので)
      // 無くなっていることがある。その場合は、ルートカードの「開く」ボタンへ逃がす(Minor 5)。
      root!.querySelector<HTMLElement>('[data-testid="open-route"]')?.focus();
    }
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

/** 名簿の読み直しのあと、名簿に無い訪問先を指す孤立した写真を片付ける。失敗しても無視する。 */
async function cleanUpOrphanPhotos(): Promise<void> {
  let removed = 0;
  try {
    removed = await deleteOrphanPhotos();
  } catch {
    // 起動時の片付けなので、失敗しても起動は続ける。
  }
  if (removed > 0) {
    await loadPhotoCounts();
    await loadPhotoBytes();
  }
}

/** ロック画面を通過してから、いつもどおりアプリ本体を描画・読み込みする。 */
function startApp(): void {
  // 戻る記録: 読み込み直しなら今いる記録の深さから続け、初めてなら一覧の記録にしてから
  // 今の画面の分を積む(地図から始まれば2つ)。
  backDepth = arrivedDepth(history.state);
  if (!history.state) {
    history.replaceState({ nav: 0 }, '');
  }
  syncBackStack();
  globalWindow.__routeAutoInputPopStateHandler = handlePopState;
  window.addEventListener('popstate', handlePopState);
  render();
  const startup = Promise.allSettled([
    reloadPatients().then(() => cleanUpOrphanPhotos()),
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
