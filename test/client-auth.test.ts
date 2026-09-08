import { describe, expect, it } from "vitest";
import { NiconicoClient } from "../src/client.js";
import { createAuthApi, LOGIN_PAGE_URL, NiconicoAuthError } from "../src/auth.js";
import { createAccountPublicApi } from "../src/account-public.js";
import { NiconicoError } from "../src/errors.js";
import { mockFetch, nvapi, testHttp } from "./helpers.js";

const RAW_SESSION = "user_session_12345678_0000000000000000000000000000000000000000000000000000000000000000";

describe("NiconicoClient construction", () => {
  it("exposes every API surface", () => {
    const nico = new NiconicoClient();
    for (const key of [
      "auth",
      "accountPublic",
      "users",
      "search",
      "snapshot",
      "suggestion",
      "ranking",
      "mylists",
      "series",
      "videos",
      "genres",
      "watch",
      "comments",
      "streaming",
      "thumbInfo",
      "feed",
      "history",
      "likes",
    ] as const) {
      expect(nico[key], key).toBeDefined();
    }
  });

  it("works as a guest", () => {
    expect(new NiconicoClient().isLoggedIn()).toBe(false);
  });

  it("accepts every session paste form", () => {
    expect(new NiconicoClient({ session: RAW_SESSION }).isLoggedIn()).toBe(true);
    expect(new NiconicoClient({ session: `user_session=${RAW_SESSION}` }).isLoggedIn()).toBe(true);
    expect(new NiconicoClient({ session: `Cookie: user_session=${RAW_SESSION}; x=1` }).isLoggedIn()).toBe(true);
  });

  it("treats an empty session as guest rather than failing", () => {
    expect(new NiconicoClient({ session: "   " }).isLoggedIn()).toBe(false);
  });

  it("rejects a session it cannot parse, so a typo is not silently a guest", () => {
    expect(() => new NiconicoClient({ session: "oops" })).toThrow(NiconicoError);
  });
});

describe("AuthApi", () => {
  function auth(mock: ReturnType<typeof mockFetch>, session?: string) {
    const http = testHttp(mock, session === undefined ? {} : { session });
    return createAuthApi(http, createAccountPublicApi(http));
  }

  it("refuses to verify without a session and points at the login page", async () => {
    const error = (await auth(mockFetch({}))
      .verifySession()
      .catch((e: unknown) => e)) as NiconicoAuthError;
    expect(error).toBeInstanceOf(NiconicoAuthError);
    expect(error.message).toContain(LOGIN_PAGE_URL);
  });

  it("returns the identity behind a good session", async () => {
    const mock = mockFetch({
      json: nvapi({
        userId: "12345678",
        nickname: "テストユーザー",
        hasPremiumOrStrongerRights: false,
        premium: { type: "regular" },
        icons: { urls: { "150x150": "https://icon/large", "50x50": "https://icon/small" } },
      }),
    });
    const me = await auth(mock, RAW_SESSION).verifySession();
    expect(me).toEqual({
      userId: 12345678,
      nickname: "テストユーザー",
      isPremium: false,
      premiumType: "regular",
      iconUrl: "https://icon/large",
    });
  });

  it("turns a rejected cookie into an auth error, not a raw 401", async () => {
    const mock = mockFetch({ status: 401, json: { meta: { status: 401 } } });
    await expect(auth(mock, RAW_SESSION).verifySession()).rejects.toBeInstanceOf(NiconicoAuthError);
  });

  it("reduces a rejected session to false without throwing", async () => {
    const mock = mockFetch({ status: 401, json: { meta: { status: 401 } } });
    await expect(auth(mock, RAW_SESSION).isSessionValid()).resolves.toBe(false);
    await expect(auth(mockFetch({})).isSessionValid()).resolves.toBe(false);
  });

  it("falls back to the small icon when no large one is present", async () => {
    const mock = mockFetch({
      json: nvapi({ userId: "1", nickname: "n", icons: { urls: { "50x50": "https://icon/small" } } }),
    });
    await expect(auth(mock, RAW_SESSION).verifySession()).resolves.toMatchObject({
      iconUrl: "https://icon/small",
    });
  });
});

describe("comment resolver wiring", () => {
  it("fetches watch data with noSideEffect before reading comments", async () => {
    const mock = mockFetch([
      {
        json: nvapi({
          video: { id: "sm9" },
          comment: {
            nvComment: {
              threadKey: "jwt",
              server: "https://public.nvcomment.nicovideo.jp",
              params: { targets: [{ id: "1", fork: "main" }], language: "ja-jp" },
            },
          },
        }),
      },
      { json: { meta: { status: 200 }, data: { threads: [{ id: "1", fork: "main", comments: [] }] } } },
    ]);
    const nico = new NiconicoClient({ fetch: mock.fetch, retryAttempts: 1 });
    await nico.comments.fetchCommentsByVideoId("sm9");

    expect(mock.calls[0]?.url).toContain("/api/watch/v3_guest/sm9");
    expect(mock.query(0).get("noSideEffect")).toBe("true");
    expect(mock.calls[1]?.url).toBe("https://public.nvcomment.nicovideo.jp/v1/threads");
  });

  it("reports watch data that carries no comment credentials", async () => {
    const mock = mockFetch({ json: nvapi({ video: { id: "sm9" }, comment: { nvComment: null } }) });
    const nico = new NiconicoClient({ fetch: mock.fetch, retryAttempts: 1 });
    await expect(nico.comments.fetchCommentsByVideoId("sm9")).rejects.toThrow(/no nvComment credentials/);
  });
});
