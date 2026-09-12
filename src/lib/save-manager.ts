import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import type { LibraryPage } from './types';
import { Autosave } from './autosave';
import { backend } from './backend';
import { queryClient } from './query-client';
export const saves = new Autosave(
  backend.updateItem,
  (item) => {
    queryClient.setQueryData(['item', item.id], item);
    queryClient.setQueriesData<LibraryPage>({ queryKey: ['library'] }, (page) =>
      page
        ? { ...page, items: page.items.map((entry) => (entry.id === item.id ? item : entry)) }
        : page,
    );
    toast.dismiss(`save-${item.id}`);
    void queryClient.invalidateQueries({ queryKey: ['library'] });
    void queryClient.invalidateQueries({ queryKey: ['catalog'] });
  },
  500,
  (id, message) =>
    toast.error('Değişiklik kaydedilemedi', {
      id: `save-${id}`,
      description: message,
      duration: Infinity,
      action: {
        label: 'Yeniden dene',
        onClick: () => {
          void saves.flush(id).catch(() => {});
        },
      },
    }),
);
export function useSaveState(id?: string) {
  useSyncExternalStore(saves.subscribe, saves.snapshot, saves.snapshot);
  return id ? saves.get(id) : undefined;
}
