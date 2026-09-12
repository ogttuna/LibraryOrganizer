import { createStore, get, setMany } from 'idb-keyval';
import type { Backend, Category, Item, ItemPatch, LibraryQuery, Tag } from './types';
import { supportedFormats } from './types';
import { normalize } from './utils';

interface PreviewData {
  items: Item[];
  categories: Category[];
  tags: Tag[];
}
const store = createStore('folio-browser-preview-v1', 'library');
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
let queue: Promise<unknown> = Promise.resolve();
async function read(): Promise<PreviewData> {
  return (await get<PreviewData>('data', store)) ?? { items: [], categories: [], tags: [] };
}
function write<T>(
  fn: (data: PreviewData) => T | Promise<T>,
  extra: [IDBValidKey, unknown][] = [],
): Promise<T> {
  const run = queue.then(async () => {
    const data = await read();
    const result = await fn(data);
    await setMany([['data', data], ...extra], store);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}
function itemById(data: PreviewData, id: string) {
  const item = data.items.find((i) => i.id === id);
  if (!item) throw new Error('Kayıt bulunamadı.');
  return item;
}
function newItem(title: string, kind: Item['kind']): Item {
  if (!title.trim() || title.length > 500) throw new Error('Başlık 1–500 karakter olmalı.');
  return {
    id: uid(),
    title: title.trim(),
    kind,
    authors: [],
    year: null,
    language: '',
    description: '',
    summary: '',
    notes: '',
    readingStatus: 'unread',
    isFavorite: false,
    createdAt: now(),
    updatedAt: now(),
    deletedAt: null,
    categoryIds: [],
    tagIds: [],
    attachments: [],
  };
}
function labelIds(data: PreviewData, names: string[]) {
  if (names.length > 100) throw new Error('En fazla 100 etiket eklenebilir.');
  return [
    ...new Set(
      names.map((value) => {
        const name = value.trim();
        if (!name || name.length > 80) throw new Error('Etiket 1–80 karakter olmalı.');
        let tag = data.tags.find((tag) => tag.name === name);
        if (!tag) {
          tag = { id: uid(), name, count: 0 };
          data.tags.push(tag);
        }
        return tag.id;
      }),
    ),
  ];
}
function apply(data: PreviewData, item: Item, patch: ItemPatch) {
  if (patch.title !== undefined && (!patch.title.trim() || patch.title.length > 500))
    throw new Error('Başlık 1–500 karakter olmalı.');
  if (patch.year != null && (!Number.isInteger(patch.year) || patch.year < 1 || patch.year > 9999))
    throw new Error('Yıl 1–9999 arasında olmalı.');
  if (patch.categoryIds?.some((id) => !data.categories.some((c) => c.id === id)))
    throw new Error('Kategori bulunamadı.');
  for (const key of ['description', 'summary', 'notes'] as const) {
    if ((patch[key]?.length ?? 0) > 1_000_000)
      throw new Error('Metin en fazla 1 milyon karakter olabilir.');
  }
  const { tagNames, ...fields } = patch;
  Object.assign(item, fields, { updatedAt: now() });
  if (patch.title) item.title = patch.title.trim();
  if (tagNames) item.tagIds = labelIds(data, tagNames);
}

export function filterPreview(data: PreviewData, query: LibraryQuery) {
  const cats = new Set(query.categoryIds);
  if (query.includeDescendants) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of data.categories) {
        if (c.parentId && cats.has(c.parentId) && !cats.has(c.id)) {
          cats.add(c.id);
          changed = true;
        }
      }
    }
  }
  const terms = normalize(query.q)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 32);
  const result = data.items.filter((item) => {
    if ((query.view === 'trash') !== Boolean(item.deletedAt)) return false;
    if (query.view === 'favorites' && !item.isFavorite) return false;
    if (query.view === 'reading-list' && item.readingStatus === 'read') return false;
    if (query.view === 'uncategorized' && item.categoryIds.length) return false;
    if (query.view === 'recent' && Date.parse(item.createdAt) < Date.now() - 30 * 86400_000)
      return false;
    if (cats.size && !item.categoryIds.some((id) => cats.has(id))) return false;
    if (
      query.tagIds.length &&
      !(query.tagMode === 'all'
        ? query.tagIds.every((id) => item.tagIds.includes(id))
        : query.tagIds.some((id) => item.tagIds.includes(id)))
    )
      return false;
    if (query.kind && query.kind !== item.kind) return false;
    if (query.readingStatus && query.readingStatus !== item.readingStatus) return false;
    if (query.format && !item.attachments.some((a) => a.format === query.format)) return false;
    const text = normalize(
      [
        item.title,
        ...item.authors,
        item.description,
        item.summary,
        item.notes,
        ...data.categories.filter((c) => item.categoryIds.includes(c.id)).map((c) => c.name),
        ...data.tags.filter((t) => item.tagIds.includes(t.id)).map((t) => t.name),
        ...item.attachments.map((a) => a.originalFilename),
      ].join(' '),
    );
    const words = text.split(/[^\p{L}\p{N}]+/u);
    return terms.every((term) => words.some((word) => word.startsWith(term)));
  });
  return result.sort((a, b) =>
    query.sort === 'title'
      ? a.title.localeCompare(b.title, 'tr')
      : query.sort === 'year'
        ? (b.year ?? 0) - (a.year ?? 0)
        : b.createdAt.localeCompare(a.createdAt),
  );
}

