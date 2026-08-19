import { ApiError, readProblem } from '../problem';

describe('readProblem', () => {
  it('reads a problem document', async () => {
    const response = new Response(
      JSON.stringify({ title: 'Invalid expense', status: 400, detail: 'amount is not an amount.' }),
      { status: 400 },
    );

    await expect(readProblem(response)).resolves.toMatchObject({
      status: 400,
      title: 'Invalid expense',
      detail: 'amount is not an amount.',
    });
  });

  it('survives a non-JSON body, which a proxy in front of the API returns', async () => {
    const response = new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' });

    // The status is the one piece of information worth having here; a parse
    // error would have hidden it.
    await expect(readProblem(response)).resolves.toMatchObject({ status: 502 });
  });

  it('drops malformed violations rather than trusting the shape', async () => {
    const response = new Response(
      JSON.stringify({ status: 400, violations: [{ field: 'amount' }, 'nope'] }),
      { status: 400 },
    );

    await expect(readProblem(response)).resolves.toMatchObject({ violations: [] });
  });
});

describe('ApiError', () => {
  it('falls back through detail, title, then status for its message', () => {
    expect(new ApiError({ status: 400, detail: 'a', title: 'b' }).message).toBe('a');
    expect(new ApiError({ status: 400, title: 'b' }).message).toBe('b');
    expect(new ApiError({ status: 500 }).message).toContain('500');
  });

  it('distinguishes the statuses the UI treats differently', () => {
    expect(new ApiError({ status: 401 }).isUnauthorized).toBe(true);
    // A missing expense is an empty state, not an error banner.
    expect(new ApiError({ status: 404 }).isNotFound).toBe(true);
  });
});
