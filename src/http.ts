import {
  NiconicoApiError,
  NiconicoError,
  NiconicoNetworkError,
  NiconicoTimeoutError,
  assertNvapiMeta,
  type NiconicoApiErrorPayload,
  type NvapiMeta,
} from "./errors.js";

export type FrontendId = 6 | 8 | 9;

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface RawResponse {
  response: Response;
  text: string;
}

export interface RequestThrottle {
  acquire(signal?: AbortSignal): Promise<void>;
  penalize(): void;
}

export interface NiconicoHttpOptions {
  session?: string | undefined;
  frontendId?: FrontendId | undefined;
  frontendVersion?: string | undefined;
  userAgent?: string | undefined;
  timeoutMs?: number | undefined;
  retryAttempts?: number | undefined;
  retryBaseDelayMs?: number | undefined;
  headers?: Record<string, string> | undefined;
  fetch?: FetchLike | undefined;
  commentThrottle?: RequestThrottle | undefined;
}

export interface RequestOptions {
  headers?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
  validateMeta?: boolean | undefined;
  rateLimitMs?: number | undefined;
  idempotent?: boolean | undefined;
  throttle?: RequestThrottle | undefined;
  anonymous?: boolean | undefined;
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const NICOVIDEO_ORIGIN = "https://www.nicovideo.jp";

const SESSION_COOKIE_DOMAINS = ["nicovideo.jp", "nico.ms"] as const;

export function isNiconicoHost(url: string): boolean {
  let hostname: string;
  try {
    ({ hostname } = new URL(url));
  } catch {
    return false;
  }
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return SESSION_COOKIE_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

class RetryableHttpError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | undefined;
  readonly envelope: ErrorEnvelope;
  constructor(status: number, url: string, retryAfterMs: number | undefined, envelope: ErrorEnvelope) {
    super(`Transient HTTP ${status} on ${url}`);
    this.name = "RetryableHttpError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.envelope = envelope;
  }
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (raw === null) return undefined;
  const seconds = Number.parseFloat(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - Date.now());
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function abortReason(signal: AbortSignal): unknown {
  return signal.reason;
}

export function abortableSleep(ms: number, maybeSignal: AbortSignal | undefined): Promise<void> {
  if (maybeSignal === undefined) return sleep(ms);
  const signal = maybeSignal;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function rejectOnAbort(promise: Promise<void>, signal: AbortSignal): Promise<void> {
  let stopListening = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => {
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    stopListening = () => {
      signal.removeEventListener("abort", onAbort);
    };
  });
  return Promise.race([promise, aborted]).finally(() => {
    stopListening();
  });
}

export class RateLimiter {
  private lastAt = 0;
  private lock: Promise<void> = Promise.resolve();

  acquire(intervalMs: number): Promise<void> {
    const next = this.lock.then(() => this.waitTurn(intervalMs));
    this.lock = next;
    return next;
  }

  private async waitTurn(intervalMs: number): Promise<void> {
    const wait = intervalMs - (Date.now() - this.lastAt);
    if (wait > 0) await sleep(wait);
    this.lastAt = Date.now();
  }
}

export const commentRateLimiter: RateLimiter = new RateLimiter();

export const COMMENT_RATE_LIMIT_MS = 334;

export class TokenBucket implements RequestThrottle {
  readonly capacity: number;
  readonly refillPerSecond: number;
  private tokens: number;
  private refilledAt = Date.now();
  private lock: Promise<void> = Promise.resolve();

  constructor(capacity: number, refillPerSecond: number) {
    if (!(capacity >= 1) || !(refillPerSecond > 0) || !Number.isFinite(refillPerSecond)) {
      throw new NiconicoError(
        `TokenBucket needs capacity >= 1 and a positive refill rate (got ${capacity}, ${refillPerSecond})`,
      );
    }
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity;
  }

  acquire(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted === true) return Promise.reject(abortReason(signal));
    const turn = this.lock.then(() => this.take(signal));
    this.lock = turn.catch(() => undefined);
    return signal === undefined ? turn : rejectOnAbort(turn, signal);
  }

  penalize(): void {
    this.tokens = 0;
    this.refilledAt = Date.now();
  }

  available(): number {
    this.refill();
    return this.tokens;
  }

  private refill(): void {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.refilledAt) / 1000) * this.refillPerSecond);
    this.refilledAt = now;
  }

  private async take(signal: AbortSignal | undefined): Promise<void> {
    signal?.throwIfAborted();
    this.refill();
    while (this.tokens < 1) {
      await abortableSleep(Math.ceil(((1 - this.tokens) / this.refillPerSecond) * 1000), signal);
      this.refill();
    }
    this.tokens -= 1;
  }
}

export const COMMENT_BURST_LIMIT = 40;

export const COMMENT_REFILL_PER_SECOND = 0.25;

export const commentThrottle: TokenBucket = new TokenBucket(COMMENT_BURST_LIMIT, COMMENT_REFILL_PER_SECOND);

