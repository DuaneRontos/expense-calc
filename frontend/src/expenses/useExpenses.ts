import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../api/client';
import { ApiError } from '../api/problem';
import type { ExpensePage, ExpenseQuery, ExpenseSummary } from '../api/types';

/**
 * Loads a page of expenses and appends further pages on demand (issue #14).
 *
 * Everything about *which* expenses is the server's decision — this hook sends
 * query parameters and renders what comes back. It never filters, sorts, or
 * re-orders the rows it receives.
 */

export interface ExpenseList {
  items: ExpenseSummary[];
  /** First load, or a reload after the query changed. */
  loading: boolean;
  /** A further page arriving beneath rows that are already on screen. */
  loadingMore: boolean;
  error: ApiError | Error | null;
  totalItems: number;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

export function useExpenses(query: ExpenseQuery): ExpenseList {
  const [items, setItems] = useState<ExpenseSummary[]>([]);
  const [page, setPage] = useState<ExpensePage | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<ApiError | Error | null>(null);

  /**
   * Which query the rows on screen belong to.
   *
   * `loading` is derived from this rather than stored, so nothing has to set a
   * pending flag from inside an effect — the rows are stale exactly when they
   * came from a different query than the one being asked for now, which is a
   * fact about the data rather than a second piece of state that can disagree
   * with it.
   */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  /**
   * Discards responses from a query the user has already moved on from.
   *
   * Filters change faster than requests return. Without this, typing "SM" into
   * the merchant box can leave the results for "S" on screen — the second
   * request having been overtaken by the first — and the list then disagrees
   * with the controls above it, which reads as the filter being broken.
   */
  const generation = useRef(0);

  const serialized = JSON.stringify(query);
  const loading = loadedFor !== serialized;

  const load = useCallback(
    async (nextPage: number, append: boolean) => {
      const mine = ++generation.current;

      try {
        // Parsed from the serialized form rather than captured, so this closure
        // depends on exactly what identifies the query and nothing else — a
        // caller passing an inline object cannot make it refetch every render.
        const current = JSON.parse(serialized) as ExpenseQuery;
        const result = await api.expenses({ ...current, page: nextPage });
        if (mine !== generation.current) {
          return;
        }

        setPage(result);
        setItems((rows) => (append ? merge(rows, result.items) : result.items));
        // Cleared on success rather than up front: clearing before the request
        // would be a synchronous state write from the effect, and it would also
        // blank a visible error for however long the retry takes.
        setError(null);
      } catch (caught) {
        if (mine !== generation.current) {
          return;
        }
        setError(caught instanceof Error ? caught : new Error(String(caught)));
        if (!append) {
          setItems([]);
          setPage(null);
        }
      } finally {
        if (mine === generation.current) {
          setLoadingMore(false);
          if (!append) {
            // Marks the rows on screen as belonging to this query, which is
            // what clears `loading`. Set on failure too: an error state is a
            // settled answer, not a request still in flight.
            setLoadedFor(serialized);
          }
        }
      }
    },
    [serialized],
  );

  useEffect(() => {
    // `react-hooks/set-state-in-effect` cannot see through the `await` inside
    // `load`: every state write in it happens after the response arrives, which
    // is the sanctioned "call setState from the external system's callback"
    // shape rather than the cascading-render one the rule targets. The pending
    // flag it would otherwise object to is `loading`, and that is derived from
    // `loadedFor` precisely so nothing has to write it here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(0, false);
  }, [load]);

  const currentPage = page?.page ?? 0;
  const totalPages = page?.totalPages ?? 1;
  const hasMore = currentPage + 1 < totalPages;

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) {
      return;
    }
    setLoadingMore(true);
    void load(currentPage + 1, true);
  }, [loading, loadingMore, hasMore, currentPage, load]);

  const retry = useCallback(() => {
    setLoadedFor(null);
    void load(0, false);
  }, [load]);

  return {
    items,
    loading,
    loadingMore,
    error,
    totalItems: page?.totalItems ?? 0,
    hasMore,
    loadMore,
    retry,
  };
}

/**
 * Appends a page, dropping any row already on screen.
 *
 * The server appends `id` to every sort as a tiebreaker precisely so pages
 * cannot drop or duplicate rows, so this should never have anything to do. It
 * is here because the failure it prevents — two rows with the same React key —
 * throws a warning and renders wrongly, and because rows genuinely can shift
 * between requests when the underlying data changes mid-scroll.
 */
export function merge(current: ExpenseSummary[], incoming: ExpenseSummary[]): ExpenseSummary[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}
