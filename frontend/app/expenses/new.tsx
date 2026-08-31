import Head from 'expo-router/head';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { api } from '../../src/api/client';
import { NEW_EXPENSE_DRAFT, clearDraft, readDraft, saveDraft } from '../../src/expenses/draftStore';
import { ExpenseFormFields } from '../../src/expenses/ExpenseFormFields';
import {
  hasErrors,
  isRealDate,
  toCreateRequest,
  validateExpenseForm,
  type ExpenseFormValues,
} from '../../src/expenses/expenseFormRules';
import { useExpenseSubmit } from '../../src/expenses/useExpenseSubmit';
import { MIN_TOUCH_TARGET } from '../../src/layout/breakpoints';
import { APP_NAME } from '../../src/layout/navigation';
import { palette, spacing } from '../../src/theme/tokens';
import type { ExpenseDetail } from '../../src/api/types';

/**
 * Today in `Asia/Manila`, which is the zone every date in this app means.
 *
 * **Guarded, and falls back by arithmetic.** `src/money/format.ts` documents at
 * length why `Intl` cannot be called blind here: Hermes ships it as a shim over
 * platform ICU, and a missing locale or an ignored `timeZone` would return
 * `08/23/2026` or the device's own date. The first fails this form's own date
 * check, so the user would open a brand-new form with a red error under a field
 * they never touched.
 *
 * The fallback is exact rather than approximate: the Philippines has observed no
 * DST since 1978, so the offset is a constant +08:00.
 */
function today(): string {
  try {
    const formatted = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    if (isRealDate(formatted)) {
      return formatted;
    }
  } catch {
    // Fall through to the arithmetic below.
  }

  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function emptyForm(): ExpenseFormValues {
  return { amount: '', occurredOn: today(), merchant: '', description: '' };
}

/**
 * Record a new expense (issue #15).
 *
 * The category is not asked for. The rule engine assigns one on create, and the
 * result is shown on the detail screen this navigates to — where changing it is
 * a reclassification with a reason, which is what keeps the history meaningful.
 */
export default function NewExpense() {
  // Evaluated per mount, not once at import. A module-scope constant freezes
  // the date at whenever the bundle first loaded, so a tab left open across
  // midnight in Manila — or a native app resumed the next day — prefills
  // yesterday, in a field that looks filled and valid.
  //
  // A draft only exists if a previous mount of this screen was taken away with
  // something typed into it — see `draftStore.ts` (#96).
  //
  // **It carries its own `occurredOn`, including one this function filled in.**
  // So a draft started before midnight in Manila and restored after it keeps
  // yesterday — the staleness the paragraph above exists to prevent, arriving
  // by another door. Kept anyway, and deliberately: the date was on screen when
  // they were typing, and restoring every field except that one silently moves
  // an expense to a day they never saw. Re-running `today()` would be the
  // surprising half, not the safe one. The form's own date check still governs
  // whatever comes back, so nothing invalid is restored past validation.
  const [values, setValues] = useState<ExpenseFormValues>(
    () => readDraft(NEW_EXPENSE_DRAFT) ?? emptyForm(),
  );
  const [local, setLocal] = useState<ReturnType<typeof validateExpenseForm>>({});
  const { submit, submitting, errors, clearError } = useExpenseSubmit<ExpenseDetail>();

  const merged = { ...errors, ...local };

  function change(patch: Partial<ExpenseFormValues>) {
    // Set from `values` rather than through an updater so the same object can
    // be held as the draft. Safe because `ExpenseFormFields` sends one field
    // per event and these inputs are controlled, so every keystroke re-renders
    // before the next is read — a consumer contract rather than a structural
    // guarantee, which is why it is written down.
    //
    // A `values`-keyed `useEffect` would remove that hazard, and here it would
    // cost nothing: after `clearDraft` this screen navigates away without
    // touching `values`, so nothing would re-fire. It is not used only so both
    // forms save the same way — the hazard that rules it out is real on
    // `[id].tsx`, which explains it.
    const next = { ...values, ...patch };
    setValues(next);
    saveDraft(NEW_EXPENSE_DRAFT, next);
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
      // The expense exists now; keeping what made it would offer to create it
      // a second time the next time this form is opened.
      clearDraft(NEW_EXPENSE_DRAFT);
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
          onPress={() => {
            // Leaving on purpose is not what the draft is for.
            clearDraft(NEW_EXPENSE_DRAFT);
            router.back();
          }}
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
