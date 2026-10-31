import { describe, expect, it } from "vitest";
import { NiconicoClient } from "../src/client.js";
import { domandRequestHeaders, DomandUnavailableError } from "../src/streaming.js";
import { ThreadKeyRejectedError } from "../src/comments.js";
import { RANKING_ALL_KEY } from "../src/ranking.js";
import { NiconicoApiError } from "../src/errors.js";
import { LIVE_ENABLED, LIVE_SESSION, LIVE_WRITES } from "./helpers.js";

const VIDEO_ID = "sm9";
const TAGGED_VIDEO_ID = "sm500873";
const SERIES_VIDEO_ID = "sm41131114";
const SERIES_ID = 363443;
const USER_ID = 4;

const live = LIVE_ENABLED ? describe : describe.skip;
const authed = LIVE_ENABLED && LIVE_SESSION !== undefined ? describe : describe.skip;
const writes = LIVE_ENABLED && LIVE_SESSION !== undefined && LIVE_WRITES ? describe : describe.skip;

async function eventually(check: () => Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function firstMediaPlaylist(masterUrl: string, headers: Record<string, string>): Promise<string> {
  const master = await (await fetch(masterUrl, { headers })).text();
  const media = master.split("\n").find((line) => line.length > 0 && !line.startsWith("#"));
  if (media === undefined) throw new Error("master playlist listed no media playlist");
  const mediaUrl = new URL(media, masterUrl).toString();
  return (await (await fetch(mediaUrl, { headers })).text()).replace(/URI="([^"]+)"/g, (_whole, uri: string) => {
    return `URI="${new URL(uri, mediaUrl).toString()}"`;
  });
}

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

live("live: v4 watch, lazy data and pre-issued HLS", () => {
  it("fetches v4 watch data as a guest, with an HLS session already issued", async () => {
    const watch = await guest.watch.getWatchV4(VIDEO_ID);
    expect(watch.guest).toBe(true);
    expect(watch.data.video.id).toBe(VIDEO_ID);
    expect(watch.data.client.watchTrackId).toBe(watch.actionTrackId);
    expect(watch.data.viewer).toBeNull();
    expect(watch.data.tags.items.length).toBeGreaterThan(0);
    expect(watch.data.comment.nvComment).not.toBeNull();
    expect(watch.data.media?.hls?.url).toContain(".m3u8");
    expect(watch.domandBidCookie).toBeDefined();
  });

  it("plays the pre-issued HLS, whose AES key needs the watch call's domand_bid", async () => {
    const watch = await guest.watch.getWatchV4(VIDEO_ID);
    const hls = guest.streaming.getPreissuedHls(watch);
    if (hls === undefined) throw new Error("no pre-issued HLS");
    const media = await firstMediaPlaylist(hls.contentUrl, domandRequestHeaders(hls));
    const keyUri = /#EXT-X-KEY:[^\n]*URI="([^"]+)"/.exec(media)?.[1];
    if (keyUri === undefined) throw new Error("media playlist carried no key");
    const withBid = await fetch(keyUri, { headers: domandRequestHeaders(hls) });
    expect(withBid.status).toBe(200);
    expect((await withBid.arrayBuffer()).byteLength).toBe(16);
    const withoutBid = await fetch(keyUri, { headers: domandRequestHeaders({ domandBidCookie: undefined }) });
    expect(withoutBid.status).toBe(403);
  });

  it("issues a fresh HLS session from v4 data", async () => {
    const watch = await guest.watch.getWatchV4(VIDEO_ID);
    const hls = await guest.streaming.getHlsFromWatch(watch);
    const response = await fetch(hls.contentUrl, { headers: domandRequestHeaders(hls) });
    expect(response.status).toBe(200);
    expect((await response.text()).startsWith("#EXTM3U")).toBe(true);
  });

  it("reads the series from lazy data, since watch v3 no longer carries it", async () => {
    const v3 = await guest.watch.getGuestWatchData(SERIES_VIDEO_ID, { noSideEffect: true });
    expect(v3.data.series).toBeNull();
    const watch = await guest.watch.getWatchV4(SERIES_VIDEO_ID);
    const lazy = await guest.watch.getWatchLazy(watch);
    expect(lazy.series?.id).toBe(SERIES_ID);
    expect(lazy.owner?.type).toBe("user");
  });

  it("reports why a deleted video cannot be watched", async () => {
    const error = await guest.watch.getWatchV4("sm1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NiconicoApiError);
    expect((error as NiconicoApiError).reasonCode).toBe("ADMINISTRATOR_DELETE_VIDEO");
  });
});

live("live: search parameters", () => {
  it("applies every genre of a multi-genre search", async () => {
    const both = await guest.search.searchVideos({ keyword: "初音ミク", genres: ["game", "music_sound"], pageSize: 1 });
    const music = await guest.search.searchVideos({ keyword: "初音ミク", genres: ["music_sound"], pageSize: 1 });
    expect(both.totalCount).toBeGreaterThan(music.totalCount);
  });

  it("searches short videos on request", async () => {
    const result = await guest.search.searchVideos({ keyword: "初音ミク", selectContentType: "short", pageSize: 3 });
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((video) => video.contentType === "short")).toBe(true);
  });
});

