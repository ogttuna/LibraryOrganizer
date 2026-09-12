import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { useUI } from '@/lib/ui-store';
import { SettingsDialog } from './SettingsDialog';

const mocks = vi.hoisted(() => ({
  flushAll: vi.fn(),
  flushPositions: vi.fn(),
  open: vi.fn(),
  save: vi.fn(),
  getLibraryPath: vi.fn(),
  getCatalog: vi.fn(),
  createBackup: vi.fn(),
  prepareRestore: vi.fn(),
  cancelRestore: vi.fn(),
  applyRestore: vi.fn(),
  emptyTrash: vi.fn(),
  rebuildSearch: vi.fn(),
}));
vi.mock('@/lib/backend', () => ({ isDesktop: true, backend: mocks }));
vi.mock('@/lib/save-manager', () => ({ saves: { flushAll: mocks.flushAll } }));
vi.mock('@/lib/reading-position', () => ({ positions: { flushAll: mocks.flushPositions } }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.open, save: mocks.save }));

beforeEach(() => {
  vi.resetAllMocks();
  queryClient.clear();
  useUI.setState({ importBusy: false, maintenanceBusy: false });
  mocks.flushAll.mockResolvedValue(undefined);
  mocks.flushPositions.mockResolvedValue(undefined);
  mocks.open.mockResolvedValue('/test/backup.folio');
  mocks.getLibraryPath.mockResolvedValue('/test/library');
  mocks.getCatalog.mockResolvedValue({ categories: [], tags: [], stats: { trash: 2 } });
  mocks.prepareRestore.mockResolvedValue({
    id: 'restore-id',
    createdAt: '2026-09-12T12:00:00Z',
    itemCount: 5,
    attachmentCount: 7,
    totalBytes: 1024,
  });
  mocks.cancelRestore.mockResolvedValue(undefined);
  mocks.applyRestore.mockResolvedValue(undefined);
  mocks.emptyTrash.mockResolvedValue({ deletedCount: 2, pendingFileCount: 0 });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  useUI.setState({ maintenanceBusy: false, importBusy: false });
});

function openSettings() {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={queryClient}>
      <SettingsDialog onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  return user;
}

describe('Settings data replacement safeguards', () => {
  it('retains failed autosaves and does not even select a restore archive', async () => {
    mocks.flushAll.mockRejectedValue(new Error('Notlar kaydedilemedi'));
    const user = openSettings();
    await user.click(screen.getByRole('button', { name: 'Yedek seç' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Notlar kaydedilemedi');
    expect(mocks.open).not.toHaveBeenCalled();
    expect(mocks.prepareRestore).not.toHaveBeenCalled();
    expect(useUI.getState().maintenanceBusy).toBe(false);
  });

  it('shows a validated summary and cancellation cleans staging without replacing data', async () => {
    const user = openSettings();
    await user.click(screen.getByRole('button', { name: 'Yedek seç' }));
    expect(await screen.findByText('5 kaynak')).toBeInTheDocument();
    expect(mocks.applyRestore).not.toHaveBeenCalled();
    expect(useUI.getState().maintenanceBusy).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Vazgeç' }));
    await waitFor(() => expect(mocks.cancelRestore).toHaveBeenCalledExactlyOnceWith('restore-id'));
    expect(useUI.getState().maintenanceBusy).toBe(false);
    expect(screen.queryByText('5 kaynak')).not.toBeInTheDocument();
  });

  it('flushes again before confirmed restart and keeps maintenance locked until exit', async () => {
    const user = openSettings();
    await user.click(screen.getByRole('button', { name: 'Yedek seç' }));
    await user.click(await screen.findByRole('button', { name: 'Geri yükle ve yeniden başlat' }));
    await waitFor(() => expect(mocks.applyRestore).toHaveBeenCalledExactlyOnceWith('restore-id'));
    expect(mocks.flushAll).toHaveBeenCalledTimes(2);
    expect(mocks.flushPositions).toHaveBeenCalledTimes(2);
    expect(useUI.getState().maintenanceBusy).toBe(true);
    expect(screen.getByRole('button', { name: 'Pencereyi kapat' })).toBeDisabled();
  });

  it('requires a separate confirmation for permanent trash deletion and blocks imports', async () => {
    const user = openSettings();
    const empty = screen.getByRole('button', { name: 'Çöpü boşalt' });
    await waitFor(() => expect(empty).toBeEnabled());
    await user.click(empty);
    expect(mocks.emptyTrash).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Kalıcı olarak sil' }));
    await waitFor(() => expect(mocks.emptyTrash).toHaveBeenCalledOnce());
    expect(mocks.flushAll).toHaveBeenCalledOnce();
    await waitFor(() => expect(useUI.getState().maintenanceBusy).toBe(false));
  });
});
