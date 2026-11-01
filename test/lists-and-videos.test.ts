import { describe, expect, it } from "vitest";
import { createMylistsApi } from "../src/mylists.js";
import { createSeriesApi } from "../src/series.js";
import { createVideosApi } from "../src/videos.js";
import { createLikesApi } from "../src/likes.js";
import { createHistoryApi } from "../src/history.js";
import { createFeedApi, FEED_MAX_LIMIT } from "../src/feed.js";
import { createAccountPublicApi } from "../src/account-public.js";
import { NiconicoApiError, NiconicoError } from "../src/errors.js";
import { formOf, mockFetch, nvapi, testHttp } from "./helpers.js";

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

describe("MylistsApi own-list reads", () => {
  it("reads one of the session user's mylists through the route that also serves private ones", async () => {
    const mock = mockFetch({ json: nvapi({ mylist: { id: 5, name: "private", description: "", isPublic: false } }) });
    const result = await createMylistsApi(testHttp(mock)).getMyMylist(5, { pageSize: 3 });
    expect(mock.only().url).toBe("https://nvapi.nicovideo.jp/v1/users/me/mylists/5?pageSize=3");
    expect(result.isPublic).toBe(false);
    expect(result.items).toEqual([]);
  });

  it("pages the session user's mylist items", async () => {
    const page = (ids: string[], hasNext: boolean) =>
      nvapi({
        mylist: {
          id: 5,
          name: "m",
          description: "",
          hasNext,
          items: ids.map((id) => ({ itemId: Number(id.slice(2)), watchId: id, video: video(id) })),
        },
      });
    const mock = mockFetch([{ json: page(["sm1"], true) }, { json: page(["sm2"], false) }]);
    const ids: string[] = [];
    for await (const item of createMylistsApi(testHttp(mock)).iterateMyMylistItems(5, { pageSize: 1 })) {
      ids.push(item.watchId);
    }
    expect(ids).toEqual(["sm1", "sm2"]);
    expect(mock.calls[1]?.url).toContain("/v1/users/me/mylists/5?pageSize=1&page=2");
  });

  it("lists the compact own-mylist index", async () => {
    const mock = mockFetch({ json: nvapi({ mylists: [{ id: 1, isPublic: false, name: "a", description: "" }] }) });
    const result = await createMylistsApi(testHttp(mock)).getMyMylistsCompact();
    expect(mock.only().url).toBe("https://nvapi.nicovideo.jp/v1/users/me/mylists/compact");
    expect(result.map((m) => m.name)).toEqual(["a"]);
  });

  it("forwards paging and title filters on the own-mylist listing", async () => {
    const mock = mockFetch({ json: nvapi({ mylists: [], totalCount: 0, hasNext: false }) });
    await createMylistsApi(testHttp(mock)).getMyMylists({ page: 2, pageSize: 10, title: "BGM", sampleItemCount: 1 });
    expect(mock.query().get("page")).toBe("2");
    expect(mock.query().get("pageSize")).toBe("10");
    expect(mock.query().get("title")).toBe("BGM");
    expect(mock.query().get("sampleItemCount")).toBe("1");
  });
});

