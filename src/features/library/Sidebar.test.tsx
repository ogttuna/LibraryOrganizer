import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';
import { useUI } from '@/lib/ui-store';
import { defaultQuery, type Catalog } from '@/lib/types';

vi.mock('@/lib/backend', () => ({ isDesktop: true }));

const catalog: Catalog = {
  categories: [
    { id: 'narcissism', name: 'Narsisizm', parentId: null, count: 14, sortOrder: 0 },
    {
      id: 'vulnerable',
      name: 'Kırılgan narsisizm',
      parentId: 'narcissism',
      count: 3,
      sortOrder: 0,
    },
    { id: 'attachment', name: 'Bağlanma', parentId: null, count: 4, sortOrder: 1 },
    ...Array.from({ length: 25 }, (_, index) => ({
      id: `category-${index}`,
      name: `Konu ${String(index + 1).padStart(2, '0')}`,
      parentId: null,
      count: index + 1,
      sortOrder: index + 2,
    })),
    { id: 'learning', name: 'Öğrenme', parentId: null, count: 1, sortOrder: 99 },
  ],
  tags: [
    ...Array.from({ length: 228 }, (_, index) => ({
      id: `tag-${index}`,
      name: `konu ${String(index + 1).padStart(3, '0')}`,
      count: 1,
    })),
    { id: 'light', name: 'Işık', count: 2 },
  ],
  stats: {
    total: 47,
    favorites: 1,
    unread: 44,
    reading: 2,
    read: 1,
    trash: 0,
    uncategorized: 1,
    recent: 46,
  },
};

function setup(data = catalog) {
  const callbacks = {
    navigate: vi.fn(),
    navigateTag: vi.fn(),
    onCategory: vi.fn(),
    onTags: vi.fn(),
    onSettings: vi.fn(),
  };
  render(<Sidebar catalog={data} {...callbacks} />);
  return { user: userEvent.setup(), ...callbacks };
}

function categoryTab() {
  return screen.getByRole('tab', { name: /^Kategoriler/ });
}

function tagTab() {
  return screen.getByRole('tab', { name: /^Etiketler/ });
}

afterEach(cleanup);
beforeEach(() => {
  useUI.setState({ query: { ...defaultQuery, categoryIds: [], tagIds: [] }, sidebarOpen: false });
});

