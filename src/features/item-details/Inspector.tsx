import { useLayoutEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Star,
  X,
  ArrowUpRight,
  FileText,
  BookOpen,
  Plus,
  Trash2,
  RotateCcw,
  Check,
  LoaderCircle,
  AlertCircle,
  StickyNote,
  Paperclip,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { backend } from '@/lib/backend';
import { saves, useSaveState } from '@/lib/save-manager';
import { refreshLibrary } from '@/lib/query-client';
import {
  kindLabels,
  statusLabels,
  type Item,
  type Catalog,
  type Attachment,
  type Kind,
  type ReadingStatus,
} from '@/lib/types';
import { errorMessage, formatBytes, formatDate } from '@/lib/utils';
import { Taxonomy } from './Taxonomy';

export function Inspector({
  id,
  catalog,
  onClose,
  onOpenFile,
  onAttach,
}: {
  id: string;
  catalog?: Catalog;
  onClose: () => void;
  onOpenFile: (file: Attachment, item: Item) => void;
  onAttach: (id: string) => void;
}) {
  const {
    data: item,
    error,
    refetch,
  } = useQuery({ queryKey: ['item', id], queryFn: () => backend.getItem(id) });
  if (error)
    return (
      <aside className="inspector">
        <div className="inline-error" role="alert">
          <AlertCircle />
          <p>{errorMessage(error)}</p>
          <Button variant="outline" onClick={() => void refetch()}>
            Yeniden dene
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Kapat
          </Button>
        </div>
      </aside>
    );
  if (!item || !catalog)
    return (
      <aside className="inspector">
        <div className="loading-state">
          <LoaderCircle size={22} className="spin" />
          <span>Ayrıntılar yükleniyor…</span>
        </div>
      </aside>
    );
  return (
    <ItemInspector
      key={id}
      item={item}
      catalog={catalog}
      onClose={onClose}
      onOpenFile={onOpenFile}
      onAttach={onAttach}
    />
  );
}

function ItemInspector({
  item,
  catalog,
  onClose,
  onOpenFile,
  onAttach,
}: {
  item: Item;
  catalog: Catalog;
  onClose: () => void;
  onOpenFile: (file: Attachment, item: Item) => void;
  onAttach: (id: string) => void;
}) {
  const save = useSaveState(item.id);
  const draft = { ...item, ...save?.patch };
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element) return;
    const resize = () => {
      element.style.height = 'auto';
      const height = element.scrollHeight + 2;
      element.style.height = `${Math.min(height, 160)}px`;
      element.style.overflowY = height > 160 ? 'auto' : 'hidden';
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [draft.title]);
  const [tab, setTab] = useState<'general' | 'notes' | 'files'>('general');
  const [authors, setAuthors] = useState(item.authors.join('; '));
  const [busy, setBusy] = useState(false);
  const tags =
    save?.patch.tagNames ??
    catalog.tags.filter((t) => item.tagIds.includes(t.id)).map((t) => t.name);
  const primary = item.attachments.find((a) => a.format === 'pdf') ?? item.attachments[0];
  async function trash() {
    setBusy(true);
    try {
      await saves.flush(item.id);
      await backend.bulkUpdate({ itemIds: [item.id], trashed: !item.deletedAt });
      await refreshLibrary();
      toast.success(
        item.deletedAt ? 'Kaynak geri getirildi.' : 'Kaynak çöpe taşındı.',
        !item.deletedAt
          ? {
              action: {
                label: 'Geri al',
                onClick: () => {
                  void backend
                    .bulkUpdate({ itemIds: [item.id], trashed: false })
                    .then(refreshLibrary)
                    .catch((e) => toast.error(errorMessage(e)));
                },
              },
            }
          : undefined,
      );
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="inspector" aria-label="Kaynak ayrıntıları">
      <div className="inspector-toolbar">
        <span>KAYNAK AYRINTILARI</span>
        <div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={draft.isFavorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
            aria-pressed={draft.isFavorite}
            onClick={() => saves.queue(item.id, { isFavorite: !draft.isFavorite })}
          >
            <Star
              size={17}
              className={draft.isFavorite ? 'favorite-star' : ''}
              fill={draft.isFavorite ? 'currentColor' : 'none'}
            />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Ayrıntıları kapat" onClick={onClose}>
            <X size={18} />
          </Button>
        </div>
      </div>
      <div className="inspector-intro">
        <div className={`resource-symbol ${draft.kind}`}>
          <BookOpen size={24} strokeWidth={1.4} />
        </div>
        <span className="resource-kind">
          {kindLabels[draft.kind]}
          <span>·</span>
          {item.attachments.length} dosya
        </span>
        <textarea
          ref={titleRef}
          className="editable-title"
          rows={1}
          aria-label="Kaynak başlığı"
          value={draft.title}
          maxLength={500}
          aria-invalid={!draft.title.trim()}
          aria-describedby={!draft.title.trim() ? 'title-error' : undefined}
          onChange={(e) => saves.queue(item.id, { title: e.target.value })}
          placeholder="Kaynak başlığı"
        />
        {!draft.title.trim() && (
          <small id="title-error" className="field-error">
            Başlık boş bırakılamaz.
          </small>
        )}
        <input
          className="editable-authors"
          aria-label="Yazarlar"
          placeholder="Yazar ekle · Birden fazla yazar için ; kullan"
          value={authors}
          onChange={(e) => {
            setAuthors(e.target.value);
            saves.queue(item.id, {
              authors: e.target.value
                .split(';')
                .map((s) => s.trim())
                .filter(Boolean),
            });
          }}
        />
        {item.deletedAt ? (
          <div className="trash-notice">
            <Trash2 size={15} />
            <span>Bu kaynak çöp kutusunda.</span>
          </div>
        ) : (
          <Button
            className="open-primary"
            variant="outline"
            onClick={() => (primary ? onOpenFile(primary, item) : onAttach(item.id))}
          >
            {primary ? (
              <>
                <BookOpen size={16} />
                {primary.format === 'pdf' ? 'Okumaya başla' : 'Dosyayı aç'}
                <ArrowUpRight size={15} />
              </>
            ) : (
              <>
                <Plus size={16} />
                Dosya ekle
              </>
            )}
          </Button>
        )}
      </div>
      <div className="detail-tabs" role="tablist" aria-label="Kaynak bölümleri">
        {(
          [
            { id: 'general', label: 'Genel', icon: FileText },
            { id: 'notes', label: 'Notlar', icon: StickyNote },
            { id: 'files', label: 'Dosyalar', icon: Paperclip },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            id={`tab-${id}`}
            role="tab"
            key={id}
            aria-selected={tab === id}
            aria-controls={`panel-${id}`}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                const tabs = ['general', 'notes', 'files'] as const;
                const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
                setTab(next);
                document.getElementById(`tab-${next}`)?.focus();
              }
            }}
            tabIndex={tab === id ? 0 : -1}
          >
            <Icon size={14} />
            {label}
            {id === 'files' && <span>{item.attachments.length}</span>}
          </button>
        ))}
      </div>
      <div
        className="inspector-scroll"
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
      >
        {tab === 'general' && (
          <>
            <div className="metadata-grid">
              <label className="field-label">
                Okuma durumu
                <select
                  value={draft.readingStatus}
                  onChange={(e) =>
                    saves.queue(item.id, { readingStatus: e.target.value as ReadingStatus })
                  }
                >
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Kaynak türü
                <select
                  value={draft.kind}
                  onChange={(e) => saves.queue(item.id, { kind: e.target.value as Kind })}
                >
                  {Object.entries(kindLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Yayın yılı
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  pattern="[0-9]{1,4}"
                  placeholder="Yıl ekle"
                  value={draft.year ?? ''}
                  onChange={(e) => {
                    if (!/^\d{0,4}$/.test(e.target.value)) return;
                    saves.queue(item.id, {
                      year: e.target.value === '' ? null : Number(e.target.value),
                    });
                  }}
                />
              </label>
              <label className="field-label">
                Dil
                <input
                  value={draft.language}
                  maxLength={80}
                  placeholder="Dil ekle"
                  onChange={(e) => saves.queue(item.id, { language: e.target.value })}
                />
              </label>
            </div>
            <Taxonomy
              catalog={catalog}
              categories={draft.categoryIds}
              tags={tags}
              onCategories={(categoryIds) => saves.queue(item.id, { categoryIds })}
              onTags={(tagNames) => saves.queue(item.id, { tagNames })}
            />
            <label className="text-section">
              <span className="detail-label">Açıklama</span>
              <textarea
                rows={4}
                value={draft.description}
                placeholder="Bu kaynak ne hakkında?"
                maxLength={1_000_000}
                onChange={(e) => saves.queue(item.id, { description: e.target.value })}
              />
            </label>
            <label className="text-section">
              <span className="detail-label">Özet</span>
              <textarea
                rows={4}
                value={draft.summary}
                placeholder="İçeriğin kısa bir özetini yaz…"
                maxLength={1_000_000}
                onChange={(e) => saves.queue(item.id, { summary: e.target.value })}
              />
            </label>
          </>
        )}
        {tab === 'notes' && (
          <div className="notes-panel">
            <div className="notes-intro">
              <span className="detail-label">Kişisel notların</span>
              <span>{draft.notes.trim() ? draft.notes.trim().split(/\s+/).length : 0} sözcük</span>
            </div>
            <textarea
              aria-label="Kişisel notlar"
              className="notes-editor"
              value={draft.notes}
              placeholder="Aklında kalan bir cümle, yeni bir fikir, dönüp bakmak istediğin bir konu…"
              maxLength={1_000_000}
              onChange={(e) => saves.queue(item.id, { notes: e.target.value })}
            />
            <p className="notes-footnote">
              <StickyNote size={13} />
              Notların bu kaynağa aittir; dosyaya yazılmaz.
            </p>
          </div>
        )}
        {tab === 'files' && (
          <div className="files-panel">
            <div className="section-heading">
              <span className="detail-label">Bağlı dosyalar</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={!!item.deletedAt}
                onClick={() => onAttach(item.id)}
              >
                <Plus size={14} />
                Ekle
              </Button>
            </div>
            {item.attachments.map((file) => (
              <div className="attachment-row" key={file.id}>
                <FileText size={24} strokeWidth={1.3} />
                <div>
                  <strong title={file.originalFilename}>{file.originalFilename}</strong>
                  <small>
                    {file.format.toUpperCase()} · {formatBytes(file.sizeBytes)}
                  </small>
                  <button className="text-link" onClick={() => onOpenFile(file, item)}>
                    {file.format === 'pdf' ? `Aç · Sayfa ${file.lastPage}` : 'Dosyayı aç'}
                    <ArrowUpRight size={12} />
                  </button>
                </div>
              </div>
            ))}
            {!item.attachments.length && (
              <div className="small-empty">
                <Paperclip size={30} strokeWidth={1.2} />
                <p>Henüz dosya eklenmemiş.</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!item.deletedAt}
                  onClick={() => onAttach(item.id)}
                >
                  <Plus size={14} />
                  İlk dosyayı ekle
                </Button>
              </div>
            )}
            <p className="muted file-help">
              Aynı kaynağın PDF ve EPUB sürümlerini burada birlikte tutabilirsin.
            </p>
          </div>
        )}
        <div className="item-dates">
          <span>Eklenme</span>
          <span>{formatDate(item.createdAt)}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="trash-action"
          disabled={busy}
          onClick={() => void trash()}
        >
          {item.deletedAt ? <RotateCcw size={14} /> : <Trash2 size={14} />}
          {item.deletedAt ? 'Çöpten geri getir' : 'Çöpe taşı'}
        </Button>
      </div>
      <div className={`save-status ${save?.status === 'error' ? 'save-error' : ''}`} role="status">
        {save?.status === 'error' ? (
          <>
            <AlertCircle size={14} />
            <span>{save.error}</span>
            <button onClick={() => void saves.flush(item.id).catch(() => {})}>Yeniden dene</button>
          </>
        ) : save?.status === 'saving' || save?.status === 'pending' ? (
          <>
            <LoaderCircle size={13} className="spin" />
            <span>Kaydediliyor…</span>
          </>
        ) : (
          <>
            <Check size={14} />
            <span>Tüm değişiklikler kaydedildi</span>
          </>
        )}
      </div>
    </aside>
  );
}
