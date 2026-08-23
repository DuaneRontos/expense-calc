import {
  APP_NAME,
  DESTINATIONS,
  isExactly,
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
    // A route with nothing to filter, so the shell hides its filter chrome. The
    // built-in `_sitemap` is the reachable example; note that `+not-found` is a
    // route *file* name rather than anything `usePathname` returns — an
    // unmatched URL yields the URL itself, which the `/anything` case covers.
    expect(matchDestination('/_sitemap')).toBeUndefined();
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

describe('filterable destinations', () => {
  it('marks the expense list filterable and the overview not', () => {
    expect(DESTINATIONS.find((d) => d.key === 'expenses')?.filterable).toBe(true);
    // The overview renders reports over their own periods; a filter panel there
    // would change nothing on screen.
    expect(DESTINATIONS.find((d) => d.key === 'overview')?.filterable).toBe(false);
  });

  it('still matches a nested route to its destination, for the nav', () => {
    // The Expenses tab stays highlighted on a detail or create route even
    // though neither shows filters — the two questions have different answers,
    // which is why they are matched differently.
    expect(matchDestination('/expenses/new')?.key).toBe('expenses');
    expect(matchDestination('/expenses/abc-123')?.key).toBe('expenses');
  });
});

describe('isExactly', () => {
  it('is true only on the destination\'s own route', () => {
    expect(isExactly('/expenses', '/expenses')).toBe(true);
    expect(isExactly('/expenses/', '/expenses')).toBe(true);
  });

  it('is false on a nested route, so the tab still navigates there', () => {
    // The tab is highlighted inside the section and must still take you to its
    // top. Gating navigation on the highlight instead made it inert on every
    // detail page, with the browser's back button as the only way to the list.
    expect(isExactly('/expenses/abc-123', '/expenses')).toBe(false);
    expect(isExactly('/expenses/new', '/expenses')).toBe(false);
  });

  it('separates the two questions the router asks', () => {
    // Same path, different answers: within the section, not at its top.
    expect(matchDestination('/expenses/new')?.href).toBe('/expenses');
    expect(isExactly('/expenses/new', '/expenses')).toBe(false);
  });
});
