import { useState } from 'react';
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
  const [tagsOpen, setTagsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const stats = catalog?.stats;
  const categories = catalog?.categories ?? [];
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
        <div className="workspace-label">
          <span className="workspace-avatar">T</span>
          <span>
            Kişisel kütüphanem<small>Yalnızca bu bilgisayarda</small>
          </span>
        </div>
        <nav className="main-navigation">
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
        <div className="taxonomy-navigation-scroll">
          <div className="sidebar-section-heading">
            <span>KATEGORİLER</span>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Kategori oluştur"
              onClick={() => onCategory()}
            >
              <Plus size={16} />
            </Button>
          </div>
          {categories.length > 6 && (
            <label className="taxonomy-nav-search">
              <Search size={13} />
              <input
                value={categorySearch}
                onChange={(event) => setCategorySearch(event.target.value)}
                aria-label="Kategorilerde ara"
                placeholder="Kategori bul"
              />
            </label>
          )}
          <nav className="category-navigation" aria-label="Kategoriler">
            {matchingCategories.map(({ category, depth }) => (
              <div
                key={category.id}
                className={cn(
                  'category-nav-row',
                  query.categoryIds.includes(category.id) && 'active',
                )}
                style={{ paddingLeft: 5 + Math.min(depth, 6) * 12 }}
              >
                {categories.some((child) => child.parentId === category.id) ? (
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
                ) : (
                  <span className="taxonomy-tree-spacer" />
                )}
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
                <button
                  className="category-edit"
                  aria-label={`${category.name} altına kategori oluştur`}
                  onClick={() => onCategory(undefined, category.id)}
                >
                  <Plus size={12} />
                </button>
                <button
                  className="category-edit"
                  aria-label={`${category.name} kategorisini düzenle`}
                  onClick={() => onCategory(category)}
                >
                  <Pencil size={12} />
                </button>
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
          <div className="sidebar-section-heading taxonomy-tags-heading">
            <button
              className="taxonomy-section-toggle"
              aria-expanded={tagsOpen}
              onClick={() => setTagsOpen(!tagsOpen)}
            >
              {tagsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}ETİKETLER{' '}
              <span>{catalog?.tags.length || ''}</span>
            </button>
            {onTags && (
              <Button size="icon" variant="ghost" aria-label="Etiketleri yönet" onClick={onTags}>
                <SlidersHorizontal size={15} />
              </Button>
            )}
          </div>
          {tagsOpen && (
            <>
              <label className="taxonomy-nav-search">
                <Search size={13} />
                <input
                  value={tagSearch}
                  onChange={(event) => setTagSearch(event.target.value)}
                  aria-label="Gezinmede etiket ara"
                  placeholder="Etiket bul"
                />
              </label>
              <nav className="taxonomy-tag-navigation" aria-label="Etiketler">
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
            </>
          )}
        </div>
        <div className="sidebar-bottom">
          <button
            className={cn('nav-link', query.view === 'trash' && 'active')}
            onClick={() => navigate('trash')}
          >
            <Trash2 size={17} />
            <span>Çöp</span>
            {!!stats?.trash && <span className="nav-count">{stats.trash}</span>}
          </button>
          <button className="nav-link" onClick={onSettings}>
            <Settings2 size={17} />
            <span>Ayarlar ve yedekleme</span>
          </button>
          <div className="local-storage">
            <HardDrive size={17} />
            <div>
              <span>{isDesktop ? 'Yerel kütüphane' : 'Tarayıcı önizlemesi'}</span>
              <small>
                {isDesktop ? 'Dosyaların bu bilgisayarda' : 'Masaüstünden ayrı, yerel veri'}
              </small>
            </div>
            <span className="local-dot" />
          </div>
        </div>
      </aside>
    </>
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
