import { countActive, toggleIn } from '../ExpenseQueryProvider';
import { merge, serializeQuery } from '../useExpenses';
import type { ExpenseQuery, ExpenseSummary } from '../../api/types';


const row = (id: string): ExpenseSummary => ({
  id,
  amount: '500.00',
  currency: 'PHP',
  occurredOn: '2026-07-15',
  merchant: 'Identical Merchant',
  description: 'Stress row',
  category: 'UNCLASSIFIED',
  categoryLabel: 'Unclassified',
});

describe('merge', () => {
  it('appends a page', () => {
    expect(merge([row('a')], [row('b')]).map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('drops a row already on screen', () => {
    // The server appends `id` to every sort as a tiebreaker so pages cannot
    // drop or duplicate rows (spec §6), and 60 rows sharing an amount, date and
    // merchant were verified against a live API without a single repeat. This
    // guards the render anyway: two rows with the same React key is a warning
    // and a mis-render, and rows genuinely can shift if the data changes
    // mid-scroll.
    expect(merge([row('a'), row('b')], [row('b'), row('c')]).map((r) => r.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps the server order rather than sorting', () => {
    // Ordering is the server's answer; re-sorting here would silently disagree
    // with the sort control above the list.
    expect(merge([], [row('z'), row('a')]).map((r) => r.id)).toEqual(['z', 'a']);
  });
});

describe('countActive', () => {
  it('counts nothing for a bare query', () => {
    expect(countActive({})).toBe(0);
    expect(countActive({ sort: { field: 'occurredOn', direction: 'desc' } })).toBe(0);
  });

  it('does not count sort or paging as filters', () => {
    // Both are always present; counting them would show "Filters (2)" on a
    // screen with nothing filtered.
    expect(countActive({ page: 3, sort: { field: 'merchant', direction: 'asc' } })).toBe(0);
  });

  it('counts a category selection once regardless of how many are chosen', () => {
    expect(countActive({ category: ['DINING', 'GROCERIES'] })).toBe(1);
    expect(countActive({ category: [] })).toBe(0);
  });

  it('counts each active bound', () => {
    expect(countActive({ from: '2026-08-01', to: '2026-09-01', merchant: 'SM' })).toBe(3);
  });

  it('ignores an empty string, which a cleared input leaves behind', () => {
    expect(countActive({ merchant: '', q: '' })).toBe(0);
  });

  it('counts a zero amount bound, which excludes refunds', () => {
    // `minAmount=0` is a real filter — falsiness would drop it and quietly
    // include the refunds the user asked to hide.
    expect(countActive({ minAmount: '0' })).toBe(1);
  });
});

describe('serializeQuery', () => {
  it('is insensitive to the order the filters were set in', () => {
    // The provider appends a key the first time each filter is set, so clearing
    // a filter and retyping it reorders the object. Serializing the object
    // directly made that a different cache key: the header flashed "Loading…"
    // and a redundant round trip returned byte-identical rows.
    const setMerchantFirst: ExpenseQuery = { merchant: 'SM', q: 'rice' };
    const setDescriptionFirst: ExpenseQuery = { q: 'rice', merchant: 'SM' };

    expect(serializeQuery(setMerchantFirst)).toBe(serializeQuery(setDescriptionFirst));
    expect(JSON.stringify(setMerchantFirst)).not.toBe(JSON.stringify(setDescriptionFirst));
  });

  it('separates queries that genuinely differ', () => {
    expect(serializeQuery({ merchant: 'SM' })).not.toBe(serializeQuery({ merchant: 'Grab' }));
    expect(serializeQuery({ minAmount: '0' })).not.toBe(serializeQuery({}));
  });

  it('ignores the page, so paging does not look like a new query', () => {
    // `loading` is derived from this. Including `page` would blank the list on
    // every append instead of showing rows beneath the ones already there.
    expect(serializeQuery({ merchant: 'SM', page: 3 })).toBe(serializeQuery({ merchant: 'SM' }));
  });
});

describe('toggleIn', () => {
  it('adds a value that is absent and removes one that is present', () => {
    expect(toggleIn(['DINING'], 'GROCERIES')).toEqual(['DINING', 'GROCERIES']);
    expect(toggleIn(['DINING', 'GROCERIES'], 'DINING')).toEqual(['GROCERIES']);
  });

  it('does not mutate the selection it was given', () => {
    const selection = ['DINING'];
    toggleIn(selection, 'GROCERIES');
    expect(selection).toEqual(['DINING']);
  });

  it('composes, which is what a batched double-tap depends on', () => {
    // The old toggle read the render-time array and wrote through an updater,
    // so two toggles in one batch both started from the same copy and the
    // second discarded the first.
    expect(toggleIn(toggleIn([], 'DINING'), 'GROCERIES')).toEqual(['DINING', 'GROCERIES']);
  });
});