describe('Sidebar taxonomy browsing', () => {
  it('gives categories and tags their own visible navigation without truncating either collection', async () => {
    const { user } = setup();
    expect(screen.getByRole('tablist', { name: 'Kütüphaneyi düzenle' })).toBeInTheDocument();
    expect(categoryTab()).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('navigation', { name: 'Etiketler' })).not.toBeInTheDocument();

    const categories = within(screen.getByRole('navigation', { name: 'Kategoriler' }));
    for (const category of catalog.categories) {
      expect(
        categories.getByRole('button', { name: new RegExp(`^${category.name}\\s*\\d*$`) }),
      ).toBeInTheDocument();
    }

    await user.click(tagTab());
    expect(tagTab()).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('navigation', { name: 'Kategoriler' })).not.toBeInTheDocument();
    const tags = within(screen.getByRole('navigation', { name: 'Etiketler' }));
    expect(tags.getAllByRole('button')).toHaveLength(229);
    expect(tags.getByRole('button', { name: /^konu 228\s*1$/ })).toBeInTheDocument();
    expect(tags.getByRole('button', { name: /^Işık\s*2$/ })).toBeInTheDocument();
  });

  it('retains separate Turkish searches and all selected filters when changing tabs', async () => {
    const query = {
      ...defaultQuery,
      q: 'kişisel not',
      categoryIds: ['narcissism', 'attachment'],
      tagIds: ['tag-0', 'light'],
      tagMode: 'any' as const,
      readingStatus: 'reading' as const,
    };
    useUI.setState({ query });
    const { user, navigate, navigateTag } = setup();
    await user.type(screen.getByRole('textbox', { name: 'Kategorilerde ara' }), 'ogrenme');
    expect(
      within(screen.getByRole('navigation', { name: 'Kategoriler' })).getByRole('button', {
        name: /^Öğrenme\s*1$/,
      }),
    ).toBeInTheDocument();
    await user.click(tagTab());
    await user.type(screen.getByRole('textbox', { name: 'Gezinmede etiket ara' }), 'isik');
    expect(
      within(screen.getByRole('navigation', { name: 'Etiketler' })).getByRole('button', {
        name: /^Işık\s*2$/,
      }),
    ).toHaveAttribute('aria-current', 'page');
    await user.click(categoryTab());
    expect(screen.getByRole('textbox', { name: 'Kategorilerde ara' })).toHaveValue('ogrenme');
    await user.click(tagTab());
    expect(screen.getByRole('textbox', { name: 'Gezinmede etiket ara' })).toHaveValue('isik');
    expect(useUI.getState().query).toEqual(query);
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateTag).not.toHaveBeenCalled();
  });

  it('opens tags initially when the library is filtered only by tags', () => {
    useUI.getState().setQuery({ tagIds: ['light'] });
    setup();
    expect(tagTab()).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('navigation', { name: 'Etiketler' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Kategoriler' })).not.toBeInTheDocument();
  });

  it('activates and focuses tabs with arrow, Home and End keys without applying filters', async () => {
    const { user, navigate, navigateTag } = setup();
    await user.click(categoryTab());
    await user.keyboard('{ArrowRight}');
    expect(tagTab()).toHaveFocus();
    expect(tagTab()).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowLeft}');
    expect(categoryTab()).toHaveFocus();
    expect(categoryTab()).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(tagTab()).toHaveFocus();
    expect(tagTab()).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(categoryTab()).toHaveFocus();
    expect(categoryTab()).toHaveAttribute('aria-selected', 'true');
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateTag).not.toHaveBeenCalled();
    expect(useUI.getState().query).toEqual(defaultQuery);
  });

  it('reveals a searched descendant of a collapsed category and keeps the collapse after clearing search', async () => {
    const { user, navigate } = setup();
    await user.click(screen.getByRole('button', { name: 'Narsisizm alt kategorilerini gizle' }));
    expect(
      screen.queryByRole('button', { name: /^Kırılgan narsisizm\s*3$/ }),
    ).not.toBeInTheDocument();
    const search = screen.getByRole('textbox', { name: 'Kategorilerde ara' });
    await user.type(search, 'kirilgan');
    await user.click(screen.getByRole('button', { name: /^Kırılgan narsisizm\s*3$/ }));
    expect(navigate).toHaveBeenCalledExactlyOnceWith('all', ['vulnerable']);
    await user.clear(search);
    expect(
      screen.queryByRole('button', { name: /^Kırılgan narsisizm\s*3$/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Narsisizm alt kategorilerini göster' }));
    expect(screen.getByRole('button', { name: /^Kırılgan narsisizm\s*3$/ })).toBeInTheDocument();
  });

  it('creates, edits and adds children through the contextual category actions without navigating', async () => {
    const { user, onCategory, navigate } = setup();
    await user.click(screen.getByRole('button', { name: 'Kategori oluştur' }));
    expect(onCategory).toHaveBeenLastCalledWith();
    await user.click(screen.getByRole('button', { name: 'Narsisizm kategori işlemleri' }));
    await user.click(screen.getByRole('button', { name: 'Düzenle' }));
    expect(onCategory).toHaveBeenLastCalledWith(catalog.categories[0]);
    expect(screen.queryByRole('button', { name: 'Düzenle' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Narsisizm kategori işlemleri' }));
    await user.click(screen.getByRole('button', { name: 'Alt kategori ekle' }));
    expect(onCategory).toHaveBeenLastCalledWith(undefined, 'narcissism');
    expect(screen.queryByRole('button', { name: 'Alt kategori ekle' })).not.toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('finds and selects a tag at the end of a large catalog and exposes tag management', async () => {
    const { user, navigateTag, onTags } = setup();
    await user.click(tagTab());
    await user.type(screen.getByRole('textbox', { name: 'Gezinmede etiket ara' }), 'konu 228');
    await user.click(screen.getByRole('button', { name: /^konu 228\s*1$/ }));
    expect(navigateTag).toHaveBeenCalledExactlyOnceWith('tag-227');
    await user.click(screen.getByRole('button', { name: 'Etiketleri yönet' }));
    expect(onTags).toHaveBeenCalledOnce();
  });

  it('shows no-results feedback while preserving selected categories and tags', async () => {
    useUI.getState().setQuery({ categoryIds: ['narcissism'], tagIds: ['light', 'tag-0'] });
    const { user, navigate, navigateTag } = setup();
    await user.type(screen.getByRole('textbox', { name: 'Kategorilerde ara' }), 'bulunmayankonu');
    expect(screen.getByText('Kategori bulunamadı.')).toBeInTheDocument();
    await user.click(tagTab());
    await user.type(
      screen.getByRole('textbox', { name: 'Gezinmede etiket ara' }),
      'bulunmayanetiket',
    );
    expect(screen.getByText('Etiket bulunamadı.')).toBeInTheDocument();
    expect(useUI.getState().query.categoryIds).toEqual(['narcissism']);
    expect(useUI.getState().query.tagIds).toEqual(['light', 'tag-0']);
    expect(navigate).not.toHaveBeenCalled();
    expect(navigateTag).not.toHaveBeenCalled();
  });

  it('lets an empty library create its first category and reach tag management', async () => {
    const { user, onCategory, onTags } = setup({ ...catalog, categories: [], tags: [] });
    await user.click(screen.getByRole('button', { name: 'İlk kategorini oluştur' }));
    expect(onCategory).toHaveBeenCalledExactlyOnceWith();
    await user.click(tagTab());
    expect(screen.getByRole('navigation', { name: 'Etiketler' })).toBeInTheDocument();
    expect(screen.getByText('Kaynak ayrıntılarında etiket ekleyebilirsiniz.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Etiketleri yönet' }));
    expect(onTags).toHaveBeenCalledOnce();
  });
});
