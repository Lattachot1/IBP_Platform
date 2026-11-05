/**
 * The one place the frontend knows where the backend lives and how to call it.
 */

import { ApiError, readJson } from './apiError';

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

const OFFLINE_MESSAGE = `cannot reach the backend at ${API_BASE_URL}`;

/** Default per-call budget; long solver calls pass their own. */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface CallOptions {
  /** Abort and report a timeout after this many milliseconds (0 = never). */
  timeoutMs?: number;
}

/** The backend did not answer within the call's time budget. */
export class TimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`the backend did not answer within ${Math.round(timeoutMs / 1000)} s`);
    this.name = 'TimeoutError';
    // keep `instanceof TimeoutError` working when compiled down to ES5
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

async function call<T>(path: string, init: RequestInit, { timeoutMs = DEFAULT_TIMEOUT_MS }: CallOptions): Promise<T> {
  const controller = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal });
    return await readJson<T>(res);
  } catch (err) {
    if (controller.signal.aborted) throw new TimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** GET a backend path; throws ApiError (non-2xx), TimeoutError or a network error. */
export function getJson<T>(path: string, options: CallOptions = {}): Promise<T> {
  return call<T>(path, { method: 'GET' }, options);
}

/** POST a JSON body to a backend path; same errors as getJson. */
export function postJson<T>(path: string, body: unknown, options: CallOptions = {}): Promise<T> {
  return call<T>(
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    options,
  );
}

/** PATCH a JSON body (only the fields to change); same errors as getJson. */
export function patchJson<T>(path: string, body: unknown, options: CallOptions = {}): Promise<T> {
  return call<T>(
    path,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    options,
  );
}

/** POST a raw body (e.g. an uploaded CSV file, sent byte for byte); same errors as getJson. */
export function postRaw<T>(path: string, body: Blob | string, contentType: string, options: CallOptions = {}): Promise<T> {
  return call<T>(path, { method: 'POST', headers: { 'Content-Type': contentType }, body }, options);
}

/** True when the backend answered (even with an error status). */
export function backendAnswered(err: unknown): boolean {
  return err instanceof ApiError;
}

/** Readable reason for a failed call, for toasts and banners. */
export function describeFailure(err: unknown): string {
  if (err instanceof ApiError || err instanceof TimeoutError) return err.message;
  return OFFLINE_MESSAGE;
}
