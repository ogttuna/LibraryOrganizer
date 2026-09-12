import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { backend, isDesktop } from '@/lib/backend';
import { ExitCoordinator } from '@/lib/exit-coordinator';
import { operations } from '@/lib/operation-tracker';
import { positions } from '@/lib/reading-position';
import { saves } from '@/lib/save-manager';
import { useUI } from '@/lib/ui-store';
import { errorMessage } from '@/lib/utils';

const fileOperationBusy = () => useUI.getState().importBusy || useUI.getState().maintenanceBusy;
const hasPendingWrites = () =>
  saves.hasPending() || positions.hasPending() || operations.hasPending();
async function flushWrites() {
  do {
    await Promise.all([saves.flushAll(), positions.flushAll(), operations.flushAll()]);
  } while (hasPendingWrites());
}
const busyMessage =
  'Devam eden dosya işlemi tamamlanınca yeniden deneyin. Bekleyen değişiklikleriniz korunuyor.';

export function RecoveryScreen({
  onReload = () => window.location.reload(),
}: {
  onReload?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const reloading = useRef(false);
  const reloadApproved = useRef(false);
  const [exit] = useState(
    () =>
      new ExitCoordinator({
        isBusy: () => fileOperationBusy() || reloading.current,
        hasPending: hasPendingWrites,
        flush: flushWrites,
        exit: () => backend.exitApplication(),
        onClosing: (closing) => {
          setBusy(closing);
          if (closing) setMessage('');
        },
        onBlocked: () => setMessage(busyMessage),
        onError: (error) =>
          setMessage(
            `Kapatmadan önce kaydedilemedi: ${errorMessage(error)}. Sorunu giderip yeniden deneyebilirsiniz.`,
          ),
      }),
  );

  useEffect(() => {
    if (!isDesktop) return;
    const close = getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      void exit.request();
    });
    const quit = listen('folio-close-requested', () => void exit.request());
    void close.catch((error) =>
      setMessage(`Pencere kapatma denetimi hazırlanamadı: ${errorMessage(error)}`),
    );
    void quit.catch((error) => setMessage(`Çıkış denetimi hazırlanamadı: ${errorMessage(error)}`));
    return () => {
      void close.then((unlisten) => unlisten()).catch(() => {});
      void quit.then((unlisten) => unlisten()).catch(() => {});
    };
  }, [exit]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!reloadApproved.current && (hasPendingWrites() || fileOperationBusy())) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  async function reload() {
    if (reloading.current || exit.isClosing()) return;
    if (useUI.getState().importBusy) {
      setMessage(busyMessage);
      return;
    }
    reloading.current = true;
    setBusy(true);
    setMessage('');
    try {
      await flushWrites();
      if (useUI.getState().importBusy) {
        setMessage(busyMessage);
        return;
      }
      // A crashed confirmation dialog can leave maintenanceBusy set after its native
      // work finished. Reloading only the renderer is safe once mutations drain;
      // preserve the native-exit lock instead of resetting it blindly.
      reloadApproved.current = true;
      onReload();
    } catch (error) {
      setMessage(
        `Ekran yeniden açılmadan önce kaydedilemedi: ${errorMessage(error)}. Değişiklikleriniz bekliyor; yeniden deneyebilirsiniz.`,
      );
    } finally {
      reloading.current = false;
      reloadApproved.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="fatal-error" role="alert">
      <h1>Folio ekranı yeniden açılmalı</h1>
      <p>
        Kütüphanedeki kayıtların korunur. Bekleyen değişiklikleri kaydedip ekranı yeniden açmayı
        deneyebilirsin.
      </p>
      {message && <p className="form-error">{message}</p>}
      {busy && <p role="status">Bekleyen değişiklikler kaydediliyor…</p>}
      <div className="dialog-actions">
        <button className="button button-primary" disabled={busy} onClick={() => void reload()}>
          Kaydet ve yeniden aç
        </button>
        {isDesktop && (
          <button
            className="button button-outline"
            disabled={busy}
            onClick={() => void exit.request()}
          >
            Kaydet ve kapat
          </button>
        )}
      </div>
    </main>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <RecoveryScreen /> : this.props.children;
  }
}
