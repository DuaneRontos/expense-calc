import { assertSendableAmount } from '../money/format';
import type { CreateExpenseRequest, UpdateExpenseRequest } from '../api/types';

/**
 * Validation mirroring what the API enforces (issue #15).
 *
 * **Mirroring, not replacing.** The server is the authority and rejects all of
 * this itself; doing it here turns a round trip into a message beside the field
 * while the user is still looking at it. Where the two disagree the server
 * wins, which is why every submit still surfaces `violations`.
 *
 * Pure, so the rules are testable without a renderer.
 */

/** Spec §4: `merchant` is `VARCHAR(200)`, and the API declares `@Size(max = 200)`. */
export const MAX_MERCHANT_LENGTH = 200;

/** `@NotBlank @Size(max = 200)` on the reclassify reason. */
export const MAX_REASON_LENGTH = 200;

/** v1 is PHP only, rejected at the API boundary with a 400 (spec §9.6). */
export const CURRENCY = 'PHP';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface ExpenseFormValues {
  amount: string;
  occurredOn: string;
  merchant: string;
  description: string;
}

export type FieldErrors = Partial<Record<keyof ExpenseFormValues | 'reason' | 'form', string>>;

export function validateExpenseForm(values: ExpenseFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (values.amount.trim() === '') {
    errors.amount = 'Enter an amount.';
  } else {
    try {
      assertSendableAmount(values.amount);
    } catch (error) {
      // The same rule the client uses on the wire: the server rejects
      // sub-centavo precision rather than rounding it, so an amount it would
      // have had to move is refused here instead.
      errors.amount = error instanceof Error ? error.message : 'Not an amount.';
    }
  }

  if (values.occurredOn.trim() === '') {
    errors.occurredOn = 'Enter the date the money moved.';
  } else if (!ISO_DATE.test(values.occurredOn.trim())) {
    errors.occurredOn = 'Use YYYY-MM-DD.';
  }

  if (values.merchant.trim().length > MAX_MERCHANT_LENGTH) {
    errors.merchant = `Merchant is ${values.merchant.trim().length} characters; the limit is ${MAX_MERCHANT_LENGTH}.`;
  }

  return errors;
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** Builds the create body. Empty optional fields are omitted, never sent blank. */
export function toCreateRequest(values: ExpenseFormValues): CreateExpenseRequest {
  const request: CreateExpenseRequest = {
    amount: values.amount.trim(),
    currency: CURRENCY,
    occurredOn: values.occurredOn.trim(),
  };
  if (values.merchant.trim()) {
    request.merchant = values.merchant.trim();
  }
  if (values.description.trim()) {
    request.description = values.description.trim();
  }
  return request;
}

/**
 * Builds a PATCH body containing only what changed.
 *
 * **Two rules of the API meet here.** Omitting a field means "leave it alone",
 * and a blank string is rejected outright rather than treated as a clear — the
 * server says so in as many words, because `""` is neither leaving a value
 * alone nor removing it. So a field the user emptied is dropped from the body
 * rather than sent as `""`, and there is no way to clear a merchant through
 * this form. That is the API's shape, not an oversight in the UI.
 *
 * Sending only changed fields also matters for classification: the server
 * re-runs the rule engine when the merchant or description changes, so
 * resending identical text would rewrite the category history for nothing.
 */
export function toUpdateRequest(
  values: ExpenseFormValues,
  original: ExpenseFormValues,
): UpdateExpenseRequest {
  const request: UpdateExpenseRequest = {};

  if (values.amount.trim() !== original.amount.trim()) {
    request.amount = values.amount.trim();
  }
  if (values.occurredOn.trim() !== original.occurredOn.trim()) {
    request.occurredOn = values.occurredOn.trim();
  }
  if (values.merchant.trim() && values.merchant.trim() !== original.merchant.trim()) {
    request.merchant = values.merchant.trim();
  }
  if (values.description.trim() && values.description.trim() !== original.description.trim()) {
    request.description = values.description.trim();
  }

  return request;
}

export function isEmptyUpdate(request: UpdateExpenseRequest): boolean {
  return Object.keys(request).length === 0;
}
