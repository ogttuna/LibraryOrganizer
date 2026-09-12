import { describe, expect, it } from 'vitest';
import { filterPreview } from './preview-backend';
import { defaultQuery, type Item } from './types';

const item: Item = {
  id: '1',
  title: 'Öğrenme Işık İstanbul',
  kind: 'book',
  authors: ['Yazar'],
  year: 2024,
  language: 'Türkçe',
  description: '',
  summary: '',
  notes: 'Örneklem seçimi',
  readingStatus: 'reading',
  isFavorite: true,
  createdAt: new Date().toISOString(),
  updatedAt: '',
  deletedAt: null,
  categoryIds: ['child'],
  tagIds: ['a', 'b'],
  attachments: [],
};
const data = {
  items: [item, { ...item, id: '2', title: 'Çöpte', deletedAt: new Date().toISOString() }],
  categories: [
    { id: 'root', name: 'Bilim', parentId: null, sortOrder: 0, count: 0 },
    { id: 'child', name: 'Psikoloji', parentId: 'root', sortOrder: 0, count: 1 },
  ],
  tags: [
    { id: 'a', name: 'metodoloji', count: 1 },
    { id: 'b', name: 'referans', count: 1 },
  ],
};
describe('Preview query semantics', () => {
  it('matches Turkish normalized prefixes across notes, titles and labels', () => {
    expect(
      filterPreview(data, { ...defaultQuery, q: 'ogren isik istan orneklem metodoloji' }).map(
        (i) => i.id,
      ),
    ).toEqual(['1']);
    expect(filterPreview(data, { ...defaultQuery, q: 'renme' })).toHaveLength(0);
  });
  it('combines groups with AND, descendants optionally and tags all/any', () => {
    expect(
      filterPreview(data, { ...defaultQuery, categoryIds: ['root'], tagIds: ['a', 'b'] }),
    ).toHaveLength(1);
    expect(
      filterPreview(data, { ...defaultQuery, categoryIds: ['root'], includeDescendants: false }),
    ).toHaveLength(0);
    expect(filterPreview(data, { ...defaultQuery, tagIds: ['a', 'missing'] })).toHaveLength(0);
    expect(
      filterPreview(data, { ...defaultQuery, tagIds: ['a', 'missing'], tagMode: 'any' }),
    ).toHaveLength(1);
    expect(filterPreview(data, { ...defaultQuery, readingStatus: 'read' })).toHaveLength(0);
  });
  it('keeps trash isolated from live results', () => {
    expect(filterPreview(data, { ...defaultQuery, view: 'trash' }).map((i) => i.id)).toEqual(['2']);
  });
});
