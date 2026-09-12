/** Tracks native mutations so application exit cannot overtake an explicit Save action. */
export class OperationTracker {
  private pending = new Set<Promise<unknown>>();
  private observers = new Set<(operation: Promise<unknown>) => void>();

  track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    for (const observe of this.observers) observe(operation);
    void operation.then(
      () => {
        this.pending.delete(operation);
      },
      () => {
        this.pending.delete(operation);
      },
    );
    return operation;
  }

  hasPending() {
    return this.pending.size > 0;
  }

  async flushAll() {
    let failed = false;
    let failure: unknown;
    const observed = new Set<Promise<unknown>>();
    const observe = (operation: Promise<unknown>) => {
      if (observed.has(operation)) return;
      observed.add(operation);
      void operation.catch((error) => {
        if (!failed) {
          failed = true;
          failure = error;
        }
      });
    };
    this.observers.add(observe);
    for (const operation of this.pending) observe(operation);
    try {
      // Wait for every mutation, including one queued while another is in flight.
      // Observers retain failures of short operations that finish between batches.
      while (this.pending.size) await Promise.allSettled([...this.pending]);
      if (failed) throw failure;
    } finally {
      this.observers.delete(observe);
    }
  }
}

export const operations = new OperationTracker();
