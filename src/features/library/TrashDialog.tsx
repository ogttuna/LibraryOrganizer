import { useState } from 'react';
import { AlertCircle, LoaderCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { backend } from '@/lib/backend';
import { positions } from '@/lib/reading-position';
import { saves } from '@/lib/save-manager';
import { refreshLibrary } from '@/lib/query-client';
import { useUI } from '@/lib/ui-store';
import { errorMessage } from '@/lib/utils';

export function TrashDialog({ count, onClose }: { count: number; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function empty() {
    if (busy || useUI.getState().maintenanceBusy || useUI.getState().importBusy) return;
    setBusy(true);
    useUI.getState().setMaintenanceBusy(true);
    try {
      await Promise.all([saves.flushAll(), positions.flushAll()]);
      const result = await backend.emptyTrash();
      useUI.getState().select(null);
      await refreshLibrary();
      toast.success(`${result.deletedCount} kaynak kalıcı olarak silindi.`);
      if (result.pendingFileCount)
        toast.info(
          `${result.pendingFileCount} dosyanın diskten temizlenmesi bir sonraki açılışta yeniden denenecek.`,
        );
      onClose();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
      useUI.getState().setMaintenanceBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={onClose}
      title="Çöp kutusu boşaltılsın mı?"
      description={`${count} kaynağın kütüphanedeki dosyaları, açıklamaları ve notları kalıcı olarak silinecek. Bu işlem geri alınamaz. Özgün dosyaların korunur.`}
      closeDisabled={busy}
    >
      {error && (
        <p className="inline-error" role="alert">
          <AlertCircle size={18} />
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="outline" disabled={busy} onClick={onClose}>
          Vazgeç
        </Button>
        <Button variant="danger" disabled={busy} onClick={() => void empty()}>
          {busy ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />}Kalıcı olarak
          sil
        </Button>
      </div>
    </Dialog>
  );
}
