import Head from 'expo-router/head';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { ExpenseRow } from '../src/expenses/ExpenseRow';
import { SortControl } from '../src/expenses/SortControl';
import { useExpenseQuery } from '../src/expenses/ExpenseQueryProvider';
import { useExpenses } from '../src/expenses/useExpenses';
import { ApiError } from '../src/api/problem';
import { MIN_TOUCH_TARGET } from '../src/layout/breakpoints';
import { webTitleFor } from '../src/layout/navigation';
import { palette, spacing } from '../src/theme/tokens';

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
export default function Expenses() {
  const { query, activeFilterCount, clear } = useExpenseQuery();
  const { items, loading, loadingMore, error, totalItems, hasMore, loadMore, retry } =
    useExpenses(query);

  return (
    <>
      <Head>
        <title>{webTitleFor('expenses')}</title>
      </Head>

      <FlatList
        data={items}
        // Without this the list sizes to its content instead of to the space it
        // was given, and Expo's web reset sets `body { overflow: hidden }` — so
        // everything past the first screenful rendered into a region nothing
        // could scroll to. With 10 rows it looked correct; the API was already
        // returning 50.
        style={{ flex: 1 }}
        // The server's own id, which is also the tiebreaker it appends to every
        // sort — so a row keeps its key across pages and reorderings.
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ExpenseRow expense={item} />}
        contentContainerStyle={{ padding: spacing.md, gap: 0 }}
        ListHeaderComponent={
          <View style={{ gap: spacing.md, paddingBottom: spacing.md }}>
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
        refreshing={loading && items.length > 0}
        onRefresh={retry}
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
        <Text style={{ color: palette.textMuted }}>Adding one is #15.</Text>
      )}
    </View>
  );
}
