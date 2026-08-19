import { buildExpenseQuery, ExpenseCalcClient } from '../client';
import { ApiError } from '../problem';

describe('buildExpenseQuery', () => {
  it('repeats category rather than joining it, which the server would reject', () => {
    const query = buildExpenseQuery({ category: ['DINING', 'GROCERIES'] });
    expect(query).toBe('?category=DINING&category=GROCERIES');
  });

  it('serializes sort as field,dir', () => {
    expect(buildExpenseQuery({ sort: { field: 'occurredOn', direction: 'desc' } })).toBe(
      '?sort=occurredOn%2Cdesc',
    );
  });

  it('keeps page 0 and a zero amount bound, which falsiness would drop', () => {
    const query = buildExpenseQuery({ page: 0, minAmount: '0' });
    expect(query).toContain('page=0');
    // minAmount=0 is the filter that excludes refunds; dropping it silently
    // returns them and the totals stop matching the report.
    expect(query).toContain('minAmount=0');
  });

  it('is empty when nothing is filtered', () => {
    expect(buildExpenseQuery()).toBe('');
  });
});

describe('ExpenseCalcClient', () => {
  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('calls the versioned base path', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ok([]));
    const client = new ExpenseCalcClient({ baseUrl: 'http://api.test', fetchImpl });

    await client.categories();

    expect(fetchImpl).toHaveBeenCalledWith('http://api.test/api/v1/categories', expect.anything());
  });

  it('throws ApiError carrying field violations for a 400', async () => {
    const problem = {
      type: 'https://expense-calc.invalid/problems/invalid-expense',
      title: 'Invalid expense',
      status: 400,
      detail: 'PHP is the only supported currency.',
      violations: [{ field: 'currency', message: 'PHP is the only supported currency.' }],
    };
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(JSON.stringify(problem), {
        status: 400,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    );
    const client = new ExpenseCalcClient({ baseUrl: 'http://api.test', fetchImpl });

    const error = await client.expenses().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ApiError);
    // Spec §8: surfaced inline against the offending field, not in a toast.
    expect((error as ApiError).messageFor('currency')).toBe('PHP is the only supported currency.');
  });

  it('sends both report bounds together, since the server rejects one alone', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(ok({ buckets: [] }));
    const client = new ExpenseCalcClient({ baseUrl: 'http://api.test', fetchImpl });

    await client.overTime({ from: '2026-01-01', to: '2026-02-01' }, 'MONTH');

    const url = fetchImpl.mock.calls[0]![0] as string;
    expect(url).toContain('from=2026-01-01');
    expect(url).toContain('to=2026-02-01');
    expect(url).toContain('bucket=month');
  });
});