authed("live: authenticated v4 and account reads", () => {
  it("fills the viewer and the storyboard flag in v4 data", async () => {
    const watch = await session.watch.getWatchV4(VIDEO_ID);
    expect(watch.guest).toBe(false);
    expect(watch.data.viewer?.id).toBeGreaterThan(0);
    expect(watch.data.media?.isStoryboardAvailable).toBe(true);
    const storyboard = await session.streaming.getStoryboardFromWatch(watch);
    expect(storyboard.contentUrl).toContain("storyboard");
  });

  it("reads the viewer's follow state from lazy data", async () => {
    const watch = await session.watch.getWatchV4(VIDEO_ID);
    const lazy = await session.watch.getWatchLazy(watch);
    expect(lazy.owner?.follow).not.toBeNull();
  });

  it("streams guest watch data on a logged-in client", async () => {
    const v3 = await session.watch.getGuestWatchData(VIDEO_ID, { noSideEffect: true });
    const fromV3 = await session.streaming.getHlsFromWatch(v3);
    expect((await fetch(fromV3.contentUrl, { headers: domandRequestHeaders(fromV3) })).status).toBe(200);
    const v4 = await session.watch.getWatchV4(VIDEO_ID, { asGuest: true });
    const fromV4 = await session.streaming.getHlsFromWatch(v4);
    expect((await fetch(fromV4.contentUrl, { headers: domandRequestHeaders(fromV4) })).status).toBe(200);
  });

  it("walks comment history by video id with v4-resolved keys", async () => {
    const all = await session.comments.fetchAllCommentsByVideoId(VIDEO_ID, { maxTotalCount: 1200 });
    expect(all.length).toBeGreaterThan(600);
    expect(new Set(all.map((comment) => comment.no)).size).toBe(all.length);
  });

  it("reads the account's NG list, compact mylist index and unread flag", async () => {
    const ng = await session.ngComments.getMyNgComments();
    expect(ng.count).toBe(ng.items.length);
    await expect(session.mylists.getMyMylistsCompact()).resolves.toBeInstanceOf(Array);
    await expect(session.feed.hasUnread()).resolves.toBeTypeOf("boolean");
  });
});

