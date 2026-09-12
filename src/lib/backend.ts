import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import type { Backend } from './types';
import { operations } from './operation-tracker';

export const isDesktop = isTauri();
const desktop: Backend = {
  queryLibrary: (query) => invoke('query_library', { query }),
  getCatalog: () => invoke('get_catalog'),
  getItem: (id) => invoke('get_item', { id }),
  createItem: (title, kind) => invoke('create_item', { title, kind }),
  updateItem: (id, patch) => invoke('update_item', { id, patch }),
  saveCategory: (input) => invoke('save_category', { input }),
  deleteCategory: (id) => invoke('delete_category', { id }),
  saveTag: (input) => invoke('save_tag', { id: input.id ?? null, name: input.name }),
  deleteTag: (id) => invoke('delete_tag', { id }),
  bulkUpdate: (change) => invoke('bulk_update', { change }),
  importFile: (source, itemId, categoryIds = []) => {
    if (typeof source !== 'string')
      return Promise.reject(new Error('Dosyayı masaüstü dosya seçicisinden ekleyin.'));
    return invoke('import_file', { path: source, itemId: itemId ?? null, categoryIds });
  },
  attachmentUrl: async (id) => convertFileSrc(await invoke<string>('get_attachment_path', { id })),
  openAttachment: (id) => invoke('open_attachment', { id }),
  setLastPage: (id, page) => invoke('set_last_page', { id, page }),
  createBackup: (destination) => invoke('create_backup', { destination }),
  prepareRestore: (source) => invoke('prepare_restore', { source }),
  cancelRestore: (id) => invoke('cancel_restore', { id }),
  applyRestore: (id) => invoke('apply_restore', { id }),
  emptyTrash: () => invoke('empty_trash'),
  exitApplication: () => invoke('exit_application'),
  getLibraryPath: () => invoke('get_library_path'),
  rebuildSearch: () => invoke('rebuild_search'),
};

// This adapter is deliberately separate from the desktop archive and is never used in Tauri.
const adapter: Backend = isDesktop ? desktop : (await import('./preview-backend')).previewBackend;

const mutations = new Set<keyof Backend>([
  'createItem',
  'updateItem',
  'saveCategory',
  'deleteCategory',
  'saveTag',
  'deleteTag',
  'bulkUpdate',
  'importFile',
  'setLastPage',
  'createBackup',
  'prepareRestore',
  'cancelRestore',
  'emptyTrash',
  'rebuildSearch',
]);
export const backend: Backend = new Proxy(adapter, {
  get(target, property: keyof Backend) {
    const method = target[property];
    if (!mutations.has(property)) return method;
    return (...args: unknown[]) =>
      operations.track((method as (...args: unknown[]) => Promise<unknown>)(...args));
  },
});
