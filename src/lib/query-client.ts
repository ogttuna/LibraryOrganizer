import { QueryClient } from '@tanstack/react-query';
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: 'always', staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
    mutations: { networkMode: 'always', retry: false },
  },
});
export async function refreshLibrary() {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['library'] }),
    queryClient.invalidateQueries({ queryKey: ['catalog'] }),
    queryClient.invalidateQueries({ queryKey: ['item'] }),
  ]);
}
