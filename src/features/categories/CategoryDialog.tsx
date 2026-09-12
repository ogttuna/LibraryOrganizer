import { useState } from 'react';
import { FolderPlus, LoaderCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { backend } from '@/lib/backend';
import { refreshLibrary } from '@/lib/query-client';
import { saves } from '@/lib/save-manager';
import { useUI } from '@/lib/ui-store';
import type { Category } from '@/lib/types';
import { errorMessage } from '@/lib/utils';
import { categoryPath, categoryTree, descendantIds } from './category-tree';
import '../taxonomy.css';

export function CategoryDialog({
  categories,
  category,
  initialParentId,
  onClose,
}: {
  categories: Category[];
  category?: Category;
  initialParentId?: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [parentId, setParentId] = useState(category?.parentId ?? initialParentId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const descendants = category ? descendantIds(categories, category.id) : new Set<string>();
  const children = categories.filter((entry) => entry.parentId === category?.id);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saves.flushAll();
      await backend.saveCategory({ id: category?.id, name, parentId: parentId || null });
      await refreshLibrary();
      toast.success(category ? 'Kategori güncellendi.' : 'Kategori oluşturuldu.');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!category) return;
    setBusy(true);
    setError('');
    try {
      await saves.flushAll();
      await backend.deleteCategory(category.id);
      const { query, setQuery } = useUI.getState();
      if (query.categoryIds.includes(category.id))
        setQuery({ categoryIds: query.categoryIds.filter((id) => id !== category.id) });
      await refreshLibrary();
      toast.success('Kategori silindi. Kaynaklarınız korundu.');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={category ? 'Kategoriyi düzenle' : 'Yeni kategori'}
      description="Kaynaklarınızı birden fazla kategoriye ekleyebilirsiniz."
      closeDisabled={busy}
    >
      <form onSubmit={(event) => void submit(event)} className="form-stack">
        <label className="field-label">
          Kategori adı
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Örn. Sosyal bilimler"
            maxLength={80}
            required
            disabled={busy || confirmDelete}
          />
        </label>
        <label className="field-label">
          Üst kategori
          <select
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
            disabled={busy || confirmDelete}
          >
            <option value="">Ana kategori</option>
            {categoryTree(categories)
              .filter(({ category: entry }) => !descendants.has(entry.id))
              .map(({ category: entry }) => (
                <option key={entry.id} value={entry.id}>
                  {categoryPath(categories, entry.id)}
                </option>
              ))}
          </select>
        </label>
        {category && (
          <p className="taxonomy-help">
            Bu kategoride doğrudan {category.count} kaynak
            {children.length ? ` ve ${children.length} alt kategori` : ''} var. Taşımak kaynakların
            kategori üyeliklerini korur.
          </p>
        )}
        {confirmDelete && (
          <div className="taxonomy-delete-confirm" role="alert">
            <strong>“{category?.name}” kategorisi silinsin mi?</strong>
            <p>
              Kaynaklarınız, dosyalarınız ve notlarınız korunur. Yalnızca bu kategoriyle ilişkileri
              kaldırılır.{children.length > 0 && ' Alt kategoriler bir üst düzeye taşınır.'}
            </p>
            <div className="dialog-actions">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setConfirmDelete(false);
                  setError('');
                }}
              >
                Geri dön
              </Button>
              <Button type="button" variant="danger" disabled={busy} onClick={() => void remove()}>
                {busy && <LoaderCircle size={15} className="spin" />}Kategoriyi sil
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        {!confirmDelete && (
          <div className="dialog-actions taxonomy-dialog-actions">
            {category && (
              <Button
                type="button"
                variant="ghost"
                className="taxonomy-danger"
                disabled={busy}
                onClick={() => {
                  setConfirmDelete(true);
                  setError('');
                }}
              >
                <Trash2 size={15} />
                Sil
              </Button>
            )}
            <span className="taxonomy-action-spacer" />
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Vazgeç
            </Button>
            <Button disabled={busy || !name.trim()}>
              {busy ? <LoaderCircle className="spin" size={16} /> : <FolderPlus size={16} />}
              {category ? 'Kaydet' : 'Kategori oluştur'}
            </Button>
          </div>
        )}
      </form>
    </Dialog>
  );
}