writes("live: reversible writes (NICONICO_LIVE_WRITES=1)", () => {
  it("creates, edits, fills, empties and deletes a private mylist", async () => {
    const name = `niconicojs-live-${Date.now().toString(36)}`;
    const id = await session.mylists.createMylist({ name, description: "d", isPublic: false });
    try {
      await session.mylists.updateMylist({
        mylistId: id,
        name: `${name}-renamed`,
        description: "d2",
        isPublic: false,
        defaultSortKey: "addedAt",
        defaultSortOrder: "asc",
      });
      await session.mylists.addMylistItem(id, VIDEO_ID, { description: "memo" });
      await session.mylists.addMylistItem(id, TAGGED_VIDEO_ID);
      let filled = await session.mylists.getMyMylist(id);
      const bothListed = await eventually(async () => {
        filled = await session.mylists.getMyMylist(id);
        return filled.items.length === 2;
      });
      expect(bothListed).toBe(true);
      expect(filled.name).toBe(`${name}-renamed`);
      expect(filled.defaultSortOrder).toBe("asc");
      expect(filled.items.map((item) => item.watchId).sort()).toEqual([TAGGED_VIDEO_ID, VIDEO_ID].sort());
      await expect(session.mylists.getMylist(id)).rejects.toMatchObject({ status: 403 });
      await session.mylists.removeMylistItems(
        id,
        filled.items.map((item) => item.itemId),
      );
      expect(await eventually(async () => (await session.mylists.getMyMylist(id)).items.length === 0)).toBe(true);
    } finally {
      await session.mylists.deleteMylist(id);
    }
    const gone = await eventually(async () =>
      (await session.mylists.getMyMylistsCompact()).every((mylist) => mylist.id !== id),
    );
    expect(gone).toBe(true);
  });

  it("adds to watch-later with a memo and removes the entry by watch id", async () => {
    const item = await session.mylists.addWatchLater(TAGGED_VIDEO_ID, { memo: "niconicojs" });
    let removedByWatchId = false;
    try {
      expect(item?.watchId).toBe(TAGGED_VIDEO_ID);
      expect(item?.memo).toBe("niconicojs");
      await session.mylists.removeWatchLater([TAGGED_VIDEO_ID]);
      removedByWatchId = true;
    } finally {
      if (!removedByWatchId && item?.itemId !== undefined) {
        await session.mylists.removeWatchLater([item.itemId]);
      }
    }
    const gone = await eventually(async () =>
      (await session.mylists.getMyWatchLater({ pageSize: 100 })).items.every(
        (entry) => entry.watchId !== TAGGED_VIDEO_ID,
      ),
    );
    expect(gone).toBe(true);
  });

  it("adds and removes a server-side NG word", async () => {
    const source = `niconicojs-live-${Date.now().toString(36)}`;
    const added = await session.ngComments.addNgComment({ type: "word", source });
    try {
      expect(added.items.some((item) => item.source === source)).toBe(true);
    } finally {
      const removed = await session.ngComments.removeNgComments([{ type: "word", source }]);
      expect(removed.items.some((item) => item.source === source)).toBe(false);
    }
  });

  it("records a view and removes it again, for a video the history does not hold yet", async (ctx) => {
    const target = TAGGED_VIDEO_ID;
    const seen = new Set<string>();
    let complete = false;
    let cursor: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const result = await session.history.getMyWatchHistory({ limit: 100, cursor });
      for (const entry of result.items) seen.add(entry.video.id);
      if (result.items.length === 0 || result.nextCursor === undefined) {
        complete = true;
        break;
      }
      cursor = result.nextCursor;
    }
    if (!complete || seen.has(target)) ctx.skip();

    const watch = await session.watch.getWatchV4(target);
    let recorded = false;
    let removed: string[] = [];
    try {
      await session.watch.recordView(watch);
      for (let attempt = 0; attempt < 10 && !recorded; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const latest = await session.history.getMyWatchHistory({ limit: 10 });
        recorded = latest.items.some((entry) => entry.video.id === target);
      }
    } finally {
      removed = await session.history.removeMyWatchHistory(target);
    }
    expect(recorded).toBe(true);
    expect(removed.some((itemId) => itemId.endsWith(`#${target}`))).toBe(true);
    const gone = await eventually(async () =>
      (await session.history.getMyWatchHistory({ limit: 10 })).items.every((entry) => entry.video.id !== target),
    );
    expect(gone).toBe(true);
  });
});
