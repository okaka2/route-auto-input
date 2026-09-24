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
};

export type Screen =
  | { name: 'list' }
  | { name: 'form'; patientId: string | null }
  | { name: 'order' }
  | { name: 'map' }
  | { name: 'settings' };

export type Message = { kind: 'error' | 'info'; text: string };

/** 一覧の並び順。登録順(既定)・名前(あいうえお順)・住所(あいうえお順)。 */
export type SortOrder = 'registered' | 'name' | 'address';

/** 開いているダイアログ。1件向けは対象の訪問先のidを、複数選択の一括削除は件数を持たない(state.selectedIdsを見る)。 */
export type Dialog =
  | { kind: 'rowMenu'; id: string }
  | { kind: 'confirmDelete'; id: string }
  | { kind: 'confirmDeleteSelected' }
  | { kind: 'installSteps' }
  | { kind: 'stopMenu'; id: string };

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
