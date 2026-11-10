export const card =
  'rounded-xl border border-neutral-200 bg-white p-3 shadow-sm transition-shadow dark:border-neutral-800 dark:bg-neutral-900';
export const input =
  'w-full rounded-lg border border-neutral-300 bg-transparent px-2 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 dark:border-neutral-700 dark:focus-visible:ring-neutral-600';
export const primaryBtn =
  'shrink-0 whitespace-nowrap rounded-lg bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700 active:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300 dark:active:bg-neutral-200';
export const secondaryBtn =
  'shrink-0 whitespace-nowrap rounded-lg border border-neutral-300 px-3 py-1.5 text-sm transition-colors hover:bg-neutral-50 hover:border-neutral-400 disabled:cursor-not-allowed disabled:opacity-40 dark:border-neutral-700 dark:hover:bg-neutral-800/60 dark:hover:border-neutral-600';
export const listItem = (active: boolean) =>
  `w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${active ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : ''}`;
export const emptyState =
  'rounded-xl border border-dashed border-neutral-300 p-10 text-center text-sm text-neutral-500 dark:border-neutral-700';
export const fieldLabel = 'text-xs font-medium text-neutral-600 dark:text-neutral-400';
export const fieldHint = 'block text-xs text-neutral-400';
