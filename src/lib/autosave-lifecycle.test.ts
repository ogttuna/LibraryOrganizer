import { afterEach, expect, it, vi } from 'vitest';
import { Autosave } from './autosave';
import type { Item } from './types';

const item = { id: 'one', notes: '' } as Item;
afterEach(() => vi.useRealTimers());

it('flushAll drains a newly edited second item before resolving', async () => {
  vi.useFakeTimers();
  let release!: (value: Item) => void;
  const update = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Item>((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(item);
  const autosave = new Autosave(update, () => {});
  autosave.queue('one', { notes: 'Birinci' });
  const closed = autosave.flushAll();
  autosave.queue('two', { description: 'Kapanış sırasında eklenen' });
  release(item);
  await closed;
  expect(update.mock.calls).toEqual([
    ['one', { notes: 'Birinci' }],
    ['two', { description: 'Kapanış sırasında eklenen' }],
  ]);
  expect(autosave.hasPending()).toBe(false);
});

it('concurrent flush requests write each revision once and retain the latest draft', async () => {
  vi.useFakeTimers();
  let release!: (value: Item) => void;
  const update = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Item>((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue(item);
  const saved = vi.fn();
  const autosave = new Autosave(update, saved);
  autosave.queue('one', { notes: 'Önce' });
  const navigation = autosave.flushAll();
  const exit = autosave.flushAll();
  autosave.queue('one', { notes: 'En son' });
  release(item);
  await Promise.all([navigation, exit]);
  expect(update.mock.calls).toEqual([
    ['one', { notes: 'Önce' }],
    ['one', { notes: 'En son' }],
  ]);
  expect(saved).toHaveBeenCalledTimes(2);
  expect(autosave.hasPending()).toBe(false);
});

it('a synchronous adapter error does not leave a permanently rejected running save', async () => {
  vi.useFakeTimers();
  const update = vi
    .fn()
    .mockImplementationOnce(() => {
      throw new Error('Geçici dosya hatası');
    })
    .mockResolvedValue(item);
  const autosave = new Autosave(update, () => {});
  autosave.queue('one', { summary: 'Korunan özet' });
  await expect(autosave.flushAll()).rejects.toThrow('Geçici dosya hatası');
  expect(autosave.get('one')?.patch.summary).toBe('Korunan özet');
  await autosave.flushAll();
  expect(update).toHaveBeenCalledTimes(2);
  expect(autosave.hasPending()).toBe(false);
});
