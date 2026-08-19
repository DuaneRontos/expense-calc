/**
 * RFC 7807 `application/problem+json`, as the backend emits it (spec §8).
 *
 * Spec §8 asks the client to surface `detail` **inline against the offending
 * field** rather than in a toast, which is why `violations` is parsed into a
 * lookup rather than kept as a list: a form field asks "is there a message for
 * me?", and that question should not be a linear scan written out at four
 * different call sites.
 */

/** One field-level violation from a 400. */
export interface Violation {
  field: string;
  message: string;
}

/** The problem document itself. Every field but `status` is optional in RFC 7807. */
export interface ProblemDetail {
  type?: string;
  title?: string;
  status: number;
  detail?: string;
  instance?: string;
  violations?: Violation[];
}

/**
 * A non-2xx response carrying a problem document.
 *
 * Thrown rather than returned so that a caller who forgets to check gets a
 * failure instead of `undefined` flowing into a screen. The parsed problem
 * rides along for the caller who does check.
 */
export class ApiError extends Error {
  readonly status: number;

  readonly problem: ProblemDetail;

  private readonly byField: Map<string, string>;

  constructor(problem: ProblemDetail) {
    super(problem.detail ?? problem.title ?? `Request failed with ${problem.status}.`);
    this.name = 'ApiError';
    this.status = problem.status;
    this.problem = problem;
    this.byField = new Map(
      (problem.violations ?? []).map((violation) => [violation.field, violation.message]),
    );
  }

  /** The message to render beside `field`, or undefined if it is not at fault. */
  messageFor(field: string): string | undefined {
    return this.byField.get(field);
  }

  /** Every field the server named. Useful for focusing the first bad input. */
  get fields(): string[] {
    return [...this.byField.keys()];
  }

  /** 401 — the access token is missing or expired and a refresh should be tried. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** 404 — distinguished because an absent expense is an empty state, not an error banner. */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

function isViolation(value: unknown): value is Violation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.field === 'string' && typeof candidate.message === 'string';
}

/**
 * Reads a problem document out of a failed response.
 *
 * Tolerates a body that is not problem+json at all. A 502 from a proxy in front
 * of the API returns HTML, and a client that assumed JSON there would throw a
 * parse error that hides the status code — which is the one piece of
 * information worth having.
 */
export async function readProblem(response: Response): Promise<ProblemDetail> {
  const fallback: ProblemDetail = {
    status: response.status,
    title: response.statusText || 'Request failed',
  };

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return fallback;
  }

  if (typeof body !== 'object' || body === null) {
    return fallback;
  }

  const document = body as Record<string, unknown>;
  const violations = Array.isArray(document.violations)
    ? document.violations.filter(isViolation)
    : undefined;

  return {
    // The server's own status is preferred where present, but the transport's
    // status is the one that actually happened — so it wins on disagreement.
    status: response.status,
    type: typeof document.type === 'string' ? document.type : undefined,
    title: typeof document.title === 'string' ? document.title : fallback.title,
    detail: typeof document.detail === 'string' ? document.detail : undefined,
    instance: typeof document.instance === 'string' ? document.instance : undefined,
    violations,
  };
}
