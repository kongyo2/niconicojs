import { describe, expect, it } from "vitest";
import { createWatchApi, extractVideoId, generateActionTrackId, isVideoId } from "../src/watch.js";
import type { DomandMedia, WatchResult } from "../src/watch.js";
import {
  createStreamingApi,
  DomandUnavailableError,
  domandCookieHeader,
  domandRequestHeaders,
  pickAudioForVideo,
  pickBestAudio,
  pickBestVideo,
} from "../src/streaming.js";
import { mockFetch, nvapi, testHttp } from "./helpers.js";

describe("extractVideoId", () => {
  it("passes a bare id through", () => {
    expect(extractVideoId("sm9")).toBe("sm9");
    expect(extractVideoId("  sm9  ")).toBe("sm9");
  });

  it("pulls the id out of watch URLs", () => {
    expect(extractVideoId("https://www.nicovideo.jp/watch/sm9")).toBe("sm9");
    expect(extractVideoId("https://sp.nicovideo.jp/watch/so123?ref=x")).toBe("so123");
    expect(extractVideoId("https://www.nicovideo.jp/watch/sm9#comment")).toBe("sm9");
  });

  it("handles the nico.ms short domain", () => {
    expect(extractVideoId("https://nico.ms/sm9")).toBe("sm9");
  });
});

describe("isVideoId", () => {
  it("accepts the real forms and rejects prose", () => {
    expect(isVideoId("sm9")).toBe(true);
    expect(isVideoId("so46750735")).toBe(true);
    expect(isVideoId("1234567890")).toBe(true);
    expect(isVideoId("https://x")).toBe(false);
    expect(isVideoId("")).toBe(false);
  });
});

describe("generateActionTrackId", () => {
  it("matches the format the server validates", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateActionTrackId()).toMatch(/^[a-zA-Z0-9]{10}_\d{13}$/);
    }
  });
});

describe("WatchApi", () => {
  const watchBody = nvapi({ video: { id: "sm9" }, media: { domand: null }, comment: {} });

  it("uses the guest route and echoes the actionTrackId it generated", async () => {
    const mock = mockFetch({ json: watchBody });
    const result = await createWatchApi(testHttp(mock)).getGuestWatchData("sm9");
    expect(mock.only().url).toContain("/api/watch/v3_guest/sm9");
    expect(mock.query().get("actionTrackId")).toBe(result.actionTrackId);
  });

  it("sends skips=harmful and noSideEffect only when asked", async () => {
    const mock = mockFetch({ json: watchBody });
    await createWatchApi(testHttp(mock)).getWatchData("sm9", { skipHarmful: true, noSideEffect: true });
    expect(mock.query().get("skips")).toBe("harmful");
    expect(mock.query().get("noSideEffect")).toBe("true");
  });

  it("omits both flags by default", async () => {
    const mock = mockFetch({ json: watchBody });
    await createWatchApi(testHttp(mock)).getWatchData("sm9");
    expect(mock.query().has("skips")).toBe(false);
    expect(mock.query().has("noSideEffect")).toBe(false);
  });

  it("picks v3 with a session and v3_guest without one", async () => {
    const withSession = mockFetch({ json: watchBody });
    await createWatchApi(testHttp(withSession, { session: "s" })).getBestWatchData("sm9");
    expect(withSession.only().url).toContain("/v3/sm9");

    const guest = mockFetch({ json: watchBody });
    await createWatchApi(testHttp(guest)).getBestWatchData("sm9");
    expect(guest.only().url).toContain("/v3_guest/sm9");
  });

  it("accepts a full URL as the video id", async () => {
    const mock = mockFetch({ json: watchBody });
    await createWatchApi(testHttp(mock)).getGuestWatchData("https://www.nicovideo.jp/watch/sm500873");
    expect(mock.only().url).toContain("/v3_guest/sm500873");
  });
});

const media: DomandMedia = {
  isStoryboardAvailable: true,
  accessRightKey: "jwt-key",
  videos: [
    {
      id: "video-h264-360p",
      isAvailable: true,
      label: "360p",
      bitRate: 1,
      width: 640,
      height: 360,
      qualityLevel: 1,
      recommendedHighestAudioQualityLevel: 1,
    },
    {
      id: "video-h264-1080p",
      isAvailable: false,
      label: "1080p",
      bitRate: 9,
      width: 1920,
      height: 1080,
      qualityLevel: 4,
      recommendedHighestAudioQualityLevel: 2,
    },
    {
      id: "video-h264-360p-lowest",
      isAvailable: true,
      label: "低画質",
      bitRate: 0,
      width: 480,
      height: 360,
      qualityLevel: 0,
      recommendedHighestAudioQualityLevel: 0,
    },
  ],
  audios: [
    {
      id: "audio-aac-128kbps",
      isAvailable: true,
      bitRate: 128,
      samplingRate: 44100,
      integratedLoudness: -6,
      truePeak: 0,
      qualityLevel: 1,
    },
    {
      id: "audio-aac-64kbps",
      isAvailable: true,
      bitRate: 64,
      samplingRate: 44100,
      integratedLoudness: -6,
      truePeak: 0,
      qualityLevel: 0,
    },
  ],
};

