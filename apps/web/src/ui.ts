export const card = 'rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900';
export const input = 'w-full rounded border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700';
export const primaryBtn =
  'shrink-0 whitespace-nowrap rounded bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900';
export const secondaryBtn =
  'shrink-0 whitespace-nowrap rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800';
export const listItem = (active: boolean) =>
  `w-full rounded px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${active ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : ''}`;
export const emptyState = 'rounded-lg border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700';
