import { describe, expect, it } from "vitest";
import {
  buildQuery,
  COMMENT_BURST_LIMIT,
  COMMENT_REFILL_PER_SECOND,
  commentThrottle,
  extractUserSession,
  NiconicoHttp,
  RateLimiter,
  readCookieValue,
  pickRequestOptions,
  isNiconicoHost,
  TokenBucket,
  type FetchLike,
} from "../src/http.js";
import { NiconicoApiError, NiconicoError, NiconicoNetworkError, NiconicoTimeoutError } from "../src/errors.js";
import { mockFetch, nvapi, testHttp } from "./helpers.js";

describe("buildQuery", () => {
  it("drops undefined and prefixes with ?", () => {
    expect(buildQuery({ a: 1, b: undefined, c: "x" })).toBe("?a=1&c=x");
  });

  it("returns an empty string when nothing survives", () => {
    expect(buildQuery({ a: undefined })).toBe("");
  });

  it("repeats array values instead of comma-joining them", () => {
    expect(buildQuery({ genres: ["game", "anime"] })).toBe("?genres=game&genres=anime");
  });

  it("renders booleans as true/false", () => {
    expect(buildQuery({ allowFutureContents: false })).toBe("?allowFutureContents=false");
  });

  it("percent-encodes non-ASCII values", () => {
    expect(buildQuery({ keyword: "初音" })).toBe("?keyword=%E5%88%9D%E9%9F%B3");
  });
});

describe("extractUserSession", () => {
  const raw = "user_session_12345678_0000000000000000000000000000000000000000000000000000000000000000";

  it("accepts the bare value", () => {
    expect(extractUserSession(raw)).toBe(raw);
  });

  it("accepts a name=value pair", () => {
    expect(extractUserSession(`user_session=${raw}`)).toBe(raw);
  });

  it("accepts a pasted Cookie header with other cookies present", () => {
    expect(extractUserSession(`Cookie: nicosid=1.2; user_session=${raw}; lang=ja-jp`)).toBe(raw);
  });

  it("rejects unrelated text", () => {
    expect(extractUserSession("not-a-session")).toBeUndefined();
    expect(extractUserSession("   ")).toBeUndefined();
  });
});

describe("NiconicoHttp headers", () => {
  it("sends the frontend headers nvapi requires", async () => {
    const mock = mockFetch({ json: nvapi({}) });
    await testHttp(mock).getJson("https://nvapi.nicovideo.jp/v1/x");
    const headers = mock.only().headers;
    expect(headers["X-Frontend-Id"]).toBe("6");
    expect(headers["X-Frontend-Version"]).toBe("0");
    expect(headers["X-Niconico-Language"]).toBe("ja-jp");
  });

  it("omits the Cookie header without a session", async () => {
    const mock = mockFetch({ json: nvapi({}) });
    await testHttp(mock).getJson("https://nvapi.nicovideo.jp/v1/x");
    expect(mock.only().headers["Cookie"]).toBeUndefined();
  });

  it("sends the session as a user_session cookie", async () => {
    const mock = mockFetch({ json: nvapi({}) });
    await testHttp(mock, { session: "abc" }).getJson("https://nvapi.nicovideo.jp/v1/x");
    expect(mock.only().headers["Cookie"]).toBe("user_session=abc");
  });

  it("lets a per-request header override a default", async () => {
    const mock = mockFetch({ json: nvapi({}) });
    await testHttp(mock).getJson("https://nvapi.nicovideo.jp/v1/x", {
      headers: { "X-Frontend-Id": "9" },
    });
    expect(mock.only().headers["X-Frontend-Id"]).toBe("9");
  });
});

