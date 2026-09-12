import type { Category } from '@/lib/types';

export function categoryPath(categories: Category[], id: string): string {
  const names: string[] = [];
  const seen = new Set<string>();
  let current = categories.find((category) => category.id === id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = categories.find((category) => category.id === current?.parentId);
  }
  return names.join(' / ');
}

export function descendantIds(categories: Category[], id: string): Set<string> {
  const seen = new Set([id]);
  const pending = [id];
  while (pending.length) {
    const parent = pending.pop();
    for (const category of categories) {
      if (category.parentId === parent && !seen.has(category.id)) {
        seen.add(category.id);
        pending.push(category.id);
      }
    }
  }
  return seen;
}

export function categoryTree(categories: Category[]) {
  const ordered = [...categories].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'tr'),
  );
  const children = new Map<string, Category[]>();
  for (const category of ordered) {
    if (category.parentId)
      children.set(category.parentId, [...(children.get(category.parentId) ?? []), category]);
  }
  const result: { category: Category; depth: number }[] = [];
  const seen = new Set<string>();
  function visit(root: Category) {
    const pending = [{ category: root, depth: 0 }];
    while (pending.length) {
      const entry = pending.pop()!;
      if (seen.has(entry.category.id)) continue;
      seen.add(entry.category.id);
      result.push(entry);
      for (const child of [...(children.get(entry.category.id) ?? [])].reverse())
        pending.push({ category: child, depth: entry.depth + 1 });
    }
  }
  ordered.filter((category) => !category.parentId).forEach(visit);
  // Keep orphaned imported categories reachable if an older archive needs repair.
  ordered.filter((category) => !seen.has(category.id)).forEach(visit);
  return result;
}
