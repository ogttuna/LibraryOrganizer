import { toast } from 'sonner';
import { backend } from './backend';
import { errorMessage } from './utils';

interface PositionEntry {
  desired: number;
  saved?: number;
  running?: Promise<void>;
}

/** Serializes each document's progress and gives close/backup an explicit write barrier. */
export class ReadingPositions {
  private entries = new Map<string, PositionEntry>();

  constructor(
    private update: (id: string, page: number) => Promise<void>,
    private onError?: (id: string, error: unknown) => void,
  ) {}

  latest(id: string) {
    return this.entries.get(id)?.desired;
  }

  hasPending() {
    return [...this.entries.values()].some(
      (entry) => entry.running || entry.desired !== entry.saved,
    );
  }

  queue(id: string, page: number) {
    if (!Number.isInteger(page) || page < 1) throw new Error('Sayfa numarası geçersiz.');
    const entry = this.entries.get(id) ?? { desired: page };
    entry.desired = page;
    this.entries.set(id, entry);
    void this.flush(id).catch(() => {});
  }

  forget(id: string) {
    if (this.entries.get(id)?.running) throw new Error('Okuma konumu kaydediliyor.');
    this.entries.delete(id);
  }

  async flush(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.running) {
      await entry.running;
      return this.flush(id);
    }
    if (entry.desired === entry.saved) return;
    const page = entry.desired;
    entry.running = Promise.resolve()
      .then(() => this.update(id, page))
      .then(() => {
        entry.saved = page;
      })
      .catch((error) => {
        this.onError?.(id, error);
        throw error;
      })
      .finally(() => {
        entry.running = undefined;
      });
    await entry.running;
    if (entry.desired !== entry.saved) await this.flush(id);
  }

  async flushAll() {
    while (this.hasPending()) {
      await Promise.all([...this.entries.keys()].map((id) => this.flush(id)));
    }
  }
}

export const positions = new ReadingPositions(
  async (id, page) => {
    await backend.setLastPage(id, page);
    toast.dismiss(`position-${id}`);
  },
  (id, error) =>
    toast.error('Okuma konumu kaydedilemedi', {
      id: `position-${id}`,
      description: errorMessage(error),
      duration: Infinity,
      action: {
        label: 'Yeniden dene',
        onClick: () => {
          void positions.flush(id).catch(() => {});
        },
      },
    }),
);