describe("NiconicoHttp error handling", () => {
  it("reports meta.errorCode and data.errorDetail from a failing body", async () => {
    const mock = mockFetch({
      status: 403,
      json: { meta: { status: 403, errorCode: "FORBIDDEN" }, data: { errorDetail: "AB001" } },
    });
    const error = await testHttp(mock)
      .getJson("https://nvapi.nicovideo.jp/v1/users/me/likes/items")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NiconicoApiError);
    const apiError = error as NiconicoApiError;
    expect(apiError.status).toBe(403);
    expect(apiError.errorCode).toBe("FORBIDDEN");
    expect(apiError.errorDetail).toBe("AB001");
    expect(apiError.isAbuseBlocked()).toBe(true);
  });

  it("reads the flat {code,message} envelope the feed host uses", async () => {
    const mock = mockFetch({ status: 400, json: { code: "badRequest", message: "invalid request." } });
    const error = (await testHttp(mock)
      .getJson("https://api.feed.nicovideo.jp/v1/actors")
      .catch((e: unknown) => e)) as NiconicoApiError;
    expect(error.errorCode).toBe("badRequest");
    expect(error.errorMessage).toBe("invalid request.");
  });

  it("survives an HTML error page", async () => {
    const mock = mockFetch({ status: 503, text: "<html>upstream connect error</html>" });
    const error = (await testHttp(mock)
      .getJson("https://x.invalid/y")
      .catch((e: unknown) => e)) as NiconicoApiError;
    expect(error).toBeInstanceOf(NiconicoApiError);
    expect(error.status).toBe(503);
  });

  it("treats a failing meta.status inside a 200 as an error", async () => {
    const mock = mockFetch({ status: 200, json: { meta: { status: 404, errorCode: "NOT_FOUND" } } });
    const error = (await testHttp(mock)
      .getJson("https://nvapi.nicovideo.jp/v1/x")
      .catch((e: unknown) => e)) as NiconicoApiError;
    expect(error.status).toBe(404);
    expect(error.errorCode).toBe("NOT_FOUND");
  });

  it("skips meta validation when asked", async () => {
    const mock = mockFetch({ json: { meta: { status: 404 }, data: { ok: true } } });
    await expect(testHttp(mock).getJson("https://x.invalid/y", { validateMeta: false })).resolves.toEqual({
      meta: { status: 404 },
      data: { ok: true },
    });
  });

  it("rejects a body that is not JSON on a 200", async () => {
    const mock = mockFetch({ status: 200, text: "<html>not json</html>" });
    const error = (await testHttp(mock)
      .getJson("https://x.invalid/y")
      .catch((e: unknown) => e)) as NiconicoApiError;
    expect(error.errorCode).toBe("INVALID_JSON");
  });
});

describe("NiconicoHttp retry", () => {
  it("retries a transient status and returns the eventual success", async () => {
    const mock = mockFetch([{ status: 503 }, { status: 503 }, { json: nvapi({ ok: true }) }]);
    const http = new NiconicoHttp({ fetch: mock.fetch, retryAttempts: 3, retryBaseDelayMs: 1 });
    await expect(http.getJson("https://nvapi.nicovideo.jp/v1/x")).resolves.toEqual(nvapi({ ok: true }));
    expect(mock.calls).toHaveLength(3);
  });

  it("gives up after the configured attempts", async () => {
    const mock = mockFetch({ status: 500 });
    const http = new NiconicoHttp({ fetch: mock.fetch, retryAttempts: 2, retryBaseDelayMs: 1 });
    await expect(http.getJson("https://nvapi.nicovideo.jp/v1/x")).rejects.toBeInstanceOf(NiconicoApiError);
    expect(mock.calls).toHaveLength(2);
  });

  it("does not retry a 404", async () => {
    const mock = mockFetch({ status: 404, json: { meta: { status: 404 } } });
    const http = new NiconicoHttp({ fetch: mock.fetch, retryAttempts: 3, retryBaseDelayMs: 1 });
    await expect(http.getJson("https://nvapi.nicovideo.jp/v1/x")).rejects.toBeInstanceOf(NiconicoApiError);
    expect(mock.calls).toHaveLength(1);
  });

  it("does not replay a write, so a POST is never doubled", async () => {
    const mock = mockFetch({ status: 503 });
    const http = new NiconicoHttp({ fetch: mock.fetch, retryAttempts: 3, retryBaseDelayMs: 1 });
    await expect(http.sendJson("https://nvapi.nicovideo.jp/v1/x", "POST", {})).rejects.toBeTruthy();
    expect(mock.calls).toHaveLength(1);
  });

  it("retries a write when the caller marks it idempotent", async () => {
    const mock = mockFetch([{ status: 503 }, { json: nvapi({}) }]);
    const http = new NiconicoHttp({ fetch: mock.fetch, retryAttempts: 3, retryBaseDelayMs: 1 });
    await http.postJson("https://public.nvcomment.nicovideo.jp/v1/threads", {}, { idempotent: true });
    expect(mock.calls).toHaveLength(2);
  });

  it("wraps a transport failure once the budget is spent", async () => {
    const failing: FetchLike = () => Promise.reject(new TypeError("network down"));
    const http = new NiconicoHttp({ fetch: failing, retryAttempts: 2, retryBaseDelayMs: 1 });
    await expect(http.getJson("https://x.invalid/y")).rejects.toBeInstanceOf(NiconicoNetworkError);
  });
});

