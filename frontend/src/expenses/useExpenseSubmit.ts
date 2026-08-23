import { useCallback, useState } from 'react';

import { ApiError } from '../api/problem';
import type { FieldErrors } from './expenseFormRules';

/**
 * Runs a write and turns a failure into per-field messages (issue #15).
 *
 * Spec §8: the API returns `violations` naming the offending fields, and the
 * client is asked to render `detail` inline against them rather than in a
 * toast. This is the single place that translation happens, so every form gets
 * it the same way.
 */
export function useExpenseSubmit<T>() {
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = useCallback(async (action: () => Promise<T>): Promise<T | null> => {
    setSubmitting(true);
    setErrors({});

    try {
      return await action();
    } catch (caught) {
      setErrors(toFieldErrors(caught));
      return null;
    } finally {
      setSubmitting(false);
    }
  }, []);

  const clearError = useCallback((field: keyof FieldErrors) => {
    setErrors((current) => {
      if (!(field in current)) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  return { submit, submitting, errors, setErrors, clearError };
}

/**
 * Maps a failure onto fields.
 *
 * A violation whose field the form does not render would otherwise vanish —
 * `body` is one the server sends for a domain rejection with no single field to
 * blame — so anything unrecognised falls back to the form-level slot instead of
 * being dropped.
 */
export function toFieldErrors(caught: unknown): FieldErrors {
  if (!(caught instanceof ApiError)) {
    return {
      form:
        caught instanceof Error
          ? `Could not reach the server: ${caught.message}`
          : 'Could not reach the server.',
    };
  }

  const known: (keyof FieldErrors)[] = ['amount', 'occurredOn', 'merchant', 'description', 'reason'];
  const errors: FieldErrors = {};

  for (const field of caught.fields) {
    const message = caught.messageFor(field);
    if (!message) {
      continue;
    }
    if ((known as string[]).includes(field)) {
      errors[field as keyof FieldErrors] = message;
    } else {
      // `currency`, `body`, or anything a later API version adds.
      errors.form = message;
    }
  }

  if (Object.keys(errors).length === 0) {
    errors.form = caught.problem.detail ?? caught.message;
  }
  return errors;
}
