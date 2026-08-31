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
 * departure it exists for — verified in a browser rather than assumed, since
 * the whole design rests on it. `localStorage` would keep an expense — an
 * amount, a merchant, a description — readable on a shared machine long after
 * the tab is closed, which is a real cost for no benefit here: a full page
 * reload was always going to lose the draft, and a reload is not what this
 * guards against. Spec §9.2's storage rule is about tokens, but its reasoning
 * about what a script can read applies to a person's spending just as well.
 *
 * Keyed by form rather than held as one value, so the create form and an edit
 * of a particular expense cannot restore into each other.
 *
 * ## What actually clears a draft, which is narrower than "a deliberate exit"
 *
 * A draft is dropped on a successful create, a cancel, a saved edit, a delete,
 * and a sign-out. **Every other departure keeps it, ordinary navigation
 * included** — the sidebar, the browser's back button, tapping through to
 * another expense. The create form has a Cancel control and the detail screen
 * has none, so on `/expenses/{id}` there is no way at all to put a draft down
 * on purpose short of saving, deleting, or signing out.
 *
 * That is a wider rule than #96 asked for, and the cost is worth naming: a
 * draft restored long after it was typed makes the detail screen disagree with
 * itself. The header renders the server's amount and date while the fields
 * below render the draft, with nothing saying an older unsaved edit is on
 * screen. Someone who typed `999.00`, wandered off, and came back tomorrow sees
 * ₱250.00 above `999.00`.
 *
 * Kept anyway, because the alternative reading is worse: a draft that survives
 * only the session-expiry path would discard typed changes on a reclassify —
 * which remounts this screen — and that is the same lost work by another route.
 * **If the divergence above ever bites, the fix is to restore only when the
 * previous unmount was the guard's redirect**, which means marking drafts at
 * the moment the session ends rather than holding them unconditionally. That is
 * deliberately not done here: it puts lifecycle machinery between a person and
 * their own typing to solve a staleness problem nobody has reported yet.
 */
const drafts = new Map<string, ExpenseFormValues>();

/**
 * The key for the create form.
 *
 * Prefixed, as {@link expenseDraftKey} is, so the two namespaces cannot meet.
 * Nothing can reach this screen with an id of `new` today — `/expenses/new`
 * resolves to `new.tsx` before `[id].tsx` — but that is routing order holding a
 * key apart, and a prefix holds it apart by construction.
 */
export const NEW_EXPENSE_DRAFT = 'form:new';

/** The key for an edit of one expense. */
export function expenseDraftKey(id: string): string {
  return `expense:${id}`;
}

export function saveDraft(key: string, values: ExpenseFormValues): void {
  drafts.set(key, values);
}

export function readDraft(key: string): ExpenseFormValues | undefined {
  return drafts.get(key);
}

/**
 * Dropped once the departure was one this store recognises — see the list
 * above. A successful save means the expense exists and restoring what made it
 * would offer to create it twice; a cancel or a delete means the values have no
 * subject left.
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
 * **Every key, not just the create form.** Clearing only `NEW_EXPENSE_DRAFT`
 * passes every test that does not name a second key, and leaves the case the
 * paragraph above describes intact one slot over: person A's unsaved edit to
 * `/expenses/e-1` restored into person B's form when B opens the same expense.
 */
export function clearAllDrafts(): void {
  drafts.clear();
}
