export const PDF_RANGE_CHUNK_SIZE = 256 * 1024;

type Waiter = { resolve: () => void; reject: (error: Error) => void };
const cancelled = () => new DOMException('PDF okuması iptal edildi.', 'AbortError');

/** Explicit ranges bypass PDF.js HTTP-only detection without broadening native file access. */
export class AssetRangeReader {
  private stopped = false;
  private active = 0;
  private waiters: Waiter[] = [];
  private controllers = new Set<AbortController>();

  constructor(
    private readonly url: string,
    readonly length: number,
    private readonly fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
  ) {
    const source = new URL(url);
    if (!(
      (source.protocol === 'asset:' && source.hostname === 'localhost') ||
      (source.protocol === 'http:' && source.hostname === 'asset.localhost')
    ))
      throw new Error('PDF adresi yerel kütüphane kapsamında değil.');
    if (!Number.isSafeInteger(length) || length < 1 || length > 8 * 1024 ** 3)
      throw new Error('PDF dosyasının boyutu geçersiz.');
  }

  get aborted() {
    return this.stopped;
  }

  abort() {
    if (this.stopped) return;
    this.stopped = true;
    for (const controller of this.controllers) controller.abort();
    for (const waiter of this.waiters.splice(0)) waiter.reject(cancelled());
  }

  private async acquire() {
    if (this.stopped) throw cancelled();
    if (this.active < 4) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  private release() {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve();
    else this.active--;
  }

  private async chunk(begin: number, end: number) {
    await this.acquire();
    const controller = new AbortController();
    this.controllers.add(controller);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 15_000);
    try {
      if (this.stopped) throw cancelled();
      const response = await this.fetcher(this.url, {
        headers: { Range: `bytes=${begin}-${end - 1}` },
        signal: controller.signal,
      });
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range') ?? '');
      const reportedLength = response.headers.get('Content-Length');
      if (
        response.status !== 206 ||
        !range ||
        Number(range[1]) !== begin ||
        Number(range[2]) !== end - 1 ||
        Number(range[3]) !== this.length ||
        (reportedLength !== null &&
          (!/^\d+$/.test(reportedLength) || Number(reportedLength) !== end - begin))
      ) {
        await response.body?.cancel().catch(() => {});
        throw new Error(
          'PDF parçası doğrulanamadı. Dosya değişmiş olabilir veya bu ortam parçalı okumayı desteklemiyor. Dosyayı dış uygulamada açabilir ya da yeniden ekleyebilirsin.',
        );
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (this.stopped) throw cancelled();
      if (bytes.byteLength !== end - begin)
        throw new Error('PDF parçası eksik okundu. Yeniden dene veya dosyayı dış uygulamada aç.');
      return bytes;
    } catch (error) {
      if (timedOut) throw new Error('PDF dosyası okunurken süre doldu. Yeniden deneyebilirsin.');
      throw error;
    } finally {
      clearTimeout(timeout);
      this.controllers.delete(controller);
      this.release();
    }
  }

  async read(begin: number, end: number): Promise<Uint8Array<ArrayBuffer>> {
    if (this.stopped) throw cancelled();
    if (
      !Number.isSafeInteger(begin) ||
      !Number.isSafeInteger(end) ||
      begin < 0 ||
      end <= begin ||
      end > this.length
    )
      throw new Error('İstenen PDF aralığı geçersiz.');
    const result = new Uint8Array(end - begin);
    // Tauri caps a single asset response at 1,024,000 bytes. Never request above 256 KiB.
    for (let offset = begin; offset < end; offset += PDF_RANGE_CHUNK_SIZE) {
      const bytes = await this.chunk(offset, Math.min(offset + PDF_RANGE_CHUNK_SIZE, end));
      result.set(bytes, offset - begin);
    }
    return result;
  }
}
