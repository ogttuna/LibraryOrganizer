import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  HardDrive,
  Download,
  Upload,
  Trash2,
  RefreshCw,
  LoaderCircle,
  ShieldCheck,
  Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { backend, isDesktop } from '@/lib/backend';
import { saves } from '@/lib/save-manager';
import { positions } from '@/lib/reading-position';
import { errorMessage, formatBytes, formatDate } from '@/lib/utils';
import { queryClient } from '@/lib/query-client';
import { useUI } from '@/lib/ui-store';
import type { RestorePreview } from '@/lib/types';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { data: path, error: pathError } = useQuery({
    queryKey: ['library-path'],
    queryFn: () => backend.getLibraryPath(),
  });
  const [busy, setBusy] = useState('');
  const [backup, setBackup] = useState('');
  const [restore, setRestore] = useState<RestorePreview | null>(null);
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [operationError, setOperationError] = useState('');
  const importBusy = useUI((state) => state.importBusy);
  const { data: catalog } = useQuery({ queryKey: ['catalog'], queryFn: backend.getCatalog });
  const trashCount = catalog?.stats.trash ?? 0;
  function begin(operation: string) {
    setOperationError('');
    setBusy(operation);
    useUI.getState().setMaintenanceBusy(true);
  }
  function finish() {
    setBusy('');
    useUI.getState().setMaintenanceBusy(false);
  }
  function failed(error: unknown) {
    const message = errorMessage(error);
    setOperationError(message);
    toast.error(message);
  }
  async function closeSettings() {
    if (busy) return;
    if (restore) {
      begin('cancel');
      try {
        await backend.cancelRestore(restore.id);
      } catch (error) {
        failed(error);
        finish();
        return;
      }
    }
    finish();
    onClose();
  }
  async function backupLibrary() {
    begin('backup');
    try {
      await Promise.all([saves.flushAll(), positions.flushAll()]);
      const destination = await save({
        title: 'Kütüphaneyi yedekle',
        defaultPath: `Folio-${new Date().toISOString().slice(0, 10)}.folio`,
        filters: [{ name: 'Folio yedeği', extensions: ['folio'] }],
      });
      if (!destination) return;
      const result = await backend.createBackup(destination);
      setBackup(result);
      toast.success('Kütüphane yedeği oluşturuldu.');
    } catch (error) {
      failed(error);
    } finally {
      finish();
    }
  }
  async function chooseRestore() {
    begin('restore');
    try {
      await Promise.all([saves.flushAll(), positions.flushAll()]);
      const source = await open({
        title: 'Folio yedeğini seç',
        multiple: false,
        directory: false,
        filters: [{ name: 'Folio yedeği', extensions: ['folio'] }],
      });
      if (!source || typeof source !== 'string') {
        finish();
        return;
      }
      setRestore(await backend.prepareRestore(source));
      setBusy('');
      // Keep imports and app close blocked while the validated replacement awaits confirmation.
    } catch (error) {
      failed(error);
      finish();
    }
  }
  async function cancelRestore() {
    if (!restore) return;
    begin('cancel');
    try {
      await backend.cancelRestore(restore.id);
      setRestore(null);
    } catch (error) {
      failed(error);
    } finally {
      finish();
    }
  }
  async function applyRestore() {
    if (!restore) return;
    begin('apply');
    try {
      await Promise.all([saves.flushAll(), positions.flushAll()]);
      await backend.applyRestore(restore.id);
      // Native application now restarts; retain the lock until the process exits.
    } catch (error) {
      failed(error);
      setBusy('');
    }
  }
  async function emptyTrash() {
    begin('trash');
    try {
      await Promise.all([saves.flushAll(), positions.flushAll()]);
      const result = await backend.emptyTrash();
      useUI.getState().select(null);
      queryClient.removeQueries({ queryKey: ['item'] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['library'] }),
      ]);
      setConfirmTrash(false);
      toast.success(`${result.deletedCount} kaynak kalıcı olarak silindi.`, {
        description: result.pendingFileCount
          ? `${result.pendingFileCount} kullanımda olan dosyanın disk temizliği sonraki açılışta yeniden denenecek.`
          : undefined,
      });
    } catch (error) {
      failed(error);
    } finally {
      finish();
    }
  }
  async function reindex() {
    begin('search');
    try {
      await Promise.all([saves.flushAll(), positions.flushAll()]);
      await backend.rebuildSearch();
      await queryClient.invalidateQueries({ queryKey: ['library'] });
      toast.success('Arama indeksi yenilendi.');
    } catch (error) {
      failed(error);
    } finally {
      finish();
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(value) => {
        if (!value) void closeSettings();
      }}
      title="Ayarlar ve yedekleme"
      description="Kütüphanenin kontrolü sende."
      closeDisabled={!!busy}
    >
      <div className="local-banner">
        <ShieldCheck size={24} strokeWidth={1.5} />
        <div>
          <strong>Tamamen yerel. Tamamen senin.</strong>
          <p>
            Dosyaların, notların ve sınıflandırmaların bu bilgisayarda saklanır. Hesap, sunucu veya
            internet bağlantısı gerekmez.
          </p>
        </div>
      </div>
      {operationError && (
        <p role="alert" className="form-error">
          {operationError}
        </p>
      )}
      {busy && (
        <p role="status" className="muted">
          <LoaderCircle className="spin" size={16} />{' '}
          {busy === 'restore' || busy === 'apply'
            ? 'Yedekteki veritabanı ve dosyalar doğrulanıyor. Lütfen bekle…'
            : busy === 'backup'
              ? 'Yedek hazırlanıyor…'
              : busy === 'trash'
                ? 'Çöp temizleniyor…'
                : 'İşlem tamamlanıyor…'}
        </p>
      )}
      <div className="settings-section">
        <h3>
          <HardDrive size={17} />
          Kütüphane konumu
        </h3>
        <p className="storage-path">
          {pathError ? errorMessage(pathError) : (path ?? 'Konum okunuyor…')}
        </p>
        {!isDesktop && (
          <p className="muted">
            Bu, tarayıcıya ait ayrı bir önizlemedir. Verileri masaüstü arşivine aktarılmaz. Tarayıcı
            verilerini temizlemek bu önizlemeyi de siler.
          </p>
        )}
      </div>
      <div className="settings-section">
        <h3>
          <Download size={17} />
          Kütüphaneyi yedekle
        </h3>
        <p>Dosyalarını, kategorilerini ve notlarını tek bir .folio arşivine kaydet.</p>
        <Button
          variant="outline"
          onClick={() => void backupLibrary()}
          disabled={!isDesktop || !!busy || importBusy || !!restore}
        >
          {busy === 'backup' ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
          Yedek oluştur
        </Button>
        {backup && (
          <p className="backup-success">
            <Check size={14} />
            {backup}
          </p>
        )}
      </div>
      <div className="settings-section">
        <h3>
          <Upload size={17} /> Yedekten geri yükle
        </h3>
        <p>
          Bir .folio yedeğini seç. Dosyalar ve kayıt ilişkileri doğrulandıktan sonra içeriğini
          onaylayabilirsin.
        </p>
        {!restore ? (
          <Button
            variant="outline"
            onClick={() => void chooseRestore()}
            disabled={!isDesktop || !!busy || importBusy}
          >
            <Upload size={16} /> Yedek seç
          </Button>
        ) : (
          <div className="restore-review">
            <p>
              <strong>{formatDate(restore.createdAt)}</strong> tarihli yedek:{' '}
              <strong>{restore.itemCount} kaynak</strong>, {restore.attachmentCount} dosya ·{' '}
              {formatBytes(restore.totalBytes)}.
            </p>
            <p>
              Bu yedek, mevcut kütüphanenin yerini alacak. Folio yeniden açılacak. Önceki kütüphanen
              aynı ana klasörde <strong>Folio-onceki-kutuphane</strong> ile başlayan ayrı bir
              klasörde korunacak.
            </p>
            <div className="dialog-actions">
              <Button variant="outline" disabled={!!busy} onClick={() => void cancelRestore()}>
                Vazgeç
              </Button>
              <Button disabled={!!busy || importBusy} onClick={() => void applyRestore()}>
                Geri yükle ve yeniden başlat
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="settings-section">
        <h3>
          <RefreshCw size={17} />
          Arama indeksi
        </h3>
        <p>Bir kaynak aramada görünmüyorsa indeksi kayıtlarından yeniden oluştur.</p>
        <Button
          variant="ghost"
          size="sm"
          disabled={!!busy || !isDesktop || importBusy || !!restore}
          onClick={() => void reindex()}
        >
          {busy === 'search' && <LoaderCircle className="spin" size={14} />}İndeksi yenile
        </Button>
      </div>
      <div className="settings-section">
        <h3>
          <Trash2 size={17} /> Çöpü boşalt
        </h3>
        <p>
          Çöpte {trashCount} kaynak var. Kayıtlar, notlar ve arşivdeki dosya kopyaları kalıcı olarak
          silinir. İçe aktardığın özgün dosyalar korunur.
        </p>
        {confirmTrash ? (
          <div className="restore-review">
            <p>
              <strong>{trashCount} kaynağı kalıcı olarak silmek istiyor musun?</strong> Bu işlem
              geri alınamaz. İhtiyaç duyabileceğin kayıtları önce çöpten geri getir veya bir yedek
              oluştur.
            </p>
            <div className="dialog-actions">
              <Button variant="outline" disabled={!!busy} onClick={() => setConfirmTrash(false)}>
                Vazgeç
              </Button>
              <Button
                variant="danger"
                disabled={!!busy || importBusy || !!restore}
                onClick={() => void emptyTrash()}
              >
                Kalıcı olarak sil
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            disabled={!!busy || importBusy || !!restore || !trashCount}
            onClick={() => setConfirmTrash(true)}
          >
            <Trash2 size={16} /> Çöpü boşalt
          </Button>
        )}
      </div>
      <div className="settings-footer">
        <span>Folio</span>
        <span>0.2.0</span>
      </div>
    </Dialog>
  );
}
