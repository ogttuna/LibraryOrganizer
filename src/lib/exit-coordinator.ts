interface ExitDependencies {
  isBusy: () => boolean;
  hasPending: () => boolean;
  flush: () => Promise<void>;
  exit: () => Promise<void>;
  onClosing: (closing: boolean) => void;
  onBlocked: () => void;
  onError: (error: unknown) => void;
}

/** One close barrier for window close, macOS Quit and repeated native requests. */
export class ExitCoordinator {
  private running?: Promise<void>;
  private closing = false;
  private completed = false;

  constructor(private dependencies: ExitDependencies) {}

  isClosing() {
    return this.closing;
  }

  request(): Promise<void> {
    if (this.running) return this.running;
    if (this.completed) return Promise.resolve();
    if (this.dependencies.isBusy()) {
      this.dependencies.onBlocked();
      return Promise.resolve();
    }
    this.closing = true;
    this.dependencies.onClosing(true);
    // Defer execution until running is assigned, including synchronous adapter errors.
    this.running = Promise.resolve()
      .then(async () => {
        do {
          await this.dependencies.flush();
          if (this.dependencies.isBusy()) {
            this.dependencies.onBlocked();
            return;
          }
        } while (this.dependencies.hasPending());
        await this.dependencies.exit();
        this.completed = true;
      })
      .catch((error) => this.dependencies.onError(error))
      .finally(() => {
        this.running = undefined;
        if (!this.completed) {
          this.closing = false;
          this.dependencies.onClosing(false);
        }
      });
    return this.running;
  }
}
