import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import { ApiError } from '../api/problem';
import type { ExpenseDetail } from '../api/types';

/**
 * Loads one expense with its classification history (spec §8).
 *
 * The history comes with the expense rather than behind a second request — it
 * is bounded by how many times a person reclassified one row, and the reason a
 * category is what it is has no value if fetching it is a round trip nobody
 * makes.
 */
export function useExpenseDetail(id: string | undefined) {
  const [expense, setExpense] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | Error | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      return;
    }
    try {
      const result = await api.expense(id);
      setExpense(result);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /**
   * Replaces the loaded expense with one a write just returned.
   *
   * Every write endpoint answers with the full {@link ExpenseDetail}, including
   * the history, so a refetch after saving would ask for something already in
   * hand — and would briefly show stale values while it was in flight.
   */
  const replace = useCallback((updated: ExpenseDetail) => {
    setExpense(updated);
  }, []);

  return { expense, loading, error, reload: load, replace };
}
