import {
  hasErrors,
  isEmptyUpdate,
  MAX_MERCHANT_LENGTH,
  toCreateRequest,
  toUpdateRequest,
  validateExpenseForm,
  type ExpenseFormValues,
} from '../expenseFormRules';
import { toFieldErrors } from '../useExpenseSubmit';
import { ApiError } from '../../api/problem';

const VALID: ExpenseFormValues = {
  amount: '1234.56',
  occurredOn: '2026-08-23',
  merchant: 'SM Supermarket',
  description: 'Weekly groceries',
};

describe('validateExpenseForm', () => {
  it('accepts a complete expense', () => {
    expect(hasErrors(validateExpenseForm(VALID))).toBe(false);
  });

  it('accepts a refund, which is a negative amount', () => {
    // Spec §5: a refund keeps the category of what it refunds, as a negative.
    expect(hasErrors(validateExpenseForm({ ...VALID, amount: '-1200.00' }))).toBe(false);
  });

  it('rejects sub-centavo precision rather than rounding it', () => {
    // The server rejects this too. Rounding on the way out would send a number
    // the user never typed.
    expect(validateExpenseForm({ ...VALID, amount: '10.005' }).amount).toContain('centavo');
  });

  it('requires an amount and a date', () => {
    const errors = validateExpenseForm({ ...VALID, amount: '  ', occurredOn: '' });
    expect(errors.amount).toBeDefined();
    expect(errors.occurredOn).toBeDefined();
  });

  it('rejects a date that is not ISO', () => {
    expect(validateExpenseForm({ ...VALID, occurredOn: '23/08/2026' }).occurredOn).toContain(
      'YYYY-MM-DD',
    );
  });

  it('mirrors the server bound on merchant length', () => {
    const errors = validateExpenseForm({ ...VALID, merchant: 'x'.repeat(MAX_MERCHANT_LENGTH + 1) });
    expect(errors.merchant).toContain(String(MAX_MERCHANT_LENGTH));
  });

  it('allows an expense with neither merchant nor description', () => {
    // Both are nullable; classification lands it in UNCLASSIFIED, which is a
    // real state rather than a failure.
    expect(hasErrors(validateExpenseForm({ ...VALID, merchant: '', description: '' }))).toBe(false);
  });
});

describe('toCreateRequest', () => {
  it('sends PHP and omits empty optional fields rather than blanking them', () => {
    const request = toCreateRequest({ ...VALID, merchant: '  ', description: '' });

    expect(request.currency).toBe('PHP');
    expect('merchant' in request).toBe(false);
    expect('description' in request).toBe(false);
  });

  it('sends the amount verbatim', () => {
    // Not reformatted: presentation rounding belongs at the display boundary.
    expect(toCreateRequest({ ...VALID, amount: '-1234.5' }).amount).toBe('-1234.5');
  });
});

describe('toUpdateRequest', () => {
  it('sends only what changed', () => {
    const request = toUpdateRequest({ ...VALID, merchant: 'Puregold' }, VALID);
    expect(request).toEqual({ merchant: 'Puregold' });
  });

  it('is empty when nothing changed', () => {
    expect(isEmptyUpdate(toUpdateRequest(VALID, VALID))).toBe(true);
  });

  it('omits a field the user emptied rather than sending a blank', () => {
    // The API rejects "" outright — it is neither leaving a value alone nor
    // clearing it, and there is no clear operation. Sending it would be a 400.
    const request = toUpdateRequest({ ...VALID, merchant: '' }, VALID);
    expect('merchant' in request).toBe(false);
  });

  it('does not resend unchanged text, which would rewrite the category history', () => {
    // Changing the merchant or description re-runs classification, so resending
    // identical text would append a record for nothing.
    const request = toUpdateRequest({ ...VALID, amount: '99.00' }, VALID);
    expect(request).toEqual({ amount: '99.00' });
  });
});

describe('toFieldErrors', () => {
  it('puts a violation against the field it names', () => {
    const error = new ApiError({
      status: 400,
      detail: 'amount is not an amount.',
      violations: [{ field: 'amount', message: 'amount is not an amount.' }],
    });

    expect(toFieldErrors(error).amount).toBe('amount is not an amount.');
  });

  it('falls back to the form for a violation no field renders', () => {
    // `currency` and `body` are fields the server names and this form does not
    // show; dropping them would lose the only explanation the user gets.
    const error = new ApiError({
      status: 400,
      detail: 'PHP is the only supported currency.',
      violations: [{ field: 'currency', message: 'PHP is the only supported currency.' }],
    });

    expect(toFieldErrors(error).form).toBe('PHP is the only supported currency.');
  });

  it('uses the problem detail when there are no violations at all', () => {
    expect(toFieldErrors(new ApiError({ status: 404, detail: 'No such expense.' })).form).toBe(
      'No such expense.',
    );
  });

  it('reports a transport failure as a form-level message', () => {
    expect(toFieldErrors(new Error('offline')).form).toContain('offline');
  });
});
