# @kongyo2/niconicojs

[![npm version](https://img.shields.io/npm/v/@kongyo2/niconicojs)](https://www.npmjs.com/package/@kongyo2/niconicojs)
[![CI](https://github.com/kongyo2/niconicojs/actions/workflows/ci.yml/badge.svg)](https://github.com/kongyo2/niconicojs/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/@kongyo2/niconicojs)](#install)
[![license: MIT](https://img.shields.io/npm/l/@kongyo2/niconicojs)](./LICENSE)

Unofficial TypeScript client for the [niconico](https://www.nicovideo.jp) (nicovideo.jp) web APIs — videos, search, ranking, mylists, series, users, comments, and DMS/HLS streaming.

## Highlights

- **Typed end to end.** Every request parameter and response shape is a named TypeScript type; the whole surface is tree-shakeable ESM with a single runtime dependency (`fast-xml-parser`, for the legacy `getthumbinfo` XML).
- **Works as a guest.** Search, rankings, watch data, public lists, the initial comment payload, and HLS playback need no account. Pass a `user_session` cookie only for account-scoped reads and writes.
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
  - [Playing a video (DMS/HLS)](#playing-a-video-dmshls)
  - [Comments](#comments)
  - [Mylists and watch-later](#mylists-and-watch-later)
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

Guest access covers search, ranking, users, videos, mylists and series by id, watch data, the initial comment payload and HLS playback. A `user_session` cookie is required for anything scoped to _your_ account — `getMyMylists`, `getMyWatchLater`, `getMyWatchHistory`, `getMyLikes`, the follow feed — and for comment history (`fetchAllComments`), storyboards, and every write.

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
- `verifySession()` distinguishes "no cookie configured" from "cookie rejected" (`NiconicoAuthError` either way); `isSessionValid()` is the boolean version for health checks.

> ⚠️ A `user_session` value is a live credential with full account access. Keep it in an environment variable or secret store, never in code.

## Recipes

### Searching

`nico.search` wraps the nvapi search used by the site itself: keyword or tag search with genre filters, sort keys (`viewCount`, `hot`, `personalized`, …), date and duration bounds, plus user search, mylist/series search, genre facets, and the new-arrivals feed. `nico.suggestion.expand("初音")` gives query completions.

```ts
const tagged = await nico.search.searchVideos({
  tag: "VOCALOID",
  genres: ["music_sound"],
  minRegisteredAt: "2025-01-01T00:00:00+09:00",
  sortKey: "likeCount",
});

const facets = await nico.search.searchFacets({ keyword: "作業用BGM" });
const users = await nico.search.searchUsers({ keyword: "公式", sortKey: "followerCount" });
```

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

### Playing a video (DMS/HLS)

The DMS (domand) flow needs three steps — watch data, access rights, playlist — and `getHlsFromWatch` does all of them:

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
  });
}
```

> The `actionTrackId` is baked into `accessRightKey`. Reusing the one from the watch call is mandatory — a fresh one returns `400 INVALID_PARAMETER`. `WatchResult` carries it for exactly this reason.

Watch endpoints accept a video id, a `watch/` URL, or a `nico.ms` short URL (`extractVideoId` handles all three), and `getBestWatchData` picks `v3` or `v3_guest` based on whether a session is configured. Storyboards (seek-bar thumbnails) follow the same pattern via `getStoryboardFromWatch(watch)`, but need a session.

### Comments

```ts
// One call — resolves the thread targets from watch data internally.
const threads = await nico.comments.fetchCommentsByVideoId("sm9");
for (const thread of threads) {
  console.log(thread.fork, thread.comments.length);
}

// Full history (session required — see API notes).
const authed = new NiconicoClient({ session: process.env["NICONICO_SESSION"] });
const watch = await authed.watch.getWatchData("sm9");
const all = await authed.comments.fetchAllComments(watch.data.comment.nvComment!, {
  maxTotalCount: 5000,
  onProgress: (n) => console.log(`${n} fetched`),
});
```

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

All nvcomment traffic goes through a shared rate limiter (≥334 ms between calls) so bulk fetches stay polite.

### Mylists and watch-later

Public lists work as a guest; everything prefixed `My` and every write needs a session:

```ts
const mylist = await nico.mylists.getMylist(65776587);
console.log(mylist.name, mylist.totalItemCount);

const authed = new NiconicoClient({ session: process.env["NICONICO_SESSION"] });
const mylistId = await authed.mylists.createMylist({ name: "作業用BGM", isPublic: false });
await authed.mylists.addMylistItem(mylistId, "sm9", { description: "永遠の一位" });
await authed.mylists.addWatchLater("sm9");
```

See the [write-endpoint caveat](#api-notes) — the routes are correct, but niconico's abuse filter may refuse writes depending on IP and account standing.

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

Watch data carries tags (`data.tag.items`), but the only guest source that includes lock state is the legacy XML endpoint:

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
| `nico.mylists` | Public mylists, the session user's lists and watch-later, plus writes |
| `nico.series` | Series metadata and ordered contents |
| `nico.videos` | Video lookup, watch-page recommendations, nicoad totals |
| `nico.watch` | `watch/v3` and `watch/v3_guest` |
| `nico.comments` | Thread keys, comment fetch, full history, posting |
| `nico.streaming` | DMS HLS access rights and storyboards |
| `nico.thumbInfo` | Legacy `getthumbinfo` XML (the only guest source of tags) |
| `nico.feed` | Follow-feed actors and upload activity |
| `nico.history` | Watch history |
| `nico.likes` | Liked videos, like/unlike |
| `nico.http` | The raw HTTP layer, for endpoints this library does not wrap |

<details>
<summary><strong>Full method listing</strong></summary>

```ts
nico.auth.isLoggedIn(); nico.auth.verifySession(); nico.auth.isSessionValid();

nico.accountPublic.getUsers(userIds); nico.accountPublic.getMe();

nico.users.getUser(userId); nico.users.getUserVideos(userId, params?);
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
nico.mylists.getMyMylists(params?); nico.mylists.getMyWatchLater(params?);
nico.mylists.createMylist(params); nico.mylists.updateMylist(params); nico.mylists.deleteMylist(mylistId);
nico.mylists.addMylistItem(mylistId, watchId, params?); nico.mylists.removeMylistItems(mylistId, itemIds);
nico.mylists.addWatchLater(watchId); nico.mylists.removeWatchLater(watchIds);

nico.series.getSeries(seriesId, params?); nico.series.getSeriesV1(seriesId, params?);
nico.series.iterateSeriesItems(seriesId, params?);

nico.videos.getVideo(watchId); nico.videos.getVideos(watchIds, options?);
nico.videos.getRecommendations(videoId); nico.videos.getNicoAd(videoId);

nico.watch.getGuestWatchData(videoId, params?); nico.watch.getWatchData(videoId, params?);
nico.watch.getBestWatchData(videoId, params?);

nico.comments.fetchCommentsByVideoId(videoId, options?); nico.comments.fetchComments(nvComment, options?);
nico.comments.fetchCommentsWithKey(threadKey, targets, options?); nico.comments.getThreadKey(videoId);
nico.comments.fetchAllComments(nvComment, options?);
nico.comments.postComment(params); nico.comments.getPostKey(threadId);

nico.streaming.getHlsFromWatch(watch, options?); nico.streaming.createHlsAccessRights(params);
nico.streaming.getStoryboardFromWatch(watch, options?); nico.streaming.createStoryboardAccessRights(params);

nico.thumbInfo.getThumbInfo(videoId); nico.thumbInfo.tryGetThumbInfo(videoId);

nico.feed.getActors(params?); nico.feed.getFollowingsVideo(params?); nico.feed.iterateFollowingsVideo(params?);

nico.history.getMyWatchHistory(params?); nico.history.iterateMyWatchHistory(params?);

nico.likes.getMyLikes(params?); nico.likes.like(videoId); nico.likes.unlike(videoId);

nico.http.getJson(url, options?); nico.http.postJson(url, body, options?);
nico.http.sendJson(url, method, body, options?); nico.http.getText(url, options?);
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

Per-request, most methods thread through `RequestOptions` (a few with specialized option bags — `fetchAllComments`, `getHlsFromWatch` / `getStoryboardFromWatch`, and the access-rights calls — accept `signal` but not the rest):

| Option | Description |
| --- | --- |
| `signal` | `AbortSignal`, composed with the timeout via `AbortSignal.any` |
| `headers` | Extra headers for this request only |
| `validateMeta` | Set `false` to skip nvapi `meta.status` validation |
| `rateLimitMs` | Route through the shared rate limiter with this interval |
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
| `NiconicoApiError` | Non-2xx, or HTTP 200 with a failing `meta.status` — carries `status`, `errorCode`, `errorMessage`, `errorDetail`, `url` |
| `NiconicoNetworkError` | Transport failure after the retry budget is spent |
| `NiconicoTimeoutError` | The request exceeded `timeoutMs` |
| `NiconicoAuthError` | A session is missing or was rejected |
| `ThreadKeyRejectedError` | nvcomment rejected a thread key (expired, or guest-issued) |
| `ThumbInfoError` | `getthumbinfo` reported `status="fail"` — carries the failure `code` |
| `DomandUnavailableError` | No playable DMS media for the video |

`NiconicoApiError.isAbuseBlocked()` and `.isUnauthorized()` name the two conditions worth branching on.

## Retries and rate limiting

- Transient failures (408, 429, 5xx, transport errors) are retried with exponential backoff and `Retry-After` support.
- **Writes are never retried** unless explicitly marked `idempotent`, so a `POST` is never silently replayed.
- Comment fetches and posts share a process-wide rate limiter (`COMMENT_RATE_LIMIT_MS` = 334 ms between nvcomment calls), even across client instances.
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
| `pickBestVideo(domand)` / `pickBestAudio(domand)` | Highest available quality stream |
| `pickAudioForVideo(domand, video)` | Best audio within the video's recommended cap |
| `domandRequestHeaders(hls)` / `domandCookieHeader(hls)` | Headers/cookie the DMS CDN requires |
| `sortCommentsByVpos(comments)` | Order comments by playback position |
| `normalizeFork(fork)` / `threadsToTargets(threads)` | Comment-fork plumbing |
| `parseThumbInfoXml(xml)` / `parseThumbLength(value)` | Standalone `getthumbinfo` parsing |
| `buildQuery(params)` | Query-string builder with array/`undefined` handling |
| `readSetCookies(response)` / `readCookieValue(response, name)` | `Set-Cookie` helpers that work without `getSetCookie` |

Constants: `NICOVIDEO_ORIGIN`, `RANKING_ALL_KEY` (総合), `FEED_MAX_LIMIT` (50), `COMMENT_RATE_LIMIT_MS` (334), `SESSION_COOKIE_NAME`, `LOGIN_PAGE_URL`, and the `SNAPSHOT_*` field lists.

## API notes

Findings from live probing (2026-09-08). These are the places where the service diverges from the [niconicolibs unofficial docs](https://github.com/niconicolibs/api). The behaviors the library relies on day to day — the ranking BFF, per-id video lookup, comment-history and storyboard gating — are exercised by the live test suite; the one-shot probe results (the login flow, retired endpoints, the write block) are recorded here as of that date and are not re-verified on every run.

**Login is Turnstile-gated.** `POST account.nicovideo.jp/api/v1/login` returns 404; `/login` redirects to `/spa/login/index.html`, which posts to `api.id.nicovideo.jp` behind Cloudflare Turnstile. Password login is not possible headlessly.

**`relationships` sits beside `user`, not inside it.** `/v1/users/{id}` returns `data.relationships`, while the published examples nest it under `data.user`. Reading the documented path reports "not following" for everyone.

**`/v1/videos` honours only the last `watchIds`.** Passing three ids returns one video. `getVideos` therefore issues one request per id with bounded concurrency and reassembles them in argument order.

**The nvapi ranking endpoints are gone.** `/v1/ranking/hot-topic` is 404 and `/v1/ranking/genre/{key}` is 400 for every key, old or new. Rankings now come from the `www.nicovideo.jp/ranking/genre/{featuredKey}?responseType=json` BFF, keyed by opaque strings (総合 is `e9uj2uks`). `getRankingGenres()` enumerates the current 23.

**`/v1/videos/{id}/tags` is retired** (404). Tags come from watch data (`data.tag.items`) or `getthumbinfo`.

**Comment history needs a session.** A guest thread key is accepted for the initial payload but rejected with `400 INVALID_TOKEN` as soon as `additionals.when` is sent — from both key sources. `res_from: -1000` also over-asks: the server caps a page at 500.

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
npm run verify:live           # one-shot probe of every endpoint, prints a status table
```

Useful scripts: `lint` / `lint:types` (oxlint, including type-aware rules), `format`, `test:watch`, and `verify:package` (publish-shape checks via attw + publint). CI runs `npm run check`, `lint:types`, and a comment-policy check on every push; the live job only runs on manual dispatch so pull requests never depend on nicovideo.jp.

## Disclaimer

This is an unofficial library, not affiliated with or endorsed by Dwango / niconico. It talks to endpoints the official web frontend uses; they can change or disappear without notice (see [API notes](#api-notes) for ones that already have). Use it responsibly: keep request rates modest, respect the [niconico terms of service](https://account.nicovideo.jp/rules/account), and treat your `user_session` cookie as a secret.

## License

[MIT](./LICENSE)
