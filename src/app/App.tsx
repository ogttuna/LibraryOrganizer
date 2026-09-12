import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { ExitCoordinator } from '@/lib/exit-coordinator';
import { positions } from '@/lib/reading-position';
import { operations } from '@/lib/operation-tracker';
import {
  BookOpen,
  Search,
  Plus,
  Menu,
  Star,
  FileText,
  ChevronLeft,
  ChevronRight,
  ArrowDownWideNarrow,
  X,
  LoaderCircle,
  FolderPlus,
  Tag,
  Trash2,
  RotateCcw,
  Check,
  Sparkles,
  AlertCircle,
  CornerDownLeft,
  Library as LibraryIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { backend, isDesktop } from '@/lib/backend';
import { saves, useSaveState } from '@/lib/save-manager';
import { refreshLibrary } from '@/lib/query-client';
import { useUI } from '@/lib/ui-store';
import {
  defaultQuery,
  kindLabels,
  statusLabels,
  type Attachment,
  type Category,
  type Item,
  type LibraryView,
  type BulkChange,
} from '@/lib/types';
import { cn, errorMessage } from '@/lib/utils';
import { Sidebar, EmptyInspector } from '@/features/library/Sidebar';
import { Filters, ActiveFilters, ReadingTabs } from '@/features/library/Filters';
import { Inspector } from '@/features/item-details/Inspector';
import { ImportDialog } from '@/features/importer/ImportDialog';
import { CategoryDialog } from '@/features/categories/CategoryDialog';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { TagsDialog } from '@/features/tags/TagsDialog';
import { InspectorResize } from '@/features/item-details/InspectorResize';
import { TrashDialog } from '@/features/library/TrashDialog';

const PdfReader = lazy(() => import('@/features/reader/PdfReader'));
const viewTitles: Record<LibraryView, string> = {
  all: 'Kütüphanem',
  recent: 'Son eklenenler',
  favorites: 'Favoriler',
  'reading-list': 'Okuma listesi',
  uncategorized: 'Kategorisiz kaynaklar',
  trash: 'Çöp kutusu',
};

export function App() {
  useSaveState();
  const {
    query,
    setQuery,
    selectedId,
    selectedIds,
    select,
    setSidebar,
    inspectorWidth,
    desktopSidebarCollapsed,
    toggleDesktopSidebar,
  } = useUI();
  const [searchText, setSearchText] = useState(query.q);
  const searchInput = useRef<HTMLInputElement>(null);
  const [importer, setImporter] = useState<{ targetId?: string; files?: (string | File)[] } | null>(
    null,
  );
  const [categoryDialog, setCategoryDialog] = useState<{
    category?: Category;
    initialParentId?: string;
  } | null>(null);
  const [settings, setSettings] = useState(false);
  const [tagsDialog, setTagsDialog] = useState(false);
  const [trashDialog, setTrashDialog] = useState(false);
  const [reader, setReader] = useState<{ file: Attachment; item: Item } | null>(null);
  const [bulkTag, setBulkTag] = useState('');
  const [bulkBusy, setBulkBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const anchor = useRef<string | null>(null);
  const listScroll = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  const scrollKey = JSON.stringify(query);
  const [closing, setClosing] = useState(false);
  const [exit] = useState(
    () =>
      new ExitCoordinator({
        isBusy: () => useUI.getState().importBusy || useUI.getState().maintenanceBusy,
        hasPending: () => saves.hasPending() || positions.hasPending() || operations.hasPending(),
        flush: async () => {
          await Promise.all([saves.flushAll(), positions.flushAll(), operations.flushAll()]);
        },
        exit: () => backend.exitApplication(),
        onClosing: setClosing,
        onBlocked: () => toast.info('Devam eden dosya işleminin tamamlanmasını bekleyin.'),
        onError: (error) => toast.error(`Kapatmadan önce kaydedilemedi: ${errorMessage(error)}`),
      }),
  );
  useEffect(() => {
    if (!closing) return;
    const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));
    dialogs.forEach((element) => {
      element.inert = true;
    });
    return () =>
      dialogs.forEach((element) => {
        element.inert = false;
      });
  }, [closing]);
  const catalogQuery = useQuery({ queryKey: ['catalog'], queryFn: () => backend.getCatalog() });
  const catalog = catalogQuery.data;
  const pageQuery = useQuery({
    queryKey: ['library', query],
    queryFn: () => backend.queryLibrary(query),
    placeholderData: keepPreviousData,
  });
  const items = (pageQuery.data?.items ?? []).map((item) => ({
    ...item,
    ...saves.get(item.id)?.patch,
  }));
  const total = pageQuery.data?.total ?? 0;
  useLayoutEffect(() => {
    if (!pageQuery.isPlaceholderData && listScroll.current)
      listScroll.current.scrollTop = scrollPositions.current.get(scrollKey) ?? 0;
  }, [scrollKey, pageQuery.isPlaceholderData]);
  useEffect(() => {
    if (
      !pageQuery.isPlaceholderData &&
      !pageQuery.isPending &&
      !pageQuery.isError &&
      query.offset >= total &&
      query.offset > 0
    )
      setQuery({ offset: Math.max(0, Math.ceil(total / query.limit) - 1) * query.limit });
  }, [
    total,
    query.offset,
    query.limit,
    pageQuery.isPlaceholderData,
    pageQuery.isPending,
    pageQuery.isError,
    setQuery,
  ]);
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (useUI.getState().query.q !== searchText) setQuery({ q: searchText });
    }, 200);
    return () => clearTimeout(timeout);
  }, [searchText, setQuery]);
  const safely = useCallback(
    async (action: () => void) => {
      if (exit.isClosing()) return;
      try {
        await Promise.all([saves.flushAll(), positions.flushAll(), operations.flushAll()]);
        action();
      } catch (error) {
        toast.error(`Değişikliklerin kaydedilemedi. ${errorMessage(error)}`);
      }
    },
    [exit],
  );
  const navigate = useCallback(
    (view: LibraryView, categoryIds: string[] = []) => {
      void safely(() => {
        setQuery({ ...defaultQuery, view, categoryIds });
        setSearchText('');
        select(null);
        setSidebar(false);
      });
    },
    [safely, setQuery, select, setSidebar],
  );
  const showItem = useCallback(
    (id: string) => {
      void safely(() => {
        select(id);
        anchor.current = id;
      });
    },
    [safely, select],
  );
  const addSource = useCallback(() => {
    void safely(() => setImporter({}));
  }, [safely]);
  const openFile = useCallback(
    (file: Attachment, item: Item) => {
      void safely(() => {
        if (file.format === 'pdf') setReader({ file, item });
        else
          void backend.openAttachment(file.id).catch((error) => toast.error(errorMessage(error)));
      });
    },
    [safely],
  );
  const openPrimary = useCallback(
    (item: Item) => {
      const file = item.attachments.find((a) => a.format === 'pdf') ?? item.attachments[0];
      if (file) openFile(file, item);
      else {
        showItem(item.id);
        toast.info('Bu kaynağa henüz dosya eklenmemiş.');
      }
    },
    [openFile, showItem],
  );
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      if (event.defaultPrevented || exit.isClosing()) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInput.current?.focus();
        searchInput.current?.select();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (!document.querySelector('[role="dialog"]')) addSource();
      }
      if (
        event.key === 'Escape' &&
        !document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]')
      ) {
        void safely(() => select(null));
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        saves.hasPending() ||
        positions.hasPending() ||
        operations.hasPending() ||
        useUI.getState().importBusy ||
        useUI.getState().maintenanceBusy
      ) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('keydown', handle);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('keydown', handle);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [addSource, safely, select, exit]);
  useEffect(() => {
    if (!isDesktop) return;
    const close = getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      void exit.request();
    });
    const quit = listen('folio-close-requested', () => void exit.request());
    const drop = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === 'over') setDragging(true);
      if (event.payload.type === 'leave') setDragging(false);
      if (event.payload.type === 'drop') {
        setDragging(false);
        if (!exit.isClosing() && !useUI.getState().importBusy && !useUI.getState().maintenanceBusy)
          void safely(() =>
            setImporter((current) => ({
              ...current,
              files: event.payload.type === 'drop' ? event.payload.paths : [],
            })),
          );
      }
    });
    return () => {
      void close.then((unlisten) => unlisten());
      void quit.then((unlisten) => unlisten());
      void drop.then((unlisten) => unlisten());
    };
  }, [safely, exit]);
  async function selectRow(item: Item, event: React.MouseEvent) {
    await safely(() => {
      if (event.shiftKey && anchor.current) {
        const first = items.findIndex((i) => i.id === anchor.current);
        const last = items.findIndex((i) => i.id === item.id);
        select(
          item.id,
          first < 0
            ? [item.id]
            : items.slice(Math.min(first, last), Math.max(first, last) + 1).map((i) => i.id),
        );
      } else if (event.metaKey || event.ctrlKey) {
        const currentIds = useUI.getState().selectedIds;
        const ids = currentIds.includes(item.id)
          ? currentIds.filter((id) => id !== item.id)
          : [...currentIds, item.id];
        select(item.id, ids);
        anchor.current = item.id;
      } else {
        select(item.id);
        anchor.current = item.id;
      }
    });
  }
  async function bulk(change: Omit<BulkChange, 'itemIds'>) {
    setBulkBusy(true);
    try {
      await saves.flushAll();
      await backend.bulkUpdate({ itemIds: selectedIds, ...change });
      await refreshLibrary();
      toast.success(`${selectedIds.length} kaynak güncellendi.`);
      if (change.trashed !== undefined) select(null);
      setBulkTag('');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBulkBusy(false);
    }
  }
  async function demo() {
    try {
      const { loadDemoLibrary } = await import('@/lib/preview-backend');
      const id = await loadDemoLibrary();
      await refreshLibrary();
      select(id);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }
  const hasFilter = !!(
    query.q ||
    query.categoryIds.length ||
    query.tagIds.length ||
    query.kind ||
    query.format ||
    query.readingStatus
  );
  const categoryName =
    query.categoryIds.length === 1
      ? catalog?.categories.find((c) => c.id === query.categoryIds[0])?.name
      : undefined;
  return (
    <>
      <div
        inert={closing}
        className={cn('app-shell', desktopSidebarCollapsed && 'desktop-nav-collapsed')}
        style={{ '--inspector-width': `${inspectorWidth}px` } as CSSProperties}
        onDragOver={(event) => {
          if (!isDesktop && event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            if (!importer) setDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.relatedTarget) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!isDesktop && !importer && event.dataTransfer.files.length)
            void safely(() => setImporter({ files: Array.from(event.dataTransfer.files) }));
        }}
      >
        <Sidebar
          catalog={catalog}
          navigate={navigate}
          onCategory={(category, initialParentId) =>
            void safely(() => setCategoryDialog({ category, initialParentId }))
          }
          onSettings={() => setSettings(true)}
          onTags={() => void safely(() => setTagsDialog(true))}
          navigateTag={(id) =>
            void safely(() => {
              setQuery({ ...defaultQuery, tagIds: [id] });
              setSearchText('');
              select(null);
              setSidebar(false);
            })
          }
        />
        <main className="main-workspace">
          <header className="workspace-header">
            <div className="breadcrumbs">
              <Button
                variant="ghost"
                size="icon"
                className="menu-toggle"
                aria-label="Gezinme panelini aç veya kapat"
                onClick={() =>
                  window.matchMedia('(max-width: 850px)').matches
                    ? setSidebar(true)
                    : toggleDesktopSidebar()
                }
              >
                <Menu size={19} />
              </Button>
              <LibraryIcon size={15} />
              <span>Kişisel alan</span>
              <ChevronRight size={12} />
              <strong>{categoryName ?? viewTitles[query.view]}</strong>
            </div>
            <span className="offline-label">
              <span className="local-dot" />
              {isDesktop ? 'Çevrimdışı kullanıma hazır' : 'Yerel önizleme'}
            </span>
          </header>
          <div className="page-heading">
            <div>
              <div className="eyebrow">KİŞİSEL KAYNAK KÜTÜPHANESİ</div>
              <h1>{categoryName ?? viewTitles[query.view]}</h1>
              <p>
                {query.view === 'trash'
                  ? 'Kaynaklarını notları ve dosyalarıyla birlikte geri getirebilirsin.'
                  : `${catalog?.stats.total ?? 0} kaynak · Kitaplar, makaleler ve notların`}
              </p>
            </div>
            {query.view === 'trash' ? (
              <Button
                variant="outline"
                disabled={!catalog?.stats.trash}
                onClick={() => setTrashDialog(true)}
              >
                <Trash2 size={17} />
                Çöpü boşalt
              </Button>
            ) : (
              <Button onClick={addSource}>
                <Plus size={17} />
                Kaynak ekle
              </Button>
            )}
          </div>
          <div className="library-body">
            <section className="library-main" aria-label="Kaynak listesi">
              <div className="search-toolbar">
                <div className="search-box">
                  <Search size={18} />
                  <input
                    ref={searchInput}
                    aria-label="Kütüphanede ara"
                    maxLength={1000}
                    placeholder="Başlık, yazar, etiket veya notlarda ara…"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                  />
                  {searchText ? (
                    <button aria-label="Aramayı temizle" onClick={() => setSearchText('')}>
                      <X size={15} />
                    </button>
                  ) : (
                    <kbd>⌘ / Ctrl K</kbd>
                  )}
                </div>
              </div>
              <div className="list-toolbar">
                <ReadingTabs />
                <Filters catalog={catalog} />
              </div>
              <ActiveFilters catalog={catalog} onClearSearch={() => setSearchText('')} />
              {selectedIds.length > 1 && (
                <div className="bulk-toolbar">
                  <span>{selectedIds.length} seçili</span>
                  <Popover
                    trigger={
                      <Button variant="ghost" size="sm" disabled={bulkBusy}>
                        <FolderPlus size={14} />
                        Kategori
                      </Button>
                    }
                  >
                    <span className="picker-heading">Mevcut kategorilere ekle</span>
                    <div className="picker-options">
                      {catalog?.categories.map((c) => (
                        <button
                          className="picker-option"
                          key={c.id}
                          onClick={() => void bulk({ categoryIds: [c.id] })}
                          disabled={bulkBusy}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                  </Popover>
                  <Popover
                    trigger={
                      <Button variant="ghost" size="sm" disabled={bulkBusy}>
                        <Tag size={14} />
                        Etiket
                      </Button>
                    }
                  >
                    <form
                      className="form-stack"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (bulkTag.trim()) void bulk({ tagNames: [bulkTag.trim()] });
                      }}
                    >
                      <label className="field-label">
                        Seçili kaynaklara etiket ekle
                        <input
                          value={bulkTag}
                          maxLength={80}
                          required
                          onChange={(e) => setBulkTag(e.target.value)}
                        />
                      </label>
                      <Button size="sm" disabled={bulkBusy}>
                        Etiketi ekle
                      </Button>
                    </form>
                  </Popover>
                  <select
                    aria-label="Seçilen kaynakların okuma durumu"
                    value=""
                    disabled={bulkBusy}
                    onChange={(event) => {
                      if (event.target.value)
                        void bulk({ readingStatus: event.target.value as Item['readingStatus'] });
                    }}
                  >
                    <option value="" disabled>
                      Okuma durumu
                    </option>
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={
                      query.view === 'trash' ? 'Seçilenleri geri getir' : 'Seçilenleri çöpe taşı'
                    }
                    disabled={bulkBusy}
                    onClick={() => void bulk({ trashed: query.view !== 'trash' })}
                  >
                    {query.view === 'trash' ? <RotateCcw size={14} /> : <Trash2 size={14} />}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Seçimi temizle"
                    onClick={() => select(selectedId, [])}
                  >
                    <X size={14} />
                  </Button>
                </div>
              )}
              <div className="results-heading">
                <span>
                  {pageQuery.isFetching && !pageQuery.isPending
                    ? 'Güncelleniyor…'
                    : `${total} kaynak`}
                </span>
                <label>
                  <ArrowDownWideNarrow size={14} />
                  <select
                    aria-label="Kaynakları sırala"
                    value={query.sort}
                    onChange={(e) => setQuery({ sort: e.target.value as typeof query.sort })}
                  >
                    <option value="recent">{query.q ? 'Uygunluğa göre' : 'Son eklenen'}</option>
                    <option value="title">Başlık A–Z</option>
                    <option value="year">Yayın yılı</option>
                  </select>
                </label>
              </div>
              <div
                className="list-scroll"
                ref={listScroll}
                aria-busy={pageQuery.isFetching}
                onScroll={(event) => {
                  scrollPositions.current.set(scrollKey, event.currentTarget.scrollTop);
                  if (scrollPositions.current.size > 50)
                    scrollPositions.current.delete(scrollPositions.current.keys().next().value!);
                }}
              >
                {pageQuery.error || catalogQuery.error ? (
                  <div className="inline-error" role="alert">
                    <AlertCircle size={30} />
                    <h3>Kütüphane yüklenemedi</h3>
                    <p>{errorMessage(pageQuery.error ?? catalogQuery.error)}</p>
                    <Button
                      variant="outline"
                      onClick={() => {
                        void pageQuery.refetch();
                        void catalogQuery.refetch();
                      }}
                    >
                      Yeniden dene
                    </Button>
                  </div>
                ) : pageQuery.isPending ? (
                  <div className="loading-state">
                    <LoaderCircle className="spin" size={23} />
                    <span>Kütüphane açılıyor…</span>
                  </div>
                ) : !items.length ? (
                  <div className="empty-library">
                    <div className="empty-books">
                      <span />
                      <span />
                      <span />
                      <BookOpen size={31} strokeWidth={1.2} />
                    </div>
                    <span className="eyebrow">
                      {hasFilter
                        ? 'ARAMA SONUÇLARI'
                        : query.view === 'trash'
                          ? 'ÇÖP KUTUSU'
                          : 'İLK SAYFA SENİN'}
                    </span>
                    <h2>
                      {hasFilter
                        ? 'Henüz bir eşleşme yok'
                        : query.view === 'trash'
                          ? 'Çöp kutusu boş'
                          : query.view === 'all'
                            ? 'Kütüphanene hoş geldin'
                            : 'Burada henüz kaynak yok'}
                    </h2>
                    <p>
                      {hasFilter
                        ? 'Başka bir sözcük deneyebilir veya filtrelerini kaldırabilirsin.'
                        : query.view === 'trash'
                          ? 'Çöpe taşıdığın kaynaklar burada görünür.'
                          : 'İlk kitabını veya makaleni ekle. Kategorilerini, etiketlerini ve notlarını bir arada tut.'}
                    </p>
                    {hasFilter ? (
                      <Button
                        variant="outline"
                        onClick={() => {
                          setQuery({ ...defaultQuery, view: query.view });
                          setSearchText('');
                        }}
                      >
                        Aramayı ve filtreleri temizle
                      </Button>
                    ) : (
                      query.view !== 'trash' && (
                        <Button onClick={addSource}>
                          <Plus size={17} />
                          İlk kaynağını ekle
                        </Button>
                      )
                    )}
                    {!isDesktop && !catalog?.stats.total && query.view === 'all' && !hasFilter && (
                      <button className="demo-link" onClick={() => void demo()}>
                        <Sparkles size={13} />
                        Örnek kütüphaneyi incele
                      </button>
                    )}
                  </div>
                ) : (
                  <table className="resource-table">
                    <thead>
                      <tr>
                        <th className="selection-column">
                          <input
                            type="checkbox"
                            aria-label="Bu sayfadaki tüm kaynakları seç"
                            checked={
                              items.length > 0 && items.every((i) => selectedIds.includes(i.id))
                            }
                            onChange={(e) => {
                              const checked = e.target.checked;
                              void safely(() =>
                                select(selectedId, checked ? items.map((i) => i.id) : []),
                              );
                            }}
                          />
                        </th>
                        <th>Kaynak</th>
                        <th className="status-column">Okuma durumu</th>
                        <th className="format-column">Biçim</th>
                        <th>
                          <span className="sr-only">Favori</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr
                          key={item.id}
                          className={cn(
                            selectedIds.includes(item.id) && 'selected',
                            selectedId === item.id && 'current',
                          )}
                          tabIndex={0}
                          aria-selected={selectedIds.includes(item.id)}
                          onClick={(e) => void selectRow(item, e)}
                          onDoubleClick={() => openPrimary(item)}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              openPrimary(item);
                            }
                            if (e.key === ' ') {
                              e.preventDefault();
                              showItem(item.id);
                            }
                            if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                            }
                            if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              (
                                e.currentTarget.previousElementSibling as HTMLElement | null
                              )?.focus();
                            }
                          }}
                        >
                          <td
                            className="selection-column"
                            onClick={(e) => e.stopPropagation()}
                            onDoubleClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              aria-label={`${item.title} kaynağını seç`}
                              checked={selectedIds.includes(item.id)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                void safely(() =>
                                  select(
                                    item.id,
                                    checked
                                      ? [...new Set([...useUI.getState().selectedIds, item.id])]
                                      : useUI.getState().selectedIds.filter((id) => id !== item.id),
                                  ),
                                );
                              }}
                            />
                          </td>
                          <td>
                            <div className="resource-cell">
                              <div className={`document-thumbnail ${item.kind}`}>
                                <FileText size={17} strokeWidth={1.4} />
                                <span>
                                  {item.attachments[0]?.format.toUpperCase() ??
                                    (item.kind === 'article' ? 'MAKALE' : 'KAYNAK')}
                                </span>
                              </div>
                              <div className="resource-text">
                                <strong>{item.title}</strong>
                                <div className="resource-meta">
                                  <span>{item.authors.join(', ') || 'Yazar eklenmedi'}</span>
                                  <span>·</span>
                                  <span>{item.year ?? kindLabels[item.kind]}</span>
                                </div>
                                <div className="row-tags">
                                  {catalog?.tags
                                    .filter((t) => item.tagIds.includes(t.id))
                                    .slice(0, 2)
                                    .map((tag) => (
                                      <span key={tag.id}>{tag.name}</span>
                                    ))}
                                  {item.tagIds.length > 2 && <span>+{item.tagIds.length - 2}</span>}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="status-column">
                            <span className={`reading-status ${item.readingStatus}`}>
                              <span className="status-indicator">
                                {item.readingStatus === 'read' && <Check size={9} />}
                              </span>
                              {statusLabels[item.readingStatus]}
                            </span>
                          </td>
                          <td className="format-column">
                            <span className="file-format">
                              {item.attachments.length
                                ? [
                                    ...new Set(item.attachments.map((a) => a.format.toUpperCase())),
                                  ].join(' · ')
                                : '—'}
                            </span>
                          </td>
                          <td onDoubleClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={`${item.title}: ${item.isFavorite ? 'favorilerden çıkar' : 'favorilere ekle'}`}
                              aria-pressed={item.isFavorite}
                              className={cn('row-star', item.isFavorite && 'is-favorite')}
                              onClick={(e) => {
                                e.stopPropagation();
                                saves.queue(item.id, { isFavorite: !item.isFavorite });
                              }}
                            >
                              <Star size={15} fill={item.isFavorite ? 'currentColor' : 'none'} />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <footer className="list-footer">
                <span>
                  <CornerDownLeft size={13} />
                  Dosyayı aç <span className="footer-separator">·</span>
                  <span className="selection-hint">Ctrl / ⌘ ile çoklu seçim</span>
                </span>
                <div>
                  {total > query.limit && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Önceki sonuç sayfası"
                        disabled={query.offset === 0}
                        onClick={() =>
                          setQuery({ offset: Math.max(0, query.offset - query.limit) })
                        }
                      >
                        <ChevronLeft size={15} />
                      </Button>
                      <span>
                        {query.offset + 1}–{Math.min(query.offset + query.limit, total)}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Sonraki sonuç sayfası"
                        disabled={query.offset + query.limit >= total}
                        onClick={() => setQuery({ offset: query.offset + query.limit })}
                      >
                        <ChevronRight size={15} />
                      </Button>
                    </>
                  )}
                  <span className="footer-view">Liste görünümü</span>
                </div>
              </footer>
            </section>
            {selectedId && <InspectorResize />}
            {selectedId ? (
              <Inspector
                id={selectedId}
                catalog={catalog}
                onClose={() => void safely(() => select(null))}
                onOpenFile={openFile}
                onAttach={(id) => void safely(() => setImporter({ targetId: id }))}
              />
            ) : (
              <EmptyInspector />
            )}
          </div>
        </main>
        {dragging && (
          <div className="global-drop">
            <FileText size={42} />
            <h2>Kütüphanene eklemek için bırak</h2>
            <p>Dosyalarının özgün kopyaları korunur.</p>
          </div>
        )}
        {importer && (
          <ImportDialog
            key={importer.targetId ?? 'new'}
            targetId={importer.targetId}
            initialFiles={importer.files}
            onClose={() => setImporter(null)}
            onSelect={showItem}
          />
        )}
        {categoryDialog && (
          <CategoryDialog
            categories={catalog?.categories ?? []}
            category={categoryDialog.category}
            initialParentId={categoryDialog.initialParentId}
            onClose={() => setCategoryDialog(null)}
          />
        )}
        {settings && <SettingsDialog onClose={() => setSettings(false)} />}
        {trashDialog && (
          <TrashDialog count={catalog?.stats.trash ?? 0} onClose={() => setTrashDialog(false)} />
        )}
        {tagsDialog && (
          <TagsDialog tags={catalog?.tags ?? []} onClose={() => setTagsDialog(false)} />
        )}
        {reader && (
          <Suspense
            fallback={
              <div className="reader-loading-overlay">
                <LoaderCircle size={24} className="spin" />
                <span>Okuyucu açılıyor…</span>
              </div>
            }
          >
            <PdfReader
              file={reader.file}
              item={reader.item}
              onClose={() =>
                void safely(() => {
                  setReader(null);
                  void refreshLibrary();
                })
              }
            />
          </Suspense>
        )}
      </div>
      {closing && (
        <div className="closing-overlay" role="status">
          <LoaderCircle className="spin" size={22} />
          Değişiklikler kaydediliyor, Folio kapatılıyor…
        </div>
      )}
    </>
  );
}
