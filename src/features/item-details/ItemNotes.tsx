import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import { AlertCircle, Check, FilePlus2, LoaderCircle, Save, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { saves, useSaveState } from '@/lib/save-manager';
import './ItemNotes.css';

const maxNotesLength = 1_000_000;

export function ItemNotes({
  itemId,
  value,
  page,
  showSaveStatus = true,
}: {
  itemId: string;
  value: string;
  page?: number;
  showSaveStatus?: boolean;
}) {
  const hintId = useId();
  const editor = useRef<HTMLTextAreaElement>(null);
  const nextCaret = useRef<number | null>(null);
  const save = useSaveState(itemId);
  const saving = save?.status === 'pending' || save?.status === 'saving';
  const failed = save?.status === 'error';
  const count = useMemo(() => value.trim().match(/\S+/gu)?.length ?? 0, [value]);
  const heading = page === undefined ? '' : `Sayfa ${page}\n`;
  const canInsert = value.length + heading.length + 3 <= maxNotesLength;

  useLayoutEffect(() => {
    if (nextCaret.current === null) return;
    editor.current?.focus();
    editor.current?.setSelectionRange(nextCaret.current, nextCaret.current);
    nextCaret.current = null;
  }, [value]);

  function saveNow() {
    // The queue retains the failed draft and publishes the error with a retry action.
    void saves.flush(itemId).catch(() => {});
  }

  function insertPage() {
    if (!canInsert) return;
    const position = editor.current?.selectionStart ?? value.length;
    const before = value.slice(0, position);
    const after = value.slice(position);
    const separator =
      before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const addition = `${separator}${heading}${after && !after.startsWith('\n') ? '\n' : ''}`;
    nextCaret.current = position + separator.length + heading.length;
    // A page reference never replaces highlighted notes.
    saves.queue(itemId, { notes: `${before}${addition}${after}` });
  }

  return (
    <div className="item-notes">
      <div className="item-notes-heading">
        <span className="detail-label">Kişisel notların</span>
        <span>{count.toLocaleString('tr-TR')} sözcük</span>
      </div>
      <div className="item-notes-actions">
        {page !== undefined && (
          <Button
            size="sm"
            variant="outline"
            disabled={!canInsert}
            aria-label={`Sayfa ${page} başlığı ekle`}
            title="Mevcut notlarını koruyarak imlecin olduğu yere sayfa başlığı ekle"
            onMouseDown={(event) => event.preventDefault()}
            onClick={insertPage}
          >
            <FilePlus2 size={14} />
            Sayfa {page} başlığı ekle
          </Button>
        )}
        <span>Otomatik kaydedilir</span>
        <Button
          size="sm"
          variant="ghost"
          disabled={!saving && !failed}
          onClick={saveNow}
          title="Ctrl / ⌘ + S"
        >
          <Save size={14} />
          {failed ? 'Yeniden dene' : 'Kaydet'}
        </Button>
      </div>
      <textarea
        ref={editor}
        aria-label="Kişisel notlar"
        aria-describedby={hintId}
        className="item-notes-editor"
        value={value}
        placeholder="Bir fikir, alıntı ya da tekrar bakmak istediğin bir konu…"
        maxLength={maxNotesLength}
        spellCheck
        onChange={(event) => saves.queue(itemId, { notes: event.target.value })}
        onKeyDown={(event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 's' &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.stopPropagation();
            saveNow();
          }
        }}
      />
      <p id={hintId} className="item-notes-hint">
        <StickyNote size={13} />
        Notların bu kaynağa aittir; PDF veya EPUB dosyasına yazılmaz.
      </p>
      {value.length >= maxNotesLength - 1000 && (
        <p className="item-notes-limit" role="status">
          {(maxNotesLength - value.length).toLocaleString('tr-TR')} karakter daha ekleyebilirsin.
        </p>
      )}
      {showSaveStatus && (
        <div
          className={`item-notes-status ${failed ? 'item-notes-error' : ''}`}
          role={failed ? 'alert' : 'status'}
        >
          {failed ? (
            <AlertCircle size={14} />
          ) : saving ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Check size={14} />
          )}
          <span>
            {failed
              ? `Kaydedilemedi: ${save.error}. Taslağın bu pencerede korunuyor.`
              : saving
                ? 'Kaydediliyor…'
                : 'Tüm değişiklikler kaydedildi'}
          </span>
        </div>
      )}
    </div>
  );
}
