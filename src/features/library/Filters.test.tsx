import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActiveFilters, Filters } from './Filters';
import { useUI } from '@/lib/ui-store';
import { defaultQuery, type Catalog } from '@/lib/types';
const catalog: Catalog = {
  categories: [
    { id: 'root', name: 'Bilim', parentId: null, count: 1, sortOrder: 0 },
    { id: 'child', name: 'Öğrenme', parentId: 'root', count: 1, sortOrder: 0 },
  ],
  tags: [
    { id: 'light', name: 'Işık', count: 1 },
    { id: 'study', name: 'araştırma', count: 1 },
  ],
  stats: {
    total: 1,
    favorites: 0,
    unread: 1,
    reading: 0,
    read: 0,
    trash: 0,
    uncategorized: 0,
    recent: 1,
  },
};
afterEach(cleanup);
beforeEach(() => useUI.setState({ query: { ...defaultQuery }, selectedIds: [] }));
it('clears the visible search and every active filter together', async () => {
  const clearSearch = vi.fn();
  useUI.getState().setQuery({
    q: 'notlar',
    readingStatus: 'read',
    categoryIds: ['child'],
    tagIds: ['light'],
    format: 'pdf',
  });
  render(<ActiveFilters catalog={catalog} onClearSearch={clearSearch} />);
  expect(
    screen.getByRole('button', { name: 'Bilim / Öğrenme filtresini kaldır' }),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Okundu filtresini kaldır' })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Tümünü temizle' }));
  expect(useUI.getState().query).toEqual(defaultQuery);
  expect(clearSearch).toHaveBeenCalledOnce();
});
it('searches Turkish taxonomy without losing selected tags or changing all/any semantics', async () => {
  const user = userEvent.setup();
  render(<Filters catalog={catalog} />);
  await user.click(screen.getByRole('button', { name: 'Filtreler' }));
  await user.type(screen.getByRole('textbox', { name: 'Filtrelerde kategori ara' }), 'ogrenme');
  await user.click(screen.getByRole('checkbox', { name: 'Bilim / Öğrenme' }));
  await user.type(screen.getByRole('textbox', { name: 'Filtrelerde etiket ara' }), 'isik');
  await user.click(screen.getByRole('checkbox', { name: 'Işık' }));
  await user.clear(screen.getByRole('textbox', { name: 'Filtrelerde etiket ara' }));
  await user.click(screen.getByRole('checkbox', { name: 'araştırma' }));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Etiket eşleştirme' }), 'any');
  expect(useUI.getState().query.categoryIds).toEqual(['child']);
  expect(useUI.getState().query.tagIds).toEqual(['light', 'study']);
  expect(useUI.getState().query.tagMode).toBe('any');
  await user.type(screen.getByRole('textbox', { name: 'Filtrelerde etiket ara' }), 'olmayan');
  expect(screen.getByText('Etiket bulunamadı.')).toBeInTheDocument();
  expect(useUI.getState().query.tagIds).toEqual(['light', 'study']);
});
