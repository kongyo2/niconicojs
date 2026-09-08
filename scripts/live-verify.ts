import { NiconicoClient } from "../src/client.js";
import { domandRequestHeaders } from "../src/streaming.js";
import { RANKING_ALL_KEY } from "../src/ranking.js";

const SESSION = process.env["NICONICO_SESSION"];
const VIDEO_ID = "sm9";
const TAGGED_VIDEO_ID = "sm500873";
const USER_ID = 4;
const PUBLIC_MYLIST_ID = 65776587;
const PUBLIC_SERIES_ID = 363443;

const guest = new NiconicoClient();
const client = new NiconicoClient(SESSION === undefined ? {} : { session: SESSION });

interface Row {
  name: string;
  status: "ok" | "fail" | "skip";
  detail: string;
}

const rows: Row[] = [];

async function check(name: string, run: () => Promise<string>): Promise<void> {
  try {
    rows.push({ name, status: "ok", detail: await run() });
  } catch (error) {
    rows.push({ name, status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }
}

function skip(name: string, why: string): void {
  rows.push({ name, status: "skip", detail: why });
}

async function main(): Promise<void> {
  if (SESSION === undefined) {
    skip("auth.verifySession", "NICONICO_SESSION not set");
  } else {
    await check("auth.verifySession", async () => {
      const me = await client.auth.verifySession();
      return `${me.nickname} (#${me.userId}) premium=${me.isPremium}`;
    });
  }

  await check("users.getUser", async () => {
    const { user, relationships } = await guest.users.getUser(USER_ID);
    return `${user.nickname} followers=${String(user.followerCount)} isMe=${String(relationships.isMe)}`;
  });

  await check("users.getUserVideos", async () => {
    const result = await guest.users.getUserVideos(USER_ID, { pageSize: 3 });
    return `${result.totalCount} total, first=${result.items[0]?.id ?? "-"}`;
  });

  await check("users.getUserSeries", async () => {
    const result = await guest.users.getUserSeries(13647798, { pageSize: 1 });
    return `${result.totalCount} series`;
  });

  await check("users.getUserMylists", async () => {
    const result = await guest.users.getUserMylists(13647798);
    return `${result.mylists.length} mylists`;
  });

  await check("users.getUserFollowing", async () => {
    const result = await guest.users.getUserFollowing(USER_ID, { pageSize: 2 });
    return `${result.items.length} items, cursor=${result.summary.cursor ?? "-"}`;
  });

  await check("users.getUserFollowedBy", async () => {
    const result = await guest.users.getUserFollowedBy(USER_ID, { pageSize: 2 });
    return `followers=${String(result.summary.followers)}`;
  });

  await check("users.getCreatorSupport", async () => {
    const result = await guest.users.getCreatorSupport(USER_ID);
    return `supportable=${String(result.isSupportable)}`;
  });

  await check("accountPublic.getUsers", async () => {
    const users = await guest.accountPublic.getUsers([4, 2]);
    return users.map((user) => `${user.userId}:${user.nickname}`).join(" ");
  });

  await check("search.searchVideos", async () => {
    const result = await guest.search.searchVideos({ keyword: "初音ミク", pageSize: 3 });
    return `${result.totalCount} hits, ${result.additionalTags.length} suggested tags`;
  });

  await check("search.searchFacets", async () => {
    const result = await guest.search.searchFacets({ keyword: "初音ミク" });
    return `${result.items.length} genres`;
  });

  await check("search.searchUsers", async () => {
    const result = await guest.search.searchUsers({ keyword: "いわし", pageSize: 2 });
    return `${result.totalCount} users`;
  });

  await check("search.searchLists", async () => {
    const result = await guest.search.searchLists({ keyword: "初音ミク", pageSize: 2 });
    return `${result.totalCount} lists`;
  });

  await check("search.getNewArrivalVideos", async () => {
    const result = await guest.search.getNewArrivalVideos({ pageSize: 3, page: 1 });
    return `${result.items.length} items, createdAt=${result.createdAt ?? "-"}`;
  });

  await check("suggestion.expand", async () => {
    const candidates = await guest.suggestion.expand("初音");
    return candidates.slice(0, 3).join(", ");
  });

  await check("snapshot.search", async () => {
    const result = await guest.snapshot.search({
      q: "初音ミク",
      targets: ["title"],
      fields: ["contentId", "title", "tags"],
      sort: "viewCounter",
      limit: 2,
      context: "niconicojs-live-verify",
    });
    return `${result.meta.totalCount} hits, first=${result.data[0]?.contentId ?? "-"}`;
  });

  await check("ranking.getRanking", async () => {
    const result = await guest.ranking.getRanking({ term: "24h" });
    return `${result.label} items=${result.items.length} page=${String(result.pagination?.page)}`;
  });

  await check("ranking.getRankingGenres", async () => {
    const genres = await guest.ranking.getRankingGenres();
    return `${genres.length} genres, all=${RANKING_ALL_KEY}`;
  });

  await check("ranking.getTrendTags", async () => {
    const genres = await guest.ranking.getRankingGenres();
    const withTags = genres.find((genre) => genre.isEnabledTrendTag);
    if (withTags === undefined) return "no genre advertises trend tags";
    const tags = await guest.ranking.getTrendTags(withTags.featuredKey);
    return `${withTags.label}: ${tags.slice(0, 3).join(", ")}`;
  });

  await check("genres.getGenres", async () => {
    const genres = await guest.genres.getGenres();
    return `${genres.length} genres`;
  });

  await check("genres.getPopularTags", async () => {
    const result = await guest.genres.getPopularTags("game");
    return `${result.tags.length} tags`;
  });

  await check("videos.getVideos", async () => {
    const results = await guest.videos.getVideos([VIDEO_ID, TAGGED_VIDEO_ID]);
    return results.map((r) => `${r.watchId}=${r.video === null ? "null" : "ok"}`).join(" ");
  });

  await check("videos.getRecommendations", async () => {
    const result = await guest.videos.getRecommendations(VIDEO_ID);
    return `${result.items.length} items`;
  });

  await check("videos.getNicoAd", async () => {
    const ad = await guest.videos.getNicoAd(VIDEO_ID);
    return `totalPoint=${String(ad.totalPoint)}`;
  });

  await check("thumbInfo.getThumbInfo", async () => {
    const info = await guest.thumbInfo.getThumbInfo(TAGGED_VIDEO_ID);
    return `${info.title.trim()} ${info.durationSeconds}s tags=${info.tags.length}`;
  });

  await check("mylists.getMylist", async () => {
    const mylist = await guest.mylists.getMylist(PUBLIC_MYLIST_ID, { pageSize: 2 });
    return `${mylist.name} items=${mylist.totalItemCount}`;
  });

  await check("series.getSeries", async () => {
    const series = await guest.series.getSeries(PUBLIC_SERIES_ID, { pageSize: 2 });
    return `${series.detail.title} total=${series.totalCount}`;
  });

  const watch = await guest.watch.getGuestWatchData(VIDEO_ID, { noSideEffect: true }).catch(() => null);
  await check("watch.getGuestWatchData", async () => {
    if (watch === null) throw new Error("guest watch failed");
    return `${watch.data.video.title} tags=${watch.data.tag.items.length} domand=${String(watch.data.media.domand !== null)}`;
  });

  await check("comments.getThreadKey", async () => {
    const key = await guest.comments.getThreadKey(VIDEO_ID);
    return `${key.length} chars`;
  });

  await check("comments.fetchCommentsByVideoId", async () => {
    const threads = await guest.comments.fetchCommentsByVideoId(VIDEO_ID);
    return threads.map((thread) => `${thread.fork}:${thread.comments.length}`).join(" ");
  });

  await check("streaming.getHlsFromWatch + CDN fetch", async () => {
    if (watch === null) throw new Error("guest watch failed");
    const hls = await guest.streaming.getHlsFromWatch(watch);
    const response = await fetch(hls.contentUrl, { headers: domandRequestHeaders(hls) });
    const playlist = await response.text();
    if (!playlist.startsWith("#EXTM3U"))
      throw new Error(`playlist did not start with #EXTM3U (HTTP ${response.status})`);
    return `HTTP ${response.status}, ${playlist.split("\n").length} lines`;
  });

  if (SESSION === undefined) {
    for (const name of [
      "watch.getWatchData (v3)",
      "comments.fetchAllComments",
      "streaming.getStoryboardFromWatch",
      "mylists.getMyMylists",
      "mylists.getMyWatchLater",
      "history.getMyWatchHistory",
      "likes.getMyLikes",
      "feed.getActors",
      "feed.getFollowingsVideo",
    ]) {
      skip(name, "NICONICO_SESSION not set");
    }
  } else {
    const authed = await client.watch.getWatchData(VIDEO_ID, { noSideEffect: true }).catch(() => null);

    await check("watch.getWatchData (v3)", async () => {
      if (authed === null) throw new Error("session watch failed");
      return `viewer=${authed.data.viewer?.nickname ?? "-"}`;
    });

    await check("comments.fetchAllComments", async () => {
      if (authed?.data.comment.nvComment == null) throw new Error("no nvComment");
      const all = await client.comments.fetchAllComments(authed.data.comment.nvComment, { maxTotalCount: 1200 });
      return `${all.length} comments`;
    });

    await check("streaming.getStoryboardFromWatch", async () => {
      if (authed === null) throw new Error("session watch failed");
      const storyboard = await client.streaming.getStoryboardFromWatch(authed);
      return storyboard.contentUrl.slice(0, 60);
    });

    await check("mylists.getMyMylists", async () => {
      const result = await client.mylists.getMyMylists();
      return `${result.totalCount} mylists`;
    });

    await check("mylists.getMyWatchLater", async () => {
      const result = await client.mylists.getMyWatchLater({ pageSize: 2 });
      return `${result.totalCount} items`;
    });

    await check("history.getMyWatchHistory", async () => {
      const result = await client.history.getMyWatchHistory({ limit: 2 });
      return `${result.items.length} items`;
    });

    await check("likes.getMyLikes", async () => {
      const result = await client.likes.getMyLikes({ pageSize: 2 });
      return `${result.items.length} items`;
    });

    await check("feed.getActors", async () => {
      const actors = await client.feed.getActors({ limit: 10 });
      return `${actors.length} actors`;
    });

    await check("feed.getFollowingsVideo", async () => {
      const result = await client.feed.getFollowingsVideo({ limit: 5 });
      return `${result.activities.length} activities`;
    });
  }

  const width = Math.max(...rows.map((row) => row.name.length));
  const icon = { ok: "PASS", fail: "FAIL", skip: "SKIP" } as const;
  for (const row of rows) {
    console.log(`${icon[row.status]}  ${row.name.padEnd(width)}  ${row.detail}`);
  }

  const failed = rows.filter((row) => row.status === "fail").length;
  const passed = rows.filter((row) => row.status === "ok").length;
  const skipped = rows.filter((row) => row.status === "skip").length;
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

await main();
