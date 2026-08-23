import Head from 'expo-router/head';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { ExpenseRow } from '../../src/expenses/ExpenseRow';
import { SortControl } from '../../src/expenses/SortControl';
import { useExpenseQuery } from '../../src/expenses/ExpenseQueryProvider';
import { useExpenses } from '../../src/expenses/useExpenses';
import { ApiError } from '../../src/api/problem';
import { MIN_TOUCH_TARGET } from '../../src/layout/breakpoints';
import { webTitleFor } from '../../src/layout/navigation';
import { palette, spacing } from '../../src/theme/tokens';
import type { ExpenseSummary } from '../../src/api/types';

/**
 * The expense list (issue #14).
 *
 * **Filtering, sorting and paging all happen server-side.** This screen sends
 * query parameters and renders what comes back, in the order it comes back —
 * spec §3 puts that work on the backend so the three targets cannot disagree,
 * and spec §6 gives every sort an `id` tiebreaker so pages cannot drop or
 * duplicate rows.
 *
 * A `FlatList` rather than the shell's `ScrollView`, which is why the shell
 * stopped supplying one: a list that can reach 50,000 rows must not render them
 * all to measure itself.
 */
/**
 * Hoisted so they keep one identity across renders.
 *
 * This screen re-renders on every debounce settle, every filter change and
 * every `loadingMore` flip, and `VirtualizedList` threads `renderItem` down to
 * each mounted cell — so a fresh identity re-renders every cell, which is
 * precisely the work `ExpenseRow`'s `memo` exists to avoid.
 */
const keyExtractor = (item: ExpenseSummary) => item.id;

const renderItem = ({ item }: { item: ExpenseSummary }) => <ExpenseRow expense={item} />;

const styles = StyleSheet.create({
  list: { flex: 1 },
  // No `gap`: the rows carry their own vertical padding.
  content: { padding: spacing.md },
});

export default function Expenses() {
  const { query, activeFilterCount, clear } = useExpenseQuery();
  // No `refreshing`/`onRefresh`: `loading` is true for *every* query change, so
  // wiring it to a `RefreshControl` dropped the pull-to-refresh spinner in and
  // shifted the content down whenever a filter settled, as though the user had
  // pulled. The overlay spinner below covers the first load, and the footer
  // covers appends.
  const { items, loading, loadingMore, error, totalItems, hasMore, loadMore, retry } =
    useExpenses(query);

  /**
   * Refetches when the list comes back into view.
   *
   * Nav between destinations uses `router.navigate`, which returns to the
   * *existing* list instance rather than mounting a new one, and `useExpenses`
   * only refetches when the query changes. So recording an expense and tapping
   * Expenses showed the old rows and the old count, with the new row nowhere —
   * the create and edit screens write, and nothing told the list.
   */
  useFocusEffect(
    useCallback(() => {
      retry();
    }, [retry]),
  );

  return (
    <>
      <Head>
        <title>{webTitleFor('expenses')}</title>
      </Head>

      <FlatList
        data={items}
        // Without `flex: 1` the list sizes to its content instead of to the
        // space it was given, and Expo's web reset sets `body { overflow:
        // hidden }` — so everything past the first screenful rendered into a
        // region nothing could scroll to. With 10 rows it looked correct; the
        // API was already returning 50.
        style={styles.list}
        // `keyExtractor` is the server's own id, which is also the tiebreaker it
        // appends to every sort — so a row keeps its key across pages and
        // reorderings.
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Record a new expense"
              onPress={() => router.push('/expenses/new')}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                justifyContent: 'center',
                alignSelf: 'flex-start',
                paddingHorizontal: spacing.md,
                borderRadius: 6,
                backgroundColor: palette.accent,
              }}
            >
              <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>New expense</Text>
            </Pressable>

            <SortControl />
            <Text style={{ color: palette.textMuted, fontSize: 12 }}>
              {loading
                ? 'Loading…'
                : `${totalItems} ${totalItems === 1 ? 'expense' : 'expenses'}${
                    activeFilterCount > 0
                      ? ` matching ${activeFilterCount} ${activeFilterCount === 1 ? 'filter' : 'filters'}`
                      : ''
                  }`}
            </Text>
          </View>
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState error={error} activeFilterCount={activeFilterCount} onClear={clear} onRetry={retry} />
          )
        }
        ListFooterComponent={
          <View style={{ paddingVertical: spacing.lg, alignItems: 'center' }}>
            {loadingMore ? <ActivityIndicator color={palette.accent} /> : null}
            {/*
              A failed *append* keeps the rows already on screen, so it has
              nowhere to surface: the empty state only mounts at zero rows, and
              `onEndReached` will not fire again without a scroll or content-size
              change — so the list silently stopped at 50 while the header said
              70, and scrolling at the bottom did not retry it.
            */}
            {error && items.length > 0 && !loadingMore ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Could not load more expenses. Retry."
                onPress={loadMore}
                style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
              >
                <Text style={{ color: palette.negative }}>
                  Could not load more. Tap to retry.
                </Text>
              </Pressable>
            ) : null}
            {!loading && !hasMore && items.length > 0 ? (
              <Text style={{ color: palette.textMuted, fontSize: 12 }}>
                End of {totalItems} {totalItems === 1 ? 'expense' : 'expenses'}.
              </Text>
            ) : null}
          </View>
        }
        // Fires once per scroll toward the end; the hook itself refuses to
        // stack requests while one is in flight or when the last page is in.
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
      />

      {loading && items.length === 0 ? (
        <View style={{ position: 'absolute', top: spacing.xl * 3, left: 0, right: 0, alignItems: 'center' }}>
          <ActivityIndicator color={palette.accent} />
        </View>
      ) : null}
    </>
  );
}

function EmptyState({
  error,
  activeFilterCount,
  onClear,
  onRetry,
}: {
  error: Error | null;
  activeFilterCount: number;
  onClear: () => void;
  onRetry: () => void;
}) {
  if (error) {
    // Spec §8: the server's `detail` is the sentence worth showing. A 400 here
    // means a filter the server would not accept, which is the user's to fix.
    const detail = error instanceof ApiError ? error.problem.detail : undefined;

    return (
      <View style={{ gap: spacing.sm, paddingVertical: spacing.xl }}>
        <Text style={{ color: palette.negative, fontWeight: '600' }}>
          {error instanceof ApiError ? (error.problem.title ?? 'Request failed') : 'Could not reach the server'}
        </Text>
        <Text style={{ color: palette.textMuted }}>
          {detail ?? 'Check that the API is running and try again.'}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
        >
          <Text style={{ color: palette.accent, fontWeight: '600' }}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  // "No spending in this period" is a valid answer, not an error (spec §7), and
  // the two empty states are different: nothing recorded at all versus nothing
  // matching. Only one of them has an action.
  return (
    <View style={{ gap: spacing.sm, paddingVertical: spacing.xl }}>
      <Text style={{ color: palette.text, fontWeight: '600' }}>
        {activeFilterCount > 0 ? 'No expenses match these filters.' : 'No expenses yet.'}
      </Text>
      {activeFilterCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={onClear}
          style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
        >
          <Text style={{ color: palette.accent, fontWeight: '600' }}>Clear filters</Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/expenses/new')}
          style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
        >
          <Text style={{ color: palette.accent, fontWeight: '600' }}>Record your first expense</Text>
        </Pressable>
      )}
    </View>
  );
}
