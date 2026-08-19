import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import type { Category, ExpenseQuery, ExpenseSortSpec } from '../api/types';

/**
 * The live expense query, shared by the filter controls and the list.
 *
 * Lives above both because they are not in the same subtree: the filters are
 * chrome rendered by `AppShell` in the layout route, and the list is a screen
 * rendered by the navigator beneath it. This is the context mechanism the shell
 * refactor said #14 would need instead of a prop.
 *
 * **Filtering and sorting are the server's job** (issue #14). Nothing here
 * filters or sorts a list; it assembles query parameters and the list renders
 * whatever comes back.
 */

export const DEFAULT_SORT: ExpenseSortSpec = { field: 'occurredOn', direction: 'desc' };

interface ExpenseQueryValue {
  query: ExpenseQuery;
  /** Replaces the named filters and returns to the first page. */
  setFilters: (patch: Partial<ExpenseQuery>) => void;
  toggleCategory: (category: Category) => void;
  setSort: (sort: ExpenseSortSpec) => void;
  clear: () => void;
  /**
   * Bumped by {@link clear}. The filter inputs key off it so they remount with
   * empty drafts, rather than syncing their local state back from the query in
   * an effect — which is the cascading-render pattern React now warns about.
   */
  generation: number;
  /** How many filters are active, for a "Filters (3)" affordance. */
  activeFilterCount: number;
}

const ExpenseQueryContext = createContext<ExpenseQueryValue | null>(null);

const EMPTY: ExpenseQuery = { sort: DEFAULT_SORT };

export function countActive(query: ExpenseQuery): number {
  return [
    query.category?.length ? query.category : undefined,
    query.from,
    query.to,
    query.merchant,
    query.q,
    query.minAmount,
    query.maxAmount,
  ].filter((value) => value !== undefined && value !== '').length;
}

export function ExpenseQueryProvider({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState<ExpenseQuery>(EMPTY);
  const [generation, setGeneration] = useState(0);

  const setFilters = useCallback((patch: Partial<ExpenseQuery>) => {
    setQuery((current) => {
      const next = { ...current, ...patch };
      // Any filter change invalidates the pagination cursor: page 3 of the old
      // result set is not page 3 of the new one, and asking for it shows a
      // window into data the user did not ask for — or an empty page for a
      // filter that matched plenty.
      delete next.page;
      return next;
    });
  }, []);

  const toggleCategory = useCallback(
    (category: Category) => {
      setFilters({
        category: (() => {
          const current = query.category ?? [];
          return current.includes(category)
            ? current.filter((value) => value !== category)
            : [...current, category];
        })(),
      });
    },
    [query.category, setFilters],
  );

  const setSort = useCallback(
    (sort: ExpenseSortSpec) => {
      setFilters({ sort });
    },
    [setFilters],
  );

  const clear = useCallback(() => {
    setQuery(EMPTY);
    setGeneration((current) => current + 1);
  }, []);

  const value = useMemo(
    () => ({
      query,
      setFilters,
      toggleCategory,
      setSort,
      clear,
      generation,
      activeFilterCount: countActive(query),
    }),
    [query, setFilters, toggleCategory, setSort, clear, generation],
  );

  return <ExpenseQueryContext.Provider value={value}>{children}</ExpenseQueryContext.Provider>;
}

export function useExpenseQuery(): ExpenseQueryValue {
  const value = useContext(ExpenseQueryContext);
  if (!value) {
    throw new Error('useExpenseQuery must be used inside an ExpenseQueryProvider.');
  }
  return value;
}
