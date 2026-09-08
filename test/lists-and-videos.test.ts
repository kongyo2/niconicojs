import { describe, expect, it } from "vitest";
import { createMylistsApi } from "../src/mylists.js";
import { createSeriesApi } from "../src/series.js";
import { createVideosApi } from "../src/videos.js";
import { createLikesApi } from "../src/likes.js";
import { createHistoryApi } from "../src/history.js";
import { createFeedApi, FEED_MAX_LIMIT } from "../src/feed.js";
import { createAccountPublicApi } from "../src/account-public.js";
import { NiconicoApiError, NiconicoError } from "../src/errors.js";
import { mockFetch, nvapi, testHttp } from "./helpers.js";

const video = (id: string) => ({ id, title: id, count: {}, thumbnail: {}, owner: null });

describe("MylistsApi reads", () => {
  it("flattens the mylist envelope and fills defaults", async () => {
    const mock = mockFetch({
      json: nvapi({
        mylist: { id: 1, name: "TABS", description: "", items: [{ itemId: 1, watchId: "sm9", video: video("sm9") }] },
      }),
    });
    const result = await createMylistsApi(testHttp(mock)).getMylist(65776587, { pageSize: 2, sortKey: "addedAt" });
    expect(result.name).toBe("TABS");
    expect(result.totalItemCount).toBe(1);
    expect(result.hasNext).toBe(false);
    expect(mock.only().url).toContain("/v2/mylists/65776587");
    expect(mock.query().get("sortKey")).toBe("addedAt");
  });

  it("pages through items until hasNext clears", async () => {
    const page = (ids: string[], hasNext: boolean) =>
      nvapi({
        mylist: {
          id: 1,
          name: "m",
          description: "",
          hasNext,
          totalItemCount: 3,
          items: ids.map((id) => ({ itemId: Number(id.slice(2)), watchId: id, video: video(id) })),
        },
      });
    const mock = mockFetch([{ json: page(["sm1", "sm2"], true) }, { json: page(["sm3"], false) }]);
    const ids: string[] = [];
    for await (const item of createMylistsApi(testHttp(mock)).iterateMylistItems(1, { pageSize: 2 })) {
      ids.push(item.watchId);
    }
    expect(ids).toEqual(["sm1", "sm2", "sm3"]);
  });

  it("unwraps the watchLater envelope", async () => {
    const mock = mockFetch({
      json: nvapi({ watchLater: { items: [{ watchId: "sm9", video: video("sm9") }], totalCount: 1, hasNext: false } }),
    });
    const result = await createMylistsApi(testHttp(mock)).getMyWatchLater({ pageSize: 2 });
    expect(result.items).toHaveLength(1);
    expect(mock.only().url).toContain("/v1/users/me/watch-later");
  });
});

describe("MylistsApi writes", () => {
  it("creates a mylist through query parameters and returns the new id", async () => {
    const mock = mockFetch({ json: nvapi({ mylistId: 987 }) });
    const id = await createMylistsApi(testHttp(mock)).createMylist({ name: "test", isPublic: false });

    const call = mock.only();
    expect(call.method).toBe("POST");
    expect(call.headers["X-Request-With"]).toBe("https://www.nicovideo.jp");
    expect(mock.query().get("name")).toBe("test");
    expect(mock.query().get("isPublic")).toBe("false");
    expect(mock.query().get("defaultSortKey")).toBe("addedAt");
    expect(id).toBe(987);
  });

  it("adds and removes items on the right routes and methods", async () => {
    const add = mockFetch({ json: nvapi({}) });
    await createMylistsApi(testHttp(add)).addMylistItem(1, "sm9", { description: "note" });
    expect(add.only().method).toBe("POST");
    expect(add.only().url).toContain("/v1/users/me/mylists/1/items");
    expect(add.query().get("itemId")).toBe("sm9");
    expect(add.query().get("description")).toBe("note");

    const remove = mockFetch({ json: nvapi({}) });
    await createMylistsApi(testHttp(remove)).removeMylistItems(1, [11, 22]);
    expect(remove.only().method).toBe("DELETE");
    expect(remove.query().getAll("itemIds")).toEqual(["11", "22"]);
  });

  it("adds and removes watch-later entries", async () => {
    const add = mockFetch({ json: nvapi({}) });
    await createMylistsApi(testHttp(add)).addWatchLater("sm9");
    expect(add.query().get("watchId")).toBe("sm9");

    const remove = mockFetch({ json: nvapi({}) });
    await createMylistsApi(testHttp(remove)).removeWatchLater(["sm9", "sm2"]);
    expect(remove.only().method).toBe("DELETE");
    expect(remove.query().getAll("watchIds")).toEqual(["sm9", "sm2"]);
  });

  it("surfaces the abuse block as an identifiable error", async () => {
    const mock = mockFetch({
      status: 403,
      json: { meta: { status: 403, errorCode: "FORBIDDEN" }, data: { errorDetail: "AB001" } },
    });
    const error = (await createMylistsApi(testHttp(mock))
      .addWatchLater("sm9")
      .catch((e: unknown) => e)) as NiconicoApiError;
    expect(error.isAbuseBlocked()).toBe(true);
  });
});

