import { NiconicoHttp, type FetchLike, type NiconicoHttpOptions } from "../src/http.js";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

export interface MockResponseSpec {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
  setCookie?: string[];
}

export interface MockFetch {
  fetch: FetchLike;
  calls: RecordedRequest[];
  only(): RecordedRequest;
  query(index?: number): URLSearchParams;
}

function withSetCookies(response: Response, cookies: string[]): Response {
  Object.defineProperty(response.headers, "getSetCookie", {
    value: () => cookies,
    configurable: true,
  });
  return response;
}

export function mockFetch(specs: MockResponseSpec | MockResponseSpec[]): MockFetch {
  const queue = Array.isArray(specs) ? specs : [specs];
  const calls: RecordedRequest[] = [];
  let index = 0;

  const impl: FetchLike = (input, init) => {
    const url = input;
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers;
    if (rawHeaders !== undefined) {
      for (const [key, value] of Object.entries(rawHeaders as Record<string, string>)) {
        headers[key] = value;
      }
    }
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : undefined,
    });

    const spec = queue[Math.min(index, queue.length - 1)] ?? {};
    index += 1;
    const status = spec.status ?? 200;
    const body = spec.text ?? (spec.json === undefined ? "" : JSON.stringify(spec.json));
    const response = new Response(body, {
      status,
      headers: { "Content-Type": "application/json", ...spec.headers },
    });
    return Promise.resolve(withSetCookies(response, spec.setCookie ?? []));
  };

  return {
    fetch: impl,
    calls,
    only() {
      if (calls.length !== 1) {
        throw new Error(`expected exactly 1 request, got ${calls.length}`);
      }
      const call = calls[0];
      if (call === undefined) throw new Error("no request recorded");
      return call;
    },
    query(at = 0) {
      const call = calls[at];
      if (call === undefined) throw new Error(`no request recorded at index ${at}`);
      return new URL(call.url).searchParams;
    },
  };
}

export function testHttp(mock: MockFetch, options: NiconicoHttpOptions = {}): NiconicoHttp {
  return new NiconicoHttp({ fetch: mock.fetch, retryAttempts: 1, ...options });
}

export function nvapi(data: unknown): { meta: { status: number }; data: unknown } {
  return { meta: { status: 200 }, data };
}

export const LIVE_ENABLED: boolean = process.env["NICONICO_LIVE"] === "1";

export const LIVE_SESSION: string | undefined = process.env["NICONICO_SESSION"];
