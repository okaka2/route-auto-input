import './styles.css';
import { parseBackup, serializeBackup } from './backup';
import { MAX_STOPS_PER_ROUTE } from './config';
import {
  deleteMeta,
  deletePatient,
  deletePatients,
  getMeta,
  listPatients,
  mergePatients,
  replaceAllPatients,
  savePatient,
  setMeta,
} from './db';
import { downloadTextFile, readTextFile } from './fileIo';
import { shouldShowInstallHint } from './installHint';
import { DEFAULT_MAP_PROVIDER } from './mapProviders';
import { openUrl } from './openRoute';
import { checkPassword, isUnlocked, renderPasswordGate, unlock } from './passwordGate';
import { findSimilar } from './normalize';
import { createPatient, updatePatientFields } from './patient';
import { isStandaloneDisplay } from './platform';
import { isStoragePersisted, requestPersistentStorage } from './protection';
import { daysBetween, shouldRemindBackup } from './backupReminder';
import { buildRoutePlans, DEFAULT_ROUTE_ENDS, type RouteContext, type RouteEnds } from './routePlan';
import { clearSession, loadSession, saveSession } from './session';
import { buildShareText, copyText, shareText } from './share';
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
import type { AppState, Message, Patient, SortOrder } from './types';
import { validatePatientInput, validateSelection } from './validation';
import { renderDialog } from './views/dialogs';
import { renderPatientForm, type PatientFormDraft } from './views/patientFormView';
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

// 保存/削除の二重実行防止(ボタンを連打してもDBへ二重に書き込まない)。
let savingPatient = false;
// 「保存して続けて登録」で続けて登録した人数。
let continueCount = 0;
const deletingPatientIds = new Set<string>();
let deletingSelected = false;

// 「⋯」から開いたダイアログを、編集・複製・削除以外で閉じたとき、フォーカスを戻す行のid。
let dialogReturnId: string | null = null;

// 設定画面に出す情報(最後のバックアップ日時・データの保存状態・表示の設定・事業所)。
let settingsInfo: SettingsInfo = { lastBackupAt: null, persisted: null, theme: loadThemeSetting(), office: null };

// 出発・帰着の選び方と事業所。起動時に loadRouteContext() で読み直す(Task 3 が使う)。
let routeContext: RouteContext = { ends: DEFAULT_ROUTE_ENDS, office: null };
// loadSettingsInfo() が一度でも終わったか。終わる前はlastBackupAtがnullのままなので、
// バックアップのお知らせ(「まだバックアップがありません」)を誤って出さないためのガード。
let settingsLoaded = false;

// バックアップのお知らせで「あとで」を押した日時を覚えておくキー。
const BACKUP_LATER_KEY = 'route-auto-input:backup-later';
// ホーム画面への追加の案内で「閉じる」を押した日時を覚えておくキー。
const INSTALL_DISMISS_KEY = 'route-auto-input:install-dismissed';
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
    const [lastBackupAt, persisted] = await Promise.all([getMeta('lastBackupAt'), isStoragePersisted()]);
    settingsInfo = { ...settingsInfo, lastBackupAt: lastBackupAt ?? null, persisted };
  } catch {
    // 読み込みに失敗しても、アプリを止めない。今のsettingsInfoをそのまま使う
    // (お知らせはsettingsLoadedがtrueになった時点でlastBackupAt: nullとして出る)。
  } finally {
    settingsLoaded = true;
    render();
  }
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

