export class NiconicoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

export interface NiconicoApiErrorPayload {
  status: number;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
  errorDetail?: string | undefined;
}

export class NiconicoApiError extends NiconicoError {
  readonly status: number;
  readonly errorCode: string | undefined;
  readonly errorMessage: string | undefined;
  readonly errorDetail: string | undefined;
  readonly url: string;

  constructor(url: string, payload: NiconicoApiErrorPayload) {
    const parts = [String(payload.status)];
    if (payload.errorCode !== undefined) parts.push(`errorCode=${payload.errorCode}`);
    if (payload.errorDetail !== undefined) parts.push(`errorDetail=${payload.errorDetail}`);
    if (payload.errorMessage !== undefined) parts.push(`errorMessage=${payload.errorMessage}`);
    super(`Niconico API request failed: ${parts.join(" ")} (${url})`);
    this.status = payload.status;
    this.errorCode = payload.errorCode;
    this.errorMessage = payload.errorMessage;
    this.errorDetail = payload.errorDetail;
    this.url = url;
  }

  isAbuseBlocked(): boolean {
    return this.status === 403 && this.errorDetail === "AB001";
  }

  isUnauthorized(): boolean {
    return this.status === 401;
  }
}

export class NiconicoNetworkError extends NiconicoError {
  readonly url: string;
  readonly attempts: number;

  constructor(url: string, attempts: number, cause: unknown) {
    super(`Niconico request failed after ${attempts} attempt(s): ${url}`, { cause });
    this.url = url;
    this.attempts = attempts;
  }
}

export class NiconicoTimeoutError extends NiconicoError {
  readonly url: string;
  readonly timeoutMs: number;

  constructor(url: string, timeoutMs: number) {
    super(`Niconico request timed out after ${timeoutMs}ms: ${url}`);
    this.url = url;
    this.timeoutMs = timeoutMs;
  }
}

export function isNiconicoError(x: unknown): x is NiconicoError {
  return x instanceof NiconicoError;
}

export function isNiconicoApiError(x: unknown): x is NiconicoApiError {
  return x instanceof NiconicoApiError;
}

export interface NvapiMeta {
  status: number;
  errorCode?: string | undefined;
  errorMessage?: string | undefined;
}

export function assertNvapiMeta(url: string, meta: NvapiMeta | undefined): void {
  if (meta === undefined) {
    throw new NiconicoApiError(url, { status: 0, errorCode: "MISSING_META" });
  }
  if (meta.status >= 400) {
    throw new NiconicoApiError(url, {
      status: meta.status,
      errorCode: meta.errorCode,
      errorMessage: meta.errorMessage,
    });
  }
}