describe("stream selection", () => {
  it("ignores unavailable streams when picking the best", () => {
    expect(pickBestVideo(media)?.id).toBe("video-h264-360p");
    expect(pickBestAudio(media)?.id).toBe("audio-aac-128kbps");
  });

  it("respects the video's recommended audio cap", () => {
    const lowest = media.videos[2];
    if (lowest === undefined) throw new Error("fixture");
    expect(pickAudioForVideo(media, lowest)?.id).toBe("audio-aac-64kbps");
  });

  it("returns undefined when nothing is available", () => {
    expect(pickBestVideo({ ...media, videos: [] })).toBeUndefined();
    expect(pickBestAudio({ ...media, audios: [] })).toBeUndefined();
  });
});

describe("domand cookie helpers", () => {
  it("formats the cookie header and omits it when absent", () => {
    expect(domandCookieHeader({ domandBidCookie: "abc" })).toBe("domand_bid=abc");
    expect(domandCookieHeader({ domandBidCookie: undefined })).toBeUndefined();
    expect(domandRequestHeaders({ domandBidCookie: "abc" })).toMatchObject({
      Cookie: "domand_bid=abc",
      Origin: "https://www.nicovideo.jp",
    });
    expect(domandRequestHeaders({ domandBidCookie: undefined })["Cookie"]).toBeUndefined();
  });
});

function watchResult(domand: DomandMedia | null, okReason = "PURELY"): WatchResult {
  return {
    actionTrackId: "abcdefghij_1700000000000",
    data: {
      video: { id: "sm9" },
      media: { domand, delivery: null, deliveryLegacy: null },
      okReason,
    } as unknown as WatchResult["data"],
  };
}

describe("StreamingApi", () => {
  it("sends the headers and outputs pair the DMS API requires", async () => {
    const mock = mockFetch({
      status: 201,
      json: { meta: { status: 201 }, data: { contentUrl: "https://delivery.example/master.m3u8" } },
      setCookie: ["domand_bid=bid123; Path=/; Secure"],
    });
    const result = await createStreamingApi(testHttp(mock)).getHlsFromWatch(watchResult(media));

    const call = mock.only();
    expect(call.method).toBe("POST");
    expect(call.url).toContain("/v1/watch/sm9/access-rights/hls");
    expect(mock.query().get("actionTrackId")).toBe("abcdefghij_1700000000000");
    expect(call.headers["X-Access-Right-Key"]).toBe("jwt-key");
    expect(call.headers["X-Request-With"]).toBe("https://www.nicovideo.jp");
    expect(JSON.parse(call.body ?? "{}")).toEqual({ outputs: [["video-h264-360p", "audio-aac-128kbps"]] });
    expect(result.contentUrl).toBe("https://delivery.example/master.m3u8");
    expect(result.domandBidCookie).toBe("bid123");
  });

  it("accepts 201 as success", async () => {
    const mock = mockFetch({ status: 201, json: { data: { contentUrl: "https://x/y.m3u8" } } });
    await expect(createStreamingApi(testHttp(mock)).getHlsFromWatch(watchResult(media))).resolves.toMatchObject({
      contentUrl: "https://x/y.m3u8",
    });
  });

  it("emits an audio-only output when no video stream is chosen", async () => {
    const mock = mockFetch({ status: 201, json: { data: { contentUrl: "u" } } });
    await createStreamingApi(testHttp(mock)).createHlsAccessRights({
      videoId: "sm9",
      accessRightKey: "k",
      actionTrackId: "t",
      audioStreamId: "audio-aac-128kbps",
    });
    expect(JSON.parse(mock.only().body ?? "{}")).toEqual({ outputs: [["audio-aac-128kbps"]] });
  });

  it("explains a video with no DMS media instead of failing obscurely", () => {
    const api = createStreamingApi(testHttp(mockFetch({})));
    expect(() => api.getHlsFromWatch(watchResult(null, "HIDDEN_VIDEO"))).toThrow(DomandUnavailableError);
    expect(() => api.getHlsFromWatch(watchResult({ ...media, accessRightKey: null }))).toThrow(
      /accessRightKey is null/,
    );
  });

  it("rejects an unknown explicit stream id", () => {
    const api = createStreamingApi(testHttp(mockFetch({})));
    expect(() => api.getHlsFromWatch(watchResult(media), { videoStreamId: "nope" })).toThrow(
      /unknown video stream nope/,
    );
  });

  it("posts an empty body for the storyboard route", async () => {
    const mock = mockFetch({ status: 201, json: { data: { contentUrl: "https://asset/story.json" } } });
    const result = await createStreamingApi(testHttp(mock)).createStoryboardAccessRights({
      videoId: "sm9",
      accessRightKey: "k",
      actionTrackId: "t",
    });
    expect(mock.only().url).toContain("/access-rights/storyboard");
    expect(result.contentUrl).toBe("https://asset/story.json");
  });
});
