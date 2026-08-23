import Head from 'expo-router/head';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { api } from '../../src/api/client';
import { ExpenseFormFields } from '../../src/expenses/ExpenseFormFields';
import {
  hasErrors,
  toCreateRequest,
  validateExpenseForm,
  type ExpenseFormValues,
} from '../../src/expenses/expenseFormRules';
import { useExpenseSubmit } from '../../src/expenses/useExpenseSubmit';
import { MIN_TOUCH_TARGET } from '../../src/layout/breakpoints';
import { APP_NAME } from '../../src/layout/navigation';
import { palette, spacing } from '../../src/theme/tokens';
import type { ExpenseDetail } from '../../src/api/types';

/** Today in `Asia/Manila`, which is the zone every date in this app means. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const EMPTY: ExpenseFormValues = { amount: '', occurredOn: today(), merchant: '', description: '' };

/**
 * Record a new expense (issue #15).
 *
 * The category is not asked for. The rule engine assigns one on create, and the
 * result is shown on the detail screen this navigates to — where changing it is
 * a reclassification with a reason, which is what keeps the history meaningful.
 */
export default function NewExpense() {
  const [values, setValues] = useState<ExpenseFormValues>(EMPTY);
  const [local, setLocal] = useState<ReturnType<typeof validateExpenseForm>>({});
  const { submit, submitting, errors, clearError } = useExpenseSubmit<ExpenseDetail>();

  const merged = { ...errors, ...local };

  function change(patch: Partial<ExpenseFormValues>) {
    setValues((current) => ({ ...current, ...patch }));
    // Clear the message for the field being edited, so a server complaint does
    // not sit under a value the user has since corrected.
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
    const found = validateExpenseForm(values);
    setLocal(found);
    if (hasErrors(found)) {
      return;
    }

    const created = await submit(() => api.createExpense(toCreateRequest(values)));
    if (created) {
      // Replace rather than push: going "back" to a form that has already been
      // submitted invites a second identical expense.
      router.replace({ pathname: '/expenses/[id]', params: { id: created.id } });
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.lg }}>
      <Head>
        <title>New expense · {APP_NAME}</title>
      </Head>

      <Text style={{ color: palette.text, fontWeight: '600', fontSize: 16 }}>New expense</Text>

      <ExpenseFormFields values={values} errors={merged} onChange={change} />

      {merged.form ? (
        <Text style={{ color: palette.negative, fontSize: 13 }}>{merged.form}</Text>
      ) : null}

      <View style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: submitting }}
          disabled={submitting}
          onPress={save}
          style={{
            minHeight: MIN_TOUCH_TARGET,
            justifyContent: 'center',
            paddingHorizontal: spacing.lg,
            borderRadius: 6,
            backgroundColor: submitting ? palette.border : palette.accent,
          }}
        >
          <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>
            {submitting ? 'Saving…' : 'Save expense'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
        >
          <Text style={{ color: palette.textMuted }}>Cancel</Text>
        </Pressable>

        {submitting ? <ActivityIndicator color={palette.accent} /> : null}
      </View>

      <Text style={{ color: palette.textMuted, fontSize: 12 }}>
        The category is assigned by the rule engine when this is saved. You can change it
        afterwards, with a reason.
      </Text>
    </ScrollView>
  );
}
