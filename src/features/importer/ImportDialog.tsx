import { useCallback, useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  FileUp,
  Plus,
  LoaderCircle,
  FileText,
  CheckCircle2,
  AlertCircle,
  Copy,
  ArrowUpRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { backend, isDesktop } from '@/lib/backend';
import { refreshLibrary } from '@/lib/query-client';
import { useUI } from '@/lib/ui-store';
import { supportedFormats, type ImportResult, type Kind } from '@/lib/types';
import { errorMessage } from '@/lib/utils';

interface Progress {
  filename: string;
  state: 'waiting' | 'importing' | 'imported' | 'duplicate' | 'failed' | 'cancelled';
  itemId?: string | null;
  error?: string | null;
}
export function ImportDialog({
  targetId,
  initialFiles,
  onClose,
  onSelect,
}: {
  targetId?: string;
  initialFiles?: (string | File)[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const lastFiles = useRef<(string | File)[] | undefined>(undefined);
  const running = useRef(false);
  const stopRequested = useRef(false);
  const lastSources = useRef<(string | File)[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<Kind>('book');
  const [manual, setManual] = useState(false);
  const categoryIds = useRef(useUI.getState().query.categoryIds);
  const [dragging, setDragging] = useState(false);
  const importFiles = useCallback(
    async (sources: (string | File)[]) => {
      if (running.current || !sources.length) return;
      running.current = true;
      stopRequested.current = false;
      lastSources.current = sources;
      setBusy(true);
      useUI.getState().setImportBusy(true);
      setProgress(
        sources.map((source) => ({
          filename: typeof source === 'string' ? source.split(/[\\/]/).at(-1)! : source.name,
          state: 'waiting',
        })),
      );
      let imported = 0;
      try {
        for (const [index, source] of sources.entries()) {
          if (stopRequested.current) {
            setProgress((rows) =>
              rows.map((row) => (row.state === 'waiting' ? { ...row, state: 'cancelled' } : row)),
            );
            break;
          }
          setProgress((rows) =>
            rows.map((row, i) => (i === index ? { ...row, state: 'importing' } : row)),
          );
          let result: ImportResult;
          try {
            result = await backend.importFile(source, targetId, categoryIds.current);
          } catch (error) {
            result = { filename: '', status: 'failed', itemId: null, error: errorMessage(error) };
          }
          setProgress((rows) =>
            rows.map((row, i) =>
              i === index
                ? { ...row, state: result.status, itemId: result.itemId, error: result.error }
                : row,
            ),
          );
          if (result.status === 'imported') imported++;
        }
        await refreshLibrary();
        if (imported) toast.success(`${imported} dosya kütüphaneye eklendi.`);
      } finally {
        running.current = false;
        setBusy(false);
        useUI.getState().setImportBusy(false);
      }
    },
    [targetId],
  );
  useEffect(() => {
    if (initialFiles?.length && lastFiles.current !== initialFiles) {
      lastFiles.current = initialFiles;
      void importFiles(initialFiles);
    }
  }, [initialFiles, importFiles]);
  async function pickFiles() {
    if (!isDesktop) {
      fileInput.current?.click();
      return;
    }
    try {
      const paths = await open({
        multiple: true,
        directory: false,
        filters: [{ name: 'Belgeler', extensions: supportedFormats }],
      });
      if (paths) await importFiles(Array.isArray(paths) ? paths : [paths]);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy || running.current) return;
    running.current = true;
    setBusy(true);
    useUI.getState().setImportBusy(true);
    try {
      const item = await backend.createItem(title, kind);
      if (categoryIds.current.length)
        await backend.updateItem(item.id, { categoryIds: categoryIds.current });
      await refreshLibrary();
      onSelect(item.id);
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      running.current = false;
      setBusy(false);
      useUI.getState().setImportBusy(false);
    }
  }
  const completed = progress.filter((p) => !['waiting', 'importing'].includes(p.state)).length;
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title={targetId ? 'Kaynağa dosya ekle' : 'Kütüphanene ekle'}
      description={
        targetId
          ? 'PDF, EPUB ve diğer biçimler aynı kaynağın bilgilerini paylaşır.'
          : 'Dosyalarını ekle. Bilgilerini ve notlarını sonra düzenleyebilirsin.'
      }
      closeDisabled={busy}
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={supportedFormats.map((f) => `.${f}`).join(',')}
        className="sr-only"
        aria-label="İçe aktarılacak dosyalar"
        onChange={(e) => {
          void importFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <div
        className={`dropzone ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          if (!isDesktop) void importFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <div className="dropzone-icon">
          <FileUp size={28} strokeWidth={1.5} />
        </div>
        <strong>Dosyalarını buraya bırak</strong>
        <span>PDF, EPUB, Word ve metin belgeleri</span>
        <Button variant="outline" onClick={() => void pickFiles()} disabled={busy}>
          <Plus size={16} />
          Dosya seç
        </Button>
        <small>Özgün dosyaların korunur; kütüphaneye bir kopya eklenir.</small>
      </div>
      {!!progress.length && (
        <div className="import-progress" aria-live="polite">
          <div className="progress-heading">
            <strong>{busy ? 'Dosyalar ekleniyor' : 'İçe aktarma tamamlandı'}</strong>
            <span>
              {completed} / {progress.length}
            </span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${(completed / progress.length) * 100}%` }} />
          </div>
          <div className="import-results">
            {progress.map((row, index) => (
              <div key={`${index}-${row.filename}`} className={`import-row ${row.state}`}>
                {row.state === 'importing' ? (
                  <LoaderCircle size={18} className="spin" />
                ) : row.state === 'imported' ? (
                  <CheckCircle2 size={18} />
                ) : row.state === 'duplicate' ? (
                  <Copy size={18} />
                ) : row.state === 'failed' ? (
                  <AlertCircle size={18} />
                ) : (
                  <FileText size={18} />
                )}
                <div>
                  <strong>{row.filename}</strong>
                  <small>
                    {row.error ??
                      {
                        waiting: 'Sırada',
                        importing: 'Kopyalanıyor ve doğrulanıyor…',
                        imported: 'Kütüphaneye eklendi',
                        duplicate: 'Bu dosya zaten kütüphanede',
                        failed: 'Eklenemedi',
                        cancelled: 'Eklenmedi · işlem durduruldu',
                      }[row.state]}
                  </small>
                </div>
                {row.itemId && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${row.filename} kaynağını göster`}
                    disabled={busy}
                    onClick={() => {
                      onSelect(row.itemId!);
                      onClose();
                    }}
                  >
                    <ArrowUpRight size={16} />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {!targetId && !progress.length && (
        <>
          <div className="or-divider">
            <span>veya</span>
          </div>
          {!manual ? (
            <button className="manual-toggle" onClick={() => setManual(true)}>
              <FileText size={17} />
              <span>
                Dosyasız kayıt oluştur<small>Dosyanı daha sonra ekleyebilirsin.</small>
              </span>
              <Plus size={17} />
            </button>
          ) : (
            <form onSubmit={(e) => void create(e)} className="form-stack">
              <label className="field-label">
                Kaynak başlığı
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Kitap ya da makalenin başlığı"
                  required
                  maxLength={500}
                />
              </label>
              <label className="field-label">
                Kaynak türü
                <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                  <option value="book">Kitap</option>
                  <option value="article">Makale</option>
                  <option value="other">Diğer</option>
                </select>
              </label>
              <Button disabled={busy || !title.trim()}>
                {busy && <LoaderCircle size={16} className="spin" />}Kaydı oluştur
              </Button>
            </form>
          )}
        </>
      )}
      {!!progress.length && (
        <div className="dialog-actions">
          {busy && (
            <Button
              variant="outline"
              onClick={() => {
                stopRequested.current = true;
                toast.info('Geçerli dosya tamamlanınca içe aktarma duracak.');
              }}
            >
              Sıradakileri durdur
            </Button>
          )}
          {!busy && progress.some((row) => row.state === 'failed' || row.state === 'cancelled') && (
            <Button
              variant="outline"
              onClick={() =>
                void importFiles(
                  lastSources.current.filter((_, index) =>
                    ['failed', 'cancelled'].includes(progress[index]?.state),
                  ),
                )
              }
            >
              Eklenmeyenleri yeniden dene
            </Button>
          )}
          <Button onClick={onClose} disabled={busy}>
            {busy ? 'İçe aktarılıyor…' : 'Tamam'}
          </Button>
        </div>
      )}
    </Dialog>
  );
}