describe("SeriesApi", () => {
  it("uses v2 by default and v1 on request", async () => {
    const body = nvapi({ detail: { id: 1, title: "s" }, totalCount: 1, items: [] });
    const v2 = mockFetch({ json: body });
    await createSeriesApi(testHttp(v2)).getSeries(363443, { pageSize: 2 });
    expect(v2.only().url).toContain("/v2/series/363443");

    const v1 = mockFetch({ json: body });
    await createSeriesApi(testHttp(v1)).getSeriesV1(363443);
    expect(v1.only().url).toContain("/v1/series/363443");
  });

  it("pages until totalCount is reached", async () => {
    const page = (ids: string[]) =>
      nvapi({
        detail: { id: 1, title: "s" },
        totalCount: 3,
        items: ids.map((id, order) => ({ meta: { id, order, createdAt: "", updatedAt: "" }, video: video(id) })),
      });
    const mock = mockFetch([{ json: page(["a", "b"]) }, { json: page(["c"]) }]);
    const ids: string[] = [];
    for await (const item of createSeriesApi(testHttp(mock)).iterateSeriesItems(1, { pageSize: 2 })) {
      ids.push(item.video.id);
    }
    expect(ids).toEqual(["a", "b", "c"]);
  });
});

describe("VideosApi", () => {
  it("issues one request per id because the API honours only the last watchIds", async () => {
    const mock = mockFetch([
      { json: nvapi({ items: [{ watchId: "sm9", video: video("sm9") }] }) },
      { json: nvapi({ items: [{ watchId: "sm2", video: video("sm2") }] }) },
    ]);
    const result = await createVideosApi(testHttp(mock)).getVideos(["sm9", "sm2"], { concurrency: 1 });
    expect(mock.calls).toHaveLength(2);
    expect(mock.query(0).get("watchIds")).toBe("sm9");
    expect(mock.query(1).get("watchIds")).toBe("sm2");
    expect(result.map((r) => r.watchId)).toEqual(["sm9", "sm2"]);
  });

  it("preserves argument order even when responses interleave", async () => {
    const mock = mockFetch({ json: nvapi({ items: [] }) });
    const result = await createVideosApi(testHttp(mock)).getVideos(["a", "b", "c"], { concurrency: 3 });
    expect(result.map((r) => r.watchId)).toEqual(["a", "b", "c"]);
    expect(result.every((r) => r.video === null)).toBe(true);
  });

  it("rejects an empty id list", async () => {
    await expect(createVideosApi(testHttp(mockFetch({}))).getVideos([])).rejects.toBeInstanceOf(NiconicoError);
  });

  it("builds the recommend query the watch page uses", async () => {
    const mock = mockFetch({ json: nvapi({ recipe: { id: "r" }, recommendId: "rid", items: [] }) });
    const result = await createVideosApi(testHttp(mock)).getRecommendations("sm9");
    expect(mock.query().get("recipeId")).toBe("video_watch_recommendation");
    expect(mock.query().get("videoId")).toBe("sm9");
    expect(result.recommendId).toBe("rid");
  });

  it("reads nicoad totals from its own host", async () => {
    const mock = mockFetch({
      json: nvapi({ id: "sm9", title: "t", targetUrl: "u", thumbnailUrl: "th", totalPoint: 5 }),
    });
    const result = await createVideosApi(testHttp(mock)).getNicoAd("sm9");
    expect(mock.only().url).toBe("https://api.nicoad.nicovideo.jp/v1/contents/video/sm9");
    expect(result.totalPoint).toBe(5);
  });
});

