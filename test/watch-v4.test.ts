import { describe, expect, it } from "vitest";
import { createWatchApi, WatchKeyRejectedError, type WatchV4Data, type WatchV4Result } from "../src/watch.js";
import type { WatchResult } from "../src/watch.js";
import { createStreamingApi, DomandUnavailableError, isWatchV4Result, pickAudioForVideo } from "../src/streaming.js";
import { NiconicoHttp } from "../src/http.js";
import { NiconicoApiError } from "../src/errors.js";
import { mockFetch, nvapi, testHttp, unthrottled } from "./helpers.js";

const SESSION = "user_session_1_secret";

function v4Data(overrides: Partial<WatchV4Data> = {}): WatchV4Data {
  return {
    responseType: "normal",
    client: { nicosid: "n", watchId: "sm9", watchTrackId: "abcdefghij_1700000000000" },
    comment: {
      threads: [],
      layers: [],
      ng: { ngScore: { isDisabled: false }, owner: [], viewer: null },
      isAttentionRequired: false,
      nvComment: null,
    },
    media: {
      contents: {
        videos: [
          {
            id: "video-h264-720p",
            isAvailable: true,
            qualityLevel: 3,
            label: "720p",
            bitRate: 3,
            width: 1280,
            height: 720,
          },
          {
            id: "video-h264-1080p",
            isAvailable: false,
            qualityLevel: 4,
            label: "1080p",
            bitRate: 6,
            width: 1920,
            height: 1080,
          },
        ],
        audios: [
          {
            id: "audio-aac-64kbps",
            isAvailable: true,
            qualityLevel: 0,
            bitRate: 64,
            samplingRate: 44100,
            integratedLoudness: -6,
            truePeak: 0,
          },
          {
            id: "audio-aac-128kbps",
            isAvailable: true,
            qualityLevel: 1,
            bitRate: 128,
            samplingRate: 44100,
            integratedLoudness: -6,
            truePeak: 0,
          },
        ],
      },
      isStoryboardAvailable: true,
      accessRightKey: "v4-key",
      hls: {
        url: "https://delivery.domand.nicovideo.jp/hlsbid/x/playlists/variants/y.m3u8?session=s",
        outputs: [{ assetUnitNames: ["video-h264-720p", "audio-aac-128kbps"] }],
        createdAt: "2026-10-31T01:42:00+00:00",
        expiredAt: "2026-11-01T01:42:00+00:00",
      },
    },
    video: {
      id: "sm9",
      contentType: "long",
      title: "t",
      description: "",
      count: { view: 1, comment: 1, mylist: 1, like: 1 },
      duration: 320,
      thumbnail: { normal: null, middle: null, large: null, player: null, ogp: null, short: null },
      registeredAt: "2007-03-06T00:33:00+09:00",
      permission: {
        isPrivate: false,
        isDeleted: false,
        isAuthenticationRequired: false,
        isEmbedPlayerAllowed: true,
        isGiftAllowed: true,
        rating: { isAdult: false },
      },
      hasLyrics: false,
      isChannelVideo: false,
      isOwnedByViewer: false,
      isLikedByViewer: false,
    },
    genre: { key: "none", label: "未設定", isImmoral: false, isDisabled: false, isNotSet: true },
    tags: {
      items: [],
      hasR18Tag: false,
      isPublishedNicoscript: false,
      edit: { isEditable: false, uneditableReason: null, editKey: null },
    },
    lazy: { authKey: "lazy-key" },
    system: { serverTime: "t" },
    viewer: null,
    payment: {
      ppv: { isEnabled: false, showPromotion: false },
      admission: { isEnabled: false, showPromotion: false },
      continuationBenefit: { isEnabled: false, showPromotion: false },
      premium: { isEnabled: false, showPromotion: false },
      watchableUserType: "all",
      commentableUserType: "all",
      billingType: "free",
    },
    okReason: "PURELY",
    ...overrides,
  };
}

function v4Result(overrides: Partial<WatchV4Result> = {}, data: Partial<WatchV4Data> = {}): WatchV4Result {
  return {
    data: v4Data(data),
    actionTrackId: "abcdefghij_1700000000000",
    guest: false,
    domandBidCookie: "bid-from-watch",
    ...overrides,
  };
}

const lazyBody = nvapi({ owner: null, ranking: { teiban: null }, series: null, waku: {} });

