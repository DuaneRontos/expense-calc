/**
 * Formatting for money that arrives from the API as a decimal string.
 *
 * Two rules from CLAUDE.md and spec §4 collide here, and the collision is the
 * reason this file is not a one-liner:
 *
 *  1. Money crosses the wire as a decimal string, never a JSON number, because
 *     a JSON number is a float by the time JavaScript sees it.
 *  2. The client formats with `Intl.NumberFormat("en-PH", …)` and never
 *     hardcodes `₱`, so that a second currency in v2 is a config change rather
 *     than a hunt through every screen.
 *
 * The obvious `format(Number(amount))` satisfies (2) by breaking (1) — it
 * converts the exact decimal to a double at the last possible moment, in the
 * client, which is precisely where the backend's integer storage was designed
 * to stop mattering. So instead we ask `Intl` for the *shape* of a formatted
 * peso amount via `formatToParts`, and substitute our own exactly-preserved
 * digits into it. The symbol, separators, and their placement all still come
 * from `Intl`; only the digits are ours, and they are never a float.
 */

/** ISO 4217 code. v1 is PHP only (spec §9.6); v2 makes this a parameter. */
export const CURRENCY_CODE = 'PHP';

export const LOCALE = 'en-PH';

/** Spec §7: rounding is HALF_UP at scale 2, and only at this boundary. */
export const SCALE = 2;

/** A signed decimal string: optional `-`, digits, optional `.` and digits. */
const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * A probe value chosen to force every part type we need into the output:
 * a minus sign, a group separator, a decimal separator, and a fraction.
 */
const PROBE = -1234567.89;

type Parts = {
  currency: string;
  group: string;
  decimal: string;
  minusSign: string;
  /** The literal text Intl puts between symbol and digits, usually empty. */
  literal: string;
  /** True when the currency symbol precedes the digits, as it does in en-PH. */
  symbolFirst: boolean;
};

let cached: Parts | null = null;

/**
 * What to format with when `Intl` cannot be asked.
 *
 * **The ISO code, never the `₱` glyph.** Falling back to the symbol would break
 * the rule this whole file exists to honour — the moment v2 adds a second
 * currency, a hardcoded symbol is a bug, and one hidden in a fallback path is
 * the last place anybody would look for it. `PHP 1,234.56` is ugly and correct.
 */
const FALLBACK_PARTS: Parts = {
  currency: CURRENCY_CODE,
  group: ',',
  decimal: '.',
  minusSign: '-',
  literal: ' ',
  symbolFirst: true,
};

/**
 * The literal between the currency symbol and the digits.
 *
 * Taken **positionally** rather than as the first literal in the array. The
 * probe is negative, and an engine that reports the sign as a `literal` instead
 * of a `minusSign` would otherwise hand back `"-"` — which then gets injected
 * into every amount the app formats, negative or not, as `₱-1,234.56`. Full ICU
 * does not do this; a shim might, and it would be silently wrong rather than
 * loud.
 */
function literalBetween(
  parts: Intl.NumberFormatPart[],
  currencyIndex: number,
  integerIndex: number,
): string {
  if (currencyIndex < 0 || integerIndex < 0) {
    return '';
  }
  const from = Math.min(currencyIndex, integerIndex);
  const to = Math.max(currencyIndex, integerIndex);
  return parts.slice(from + 1, to).find((part) => part.type === 'literal')?.value ?? '';
}

function localeParts(): Parts {
  if (cached) {
    return cached;
  }

  try {
    const formatter = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: CURRENCY_CODE,
      minimumFractionDigits: SCALE,
      maximumFractionDigits: SCALE,
    });

    // Hermes implements `Intl` as a shim over the platform's ICU rather than as
    // a full ECMA-402 engine, and `formatToParts` is among the least reliably
    // present members of it. Calling it blind throws a TypeError *inside
    // render*, on every screen in an app where every screen shows money — and
    // neither jest on Node nor a browser can observe it.
    if (typeof formatter.formatToParts !== 'function') {
      if (__DEV__) {
        console.warn(
          'Intl.NumberFormat#formatToParts is missing on this engine; ' +
            'formatting amounts as "PHP 1,234.56". Consider @formatjs/intl-numberformat.',
        );
      }
      cached = FALLBACK_PARTS;
      return cached;
    }

    const parts = formatter.formatToParts(PROBE);
    const find = (type: Intl.NumberFormatPartTypes, fallback: string) =>
      parts.find((part) => part.type === type)?.value ?? fallback;

    const currencyIndex = parts.findIndex((part) => part.type === 'currency');
    const integerIndex = parts.findIndex((part) => part.type === 'integer');

    cached = {
      // If the device has no `en-PH` data and falls back to `en`, this comes
      // back as the code rather than the glyph — ugly, correct, and not a crash.
      currency: find('currency', CURRENCY_CODE),
      group: find('group', FALLBACK_PARTS.group),
      decimal: find('decimal', FALLBACK_PARTS.decimal),
      minusSign: find('minusSign', FALLBACK_PARTS.minusSign),
      literal: literalBetween(parts, currencyIndex, integerIndex),
      // Both indexes are >= 0 for any real Intl implementation; written so that
      // a missing currency part degrades to symbol-first rather than throwing.
      symbolFirst: currencyIndex < integerIndex,
    };

    return cached;
  } catch {
    if (__DEV__) {
      console.warn('Intl.NumberFormat is unavailable; formatting amounts as "PHP 1,234.56".');
    }
    cached = FALLBACK_PARTS;
    return cached;
  }
}

/** Test seam: the parts are cached because constructing `Intl` is not free. */
export function resetMoneyFormatCache(): void {
  cached = null;
}

