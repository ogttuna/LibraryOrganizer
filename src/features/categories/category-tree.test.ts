import { describe, expect, it } from 'vitest';
import type { Category } from '@/lib/types';
import { categoryPath, categoryTree, descendantIds } from './category-tree';
const category = (id: string, name: string, parentId: string | null): Category => ({
  id,
  name,
  parentId,
  count: 0,
  sortOrder: 0,
});

describe('category hierarchy', () => {
  it('distinguishes equal leaf names by full path and excludes every descendant from moves', () => {
    const categories = [
      category('a', 'Bilim', null),
      category('b', 'Yöntem', 'a'),
      category('c', 'Örnekler', 'b'),
      category('d', 'Sanat', null),
      category('e', 'Yöntem', 'd'),
    ];
    expect(categoryPath(categories, 'b')).toBe('Bilim / Yöntem');
    expect(categoryPath(categories, 'e')).toBe('Sanat / Yöntem');
    expect([...descendantIds(categories, 'a')]).toEqual(['a', 'b', 'c']);
    expect(categoryTree(categories).map(({ category, depth }) => [category.id, depth])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 0],
      ['e', 1],
    ]);
  });
  it('keeps malformed archive categories visible without looping', () => {
    const categories = [
      category('a', 'A', 'b'),
      category('b', 'B', 'a'),
      category('orphan', 'Yetim', 'missing'),
    ];
    expect(categoryTree(categories).length).toBe(3);
    expect(categoryPath(categories, 'a')).toBe('B / A');
    expect(descendantIds(categories, 'a').size).toBe(2);
  });
});
