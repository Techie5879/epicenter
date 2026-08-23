import { QueryClient } from '@tanstack/svelte-query';
import { createQueryFactories } from 'wellcrafted/query';
export const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 30_000,
			refetchOnWindowFocus: true,
		},
	},
});

export const { defineQuery, defineMutation } =
	createQueryFactories(queryClient);