describe("getWatchV4", () => {
  it("posts a guest request without the cookie and keeps the domand_bid it issues", async () => {
    const mock = mockFetch({ json: nvapi(v4Data()), setCookie: ["domand_bid=bid42; Path=/; Secure"] });
    const result = await createWatchApi(testHttp(mock)).getWatchV4("https://www.nicovideo.jp/watch/sm9");

    const call = mock.only();
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://nvapi.nicovideo.jp/v4/watch/sm9");
    expect(call.headers["X-Request-With"]).toBe("https://www.nicovideo.jp");
    expect(call.headers["Content-Type"]).toBe("application/json");
    expect(call.headers["Cookie"]).toBeUndefined();
    const body = JSON.parse(call.body ?? "{}") as { actionTrackId: string; asGuest?: boolean };
    expect(body.asGuest).toBe(true);
    expect(body.actionTrackId).toMatch(/^[a-zA-Z0-9]{10}_\d{13}$/);
    expect(result.actionTrackId).toBe(body.actionTrackId);
    expect(result.guest).toBe(true);
    expect(result.domandBidCookie).toBe("bid42");
  });

  it("sends the session and no asGuest flag for a logged-in client", async () => {
    const mock = mockFetch({ json: nvapi(v4Data()) });
    const result = await createWatchApi(testHttp(mock, { session: SESSION })).getWatchV4("sm9", {
      actionTrackId: "given_1",
    });
    const call = mock.only();
    expect(call.headers["Cookie"]).toBe(`user_session=${SESSION}`);
    expect(JSON.parse(call.body ?? "{}")).toEqual({ actionTrackId: "given_1" });
    expect(result.guest).toBe(false);
    expect(result.actionTrackId).toBe("given_1");
  });

  it("drops the session when a logged-in client asks for guest data", async () => {
    const mock = mockFetch({ json: nvapi(v4Data()) });
    const result = await createWatchApi(testHttp(mock, { session: SESSION })).getWatchV4("sm9", { asGuest: true });
    expect(mock.only().headers["Cookie"]).toBeUndefined();
    expect(result.guest).toBe(true);
  });

  it("retries a transient failure, since the v4 watch call has no side effects", async () => {
    const mock = mockFetch([{ status: 503 }, { json: nvapi(v4Data()) }]);
    const http = new NiconicoHttp({ fetch: mock.fetch, retryAttempts: 2, retryBaseDelayMs: 1 });
    await createWatchApi(http).getWatchV4("sm9");
    expect(mock.calls).toHaveLength(2);
  });

  it("surfaces the reasonCode of a restricted video", async () => {
    const mock = mockFetch({
      status: 403,
      json: { meta: { status: 403, errorCode: "FORBIDDEN" }, data: { reasonCode: "ADMINISTRATOR_DELETE_VIDEO" } },
    });
    const error = (await createWatchApi(testHttp(mock))
      .getWatchV4("sm1")
      .catch((e: unknown) => e)) as NiconicoApiError;
    expect(error).toBeInstanceOf(NiconicoApiError);
    expect(error.reasonCode).toBe("ADMINISTRATOR_DELETE_VIDEO");
    expect(error.message).toContain("reasonCode=ADMINISTRATOR_DELETE_VIDEO");
  });
});

describe("v3 guest route", () => {
  it("never sends the session to v3_guest and marks the result as guest", async () => {
    const mock = mockFetch({ json: nvapi({ video: { id: "sm9" }, media: { domand: null }, comment: {} }) });
    const result = await createWatchApi(testHttp(mock, { session: SESSION })).getGuestWatchData("sm9");
    expect(mock.only().headers["Cookie"]).toBeUndefined();
    expect(result.guest).toBe(true);
  });

  it("keeps sending the session to v3", async () => {
    const mock = mockFetch({ json: nvapi({ video: { id: "sm9" }, media: { domand: null }, comment: {} }) });
    const result = await createWatchApi(testHttp(mock, { session: SESSION })).getWatchData("sm9");
    expect(mock.only().headers["Cookie"]).toBe(`user_session=${SESSION}`);
    expect(result.guest).toBe(false);
  });
});

