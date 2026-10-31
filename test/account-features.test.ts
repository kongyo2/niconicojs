import { describe, expect, it } from "vitest";
import { createNgCommentsApi } from "../src/ng-comments.js";
import { createHistoryApi } from "../src/history.js";
import { createFeedApi } from "../src/feed.js";
import { createUsersApi } from "../src/users.js";
import { createVideosApi } from "../src/videos.js";
import { NiconicoApiError, NiconicoError } from "../src/errors.js";
import { formOf, mockFetch, nvapi, testHttp } from "./helpers.js";

const ngList = (items: Array<{ type: string; source: string }>) =>
  nvapi({ revision: 3, count: items.length, items: items.map((item) => ({ ...item, registeredAt: "t" })) });

describe("NgCommentsApi", () => {
  it("reads the account's server-side NG list", async () => {
    const mock = mockFetch({ json: ngList([{ type: "word", source: "spoiler" }]) });
    const list = await createNgCommentsApi(testHttp(mock)).getMyNgComments();
    expect(mock.only().url).toBe("https://nvapi.nicovideo.jp/v1/users/me/ng-comments/client");
    expect(list).toEqual({ revision: 3, count: 1, items: [{ type: "word", source: "spoiler", registeredAt: "t" }] });
  });

  it("adds an entry with the form body and request header the web player uses", async () => {
    const mock = mockFetch({ json: ngList([{ type: "id", source: "abc" }]) });
    const list = await createNgCommentsApi(testHttp(mock)).addNgComment({ type: "id", source: "abc" });
    const call = mock.only();
    expect(call.method).toBe("POST");
    expect(call.headers["X-Request-With"]).toBe("nicovideo");
    expect(call.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(formOf(call))).toEqual({ type: "id", source: "abc" });
    expect(list.items).toHaveLength(1);
  });

  it("removes entries with a JSON targets body", async () => {
    const mock = mockFetch({ json: ngList([]) });
    await createNgCommentsApi(testHttp(mock)).removeNgComments([
      { type: "word", source: "a" },
      { type: "command", source: "big" },
    ]);
    const call = mock.only();
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe("https://nvapi.nicovideo.jp/v1/users/me/ng-comments/client/items");
    expect(JSON.parse(call.body ?? "{}")).toEqual({
      targets: [
        { type: "word", source: "a" },
        { type: "command", source: "big" },
      ],
    });
  });

  it("treats an empty removal as a plain read", async () => {
    const mock = mockFetch({ json: ngList([]) });
    await createNgCommentsApi(testHttp(mock)).removeNgComments([]);
    expect(mock.only().method).toBe("GET");
  });

  it("refuses to read a missing items list as an empty NG list", async () => {
    const mock = mockFetch({ json: nvapi({ revision: 1 }) });
    await expect(createNgCommentsApi(testHttp(mock)).getMyNgComments()).rejects.toBeInstanceOf(NiconicoError);
  });

  it("surfaces the limit error the server reports", async () => {
    const mock = mockFetch({ status: 409, json: { meta: { status: 409, errorCode: "MAX_SETTINGS" } } });
    const error = (await createNgCommentsApi(testHttp(mock))
      .addNgComment({ type: "word", source: "x" })
      .catch((e: unknown) => e)) as NiconicoApiError;
    expect(error.status).toBe(409);
    expect(error.errorCode).toBe("MAX_SETTINGS");
  });
});

describe("HistoryApi removal", () => {
  it("deletes a video from the watch history by target and returns the removed entries", async () => {
    const mock = mockFetch({ json: nvapi({ deletedItemIds: ["h#20261031#sm9"] }) });
    const removed = await createHistoryApi(testHttp(mock)).removeMyWatchHistory("sm9");
    const call = mock.only();
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe("https://nvapi.nicovideo.jp/v2/users/me/watch/history?target=sm9");
    expect(call.headers["X-Request-With"]).toBe("https://www.nicovideo.jp");
    expect(removed).toEqual(["h#20261031#sm9"]);
  });
});

describe("FeedApi unread", () => {
  it("reports the unread flag from the feed host", async () => {
    const mock = mockFetch({ json: { code: "ok", isUnread: true } });
    await expect(createFeedApi(testHttp(mock)).hasUnread()).resolves.toBe(true);
    expect(mock.only().url).toBe("https://api.feed.nicovideo.jp/v1/unread");
  });

  it("treats a non-ok code as a failure", async () => {
    const mock = mockFetch({ json: { code: "unauthorized" } });
    await expect(createFeedApi(testHttp(mock)).hasUnread()).rejects.toThrow(/code=unauthorized/);
  });
});

describe("UsersApi video filters", () => {
  it("sends the content type and maps keyword onto q", async () => {
    const mock = mockFetch({ json: nvapi({ totalCount: 0, items: [] }) });
    await createUsersApi(testHttp(mock)).getUserVideos(4, { selectContentType: "short", keyword: "スプラ" });
    expect(mock.query().get("selectContentType")).toBe("short");
    expect(mock.query().get("q")).toBe("スプラ");
  });
});

describe("VideosApi recommendations", () => {
  it("passes limit and sensitiveContents through", async () => {
    const mock = mockFetch({ json: nvapi({ recipe: { id: "r" }, recommendId: "1", items: [] }) });
    await createVideosApi(testHttp(mock)).getRecommendations("sm9", { limit: 5, sensitiveContents: "mask" });
    expect(mock.query().get("limit")).toBe("5");
    expect(mock.query().get("sensitiveContents")).toBe("mask");
    expect(mock.query().get("videoId")).toBe("sm9");
  });
});