describe("NiconicoHttp abort and timeout", () => {
  it("propagates a caller abort untouched", async () => {
    const controller = new AbortController();
    const impl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    const http = new NiconicoHttp({ fetch: impl, retryAttempts: 3, retryBaseDelayMs: 1 });
    const promise = http.getJson("https://x.invalid/y", { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("turns its own timeout into NiconicoTimeoutError rather than a caller abort", async () => {
    const impl: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("TimeoutError", "TimeoutError"));
        });
      });
    const http = new NiconicoHttp({ fetch: impl, timeoutMs: 5, retryAttempts: 1 });
    await expect(http.getJson("https://x.invalid/y")).rejects.toBeInstanceOf(NiconicoTimeoutError);
  });
});

describe("readCookieValue", () => {
  it("finds a cookie among several Set-Cookie headers", () => {
    const headers = new Headers();
    const response = new Response("", { headers });
    Object.defineProperty(response.headers, "getSetCookie", {
      value: () => ["nicosid=1.2; Path=/", "domand_bid=abc123; Path=/; Secure"],
    });
    expect(readCookieValue(response, "domand_bid")).toBe("abc123");
  });

  it("returns undefined when the cookie is absent", () => {
    const response = new Response("", { headers: new Headers() });
    expect(readCookieValue(response, "domand_bid")).toBeUndefined();
  });
});

describe("RateLimiter", () => {
  it("spaces successive acquisitions by the interval", async () => {
    const limiter = new RateLimiter();
    const started = Date.now();
    await limiter.acquire(30);
    await limiter.acquire(30);
    await limiter.acquire(30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);
  });
});

describe("TokenBucket", () => {
  it("lets a burst through immediately, then paces at the refill rate", async () => {
    const bucket = new TokenBucket(3, 20);
    const started = Date.now();
    await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);
    expect(Date.now() - started).toBeLessThan(40);
    await bucket.acquire();
    await bucket.acquire();
    expect(Date.now() - started).toBeGreaterThanOrEqual(80);
  });

  it("empties on penalize so a burst does not follow a 429", async () => {
    const bucket = new TokenBucket(5, 50);
    bucket.penalize();
    expect(bucket.available()).toBeLessThan(1);
    const started = Date.now();
    await bucket.acquire();
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });

  it("rejects a waiting acquisition when its signal aborts, without jamming the queue", async () => {
    const bucket = new TokenBucket(1, 0.01);
    await bucket.acquire();
    const controller = new AbortController();
    const waiting = bucket.acquire(controller.signal);
    controller.abort();
    await expect(waiting).rejects.toBeTruthy();
    const quick = new TokenBucket(1, 1000);
    await expect(quick.acquire()).resolves.toBeUndefined();
  });

  it("rejects a queued acquisition as soon as its signal aborts, without holding up the queue", async () => {
    const bucket = new TokenBucket(1, 5);
    await bucket.acquire();
    const started = Date.now();
    const ahead = bucket.acquire();
    const controller = new AbortController();
    const behind = bucket.acquire(controller.signal);
    const after = bucket.acquire();
    controller.abort(new Error("caller gave up"));
    await expect(behind).rejects.toThrow("caller gave up");
    expect(Date.now() - started).toBeLessThan(100);
    await ahead;
    await after;
    expect(Date.now() - started).toBeLessThan(550);
  });

  it("rejects at once, without queueing, when the signal has already aborted", async () => {
    const bucket = new TokenBucket(1, 0.01);
    await bucket.acquire();
    const controller = new AbortController();
    controller.abort(new Error("already gone"));
    const started = Date.now();
    await expect(bucket.acquire(controller.signal)).rejects.toThrow("already gone");
    expect(Date.now() - started).toBeLessThan(50);
  });

  it("waits for a whole token again when penalized while another caller is waiting", async () => {
    const bucket = new TokenBucket(1, 40);
    await bucket.acquire();
    const started = Date.now();
    const waiting = bucket.acquire();
    setTimeout(() => bucket.penalize(), 15);
    await waiting;
    expect(Date.now() - started).toBeGreaterThanOrEqual(35);
  });

  it("rejects settings that could never hand out a token", () => {
    expect(() => new TokenBucket(0, 1)).toThrow(NiconicoError);
    expect(() => new TokenBucket(5, 0)).toThrow(NiconicoError);
    expect(() => new TokenBucket(5, Number.POSITIVE_INFINITY)).toThrow(NiconicoError);
  });

  it("ships comment defaults that stay under NNDD-RE's ~100-request burst in any three minutes", () => {
    expect(COMMENT_BURST_LIMIT + COMMENT_REFILL_PER_SECOND * 180).toBeLessThan(100);
    expect(commentThrottle.capacity).toBe(COMMENT_BURST_LIMIT);
    expect(commentThrottle.refillPerSecond).toBe(COMMENT_REFILL_PER_SECOND);
    expect(new NiconicoHttp().commentThrottle).toBe(commentThrottle);
  });
});