export class NiconicoHttp {
  readonly session: string | undefined;
  readonly commentThrottle: RequestThrottle;
  private readonly frontendId: FrontendId;
  private readonly frontendVersion: string;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly retryAttempts: number;
  private readonly retryBaseDelayMs: number;
  private readonly extraHeaders: Record<string, string>;
  private readonly fetchImpl: FetchLike;

  constructor(options: NiconicoHttpOptions = {}) {
    this.session = options.session;
    this.frontendId = options.frontendId ?? 6;
    this.frontendVersion = options.frontendVersion ?? "0";
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.retryAttempts = Math.max(1, options.retryAttempts ?? 3);
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 500;
    this.extraHeaders = options.headers ?? {};
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.commentThrottle = options.commentThrottle ?? commentThrottle;
  }

  isLoggedIn(): boolean {
    return this.session !== undefined;
  }

  baseHeaders(url: string, anonymous = false): Record<string, string> {
    const headers: Record<string, string> = {
      "User-Agent": this.userAgent,
      "X-Frontend-Id": String(this.frontendId),
      "X-Frontend-Version": this.frontendVersion,
      "X-Niconico-Language": "ja-jp",
      Referer: `${NICOVIDEO_ORIGIN}/`,
      ...this.extraHeaders,
    };
    if (!anonymous && this.session !== undefined && isNiconicoHost(url)) {
      headers["Cookie"] = `user_session=${this.session}`;
    }
    return headers;
  }

