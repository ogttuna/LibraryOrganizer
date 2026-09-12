import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetRangeReader, PDF_RANGE_CHUNK_SIZE } from './asset-range-reader';

const url = 'asset://localhost/%2Ftest%2Flibrary%2Ffiles%2Ffixture.pdf';
function reply(begin: number, end: number, total: number, overrides: Record<string, string> = {}) {
  const bytes = Uint8Array.from({ length: end - begin }, (_, i) => (begin + i) % 251);
  return new Response(bytes, {
    status: 206,
    headers: {
      'Content-Range': `bytes ${begin}-${end - 1}/${total}`,
      'Content-Length': String(bytes.length),
      ...overrides,
    },
  });
}
afterEach(() => vi.useRealTimers());

describe('Native PDF byte ranges', () => {
  it('splits a merged request below the asset protocol cap and preserves byte order', async () => {
    const length = PDF_RANGE_CHUNK_SIZE * 2 + 37;
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      const range = new Headers(options?.headers).get('Range')!;
      const [, begin, end] = /bytes=(\d+)-(\d+)/.exec(range)!;
      return reply(Number(begin), Number(end) + 1, length);
    });
    const reader = new AssetRangeReader(url, length, fetcher);
    const bytes = await reader.read(0, length);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      fetcher.mock.calls.map(([, options]) => new Headers(options?.headers).get('Range')),
    ).toEqual([
      `bytes=0-${PDF_RANGE_CHUNK_SIZE - 1}`,
      `bytes=${PDF_RANGE_CHUNK_SIZE}-${PDF_RANGE_CHUNK_SIZE * 2 - 1}`,
      `bytes=${PDF_RANGE_CHUNK_SIZE * 2}-${length - 1}`,
    ]);
    expect(bytes.length).toBe(length);
    for (const offset of [0, PDF_RANGE_CHUNK_SIZE - 1, PDF_RANGE_CHUNK_SIZE, length - 1])
      expect(bytes[offset]).toBe(offset % 251);
  });

  it('rejects ignored, malformed, shifted or stale ranges instead of downloading the entire file', async () => {
    const responses = [
      new Response(new Uint8Array(100), { status: 200 }),
      reply(0, 8, 100, { 'Content-Range': 'nonsense' }),
      reply(0, 8, 100, { 'Content-Range': 'bytes 1-8/100' }),
      reply(0, 8, 100, { 'Content-Range': 'bytes 0-7/101' }),
      reply(0, 8, 100, { 'Content-Length': '7' }),
      new Response(new Uint8Array(3), {
        status: 206,
        headers: { 'Content-Range': 'bytes 0-7/100', 'Content-Length': '8' },
      }),
    ];
    for (const response of responses) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      const reader = new AssetRangeReader(url, 100, fetcher);
      await expect(reader.read(0, 8)).rejects.toThrow(/PDF parçası/);
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it('concurrent ranges may finish out of order without mixing their contents', async () => {
    const completions: Array<(response: Response) => void> = [];
    const fetcher = vi.fn<typeof fetch>(() => new Promise((resolve) => completions.push(resolve)));
    const reader = new AssetRangeReader(url, 100, fetcher);
    const first = reader.read(0, 8);
    const second = reader.read(80, 88);
    await vi.waitFor(() => expect(completions).toHaveLength(2));
    completions[1](reply(80, 88, 100));
    expect([...(await second)]).toEqual([80, 81, 82, 83, 84, 85, 86, 87]);
    completions[0](reply(0, 8, 100));
    expect([...(await first)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('caps concurrency at four and cancellation settles active and queued reads', async () => {
    const fetcher = vi.fn<typeof fetch>(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    const reader = new AssetRangeReader(url, 100, fetcher);
    const pending = Promise.allSettled(
      Array.from({ length: 9 }, (_, i) => reader.read(i * 10, i * 10 + 5)),
    );
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    reader.abort();
    const results = await pending;
    expect(
      results.every(
        (result) => result.status === 'rejected' && result.reason.name === 'AbortError',
      ),
    ).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(4);
    await expect(reader.read(0, 8)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('times out an unresponsive read with an actionable error', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    const reader = new AssetRangeReader(url, 100, fetcher);
    const outcome = reader.read(0, 8).catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(15_001);
    expect(await outcome).toContain('süre doldu');
  });

  it('refuses arbitrary URLs, invalid metadata and out of bounds reads before I/O', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(() => new AssetRangeReader('https://outside.example/file.pdf', 10, fetcher)).toThrow();
    expect(() => new AssetRangeReader(url, Number.NaN, fetcher)).toThrow();
    const reader = new AssetRangeReader('http://asset.localhost/%2Fmanaged.pdf', 100, fetcher);
    for (const [begin, end] of [
      [-1, 10],
      [0, 101],
      [8, 8],
      [0, 1.5],
    ])
      await expect(reader.read(begin, end)).rejects.toThrow('aralığı geçersiz');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
