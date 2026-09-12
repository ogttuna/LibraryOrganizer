import { PDFDataRangeTransport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { AssetRangeReader, PDF_RANGE_CHUNK_SIZE } from './asset-range-reader';

class LocalRangeTransport extends PDFDataRangeTransport {
  constructor(
    private readonly reader: AssetRangeReader,
    initial: Uint8Array<ArrayBuffer>,
    private readonly onFailure: (error: unknown) => void,
    private readonly detach: () => void,
  ) {
    super(reader.length, initial, true);
  }

  override requestDataRange(begin: number, end: number) {
    void this.reader.read(begin, end).then(
      (bytes) => {
        if (!this.reader.aborted) this.onDataRange(begin, bytes);
      },
      (error: unknown) => {
        if (this.reader.aborted) return;
        this.abort();
        // PDFDataRangeTransport has no public error callback; caller destroys the loading task.
        this.onFailure(error);
      },
    );
  }

  override abort() {
    this.detach();
    this.reader.abort();
  }
}

export async function createLocalRangeTransport(
  url: string,
  length: number,
  signal: AbortSignal,
  onFailure: (error: unknown) => void,
): Promise<PDFDataRangeTransport> {
  const reader = new AssetRangeReader(url, length);
  const abort = () => reader.abort();
  signal.addEventListener('abort', abort, { once: true });
  const detach = () => signal.removeEventListener('abort', abort);
  try {
    if (signal.aborted) reader.abort();
    const initial = await reader.read(0, Math.min(PDF_RANGE_CHUNK_SIZE, length));
    return new LocalRangeTransport(reader, initial, onFailure, detach);
  } catch (error) {
    detach();
    reader.abort();
    throw error;
  }
}