describe("throttle and anonymous request options", () => {
  it("penalizes the request's throttle on a 429 and leaves the pacing to it rather than retrying", async () => {
    let penalized = 0;
    const throttle = {
      acquire: () => Promise.resolve(),
      penalize: () => {
        penalized += 1;
      },
    };
    const mock = mockFetch({ status: 429 });
    const http = new NiconicoHttp({ fetch: mock.fetch, retryAttempts: 3, retryBaseDelayMs: 1 });
    await expect(http.getJson("https://public.nvcomment.nicovideo.jp/v1/x", { throttle })).rejects.toBeInstanceOf(
      NiconicoApiError,
    );
    expect(penalized).toBe(1);
    expect(mock.calls).toHaveLength(1);
  });

  it("still retries a 429 for unthrottled requests", async () => {
    const mock = mockFetch([{ status: 429 }, { json: nvapi({}) }]);
    const http = new NiconicoHttp({ fetch: mock.fetch, retryAttempts: 2, retryBaseDelayMs: 1 });
    await expect(http.getJson("https://nvapi.nicovideo.jp/v1/x")).resolves.toEqual(nvapi({}));
    expect(mock.calls).toHaveLength(2);
  });

  it("omits the session cookie from an anonymous request", async () => {
    const mock = mockFetch({ json: nvapi({}) });
    await testHttp(mock, { session: "secret" }).getJson("https://nvapi.nicovideo.jp/v1/x", { anonymous: true });
    expect(mock.only().headers["Cookie"]).toBeUndefined();
  });

  it("forwards throttle and anonymous through pickRequestOptions", () => {
    const throttle = { acquire: () => Promise.resolve(), penalize: () => undefined };
    expect(pickRequestOptions({ throttle, anonymous: true })).toEqual({ throttle, anonymous: true });
  });

  it("sends a form body with the matching content type", async () => {
    const mock = mockFetch({ json: nvapi({}) });
    await testHttp(mock).sendForm("https://nvapi.nicovideo.jp/v1/x", "POST", { name: "初音", isPublic: false });
    const call = mock.only();
    expect(call.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(call.body).toBe("name=%E5%88%9D%E9%9F%B3&isPublic=false");
  });
});

describe("error classification", () => {
  it("keeps the maintenance errorCode once a 503 has exhausted its retries", async () => {
    const mock = mockFetch({ status: 503, json: { meta: { status: 503, errorCode: "MAINTENANCE" } } });
    const http = new NiconicoHttp({ fetch: mock.fetch, retryAttempts: 2, retryBaseDelayMs: 1 });
    const error = (await http.getJson("https://nvapi.nicovideo.jp/v1/x").catch((e: unknown) => e)) as NiconicoApiError;
    expect(mock.calls).toHaveLength(2);
    expect(error.status).toBe(503);
    expect(error.errorCode).toBe("MAINTENANCE");
    expect(error.isMaintenance()).toBe(true);
  });

  it("names a rate limit", async () => {
    const mock = mockFetch({ status: 429, json: { meta: { status: 429, errorCode: "TOO_MANY_REQUESTS" } } });
    const error = (await testHttp(mock)
      .getJson("https://nvapi.nicovideo.jp/v1/x")
      .catch((e: unknown) => e)) as NiconicoApiError;
    expect(error.isRateLimited()).toBe(true);
    expect(error.errorCode).toBe("TOO_MANY_REQUESTS");
  });

  it("reads data.reasonCode from a refusal", async () => {
    const mock = mockFetch({
      status: 400,
      json: { meta: { status: 400, errorCode: "FORBIDDEN" }, data: { reasonCode: "ADMINISTRATOR_DELETE_VIDEO" } },
    });
    const error = (await testHttp(mock)
      .getJson("https://www.nicovideo.jp/api/watch/v3_guest/sm1")
      .catch((e: unknown) => e)) as NiconicoApiError;
    expect(error.reasonCode).toBe("ADMINISTRATOR_DELETE_VIDEO");
  });
});

describe("regressions from review", () => {
  it("does not match a cookie whose name merely ends in user_session", () => {
    const good = "user_session_1_good";
    expect(extractUserSession(`old_user_session=bad; user_session=${good}`)).toBe(good);
    expect(extractUserSession(`x_user_session=bad`)).toBeUndefined();
  });

  it("converts a stalled body read into a timeout, not a raw fetch error", async () => {
    const impl: FetchLike = (_url, init) =>
      Promise.resolve({
        status: 200,
        ok: true,
        headers: new Headers(),
        text: () =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("TimeoutError", "TimeoutError"));
            });
          }),
      } as unknown as Response);
    const http = new NiconicoHttp({ fetch: impl, timeoutMs: 5, retryAttempts: 1 });
    await expect(http.getJson("https://x.invalid/y")).rejects.toBeInstanceOf(NiconicoTimeoutError);
  });

  it("stops waiting out a long Retry-After when the caller aborts", async () => {
    const controller = new AbortController();
    const mock = mockFetch({ status: 429, headers: { "retry-after": "600" } });
    const http = new NiconicoHttp({ fetch: mock.fetch, retryAttempts: 3, retryBaseDelayMs: 1 });
    const started = Date.now();
    const promise = http.getJson("https://x.invalid/y", { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await expect(promise).rejects.toBeTruthy();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("forwards every RequestOptions field, not just signal", () => {
    const signal = new AbortController().signal;
    expect(pickRequestOptions({ headers: { A: "1" }, signal, rateLimitMs: 5, idempotent: true })).toEqual({
      headers: { A: "1" },
      signal,
      rateLimitMs: 5,
      idempotent: true,
    });
    expect(pickRequestOptions({})).toEqual({});
  });
});

describe("session cookie scoping", () => {
  it("sends the cookie to niconico hosts", async () => {
    const mock = mockFetch({ json: nvapi({}) });
    await testHttp(mock, { session: "secret" }).getJson("https://nvapi.nicovideo.jp/v1/x");
    expect(mock.only().headers["Cookie"]).toBe("user_session=secret");
  });

  it("withholds the cookie from every other host", async () => {
    const mock = mockFetch({ json: nvapi({}) });
    await testHttp(mock, { session: "secret" }).getJson("https://third-party.example/collect");
    expect(mock.only().headers["Cookie"]).toBeUndefined();
  });

  it("is not fooled by lookalike hostnames", () => {
    expect(isNiconicoHost("https://nvapi.nicovideo.jp/v1/x")).toBe(true);
    expect(isNiconicoHost("https://nicovideo.jp/")).toBe(true);
    expect(isNiconicoHost("https://nico.ms/sm9")).toBe(true);
    expect(isNiconicoHost("https://evil-nicovideo.jp/")).toBe(false);
    expect(isNiconicoHost("https://nicovideo.jp.example.com/")).toBe(false);
    expect(isNiconicoHost("https://nicovideo.jp.evil/")).toBe(false);
    expect(isNiconicoHost("not a url")).toBe(false);
  });

  it("splits a comma-combined Set-Cookie when getSetCookie is absent", () => {
    const response = new Response("", {
      headers: { "set-cookie": "a=1; Expires=Wed, 09 Jun 2021 10:18:14 GMT, domand_bid=bid42; Path=/" },
    });
    expect(readCookieValue(response, "domand_bid")).toBe("bid42");
  });
});
