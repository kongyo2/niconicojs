import { describe, expect, it } from "vitest";
import { createSearchApi } from "../src/search.js";
import { createRankingApi, RANKING_ALL_KEY } from "../src/ranking.js";
import { createGenresApi } from "../src/genres.js";
import { createSnapshotApi, normalizeSnapshotSort } from "../src/snapshot.js";
import { createSuggestionApi } from "../src/suggestion.js";
import { NiconicoError } from "../src/errors.js";
import { mockFetch, nvapi, testHttp } from "./helpers.js";

describe("searchVideos", () => {
  const body = nvapi({
    searchId: "id",
    keyword: "初音ミク",
    tag: null,
    totalCount: 42,
    hasNext: true,
    items: [],
    additionals: { tags: [{ text: "VOCALOID", type: "included_word" }] },
  });

  it("requires a keyword or a tag", async () => {
    const api = createSearchApi(testHttp(mockFetch({})));
    await expect(api.searchVideos({})).rejects.toBeInstanceOf(NiconicoError);
    await expect(api.searchFacets({})).rejects.toBeInstanceOf(NiconicoError);
  });

  it("defaults the sort to hot/none, which the endpoint demands", async () => {
    const mock = mockFetch({ json: body });
    await createSearchApi(testHttp(mock)).searchVideos({ keyword: "初音ミク" });
    expect(mock.query().get("sortKey")).toBe("hot");
    expect(mock.query().get("sortOrder")).toBe("none");
  });

  it("repeats genres and surfaces the suggested tags", async () => {
    const mock = mockFetch({ json: body });
    const result = await createSearchApi(testHttp(mock)).searchVideos({
      keyword: "初音ミク",
      genres: ["music_sound", "anime"],
    });
    expect(mock.query().getAll("genres")).toEqual(["music_sound", "anime"]);
    expect(result.totalCount).toBe(42);
    expect(result.additionalTags).toEqual([{ text: "VOCALOID", type: "included_word" }]);
  });

  it("stops iterating when hasNext clears", async () => {
    const page = (ids: string[], hasNext: boolean) =>
      nvapi({
        searchId: "s",
        keyword: "k",
        tag: null,
        totalCount: 3,
        hasNext,
        items: ids.map((id) => ({ id, title: id, count: {}, thumbnail: {}, owner: null })),
      });
    const mock = mockFetch([{ json: page(["a", "b"], true) }, { json: page(["c"], false) }]);
    const ids: string[] = [];
    for await (const video of createSearchApi(testHttp(mock)).iterateVideos({ keyword: "k", pageSize: 2 })) {
      ids.push(video.id);
    }
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("honours maxItems mid-page", async () => {
    const mock = mockFetch({
      json: nvapi({
        searchId: "s",
        keyword: "k",
        tag: null,
        totalCount: 9,
        hasNext: true,
        items: ["a", "b", "c"].map((id) => ({ id, title: id, count: {}, thumbnail: {}, owner: null })),
      }),
    });
    const ids: string[] = [];
    for await (const video of createSearchApi(testHttp(mock)).iterateVideos({ keyword: "k", maxItems: 2 })) {
      ids.push(video.id);
    }
    expect(ids).toEqual(["a", "b"]);
    expect(mock.calls).toHaveLength(1);
  });
});

describe("getNewArrivalVideos", () => {
  it("defaults sensitiveContents to mask", async () => {
    const mock = mockFetch({ json: nvapi({ items: [], hasNext: false, createdAt: null }) });
    const result = await createSearchApi(testHttp(mock)).getNewArrivalVideos({ pageSize: 10, page: 1 });
    expect(mock.query().get("sensitiveContents")).toBe("mask");
    expect(result.createdAt).toBeNull();
  });
});

describe("RankingApi", () => {
  const bff = (overrides: Record<string, unknown> = {}) => ({
    meta: { status: 200 },
    data: {
      response: {
        $getTeibanRanking: {
          data: { featuredKey: RANKING_ALL_KEY, label: "総合", tag: null, maxItemCount: 100, items: [], hasNext: true },
        },
        $getTeibanRankingFeaturedKeyAndTrendTags: { data: { trendTags: ["琴葉葵"] } },
        $getTeibanRankingFeaturedKeys: {
          data: {
            items: [
              {
                featuredKey: RANKING_ALL_KEY,
                label: "総合",
                isEnabled: true,
                isEnabledTrendTag: false,
                isMajorFeatured: true,
                isTopLevel: true,
                isImmoral: false,
              },
              {
                featuredKey: "old",
                label: "廃止",
                isEnabled: false,
                isEnabledTrendTag: false,
                isMajorFeatured: false,
                isTopLevel: false,
                isImmoral: false,
              },
            ],
          },
        },
        page: {
          pagination: { page: 1, pageSize: 100, totalCount: 1000, maxPage: null },
          currentTag: null,
          currentTerm: "24h",
          availableTerms: [],
        },
        ...overrides,
      },
    },
  });

  it("targets the BFF route with responseType=json and the 総合 key", async () => {
    const mock = mockFetch({ json: bff() });
    const result = await createRankingApi(testHttp(mock)).getRanking({ term: "24h" });
    expect(mock.only().url).toContain(`/ranking/genre/${RANKING_ALL_KEY}`);
    expect(mock.query().get("responseType")).toBe("json");
    expect(mock.query().get("term")).toBe("24h");
    expect(result.label).toBe("総合");
    expect(result.trendTags).toEqual(["琴葉葵"]);
    expect(result.pagination?.totalCount).toBe(1000);
  });

  it("omits an empty tag rather than sending tag=", async () => {
    const mock = mockFetch({ json: bff() });
    await createRankingApi(testHttp(mock)).getRanking({ tag: "" });
    expect(mock.query().has("tag")).toBe(false);
  });

  it("filters disabled genres out of the genre list", async () => {
    const mock = mockFetch({ json: bff() });
    const genres = await createRankingApi(testHttp(mock)).getRankingGenres();
    expect(genres.map((g) => g.featuredKey)).toEqual([RANKING_ALL_KEY]);
  });

  it("explains an empty BFF payload", async () => {
    const mock = mockFetch({ json: { meta: { status: 200 }, data: { response: {} } } });
    await expect(createRankingApi(testHttp(mock)).getRanking()).rejects.toThrow(/no data for featuredKey/);
  });

  it("stops paging at maxPage", async () => {
    const withMaxPage = {
      meta: { status: 200 },
      data: {
        response: {
          $getTeibanRanking: {
            data: {
              featuredKey: "k",
              label: "l",
              tag: null,
              items: [{ id: "a", title: "a", count: {}, thumbnail: {}, owner: null }],
              hasNext: true,
            },
          },
          page: {
            pagination: { page: 1, pageSize: 1, totalCount: 1, maxPage: 1 },
            currentTag: null,
            currentTerm: "24h",
            availableTerms: [],
          },
        },
      },
    };
    const mock = mockFetch({ json: withMaxPage });
    const ids: string[] = [];
    for await (const video of createRankingApi(testHttp(mock)).iterateRanking()) {
      ids.push(video.id);
    }
    expect(ids).toEqual(["a"]);
    expect(mock.calls).toHaveLength(1);
  });
});

describe("GenresApi", () => {
  it("reads genres and popular tags", async () => {
    const genresMock = mockFetch({ json: nvapi({ genres: [{ key: "game", label: "ゲーム" }] }) });
    await expect(createGenresApi(testHttp(genresMock)).getGenres()).resolves.toEqual([
      { key: "game", label: "ゲーム" },
    ]);
    expect(genresMock.only().url).toBe("https://nvapi.nicovideo.jp/v2/genres");

    const tagsMock = mockFetch({ json: nvapi({ startAt: "2026-08-14T00:00:00+09:00", tags: ["RTA"] }) });
    const result = await createGenresApi(testHttp(tagsMock)).getPopularTags("game");
    expect(result.tags).toEqual(["RTA"]);
    expect(tagsMock.only().url).toContain("/v1/genres/game/popular-tags");
  });
});

describe("normalizeSnapshotSort", () => {
  it("signs bare fields and preserves explicit signs", () => {
    expect(normalizeSnapshotSort(undefined, undefined)).toBe("-startTime");
    expect(normalizeSnapshotSort(undefined, "asc")).toBe("+startTime");
    expect(normalizeSnapshotSort("viewCounter", undefined)).toBe("-viewCounter");
    expect(normalizeSnapshotSort("viewCounter", "asc")).toBe("+viewCounter");
    expect(normalizeSnapshotSort(["+viewCounter", "startTime"], "desc")).toBe("+viewCounter,-startTime");
  });
});

describe("SnapshotApi", () => {
  it("builds the underscore-prefixed params and a default context", async () => {
    const mock = mockFetch({ json: { meta: { status: 200, totalCount: 1, id: "x" }, data: [] } });
    await createSnapshotApi(testHttp(mock)).search({
      q: "初音ミク",
      targets: ["title", "tags"],
      fields: ["contentId", "title"],
      sort: "viewCounter",
      limit: 10,
      offset: 5,
    });
    const query = mock.query();
    expect(query.get("targets")).toBe("title,tags");
    expect(query.get("fields")).toBe("contentId,title");
    expect(query.get("_sort")).toBe("-viewCounter");
    expect(query.get("_limit")).toBe("10");
    expect(query.get("_offset")).toBe("5");
    expect(query.get("_context")).toBe("niconicojs");
  });

  it("encodes exact and range filters in the bracket syntax", async () => {
    const mock = mockFetch({ json: { meta: { status: 200, totalCount: 0, id: "x" }, data: [] } });
    await createSnapshotApi(testHttp(mock)).search({
      q: "",
      targets: "tagsExact",
      fields: "contentId",
      filters: { tags: ["VOCALOID", "初音ミク"] },
      rangeFilters: [{ field: "viewCounter", gte: 10000 }],
    });
    const url = decodeURIComponent(mock.only().url);
    expect(url).toContain("filters[tags][0]=VOCALOID");
    expect(url).toContain("filters[tags][1]=初音ミク");
    expect(url).toContain("filters[viewCounter][gte]=10000");
  });

  it("raises the API's own failure status", async () => {
    const mock = mockFetch({ json: { meta: { status: 400, totalCount: 0, id: "err" }, data: [] } });
    await expect(
      createSnapshotApi(testHttp(mock)).search({ q: "x", targets: "title", fields: "contentId" }),
    ).rejects.toThrow(/snapshot search failed: 400/);
  });
});

describe("SuggestionApi", () => {
  it("hits the expand route and unwraps candidates", async () => {
    const mock = mockFetch({ json: { candidates: ["初音ミク"] } });
    await expect(createSuggestionApi(testHttp(mock)).expand("初音")).resolves.toEqual(["初音ミク"]);
    expect(mock.only().url).toBe("https://sug.search.nicovideo.jp/suggestion/expand/%E5%88%9D%E9%9F%B3");
  });
});
