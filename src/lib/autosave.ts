import type { Item, ItemPatch } from './types';

type Entry = {
  patch: ItemPatch;
  status: 'pending' | 'saving' | 'saved' | 'error';
  error?: string;
  timer?: ReturnType<typeof setTimeout>;
  running?: Promise<void>;
};
export class Autosave {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private version = 0;
  constructor(
    private update: (id: string, patch: ItemPatch) => Promise<Item>,
    private onSaved: (item: Item) => void,
    private delay = 500,
    private onError?: (id: string, message: string) => void,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  snapshot = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((fn) => fn());
  }
  get(id: string) {
    return this.entries.get(id);
  }
  hasPending() {
    return [...this.entries.values()].some((e) => Object.keys(e.patch).length || e.running);
  }
  queue(id: string, patch: ItemPatch) {
    const entry = this.entries.get(id) ?? { patch: {}, status: 'saved' as const };
    Object.assign(entry.patch, patch);
    entry.status = 'pending';
    entry.error = undefined;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      void this.flush(id).catch(() => {});
    }, this.delay);
    this.entries.set(id, entry);
    this.emit();
  }
  async flush(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    if (entry.running) {
      await entry.running;
      return this.flush(id);
    }
    if (!Object.keys(entry.patch).length) return;
    const patch = { ...entry.patch };
    entry.status = 'saving';
    this.emit();
    const operation = (async () => {
      try {
        // Even an adapter that throws before returning a Promise must yield here:
        // otherwise finally clears `running` before the operation is assigned below.
        let update: Promise<Item>;
        try {
          update = this.update(id, patch);
        } catch (error) {
          update = Promise.reject(error);
        }
        const item = await update;
        for (const key of Object.keys(patch) as (keyof ItemPatch)[]) {
          if (JSON.stringify(entry.patch[key]) === JSON.stringify(patch[key]))
            delete entry.patch[key];
        }
        this.onSaved(item);
        entry.status = Object.keys(entry.patch).length ? 'pending' : 'saved';
        entry.error = undefined;
      } catch (error) {
        entry.status = 'error';
        entry.error = error instanceof Error ? error.message : String(error);
        this.onError?.(id, entry.error);
        throw error;
      } finally {
        entry.running = undefined;
        this.emit();
      }
    })();
    entry.running = operation;
    await operation;
    if (Object.keys(entry.patch).length) await this.flush(id);
  }
  async flushAll() {
    // A different item can acquire a draft while the initial writes are pending.
    // Navigation and exit must wait for these newly queued entries too.
    while (this.hasPending()) {
      await Promise.all([...this.entries.keys()].map((id) => this.flush(id)));
    }
  }
}