export const previewBackend: Backend = {
  async queryLibrary(query) {
    const items = filterPreview(await read(), query);
    return { items: items.slice(query.offset, query.offset + query.limit), total: items.length };
  },
  async getCatalog() {
    const data = await read();
    const live = data.items.filter((i) => !i.deletedAt);
    return {
      categories: data.categories.map((c) => ({
        ...c,
        count: live.filter((i) => i.categoryIds.includes(c.id)).length,
      })),
      tags: data.tags.map((t) => ({
        ...t,
        count: live.filter((i) => i.tagIds.includes(t.id)).length,
      })),
      stats: {
        total: live.length,
        favorites: live.filter((i) => i.isFavorite).length,
        unread: live.filter((i) => i.readingStatus === 'unread').length,
        reading: live.filter((i) => i.readingStatus === 'reading').length,
        read: live.filter((i) => i.readingStatus === 'read').length,
        trash: data.items.length - live.length,
        uncategorized: live.filter((i) => !i.categoryIds.length).length,
        recent: live.filter((i) => Date.parse(i.createdAt) >= Date.now() - 30 * 86400_000).length,
      },
    };
  },
  async getItem(id) {
    return itemById(await read(), id);
  },
  createItem: (title, kind) =>
    write((data) => {
      const item = newItem(title, kind);
      data.items.unshift(item);
      return item;
    }),
  updateItem: (id, patch) =>
    write((data) => {
      const item = itemById(data, id);
      apply(data, item, patch);
      return item;
    }),
  saveCategory: (input) =>
    write((data) => {
      const name = input.name.trim();
      if (!name || name.length > 80) throw new Error('Kategori 1–80 karakter olmalı.');
      if (
        data.categories.some(
          (c) => c.id !== input.id && c.name === name && c.parentId === input.parentId,
        )
      )
        throw new Error('Bu kategori zaten var.');
      let cursor = input.parentId;
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === input.id || seen.has(cursor))
          throw new Error('Kategori kendi altına taşınamaz.');
        seen.add(cursor);
        const c = data.categories.find((c) => c.id === cursor);
        if (!c) throw new Error('Üst kategori bulunamadı.');
        cursor = c.parentId;
      }
      const id = input.id ?? uid();
      const existing = data.categories.find((c) => c.id === id);
      if (input.id && !existing) throw new Error('Kategori bulunamadı.');
      if (existing) Object.assign(existing, { name, parentId: input.parentId });
      else data.categories.push({ id, name, parentId: input.parentId, count: 0, sortOrder: 0 });
      return id;
    }),
  deleteCategory: (id) =>
    write((data) => {
      const category = data.categories.find((c) => c.id === id);
      if (!category) throw new Error('Kategori bulunamadı.');
      const children = data.categories.filter((c) => c.parentId === id);
      if (
        children.some((child) =>
          data.categories.some(
            (c) => c.id !== id && c.parentId === category.parentId && c.name === child.name,
          ),
        )
      )
        throw new Error(
          'Alt kategorilerden biri üst düzeydeki bir kategoriyle aynı adda. Önce alt kategoriyi yeniden adlandırın.',
        );
      for (const child of children) child.parentId = category.parentId;
      data.categories = data.categories.filter((c) => c.id !== id);
      for (const item of data.items) item.categoryIds = item.categoryIds.filter((c) => c !== id);
    }),
  saveTag: (input) =>
    write((data) => {
      const name = input.name.trim();
      if (!name || name.length > 80 || name.includes('\0'))
        throw new Error('Etiket 1–80 karakter olmalı.');
      const existing = data.tags.find((tag) => tag.id === input.id);
      if (input.id && !existing) throw new Error('Etiket bulunamadı.');
      if (data.tags.some((tag) => tag.id !== input.id && tag.name === name))
        throw new Error('Bu adda bir etiket zaten var.');
      if (existing) {
        existing.name = name;
        return existing.id;
      }
      const id = uid();
      data.tags.push({ id, name, count: 0 });
      return id;
    }),
  deleteTag: (id) =>
    write((data) => {
      if (!data.tags.some((tag) => tag.id === id)) throw new Error('Etiket bulunamadı.');
      data.tags = data.tags.filter((tag) => tag.id !== id);
      for (const item of data.items) item.tagIds = item.tagIds.filter((tag) => tag !== id);
    }),
  bulkUpdate: (change) =>
    write((data) => {
      for (const id of change.itemIds) {
        const item = itemById(data, id);
        const patch: ItemPatch = {};
        if (change.categoryIds)
          patch.categoryIds = [...new Set([...item.categoryIds, ...change.categoryIds])];
        if (change.tagNames)
          patch.tagNames = [
            ...data.tags.filter((t) => item.tagIds.includes(t.id)).map((t) => t.name),
            ...change.tagNames,
          ];
        if (change.readingStatus) patch.readingStatus = change.readingStatus;
        apply(data, item, patch);
        if (change.trashed !== undefined) item.deletedAt = change.trashed ? now() : null;
      }
    }),
  async importFile(source, itemId, categoryIds = []) {
    if (typeof source === 'string') throw new Error('Tarayıcıda dosya seçiciyi kullanın.');
    const format = source.name.split('.').at(-1)?.toLowerCase() ?? '';
    if (!supportedFormats.includes(format)) throw new Error('Bu dosya biçimi desteklenmiyor.');
    if (!source.size || source.size > 100 * 1024 * 1024)
      throw new Error(
        'Tarayıcı önizlemesinde 1 B–100 MB arasında dosya seçin. Büyük dosyalar için masaüstü uygulamasını kullanın.',
      );
    const buffer = await source.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    const attachmentId = uid();
    const extra: [IDBValidKey, unknown][] = [];
    return write((data) => {
      const duplicate = data.items.find((i) => i.attachments.some((a) => a.sha256 === hash));
      if (duplicate) {
        if (!itemId || duplicate.id === itemId)
          duplicate.categoryIds = [...new Set([...duplicate.categoryIds, ...categoryIds])];
        return { filename: source.name, status: 'duplicate', itemId: duplicate.id, error: null };
      }
      const item = itemId
        ? itemById(data, itemId)
        : newItem(source.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' '), 'book');
      if (item.deletedAt) throw new Error('Önce kaynağı çöpten geri getirin.');
      if (!itemId) data.items.unshift(item);
      item.categoryIds = [...new Set([...item.categoryIds, ...categoryIds])];
      item.attachments.push({
        id: attachmentId,
        itemId: item.id,
        originalFilename: source.name,
        format,
        mimeType: source.type,
        sizeBytes: source.size,
        sha256: hash,
        relativePath: `preview/${attachmentId}`,
        lastPage: 1,
        createdAt: now(),
      });
      extra.push([
        `file:${attachmentId}`,
        new Blob([buffer], { type: source.type || 'application/octet-stream' }),
      ]);
      return { filename: source.name, status: 'imported', itemId: item.id, error: null };
    }, extra);
  },
  async attachmentUrl(id) {
    const blob = await get<Blob>(`file:${id}`, store);
    if (!blob) throw new Error('Dosya bu tarayıcıda bulunamadı.');
    return URL.createObjectURL(blob);
  },
  async openAttachment(id) {
    const url = await previewBackend.attachmentUrl(id);
    const data = await read();
    const file = data.items.flatMap((i) => i.attachments).find((a) => a.id === id);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file?.originalFilename ?? 'belge';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
  setLastPage: (id, page) =>
    write((data) => {
      const file = data.items.flatMap((i) => i.attachments).find((a) => a.id === id);
      if (!file) throw new Error('Dosya bulunamadı.');
      file.lastPage = page;
    }),
  async createBackup() {
    throw new Error('Arşiv yedekleme masaüstü uygulamasında kullanılabilir.');
  },
  async prepareRestore() {
    throw new Error('Yedek geri yükleme masaüstü uygulamasında kullanılabilir.');
  },
  async cancelRestore() {},
  async applyRestore() {
    throw new Error('Yedek geri yükleme masaüstü uygulamasında kullanılabilir.');
  },
  emptyTrash() {
    const extra: [IDBValidKey, unknown][] = [];
    return write((data) => {
      const deleted = data.items.filter((item) => item.deletedAt);
      for (const item of deleted)
        for (const file of item.attachments) extra.push([`file:${file.id}`, undefined]);
      data.items = data.items.filter((item) => !item.deletedAt);
      return { deletedCount: deleted.length, pendingFileCount: 0 };
    }, extra);
  },
  async exitApplication() {},
  async getLibraryPath() {
    return 'Bu tarayıcıya ait ayrı önizleme alanı (IndexedDB)';
  },
  async rebuildSearch() {},
};

