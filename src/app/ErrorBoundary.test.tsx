import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  close: undefined as undefined | ((event: { preventDefault: () => void }) => void),
  quit: undefined as undefined | (() => void),
  unlisten: vi.fn(),
  saves: { flushAll: vi.fn(async () => {}), hasPending: vi.fn(() => false) },
  positions: { flushAll: vi.fn(async () => {}), hasPending: vi.fn(() => false) },
  operations: { flushAll: vi.fn(async () => {}), hasPending: vi.fn(() => false) },
  exit: vi.fn(async () => {}),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (callback: typeof mocks.close) => {
      mocks.close = callback;
      return Promise.resolve(mocks.unlisten);
    },
  }),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (_event: string, callback: () => void) => {
    mocks.quit = callback;
    return Promise.resolve(mocks.unlisten);
  },
}));
vi.mock('@/lib/backend', () => ({ backend: { exitApplication: mocks.exit }, isDesktop: true }));
vi.mock('@/lib/save-manager', () => ({ saves: mocks.saves }));
vi.mock('@/lib/reading-position', () => ({ positions: mocks.positions }));
vi.mock('@/lib/operation-tracker', () => ({ operations: mocks.operations }));
import { RecoveryScreen } from './ErrorBoundary';
import { useUI } from '@/lib/ui-store';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  for (const queue of [mocks.saves, mocks.positions, mocks.operations]) {
    queue.flushAll.mockResolvedValue();
    queue.hasPending.mockReturnValue(false);
  }
  mocks.exit.mockResolvedValue();
  useUI.setState({ importBusy: false, maintenanceBusy: false });
});

it('fallback handles both native close and macOS Quit and waits for every queue', async () => {
  let release!: () => void;
  mocks.saves.flushAll.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  render(<RecoveryScreen />);
  const preventDefault = vi.fn();
  await act(async () => {
    mocks.close?.({ preventDefault });
    mocks.quit?.();
    await Promise.resolve();
  });
  expect(preventDefault).toHaveBeenCalledOnce();
  expect(mocks.exit).not.toHaveBeenCalled();
  expect(mocks.positions.flushAll).toHaveBeenCalledOnce();
  expect(mocks.operations.flushAll).toHaveBeenCalledOnce();
  await act(async () => {
    release();
    await Promise.resolve();
  });
  expect(mocks.exit).toHaveBeenCalledOnce();
});

it('a failed fallback save keeps exit blocked and allows retry', async () => {
  mocks.saves.flushAll.mockRejectedValueOnce(new Error('Disk dolu'));
  render(<RecoveryScreen />);
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve kapat' }));
  expect(screen.getByText(/Kapatmadan önce kaydedilemedi: Disk dolu/)).toBeInTheDocument();
  expect(mocks.exit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve kapat' }));
  expect(mocks.exit).toHaveBeenCalledOnce();
});

it('fallback reload respects active import and rechecks it after pending writes finish', async () => {
  const reload = vi.fn();
  render(<RecoveryScreen onReload={reload} />);
  useUI.setState({ importBusy: true });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve yeniden aç' }));
  expect(reload).not.toHaveBeenCalled();
  expect(mocks.saves.flushAll).not.toHaveBeenCalled();
  useUI.setState({ importBusy: false });
  mocks.operations.flushAll.mockImplementationOnce(async () => {
    useUI.setState({ importBusy: true });
  });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve yeniden aç' }));
  expect(reload).not.toHaveBeenCalled();
  useUI.setState({ importBusy: false });
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve yeniden aç' }));
  expect(reload).toHaveBeenCalledOnce();
});

it('recovers an abandoned maintenance confirmation by renderer reload while native exit stays blocked', async () => {
  const reload = vi.fn();
  useUI.setState({ maintenanceBusy: true });
  render(<RecoveryScreen onReload={reload} />);
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve kapat' }));
  expect(mocks.exit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Kaydet ve yeniden aç' }));
  expect(reload).toHaveBeenCalledOnce();
  expect(useUI.getState().maintenanceBusy).toBe(true);
});
