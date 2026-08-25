import Head from 'expo-router/head';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { api } from '../../src/api/client';
import { ApiError } from '../../src/api/problem';
import { RequestFailure } from '../../src/api/RequestFailure';
import { ExpenseFormFields } from '../../src/expenses/ExpenseFormFields';
import { ReclassifyControl } from '../../src/expenses/ReclassifyControl';
import {
  clearedFields,
  hasErrors,
  isEmptyUpdate,
  toUpdateRequest,
  validateExpenseForm,
  type ExpenseFormValues,
} from '../../src/expenses/expenseFormRules';
import { useExpenseDetail } from '../../src/expenses/useExpenseDetail';
import { useExpenseSubmit } from '../../src/expenses/useExpenseSubmit';
import { MIN_TOUCH_TARGET } from '../../src/layout/breakpoints';
import { APP_NAME } from '../../src/layout/navigation';
import { formatMoney } from '../../src/money/format';
import { colorForCategory, palette, spacing } from '../../src/theme/tokens';
import type { Category, ExpenseDetail as Detail } from '../../src/api/types';

function toValues(expense: Detail): ExpenseFormValues {
  return {
    amount: expense.amount,
    occurredOn: expense.occurredOn,
    merchant: expense.merchant ?? '',
    description: expense.description ?? '',
  };
}

/**
 * One expense: edit its fields, change its category, delete it (issue #15).
 *
 * The two writes are deliberately separate controls, because the API separates
 * them. Fields go through `PATCH`; the category is an append-only
 * reclassification carrying a reason. Merging them into one "Save" would have to
 * fabricate a reason for a category change the user did not make.
 */