describe("LikesApi", () => {
  it("reads the summary block", async () => {
    const mock = mockFetch({
      json: nvapi({ items: [{ video: video("sm9") }], summary: { hasNext: false, getNextPageNgReason: null } }),
    });
    const result = await createLikesApi(testHttp(mock)).getMyLikes({ pageSize: 2 });
    expect(result.items).toHaveLength(1);
    expect(result.hasNext).toBe(false);
  });

  it("likes and unlikes with the CSRF header on the items route", async () => {
    const like = mockFetch({ json: nvapi({}) });
    await createLikesApi(testHttp(like)).like("sm9");
    expect(like.only().method).toBe("POST");
    expect(like.only().url).toContain("/v1/users/me/likes/items");
    expect(like.query().get("videoId")).toBe("sm9");
    expect(like.only().headers["X-Request-With"]).toBe("https://www.nicovideo.jp");

    const unlike = mockFetch({ json: nvapi({}) });
    await createLikesApi(testHttp(unlike)).unlike("sm9");
    expect(unlike.only().method).toBe("DELETE");
  });
});

describe("HistoryApi", () => {
  it("defaults selectContentType and forwards the cursor", async () => {
    const mock = mockFetch({ json: nvapi({ items: [], nextCursor: "c1" }) });
    await createHistoryApi(testHttp(mock)).getMyWatchHistory({ limit: 5, cursor: "c0" });
    expect(mock.query().get("selectContentType")).toBe("long");
    expect(mock.query().get("cursor")).toBe("c0");
    expect(mock.query().get("limit")).toBe("5");
  });

  it("walks cursors and stops when one repeats", async () => {
    const mock = mockFetch([
      { json: nvapi({ items: [{ video: video("a") }], nextCursor: "c1" }) },
      { json: nvapi({ items: [{ video: video("b") }], nextCursor: "c1" }) },
    ]);
    const ids: string[] = [];
    for await (const item of createHistoryApi(testHttp(mock)).iterateMyWatchHistory()) {
      ids.push(item.video.id);
    }
    expect(ids).toEqual(["a", "b"]);
  });
});

describe("FeedApi", () => {
  it("clamps limit to the cap the host enforces", async () => {
    const mock = mockFetch({ json: { code: "ok", actors: [] } });
    await createFeedApi(testHttp(mock)).getActors({ limit: 500 });
    expect(mock.query().get("limit")).toBe(String(FEED_MAX_LIMIT));
  });

  it("always sends a limit, since omitting it is a 400", async () => {
    const mock = mockFetch({ json: { code: "ok", activities: [] } });
    await createFeedApi(testHttp(mock)).getFollowingsVideo();
    expect(mock.query().has("limit")).toBe(true);
    expect(mock.query().get("context")).toBe("my_timeline");
  });

  it("treats a non-ok code as a failure", async () => {
    const mock = mockFetch({ json: { code: "badRequest" } });
    await expect(createFeedApi(testHttp(mock)).getActors()).rejects.toThrow(/code=badRequest/);
  });
});

describe("AccountPublicApi", () => {
  it("repeats userIds rather than comma-joining them", async () => {
    const mock = mockFetch({ json: nvapi([{ userId: "4", nickname: "中の", description: "", icons: { urls: {} } }]) });
    await createAccountPublicApi(testHttp(mock)).getUsers([4, 2]);
    expect(mock.query().getAll("userIds")).toEqual(["4", "2"]);
    expect(mock.only().url).toContain("account.nicovideo.jp/api/public/v1/users.json");
  });

  it("rejects an empty id list", async () => {
    await expect(createAccountPublicApi(testHttp(mockFetch({}))).getUsers([])).rejects.toBeInstanceOf(NiconicoError);
  });

  it("reads the session user from /v2/user.json", async () => {
    const mock = mockFetch({ json: nvapi({ userId: "12345678", nickname: "me", icons: { urls: {} } }) });
    const me = await createAccountPublicApi(testHttp(mock)).getMe();
    expect(me.userId).toBe("12345678");
  });
});