function setState(next: AppState): void {
  state = next;
  render();
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

type FormInput = { name: string; address: string; phone: string };

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
        ? createPatient(input.name, input.address, new Date(), input.phone)
        : updatePatientFields(existing, input.name, input.address, new Date(), input.phone);
    if (existing !== null && state.selectedIds.includes(existing.id)) {
      // 選択中(=ルートに入っている)訪問先の編集。住所が変わったかもしれないので、
      // そのルートについて開いた印は古くなる前に消す。
      openedRoutes.clear();
    }
    await savePatient(patient);
    requestProtectionOnce();
    if (continueAfter && existing === null) {
      continueCount += 1;
      formDraft = { name: '', address: '', phone: '' };
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

/** フォームの「キャンセル」。入力途中なら確認してから戻る。 */
function handleFormCancel(input: FormInput): void {
  const original = currentEditingPatient();
  const dirty =
    original === null
      ? input.name.trim() !== '' || input.address.trim() !== '' || input.phone.trim() !== ''
      : input.name !== original.name || input.address !== original.address || input.phone !== (original.phone ?? '');
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

function handleEdit(id: string): void {
  dialogReturnId = null;
  formDraft = null;
  setState(withScreen(state, { name: 'form', patientId: id }));
}

/** 名前と住所を写した状態の、新規登録フォームを開く(保存すると別の訪問先になる)。 */
function handleDuplicate(id: string): void {
  const source = state.patients.find((patient) => patient.id === id);
  if (!source) {
    closeAnyDialog();
    return;
  }
  dialogReturnId = null;
  formDraft = { name: source.name, address: source.address, phone: source.phone ?? '' };
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

/** 住所が送信先へ渡ることを確認し、許可されたら共有用のテキストを返す。取りやめなら null。 */
function confirmedShareText(): string | null {
  const addresses = selectedPatients(state).map((patient) => patient.address);
  if (addresses.length === 0) {
    return null;
  }
  const question =
    `訪問先の住所(${addresses.length}件)が、送った相手と、送るのに使うアプリ(LINEなど)に渡ります。` +
    '名前は含まれません。共有しますか?';
  if (!window.confirm(question)) {
    return null;
  }
  return buildShareText(addresses, MAX_STOPS_PER_ROUTE, DEFAULT_MAP_PROVIDER);
}

function showCopiedMessage(): void {
  setState(
    withMessage(state, {
      kind: 'info',
      text: 'ルートのURLをコピーしました。LINEなどに貼り付けて送ってください。',
    }),
  );
}

async function handleExport(): Promise<void> {
  try {
    const date = new Date().toISOString().slice(0, 10);
    downloadTextFile(`route-auto-input-${date}.json`, serializeBackup(state.patients));
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

async function handleImport(file: File, mode: 'replace' | 'merge'): Promise<void> {
  try {
    const patients = parseBackup(await readTextFile(file));
    const question =
      mode === 'replace'
        ? `今のデータ${state.patients.length}件を消して、${patients.length}件を取り込みます。よろしいですか?`
        : `${patients.length}件を今のデータに追加します。よろしいですか?`;
    if (!window.confirm(question)) {
      return;
    }
    if (mode === 'replace') {
      await replaceAllPatients(patients);
    } else {
      await mergePatients(patients);
    }
    await reloadPatients({ kind: 'info', text: `${patients.length}件を取り込みました。` });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'データを取り込めませんでした。';
    setState(withMessage(state, { kind: 'error', text: message }));
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
      }, currentNotice());
    case 'form':
      return renderPatientForm(currentEditingPatient(), formDraft, state.message, {
        onSave: (name, address, phone) => {
          void handleSaveRequest({ name, address, phone }, false);
        },
        onSaveAndContinue: (name, address, phone) => {
          void handleSaveRequest({ name, address, phone }, true);
        },
        onCancel: (name, address, phone) => {
          handleFormCancel({ name, address, phone });
        },
      });
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
        onOpenMap: () => setState(withScreen(state, { name: 'map' })),
        onBack: () => setState(withScreen(state, { name: 'list' })),
        onEndsChange: (ends) => {
          void handleEndsChange(ends);
        },
      });
    case 'map':
      return renderRouteMap(state, new Map(openedRoutes), DEFAULT_MAP_PROVIDER, routeContext, {
        onOpenRoute: handleOpenRoute,
        onBack: () => setState(withScreen(state, { name: 'order' })),
        onChooseStops: () => setState(withScreen(state, { name: 'list' })),
        onShare: () => {
          void handleShareRoutes();
        },
        onCopyLink: () => {
          void handleCopyRouteLink();
        },
      });
    case 'settings':
      return renderSettings(state, settingsInfo, {
        onExport: () => {
          void handleExport();
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
    },
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
 * 閉じたら開いた元の「⋯」へ、フォーカスを移す。
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
    dialog.querySelector<HTMLElement>('button')?.focus();
    return;
  }
  if (hadDialog && dialogReturnId !== null) {
    root!
      .querySelector<HTMLElement>(
        `[data-testid="row-menu"][data-id="${dialogReturnId}"], [data-testid="stop-menu"][data-id="${dialogReturnId}"]`,
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

/** ロック画面を通過してから、いつもどおりアプリ本体を描画・読み込みする。 */
function startApp(): void {
  render();
  void reloadPatients();
  void loadSettingsInfo();
  void loadRouteContext();
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
