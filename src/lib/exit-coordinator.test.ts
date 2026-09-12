import { expect, it, vi } from 'vitest';
import { ExitCoordinator } from './exit-coordinator';

function fixture() {
  const dependencies = {
    isBusy: vi.fn(() => false),
    hasPending: vi.fn(() => false),
    flush: vi.fn(async () => {}),
    exit: vi.fn(async () => {}),
    onClosing: vi.fn(),
    onBlocked: vi.fn(),
    onError: vi.fn(),
  };
  return { dependencies, coordinator: new ExitCoordinator(dependencies) };
}

it('coalesces repeated window-close and macOS Quit requests into a single native exit', async () => {
  const { dependencies, coordinator } = fixture();
  let release!: () => void;
  dependencies.flush.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const first = coordinator.request();
  const second = coordinator.request();
  expect(first).toBe(second);
  expect(coordinator.isClosing()).toBe(true);
  await Promise.resolve();
  expect(dependencies.exit).not.toHaveBeenCalled();
  release();
  await Promise.all([first, second]);
  await coordinator.request();
  expect(dependencies.exit).toHaveBeenCalledOnce();
  expect(dependencies.onClosing.mock.calls).toEqual([[true]]);
});

it('rejects exit when an import or maintenance begins during the final save', async () => {
  const { dependencies, coordinator } = fixture();
  dependencies.flush.mockImplementation(async () => {
    dependencies.isBusy.mockReturnValue(true);
  });
  await coordinator.request();
  expect(dependencies.exit).not.toHaveBeenCalled();
  expect(dependencies.onBlocked).toHaveBeenCalledOnce();
  expect(dependencies.onClosing.mock.calls).toEqual([[true], [false]]);
  expect(coordinator.isClosing()).toBe(false);
});

it('blocks before flushing an active import and allows a later close request', async () => {
  const { dependencies, coordinator } = fixture();
  dependencies.isBusy.mockReturnValue(true);
  await coordinator.request();
  expect(dependencies.flush).not.toHaveBeenCalled();
  expect(dependencies.onClosing).not.toHaveBeenCalled();
  dependencies.isBusy.mockReturnValue(false);
  await coordinator.request();
  expect(dependencies.exit).toHaveBeenCalledOnce();
});

it('drains an additional pending reader position and reopens the UI on failed saves', async () => {
  const { dependencies, coordinator } = fixture();
  dependencies.hasPending.mockReturnValueOnce(true).mockReturnValue(false);
  dependencies.flush.mockResolvedValueOnce().mockRejectedValueOnce(new Error('Disk dolu'));
  await coordinator.request();
  expect(dependencies.flush).toHaveBeenCalledTimes(2);
  expect(dependencies.exit).not.toHaveBeenCalled();
  expect(dependencies.onError).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'Disk dolu' }),
  );
  expect(coordinator.isClosing()).toBe(false);
  dependencies.flush.mockResolvedValue();
  await coordinator.request();
  expect(dependencies.exit).toHaveBeenCalledOnce();
});