describe("MylistsApi writes", () => {
  it("creates a mylist with a form body, like the web client, and returns the new id", async () => {
    const mock = mockFetch({ json: nvapi({ mylistId: 987 }) });
    const id = await createMylistsApi(testHttp(mock)).createMylist({ name: "test", isPublic: false });

    const call = mock.only();
    expect(call.method).toBe("POST");
    expect(call.url).toBe("https://nvapi.nicovideo.jp/v1/users/me/mylists");
    expect(call.headers["X-Request-With"]).toBe("https://www.nicovideo.jp");
    expect(call.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const form = formOf(call);
    expect(form.get("name")).toBe("test");
    expect(form.get("isPublic")).toBe("false");
    expect(form.get("defaultSortKey")).toBe("addedAt");
    expect(form.get("defaultSortOrder")).toBe("desc");
    expect(id).toBe(987);
  });

  it("refuses to report a made-up id when creation returns none", async () => {
    const mock = mockFetch({ json: nvapi({}) });
    await expect(createMylistsApi(testHttp(mock)).createMylist({ name: "x" })).rejects.toBeInstanceOf(NiconicoError);
  });

  it("adds an item through the query and removes several with one comma-joined itemIds", async () => {
    const add = mockFetch({ json: nvapi({}) });
    await createMylistsApi(testHttp(add)).addMylistItem(1, "sm9", { description: "note" });
    expect(add.only().method).toBe("POST");
    expect(add.only().url).toContain("/v1/users/me/mylists/1/items");
    expect(add.query().get("itemId")).toBe("sm9");
    expect(add.query().get("description")).toBe("note");

    const remove = mockFetch({ json: nvapi({}) });
    await createMylistsApi(testHttp(remove)).removeMylistItems(1, [11, 22]);
    expect(remove.only().method).toBe("DELETE");
    expect(remove.query().getAll("itemIds")).toEqual(["11,22"]);
  });

  it("adds to watch-later with the web client's form body and returns the created item", async () => {
    const add = mockFetch({
      status: 201,
      json: {
        meta: { status: 201 },
        data: { watchLater: { item: { itemId: 1173108780, watchId: "sm9", memo: "m" } } },
      },
    });
    const item = await createMylistsApi(testHttp(add)).addWatchLater("sm9", { memo: "m" });
    const call = add.only();
    expect(call.url).toBe("https://nvapi.nicovideo.jp/v1/users/me/watch-later");
    expect(formOf(call).get("watchId")).toBe("sm9");
    expect(formOf(call).get("memo")).toBe("m");
    expect(item?.itemId).toBe(1173108780);
  });

  it("removes watch-later entries by itemId, without a lookup when ids are numeric", async () => {
    const remove = mockFetch({ json: nvapi({}) });
    await createMylistsApi(testHttp(remove)).removeWatchLater([1173108780, "1182590816"]);
    expect(remove.only().method).toBe("DELETE");
    expect(remove.query().get("itemIds")).toBe("1173108780,1182590816");
    expect(remove.query().has("watchIds")).toBe(false);
  });

  it("resolves watch ids to itemIds through the watch-later listing", async () => {
    const mock = mockFetch([
      {
        json: nvapi({
          watchLater: {
            items: [
              { itemId: 1, watchId: "sm9", video: video("sm9") },
              { itemId: 2, watchId: "sm2", video: video("sm2") },
            ],
            totalCount: 3,
            hasNext: true,
          },
        }),
      },
      {
        json: nvapi({
          watchLater: { items: [{ itemId: 3, watchId: "sm3", video: video("sm3") }], totalCount: 3, hasNext: false },
        }),
      },
      { json: nvapi({}) },
    ]);
    await createMylistsApi(testHttp(mock)).removeWatchLater(["sm3", "sm9"]);
    expect(mock.calls.map((call) => call.method)).toEqual(["GET", "GET", "DELETE"]);
    expect(mock.query(2).get("itemIds")?.split(",").sort()).toEqual(["1", "3"]);
  });

  it("deletes nothing when a watch id is not in watch-later", async () => {
    const mock = mockFetch([
      { json: nvapi({ watchLater: { items: [{ itemId: 1, watchId: "sm9", video: video("sm9") }], hasNext: false } }) },
    ]);
    await expect(createMylistsApi(testHttp(mock)).removeWatchLater(["sm9", "sm404"])).rejects.toThrow(/sm404/);
    expect(mock.calls.every((call) => call.method === "GET")).toBe(true);
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

  it("ends the walk on the null cursor the last page carries", async () => {
    const mock = mockFetch([
      { json: nvapi({ items: [{ itemId: "h#20261031#a", video: video("a") }], nextCursor: "c1" }) },
      { json: nvapi({ items: [{ itemId: "h#20261030#b", video: video("b") }], nextCursor: null }) },
    ]);
    const ids: string[] = [];
    for await (const item of createHistoryApi(testHttp(mock)).iterateMyWatchHistory({ limit: 1 })) {
      ids.push(item.video.id);
    }
    expect(ids).toEqual(["a", "b"]);
    expect(mock.calls).toHaveLength(2);
    expect(mock.query(0).has("cursor")).toBe(false);
    expect(mock.query(1).get("cursor")).toBe("c1");
  });

  it("reports the last page's null cursor as undefined", async () => {
    const mock = mockFetch({ json: nvapi({ items: [{ video: video("a") }], nextCursor: null }) });
    const page = await createHistoryApi(testHttp(mock)).getMyWatchHistory();
    expect(page.nextCursor).toBeUndefined();
  });

  it("sends no cursor for a null or empty one instead of throwing", async () => {
    const mock = mockFetch({ json: nvapi({ items: [], nextCursor: null }) });
    const history = createHistoryApi(testHttp(mock));
    await history.getMyWatchHistory({ cursor: null as unknown as string });
    await history.getMyWatchHistory({ cursor: "" });
    const walked: unknown[] = [];
    for await (const item of history.iterateMyWatchHistory({ cursor: null as unknown as string })) {
      walked.push(item);
    }
    expect(walked).toEqual([]);
    expect(mock.calls).toHaveLength(3);
    expect(mock.calls.every((call) => !new URL(call.url).searchParams.has("cursor"))).toBe(true);
  });
});

describe("FeedApi", () => {
  it("clamps limit to the cap the host enforces", async () => {
    const mock = mockFetch({ json: { code: "ok", actors: [] } });
    await createFeedApi(testHttp(mock)).getActors({ limit: 500 });
    expect(mock.query().get("limit")).toBe(String(FEED_MAX_LIMIT));
  });

  it("sends the my_timeline context and a limit", async () => {
    const mock = mockFetch({ json: { code: "ok", activities: [] } });
    await createFeedApi(testHttp(mock)).getFollowingsVideo();
    expect(mock.query().has("limit")).toBe(true);
    expect(mock.query().get("context")).toBe("my_timeline");
  });

  it("walks cursors until a page comes back without one", async () => {
    const mock = mockFetch([
      { json: { code: "ok", activities: [{ id: "1", createdAt: "t" }], impressionId: "i", nextCursor: "c1" } },
      { json: { code: "ok", activities: [{ id: "2", createdAt: "t" }], impressionId: "i" } },
    ]);
    const ids: Array<string | undefined> = [];
    for await (const activity of createFeedApi(testHttp(mock)).iterateFollowingsVideo()) {
      ids.push(activity.id);
    }
    expect(ids).toEqual(["1", "2"]);
    expect(mock.calls).toHaveLength(2);
    expect(mock.query(1).get("cursor")).toBe("c1");
  });

  it("also ends on a null cursor, and never sends a null one", async () => {
    const mock = mockFetch({ json: { code: "ok", activities: [{ id: "1", createdAt: "t" }], nextCursor: null } });
    const feed = createFeedApi(testHttp(mock));
    const ids: Array<string | undefined> = [];
    for await (const activity of feed.iterateFollowingsVideo({ cursor: null as unknown as string })) {
      ids.push(activity.id);
    }
    expect(ids).toEqual(["1"]);
    await expect(feed.getFollowingsVideo()).resolves.toHaveProperty("nextCursor", undefined);
    expect(mock.calls).toHaveLength(2);
    expect(mock.query(0).has("cursor")).toBe(false);
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

describe("regressions from review", () => {
  it("treats an empty bulk removal as a no-op rather than a bare DELETE", async () => {
    const items = mockFetch({ json: nvapi({}) });
    await createMylistsApi(testHttp(items)).removeMylistItems(1, []);
    expect(items.calls).toHaveLength(0);

    const later = mockFetch({ json: nvapi({}) });
    await createMylistsApi(testHttp(later)).removeWatchLater([]);
    expect(later.calls).toHaveLength(0);
  });

  it("sends every field on update, as a form body", async () => {
    const mock = mockFetch({ json: nvapi({}) });
    await createMylistsApi(testHttp(mock)).updateMylist({
      mylistId: 1,
      name: "renamed",
      description: "kept",
      isPublic: true,
      defaultSortKey: "registeredAt",
      defaultSortOrder: "asc",
    });
    const call = mock.only();
    expect(call.method).toBe("PUT");
    expect(call.url).toBe("https://nvapi.nicovideo.jp/v1/users/me/mylists/1");
    const form = formOf(call);
    expect(form.get("name")).toBe("renamed");
    expect(form.get("isPublic")).toBe("true");
    expect(form.get("description")).toBe("kept");
    expect(form.get("defaultSortKey")).toBe("registeredAt");
    expect(form.get("defaultSortOrder")).toBe("asc");
  });
});
