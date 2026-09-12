import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Attachment, Item } from '@/lib/types';
import PdfReader from './PdfReader';

const mocks = vi.hoisted(() => ({
  attachmentUrl: vi.fn(),
  getDocument: vi.fn(),
  getPage: vi.fn(),
  render: vi.fn(),
  destroy: vi.fn(),
  queuePosition: vi.fn(),
  latestPosition: vi.fn(),
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: mocks.getDocument,
  GlobalWorkerOptions: {},
  PDFDataRangeTransport: class {},
}));
vi.mock('@/lib/backend', () => ({
  isDesktop: false,
  backend: { attachmentUrl: mocks.attachmentUrl, getItem: vi.fn(), openAttachment: vi.fn() },
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
vi.mock('@/lib/reading-position', () => ({
  positions: { latest: mocks.latestPosition, queue: mocks.queuePosition },
}));
vi.mock('@/lib/save-manager', () => ({
  useSaveState: () => undefined,
  saves: { queue: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) },
}));

const file: Attachment = {
  id: 'pdf-1',
  itemId: 'item-1',
  originalFilename: 'test.pdf',
  relativePath: 'files/pdf-1/test.pdf',
  mimeType: 'application/pdf',
  format: 'pdf',
  sizeBytes: 100,
  sha256: 'test-hash',
  lastPage: 1,
  createdAt: '2026-09-12T12:00:00Z',
};
const item: Item = {
  id: 'item-1',
  title: 'Okuyucu denemesi',
  kind: 'book',
  authors: [],
  year: null,
  language: 'tr',
  description: '',
  summary: '',
  notes: 'Korunan kişisel not.',
  readingStatus: 'reading',
  isFavorite: false,
  createdAt: file.createdAt,
  updatedAt: file.createdAt,
  deletedAt: null,
  categoryIds: [],
  tagIds: [],
  attachments: [file],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function pdfPage(pageNumber: number) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({
      width: 600 * scale,
      height: 900 * scale,
      scale,
      pageNumber,
    }),
    render: mocks.render,
    cleanup: vi.fn(),
  };
}

let stageWidth: number;
let stageHeight: number;
let style: HTMLStyleElement;
const observers = new Set<TestResizeObserver>();

class TestResizeObserver {
  targets = new Set<Element>();
  constructor(private callback: ResizeObserverCallback) {
    observers.add(this);
  }
  observe = vi.fn((target: Element) => this.targets.add(target));
  unobserve = vi.fn((target: Element) => this.targets.delete(target));
  disconnect = vi.fn(() => this.targets.clear());
  notify() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

function notifyResize() {
  act(() => {
    for (const observer of observers) if (observer.targets.size) observer.notify();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  stageWidth = 1000;
  stageHeight = 800;
  observers.clear();
  vi.stubGlobal('ResizeObserver', TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('reader-stage') ? stageWidth : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains('reader-stage') ? stageHeight : 0;
  });
  style = document.createElement('style');
  style.textContent = '.reader-stage { padding: 20px 30px; }';
  document.head.append(style);
  mocks.attachmentUrl.mockResolvedValue('https://example.test/local-fixture.pdf');
  mocks.destroy.mockResolvedValue(undefined);
  mocks.getPage.mockImplementation(async (number: number) => pdfPage(number));
  mocks.render.mockImplementation(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  mocks.getDocument.mockImplementation(() => ({
    promise: Promise.resolve({ numPages: 3, getPage: mocks.getPage }),
    destroy: mocks.destroy,
  }));
});

afterEach(() => {
  cleanup();
  style.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openReader() {
  const user = userEvent.setup();
  const result = render(<PdfReader file={file} item={item} onClose={vi.fn()} />);
  await waitFor(() => expect(mocks.queuePosition).toHaveBeenCalledWith(file.id, 1));
  const canvas = screen.getByRole('img', { name: `${item.title}, sayfa 1` });
  const stage = canvas.parentElement!;
  return { ...result, user, canvas, stage };
}

describe('PDF reader controls with the real dialog portal', () => {
  it('observes the stage after portal mount and initially fits the entire page', async () => {
    const { canvas, stage, unmount } = await openReader();
    const observer = [...observers].find((candidate) => candidate.targets.has(stage));
    expect(observer).toBeDefined();
    expect(document.body).toContainElement(stage);
    expect(screen.getByRole('combobox', { name: 'Yakınlaştırma ve sığdırma' })).toHaveValue(
      'fit-page',
    );
    expect(parseFloat(canvas.style.height)).toBeCloseTo(760);
    expect(parseFloat(canvas.style.width)).toBeCloseTo((760 / 900) * 600);
    unmount();
    expect(observer?.disconnect).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it('refits when opening notes reduces space and when the window is resized', async () => {
    const { user, canvas } = await openReader();
    await user.click(screen.getByRole('button', { name: 'Genişliğe sığdır' }));
    await waitFor(() => expect(parseFloat(canvas.style.width)).toBeCloseTo(940));
    await user.click(screen.getByRole('button', { name: 'Notlar' }));
    expect(screen.getByDisplayValue(item.notes)).toBeInTheDocument();
    stageWidth = 700;
    notifyResize();
    await waitFor(() => expect(parseFloat(canvas.style.width)).toBeCloseTo(640));
    stageWidth = 550;
    notifyResize();
    await waitFor(() => expect(parseFloat(canvas.style.width)).toBeCloseTo(490));
    await user.selectOptions(screen.getByRole('combobox'), 'fit-page');
    stageHeight = 500;
    notifyResize();
    await waitFor(() => expect(parseFloat(canvas.style.height)).toBeCloseTo(460));
  });

  it('zooms from the displayed fitted scale and lets the user return to fitting', async () => {
    const { user, canvas } = await openReader();
    const fittedScale = parseFloat(canvas.style.width) / 600;
    await user.click(screen.getByRole('button', { name: 'Yakınlaştır' }));
    await waitFor(() =>
      expect(parseFloat(canvas.style.width) / 600).toBeCloseTo(fittedScale + 0.25, 2),
    );
    await user.click(screen.getByRole('button', { name: 'Uzaklaştır' }));
    await waitFor(() => expect(parseFloat(canvas.style.width) / 600).toBeCloseTo(fittedScale, 2));
    await user.click(screen.getByRole('button', { name: 'Genişliğe sığdır' }));
    await waitFor(() => expect(parseFloat(canvas.style.width)).toBeCloseTo(940));
    expect(screen.getByRole('combobox')).toHaveValue('fit-width');
  });

  it('starts the next page at the top and ignores page shortcuts while editing', async () => {
    const { user, stage } = await openReader();
    stage.scrollTop = 650;
    stage.scrollLeft = 200;
    await user.click(screen.getByRole('button', { name: 'Sonraki sayfa' }));
    await waitFor(() => expect(mocks.queuePosition).toHaveBeenCalledWith(file.id, 2));
    expect(stage.scrollTop).toBe(0);
    expect(stage.scrollLeft).toBe(0);
    const pageInput = screen.getByRole('textbox', { name: 'Sayfa numarası' });
    fireEvent.keyDown(pageInput, { key: 'ArrowRight' });
    expect(pageInput).toHaveValue('2');
    fireEvent.keyDown(stage, { key: 'PageDown' });
    await waitFor(() => expect(mocks.queuePosition).toHaveBeenCalledWith(file.id, 3));
    expect(screen.getByRole('button', { name: 'Sonraki sayfa' })).toBeDisabled();
  });

  it('recovers from a page render failure by navigating to another page', async () => {
    mocks.render.mockImplementationOnce(() => ({
      promise: Promise.reject(new Error('Sayfa bozuk')),
      cancel: vi.fn(),
    }));
    const user = userEvent.setup();
    render(<PdfReader file={file} item={item} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sayfa bozuk');
    await user.click(screen.getByRole('button', { name: 'Sonraki sayfa' }));
    await waitFor(() => expect(mocks.queuePosition).toHaveBeenCalledWith(file.id, 2));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: `${item.title}, sayfa 2` })).toBeVisible();
  });

  it('discards a slow previous page after the user navigates onward', async () => {
    const slowPage = deferred<ReturnType<typeof pdfPage>>();
    mocks.getPage.mockImplementationOnce(() => slowPage.promise);
    const user = userEvent.setup();
    render(<PdfReader file={file} item={item} onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.getPage).toHaveBeenCalledWith(1));
    await user.click(screen.getByRole('button', { name: 'Sonraki sayfa' }));
    await waitFor(() => expect(mocks.queuePosition).toHaveBeenCalledWith(file.id, 2));
    await act(async () => slowPage.resolve(pdfPage(1)));
    expect(mocks.queuePosition).not.toHaveBeenCalledWith(file.id, 1);
    expect(mocks.render).toHaveBeenCalledOnce();
    expect(mocks.render).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: expect.objectContaining({ pageNumber: 2 }),
      }),
    );
    expect(screen.getByRole('img', { name: `${item.title}, sayfa 2` })).toBeVisible();
  });

  it('clears an obsolete password prompt after loading fails and allows a fresh retry', async () => {
    const pending = deferred<unknown>();
    const loading = {
      promise: pending.promise,
      destroy: mocks.destroy,
      onPassword: undefined as
        ((submit: (password: string) => void, reason: number) => void) | undefined,
    };
    mocks.getDocument.mockReturnValueOnce(loading);
    const user = userEvent.setup();
    render(<PdfReader file={file} item={item} onClose={vi.fn()} />);
    await waitFor(() => expect(loading.onPassword).toBeTypeOf('function'));
    act(() => loading.onPassword?.(vi.fn(), 1));
    expect(screen.getByLabelText('PDF parolası')).toBeInTheDocument();
    await act(async () => pending.reject(new Error('Dosya okunamadı')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dosya okunamadı');
    expect(screen.queryByLabelText('PDF parolası')).not.toBeInTheDocument();
    act(() => loading.onPassword?.(vi.fn(), 2));
    expect(screen.queryByLabelText('PDF parolası')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    await waitFor(() => expect(mocks.queuePosition).toHaveBeenCalledWith(file.id, 1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(mocks.getDocument).toHaveBeenCalledTimes(2);
  });

  it('cancels an active render on close without persisting an unseen page', async () => {
    const pending = deferred<void>();
    const cancel = vi.fn(() => pending.reject(new Error('Rendering cancelled')));
    mocks.render.mockReturnValue({ promise: pending.promise, cancel });
    const { unmount } = render(<PdfReader file={file} item={item} onClose={vi.fn()} />);
    await waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
    await act(async () => unmount());
    expect(cancel).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
    expect(mocks.queuePosition).not.toHaveBeenCalled();
  });
});
