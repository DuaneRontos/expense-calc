import Head from 'expo-router/head';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { api } from '../../src/api/client';
import { ApiError } from '../../src/api/problem';
import { ExpenseFormFields } from '../../src/expenses/ExpenseFormFields';
import { ReclassifyControl } from '../../src/expenses/ReclassifyControl';
import {
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
  const { expense, loading, error, replace } = useExpenseDetail(id);
  const { submit, submitting, errors, clearError } = useExpenseSubmit<Detail>();

  const [values, setValues] = useState<ExpenseFormValues | null>(null);
  const [local, setLocal] = useState<ReturnType<typeof validateExpenseForm>>({});

  useEffect(() => {
    if (expense) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValues(toValues(expense));
    }
  }, [expense]);

  if (loading && !expense) {
    return (
      <View style={{ padding: spacing.xl, alignItems: 'center' }}>
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  if (error && !expense) {
    const notFound = error instanceof ApiError && error.isNotFound;
    return (
      <View style={{ padding: spacing.md, gap: spacing.sm }}>
        <Text style={{ color: palette.text, fontWeight: '600' }}>
          {notFound ? 'That expense no longer exists.' : 'Could not load this expense.'}
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

  if (!expense || !values) {
    return null;
  }

  const original = toValues(expense);
  const merged = { ...errors, ...local };
  const dirty = !isEmptyUpdate(toUpdateRequest(values, original));

  function change(patch: Partial<ExpenseFormValues>) {
    setValues((current) => (current ? { ...current, ...patch } : current));
    for (const field of Object.keys(patch)) {
      setLocal((current) => {
        const next = { ...current };
        delete next[field as keyof ExpenseFormValues];
        return next;
      });
      clearError(field as keyof typeof errors);
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

    const request = toUpdateRequest(values, original);
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
    const updated = await submit(() => api.updateExpense(expense.id, request));
    if (updated) {
      replace(updated);
    }
  }

  async function reclassify(category: Category, reason: string) {
    if (!expense) {
      return;
    }
    const updated = await submit(() => api.reclassify(expense.id, { category, reason }));
    if (updated) {
      replace(updated);
    }
  }

  async function remove() {
    if (!expense) {
      return;
    }
    const done = await submit(async () => {
      await api.deleteExpense(expense.id);
      return expense;
    });
    if (done) {
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
          accessibilityState={{ disabled: !dirty || submitting }}
          disabled={!dirty || submitting}
          onPress={save}
          style={{
            minHeight: MIN_TOUCH_TARGET,
            justifyContent: 'center',
            paddingHorizontal: spacing.lg,
            borderRadius: 6,
            backgroundColor: dirty && !submitting ? palette.accent : palette.border,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
            {submitting ? 'Saving…' : 'Save changes'}
          </Text>
        </Pressable>
        {/* Says why the button is inert, rather than leaving it mysteriously grey. */}
        {!dirty ? (
          <Text style={{ color: palette.textMuted, fontSize: 12 }}>No changes yet.</Text>
        ) : null}
      </View>

      <View style={{ height: 1, backgroundColor: palette.border }} />

      <ReclassifyControl
        current={expense.category}
        errors={merged}
        submitting={submitting}
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete this expense"
        disabled={submitting}
        onPress={remove}
        style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
      >
        <Text style={{ color: palette.negative }}>Delete this expense</Text>
      </Pressable>
    </ScrollView>
  );
}
