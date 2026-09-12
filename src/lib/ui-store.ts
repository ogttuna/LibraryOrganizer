import { create } from 'zustand';
import type { LibraryQuery } from './types';
import { defaultQuery } from './types';

interface UIState {
  query: LibraryQuery;
  selectedId: string | null;
  selectedIds: string[];
  sidebarOpen: boolean;
  desktopSidebarCollapsed: boolean;
  importBusy: boolean;
  maintenanceBusy: boolean;
  inspectorWidth: number;
  setQuery: (patch: Partial<LibraryQuery>) => void;
  select: (id: string | null, ids?: string[]) => void;
  setSidebar: (open: boolean) => void;
  toggleDesktopSidebar: () => void;
  setImportBusy: (busy: boolean) => void;
  setMaintenanceBusy: (busy: boolean) => void;
  setInspectorWidth: (width: number) => void;
}
export const useUI = create<UIState>((set) => ({
  query: { ...defaultQuery },
  selectedId: null,
  selectedIds: [],
  sidebarOpen: false,
  desktopSidebarCollapsed: false,
  importBusy: false,
  maintenanceBusy: false,
  inspectorWidth: readInspectorWidth(),
  setQuery: (patch) =>
    set((state) => ({
      query: { ...state.query, ...patch, offset: patch.offset ?? 0 },
      selectedIds: [],
    })),
  select: (id, ids) => set({ selectedId: id, selectedIds: ids ?? (id ? [id] : []) }),
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
  toggleDesktopSidebar: () =>
    set((state) => ({ desktopSidebarCollapsed: !state.desktopSidebarCollapsed })),
  setImportBusy: (importBusy) => set({ importBusy }),
  setMaintenanceBusy: (maintenanceBusy) => set({ maintenanceBusy }),
  setInspectorWidth: (width) => {
    const inspectorWidth = Math.max(320, Math.min(600, width));
    try {
      localStorage.setItem('folio-inspector-width', String(inspectorWidth));
    } catch {
      /* A layout preference must never block editing. */
    }
    set({ inspectorWidth });
  },
}));

function readInspectorWidth() {
  try {
    const stored = Number(localStorage.getItem('folio-inspector-width'));
    return stored >= 320 && stored <= 600 ? stored : 380;
  } catch {
    return 380;
  }
}
