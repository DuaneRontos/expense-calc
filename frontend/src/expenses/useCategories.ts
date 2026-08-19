import { useCallback, useEffect, useState } from 'react';

import { api } from '../api/client';
import type { CategoryView } from '../api/types';

/**
 * The taxonomy, from the server (spec §8).
 *
 * Fetched rather than hardcoded, which is the entire reason `/categories`
 * exists: a local copy drifts the first time a label changes, and drifts
 * silently — the picker keeps showing the old word while every report shows the
 * new one. The order is the server's too, matching what `sort=category`
 * produces, so a picker and a sorted list agree.
 */
export interface Categories {
  categories: CategoryView[];
  loading: boolean;
  /**
   * Set when the taxonomy could not be loaded.
   *
   * Reported rather than swallowed. A failure here is not worth an error screen
   * — the list still works and every other filter still works — but it used to
   * be indistinguishable from an empty taxonomy and lasted the whole session,
   * leaving a "Category" heading over nothing with no way to try again.
   */
  error: Error | null;
  retry: () => void;
}

export function useCategories(): Categories {
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;

    api
      .categories()
      .then((result) => {
        if (live) {
          setCategories(result);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (live) {
          setError(caught instanceof Error ? caught : new Error(String(caught)));
        }
      })
      .finally(() => {
        if (live) {
          setLoading(false);
        }
      });

    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setLoading(true);
    setAttempt((current) => current + 1);
  }, []);

  return { categories, loading, error, retry };
}