describe("watch lazy", () => {
  it("posts the key with noSideEffect on by default", async () => {
    const mock = mockFetch({ json: lazyBody });
    await createWatchApi(testHttp(mock)).getWatchLazyWithKey("sm9", {
      keyToken: "k",
      actionTrackId: "t",
      refSource: "series",
      refSourceId: "363443",
    });
    const call = mock.only();
    expect(call.url).toBe("https://nvapi.nicovideo.jp/v4/watch/lazy/sm9");
    expect(call.headers["X-Request-With"]).toBe("https://www.nicovideo.jp");
    expect(JSON.parse(call.body ?? "{}")).toEqual({
      actionTrackId: "t",
      keyToken: "k",
      noSideEffect: true,
      refSource: "series",
      refSourceId: "363443",
    });
  });

  it("only retries when the call is side-effect free", async () => {
    const quiet = mockFetch([{ status: 503 }, { json: lazyBody }]);
    await createWatchApi(
      new NiconicoHttp({ fetch: quiet.fetch, retryAttempts: 2, retryBaseDelayMs: 1 }),
    ).getWatchLazyWithKey("sm9", { keyToken: "k", actionTrackId: "t" });
    expect(quiet.calls).toHaveLength(2);

    const recording = mockFetch({ status: 503 });
    await expect(
      createWatchApi(
        new NiconicoHttp({ fetch: recording.fetch, retryAttempts: 2, retryBaseDelayMs: 1 }),
      ).getWatchLazyWithKey("sm9", { keyToken: "k", actionTrackId: "t", noSideEffect: false }),
    ).rejects.toBeInstanceOf(NiconicoApiError);
    expect(recording.calls).toHaveLength(1);
  });

  it("reads lazy data from a v4 result, as a guest when the result was a guest one", async () => {
    const mock = mockFetch({
      json: nvapi({ owner: null, ranking: { teiban: null }, series: { id: 1, title: "s" }, waku: {} }),
    });
    const lazy = await createWatchApi(testHttp(mock, { session: SESSION })).getWatchLazy(v4Result({ guest: true }));
    expect(lazy.series?.id).toBe(1);
    const call = mock.only();
    expect(call.headers["Cookie"]).toBeUndefined();
    expect(JSON.parse(call.body ?? "{}")).toMatchObject({
      keyToken: "lazy-key",
      actionTrackId: "abcdefghij_1700000000000",
      noSideEffect: true,
    });
  });

  it("refetches watch data once when the key has expired", async () => {
    const fresh = v4Data({ lazy: { authKey: "fresh-key" } });
    const mock = mockFetch([
      { status: 400, json: { meta: { status: 400, errorCode: "KEY_EXPIRED" } } },
      { json: nvapi(fresh) },
      { json: lazyBody },
    ]);
    await createWatchApi(testHttp(mock)).getWatchLazy(v4Result({ guest: true }));
    expect(mock.calls.map((call) => call.url)).toEqual([
      "https://nvapi.nicovideo.jp/v4/watch/lazy/sm9",
      "https://nvapi.nicovideo.jp/v4/watch/sm9",
      "https://nvapi.nicovideo.jp/v4/watch/lazy/sm9",
    ]);
    const retried = JSON.parse(mock.calls[2]?.body ?? "{}") as { keyToken: string; actionTrackId: string };
    const refetched = JSON.parse(mock.calls[1]?.body ?? "{}") as { actionTrackId: string };
    expect(retried.keyToken).toBe("fresh-key");
    expect(retried.actionTrackId).toBe(refetched.actionTrackId);
  });

  it("names an invalid key without refetching", async () => {
    const mock = mockFetch({ status: 400, json: { meta: { status: 400, errorCode: "INVALID_KEY" } } });
    const error = await createWatchApi(testHttp(mock))
      .getWatchLazy(v4Result())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WatchKeyRejectedError);
    expect((error as WatchKeyRejectedError).errorCode).toBe("INVALID_KEY");
    expect(mock.calls).toHaveLength(1);
  });
});

describe("recordView", () => {
  it("posts the side-effect call with the watch track id", async () => {
    const mock = mockFetch({ json: { meta: { status: 200 } } });
    await createWatchApi(testHttp(mock, { session: SESSION })).recordView(v4Result(), {
      refSource: "mylist",
      refSourceId: "65776587",
    });
    const call = mock.only();
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://nvapi.nicovideo.jp/v4/watch/sm9/side-effect");
    expect(call.headers["Cookie"]).toBe(`user_session=${SESSION}`);
    expect(JSON.parse(call.body ?? "{}")).toEqual({
      actionTrackId: "abcdefghij_1700000000000",
      refSource: "mylist",
      refSourceId: "65776587",
    });
  });

  it("is never replayed on a transient failure", async () => {
    const mock = mockFetch({ status: 503 });
    const http = new NiconicoHttp({
      fetch: mock.fetch,
      retryAttempts: 3,
      retryBaseDelayMs: 1,
      commentThrottle: unthrottled,
    });
    await expect(createWatchApi(http).recordView(v4Result())).rejects.toBeInstanceOf(NiconicoApiError);
    expect(mock.calls).toHaveLength(1);
  });
});

