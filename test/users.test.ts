import { describe, expect, it } from "vitest";
import { createUsersApi, userPathSegment } from "../src/users.js";
import { mockFetch, nvapi, testHttp } from "./helpers.js";

describe("userPathSegment", () => {
  it("passes a numeric id through and maps me", () => {
    expect(userPathSegment(4)).toBe("4");
    expect(userPathSegment("me")).toBe("me");
  });
});

describe("getUser", () => {
  it("reads relationships from data, not from data.user", async () => {
    const mock = mockFetch({
      json: nvapi({
        user: { id: 4, nickname: "中の", icons: { small: "s", large: "l" } },
        relationships: { sessionUser: { isFollowing: true }, isMe: false },
      }),
    });
    const result = await createUsersApi(testHttp(mock)).getUser(4);
    expect(result.user.nickname).toBe("中の");
    expect(result.relationships.sessionUser?.isFollowing).toBe(true);
    expect(result.relationships.isMe).toBe(false);
    expect(mock.only().url).toBe("https://nvapi.nicovideo.jp/v1/users/4");
  });

  it("defaults relationships to an empty object when absent", async () => {
    const mock = mockFetch({ json: nvapi({ user: { id: 1, nickname: "x", icons: { small: "", large: "" } } }) });
    const result = await createUsersApi(testHttp(mock)).getUser("me");
    expect(result.relationships).toEqual({});
    expect(mock.only().url).toBe("https://nvapi.nicovideo.jp/v1/users/me");
  });
});

describe("getUserVideos", () => {
  it("unwraps the essential field and drops entries without one", async () => {
    const mock = mockFetch({
      json: nvapi({
        totalCount: 2,
        items: [
          { series: null, essential: { id: "sm9", title: "a", count: {}, thumbnail: {}, owner: null } },
          { series: null },
        ],
      }),
    });
    const result = await createUsersApi(testHttp(mock)).getUserVideos(4, { pageSize: 2, sortKey: "viewCount" });
    expect(result.items.map((v) => v.id)).toEqual(["sm9"]);
    expect(result.totalCount).toBe(2);
    expect(mock.query().get("pageSize")).toBe("2");
    expect(mock.query().get("sortKey")).toBe("viewCount");
  });

  it("falls back to the item count when totalCount is missing", async () => {
    const mock = mockFetch({ json: nvapi({ items: [] }) });
    const result = await createUsersApi(testHttp(mock)).getUserVideos(4);
    expect(result.totalCount).toBe(0);
  });
});

describe("follow lists", () => {
  it("sends the cursor when one is given", async () => {
    const mock = mockFetch({ json: nvapi({ items: [], summary: {} }) });
    await createUsersApi(testHttp(mock)).getUserFollowing(4, { pageSize: 25, cursor: "20190727000800_39040725" });
    expect(mock.only().url).toContain("/v1/users/4/following/users");
    expect(mock.query().get("cursor")).toBe("20190727000800_39040725");
  });

  it("uses the followed-by route for followers", async () => {
    const mock = mockFetch({ json: nvapi({ items: [], summary: {} }) });
    await createUsersApi(testHttp(mock)).getUserFollowedBy(4, { pageSize: 25 });
    expect(mock.only().url).toContain("/v1/users/4/followed-by/users");
  });

  it("walks pages by cursor and stops when hasNext clears", async () => {
    const mock = mockFetch([
      { json: nvapi({ items: [{ id: 1 }, { id: 2 }], summary: { hasNext: true, cursor: "c1" } }) },
      { json: nvapi({ items: [{ id: 3 }], summary: { hasNext: false, cursor: "c2" } }) },
    ]);
    const seen: number[] = [];
    for await (const user of createUsersApi(testHttp(mock)).iterateUserFollowing(4, { pageSize: 2 })) {
      seen.push(user.id);
    }
    expect(seen).toEqual([1, 2, 3]);
    expect(mock.query(1).get("cursor")).toBe("c1");
  });

  it("stops instead of looping when the cursor stops advancing", async () => {
    const mock = mockFetch({ json: nvapi({ items: [{ id: 1 }], summary: { hasNext: true, cursor: "same" } }) });
    const seen: number[] = [];
    for await (const user of createUsersApi(testHttp(mock)).iterateUserFollowing(4, {
      pageSize: 1,
      cursor: "same",
    })) {
      seen.push(user.id);
    }
    expect(seen).toEqual([1]);
  });
});

describe("iterateUserVideos", () => {
  it("pages until totalCount is reached", async () => {
    const page = (ids: string[], total: number) =>
      nvapi({
        totalCount: total,
        items: ids.map((id) => ({ essential: { id, title: id, count: {}, thumbnail: {}, owner: null } })),
      });
    const mock = mockFetch([{ json: page(["a", "b"], 3) }, { json: page(["c"], 3) }]);
    const ids: string[] = [];
    for await (const video of createUsersApi(testHttp(mock)).iterateUserVideos(4, { pageSize: 2 })) {
      ids.push(video.id);
    }
    expect(ids).toEqual(["a", "b", "c"]);
    expect(mock.calls).toHaveLength(2);
  });
});

describe("getCreatorSupport", () => {
  it("unwraps the creatorSupport envelope", async () => {
    const mock = mockFetch({
      json: nvapi({
        creatorSupport: {
          isSupportable: true,
          canOpenCreatorSupport: false,
          supporterStatus: { isSupporting: false, isBanned: false },
        },
      }),
    });
    const result = await createUsersApi(testHttp(mock)).getCreatorSupport(4);
    expect(result.isSupportable).toBe(true);
  });
});
