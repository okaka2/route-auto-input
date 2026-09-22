export type Patient = {
  id: string;
  name: string;
  address: string;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
};

export type Screen =
  | { name: 'list' }
  | { name: 'form'; patientId: string | null }
  | { name: 'order' }
  | { name: 'settings' };

export type Message = { kind: 'error' | 'info'; text: string };

/** 開いているダイアログ。対象の訪問先のidを持つ。 */
export type Dialog = { kind: 'rowMenu'; id: string } | { kind: 'confirmDelete'; id: string };

export type AppState = {
  screen: Screen;
  patients: Patient[];
  /** 訪問順に並んだ、選択中の患者id */
  selectedIds: string[];
  searchQuery: string;
  message: Message | null;
  /** 開いているダイアログ。なければ null。 */
  dialog: Dialog | null;
};
