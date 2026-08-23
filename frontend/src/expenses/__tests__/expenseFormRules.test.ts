import {
  clearedFields,
  hasErrors,
  isEmptyUpdate,
  isRealDate,
  MAX_MERCHANT_LENGTH,
  sameAmount,
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

describe('isRealDate', () => {
  it('accepts dates the calendar has', () => {
    expect(isRealDate('2026-08-23')).toBe(true);
    expect(isRealDate('2024-02-29')).toBe(true);
  });

  it('rejects a day the month does not have', () => {
    // Shape alone accepts this. It then fails Jackson's LocalDate binding
    // before validation runs, so the server names the field "body" and the user
    // gets a banner about the request body for a typo in the Date field.
    expect(isRealDate('2026-02-31')).toBe(false);
    expect(isRealDate('2026-04-31')).toBe(false);
  });

  it('rejects a month that does not exist, and a non-leap 29 February', () => {
    expect(isRealDate('2026-13-01')).toBe(false);
    expect(isRealDate('2026-00-10')).toBe(false);
    expect(isRealDate('2026-02-29')).toBe(false);
  });

  it('surfaces on the date field rather than as a form banner', () => {
    expect(validateExpenseForm({ ...VALID, occurredOn: '2026-02-31' }).occurredOn).toContain(
      'does not exist',
    );
  });
});

describe('sameAmount', () => {
  it('treats the same money written differently as unchanged', () => {
    // Retyping 1234.50 as 1234.5 changes no minor units; sending it would bump
    // updatedAt for nothing.
    expect(sameAmount('1234.50', '1234.5')).toBe(true);
    expect(sameAmount('-500.00', '-500')).toBe(true);
    expect(sameAmount('0007.00', '7')).toBe(true);
  });

  it('still notices a real change, including a sign flip', () => {
    expect(sameAmount('1234.50', '1234.51')).toBe(false);
    // A refund and a purchase of the same size are not the same money.
    expect(sameAmount('500.00', '-500.00')).toBe(false);
  });

  it('does not swallow a difference while one side is unparseable', () => {
    expect(sameAmount('12.', '12')).toBe(false);
  });
});

describe('clearedFields', () => {
  it('names a field the user emptied, which the API cannot clear', () => {
    expect(clearedFields({ ...VALID, merchant: '' }, VALID)).toEqual(['merchant']);
  });

  it('names nothing when a field was changed rather than emptied', () => {
    expect(clearedFields({ ...VALID, merchant: 'Puregold' }, VALID)).toEqual([]);
  });

  it('names nothing when the field was already empty', () => {
    const blank = { ...VALID, merchant: '' };
    expect(clearedFields(blank, blank)).toEqual([]);
  });
});
