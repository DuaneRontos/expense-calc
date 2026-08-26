const { configure } = require('@testing-library/react-native');

/**
 * The second timeout budget, which `testTimeout` does not govern.
 *
 * `waitFor` and every `findBy*` arm their own timer rather than deferring to
 * jest's — `@testing-library/react-native/dist/wait-for.js` reads
 * `getConfig().asyncUtilTimeout`, which defaults to 1,000ms. So raising
 * `testTimeout` to 30s left async waits on a budget thirty times tighter, in
 * exactly the suites that were flaking: 27 of them across `useReports`,
 * `expensesFailure`, `signIn` and `overview`.
 *
 * Nothing else sets this. The jest-expo preset adds no `setupFilesAfterEnv`
 * that calls `configure()`, which is why this file exists rather than a
 * config value.
 *
 * **10s, deliberately below `testTimeout`.** A `waitFor` that runs out reports
 * the assertion that never became true; jest's timer reports only "Exceeded
 * timeout of Nms" with no clue which wait it was. Keeping this the smaller of
 * the two means the more useful message is always the one that fires. Do not
 * raise it past 30,000 without raising `testTimeout` first.
 *
 * Costs nothing on a passing run: `waitFor` resolves as soon as its callback
 * does, so the budget only bounds how long a genuine failure takes to report.
 */
configure({ asyncUtilTimeout: 10000 });
