/**
 * Errors from the FastAPI backend, made readable for the UI.
 *
 * FastAPI answers {"detail": "..."} for an HTTPException (e.g. 503) and
 * {"detail": [{"loc": [...], "msg": "..."}]} for request validation (422).
 */

/** The backend was reached but answered with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;
  /** The parsed JSON error body (null when there was none), for callers
   *  that need more than the message, e.g. an import's row report. */
  readonly body: unknown;

  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    // keep `instanceof ApiError` working when compiled down to ES5
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

interface ValidationIssue {
  loc?: (string | number)[];
  msg?: string;
}

/** Readable text from a FastAPI error body. */
export function formatApiDetail(body: unknown, status: number): string {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    return (detail as ValidationIssue[])
      .map((issue) => {
        const field = (issue.loc ?? []).filter((part) => part !== 'body').join('.');
        const msg = issue.msg ?? 'invalid value';
        return field ? `${field}: ${msg}` : msg;
      })
      .join('; ');
  }
  return `Backend responded HTTP ${status}`;
}

/** Parsed JSON of a 2xx response; throws ApiError for anything else. */
export async function readJson<T>(res: Response): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // not JSON (empty body, proxy error page)
  }
  throw new ApiError(res.status, formatApiDetail(body, res.status), body);
}
