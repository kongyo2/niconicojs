import { describe, expect, it } from "vitest";
import { NiconicoClient } from "../src/client.js";
import { domandRequestHeaders, DomandUnavailableError } from "../src/streaming.js";
import { ThreadKeyRejectedError } from "../src/comments.js";
import { RANKING_ALL_KEY } from "../src/ranking.js";
import { LIVE_ENABLED, LIVE_SESSION } from "./helpers.js";

const VIDEO_ID = "sm9";
const TAGGED_VIDEO_ID = "sm500873";
const USER_ID = 4;

const live = LIVE_ENABLED ? describe : describe.skip;
const authed = LIVE_ENABLED && LIVE_SESSION !== undefined ? describe : describe.skip;

const guest = new NiconicoClient();
const session = new NiconicoClient(LIVE_SESSION === undefined ? {} : { session: LIVE_SESSION });

live("live: public reads", () => {
  it("fetches a user profile", async () => {
    const { user } = await guest.users.getUser(USER_ID);
    expect(user.id).toBe(USER_ID);
    expect(user.nickname.length).toBeGreaterThan(0);
  });

  it("lists a user's videos", async () => {
    const result = await guest.users.getUserVideos(USER_ID, { pageSize: 3 });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.id).toMatch(/^[a-z]{2}\d+$/);
  });

  it("searches videos and returns a populated envelope", async () => {
    const result = await guest.search.searchVideos({ keyword: "初音ミク", pageSize: 3 });
    expect(result.totalCount).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items[0]?.count.view).toBeGreaterThan(0);
  });

  it("returns per-genre facet counts", async () => {
    const result = await guest.search.searchFacets({ keyword: "初音ミク" });
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("reads the ranking through the BFF", async () => {
    const result = await guest.ranking.getRanking({ term: "24h" });
    expect(result.featuredKey).toBe(RANKING_ALL_KEY);
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.genres.length).toBeGreaterThan(0);
  });

  it("lists ranking genres, all of them enabled", async () => {
    const genres = await guest.ranking.getRankingGenres();
    expect(genres.length).toBeGreaterThan(1);
    expect(genres.every((genre) => genre.isEnabled)).toBe(true);
  });

  it("lists search genres and a genre's popular tags", async () => {
    const genres = await guest.genres.getGenres();
    expect(genres.some((genre) => genre.key === "game")).toBe(true);
    const tags = await guest.genres.getPopularTags("game");
    expect(tags.tags.length).toBeGreaterThan(0);
  });

  it("looks up several videos at once, in order", async () => {
    const results = await guest.videos.getVideos([VIDEO_ID, TAGGED_VIDEO_ID]);
    expect(results.map((r) => r.watchId)).toEqual([VIDEO_ID, TAGGED_VIDEO_ID]);
    expect(results.every((r) => r.video !== null)).toBe(true);
  });

  it("parses getthumbinfo, including tags and uploader", async () => {
    const info = await guest.thumbInfo.getThumbInfo(TAGGED_VIDEO_ID);
    expect(info.videoId).toBe(TAGGED_VIDEO_ID);
    expect(info.durationSeconds).toBeGreaterThan(0);
    expect(info.tags.length).toBeGreaterThan(0);
    expect(info.userId).not.toBeNull();
  });

  it("returns null for a video getthumbinfo does not know", async () => {
    await expect(guest.thumbInfo.tryGetThumbInfo("sm1")).resolves.toBeNull();
  });

  it("expands a search suggestion", async () => {
    const candidates = await guest.suggestion.expand("初音");
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("searches the snapshot index and gets tags back", async () => {
    const result = await guest.snapshot.search({
      q: "初音ミク",
      targets: ["title"],
      fields: ["contentId", "title", "tags", "viewCounter"],
      sort: "viewCounter",
      limit: 2,
      context: "niconicojs-test",
    });
    expect(result.meta.totalCount).toBeGreaterThan(0);
    expect(result.data[0]?.tags).toBeTruthy();
  });

  it("reads nicoad totals", async () => {
    const ad = await guest.videos.getNicoAd(VIDEO_ID);
    expect(ad.id).toBe(VIDEO_ID);
  });

  it("reads a public mylist and a series", async () => {
    const mylist = await guest.mylists.getMylist(65776587, { pageSize: 1 });
    expect(mylist.name.length).toBeGreaterThan(0);
    const series = await guest.series.getSeries(363443, { pageSize: 1 });
    expect(series.detail.title.length).toBeGreaterThan(0);
  });
});

live("live: watch, comments and streaming", () => {
  it("fetches guest watch data with tags and DMS media", async () => {
    const watch = await guest.watch.getGuestWatchData(VIDEO_ID, { noSideEffect: true });
    expect(watch.data.video.id).toBe(VIDEO_ID);
    expect(watch.data.client.watchTrackId).toBe(watch.actionTrackId);
    expect(watch.data.tag.items.length).toBeGreaterThan(0);
    expect(watch.data.media.domand).not.toBeNull();
    expect(watch.data.comment.nvComment).not.toBeNull();
  });

  it("fetches comments from watch credentials", async () => {
    const watch = await guest.watch.getGuestWatchData(VIDEO_ID, { noSideEffect: true });
    const nvComment = watch.data.comment.nvComment;
    if (nvComment === null) throw new Error("nvComment missing");
    const threads = await guest.comments.fetchComments(nvComment);
    const main = threads.find((thread) => thread.fork === "main");
    expect(main?.comments.length).toBeGreaterThan(0);
  });

  it("fetches comments from a standalone thread key", async () => {
    const key = await guest.comments.getThreadKey(VIDEO_ID);
    expect(key.length).toBeGreaterThan(0);
    const threads = await guest.comments.fetchCommentsByVideoId(VIDEO_ID);
    expect(threads.some((thread) => thread.comments.length > 0)).toBe(true);
  });

  it("refuses to walk back through history as a guest, and says why", async () => {
    const watch = await guest.watch.getGuestWatchData(VIDEO_ID, { noSideEffect: true });
    const nvComment = watch.data.comment.nvComment;
    if (nvComment === null) throw new Error("nvComment missing");
    await expect(guest.comments.fetchAllComments(nvComment)).rejects.toBeInstanceOf(ThreadKeyRejectedError);
  });

  it("gets a playable HLS master playlist", async () => {
    const watch = await guest.watch.getGuestWatchData(VIDEO_ID, { noSideEffect: true });
    const hls = await guest.streaming.getHlsFromWatch(watch);
    expect(hls.contentUrl).toContain(".m3u8");
    expect(hls.domandBidCookie).toBeDefined();

    const response = await fetch(hls.contentUrl, { headers: domandRequestHeaders(hls) });
    expect(response.status).toBe(200);
    const playlist = await response.text();
    expect(playlist.startsWith("#EXTM3U")).toBe(true);
    expect(playlist).toContain("#EXT-X-STREAM-INF");
  });

  it("reports that a guest cannot have a storyboard", async () => {
    const watch = await guest.watch.getGuestWatchData(VIDEO_ID, { noSideEffect: true });
    expect(watch.data.media.domand?.isStoryboardAvailable).toBe(false);
    expect(() => guest.streaming.getStoryboardFromWatch(watch)).toThrow(DomandUnavailableError);
  });
});

authed("live: authenticated reads", () => {
  it("verifies the session and reports who it belongs to", async () => {
    const me = await session.auth.verifySession();
    expect(me.userId).toBeGreaterThan(0);
    expect(me.nickname.length).toBeGreaterThan(0);
  });

  it("resolves the me alias to the same account", async () => {
    const me = await session.auth.verifySession();
    const { user } = await session.users.getUser("me");
    expect(user.id).toBe(me.userId);
  });

  it("uses watch v3 and fills in the viewer block", async () => {
    const watch = await session.watch.getBestWatchData(VIDEO_ID, { noSideEffect: true });
    expect(watch.data.viewer).not.toBeNull();
  });

  it("walks back through comment history with a session key", async () => {
    const watch = await session.watch.getWatchData(VIDEO_ID, { noSideEffect: true });
    const nvComment = watch.data.comment.nvComment;
    if (nvComment === null) throw new Error("nvComment missing");
    const all = await session.comments.fetchAllComments(nvComment, { maxTotalCount: 1200 });
    expect(all.length).toBeGreaterThan(600);
    expect(new Set(all.map((comment) => comment.no)).size).toBe(all.length);
  });

  it("gets a storyboard manifest with a session key", async () => {
    const watch = await session.watch.getWatchData(VIDEO_ID, { noSideEffect: true });
    expect(watch.data.media.domand?.isStoryboardAvailable).toBe(true);
    const storyboard = await session.streaming.getStoryboardFromWatch(watch);
    expect(storyboard.contentUrl).toContain("storyboard");
  });

  it("reads the session user's own lists and history", async () => {
    await expect(session.mylists.getMyMylists()).resolves.toHaveProperty("mylists");
    await expect(session.mylists.getMyWatchLater({ pageSize: 2 })).resolves.toHaveProperty("items");
    await expect(session.history.getMyWatchHistory({ limit: 2 })).resolves.toHaveProperty("items");
    await expect(session.likes.getMyLikes({ pageSize: 2 })).resolves.toHaveProperty("items");
  });

  it("reads the follow feed", async () => {
    await expect(session.feed.getActors({ limit: 10 })).resolves.toBeInstanceOf(Array);
    await expect(session.feed.getFollowingsVideo({ limit: 5 })).resolves.toHaveProperty("activities");
  });
});
