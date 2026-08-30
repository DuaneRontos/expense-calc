import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

// Imported from outside `app/` on purpose: expo-router turns every `.tsx` under
// that directory into a route, so a test file beside the screen would be served
// as one. `expensesFailure.test.tsx` reaches across for the same reason.
import ExpenseDetailScreen from '../../../app/expenses/[id]';
import NewExpense from '../../../app/expenses/new';
import { api } from '../../api/client';
import { SignOutButton } from '../../layout/SignOutButton';
import { NEW_EXPENSE_DRAFT, clearDraft, readDraft, saveDraft } from '../draftStore';
import type { ExpenseDetail } from '../../api/types';

/**
 * A session ending mid-form does not take what was typed with it (#96).
 *
 * An access token lives fifteen minutes. Someone part-way through a new expense
 * can have a refresh finally fail — revoked elsewhere, or a refresh token that
 * has genuinely expired — and `AuthGuard` then redirects to `/sign-in`. That
 * redirect is what makes this reachable: before the guard landed, nothing moved
 * the screen out from under the form.
 *
 * **The redirect unmounts the screen, and the values live in `useState`.** So
 * they were gone, and #93 returning the visitor to `/expenses/new` afterwards
 * brought them back to an empty form — arguably worse than not returning at
 * all, since it looks like the app kept their place.
 */
jest.mock('expo-router/head', () => ({ __esModule: true, default: () => null }));

// `mock`-prefixed so jest's hoisted factory may read them.
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    back: (...args: unknown[]) => mockBack(...args),
  },
  useLocalSearchParams: () => ({ id: 'e-1' }),
}));

const EXPENSE_ID = 'e-1';

const stored: ExpenseDetail = {
  id: EXPENSE_ID,
  amount: '250.00',
  currency: 'PHP',
  occurredOn: '2026-08-01',
  merchant: 'Mercury Drug',
  description: null,
  category: 'HEALTH',
  categoryLabel: 'Health',
  createdAt: '2026-08-01T02:00:00Z',
  updatedAt: '2026-08-01T02:00:00Z',
  classifications: [],
};

/**
 * Awaited throughout, for the reason `signIn.test.tsx` gives at length: this
 * renderer is async, and an un-awaited `fireEvent` leaves the update unflushed.
 * Here it also corrupts the *next* test — overlapping act() scopes leave the
 * renderer returning a null tree, so a later `render` finds no fields at all.
 */
async function type(values: { amount?: string; merchant?: string; description?: string }) {
  if (values.amount !== undefined) {
    await fireEvent.changeText(screen.getByLabelText('Amount'), values.amount);
  }
  if (values.merchant !== undefined) {
    await fireEvent.changeText(screen.getByLabelText('Merchant'), values.merchant);
  }
  if (values.description !== undefined) {
    await fireEvent.changeText(screen.getByLabelText('Description'), values.description);
  }
}

beforeEach(() => {
  clearDraft(NEW_EXPENSE_DRAFT);
  mockReplace.mockClear();
  mockBack.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
  clearDraft(NEW_EXPENSE_DRAFT);
});

describe('a form whose session ends underneath it', () => {
  it('keeps what was typed when the screen is torn down', async () => {
    const first = await render(<NewExpense />);
    await type({ amount: '1234.56', merchant: 'Puregold', description: 'weekly shop' });

    // What the guard's redirect does to this screen: it goes away.
    await first.unmount();

    await render(<NewExpense />);

    expect(screen.getByLabelText('Amount').props.value).toBe('1234.56');
    expect(screen.getByLabelText('Merchant').props.value).toBe('Puregold');
    expect(screen.getByLabelText('Description').props.value).toBe('weekly shop');
  });

  /**
   * The draft is for an *involuntary* departure. Once the expense exists,
   * restoring the values it was made from would offer to create it twice.
   */
  it('discards the draft once the expense is created', async () => {
    jest.spyOn(api, 'createExpense').mockResolvedValue({ id: 'e-9' } as never);

    await render(<NewExpense />);
    await type({ amount: '10.00', merchant: 'Jollibee' });

    // Pinned before the save, so the clearing below cannot pass by never
    // having held anything in the first place.
    expect(readDraft(NEW_EXPENSE_DRAFT)).toBeDefined();

    await fireEvent.press(screen.getByRole('button', { name: 'Save expense' }));

    await waitFor(() => expect(mockReplace).toHaveBeenCalled());
    expect(readDraft(NEW_EXPENSE_DRAFT)).toBeUndefined();
  });

  /**
   * Leaving on purpose is not the case this exists for, and a draft that
   * outlived a deliberate cancel would reappear unasked the next time the form
   * is opened.
   */
  it('discards the draft when the form is cancelled', async () => {
    await render(<NewExpense />);
    await type({ amount: '10.00', merchant: 'Jollibee' });

    expect(readDraft(NEW_EXPENSE_DRAFT)).toBeDefined();

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));

    expect(mockBack).toHaveBeenCalled();
    expect(readDraft(NEW_EXPENSE_DRAFT)).toBeUndefined();
  });

  it('starts empty when there is nothing held', async () => {
    await render(<NewExpense />);

    // Anchored on a field that exists, so the emptiness below is a real render
    // rather than a screen that failed to mount.
    expect(screen.getByLabelText('Merchant')).toBeOnTheScreen();
    expect(screen.getByLabelText('Merchant').props.value).toBe('');
  });
});

