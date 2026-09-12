import { useId, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
  BookOpen,
  Library,
  Clock3,
  Star,
  Bookmark,
  Folder,
  FolderOpen,
  Trash2,
  Plus,
  Settings2,
  HardDrive,
  Pencil,
  ChevronRight,
  X,
  Hash,
  Search,
  ChevronDown,
  SlidersHorizontal,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Catalog, Category, LibraryView } from '@/lib/types';
import { useUI } from '@/lib/ui-store';
import { isDesktop } from '@/lib/backend';
import { cn, normalize } from '@/lib/utils';
import { categoryPath, categoryTree } from '@/features/categories/category-tree';
import '../taxonomy.css';

export function Sidebar({
  catalog,
  navigate,
  onCategory,
  onSettings,
  onTags,
  navigateTag,
}: {
  catalog?: Catalog;
  navigate: (view: LibraryView, categoryIds?: string[]) => void;
  onCategory: (category?: Category, initialParentId?: string) => void;
  onTags?: () => void;
  navigateTag?: (id: string) => void;
  onSettings: () => void;
}) {
  const { query, sidebarOpen, setSidebar } = useUI();
  const [categorySearch, setCategorySearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [section, setSection] = useState<'categories' | 'tags'>(() =>
    query.tagIds.length && !query.categoryIds.length ? 'tags' : 'categories',
  );
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const stats = catalog?.stats;
  const categories = catalog?.categories ?? [];
  const parents = new Set(categories.map((category) => category.parentId).filter(Boolean));
  const matchingCategories = categoryTree(categories).filter(({ category }) => {
    if (categorySearch)
      return normalize(categoryPath(categories, category.id)).includes(normalize(categorySearch));
    let parent = category.parentId;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      if (collapsed.has(parent)) return false;
      seen.add(parent);
      parent = categories.find((entry) => entry.id === parent)?.parentId ?? null;
    }
    return true;
  });
  const matchingTags = (catalog?.tags ?? [])
    .filter((tag) => normalize(tag.name).includes(normalize(tagSearch)))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  function toggleCategory(id: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const nav = [
    { id: 'all', label: 'Tüm kaynaklar', icon: Library, count: stats?.total },
    { id: 'recent', label: 'Son eklenenler', icon: Clock3, count: undefined },
    { id: 'favorites', label: 'Favoriler', icon: Star, count: stats?.favorites },
    {
      id: 'reading-list',
      label: 'Okuma listesi',
      icon: Bookmark,
      count: stats ? stats.unread + stats.reading : undefined,
    },
    { id: 'uncategorized', label: 'Kategorisiz', icon: FolderOpen, count: stats?.uncategorized },
  ] as const;

  return (
    <>
      {sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Gezinmeyi kapat"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside
        className={cn('sidebar', sidebarOpen && 'sidebar-open')}
        aria-label="Kütüphane gezinmesi"
      >
        <div className="brand">
          <img src="/folio.svg" alt="" />
          <span>
            folio<span className="brand-dot">.</span>
          </span>
          <Button
            className="sidebar-close"
            variant="ghost"
            size="icon"
            aria-label="Gezinmeyi kapat"
            onClick={() => setSidebar(false)}
          >
            <X size={18} />
          </Button>
        </div>
        <nav className="main-navigation" aria-label="Kütüphane görünümleri">
          {nav.map(({ id, label, icon: Icon, count }) => (
            <button
              key={id}
              className={cn(
                'nav-link',
                query.view === id && !query.categoryIds.length && !query.tagIds.length && 'active',
              )}
              aria-current={
                query.view === id && !query.categoryIds.length && !query.tagIds.length
                  ? 'page'
                  : undefined
              }
              onClick={() => navigate(id)}
            >
              <Icon size={17} />
              <span>{label}</span>
              {count != null && <span className="nav-count">{count}</span>}
            </button>
          ))}
        </nav>
        <section className="taxonomy-browser" aria-label="Kategoriler ve etiketler">
          <div className="taxonomy-browser-toolbar">
            <div className="taxonomy-tabs" role="tablist" aria-label="Kütüphaneyi düzenle">
              {(['categories', 'tags'] as const).map((tab, index) => (
                <button
                  key={tab}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  type="button"
                  role="tab"
                  id={`${tabsId}-${tab}-tab`}
                  aria-controls={`${tabsId}-${tab}-panel`}
                  aria-selected={section === tab}
                  tabIndex={section === tab ? 0 : -1}
                  onClick={() => setSection(tab)}
                  onKeyDown={(event) => {
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? 1
                          : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
                            ? 1 - index
                            : null;
                    if (next === null) return;
                    event.preventDefault();
                    setSection(next === 0 ? 'categories' : 'tags');
                    tabRefs.current[next]?.focus();
                  }}
                >
                  {tab === 'categories' ? 'Kategoriler' : 'Etiketler'}
                  <span>
                    {tab === 'categories' ? categories.length : (catalog?.tags.length ?? 0)}
                  </span>
                </button>
              ))}
            </div>
            {section === 'categories' ? (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Kategori oluştur"
                onClick={() => onCategory()}
              >
                <Plus size={16} />
              </Button>
            ) : onTags ? (
              <Button size="icon" variant="ghost" aria-label="Etiketleri yönet" onClick={onTags}>
                <SlidersHorizontal size={16} />
              </Button>
            ) : null}
          </div>
          <div
            className="taxonomy-panel"
            role="tabpanel"
            id={`${tabsId}-categories-panel`}
            aria-labelledby={`${tabsId}-categories-tab`}
            hidden={section !== 'categories'}
          >
            <label className="taxonomy-nav-search">
              <Search size={15} />
              <input
                value={categorySearch}
                onChange={(event) => setCategorySearch(event.target.value)}
                aria-label="Kategorilerde ara"
                placeholder="Kategori ara…"
              />
              {categorySearch && (
                <button
                  type="button"
                  aria-label="Kategori aramasını temizle"
                  onClick={() => setCategorySearch('')}
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <nav className="category-navigation" aria-label="Kategoriler" tabIndex={0}>
              {matchingCategories.map(({ category, depth }) => (
                <div
                  key={category.id}
                  className={cn(
                    'category-nav-row',
                    query.categoryIds.includes(category.id) && 'active',
                  )}
                  style={{ paddingLeft: 8 + Math.min(depth, 4) * 12 }}
                >
                  {parents.has(category.id) ? (
                    <button
                      className="taxonomy-tree-toggle"
                      aria-label={`${category.name} alt kategorilerini ${collapsed.has(category.id) ? 'göster' : 'gizle'}`}
                      aria-expanded={!collapsed.has(category.id)}
                      onClick={() => toggleCategory(category.id)}
                    >
                      {collapsed.has(category.id) ? (
                        <ChevronRight size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      )}
                    </button>
                  ) : parents.size ? (
                    <span className="taxonomy-tree-spacer" />
                  ) : null}
                  <button
                    onClick={() => navigate('all', [category.id])}
                    className="category-link"
                    title={categoryPath(categories, category.id)}
                    aria-current={query.categoryIds.includes(category.id) ? 'page' : undefined}
                  >
                    <Folder size={15} />
                    <span>{category.name}</span>
                    <span className="nav-count">{category.count || ''}</span>
                  </button>
                  <CategoryActions category={category} onCategory={onCategory} />
                </div>
              ))}
              {!categories.length && (
                <button className="category-empty" onClick={() => onCategory()}>
                  <Plus size={14} />
                  İlk kategorini oluştur
                </button>
              )}
              {!!categories.length && !matchingCategories.length && (
                <p className="taxonomy-nav-empty">Kategori bulunamadı.</p>
              )}
            </nav>
          </div>
          <div
            className="taxonomy-panel"
            role="tabpanel"
            id={`${tabsId}-tags-panel`}
            aria-labelledby={`${tabsId}-tags-tab`}
            hidden={section !== 'tags'}
          >
            <label className="taxonomy-nav-search">
              <Search size={15} />
              <input
                value={tagSearch}
                onChange={(event) => setTagSearch(event.target.value)}
                aria-label="Gezinmede etiket ara"
                placeholder="Etiket ara…"
              />
              {tagSearch && (
                <button
                  type="button"
                  aria-label="Etiket aramasını temizle"
                  onClick={() => setTagSearch('')}
                >
                  <X size={14} />
                </button>
              )}
            </label>
            <nav className="taxonomy-tag-navigation" aria-label="Etiketler" tabIndex={0}>
              {matchingTags.map((tag) => (
                <button
                  key={tag.id}
                  className={cn('nav-link', query.tagIds.includes(tag.id) && 'active')}
                  aria-current={query.tagIds.includes(tag.id) ? 'page' : undefined}
                  title={tag.name}
                  onClick={() => navigateTag?.(tag.id)}
                >
                  <Hash size={15} />
                  <span>{tag.name}</span>
                  <span className="nav-count">{tag.count || ''}</span>
                </button>
              ))}
              {!matchingTags.length && (
                <p className="taxonomy-nav-empty">
                  {tagSearch
                    ? 'Etiket bulunamadı.'
                    : 'Kaynak ayrıntılarında etiket ekleyebilirsiniz.'}
                </p>
              )}
            </nav>
          </div>
        </section>
        <div className="sidebar-bottom">
          <div className="sidebar-utilities">
            <button
              className={cn('nav-link', query.view === 'trash' && 'active')}
              onClick={() => navigate('trash')}
            >
              <Trash2 size={17} />
              <span>Çöp</span>
              {!!stats?.trash && <span className="nav-count">{stats.trash}</span>}
            </button>
            <button className="nav-link" aria-label="Ayarlar ve yedekleme" onClick={onSettings}>
              <Settings2 size={17} />
              <span>Ayarlar</span>
            </button>
          </div>
          <div
            className="local-storage"
            title={
              isDesktop
                ? 'Dosyaların ve notların yalnızca bu bilgisayarda saklanır.'
                : 'Tarayıcı verisi masaüstü kütüphanesinden ayrıdır.'
            }
          >
            <HardDrive size={17} />
            <div>
              <span>{isDesktop ? 'Yerel kütüphane' : 'Tarayıcı önizlemesi'}</span>
            </div>
            <span className="local-dot" />
          </div>
        </div>
      </aside>
    </>
  );
}

function CategoryActions({
  category,
  onCategory,
}: {
  category: Category;
  onCategory: (category?: Category, initialParentId?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Let the category dialog own focus when an action opens it.
  const openingDialog = useRef(false);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(value) => {
        if (value) openingDialog.current = false;
        setOpen(value);
      }}
    >
      <Popover.Trigger asChild>
        <button
          className="category-actions-trigger"
          aria-label={`${category.name} kategori işlemleri`}
        >
          <MoreHorizontal size={16} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="popover category-actions-popover"
          align="end"
          sideOffset={5}
          aria-label={`${category.name} kategori işlemleri`}
          onCloseAutoFocus={(event) => {
            if (openingDialog.current) event.preventDefault();
          }}
        >
          <button
            onClick={() => {
              openingDialog.current = true;
              setOpen(false);
              onCategory(category);
            }}
          >
            <Pencil size={15} />
            Düzenle
          </button>
          <button
            onClick={() => {
              openingDialog.current = true;
              setOpen(false);
              onCategory(undefined, category.id);
            }}
          >
            <Plus size={15} />
            Alt kategori ekle
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function EmptyInspector() {
  return (
    <aside className="inspector inspector-empty">
      <div className="empty-inspector-drawing">
        <BookOpen size={35} strokeWidth={1.25} />
        <span />
        <span />
      </div>
      <h3>Ayrıntılar için bir kaynak seç</h3>
      <p>
        Bilgiler, kategoriler ve notların
        <br />
        burada bir arada.
      </p>
      <div className="shortcut-hint">
        <kbd>Enter</kbd>
        <ChevronRight size={12} />
        <span>Dosyayı aç</span>
      </div>
    </aside>
  );
}
