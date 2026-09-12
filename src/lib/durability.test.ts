import { describe, expect, it } from 'vitest';
import { previewBackend as backend } from './preview-backend';
import { defaultQuery } from './types';

describe('library editing journeys', () => {
  it('keeps description, summary, notes and memberships distinct through search, rename, trash and restore', async () => {
    const unique = crypto.randomUUID();
    const item = await backend.createItem(`Kaynak ${unique}`, 'article');
    const category = await backend.saveCategory({ name: `Araştırma ${unique}`, parentId: null });
    const other = await backend.saveCategory({ name: `Kitaplar ${unique}`, parentId: null });
    await backend.updateItem(item.id, {
      description: 'Açıklama: öğrenme',
      summary: 'Özet: yöntem',
      notes: 'Not: Işık İstanbul örneklem',
      categoryIds: [category, other],
      tagNames: [`Etiket ${unique}`],
      readingStatus: 'read',
    });
    const catalog = await backend.getCatalog();
    const tag = catalog.tags.find((t) => t.name === `Etiket ${unique}`)!;
    const matches = await backend.queryLibrary({
      ...defaultQuery,
      q: 'isik istanbul orneklem',
      categoryIds: [category],
      tagIds: [tag.id],
      readingStatus: 'read',
    });
    expect(matches.items.map((i) => i.id)).toContain(item.id);
    await backend.saveTag({ id: tag.id, name: `Değişen ${unique}` });
    await backend.updateItem(item.id, { categoryIds: [other] });
    await backend.deleteCategory(category);
    await backend.bulkUpdate({ itemIds: [item.id], trashed: true });
    expect(
      (await backend.queryLibrary({ ...defaultQuery, view: 'trash', q: unique })).items.map(
        (i) => i.id,
      ),
    ).toContain(item.id);
    await backend.bulkUpdate({ itemIds: [item.id], trashed: false });
    const restored = await backend.getItem(item.id);
    expect(restored).toMatchObject({
      description: 'Açıklama: öğrenme',
      summary: 'Özet: yöntem',
      notes: 'Not: Işık İstanbul örneklem',
      categoryIds: [other],
      tagIds: [tag.id],
      readingStatus: 'read',
    });
    await backend.deleteTag(tag.id);
    expect((await backend.getItem(item.id)).tagIds).toEqual([]);
    expect((await backend.getItem(item.id)).notes).toBe(restored.notes);
  });
  it('rejects category collisions without partial changes', async () => {
    const unique = crypto.randomUUID();
    const parent = await backend.saveCategory({ name: `Üst ${unique}`, parentId: null });
    const child = await backend.saveCategory({ name: `Çakışma ${unique}`, parentId: parent });
    await backend.saveCategory({ name: `Çakışma ${unique}`, parentId: null });
    await expect(backend.deleteCategory(parent)).rejects.toThrow('aynı adda');
    expect((await backend.getCatalog()).categories.find((c) => c.id === child)?.parentId).toBe(
      parent,
    );
    await expect(backend.saveTag({ id: 'missing', name: 'Yeni ad' })).rejects.toThrow('bulunamadı');
  });
});
