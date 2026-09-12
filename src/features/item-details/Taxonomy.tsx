import { useState } from 'react';
import { Plus, X, Check, Search, Folder, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover } from '@/components/ui/popover';
import { backend } from '@/lib/backend';
import { refreshLibrary } from '@/lib/query-client';
import { errorMessage, normalize } from '@/lib/utils';
import type { Catalog } from '@/lib/types';
import { categoryPath, categoryTree } from '@/features/categories/category-tree';
import '../taxonomy.css';

export function Taxonomy({
  catalog,
  categories,
  tags,
  onCategories,
  onTags,
  disabled = false,
}: {
  catalog: Catalog;
  categories: string[];
  tags: string[];
  onCategories: (ids: string[]) => void;
  onTags: (names: string[]) => void;
  disabled?: boolean;
}) {
  const [tagText, setTagText] = useState('');
  const [categoryText, setCategoryText] = useState('');
  const [creating, setCreating] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const tagNames = [...new Set([...catalog.tags.map((tag) => tag.name), ...tags])].sort((a, b) =>
    a.localeCompare(b, 'tr'),
  );
  const tagOptions = tagNames.filter((name) => normalize(name).includes(normalize(tagText)));
  const canCreateTag = !!tagText.trim() && !tagNames.includes(tagText.trim());
  const categoryOptions = categoryTree(catalog.categories).filter(({ category }) =>
    normalize(categoryPath(catalog.categories, category.id)).includes(normalize(categoryText)),
  );
  const canCreateCategory =
    !!categoryText.trim() &&
    !catalog.categories.some(
      (category) => category.name === categoryText.trim() && !category.parentId,
    );
  function addTag(name: string) {
    onTags([...new Set([...tags, name])]);
    setTagText('');
  }
  async function createCategory() {
    setCreating(true);
    setCategoryError('');
    try {
      const id = await backend.saveCategory({ name: categoryText.trim(), parentId: null });
      await refreshLibrary();
      onCategories([...new Set([...categories, id])]);
      setCategoryText('');
    } catch (error) {
      setCategoryError(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }
  return (
    <div className="taxonomy">
      <div className="detail-label">Kategoriler</div>
      <div className="chips">
        {[...new Set(categories)].map((id) => (
          <span className="category-chip" key={id} title={categoryPath(catalog.categories, id)}>
            <Folder size={12} />
            <span className="taxonomy-chip-label">
              {catalog.categories.find((category) => category.id === id)?.name ?? 'Kategori'}
            </span>
            <button
              aria-label={`${categoryPath(catalog.categories, id) || 'Bu'} kategorisinden kaldır`}
              disabled={disabled || creating}
              onClick={() => onCategories(categories.filter((value) => value !== id))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <Popover
          trigger={
            <Button size="sm" variant="ghost" disabled={disabled} className="add-chip">
              <Plus size={13} />
              Kategori
            </Button>
          }
        >
          <strong className="picker-heading">Kategorilere ekle</strong>
          <label className="picker-search">
            <Search size={15} />
            <input
              value={categoryText}
              placeholder="Kategori ara veya oluştur"
              aria-label="Kategori ara veya oluştur"
              maxLength={80}
              onChange={(event) => {
                setCategoryText(event.target.value);
                setCategoryError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canCreateCategory && !creating) {
                  event.preventDefault();
                  void createCategory();
                }
              }}
            />
          </label>
          <div className="picker-options">
            {categoryOptions.map(({ category }) => (
              <button
                key={category.id}
                className="picker-option"
                aria-pressed={categories.includes(category.id)}
                disabled={creating}
                onClick={() =>
                  onCategories(
                    categories.includes(category.id)
                      ? categories.filter((id) => id !== category.id)
                      : [...categories, category.id],
                  )
                }
              >
                <Folder size={14} />
                <span>{categoryPath(catalog.categories, category.id)}</span>
                {categories.includes(category.id) && <Check size={14} />}
              </button>
            ))}
            {canCreateCategory && (
              <button
                className="picker-option create-tag"
                disabled={creating}
                onClick={() => void createCategory()}
              >
                {creating ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}
                <span>
                  “{categoryText.trim()}” oluştur
                  <small className="taxonomy-picker-caption">Ana kategori olarak eklenir</small>
                </span>
              </button>
            )}
            {!categoryOptions.length && !canCreateCategory && (
              <p className="muted">Kategori adı yazarak ilk kategoriyi oluşturabilirsiniz.</p>
            )}
          </div>
          {categoryError && (
            <p className="error-text" role="alert">
              {categoryError}
            </p>
          )}
          {!!categories.length && (
            <Button variant="ghost" size="sm" disabled={creating} onClick={() => onCategories([])}>
              Kategori seçimlerini temizle
            </Button>
          )}
        </Popover>
      </div>
      <div className="detail-label">Etiketler</div>
      <div className="chips">
        {[...new Set(tags)].map((tag) => (
          <span className="tag-chip" key={tag} title={tag}>
            # <span className="taxonomy-chip-label">{tag}</span>
            <button
              aria-label={`${tag} etiketini kaldır`}
              disabled={disabled}
              onClick={() => onTags(tags.filter((value) => value !== tag))}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <Popover
          trigger={
            <Button size="sm" variant="ghost" disabled={disabled} className="add-chip">
              <Plus size={13} />
              Etiket
            </Button>
          }
        >
          <label className="picker-search">
            <Search size={15} />
            <input
              value={tagText}
              placeholder="Etiket ara veya oluştur"
              aria-label="Etiket ara veya oluştur"
              maxLength={80}
              onChange={(event) => setTagText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && tagText.trim()) {
                  event.preventDefault();
                  addTag(tagText.trim());
                }
              }}
            />
          </label>
          <div className="picker-options">
            {tagOptions.map((name) => (
              <button
                key={name}
                className="picker-option"
                aria-pressed={tags.includes(name)}
                onClick={() =>
                  onTags(tags.includes(name) ? tags.filter((tag) => tag !== name) : [...tags, name])
                }
              >
                <span className="hash">#</span>
                <span>{name}</span>
                {tags.includes(name) && <Check size={14} />}
              </button>
            ))}
            {canCreateTag && (
              <button className="picker-option create-tag" onClick={() => addTag(tagText.trim())}>
                <Plus size={14} />
                <span>“{tagText.trim()}” oluştur</span>
              </button>
            )}
            {!tagOptions.length && !canCreateTag && (
              <p className="muted">Bir etiket adı yazarak başla.</p>
            )}
          </div>
          {!!tags.length && (
            <Button variant="ghost" size="sm" onClick={() => onTags([])}>
              Etiket seçimlerini temizle
            </Button>
          )}
        </Popover>
      </div>
    </div>
  );
}