export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { expense, loading, error, reload, replace } = useExpenseDetail(id);
  // One hook per action. Sharing them made a field save show "Saving…" on the
  // reclassify button, and would land a reclassify violation beside the edit
  // fields rather than in the block it came from.
  const edit = useExpenseSubmit<Detail>();
  const classify = useExpenseSubmit<Detail>();
  const removal = useExpenseSubmit<Detail>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [values, setValues] = useState<ExpenseFormValues | null>(null);
  const [local, setLocal] = useState<ReturnType<typeof validateExpenseForm>>({});

  useEffect(() => {
    if (expense) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValues(toValues(expense));
    }
  }, [expense]);

  // **`!error` too, so a retry does not hide the card that launched it.** The
  // spinner is for a first load with nothing to show; once a failure is on
  // screen the card stays up and its button carries the attempt, which is the
  // difference between a tap that looks ignored and one that looks answered.
  if (loading && !expense && !error) {
    return (
      <View style={{ padding: spacing.xl, alignItems: 'center' }}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  if (error && !expense) {
    // **A 404 is the only one of these that is about the expense.** The others
    // are about the request, and saying "could not load this expense" for a
    // refused credential sends the reader looking for a deleted row when the
    // answer is that they are signed out. `RequestFailure` draws that line, and
    // `reload` gives it something to offer where retrying can actually help.
    if (error instanceof ApiError && error.isNotFound) {
      return (
        <View style={{ padding: spacing.md, gap: spacing.sm }}>
          <Text style={{ color: palette.text, fontWeight: '600' }}>
            That expense no longer exists.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/expenses')}
            style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
          >
            <Text style={{ color: palette.accent }}>Back to the list</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <RequestFailure error={error} onRetry={reload} retrying={loading} />
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/expenses')}
          style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
        >
          <Text style={{ color: palette.accent }}>Back to the list</Text>
        </Pressable>
      </View>
    );
  }

  if (!expense || !values) {
    return null;
  }

  const original = toValues(expense);
  const merged = { ...edit.errors, ...local };
  const request = toUpdateRequest(values, original);
  const cleared = clearedFields(values, original);

  // Dirty on the raw values, not on the request body. A field the user emptied
  // is dropped from the body — the API has no clear operation — so comparing
  // bodies made the form say "No changes yet." beside a field it had just
  // visibly emptied.
  const dirty = JSON.stringify(values) !== JSON.stringify(original);
  const sendable = !isEmptyUpdate(request);

  function change(patch: Partial<ExpenseFormValues>) {
    setValues((current) => (current ? { ...current, ...patch } : current));
    for (const field of Object.keys(patch)) {
      setLocal((current) => {
        const next = { ...current };
        delete next[field as keyof ExpenseFormValues];
        return next;
      });
      edit.clearError(field as keyof typeof edit.errors);
    }
  }

  async function save() {
    if (!values || !expense) {
      return;
    }
    const found = validateExpenseForm(values);
    setLocal(found);
    if (hasErrors(found)) {
      return;
    }

    if (isEmptyUpdate(request)) {
      return;
    }

    // The response carries the updated expense and its history, so there is
    // nothing to refetch.
    //
    // The category may or may not have moved. The server re-runs the engine
    // when the merchant or description changed — and **not at all** once a
    // person has classified by hand, because an engine record appended after a
    // USER one would silently overrule it. Verified against the running API:
    // editing the merchant of a hand-classified expense leaves the category and
    // the history untouched.
    const updated = await edit.submit(() => api.updateExpense(expense.id, request));
    if (updated) {
      replace(updated);
    }
  }

  async function reclassify(category: Category, reason: string) {
    if (!expense) {
      return;
    }
    const updated = await classify.submit(() => api.reclassify(expense.id, { category, reason }));
    if (updated) {
      replace(updated);
    }
  }

  async function remove() {
    if (!expense) {
      return;
    }
    // Returns nothing on purpose: handing back the expense that no longer
    // exists is a trap for the next reader.
    const done = await removal.submit(async () => {
      await api.deleteExpense(expense.id);
      return null as unknown as Detail;
    });
    if (!removal.errors.form && done !== undefined) {
      router.replace('/expenses');
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.lg }}>
      <Head>
        <title>
          {expense.merchant ?? 'Expense'} · {APP_NAME}
        </title>
      </Head>

      <View style={{ gap: spacing.xs }}>
        <Text style={{ color: palette.text, fontSize: 22, fontWeight: '600' }}>
          {formatMoney(expense.amount)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
          <View
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: colorForCategory(expense.category),
            }}
          />
          <Text style={{ color: palette.textMuted }}>
            {expense.categoryLabel} · {expense.occurredOn}
          </Text>
        </View>
      </View>

      <ExpenseFormFields values={values} errors={merged} onChange={change} />

      {merged.form ? (
        <Text style={{ color: palette.negative, fontSize: 13 }}>{merged.form}</Text>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !sendable || edit.submitting }}
          disabled={!sendable || edit.submitting}
          onPress={save}
          style={{
            minHeight: MIN_TOUCH_TARGET,
            justifyContent: 'center',
            paddingHorizontal: spacing.lg,
            borderRadius: 6,
            backgroundColor: sendable && !edit.submitting ? palette.accent : palette.border,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
            {edit.submitting ? 'Saving…' : 'Save changes'}
          </Text>
        </Pressable>
        {/*
          Says why the button is inert rather than leaving it mysteriously grey
          — and distinguishes the two reasons. "Nothing changed" and "the only
          thing you changed is something this API cannot do" are different
          sentences, and the second used to be told as the first.
        */}
        {!dirty ? (
          <Text style={{ color: palette.textMuted, fontSize: 12 }}>No changes yet.</Text>
        ) : !sendable ? (
          <Text style={{ color: palette.negative, fontSize: 12 }}>
            {cleared.length === 1 ? 'That field' : 'Those fields'} cannot be cleared, only changed.
          </Text>
        ) : null}
      </View>

      <View style={{ height: 1, backgroundColor: palette.border }} />

      <ReclassifyControl
        current={expense.category}
        errors={classify.errors}
        submitting={classify.submitting}
        onReclassify={reclassify}
      />

      {/*
        Said out loud, because it is the opposite of what an edit form usually
        implies. Once a person has chosen the category, editing the merchant no
        longer re-files the expense — the engine's guess is a default and does
        not overwrite a decision. Without this the user changes the merchant,
        sees the category stay put, and reasonably concludes something is broken.
      */}
      {expense.classifications[0]?.source === 'USER' ? (
        <Text style={{ color: palette.textMuted, fontSize: 12 }}>
          You set this category, so editing the merchant or description will not change it again.
        </Text>
      ) : null}

      <View style={{ height: 1, backgroundColor: palette.border }} />

      <View style={{ gap: spacing.sm }}>
        <Text style={{ color: palette.textMuted, fontSize: 12 }}>
          History · {expense.classifications.length}{' '}
          {expense.classifications.length === 1 ? 'decision' : 'decisions'}
        </Text>
        {/* Append-only, newest first. Kept so reports over past periods stay
            reproducible — an overwrite would silently change last quarter. */}
        {expense.classifications.map((record) => (
          <View key={`${record.recordedAt}-${record.category}`} style={{ gap: 2 }}>
            <Text style={{ color: palette.text, fontSize: 13 }}>
              {record.categoryLabel}
              <Text style={{ color: palette.textMuted }}>
                {' '}
                · {record.source === 'RULE_ENGINE' ? 'rule engine' : record.source.toLowerCase()}
              </Text>
            </Text>
            <Text style={{ color: palette.textMuted, fontSize: 12 }}>{record.reason}</Text>
          </View>
        ))}
      </View>

      <View style={{ height: 1, backgroundColor: palette.border }} />

      {/*
        Two taps, and inline rather than `Alert.alert` — react-native-web does
        not implement that, so a web-only no-op would be worse than nothing.
        This is the one irreversible action on the screen: the backend cascades
        the classification history with it and the append-only trigger
        deliberately does not cover DELETE, so there is nothing to recover.
      */}
      {confirmingDelete ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirm deleting this expense and its history"
            disabled={removal.submitting}
            onPress={remove}
            style={{
              minHeight: MIN_TOUCH_TARGET,
              justifyContent: 'center',
              paddingHorizontal: spacing.md,
              borderRadius: 6,
              backgroundColor: palette.negative,
            }}
          >
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
              {removal.submitting ? 'Deleting…' : 'Delete permanently'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirmingDelete(false)}
            style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
          >
            <Text style={{ color: palette.textMuted }}>Keep it</Text>
          </Pressable>
          <Text style={{ color: palette.textMuted, fontSize: 12, flex: 1 }}>
            This also removes its classification history, which cannot be recovered.
          </Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete this expense"
          onPress={() => setConfirmingDelete(true)}
          style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
        >
          <Text style={{ color: palette.negative }}>Delete this expense</Text>
        </Pressable>
      )}

      {removal.errors.form ? (
        <Text style={{ color: palette.negative, fontSize: 12 }}>{removal.errors.form}</Text>
      ) : null}
    </ScrollView>
  );
}
