import type { ExpenseFormValues } from './expenseFormRules';

/**
 * What a form was holding when it was taken off screen (#96).
 *
 * An access token lives fifteen minutes, so a refresh can fail part-way through
 * a form — revoked elsewhere, or a refresh token that has genuinely expired.
 * `AuthGuard` then redirects to `/sign-in`, which unmounts the screen, and the
 * values live in `useState`. They were simply gone; and #93 returning the
 * visitor to the same route afterwards brought them back to an empty form,
 * which reads worse than not returning at all.
 *
 * **In module memory, deliberately, not in storage.** The redirect is a
 * client-side navigation in the same JS context, so this survives exactly the
 * departure it exists for. `localStorage` would keep an expense — an amount, a
 * merchant, a description — readable on a shared machine long after the tab is
 * closed, which is a real cost for no benefit here: a full page reload was
 * always going to lose the draft, and a reload is not what this guards against.
 * Spec §9.2's storage rule is about tokens, but its reasoning about what a
 * script can read applies to a person's spending just as well.
 *
 * Keyed by form rather than held as one value, so the create form and an edit
 * of a particular expense cannot restore into each other.
 */
const drafts = new Map<string, ExpenseFormValues>();

/** The key for the create form. Edits key on the expense's id. */
export const NEW_EXPENSE_DRAFT = 'new';

export function saveDraft(key: string, values: ExpenseFormValues): void {
  drafts.set(key, values);
}

export function readDraft(key: string): ExpenseFormValues | undefined {
  return drafts.get(key);
}

/**
 * Dropped once the departure was deliberate — a successful save, or a cancel.
 *
 * Both mean the values have served their purpose: after a save the expense
 * exists, and restoring what made it would offer to create it twice; after a
 * cancel, reappearing unasked the next time the form opens is not what anyone
 * meant by leaving.
 */
export function clearDraft(key: string): void {
  drafts.delete(key);
}

/**
 * Drops every held draft, for a *deliberate* sign-out.
 *
 * The distinction this store turns on: an expiry is involuntary, so the values
 * are kept and handed back after signing in again; pressing "Sign out" is a
 * person leaving, quite possibly handing the machine to someone else. Both go
 * through `session.clear()` and both end at `/sign-in`, so the two are
 * indistinguishable from anywhere downstream — which is why this is called from
 * the sign-out control rather than from the session.
 *
 * Without it the next person to sign in on the same tab is shown the last
 * one's amount, merchant and description, restored into the form for them. A
 * reload would have cleared it; a sign-out has to as well, or signing out is
 * the weaker of the two.
 */
export function clearAllDrafts(): void {
  drafts.clear();
}
