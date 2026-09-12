import { expect, it, vi } from 'vitest';
import { OperationTracker } from './operation-tracker';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((success, failure) => {
    resolve = success;
    reject = failure;
  });
  return { promise, resolve, reject };
}

it('returns the original mutation result and shares it across simultaneous exit barriers', async () => {
  const operations = new OperationTracker();
  const save = deferred<string>();
  expect(operations.track(save.promise)).toBe(save.promise);
  const first = operations.flushAll();
  const second = operations.flushAll();
  expect(operations.hasPending()).toBe(true);
  save.resolve('saved-id');
  await expect(save.promise).resolves.toBe('saved-id');
  await Promise.all([first, second]);
  expect(operations.hasPending()).toBe(false);
});

it('includes a second operation that starts while the initial mutation is pending', async () => {
  const operations = new OperationTracker();
  const first = deferred();
  const second = deferred();
  operations.track(first.promise);
  const completed = vi.fn();
  const closing = operations.flushAll().then(completed);
  operations.track(second.promise);
  first.resolve();
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  second.resolve();
  await closing;
  expect(completed).toHaveBeenCalledOnce();
  expect(operations.hasPending()).toBe(false);
});

it('retains a newly queued fast failure while waiting for an older mutation', async () => {
  const operations = new OperationTracker();
  const long = deferred();
  operations.track(long.promise);
  const closing = operations.flushAll();
  const expected = expect(closing).rejects.toThrow('Kategori kaydedilemedi');
  operations.track(Promise.reject(new Error('Kategori kaydedilemedi')));
  await Promise.resolve();
  long.resolve();
  await expected;
  expect(operations.hasPending()).toBe(false);
  await expect(operations.flushAll()).resolves.toBeUndefined();
});

it('drains the remaining writes before rejecting a failed batch', async () => {
  const operations = new OperationTracker();
  const failing = deferred();
  const saving = deferred();
  operations.track(failing.promise);
  operations.track(saving.promise);
  const done = vi.fn();
  const barrier = operations.flushAll().catch(done);
  failing.reject(new Error('Dosya yok'));
  await Promise.resolve();
  expect(done).not.toHaveBeenCalled();
  saving.resolve();
  await barrier;
  expect(done).toHaveBeenCalledWith(expect.objectContaining({ message: 'Dosya yok' }));
});