describe("streaming with v4 watch data", () => {
  it("tells v4 results apart from v3 ones", () => {
    const v3 = { data: { video: { id: "sm9" } }, actionTrackId: "t" } as unknown as WatchResult;
    expect(isWatchV4Result(v4Result())).toBe(true);
    expect(isWatchV4Result(v3)).toBe(false);
  });

  it("requests access rights from media.contents with the session for a logged-in result", async () => {
    const mock = mockFetch({ status: 201, json: { meta: { status: 201 }, data: { contentUrl: "https://x/m.m3u8" } } });
    await createStreamingApi(testHttp(mock, { session: SESSION })).getHlsFromWatch(v4Result());
    const call = mock.only();
    expect(call.url).toBe(
      "https://nvapi.nicovideo.jp/v1/watch/sm9/access-rights/hls?actionTrackId=abcdefghij_1700000000000",
    );
    expect(call.headers["X-Access-Right-Key"]).toBe("v4-key");
    expect(call.headers["Cookie"]).toBe(`user_session=${SESSION}`);
    expect(JSON.parse(call.body ?? "{}")).toEqual({ outputs: [["video-h264-720p", "audio-aac-128kbps"]] });
  });

  it("withholds the session for a guest result, because a guest key plus a cookie is a 400", async () => {
    const mock = mockFetch({ status: 201, json: { data: { contentUrl: "u" } } });
    await createStreamingApi(testHttp(mock, { session: SESSION })).getHlsFromWatch(v4Result({ guest: true }));
    expect(mock.only().headers["Cookie"]).toBeUndefined();
  });

  it("does the same for v3 guest data on a logged-in client", async () => {
    const mock = mockFetch({ status: 201, json: { data: { contentUrl: "u" } } });
    const guestV3 = {
      actionTrackId: "t",
      guest: true,
      data: {
        video: { id: "sm9" },
        okReason: "PURELY",
        media: {
          domand: {
            isStoryboardAvailable: false,
            accessRightKey: "guest-key",
            videos: [{ id: "v", isAvailable: true, qualityLevel: 1, recommendedHighestAudioQualityLevel: 1 }],
            audios: [{ id: "a", isAvailable: true, qualityLevel: 1 }],
          },
        },
      },
    } as unknown as WatchResult;
    await createStreamingApi(testHttp(mock, { session: SESSION })).getHlsFromWatch(guestV3);
    expect(mock.only().headers["Cookie"]).toBeUndefined();
  });

  it("exposes the pre-issued HLS master with the watch call's domand_bid and makes no request", () => {
    const mock = mockFetch({});
    const api = createStreamingApi(testHttp(mock));
    expect(api.getPreissuedHls(v4Result())).toEqual({
      contentUrl: "https://delivery.domand.nicovideo.jp/hlsbid/x/playlists/variants/y.m3u8?session=s",
      domandBidCookie: "bid-from-watch",
      createTime: "2026-10-31T01:42:00+00:00",
      expireTime: "2026-11-01T01:42:00+00:00",
    });
    const noHls = v4Result();
    if (noHls.data.media !== null) noHls.data.media.hls = null;
    expect(api.getPreissuedHls(noHls)).toBeUndefined();
    expect(mock.calls).toHaveLength(0);
  });

  it("posts the storyboard request without a body, like the web client", async () => {
    const mock = mockFetch({ status: 201, json: { data: { contentUrl: "https://asset/sb.json" } } });
    const result = await createStreamingApi(testHttp(mock, { session: SESSION })).getStoryboardFromWatch(v4Result());
    const call = mock.only();
    expect(call.url).toContain("/v1/watch/sm9/access-rights/storyboard");
    expect(call.body).toBeUndefined();
    expect(call.headers["Content-Type"]).toBeUndefined();
    expect(result.contentUrl).toBe("https://asset/sb.json");
  });

  it("explains paid media that the viewer cannot play", () => {
    const api = createStreamingApi(testHttp(mockFetch({})));
    const paid = v4Result({}, { media: null, okReason: "PAYMENT_PREVIEW_SUPPORTED" });
    expect(() => api.getHlsFromWatch(paid)).toThrow(DomandUnavailableError);
    expect(() => api.getHlsFromWatch(paid)).toThrow(/PAYMENT_PREVIEW_SUPPORTED/);
  });

  it("refuses a storyboard for guest v4 data before calling the API", () => {
    const api = createStreamingApi(testHttp(mockFetch({})));
    const guest = v4Result({ guest: true });
    if (guest.data.media !== null) guest.data.media.isStoryboardAvailable = false;
    expect(() => api.getStoryboardFromWatch(guest)).toThrow(/isStoryboardAvailable is false/);
  });

  it("picks the best audio when the video carries no recommended cap", () => {
    const contents = v4Data().media?.contents;
    if (contents === undefined) throw new Error("fixture");
    expect(pickAudioForVideo(contents, {})?.id).toBe("audio-aac-128kbps");
  });
});