export async function loadDemoLibrary() {
  return write((data) => {
    if (data.items.length) throw new Error('Örnek kütüphane yalnızca boş önizlemeye eklenebilir.');
    const categories = ['Sosyal bilimler', 'Tasarım', 'Araştırma', 'Edebiyat'].map((name) => ({
      id: uid(),
      name,
      parentId: null,
      sortOrder: 0,
      count: 0,
    }));
    data.categories.push(...categories);
    const titles = [
      'Düşünmenin izinde',
      'Bilimsel araştırma yöntemleri',
      'Tasarımın gündelik dili',
      'İnsan ve toplum',
      'Öğrenme üzerine',
      'Kent ve hafıza',
      'Modern mimarlık notları',
      'Dikkat ve derin çalışma',
    ];
    data.items = titles.map((title, index) => {
      const item = newItem(title, index === 4 || index === 6 ? 'article' : 'book');
      item.authors = ['Örnek yazar'];
      item.year = 2024 - (index % 4);
      item.language = 'Türkçe';
      item.categoryIds = [categories[index % categories.length].id];
      if (index === 1) item.categoryIds.push(categories[0].id);
      item.tagIds = labelIds(
        data,
        index % 2 ? ['başvuru kaynağı', 'metodoloji'] : ['ilham', 'okuma notları'],
      );
      item.description =
        'Arayüzü keşfetmek için oluşturulmuş örnek kaynak. Bu kaydın bilgilerini düzenleyebilir, kategorilerini değiştirebilir ve kendi dosyanızı ekleyebilirsiniz.';
      item.summary =
        index === 0
          ? 'Düşünme biçimleri, gözlem ve soru sormanın öğrenmedeki yeri üzerine örnek bir özet.'
          : '';
      item.notes =
        index === 0
          ? 'Okurken aklıma gelenler\n\n• İyi bir soru, yeni bir bakış açısı açıyor.\n• Bu konuyu araştırma yöntemleri notlarımla birlikte değerlendireceğim.'
          : '';
      item.readingStatus = index % 3 === 0 ? 'reading' : index % 3 === 1 ? 'unread' : 'read';
      item.isFavorite = index === 0 || index === 3;
      item.createdAt = new Date(Date.now() - index * 86400_000).toISOString();
      return item;
    });
    return data.items[0].id;
  });
}
