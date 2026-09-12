import { useState } from 'react';
import { SlidersHorizontal, X, Check, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { useUI } from '@/lib/ui-store';
import { normalize } from '@/lib/utils';
import { categoryPath, categoryTree } from '@/features/categories/category-tree';
import '../taxonomy.css';
import { kindLabels, statusLabels, supportedFormats, type Catalog, type Kind } from '@/lib/types';

export function Filters({ catalog }: { catalog?: Catalog }) {
  const { query, setQuery } = useUI();
  const [categorySearch, setCategorySearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const categoryOptions = categoryTree(catalog?.categories ?? []).filter(({ category }) =>
    normalize(categoryPath(catalog?.categories ?? [], category.id)).includes(
      normalize(categorySearch),
    ),
  );
  const tagOptions = (catalog?.tags ?? []).filter((tag) =>
    normalize(tag.name).includes(normalize(tagSearch)),
  );
  const count =
    query.categoryIds.length +
    query.tagIds.length +
    Number(!!query.kind) +
    Number(!!query.format) +
    Number(!!query.readingStatus);
  return (
    <Popover
      align="end"
      trigger={
        <Button variant="outline" size="sm">
          <SlidersHorizontal size={15} />
          Filtreler{count > 0 && <span className="filter-count">{count}</span>}
        </Button>
      }
      className="filters-popover"
    >
      <div className="popover-heading">
        <strong>Kaynakları filtrele</strong>
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            setQuery({
              categoryIds: [],
              tagIds: [],
              kind: '',
              format: '',
              readingStatus: '',
              tagMode: 'all',
              includeDescendants: true,
            })
          }
        >
          Temizle
        </Button>
      </div>
      <div className="filter-columns">
        <label className="field-label">
          Kaynak türü
          <select
            value={query.kind}
            onChange={(e) => setQuery({ kind: e.target.value as Kind | '' })}
          >
            <option value="">Tüm türler</option>
            {Object.entries(kindLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Dosya biçimi
          <select value={query.format} onChange={(e) => setQuery({ format: e.target.value })}>
            <option value="">Tüm biçimler</option>
            {supportedFormats.map((format) => (
              <option key={format} value={format}>
                {format.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="taxonomy-filter-group-heading">
        <span className="field-label">
          Kategoriler <small>Herhangi biri</small>
        </span>
        {!!query.categoryIds.length && (
          <Button size="sm" variant="ghost" onClick={() => setQuery({ categoryIds: [] })}>
            Temizle
          </Button>
        )}
      </div>
      <label className="picker-search taxonomy-filter-search">
        <Search size={13} />
        <input
          value={categorySearch}
          onChange={(event) => setCategorySearch(event.target.value)}
          placeholder="Kategori ara"
          aria-label="Filtrelerde kategori ara"
        />
      </label>
      <div className="filter-options">
        {categoryOptions.map(({ category: c }) => (
          <label key={c.id} className="check-option">
            <input
              type="checkbox"
              checked={query.categoryIds.includes(c.id)}
              onChange={(e) =>
                setQuery({
                  categoryIds: e.target.checked
                    ? [...query.categoryIds, c.id]
                    : query.categoryIds.filter((id) => id !== c.id),
                })
              }
            />
            <span>{categoryPath(catalog?.categories ?? [], c.id)}</span>
          </label>
        ))}
        {!categoryOptions.length && (
          <p className="muted">{categorySearch ? 'Kategori bulunamadı.' : 'Henüz kategori yok.'}</p>
        )}
      </div>
      <label className="check-option">
        <input
          type="checkbox"
          checked={query.includeDescendants}
          onChange={(e) => setQuery({ includeDescendants: e.target.checked })}
        />
        Alt kategorileri dahil et
      </label>
      <div className="filter-label-row">
        <span className="field-label">Etiketler</span>
        <select
          aria-label="Etiket eşleştirme"
          value={query.tagMode}
          onChange={(e) => setQuery({ tagMode: e.target.value as 'all' | 'any' })}
        >
          <option value="all">Tümü eşleşsin</option>
          <option value="any">Herhangi biri</option>
        </select>
      </div>
      <label className="picker-search taxonomy-filter-search">
        <Search size={13} />
        <input
          value={tagSearch}
          onChange={(event) => setTagSearch(event.target.value)}
          placeholder="Etiket ara"
          aria-label="Filtrelerde etiket ara"
        />
      </label>
      <div className="filter-options">
        {tagOptions.map((tag) => (
          <label key={tag.id} className="check-option">
            <input
              type="checkbox"
              checked={query.tagIds.includes(tag.id)}
              onChange={(e) =>
                setQuery({
                  tagIds: e.target.checked
                    ? [...query.tagIds, tag.id]
                    : query.tagIds.filter((id) => id !== tag.id),
                })
              }
            />
            <span>{tag.name}</span>
          </label>
        ))}
        {!tagOptions.length && (
          <p className="muted">{tagSearch ? 'Etiket bulunamadı.' : 'Henüz etiket yok.'}</p>
        )}
      </div>
      {!!query.tagIds.length && (
        <Button size="sm" variant="ghost" onClick={() => setQuery({ tagIds: [] })}>
          Etiket seçimlerini temizle
        </Button>
      )}
    </Popover>
  );
}

export function ActiveFilters({
  catalog,
  onClearSearch,
}: {
  catalog?: Catalog;
  onClearSearch?: () => void;
}) {
  const { query, setQuery } = useUI();
  const chips = [
    ...(query.q
      ? [
          {
            key: 'search',
            label: `Arama: ${query.q}`,
            remove: () => {
              setQuery({ q: '' });
              onClearSearch?.();
            },
          },
        ]
      : []),
    ...(query.readingStatus
      ? [
          {
            key: 'reading-status',
            label: statusLabels[query.readingStatus],
            remove: () => setQuery({ readingStatus: '' }),
          },
        ]
      : []),
    ...query.categoryIds.map((id) => ({
      key: `category-${id}`,
      label: categoryPath(catalog?.categories ?? [], id) || 'Silinmiş kategori',
      remove: () => setQuery({ categoryIds: query.categoryIds.filter((value) => value !== id) }),
    })),
    ...query.tagIds.map((id) => ({
      key: `tag-${id}`,
      label: `# ${catalog?.tags.find((t) => t.id === id)?.name ?? 'Silinmiş etiket'}`,
      remove: () => setQuery({ tagIds: query.tagIds.filter((value) => value !== id) }),
    })),
    ...(query.kind
      ? [{ key: 'kind', label: kindLabels[query.kind], remove: () => setQuery({ kind: '' }) }]
      : []),
    ...(query.format
      ? [
          {
            key: 'format',
            label: query.format.toUpperCase(),
            remove: () => setQuery({ format: '' }),
          },
        ]
      : []),
  ];
  if (!chips.length) return null;
  return (
    <div className="active-filters">
      {chips.map((chip) => (
        <button
          className="filter-chip"
          key={chip.key}
          onClick={chip.remove}
          aria-label={`${chip.label} filtresini kaldır`}
        >
          {chip.label}
          <X size={12} />
        </button>
      ))}
      {query.tagIds.length > 1 && (
        <span className="taxonomy-filter-mode">
          {query.tagMode === 'all' ? 'Etiketlerin tümü' : 'Etiketlerden biri'}
        </span>
      )}
      {!!query.categoryIds.length && (
        <span className="taxonomy-filter-mode">
          {query.includeDescendants ? 'Alt kategoriler dahil' : 'Alt kategoriler hariç'}
        </span>
      )}
      <button
        className="taxonomy-active-clear"
        onClick={() => {
          setQuery({
            q: '',
            categoryIds: [],
            tagIds: [],
            kind: '',
            format: '',
            readingStatus: '',
            tagMode: 'all',
            includeDescendants: true,
          });
          onClearSearch?.();
        }}
      >
        Tümünü temizle
      </button>
    </div>
  );
}

export function ReadingTabs() {
  const { query, setQuery } = useUI();
  return (
    <div className="reading-tabs" role="group" aria-label="Okuma durumu filtresi">
      <button
        aria-pressed={!query.readingStatus}
        className={!query.readingStatus ? 'active' : ''}
        onClick={() => setQuery({ readingStatus: '' })}
      >
        Tümü
      </button>
      {Object.entries(statusLabels).map(([value, label]) => (
        <button
          key={value}
          aria-pressed={query.readingStatus === value}
          className={query.readingStatus === value ? 'active' : ''}
          onClick={() => setQuery({ readingStatus: value as keyof typeof statusLabels })}
        >
          {value === 'read' && <Check size={12} />}
          {label}
        </button>
      ))}
    </div>
  );
}
