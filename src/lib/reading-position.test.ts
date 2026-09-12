import { expect, it, vi } from 'vitest';
import { ReadingPositions } from './reading-position';

it('serializes rapid turns and keeps only the newest page waiting behind a write', async () => {
  let release!: () => void;
  const update = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const positions = new ReadingPositions(update);
  positions.queue('pdf', 2);
  await Promise.resolve();
  positions.queue('pdf', 3);
  positions.queue('pdf', 4);
  const closing = positions.flushAll();
  expect(update).toHaveBeenCalledTimes(1);
  expect(positions.latest('pdf')).toBe(4);
  expect(positions.hasPending()).toBe(true);
  release();
  await closing;
  expect(update.mock.calls).toEqual([
    ['pdf', 2],
    ['pdf', 4],
  ]);
  expect(positions.hasPending()).toBe(false);
});

it('keeps failed progress for retry and prevents a false successful close barrier', async () => {
  const update = vi.fn().mockRejectedValueOnce(new Error('Disk dolu')).mockResolvedValue(undefined);
  const onError = vi.fn();
  const positions = new ReadingPositions(update, onError);
  positions.queue('pdf', 7);
  await expect(positions.flushAll()).rejects.toThrow('Disk dolu');
  expect(positions.latest('pdf')).toBe(7);
  expect(positions.hasPending()).toBe(true);
  expect(onError).toHaveBeenCalledOnce();
  await positions.flushAll();
  expect(update.mock.calls).toEqual([
    ['pdf', 7],
    ['pdf', 7],
  ]);
  expect(positions.hasPending()).toBe(false);
});

it('drains a second document queued during the close barrier and does not rewrite identical pages', async () => {
  let release!: () => void;
  const update = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const positions = new ReadingPositions(update);
  positions.queue('first', 2);
  const closing = positions.flushAll();
  await Promise.resolve();
  positions.queue('second', 9);
  release();
  await closing;
  positions.queue('first', 2);
  await positions.flushAll();
  expect(update.mock.calls).toEqual([
    ['first', 2],
    ['second', 9],
  ]);
  expect(positions.hasPending()).toBe(false);
});

it('retains the original pending promise when a synchronous adapter throws', async () => {
  const update = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error('Geçici hata');
    })
    .mockResolvedValue(undefined);
  const positions = new ReadingPositions(update);
  positions.queue('pdf', 5);
  await expect(positions.flushAll()).rejects.toThrow('Geçici hata');
  await positions.flushAll();
  expect(positions.latest('pdf')).toBe(5);
  expect(positions.hasPending()).toBe(false);
});
