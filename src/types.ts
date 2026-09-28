/** GPSで取得、または貼り付けたURL/テキストから読み取った位置。 */
export type GeoLocation = { lat: number; lng: number; accuracy: number | null; recordedAt: string; source: 'gps' | 'paste' };

export type ParkingType = 'onsite' | 'coin' | 'street_permit' | 'management_ok' | 'unknown';
export type Parking = { type: ParkingType; permitExpires?: string /* YYYY-MM-DD */ };

/** 訪問先に紐づく写真。撮影場所などの情報はresizeImageで縮小するときに落とす。 */
export type Photo = { id: string; patientId: string; blob: Blob; createdAt: string };

/** 訪問先とは別に登録する、近くの地点(トイレ・休憩・店・駐車場など)。Task 6で使う。 */
export type SpotKind = 'toilet' | 'rest' | 'store' | 'parking' | 'other';
export type Spot = { id: string; kind: SpotKind; note: string; location: GeoLocation; createdAt: string };

export type Patient = {
  id: string;
  name: string;
  address: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
  /** 任意。無ければ持たない。 */
  phone?: string;
  /** 任意。無ければ持たない。 */
  location?: GeoLocation;
  /** 任意。無ければ持たない。 */
  parking?: Parking;
  /** 任意。無ければ持たない。 */
  note?: string;
};

/** 登録・編集フォームの入力値。 */
export type PatientFormDraft = {
  name: string;
  address: string;
  phone: string;
  parkingType: ParkingType | '';
  permitExpires: string;
  note: string;
};

export type Screen =
  | { name: 'list' }
  | { name: 'form'; patientId: string | null }
  | { name: 'order' }
  | { name: 'map' }
  | { name: 'settings' }
  | { name: 'history'; openDate: string | null; weekday: number | null };

export type Message = { kind: 'error' | 'info'; text: string };

/** 一覧の並び順。登録順(既定)・名前(あいうえお順)・住所(あいうえお順)。 */
export type SortOrder = 'registered' | 'name' | 'address';

/** 位置の登録ダイアログ。measuring/measured で今いる場所を測り、貼り付けでも登録できる。 */
export type LocationDialog = {
  kind: 'location';
  id: string; // 訪問先
  phase: 'idle' | 'measuring' | 'measured' | 'saved' | 'error';
  best: { lat: number; lng: number; accuracy: number } | null;
  error: string | null;
  pasteText: string;
  pasteError: string | null;
  /** 座標やURLを貼り付ける折りたたみ(details)を、手で開いたままにしているか。 */
  pasteOpen: boolean;
  previous: GeoLocation | null; // 元に戻す用(saved のとき)
};

/** お役立ち地点の登録ダイアログ。位置の登録ダイアログと同じ測定の流れ(idle/measuring/measured/error)を使う。 */
export type SpotDialog = {
  kind: 'spot';
  phase: 'idle' | 'measuring' | 'measured' | 'saved' | 'error';
  best: { lat: number; lng: number; accuracy: number } | null;
  error: string | null;
  spotKind: SpotKind;
  note: string;
};

/** 送るダイアログ。patientIds が空なら、お役立ち地点だけを送る。 */
export type TransferSendDialog = {
  kind: 'transferSend';
  patientIds: string[]; // 空ならお役立ち地点だけを送る
  includePhotos: boolean; // 既定 true(写真がある人がいるときだけ選べる)
  includeSpots: boolean; // 既定: patientIds が空なら true、そうでなければ false
  useSharedSecret: boolean; // 合言葉が保存されていれば既定 true
  password: string;
  passwordConfirm: string;
  saveAsShared: boolean; // 「この合言葉を事業所の合言葉として保存する」
  phase: 'form' | 'working' | 'ready' | 'done';
  error: string | null;
  /** phase: 'ready'・'done' のときだけ意味を持つ。共有(navigator.share)が使える端末かどうか。 */
  canShare: boolean;
  /** phase: 'done' のときだけ意味を持つ。共有できた(true)かダウンロードした(false)かで、文言を出し分ける。 */
  shared: boolean;
};

/**
 * 受け取りのダイアログ(引き継ぎのファイルを読み込んだとき)。復号した中身は state に置かず、
 * transferFlow.ts の中だけに持つ(ここにあるのは、暗号化されたままの文字列と表示に使う文だけ)。
 */
export type TransferReceiveDialog = {
  kind: 'transferReceive';
  fileText: string; // 暗号化されたままの文字列(復号した中身は state に置かない)
  phase: 'password' | 'confirm' | 'conflict' | 'working' | 'done';
  password: string;
  error: string | null;
  summary: string; // 「山田様ほか2人・お役立ち地点1件」
  conflictIndex: number; // phase 'conflict' のとき、何人目の同じ人か
  conflicts: { incomingName: string; incomingAddress: string; existingName: string; existingAddress: string }[];
  result: string | null; // done の文
};

/**
 * バックアップの保存ダイアログ。書き出したファイルができた(ready)ところから、
 * 「保存する」で共有/ダウンロードして終わる(done)までの2段階(backupFlow.ts)。
 */
export type BackupSaveDialog = {
  kind: 'backupSave';
  phase: 'ready' | 'done';
  fileName: string;
  canShare: boolean;
  /** phase: 'done' のときだけ意味を持つ。共有できた('shared')かダウンロードした('downloaded')か。 */
  result: 'shared' | 'downloaded' | null;
};

/** 開いているダイアログ。1件向けは対象の訪問先のidを、複数選択の一括削除は件数を持たない(state.selectedIdsを見る)。 */
export type Dialog =
  | { kind: 'rowMenu'; id: string }
  | { kind: 'confirmDelete'; id: string }
  | { kind: 'confirmDeleteSelected' }
  | { kind: 'selectionMenu' }
  | { kind: 'installSteps' }
  | { kind: 'stopMenu'; id: string }
  | {
      kind: 'similar';
      input: PatientFormDraft;
      matchIds: string[];
      continueAfter: boolean;
    }
  | LocationDialog
  | SpotDialog
  | { kind: 'photos'; patientId: string; urls: string[]; index: number }
  | TransferSendDialog
  | TransferReceiveDialog
  | BackupSaveDialog;

export type AppState = {
  screen: Screen;
  patients: Patient[];
  /** 訪問順に並んだ、選択中の患者id */
  selectedIds: string[];
  searchQuery: string;
  sortOrder: SortOrder;
  message: Message | null;
  /** 開いているダイアログ。なければ null。 */
  dialog: Dialog | null;
  /** 一覧に出す範囲。'selected' は選んだ人だけ(薄く残す行を含む)。 */
  listFilter: 'all' | 'selected';
  /** 「選択中」の表示でチェックを外した行。表示を切り替えるまでは薄く残す。 */
  dimmedIds: string[];
};