/**
 * Splits a decimal string into sign and digits, rounding to {@link SCALE} with
 * HALF_UP.
 *
 * Rounding is done on the digit string rather than by converting to a number,
 * for the same reason the rest of this file exists. In practice the backend
 * already sends exactly two decimal places — every total is a whole number of
 * centavos — so this rounds nothing. It is here so that the one place rounding
 * could happen is explicit and tested, rather than implied by a `toFixed` call
 * somewhere in a component.
 */
export function splitAmount(amount: string): {
  negative: boolean;
  integer: string;
  fraction: string;
} {
  const trimmed = amount.trim();
  if (!DECIMAL.test(trimmed)) {
    throw new TypeError(`${amount} is not a decimal amount string.`);
  }

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [rawInteger = '0', rawFraction = ''] = unsigned.split('.');

  if (rawFraction.length <= SCALE) {
    return {
      negative,
      integer: rawInteger,
      fraction: rawFraction.padEnd(SCALE, '0'),
    };
  }

  const keep = rawFraction.slice(0, SCALE);
  const roundsUp = Number(rawFraction[SCALE]) >= 5;
  if (!roundsUp) {
    return { negative, integer: rawInteger, fraction: keep };
  }

  // Carry by string addition. `Number(keep) + 1` would be safe at scale 2, but
  // it is the kind of shortcut that stops being safe the moment SCALE changes.
  const carried = (BigInt(rawInteger + keep) + 1n).toString().padStart(SCALE + 1, '0');
  return {
    negative,
    integer: carried.slice(0, carried.length - SCALE),
    fraction: carried.slice(carried.length - SCALE),
  };
}

function group(integer: string, separator: string): string {
  // en-PH groups by threes. Derived positions would be more general, but every
  // locale this app supports in v1 is this one.
  let out = '';
  for (let i = 0; i < integer.length; i += 1) {
    if (i > 0 && (integer.length - i) % 3 === 0) {
      out += separator;
    }
    out += integer[i];
  }
  return out;
}

/**
 * True when the rounded digits are all zero, sign ignored.
 *
 * The single predicate {@link formatMoney} and {@link isNegative} both answer
 * from. They used to decide independently, and disagreed: `isNegative("-0.00")`
 * was false while `formatMoney("-0.00")` still emitted the minus, so one legend
 * row could show a minus sign in the non-negative text colour.
 */
function isZeroDigits(integer: string, fraction: string): boolean {
  return /^0+$/.test(integer) && /^0+$/.test(fraction);
}

/**
 * Formats a decimal-string amount as Philippine pesos.
 *
 * Negative amounts keep a leading minus rather than parentheses or a red
 * suffix: a refund is a real negative in this domain (spec §5), and the list,
 * the legend, and the chart all have to agree on what it looks like.
 *
 * @param amount a signed decimal string as the API returns it
 */
export function formatMoney(amount: string): string {
  const { negative, integer, fraction } = splitAmount(amount);
  const parts = localeParts();

  const digits = `${group(integer, parts.group)}${parts.decimal}${fraction}`;
  // Not `negative` alone: "-0.00" is what a category nets to when its refunds
  // exactly cancel its spending, and "-₱0.00" reads as a rendering bug to
  // everyone who sees it. "-0.001" rounds into the same place.
  const signed = negative && !isZeroDigits(integer, fraction) ? `${parts.minusSign}` : '';

  return parts.symbolFirst
    ? `${signed}${parts.currency}${parts.literal}${digits}`
    : `${signed}${digits}${parts.literal}${parts.currency}`;
}

/**
 * Validates an amount the client is about to *send*, without altering it.
 *
 * **Distinct from {@link splitAmount}, and the difference is the point.**
 * `splitAmount` rounds HALF_UP at scale 2 because that is correct at the
 * presentation boundary. The API is not a presentation boundary: it rejects
 * sub-centavo precision with a 400 rather than rounding it, on the grounds that
 * an amount the server quietly moved is money the user did not enter. Rounding
 * on the way out would hide that difference and send a number nobody typed.
 *
 * Checked client-side as well as server-side so a typo is a field error the
 * moment focus leaves the input, rather than a round trip later.
 *
 * @throws TypeError if the amount is not a decimal string, or carries more than
 *     {@link SCALE} decimal places
 */
export function assertSendableAmount(amount: string): string {
  const trimmed = amount.trim();
  if (!DECIMAL.test(trimmed)) {
    throw new TypeError(`${amount} is not an amount.`);
  }

  const fraction = trimmed.split('.')[1] ?? '';
  if (fraction.length > SCALE) {
    throw new TypeError(
      `${amount} is more precise than a centavo. Amounts carry at most ${SCALE} decimal places.`,
    );
  }

  return trimmed;
}

/**
 * The exact amount as a `number`, for chart geometry only.
 *
 * **Never use this for display, comparison, or arithmetic that a user sees.**
 * A chart bar is a few hundred physical pixels, so a double is more than
 * precise enough to decide how tall to draw one — but the label beside it must
 * come from {@link formatMoney} and the total must come from the backend.
 * Named to be conspicuous in review for that reason.
 */
export function toChartNumber(amount: string): number {
  const { negative, integer, fraction } = splitAmount(amount);
  const magnitude = Number(`${integer}.${fraction}`);
  return negative ? -magnitude : magnitude;
}

/** True when the amount is below zero — a refund, or a net-negative bucket. */
export function isNegative(amount: string): boolean {
  const { negative, integer, fraction } = splitAmount(amount);
  return negative && !isZeroDigits(integer, fraction);
}
