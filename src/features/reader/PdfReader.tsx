import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFDataRangeTransport,
  type RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Maximize,
  StickyNote,
  ExternalLink,
  LoaderCircle,
  AlertCircle,
  LockKeyhole,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { backend, isDesktop } from '@/lib/backend';
import { createLocalRangeTransport } from './local-range-transport';
import { PDF_RANGE_CHUNK_SIZE } from './asset-range-reader';
import { positions } from '@/lib/reading-position';
import { saves, useSaveState } from '@/lib/save-manager';
import type { Attachment, Item } from '@/lib/types';
import { errorMessage } from '@/lib/utils';

GlobalWorkerOptions.workerSrc = pdfWorker;

export default function PdfReader({
  file,
  item,
  onClose,
}: {
  file: Attachment;
  item: Item;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(positions.latest(file.id) ?? file.lastPage);
  const [pageInput, setPageInput] = useState(String(positions.latest(file.id) ?? file.lastPage));
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [width, setWidth] = useState(800);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [rendering, setRendering] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordRequest, setPasswordRequest] = useState<{
    submit: (value: string) => void;
    retry: boolean;
  } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const save = useSaveState(item.id);
  const { data: currentItem } = useQuery({
    queryKey: ['item', item.id],
    queryFn: () => backend.getItem(item.id),
  });
  const notes = save?.patch.notes ?? currentItem?.notes ?? item.notes;
  useEffect(() => {
    let disposed = false;
    setError('');
    setRendering(true);
    setDoc(null);
    let url = '';
    let loading: ReturnType<typeof getDocument> | undefined;
    let transport: PDFDataRangeTransport | undefined;
    let failed = false;
    const abort = new AbortController();
    const fail = (reason: unknown) => {
      if (disposed || failed) return;
      failed = true;
      setError(errorMessage(reason));
      setRendering(false);
      setDoc(null);
      abort.abort();
      transport?.abort();
      if (loading) void loading.destroy().catch(() => {});
    };
    void backend
      .attachmentUrl(file.id)
      .then(async (source) => {
        url = source;
        if (disposed) {
          if (url.startsWith('blob:')) URL.revokeObjectURL(url);
          return;
        }
        if (isDesktop) {
          transport = await createLocalRangeTransport(url, file.sizeBytes, abort.signal, fail);
          if (disposed) {
            transport.abort();
            return;
          }
        }
        loading = getDocument({
          ...(transport ? { range: transport, rangeChunkSize: PDF_RANGE_CHUNK_SIZE } : { url }),
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          wasmUrl: '/pdfjs/wasm/',
          iccUrl: '/pdfjs/iccs/',
          enableXfa: false,
          disableAutoFetch: true,
          disableStream: true,
        });
        loading.onPassword = (submit: (password: string) => void, reason: number) => {
          if (!disposed) setPasswordRequest({ submit, retry: reason === 2 });
        };
        return loading.promise.then((pdf) => {
          if (!disposed && !failed) {
            setDoc(pdf);
            setPage(Math.min(positions.latest(file.id) ?? file.lastPage, pdf.numPages));
            setPasswordRequest(null);
          }
        });
      })
      .catch(fail);
    return () => {
      disposed = true;
      abort.abort();
      transport?.abort();
      if (loading) void loading.destroy().catch(() => {});
      if (url.startsWith('blob:')) URL.revokeObjectURL(url);
    };
  }, [file.id, file.lastPage, file.sizeBytes, attempt]);
  useEffect(() => {
    const turnPage = (event: KeyboardEvent) => {
      if (
        !doc ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest('input,textarea,select,[contenteditable="true"]'))
      )
        return;
      if (event.key === 'PageDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        setPage((value) => Math.min(doc.numPages, value + 1));
      } else if (event.key === 'PageUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        setPage((value) => Math.max(1, value - 1));
      }
    };
    document.addEventListener('keydown', turnPage);
    return () => document.removeEventListener('keydown', turnPage);
  }, [doc]);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setPageInput(String(page));
  }, [page]);
  useEffect(() => {
    if (!doc || !canvas.current) return;
    let cancelled = false;
    let render: RenderTask | undefined;
    setRendering(true);
    setError('');
    void doc
      .getPage(page)
      .then(async (pdfPage) => {
        if (cancelled || !canvas.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const scale = zoom === 'fit' ? Math.max(0.1, (width - 64) / base.width) : zoom;
        const viewport = pdfPage.getViewport({ scale });
        // Bound allocations for unusually large paper sizes and high-DPI displays.
        const pixelRatio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
          8192 / viewport.width,
          8192 / viewport.height,
        );
        const element = canvas.current;
        element.width = Math.floor(viewport.width * pixelRatio);
        element.height = Math.floor(viewport.height * pixelRatio);
        element.style.width = `${viewport.width}px`;
        element.style.height = `${viewport.height}px`;
        render = pdfPage.render({
          canvas: element,
          viewport,
          transform: [pixelRatio, 0, 0, pixelRatio, 0, 0],
        });
        await render.promise;
        pdfPage.cleanup();
        if (!cancelled) {
          setRendering(false);
          positions.queue(file.id, page);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errorMessage(e));
          setRendering(false);
        }
      });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [doc, page, zoom, width, file.id]);
  function goToPage() {
    const value = Number(pageInput);
    if (doc && Number.isInteger(value) && value >= 1 && value <= doc.numPages) setPage(value);
    else setPageInput(String(page));
  }
  return (
    <Dialog open onOpenChange={onClose} title={item.title} className="reader-dialog">
      <div className="reader-toolbar">
        <div className="reader-page-control">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Önceki sayfa"
            disabled={!doc || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={18} />
          </Button>
          <input
            aria-label="Sayfa numarası"
            inputMode="numeric"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            onBlur={goToPage}
            onKeyDown={(e) => {
              if (e.key === 'Enter') goToPage();
            }}
          />
          <span>/ {doc?.numPages ?? '—'}</span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Sonraki sayfa"
            disabled={!doc || page >= doc.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={18} />
          </Button>
        </div>
        <div className="reader-zoom">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Uzaklaştır"
            disabled={!doc}
            onClick={() => setZoom((z) => Math.max(0.25, (z === 'fit' ? 1 : z) - 0.25))}
          >
            <Minus size={16} />
          </Button>
          <span>{zoom === 'fit' ? 'Sığdır' : `${Math.round(zoom * 100)}%`}</span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Yakınlaştır"
            disabled={!doc}
            onClick={() => setZoom((z) => Math.min(3, (z === 'fit' ? 1 : z) + 0.25))}
          >
            <Plus size={16} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Genişliğe sığdır"
            disabled={!doc}
            onClick={() => setZoom('fit')}
          >
            <Maximize size={16} />
          </Button>
        </div>
        <div className="reader-actions">
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={notesOpen}
            onClick={() => setNotesOpen(!notesOpen)}
          >
            <StickyNote size={16} />
            <span>Notlar</span>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Varsayılan uygulamada aç"
            onClick={() =>
              void backend.openAttachment(file.id).catch((e) => toast.error(errorMessage(e)))
            }
          >
            <ExternalLink size={16} />
          </Button>
        </div>
      </div>
      <div className="reader-body">
        <div className="reader-stage" ref={stage}>
          {passwordRequest ? (
            <form
              className="pdf-password"
              onSubmit={(e) => {
                e.preventDefault();
                passwordRequest.submit(password);
                setPasswordRequest(null);
                setPassword('');
              }}
            >
              <LockKeyhole size={28} />
              <h3>Bu PDF parola istiyor</h3>
              {passwordRequest.retry && <p role="alert">Parola doğru değil. Yeniden dene.</p>}
              <input
                type="password"
                autoFocus
                aria-label="PDF parolası"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Button>PDF’yi aç</Button>
            </form>
          ) : error ? (
            <div className="inline-error" role="alert">
              <AlertCircle size={30} />
              <h3>PDF görüntülenemedi</h3>
              <p>{error}</p>
              <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                Yeniden dene
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  void backend.openAttachment(file.id).catch((e) => toast.error(errorMessage(e)))
                }
              >
                Varsayılan uygulamada aç
              </Button>
            </div>
          ) : (
            <>
              {rendering && (
                <div className="pdf-loading" role="status">
                  <LoaderCircle size={22} className="spin" />
                  Sayfa hazırlanıyor…
                </div>
              )}
              <canvas
                ref={canvas}
                aria-label={`${item.title}, sayfa ${page}`}
                role="img"
                className={rendering ? 'canvas-loading' : ''}
              />
            </>
          )}
        </div>
        {notesOpen && (
          <aside className="reader-notes">
            <label className="detail-label" htmlFor="reader-notes">
              Kişisel notların
            </label>
            <textarea
              id="reader-notes"
              value={notes}
              placeholder="Okurken aklına gelenleri yaz…"
              maxLength={1_000_000}
              onChange={(e) => saves.queue(item.id, { notes: e.target.value })}
            />
            <div
              className={`save-status ${save?.status === 'error' ? 'save-error' : ''}`}
              role="status"
            >
              {save?.status === 'error'
                ? save.error
                : save?.status === 'pending' || save?.status === 'saving'
                  ? 'Kaydediliyor…'
                  : 'Değişiklikler kaydedildi'}
            </div>
            {save?.status === 'error' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void saves.flush(item.id).catch(() => {})}
              >
                Kaydetmeyi yeniden dene
              </Button>
            )}
          </aside>
        )}
      </div>
    </Dialog>
  );
}
