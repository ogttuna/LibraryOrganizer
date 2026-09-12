import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import { saves, useSaveState } from '@/lib/save-manager';
import { queryClient } from '@/lib/query-client';
import type { Item, ItemPatch } from '@/lib/types';
import { ItemNotes } from './ItemNotes';

const mocks = vi.hoisted(() => ({ updateItem: vi.fn() }));
vi.mock('@/lib/backend', () => ({ backend: mocks }));
vi.mock('sonner', () => ({ toast: { dismiss: vi.fn(), error: vi.fn() } }));

let sequence = 0;
let source: Item;
beforeEach(() => {
  source = {
    id: `notes-${sequence++}`,
    title: 'Deneme kaynağı',
    notes: 'Öğrenme üzerine ilk düşünce.',
    description: 'Kaynağın konusu',
    summary: 'İçeriğin özeti',
  } as Item;
  mocks.updateItem.mockReset().mockImplementation(async (id: string, patch: ItemPatch) => ({
    ...source,
    id,
    ...patch,
  }));
});
afterEach(async () => {
  mocks.updateItem.mockImplementation(async (id: string, patch: ItemPatch) => ({
    ...source,
    id,
    ...patch,
  }));
  await act(() => saves.flushAll());
  cleanup();
  queryClient.clear();
});

function Notes({ item = source, page }: { item?: Item; page?: number }) {
  const { data } = useQuery({
    queryKey: ['item', item.id],
    queryFn: async () => item,
    initialData: item,
    staleTime: Infinity,
  });
  const pending = useSaveState(item.id);
  return <ItemNotes itemId={item.id} value={pending?.patch.notes ?? data.notes} page={page} />;
}

function editor(item = source, page?: number) {
  return (
    <QueryClientProvider client={queryClient}>
      <Notes key={item.id} item={item} page={page} />
    </QueryClientProvider>
  );
}

describe('Item notes editing', () => {
  it.each(['ctrlKey', 'metaKey'])(
    '%s+S saves immediately without browser save or changing other fields',
    async (modifier) => {
      const bubbled = vi.fn();
      render(<div onKeyDown={bubbled}>{editor()}</div>);
      const input = screen.getByRole('textbox', { name: 'Kişisel notlar' });
      fireEvent.change(input, { target: { value: 'Yeni yorum — İstanbul 📚' } });
      expect(mocks.updateItem).not.toHaveBeenCalled();
      expect(fireEvent.keyDown(input, { key: 's', [modifier]: true })).toBe(false);
      expect(bubbled).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(mocks.updateItem).toHaveBeenCalledExactlyOnceWith(source.id, {
          notes: 'Yeni yorum — İstanbul 📚',
        }),
      );
      await waitFor(() =>
        expect(screen.getByRole('status')).toHaveTextContent('Tüm değişiklikler kaydedildi'),
      );
      expect(input).toHaveValue('Yeni yorum — İstanbul 📚');
      expect(queryClient.getQueryData<Item>(['item', source.id])).toMatchObject({
        description: 'Kaynağın konusu',
        summary: 'İçeriğin özeti',
      });
    },
  );

  it('inserts a page heading at the caret without replacing selected notes and returns focus', () => {
    source.notes = 'Önce\n\nSonra';
    render(editor(source, 12));
    const input = screen.getByRole('textbox', { name: 'Kişisel notlar' }) as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(6, 11);
    fireEvent.click(screen.getByRole('button', { name: 'Sayfa 12 başlığı ekle' }));
    expect(input).toHaveValue('Önce\n\nSayfa 12\n\nSonra');
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(15);
    expect(input.selectionEnd).toBe(15);
    expect(screen.getByText('4 sözcük')).toBeInTheDocument();
  });

  it('retains the exact failed draft and retries it visibly', async () => {
    mocks.updateItem.mockRejectedValueOnce(new Error('Disk dolu'));
    render(editor());
    const input = screen.getByRole('textbox', { name: 'Kişisel notlar' });
    const notes = 'Silinmemeli\nTürkçe / 日本語 / مرحبا / 📚';
    fireEvent.change(input, { target: { value: notes } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk dolu');
    expect(input).toHaveValue(notes);
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(input).toHaveValue(notes);
    expect(mocks.updateItem).toHaveBeenLastCalledWith(source.id, { notes });
    expect(saves.get(source.id)?.status).toBe('saved');
  });

  it('keeps drafts attached to their source when switching before debounce completes', async () => {
    const second = { ...source, id: `${source.id}-second`, notes: 'Başka kaynak notu' };
    const { rerender } = render(editor());
    fireEvent.change(screen.getByRole('textbox', { name: 'Kişisel notlar' }), {
      target: { value: 'İlk kaynak taslağı' },
    });
    rerender(editor(second));
    expect(screen.getByRole('textbox', { name: 'Kişisel notlar' })).toHaveValue(
      'Başka kaynak notu',
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Kişisel notlar' }), {
      target: { value: 'İkinci kaynak taslağı' },
    });
    rerender(editor());
    expect(screen.getByRole('textbox', { name: 'Kişisel notlar' })).toHaveValue(
      'İlk kaynak taslağı',
    );
    await act(() => saves.flushAll());
    expect(mocks.updateItem).toHaveBeenCalledWith(source.id, { notes: 'İlk kaynak taslağı' });
    expect(mocks.updateItem).toHaveBeenCalledWith(second.id, { notes: 'İkinci kaynak taslağı' });
  });

  it('saves clearing the last note and updates the word count to zero', async () => {
    render(editor());
    fireEvent.change(screen.getByRole('textbox', { name: 'Kişisel notlar' }), {
      target: { value: '' },
    });
    expect(screen.getByText('0 sözcük')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(saves.get(source.id)?.status).toBe('saved'));
    expect(mocks.updateItem).toHaveBeenCalledExactlyOnceWith(source.id, { notes: '' });
    expect(screen.getByRole('textbox', { name: 'Kişisel notlar' })).toHaveValue('');
  });
});
