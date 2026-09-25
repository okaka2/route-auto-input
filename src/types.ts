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

/** 開いているダイアログ。1件向けは対象の訪問先のidを、複数選択の一括削除は件数を持たない(state.selectedIdsを見る)。 */
export type Dialog =
  | { kind: 'rowMenu'; id: string }
  | { kind: 'confirmDelete'; id: string }
  | { kind: 'confirmDeleteSelected' }
  | { kind: 'installSteps' }
  | { kind: 'stopMenu'; id: string }
  | {
      kind: 'similar';
      input: PatientFormDraft;
      matchIds: string[];
      continueAfter: boolean;
    }
  | LocationDialog
  | { kind: 'photos'; patientId: string; urls: string[]; index: number };

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