  private async requestOnce(
    url: string,
    method: HttpMethod,
    body: string | undefined,
    extraHeaders: Record<string, string> | undefined,
    signal: AbortSignal | undefined,
    anonymous: boolean,
  ): Promise<RawResponse> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const composed = signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
    const headers: Record<string, string> = { ...this.baseHeaders(url, anonymous), ...extraHeaders };
    const init: RequestInit = { method, headers, signal: composed, redirect: "follow" };
    if (body !== undefined) {
      init.body = body;
    }
    try {
      const response = await this.fetchImpl(url, init);
      return { response, text: await response.text() };
    } catch (error) {
      if (signal?.aborted === true) throw error;
      if (timeout.aborted) throw new NiconicoTimeoutError(url, this.timeoutMs);
      throw error;
    }
  }

  async request(
    url: string,
    init: { method?: HttpMethod; body?: string } = {},
    extraHeaders?: Record<string, string>,
    options: {
      signal?: AbortSignal | undefined;
      rateLimitMs?: number | undefined;
      idempotent?: boolean | undefined;
      throttle?: RequestThrottle | undefined;
      anonymous?: boolean | undefined;
    } = {},
  ): Promise<RawResponse> {
    const method = init.method ?? "GET";
    const retryable = options.idempotent ?? method === "GET";
    const maxAttempts = retryable ? this.retryAttempts : 1;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (options.rateLimitMs !== undefined) {
        await commentRateLimiter.acquire(options.rateLimitMs);
      }
      if (options.throttle !== undefined) {
        await options.throttle.acquire(options.signal);
      }
      try {
        const raw = await this.requestOnce(
          url,
          method,
          init.body,
          extraHeaders,
          options.signal,
          options.anonymous === true,
        );
        if (raw.response.status === 429 && options.throttle !== undefined) {
          options.throttle.penalize();
          return raw;
        }
        if (!isTransientStatus(raw.response.status)) {
          return raw;
        }
        throw new RetryableHttpError(
          raw.response.status,
          url,
          parseRetryAfterMs(raw.response.headers),
          readErrorEnvelope(parseJsonText(raw.text)),
        );
      } catch (error) {
        if (options.signal?.aborted === true) throw error;
        if (error instanceof NiconicoTimeoutError && !retryable) throw error;
        lastError = error;
        const isLast = attempt + 1 >= maxAttempts;
        if (isLast) break;
        const retryAfter = error instanceof RetryableHttpError ? error.retryAfterMs : undefined;
        const backoff = Math.min(this.retryBaseDelayMs * 2 ** attempt, 8000);
        await abortableSleep(retryAfter ?? backoff + Math.random() * 250, options.signal);
      }
    }

    if (lastError instanceof RetryableHttpError) {
      throw new NiconicoApiError(url, { status: lastError.status, ...lastError.envelope });
    }
    if (lastError instanceof NiconicoTimeoutError) {
      throw lastError;
    }
    throw new NiconicoNetworkError(url, maxAttempts, lastError);
  }

  async getJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
    const raw = await this.request(url, { method: "GET" }, options.headers, {
      signal: options.signal,
      rateLimitMs: options.rateLimitMs,
      idempotent: options.idempotent ?? true,
      throttle: options.throttle,
      anonymous: options.anonymous,
    });
    return this.parseJsonResponse<T>(url, raw, options.validateMeta !== false);
  }

  async sendJson<T>(
    url: string,
    method: Exclude<HttpMethod, "GET">,
    body: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = { ...options.headers };
    const init: { method: Exclude<HttpMethod, "GET">; body?: string } = { method };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
    const raw = await this.request(url, init, headers, {
      signal: options.signal,
      rateLimitMs: options.rateLimitMs,
      idempotent: options.idempotent,
      throttle: options.throttle,
      anonymous: options.anonymous,
    });
    return this.parseJsonResponse<T>(url, raw, options.validateMeta !== false);
  }

  async postJson<T>(url: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return this.sendJson<T>(url, "POST", body, options);
  }

  async sendForm<T>(
    url: string,
    method: Exclude<HttpMethod, "GET">,
    form: Readonly<Record<string, string | number | boolean>>,
    options: RequestOptions = {},
  ): Promise<T> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(form)) body.set(key, String(value));
    const raw = await this.request(
      url,
      { method, body: body.toString() },
      { ...options.headers, "Content-Type": "application/x-www-form-urlencoded" },
      {
        signal: options.signal,
        rateLimitMs: options.rateLimitMs,
        idempotent: options.idempotent,
        throttle: options.throttle,
        anonymous: options.anonymous,
      },
    );
    return this.parseJsonResponse<T>(url, raw, options.validateMeta !== false);
  }

  async getText(url: string, options: Omit<RequestOptions, "validateMeta"> = {}): Promise<string> {
    const raw = await this.request(url, { method: "GET" }, options.headers, {
      signal: options.signal,
      rateLimitMs: options.rateLimitMs,
      idempotent: options.idempotent ?? true,
      throttle: options.throttle,
      anonymous: options.anonymous,
    });
    if (!raw.response.ok) {
      throw new NiconicoApiError(url, { status: raw.response.status });
    }
    return raw.text;
  }

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  parseJsonResponse<T>(url: string, raw: RawResponse, validateMeta: boolean): T {
    const { response, text } = raw;
    const parsed = parseJsonText(text);

    if (!response.ok) {
      throw new NiconicoApiError(url, {
        status: response.status,
        ...readErrorEnvelope(parsed),
      });
    }
    if (parsed === undefined) {
      throw new NiconicoApiError(url, { status: response.status, errorCode: "INVALID_JSON" });
    }
    if (validateMeta) {
      assertNvapiMeta(url, readMeta(parsed));
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return parsed as T;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readMeta(body: unknown): NvapiMeta | undefined {
  if (!isRecord(body)) return undefined;
  const meta = body["meta"];
  if (!isRecord(meta) || typeof meta["status"] !== "number") return undefined;
  return {
    status: meta["status"],
    errorCode: optionalString(meta["errorCode"]),
    errorMessage: optionalString(meta["errorMessage"]),
  };
}

type ErrorEnvelope = Pick<NiconicoApiErrorPayload, "errorCode" | "errorMessage" | "errorDetail" | "reasonCode">;

function parseJsonText(text: string): unknown {
  try {
    return text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

function readErrorEnvelope(body: unknown): ErrorEnvelope {
  if (!isRecord(body)) return {};
  const meta = isRecord(body["meta"]) ? body["meta"] : {};
  const data = isRecord(body["data"]) ? body["data"] : {};
  return {
    errorCode: optionalString(meta["errorCode"]) ?? optionalString(body["code"]),
    errorMessage: optionalString(meta["errorMessage"]) ?? optionalString(body["message"]),
    errorDetail: optionalString(data["errorDetail"]),
    reasonCode: optionalString(data["reasonCode"]),
  };
}

function splitSetCookieValue(value: string): string[] {
  return value.split(/,\s*(?=[^\s;,=]+=)/).filter((cookie) => cookie.length > 0);
}

export function readSetCookies(response: Response): string[] {
  const headers: Headers & { getSetCookie?: () => string[] } = response.headers;
  const raw =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter((value): value is string => value !== null);
  return raw.flatMap(splitSetCookieValue);
}

export function readCookieValue(response: Response, name: string): string | undefined {
  const prefix = `${name}=`;
  for (const cookie of readSetCookies(response)) {
    if (cookie.startsWith(prefix)) {
      const value = cookie.slice(prefix.length).split(";")[0];
      if (value !== undefined && value.length > 0) return value;
    }
  }
  return undefined;
}

export function pickRequestOptions(params: Readonly<Partial<RequestOptions>>): RequestOptions {
  const options: RequestOptions = {};
  if (params.headers !== undefined) options.headers = params.headers;
  if (params.signal !== undefined) options.signal = params.signal;
  if (params.validateMeta !== undefined) options.validateMeta = params.validateMeta;
  if (params.rateLimitMs !== undefined) options.rateLimitMs = params.rateLimitMs;
  if (params.idempotent !== undefined) options.idempotent = params.idempotent;
  if (params.throttle !== undefined) options.throttle = params.throttle;
  if (params.anonymous !== undefined) options.anonymous = params.anonymous;
  return options;
}

export function buildQuery(
  params: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, item);
    } else {
      search.set(key, typeof value === "boolean" ? String(value) : String(value));
    }
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : "";
}

export function extractUserSession(input: string): string | undefined {
  const value = input.trim().replace(/^cookie:\s*/i, "");
  if (value.length === 0) return undefined;
  const match = value.match(/(?:^|[;,]\s*)user_session=([^;\s]+)/i);
  if (match?.[1] !== undefined) {
    return match[1];
  }
  if (/^user_session_[0-9a-z_]+$/i.test(value)) {
    return value;
  }
  return undefined;
}
