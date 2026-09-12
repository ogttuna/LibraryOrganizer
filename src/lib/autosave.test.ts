import { afterEach, describe, expect, it, vi } from 'vitest';
import { Autosave } from './autosave';
import type { Item } from './types';
const item = { id: 'one', title: 'Başlık', notes: '' } as Item;
afterEach(() => vi.useRealTimers());

describe('Autosave data durability', () => {
  it('coalesces keystrokes and flushes immediately before navigation', async () => {
    vi.useFakeTimers();
    const update = vi.fn(async () => item);
    const saved = vi.fn();
    const autosave = new Autosave(update, saved);
    autosave.queue('one', { notes: 'ilk' });
    autosave.queue('one', { notes: 'son', title: 'Yeni' });
    expect(update).not.toHaveBeenCalled();
    await autosave.flushAll();
    expect(update).toHaveBeenCalledExactlyOnceWith('one', { notes: 'son', title: 'Yeni' });
    expect(autosave.hasPending()).toBe(false);
    expect(saved).toHaveBeenCalledWith(item);
  });
  it('serializes writes and preserves typing during an in-flight save', async () => {
    vi.useFakeTimers();
    let resolve!: (value: Item) => void;
    const update = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Item>((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue(item);
    const autosave = new Autosave(update, () => {});
    autosave.queue('one', { notes: 'önce' });
    const pending = autosave.flush('one');
    autosave.queue('one', { notes: 'sonra' });
    resolve(item);
    await pending;
    expect(update.mock.calls).toEqual([
      ['one', { notes: 'önce' }],
      ['one', { notes: 'sonra' }],
    ]);
    expect(autosave.hasPending()).toBe(false);
  });
  it('retains a failed draft and rejects closing until retry succeeds', async () => {
    vi.useFakeTimers();
    const update = vi.fn().mockRejectedValueOnce(new Error('Disk dolu')).mockResolvedValue(item);
    const autosave = new Autosave(update, () => {});
    autosave.queue('one', { notes: 'Kaybolmamalı' });
    await expect(autosave.flushAll()).rejects.toThrow('Disk dolu');
    expect(autosave.get('one')?.patch.notes).toBe('Kaybolmamalı');
    expect(autosave.get('one')?.status).toBe('error');
    expect(autosave.hasPending()).toBe(true);
    await autosave.flushAll();
    expect(autosave.hasPending()).toBe(false);
  });
  it('saves after 500 ms without waiting for a network connection', async () => {
    vi.useFakeTimers();
    const update = vi.fn(async () => item);
    const autosave = new Autosave(update, () => {});
    autosave.queue('one', { summary: 'Özet' });
    await vi.advanceTimersByTimeAsync(499);
    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(update).toHaveBeenCalledOnce();
  });
});