describe('an edit whose session ends underneath it', () => {
  beforeEach(() => {
    clearDraft(EXPENSE_ID);
  });

  afterEach(() => {
    clearDraft(EXPENSE_ID);
  });

  it('keeps the edit rather than the stored value when the screen comes back', async () => {
    jest.spyOn(api, 'expense').mockResolvedValue(stored);

    const first = await render(<ExpenseDetailScreen />);
    await screen.findByLabelText('Merchant');
    await type({ merchant: 'Watsons' });

    await first.unmount();

    await render(<ExpenseDetailScreen />);

    // The expense is refetched, so the stored 'Mercury Drug' is what this
    // would show without the draft.
    await waitFor(() => expect(screen.getByLabelText('Merchant').props.value).toBe('Watsons'));
    expect(screen.getByLabelText('Amount').props.value).toBe('250.00');
  });

  /**
   * Keyed per expense, so an edit of one does not surface while looking at
   * another — the create form and every edit share one module.
   */
  it('does not restore one expense\'s draft into another', async () => {
    jest.spyOn(api, 'expense').mockResolvedValue(stored);

    const first = await render(<ExpenseDetailScreen />);
    await screen.findByLabelText('Merchant');
    await type({ merchant: 'Watsons' });
    await first.unmount();

    // Same screen, a different expense behind it.
    const other = { ...stored, id: 'e-2', merchant: 'Jollibee' };
    jest.spyOn(api, 'expense').mockResolvedValue(other);

    await render(<ExpenseDetailScreen />);

    // 'e-2' shows what is stored against it. Restoring on anything coarser than
    // the id — a single slot, or the route, which the mock holds at 'e-1'
    // throughout — would put 'Watsons' here instead.
    await waitFor(() => expect(screen.getByLabelText('Merchant').props.value).toBe('Jollibee'));

    // And e-1's edit is still held, so the isolation above is the key working
    // rather than the draft having been dropped somewhere along the way.
    expect(readDraft(EXPENSE_ID)?.merchant).toBe('Watsons');
    expect(readDraft('e-2')).toBeUndefined();
  });

  it('discards the draft once the edit is saved', async () => {
    jest.spyOn(api, 'expense').mockResolvedValue(stored);
    jest.spyOn(api, 'updateExpense').mockResolvedValue({ ...stored, merchant: 'Watsons' });

    await render(<ExpenseDetailScreen />);
    await screen.findByLabelText('Merchant');
    await type({ merchant: 'Watsons' });

    expect(readDraft(EXPENSE_ID)).toBeDefined();

    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(readDraft(EXPENSE_ID)).toBeUndefined());
  });

  /**
   * The other deliberate exit from this screen. There is no expense left to
   * edit, so a held draft could only ever be restored against a 404.
   */
  it('discards the draft when the expense is deleted', async () => {
    jest.spyOn(api, 'expense').mockResolvedValue(stored);
    jest.spyOn(api, 'deleteExpense').mockResolvedValue(undefined);

    await render(<ExpenseDetailScreen />);
    await screen.findByLabelText('Merchant');
    await type({ merchant: 'Watsons' });

    expect(readDraft(EXPENSE_ID)).toBeDefined();

    await fireEvent.press(screen.getByLabelText('Delete this expense'));
    // Named by its `accessibilityLabel`, which overrides the 'Delete
    // permanently' the button shows.
    await fireEvent.press(
      screen.getByRole('button', { name: 'Confirm deleting this expense and its history' }),
    );

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/expenses'));
    expect(readDraft(EXPENSE_ID)).toBeUndefined();
  });
});

/**
 * The distinction the whole store turns on, from both sides.
 *
 * An expiry is involuntary and the values are handed back; pressing "Sign out"
 * is a person leaving, quite possibly handing over the machine. Both end at
 * `/sign-in` by the same `session.clear()`, so nothing downstream can tell them
 * apart — the difference has to be drawn at the control.
 */
describe('signing out, as against a session expiring', () => {
  // Web-shaped: no `refreshToken` in the body, because the server put it in an
  // httpOnly cookie (#57). Matches what `viaCookie: true` means.
  const TOKENS = { accessToken: 'access-1', expiresInSeconds: 900 };

  const held = { amount: '2450.75', occurredOn: '2026-08-30', merchant: 'Puregold', description: '' };

  beforeEach(async () => {
    await act(async () => {
      await api.session.clear();
    });
    clearDraft(NEW_EXPENSE_DRAFT);
  });

  afterEach(async () => {
    await act(async () => {
      await api.session.clear();
    });
    clearDraft(NEW_EXPENSE_DRAFT);
  });

  it('drops what was typed when the visitor signs out on purpose', async () => {
    // The real side effect, not a wholesale stub: `logout()` clearing the
    // session is what unmounts this control, and a stub that skips it never
    // reaches the state the ordering here exists for.
    jest.spyOn(api, 'logout').mockImplementation(async () => {
      await api.session.clear();
      return null;
    });

    await render(<SignOutButton />);
    await act(async () => {
      await api.session.adopt(TOKENS, true);
    });

    saveDraft(NEW_EXPENSE_DRAFT, held);

    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(readDraft(NEW_EXPENSE_DRAFT)).toBeUndefined());
  });

  it('keeps what was typed when the session merely ends', async () => {
    await act(async () => {
      await api.session.adopt(TOKENS, true);
    });

    saveDraft(NEW_EXPENSE_DRAFT, held);

    // What a failed refresh does, and the case #96 is about. The same call the
    // sign-out path makes — so clearing drafts from here rather than from the
    // control would take this one with it.
    await act(async () => {
      await api.session.clear();
    });

    expect(api.session.isSignedIn()).toBe(false);
    expect(readDraft(NEW_EXPENSE_DRAFT)).toEqual(held);
  });
});
