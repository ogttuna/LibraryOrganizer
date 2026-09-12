export type Kind = 'book' | 'article' | 'other';
export type ReadingStatus = 'unread' | 'reading' | 'read';
export type LibraryView =
  'all' | 'recent' | 'favorites' | 'reading-list' | 'uncategorized' | 'trash';
export interface Attachment {
  id: string;
  itemId: string;
  originalFilename: string;
  relativePath: string;
  mimeType: string;
  format: string;
  sizeBytes: number;
  sha256: string;
  lastPage: number;
  createdAt: string;
}
export interface Item {
  id: string;
  title: string;
  kind: Kind;
  authors: string[];
  year: number | null;
  language: string;
  description: string;
  summary: string;
  notes: string;
  readingStatus: ReadingStatus;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  categoryIds: string[];
  tagIds: string[];
  attachments: Attachment[];
}
export interface Category {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  count: number;
}
export interface Tag {
  id: string;
  name: string;
  count: number;
}
export interface Stats {
  total: number;
  favorites: number;
  unread: number;
  reading: number;
  read: number;
  trash: number;
  uncategorized: number;
  recent: number;
}
export interface Catalog {
  categories: Category[];
  tags: Tag[];
  stats: Stats;
}
export interface ItemPatch extends Partial<
  Pick<
    Item,
    | 'title'
    | 'kind'
    | 'authors'
    | 'year'
    | 'language'
    | 'description'
    | 'summary'
    | 'notes'
    | 'readingStatus'
    | 'isFavorite'
    | 'categoryIds'
  >
> {
  tagNames?: string[];
}
export interface LibraryQuery {
  view: LibraryView;
  q: string;
  categoryIds: string[];
  includeDescendants: boolean;
  tagIds: string[];
  tagMode: 'all' | 'any';
  kind: Kind | '';
  format: string;
  readingStatus: ReadingStatus | '';
  sort: 'recent' | 'title' | 'year';
  limit: number;
  offset: number;
}
export interface LibraryPage {
  items: Item[];
  total: number;
}
export interface ImportResult {
  filename: string;
  status: 'imported' | 'duplicate' | 'failed';
  itemId: string | null;
  error: string | null;
}
export interface CategoryInput {
  id?: string;
  name: string;
  parentId: string | null;
}
export interface TagInput {
  id?: string;
  name: string;
}
export interface RestorePreview {
  id: string;
  createdAt: string;
  itemCount: number;
  attachmentCount: number;
  totalBytes: number;
}
export interface TrashResult {
  deletedCount: number;
  pendingFileCount: number;
}
export interface BulkChange {
  itemIds: string[];
  categoryIds?: string[];
  tagNames?: string[];
  readingStatus?: ReadingStatus;
  trashed?: boolean;
}
export interface Backend {
  queryLibrary(query: LibraryQuery): Promise<LibraryPage>;
  getCatalog(): Promise<Catalog>;
  getItem(id: string): Promise<Item>;
  createItem(title: string, kind: Kind): Promise<Item>;
  updateItem(id: string, patch: ItemPatch): Promise<Item>;
  saveCategory(input: CategoryInput): Promise<string>;
  deleteCategory(id: string): Promise<void>;
  saveTag(input: TagInput): Promise<string>;
  deleteTag(id: string): Promise<void>;
  bulkUpdate(change: BulkChange): Promise<void>;
  importFile(source: string | File, itemId?: string, categoryIds?: string[]): Promise<ImportResult>;
  attachmentUrl(id: string): Promise<string>;
  openAttachment(id: string): Promise<void>;
  setLastPage(id: string, page: number): Promise<void>;
  createBackup(destination: string): Promise<string>;
  prepareRestore(source: string): Promise<RestorePreview>;
  cancelRestore(id: string): Promise<void>;
  applyRestore(id: string): Promise<void>;
  emptyTrash(): Promise<TrashResult>;
  exitApplication(): Promise<void>;
  getLibraryPath(): Promise<string>;
  rebuildSearch(): Promise<void>;
}
export const kindLabels: Record<Kind, string> = {
  book: 'Kitap',
  article: 'Makale',
  other: 'Diğer',
};
export const statusLabels: Record<ReadingStatus, string> = {
  unread: 'Okunmadı',
  reading: 'Okunuyor',
  read: 'Okundu',
};
export const defaultQuery: LibraryQuery = {
  view: 'all',
  q: '',
  categoryIds: [],
  includeDescendants: true,
  tagIds: [],
  tagMode: 'all',
  kind: '',
  format: '',
  readingStatus: '',
  sort: 'recent',
  limit: 100,
  offset: 0,
};
export const supportedFormats = ['pdf', 'epub', 'txt', 'md', 'doc', 'docx', 'odt', 'rtf', 'djvu'];
