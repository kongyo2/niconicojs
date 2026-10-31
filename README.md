# @kongyo2/niconicojs

[![npm version](https://img.shields.io/npm/v/@kongyo2/niconicojs)](https://www.npmjs.com/package/@kongyo2/niconicojs)
[![CI](https://github.com/kongyo2/niconicojs/actions/workflows/ci.yml/badge.svg)](https://github.com/kongyo2/niconicojs/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/@kongyo2/niconicojs)](#install)
[![license: MIT](https://img.shields.io/npm/l/@kongyo2/niconicojs)](./LICENSE)

Unofficial TypeScript client for the [niconico](https://www.nicovideo.jp) (nicovideo.jp) web APIs — videos, search, ranking, mylists, series, users, comments, and DMS/HLS streaming.

## Highlights

- **Typed end to end.** Every request parameter and response shape is a named TypeScript type; the whole surface is tree-shakeable ESM with a single runtime dependency (`fast-xml-parser`, for the legacy `getthumbinfo` XML).
- **Works as a guest.** Search, rankings, watch data, public lists, the initial comment payload, and HLS playback need no account. Pass a `user_session` cookie only for account-scoped reads and writes.
- **Follows the current web player.** The `nvapi` v4 watch flow the site itself uses — side-effect-free watch data, lazily loaded owner/series data, a pre-issued HLS session, and an explicit opt-in call for recording a view.
- **The full DMS (domand) flow.** Watch data → access rights → HLS playlist, including the `domand_bid` cookie and `actionTrackId` handling that the CDN actually enforces.
- **Async iterators everywhere.** Every list endpoint has an `iterate*` companion that absorbs page- or cursor-based pagination behind `for await`.
- **Resilient by default.** Transient failures (408/429/5xx, transport errors) retry with exponential backoff, jitter, and `Retry-After` support — while writes are never silently replayed.
- **Cancelable and pluggable.** Every call accepts an `AbortSignal`; the client accepts a custom `fetch`, extra headers, timeouts, and retry budgets.
- **Documented divergences.** Where the live service disagrees with the well-known unofficial docs, this library follows the service and [writes the finding down](#api-notes).

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [Authentication](#authentication)
- [Recipes](#recipes)
  - [Searching](#searching)
  - [Snapshot search API](#snapshot-search-api)
  - [Rankings](#rankings)
  - [Watch data (v4), lazy data, and side effects](#watch-data-v4-lazy-data-and-side-effects)
  - [Playing a video (DMS/HLS)](#playing-a-video-dmshls)
  - [Comments](#comments)
  - [Mylists and watch-later](#mylists-and-watch-later)
  - [NG comments, history, and the feed](#ng-comments-history-and-the-feed)
  - [Users](#users)
  - [Tags and legacy metadata](#tags-and-legacy-metadata)
  - [Paginating](#paginating)
  - [Cancellation, timeouts, custom fetch](#cancellation-timeouts-custom-fetch)
- [API surface](#api-surface)
- [Configuration](#configuration)
- [Error handling](#error-handling)
- [Retries and rate limiting](#retries-and-rate-limiting)
- [Using modules without the client](#using-modules-without-the-client)
- [Utility exports](#utility-exports)
- [API notes](#api-notes)
- [Development](#development)
- [Disclaimer](#disclaimer)
- [License](#license)

## Install

```bash
npm add @kongyo2/niconicojs
```

Requires **Node 20.3+** (`AbortSignal.any`, which composes the request timeout with a caller's signal, landed in 20.3.0; `fetch` and `Headers.getSetCookie` are also used).

The published types name the Web platform types this client exposes (`Response`, `AbortSignal`, `RequestInit`), so your TypeScript project needs them available: either `@types/node` (declared as an optional peer dependency) or `"lib": ["dom"]` for browser and bundler targets.

## Quick start

```ts
import { NiconicoClient } from "@kongyo2/niconicojs";

const nico = new NiconicoClient();

const { items, totalCount } = await nico.search.searchVideos({
  keyword: "初音ミク",
  pageSize: 10,
  sortKey: "viewCount",
  sortOrder: "desc",
});
console.log(totalCount, items[0]?.title);
```

## Authentication

### What needs a session

Guest access covers search, ranking, users, videos, public mylists and series by id, watch data, the initial comment payload and HLS playback. A `user_session` cookie is required for anything scoped to _your_ account — `getMyMylists`, `getMyMylist` (your own lists, private ones included), `getMyWatchLater`, `getMyWatchHistory`, `getMyLikes`, `getMyNgComments`, the follow feed — and for comment history (`fetchAllComments`), storyboards, and every write.

### Passing a session cookie

niconico's login moved to a single-page app behind a Cloudflare Turnstile challenge, so **there is no `login(email, password)`** — a headless client cannot produce a Turnstile token. Sign in once in a browser at [account.nicovideo.jp/login](https://account.nicovideo.jp/login?site=niconico), copy the `user_session` cookie for `.nicovideo.jp` from devtools, and pass it in:

```ts
const nico = new NiconicoClient({ session: process.env["NICONICO_SESSION"] });

const me = await nico.auth.verifySession();
console.log(`${me.nickname} (#${me.userId}) premium=${me.isPremium}`);
```

The `session` option accepts any of these, so a paste from devtools works as-is:

```
user_session_12345678_abcdef…
user_session=user_session_12345678_abcdef…
Cookie: nicosid=1.2; user_session=user_session_12345678_abcdef…
```

A non-empty value it cannot parse throws at construction rather than silently falling back to guest access. An **unset or blank** `session` — the usual result of an empty environment variable — is treated as deliberate guest mode instead, so call `verifySession()` at startup when your code requires authentication. Two more properties worth knowing:

- The client attaches the cookie only to requests bound for `*.nicovideo.jp` / `nico.ms` hosts, so it never sends it to another origin. A replacement `fetch` does receive those headers on niconico requests, though — treat a custom `fetch` as trusted code.
- Guest-scoped calls drop the cookie even on a logged-in client: `getGuestWatchData`, `getWatchV4(id, { asGuest: true })`, and the access-rights calls made from that guest data. A guest access key presented together with a session cookie is a `400 INVALID_PARAMETER`, so mixing them is never right.
- `verifySession()` distinguishes "no cookie configured" from "cookie rejected" (`NiconicoAuthError` either way); `isSessionValid()` is the boolean version for health checks.
- There is deliberately no `logout()`. Logging out (`DELETE api.id.nicovideo.jp/v1/sessions/me`) revokes the cookie everywhere, including the browser you copied it from.

> ⚠️ A `user_session` value is a live credential with full account access. Keep it in an environment variable or secret store, never in code.

## Recipes

### Searching

`nico.search` wraps the nvapi search used by the site itself: keyword or tag search with genre filters, sort keys (`viewCount`, `hot`, `personalized`, …), date and duration bounds, plus user search, mylist/series search, genre facets, and the new-arrivals feed. `nico.suggestion.expand("初音")` gives query completions.

```ts
const tagged = await nico.search.searchVideos({
  tag: "VOCALOID",
  genres: ["music_sound", "game"], // every genre applies — sent comma-joined
  minRegisteredAt: "2025-01-01T00:00:00+09:00",
  minDuration: 60,
  sortKey: "likeCount",
});

const shorts = await nico.search.searchVideos({ keyword: "初音ミク", selectContentType: "short" });
const facets = await nico.search.searchFacets({ keyword: "作業用BGM" });
const users = await nico.search.searchUsers({ keyword: "公式", sortKey: "followerCount" });
```

Search returns regular (`long`) videos unless you pass `selectContentType: "short"` for niconico's short-form videos (`ss…` ids); `users.getUserVideos` takes the same option plus a `keyword` that searches within one user's uploads.

### Snapshot search API

`nico.snapshot` wraps the [official snapshot search API v2](https://site.nicovideo.jp/search-api-docs/snapshot) — a different corpus with stable offsets, explicit field selection, and server-side filters:

```ts
const res = await nico.snapshot.search({
  q: "ゆっくり解説",
  targets: ["title", "tags"],
  fields: ["contentId", "title", "viewCounter", "startTime"],
  sort: "viewCounter",
  order: "desc",
  limit: 25,
  rangeFilters: [{ field: "startTime", gte: "2025-01-01T00:00:00+09:00" }],
});
console.log(res.meta.totalCount, res.data[0]?.title);
```

`SNAPSHOT_FIELDS`, `SNAPSHOT_TARGETS`, and `SNAPSHOT_SORTABLE` export the known values while still accepting future strings.

### Rankings

Rankings come from the ranking BFF keyed by opaque `featuredKey` strings (総合 is exported as `RANKING_ALL_KEY`); `getRankingGenres()` enumerates the current genres:

```ts
const ranking = await nico.ranking.getRanking({ term: "24h" });
console.log(ranking.label, ranking.items[0]?.title);

const genres = await nico.ranking.getRankingGenres();
const game = genres.find((genre) => genre.label === "ゲーム");
if (game !== undefined) {
  for await (const video of nico.ranking.iterateRanking({ featuredKey: game.featuredKey, maxItems: 300 })) {
    console.log(video.title);
  }
}
```

`term` is `"hour" | "24h" | "week" | "month" | "total"`; a `tag` narrows a genre ranking to one of its trend tags (`getTrendTags`).

### Watch data (v4), lazy data, and side effects

The web player fetches watch data from `POST nvapi.nicovideo.jp/v4/watch/{id}`, and `getWatchV4` does the same. The v4 response is split the way the page loads: the main call carries the video, tags, media, comment credentials, viewer and payment blocks; owner, series and the genre-ranking badge come from a second, lazy call:

```ts
const watch = await nico.watch.getWatchV4("sm41131114"); // guest unless the client has a session
console.log(watch.data.video.title, watch.data.okReason, watch.data.tags.items.length);

const lazy = await nico.watch.getWatchLazy(watch);
console.log(lazy.owner?.type, lazy.series?.title, lazy.series?.video.next?.id);
```

`watch/v3` and `watch/v3_guest` still answer and keep their methods, but the v3 payload no longer carries the series (`data.series` is always `null`) — read it from `getWatchLazy`.

Side effects are explicit in v4. Neither `getWatchV4` nor `getWatchLazy` touches the account: they do not add to the watch history or the view count (the lazy call sends `noSideEffect: true` unless you pass `false`). When you _want_ a view recorded — the web player does this when playback starts — call `recordView`:

```ts
await authed.watch.recordView(watch); // adds to the watch history and counts a view
```

`getWatchLazy` refetches the watch data once when the lazy key has expired (`KEY_EXPIRED`); an invalid key raises `WatchKeyRejectedError`. A `NiconicoApiError` from a refused video carries the service's `reasonCode` — `ADMINISTRATOR_DELETE_VIDEO` for a video deleted by the administrators, `NOT_FOUND` for an id that does not exist — so the reasons can be told apart instead of all reading `FORBIDDEN`.

### Playing a video (DMS/HLS)

The DMS (domand) flow needs three steps — watch data, access rights, playlist — and `getHlsFromWatch` does all of them. It accepts v3 (`getGuestWatchData` / `getWatchData`) or v4 (`getWatchV4`) watch data:

```ts
import { NiconicoClient, domandRequestHeaders } from "@kongyo2/niconicojs";

const nico = new NiconicoClient();
const watch = await nico.watch.getGuestWatchData("sm9");
const hls = await nico.streaming.getHlsFromWatch(watch);

// The CDN requires the domand_bid cookie issued with the access rights.
const playlist = await fetch(hls.contentUrl, { headers: domandRequestHeaders(hls) });
console.log(await playlist.text()); // #EXTM3U …
```

To pick quality yourself:

```ts
import { pickBestVideo, pickBestAudio, pickAudioForVideo } from "@kongyo2/niconicojs";

const domand = watch.data.media.domand;
if (domand?.accessRightKey != null) {
  const video = pickBestVideo(domand); // undefined on audio-only media
  const audio = video === undefined ? pickBestAudio(domand) : pickAudioForVideo(domand, video);
  if (audio === undefined) throw new Error("no playable stream");
  const hls = await nico.streaming.createHlsAccessRights({
    videoId: watch.data.video.id,
    accessRightKey: domand.accessRightKey,
    actionTrackId: watch.actionTrackId, // must match the watch call
    videoStreamId: video?.id,
    audioStreamId: audio.id, // audio-only sessions are valid; audio is always required
    anonymous: watch.guest, // guest data must go out without the session cookie
  });
}
```

> The `actionTrackId` is baked into `accessRightKey`. Reusing the one from the watch call is mandatory — a fresh one returns `400 INVALID_PARAMETER`. `WatchResult` and `WatchV4Result` carry it for exactly this reason, and they record whether the data is guest data so the access-rights call is sent without the session cookie when it has to be.

v4 watch data already contains an issued HLS session for the qualities the viewer may play, so playback can start without any further request:

```ts
const watch = await nico.watch.getWatchV4("sm9");
const hls = nico.streaming.getPreissuedHls(watch); // undefined when the media is not playable
if (hls !== undefined) {
  // The master and media playlists and the segments load without cookies, but the
  // AES-128 key URI answers 403 without the domand_bid cookie the watch call set.
  const playlist = await fetch(hls.contentUrl, { headers: domandRequestHeaders(hls) });
}
```

Watch endpoints accept a video id, a `watch/` URL, or a `nico.ms` short URL (`extractVideoId` handles all three), and `getBestWatchData` picks `v3` or `v3_guest` based on whether a session is configured. Storyboards (seek-bar thumbnails) follow the same pattern via `getStoryboardFromWatch(watch)`, but need a session. A video whose media the viewer cannot play (a member-only channel video, say) has `media: null` in v4 data with `okReason: "PAYMENT_PREVIEW_SUPPORTED"`, and the streaming calls raise `DomandUnavailableError` naming that reason.

### Comments

```ts
// One call — resolves the thread targets from (side-effect-free) v4 watch data internally.
const threads = await nico.comments.fetchCommentsByVideoId("sm9");
for (const thread of threads) {
  console.log(thread.fork, thread.comments.length);
}

// Full history (session required — see API notes).
const authed = new NiconicoClient({ session: process.env["NICONICO_SESSION"] });
const all = await authed.comments.fetchAllCommentsByVideoId("sm9", {
  maxTotalCount: 5000,
  onProgress: (n) => console.log(`${n} fetched`),
});
```

Thread keys live for roughly eight minutes, while a large archive takes much longer to walk at the polite request rate. `fetchAllCommentsByVideoId` therefore re-resolves the watch data for a fresh key whenever nvcomment answers `EXPIRED_TOKEN` and continues where it stopped (at most `MAX_THREAD_KEY_REFRESHES` times in a row). The lower-level `fetchAllComments(nvComment, options)` does the same when you pass `refreshThreadKey: () => Promise<string>`. `stopAtUnixSec` ends a thread once the walk reaches comments posted at or before that time, for incremental updates of an archive you already have.

Each `CommentThread` is tagged with its fork (`main`, `owner`, `easy`). `fetchCommentsByVideoId` and `fetchAllComments` skip the easy fork unless you pass `includeEasy: true`; the lower-level `fetchComments` requests exactly the targets in `nvComment.params.targets`, easy included — filter the targets yourself if you don't want it. `sortCommentsByVpos` orders items by playback position. Posting resolves the post key for you:

```ts
const main = watch.data.comment.nvComment!.params.targets.find((target) => target.fork === "main")!;
const posted = await authed.comments.postComment({
  threadId: main.id,
  videoId: watch.data.video.id,
  body: "うぽつです",
  vposMs: 12_000,
  commands: ["184"],
});
console.log(`no. ${posted.no}`);
```

All nvcomment traffic goes through a shared token bucket — 40 requests of burst, refilled at 0.25 requests a second, emptied when the server answers 429 — and `fetchAllComments` waits out a 429 instead of failing, so a long walk stays polite and survives the comment server's rate limit. See [Retries and rate limiting](#retries-and-rate-limiting).

### Mylists and watch-later

Public lists work as a guest; everything prefixed `My` and every write needs a session:

```ts
const mylist = await nico.mylists.getMylist(65776587);
console.log(mylist.name, mylist.totalItemCount);

const authed = new NiconicoClient({ session: process.env["NICONICO_SESSION"] });
const mylistId = await authed.mylists.createMylist({ name: "作業用BGM", isPublic: false });
await authed.mylists.addMylistItem(mylistId, "sm9", { description: "永遠の一位" });

const own = await authed.mylists.getMyMylist(mylistId); // private lists need this route
await authed.mylists.removeMylistItems(
  mylistId,
  own.items.map((item) => item.itemId),
);

const entry = await authed.mylists.addWatchLater("sm9", { memo: "あとで" });
await authed.mylists.removeWatchLater(["sm9"]); // watch ids or numeric itemIds
```

`getMylist` reads public lists only — the public route answers 403 for a private list even to its owner — so read your own lists with `getMyMylist` / `iterateMyMylistItems`, and list them with `getMyMylists` (paged, filterable by `title`) or the lightweight `getMyMylistsCompact`. Removal routes take `itemId`s, not watch ids: `removeMylistItems` expects them, and `removeWatchLater` resolves any watch id you pass through the watch-later listing first (and deletes nothing if one is not there). Adding a video that is already in watch-later is a `409 CONFLICT`. Watch-later entries carry their note as `memo`.

### NG comments, history, and the feed

The comment NG list the web player syncs to your account is `nico.ngComments`. Entries are typed `word`, `id` (a commenter's user id) or `command`:

```ts
const ng = await authed.ngComments.getMyNgComments();
await authed.ngComments.addNgComment({ type: "word", source: "ネタバレ" });
await authed.ngComments.removeNgComments([{ type: "word", source: "ネタバレ" }]);
```

Each call returns the updated list with its `revision`. When the list is full the server answers `409` with `errorCode: "MAX_SETTINGS"`.

`nico.history.removeMyWatchHistory(videoId)` deletes a video from the watch history and returns the removed entry ids. It removes **every** viewing of that video, on every date — there is no single-entry delete. `nico.feed.hasUnread()` reports whether the follow feed has unseen activity.

### Users

```ts
const { user, relationships } = await nico.users.getUser(4);
console.log(user.nickname, user.followerCount, relationships.sessionUser?.isFollowing);

for await (const video of nico.users.iterateUserVideos(4)) {
  console.log(video.id, video.title);
}
```

`"me"` works as a user id anywhere a session is configured (`getUser("me")`, `getUserVideos("me")`, …). Follower/followee listings, creator-support status, and `nico.accountPublic` profile lookups round out the surface.

### Tags and legacy metadata

Watch data carries the tags with their lock state, for guests too (`data.tags.items` in v4, `data.tag.items` in v3). The legacy XML endpoint returns tags, lock and category flags, counters and the uploader in one lightweight request without a watch call:

```ts
const info = await nico.thumbInfo.getThumbInfo("sm500873");
console.log(info.tags.map((tag) => (tag.lock ? `🔒${tag.tag}` : tag.tag)));
```

`tryGetThumbInfo` returns `null` instead of throwing for deleted or hidden videos.

### Paginating

Every list endpoint has an async iterator that handles paging (page-based or cursor-based, whichever the endpoint uses):

```ts
for await (const video of nico.search.iterateVideos({ keyword: "VOCALOID", maxItems: 500 })) {
  console.log(video.id, video.title);
}

for await (const item of nico.mylists.iterateMylistItems(65776587)) {
  console.log(item.watchId);
}

for await (const entry of nico.history.iterateMyWatchHistory()) {
  console.log(entry.viewedAt, entry.video.title);
}
```

The full set: `search.iterateVideos`, `snapshot.iterate`, `ranking.iterateRanking`, `mylists.iterateMylistItems`, `series.iterateSeriesItems`, `users.iterateUserVideos` / `iterateUserFollowing` / `iterateUserFollowedBy`, `history.iterateMyWatchHistory`, and `feed.iterateFollowingsVideo`. The three unbounded corpora — `search.iterateVideos`, `snapshot.iterate`, and `ranking.iterateRanking` — accept `maxItems`; the rest run to the natural end of the listing. Every iterator stops cleanly on `break`, which is how you cap the others.

### Cancellation, timeouts, custom fetch

Every method accepts an `AbortSignal`, composed with the per-request timeout via `AbortSignal.any`:

```ts
const controller = new AbortController();
const pending = nico.search.searchVideos({ keyword: "耐久", signal: controller.signal });
controller.abort();
```

The HTTP layer itself is configurable — see [Configuration](#configuration):

```ts
const nico = new NiconicoClient({
  timeoutMs: 10_000,
  retryAttempts: 5,
  headers: { "Accept-Language": "ja" },
  fetch: (url, init) => myInstrumentedFetch(url, init),
});
```

## API surface

| Accessor | Covers |
| --- | --- |
| `nico.auth` | Session verification (`verifySession`, `isSessionValid`) |
| `nico.accountPublic` | `account.nicovideo.jp` public profiles and the session account |
| `nico.users` | Profiles, uploaded videos, series, mylists, followers/followees, creator support |
| `nico.search` | Video/user/list search, genre facets, new arrivals |
| `nico.snapshot` | Official snapshot search API v2 (tags, filters, stable offsets) |
| `nico.suggestion` | Query completion |
| `nico.ranking` | Genre rankings, trend tags, the news and for-you blocks |
| `nico.genres` | Genre keys and per-genre popular tags |
| `nico.mylists` | Public mylists, the session user's lists (private included) and watch-later, plus writes |
| `nico.series` | Series metadata and ordered contents |
| `nico.videos` | Video lookup, watch-page recommendations, nicoad totals |
| `nico.watch` | `nvapi` v4 watch data, lazy data and view recording; `watch/v3` and `watch/v3_guest` |
| `nico.comments` | Thread keys, comment fetch, full history (with key refresh and rate-limit recovery), posting |
| `nico.streaming` | DMS HLS access rights, the pre-issued v4 HLS session, storyboards |
| `nico.thumbInfo` | Legacy `getthumbinfo` XML (tags, counters and uploader without a watch call) |
| `nico.feed` | Follow-feed actors, upload activity, unread flag |
| `nico.history` | Watch history, removal |
| `nico.likes` | Liked videos, like/unlike |
| `nico.ngComments` | The account's server-side comment NG list |
| `nico.http` | The raw HTTP layer, for endpoints this library does not wrap |

<details>
<summary><strong>Full method listing</strong></summary>

```ts
nico.auth.isLoggedIn(); nico.auth.verifySession(); nico.auth.isSessionValid();

nico.accountPublic.getUsers(userIds); nico.accountPublic.getMe();

nico.users.getUser(userId); nico.users.getUserVideos(userId, params?); // params: selectContentType, keyword, …
nico.users.getUserSeries(userId, params?); nico.users.getUserMylists(userId, params?);
nico.users.getUserFollowing(userId, params); nico.users.getUserFollowedBy(userId, params);
nico.users.getCreatorSupport(userId);
nico.users.iterateUserVideos(userId, params?);
nico.users.iterateUserFollowing(userId, params?); nico.users.iterateUserFollowedBy(userId, params?);

nico.search.searchVideos(params); nico.search.searchFacets(params);
nico.search.searchUsers(params); nico.search.searchLists(params);
nico.search.getNewArrivalVideos(params); nico.search.iterateVideos(params?);

nico.snapshot.search(params); nico.snapshot.iterate(params);

nico.suggestion.expand(query);

nico.ranking.getRanking(params?); nico.ranking.getRankingGenres();
nico.ranking.getTrendTags(featuredKey); nico.ranking.iterateRanking(params?);

nico.genres.getGenres(); nico.genres.getPopularTags(genreKey);

nico.mylists.getMylist(mylistId, params?); nico.mylists.iterateMylistItems(mylistId, params?);
nico.mylists.getMyMylist(mylistId, params?); nico.mylists.iterateMyMylistItems(mylistId, params?);
nico.mylists.getMyMylists(params?); nico.mylists.getMyMylistsCompact(); nico.mylists.getMyWatchLater(params?);
nico.mylists.createMylist(params); nico.mylists.updateMylist(params); nico.mylists.deleteMylist(mylistId);
nico.mylists.addMylistItem(mylistId, watchId, params?); nico.mylists.removeMylistItems(mylistId, itemIds);
nico.mylists.addWatchLater(watchId, { memo }?); nico.mylists.removeWatchLater(watchIdsOrItemIds);

nico.series.getSeries(seriesId, params?); nico.series.getSeriesV1(seriesId, params?);
nico.series.iterateSeriesItems(seriesId, params?);

nico.videos.getVideo(watchId); nico.videos.getVideos(watchIds, options?);
nico.videos.getRecommendations(videoId, { limit, sensitiveContents }?); nico.videos.getNicoAd(videoId);

nico.watch.getWatchV4(videoId, { asGuest, actionTrackId }?);
nico.watch.getWatchLazy(watch, options?); nico.watch.getWatchLazyWithKey(videoId, params);
nico.watch.recordView(watch, options?);
nico.watch.getGuestWatchData(videoId, params?); nico.watch.getWatchData(videoId, params?);
nico.watch.getBestWatchData(videoId, params?);

nico.comments.fetchCommentsByVideoId(videoId, options?); nico.comments.fetchComments(nvComment, options?);
nico.comments.fetchCommentsWithKey(threadKey, targets, options?); nico.comments.getThreadKey(videoId);
nico.comments.fetchAllComments(nvComment, options?); nico.comments.fetchAllCommentsByVideoId(videoId, options?);
nico.comments.postComment(params); nico.comments.getPostKey(threadId);

nico.streaming.getHlsFromWatch(watch, options?); nico.streaming.createHlsAccessRights(params);
nico.streaming.getPreissuedHls(watchV4);
nico.streaming.getStoryboardFromWatch(watch, options?); nico.streaming.createStoryboardAccessRights(params);

nico.thumbInfo.getThumbInfo(videoId); nico.thumbInfo.tryGetThumbInfo(videoId);

nico.feed.getActors(params?); nico.feed.getFollowingsVideo(params?); nico.feed.iterateFollowingsVideo(params?);
nico.feed.hasUnread();

nico.history.getMyWatchHistory(params?); nico.history.iterateMyWatchHistory(params?);
nico.history.removeMyWatchHistory(videoId);

nico.likes.getMyLikes(params?); nico.likes.like(videoId); nico.likes.unlike(videoId);

nico.ngComments.getMyNgComments(); nico.ngComments.addNgComment(target);
nico.ngComments.removeNgComments(targets);

nico.http.getJson(url, options?); nico.http.postJson(url, body, options?);
nico.http.sendJson(url, method, body, options?); nico.http.sendForm(url, method, form, options?);
nico.http.getText(url, options?);
```

</details>

Each module is also exported standalone (`createSearchApi(http)`, …) if you want one surface without the client — see [Using modules without the client](#using-modules-without-the-client).

## Configuration

`new NiconicoClient(options)` accepts everything `NiconicoHttpOptions` does, plus `session`:

| Option | Default | Description |
| --- | --- | --- |
| `session` | — | `user_session` cookie value, `user_session=…` pair, or a full `Cookie:` header |
| `frontendId` | `6` | `X-Frontend-Id` header (6 = PC web) |
| `frontendVersion` | `"0"` | `X-Frontend-Version` header |
| `userAgent` | desktop Chrome UA | `User-Agent` for every request |
| `timeoutMs` | `30000` | Per-attempt timeout; raises `NiconicoTimeoutError` |
| `retryAttempts` | `3` | Max attempts for idempotent requests |
| `retryBaseDelayMs` | `500` | Backoff base — doubles per attempt, capped at 8 s, with jitter |
| `headers` | `{}` | Extra headers merged into every request |
| `fetch` | `globalThis.fetch` | Replacement `fetch` for proxies, logging, or tests |
| `commentThrottle` | shared `commentThrottle` | The `RequestThrottle` nvcomment traffic goes through; pass your own `TokenBucket` to tune or isolate it |

Per-request, most methods thread through `RequestOptions` (a few with specialized option bags — `fetchAllComments`, the watch v4 calls, `getHlsFromWatch` / `getStoryboardFromWatch`, and the access-rights calls — accept `signal` but not the rest):

| Option | Description |
| --- | --- |
| `signal` | `AbortSignal`, composed with the timeout via `AbortSignal.any` |
| `headers` | Extra headers for this request only |
| `validateMeta` | Set `false` to skip nvapi `meta.status` validation |
| `throttle` | Route through a `RequestThrottle` (acquired per attempt; a 429 penalizes it and is returned instead of retried) |
| `rateLimitMs` | Route through the legacy fixed-interval limiter with this interval |
| `anonymous` | Send this request without the session cookie |
| `idempotent` | Mark a write as safely retryable (opts into the retry budget) |

## Error handling

```ts
import { isNiconicoApiError } from "@kongyo2/niconicojs";

try {
  await nico.likes.like("sm9");
} catch (error) {
  if (isNiconicoApiError(error)) {
    if (error.isAbuseBlocked()) {
      // 403 / errorDetail AB001 — see "API notes" below.
    }
    console.error(error.status, error.errorCode, error.url);
  }
}
```

Every error the library itself raises extends `NiconicoError`, so one `instanceof` (or `isNiconicoError`) catches them all. The one deliberate exception is cancellation you asked for: when a caller's `AbortSignal` fires, the promise rejects with that signal's own reason — typically a `DOMException` named `AbortError` — so an abort is never disguised as a network failure. Branch on `error.name === "AbortError"` (or check your signal) for that case.

| Error | Raised when |
| --- | --- |
| `NiconicoApiError` | Non-2xx, or HTTP 200 with a failing `meta.status` — carries `status`, `errorCode`, `errorMessage`, `errorDetail`, `reasonCode`, `url` |
| `NiconicoNetworkError` | Transport failure after the retry budget is spent |
| `NiconicoTimeoutError` | The request exceeded `timeoutMs` |
| `NiconicoAuthError` | A session is missing or was rejected |
| `ThreadKeyRejectedError` | nvcomment rejected a thread key (expired, or guest-issued) |
| `WatchKeyRejectedError` | The v4 lazy call rejected its key (`INVALID_KEY`, or `KEY_EXPIRED` after the automatic refetch) |
| `ThumbInfoError` | `getthumbinfo` reported `status="fail"` — carries the failure `code` |
| `DomandUnavailableError` | No playable DMS media for the video |

`NiconicoApiError.isAbuseBlocked()`, `.isUnauthorized()`, `.isRateLimited()` (429) and `.isMaintenance()` (`errorCode: "MAINTENANCE"`, which NNDD-RE observed nvapi sending with a 503 during maintenance) name the conditions worth branching on. A 5xx or 429 that exhausts the retry budget keeps the `errorCode` of the last response, so maintenance stays recognizable. `reasonCode` comes from the body's `data.reasonCode` and says why a video was refused — `ADMINISTRATOR_DELETE_VIDEO`, `NOT_FOUND`, and so on.

## Retries and rate limiting

- Transient failures (408, 429, 5xx, transport errors) are retried with exponential backoff and `Retry-After` support.
- **Writes are never retried** unless explicitly marked `idempotent`, so a `POST` is never silently replayed. The v4 watch call and a lazy call with `noSideEffect` are idempotent and retry; `recordView` never does.
- Comment fetches and posts share a process-wide token bucket (`commentThrottle`: `COMMENT_BURST_LIMIT` = 40 requests of burst, refilled at `COMMENT_REFILL_PER_SECOND` = 0.25 per second), even across client instances. That keeps any three-minute window under the ~100-request burst NNDD-RE saw the comment server answer with `429 TOO_MANY_REQUESTS`; the server's actual rule is unpublished and not a plain count (see [API notes](#api-notes)).
- A throttled request that still gets a 429 empties the bucket and returns the error instead of retrying into the limit. `fetchAllComments` then waits `rateLimitWaitMs` (default `RATE_LIMIT_WAIT_MS`, 60 s) and resumes from the same page, up to `maxRateLimitWaits` (default 5) times, reporting each wait through `onRateLimited` — so a long archive walk survives the limit instead of throwing away what it already fetched.
- `getVideos` fans out one request per id (the endpoint ignores extra ids — see [API notes](#api-notes)) with bounded concurrency.

## Using modules without the client

Almost every accessor is a standalone factory over a shared HTTP layer, so you can pull in exactly one surface:

```ts
import { NiconicoHttp, createSearchApi } from "@kongyo2/niconicojs";

const http = new NiconicoHttp({ timeoutMs: 10_000 });
const search = createSearchApi(http);
const result = await search.searchVideos({ keyword: "初音ミク" });
```

Two factories take a collaborator beyond `http`: `createAuthApi(http, accountPublic)` verifies sessions through the account API, and `createCommentsApi(http, resolveWatchThreads)` needs a `WatchThreadResolver` (video id → `NvCommentParams`, usually backed by a watch call) for its by-video-id convenience method. `NiconicoClient` wires both for you.

And for endpoints the library does not wrap, `nico.http` speaks nvapi natively — correct headers, session cookie, retries, and `meta.status` validation included:

```ts
const res = await nico.http.getJson<{ data: unknown }>("https://nvapi.nicovideo.jp/v1/…");
```

## Utility exports

| Export | Purpose |
| --- | --- |
| `extractVideoId(input)` | Video id from an id, `watch/` URL, or `nico.ms` URL |
| `isVideoId(value)` | `sm9`-style / numeric id check |
| `generateActionTrackId()` | Fresh `actionTrackId` in the format the watch API expects |
| `extractUserSession(input)` | Pull a `user_session` value out of a cookie header or pair |
| `pickBestVideo(media)` / `pickBestAudio(media)` | Highest available quality stream (v3 `media.domand` or v4 `media.contents`) |
| `pickAudioForVideo(media, video)` | Best audio within the video's recommended cap, when it has one |
| `isWatchV4Result(watch)` | Tell `getWatchV4` results from v3 ones |
| `domandRequestHeaders(hls)` / `domandCookieHeader(hls)` | Headers/cookie the DMS CDN requires |
| `TokenBucket` | The throttle class behind `commentThrottle`, for your own pacing |
| `sortCommentsByVpos(comments)` | Order comments by playback position |
| `normalizeFork(fork)` / `threadsToTargets(threads)` | Comment-fork plumbing |
| `parseThumbInfoXml(xml)` / `parseThumbLength(value)` | Standalone `getthumbinfo` parsing |
| `buildQuery(params)` | Query-string builder with array/`undefined` handling |
| `readSetCookies(response)` / `readCookieValue(response, name)` | `Set-Cookie` helpers that work without `getSetCookie` |

Constants: `NICOVIDEO_ORIGIN`, `RANKING_ALL_KEY` (総合), `FEED_MAX_LIMIT` (50), `COMMENT_BURST_LIMIT` (40), `COMMENT_REFILL_PER_SECOND` (0.25), `RATE_LIMIT_WAIT_MS` (60000), `MAX_RATE_LIMIT_WAITS` (5), `MAX_THREAD_KEY_REFRESHES` (3), `COMMENT_RATE_LIMIT_MS` (334, the legacy fixed interval), `SESSION_COOKIE_NAME`, `LOGIN_PAGE_URL`, and the `SNAPSHOT_*` field lists.

## API notes

### 2026-10-31: the v4 watch flow, and what changed since

Found by probing with a real session and by reading the request definitions in the current web player's bundles, cross-checked against [NNDD-RE](https://github.com/NNDD-Rebuild/NNDD-RE). The routes below are exercised by the live suite (the writes by its opt-in `NICONICO_LIVE_WRITES=1` part), except the two paragraphs credited to NNDD-RE.

**The watch page moved to nvapi v4.** The page embeds a `$watchV4` payload and the player calls `POST nvapi.nicovideo.jp/v4/watch/{id}` with `{ actionTrackId }` (plus `asGuest: true` for a guest). `X-Request-With` and the `X-Frontend-*` headers are required — without them the route answers `400 INVALID_PARAMETER`. The response carries `media.contents` (the stream list, replacing v3's `media.domand`), `media.accessRightKey`, `video.permission`, `tags`, a `payment` block, and `lazy.authKey`, but no owner, series or ranking badge: those come from `POST /v4/watch/lazy/{id}` with `{ actionTrackId, keyToken, noSideEffect }`, whose key expires after a few minutes (`400 KEY_EXPIRED`; a forged key is `400 INVALID_KEY`).

**Side effects are a separate, explicit call.** A bare v4 watch call adds nothing to the watch history, even after waiting. The player records the view with `POST /v4/watch/{id}/side-effect` when playback starts. The lazy call **does** record the view unless the body says `noSideEffect: true`, which is why `getWatchLazy` sends it by default.

**v3 lost the series.** `watch/v3` and `watch/v3_guest` still answer, but `data.series` is `null` even for a video in a series; the series is in the lazy payload.

**v4 pre-issues the HLS session.** `media.hls.url` is a signed master playlist listing every quality the viewer may play, and the v4 response sets a `domand_bid` cookie. The master, media playlists and segments load without any cookie; the AES-128 key URI answers `403` without `domand_bid` and returns the 16-byte key with it. Asking `access-rights/hls` for a specific pair (or for every pair, as the player does when nothing was pre-issued) still works with the v4 `accessRightKey`.

**Guest keys and session cookies do not mix.** An `accessRightKey` from guest watch data (v3_guest, or v4 as a guest), presented with a `user_session` cookie, is `400 INVALID_PARAMETER` — and so is a different `actionTrackId`. Earlier versions of this library attached the cookie whenever the client had a session, so `getGuestWatchData` + `getHlsFromWatch` failed on a logged-in client. Guest data now carries `guest: true` and its follow-up calls go out without the cookie.

**Refusals say why.** A deleted video answers `403 FORBIDDEN` (v4) / `400 FORBIDDEN` (v3) with `data.reasonCode` — `ADMINISTRATOR_DELETE_VIDEO` for `sm1` — and a missing one `404` with `reasonCode: "NOT_FOUND"`. A member-only channel video answers `200` with `media: null` and `okReason: "PAYMENT_PREVIEW_SUPPORTED"`.

**nvcomment answers 429 under load.** `public.nvcomment.nicovideo.jp/v1/threads` can answer `429` with `meta.errorCode: "TOO_MANY_REQUESTS"`, and the block lifts by itself after a short while. NNDD-RE measured it after a burst of about 100 requests, clearing in about three minutes. Here, a walk at a 60-request burst plus 0.4 requests a second (NNDD-RE's setting) hit it at its 72nd request, about twenty requests after the live suite had run, and the block had lifted when re-checked a few minutes later. The trigger is not a plain request count, though: a later walk sent 111 requests in 10 seconds without a 429. With this library's defaults (40 burst, 0.25 a second) a 60,000-comment walk of `sm9` — 121 requests over 5.4 minutes — finished without one, and `fetchAllComments` waits out a 429 and resumes instead of discarding what it fetched. A page of comment history holds 500 comments.

**Watch-later deletes by `itemIds`.** `DELETE /v1/users/me/watch-later?watchIds=…` is `400 INVALID_PARAMETER`; the route takes the entries' `itemIds`, comma-joined. Adding uses a form body `{ watchId, memo }` and answers `409 CONFLICT` for a video that is already there. Entries carry `memo`, not `description`.

**Repeated query keys keep only one value on several routes.** `itemIds=a&itemIds=b` on the mylist-item `DELETE` removed one item; `itemIds=a,b` removed both. `genres=game&genres=music_sound` on `/v2/search/video` searched `music_sound` only; `genres=game,music_sound` searched both. `/v1/videos` still honours one id only — comma-joined ids are a `400`, repeated ones keep the last.

**Your own private mylist is not public.** `/v2/mylists/{id}` answers `403` for a private mylist even to its owner with a session; `/v1/users/me/mylists/{id}` serves it. `/v1/users/me/mylists` now takes `page`, `pageSize` and `title`, and `/v1/users/me/mylists/compact` lists id, name, description and visibility only.

**The comment NG list lives on nvapi.** `GET /v1/users/me/ng-comments/client` returns `{ revision, count, items }`; adding is a form `POST` (`type` of `word` / `id` / `command`, `source`) and removing a JSON `DELETE` on `/items` with `{ targets }`, both sent by the player with `X-Request-With: nicovideo`. Each answers with the updated list.

**History deletion is per video.** `DELETE /v2/users/me/watch/history?target={videoId}` returns `deletedItemIds` such as `h#20261031#sm9`, and removes the video's entries for every date.

**Search grew filters.** `selectContentType=short` searches short videos (`ss…` ids; the default is `long` only), `minDuration` complements `maxDuration`, and `/v3/users/{id}/videos` accepts `selectContentType` and a `q` keyword.

**Listing items carry obfuscated flags.** Search, ranking and recommendation items include boolean keys such as `acf68865`, which NNDD-RE found to match `payment.video.isPremium` (premium-only videos). The names are not a contract and may change, so the library passes them through untyped (`EssentialVideo` keeps unknown keys) rather than modelling them.

**Writes work end to end.** Mylist create/update/delete, item add/remove, watch-later add/remove, NG add/remove, recording and deleting a history entry all succeeded from this environment. The `AB001` block described below was specific to the earlier verification environment's IP and account standing.

**Logout moved** (per NNDD-RE). `secure.nicovideo.jp` is gone; logging out is `DELETE api.id.nicovideo.jp/v1/sessions/me` (account frontend id 8). The library does not wrap it, because it would revoke the cookie the caller supplied.

### 2026-09-08

Findings from live probing (2026-09-08). These are the places where the service diverges from the [niconicolibs unofficial docs](https://github.com/niconicolibs/api). The behaviors the library relies on day to day — the ranking BFF, per-id video lookup, comment-history and storyboard gating — are exercised by the live test suite; the one-shot probe results (the login flow, retired endpoints, the write block) are recorded here as of that date and are not re-verified on every run.

**Login is Turnstile-gated.** `POST account.nicovideo.jp/api/v1/login` returns 404; `/login` redirects to `/spa/login/index.html`, which posts to `api.id.nicovideo.jp` behind Cloudflare Turnstile. Password login is not possible headlessly.

**`relationships` sits beside `user`, not inside it.** `/v1/users/{id}` returns `data.relationships`, while the published examples nest it under `data.user`. Reading the documented path reports "not following" for everyone.

**`/v1/videos` honours only the last `watchIds`.** Passing three ids returns one video. `getVideos` therefore issues one request per id with bounded concurrency and reassembles them in argument order.

**The nvapi ranking endpoints are gone.** `/v1/ranking/hot-topic` is 404 and `/v1/ranking/genre/{key}` is 400 for every key, old or new. Rankings now come from the `www.nicovideo.jp/ranking/genre/{featuredKey}?responseType=json` BFF, keyed by opaque strings (総合 is `e9uj2uks`). `getRankingGenres()` enumerates the current 23.

**`/v1/videos/{id}/tags` is retired** (404). Tags come from watch data (`data.tag.items`) or `getthumbinfo`.

**Comment history needs a session.** A guest thread key is accepted for the initial payload but rejected with `400 INVALID_TOKEN` as soon as `additionals.when` is sent — from both key sources. `res_from: -1000` also over-asks: the server caps a page at 500.

**`/v1/ranking/hot-topic` is still 404** as of 2026-10-31.

**Storyboards need a session.** Guest watch data reports `isStoryboardAvailable: false`, and the route then answers 400. `getStoryboardFromWatch` checks the flag first.

**`api.feed.nicovideo.jp` requires `limit`, capped at 50.** Omitting it or asking for 51 is a flat 400. This host also uses a `{code, message}` envelope rather than nvapi's `meta`.

**`public.api.nicovideo.jp` no longer resolves.** The account endpoints live on `account.nicovideo.jp/api/public`. `userIds` must be repeated, not comma-joined.

**Write endpoints exist but are abuse-blocked.** Every authenticated write — like/unlike, watch-later, mylist create/update/delete, mylist items, comment post keys — answered `403 FORBIDDEN` with `data.errorDetail: "AB001"` from the verification environment, while reads on the same session succeeded throughout. Route existence was confirmed by method probing (403 for a real route vs 404 for a wrong one), so the paths are right, but they could not be executed end-to-end. This block is tied to the caller's IP reputation and account standing rather than to request shape — no header combination avoided it. `NiconicoApiError.isAbuseBlocked()` identifies it.

## Development

```bash
git clone https://github.com/kongyo2/niconicojs.git
cd niconicojs
npm ci
npm run check   # typecheck (src + tests) + lint + format check + unit tests + build
```

Unit tests run against a stubbed `fetch` and never touch the network. The live suite is opt-in:

```bash
cp .env.example .env   # add NICONICO_SESSION for authenticated coverage
NICONICO_LIVE=1 npm test      # runs test/live.test.ts against the real service
NICONICO_LIVE=1 NICONICO_LIVE_WRITES=1 npm test   # also the reversible write round trips
npm run verify:live           # one-shot probe of every endpoint, prints a status table
```

The live suite only reads, and its watch calls are side-effect free. The write tests are opt-in and clean up after themselves: they create and delete a private mylist, add and remove a watch-later entry and an NG word, and — only when the history does not already hold the test video — record one view and delete it again.

Useful scripts: `lint` / `lint:types` (oxlint, including type-aware rules), `format`, `test:watch`, and `verify:package` (publish-shape checks via attw + publint). CI runs `npm run check`, `lint:types`, and a comment-policy check on every push; the live job only runs on manual dispatch so pull requests never depend on nicovideo.jp.

## Disclaimer

This is an unofficial library, not affiliated with or endorsed by Dwango / niconico. It talks to endpoints the official web frontend uses; they can change or disappear without notice (see [API notes](#api-notes) for ones that already have). Use it responsibly: keep request rates modest, respect the [niconico terms of service](https://account.nicovideo.jp/rules/account), and treat your `user_session` cookie as a secret.

## License

[MIT](./LICENSE)
