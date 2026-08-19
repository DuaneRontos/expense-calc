import { useEffect, useState } from 'react';

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
export function useCategories(): { categories: CategoryView[]; loading: boolean } {
  const [categories, setCategories] = useState<CategoryView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;

    api
      .categories()
      .then((result) => {
        if (live) {
          setCategories(result);
        }
      })
      .catch(() => {
        // A failed taxonomy is not worth an error screen: the list still works,
        // the category filter is simply unavailable until the next attempt.
        if (live) {
          setCategories([]);
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
  }, []);

  return { categories, loading };
}
