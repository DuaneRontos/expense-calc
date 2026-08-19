import {
  APP_NAME,
  DESTINATIONS,
  labelFor,
  matchDestination,
  webTitleFor,
} from '../navigation';

describe('matchDestination', () => {
  it('matches the two destinations', () => {
    expect(matchDestination('/')?.key).toBe('overview');
    expect(matchDestination('/expenses')?.key).toBe('expenses');
  });

  it('ignores a trailing slash', () => {
    // `web.output` is "static", and whether /expenses or /expenses/ is
    // canonical is the host's decision — a host that adds the slash would
    // otherwise serve a page with no active nav item and a generic header.
    expect(matchDestination('/expenses/')?.key).toBe('expenses');
    expect(matchDestination('/')?.key).toBe('overview');
  });

  it('matches a nested route to its section', () => {
    // #14 is likely to want /expenses/{id} as a detail view.
    expect(matchDestination('/expenses/123')?.key).toBe('expenses');
  });

  it('does not let the index route swallow every path', () => {
    // `/` matches exactly; prefix-matching it would claim the whole app.
    expect(matchDestination('/anything')).toBeUndefined();
  });

  it('returns nothing for routes that are not destinations', () => {
    // Both render inside the shell chrome, and neither has anything to filter.
    expect(matchDestination('/_sitemap')).toBeUndefined();
    expect(matchDestination('/+not-found')).toBeUndefined();
  });
});

describe('titles', () => {
  it('derives the web title from the destination label', () => {
    expect(webTitleFor('expenses')).toBe(`${labelFor('expenses')} · ${APP_NAME}`);
  });

  it('keeps one label per destination, so a rename cannot half-apply', () => {
    // The header, the nav buttons, the native announcement and the browser tab
    // all read from this list. They used to hold three independent copies.
    for (const destination of DESTINATIONS) {
      expect(webTitleFor(destination.key)).toContain(destination.label);
      expect(labelFor(destination.key)).toBe(destination.label);
    }
  });
});
