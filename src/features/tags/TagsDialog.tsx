import { useState } from 'react';
import { Hash, LoaderCircle, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { backend } from '@/lib/backend';
import { refreshLibrary } from '@/lib/query-client';
import { saves } from '@/lib/save-manager';
import { useUI } from '@/lib/ui-store';
import { errorMessage, normalize } from '@/lib/utils';
import type { Tag } from '@/lib/types';
import '../taxonomy.css';

export function TagsDialog({ tags, onClose }: { tags: Tag[]; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Tag | 'new' | null>(null);
  const [removing, setRemoving] = useState<Tag | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matching = tags
    .filter((tag) => normalize(tag.name).includes(normalize(search)))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  function edit(tag: Tag | 'new') {
    setEditing(tag);
    setName(tag === 'new' ? '' : tag.name);
    setError('');
    setRemoving(null);
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError('');
    try {
      await saves.flushAll();
      await backend.saveTag({ id: editing === 'new' ? undefined : editing.id, name });
      await refreshLibrary();
      toast.success(
        editing === 'new' ? 'Etiket oluşturuldu.' : 'Etiket tüm kaynaklarda güncellendi.',
      );
      setEditing(null);
      setSearch('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError('');
    try {
      await saves.flushAll();
      await backend.deleteTag(removing.id);
      const { query, setQuery } = useUI.getState();
      if (query.tagIds.includes(removing.id))
        setQuery({ tagIds: query.tagIds.filter((id) => id !== removing.id) });
      await refreshLibrary();
      toast.success('Etiket silindi. Kaynaklarınız korundu.');
      setRemoving(null);
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
      title="Etiketleri yönet"
      description="Etiket adını değiştirdiğinizde bağlı tüm kaynaklar güncellenir."
      closeDisabled={busy}
      className="tags-dialog"
    >
      {editing ? (
        <form onSubmit={(event) => void save(event)} className="form-stack">
          <label className="field-label">
            {editing === 'new' ? 'Yeni etiket adı' : 'Etiket adı'}
            <input
              autoFocus
              key={editing === 'new' ? 'new' : editing.id}
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="Örn. başvuru kaynağı"
              required
              disabled={busy}
            />
          </label>
          {editing !== 'new' && (
            <p className="taxonomy-help">
              {editing.count} kaynak bu etiketi kullanıyor. Diğer etiketleri ve notları korunur.
            </p>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setError('');
              }}
            >
              Vazgeç
            </Button>
            <Button disabled={busy || !name.trim()}>
              {busy && <LoaderCircle size={15} className="spin" />}
              {editing === 'new' ? 'Etiket oluştur' : 'Değişiklikleri kaydet'}
            </Button>
          </div>
        </form>
      ) : removing ? (
        <div className="form-stack">
          <div className="taxonomy-delete-confirm">
            <strong>“{removing.name}” etiketi silinsin mi?</strong>
            <p>
              Etiket tüm kaynaklardan kaldırılır. Kaynaklarınız, dosyalarınız ve notlarınız korunur.
            </p>
          </div>
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setRemoving(null);
                setError('');
              }}
            >
              Vazgeç
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              {busy && <LoaderCircle size={15} className="spin" />}Etiketi sil
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="taxonomy-manager-toolbar">
            <label className="picker-search">
              <Search size={15} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Etiketlerde ara"
                aria-label="Etiketlerde ara"
              />
            </label>
            <Button size="sm" onClick={() => edit('new')}>
              <Plus size={15} />
              Yeni etiket
            </Button>
          </div>
          <div className="taxonomy-manager-list" aria-label="Etiket listesi">
            {matching.map((tag) => (
              <div className="taxonomy-manager-row" key={tag.id}>
                <Hash size={16} />
                <div>
                  <strong title={tag.name}>{tag.name}</strong>
                  <small>{tag.count} kaynak</small>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`${tag.name} etiketini düzenle`}
                  onClick={() => edit(tag)}
                >
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="taxonomy-danger"
                  aria-label={`${tag.name} etiketini sil`}
                  onClick={() => {
                    setRemoving(tag);
                    setError('');
                  }}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            ))}
            {!matching.length && (
              <p className="taxonomy-empty">
                {search
                  ? 'Bu aramaya uyan etiket yok.'
                  : 'Henüz etiket yok. İlk etiketinizi burada veya kaynak ayrıntılarında oluşturabilirsiniz.'}
              </p>
            )}
          </div>
          <div className="taxonomy-manager-footer">
            <span>
              {matching.length} / {tags.length} etiket
            </span>
            <Button variant="ghost" onClick={onClose}>
              Bitti
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
