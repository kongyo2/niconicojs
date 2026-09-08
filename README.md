# @kongyo2/niconicojs

Unofficial TypeScript client for the [niconico](https://www.nicovideo.jp) (nicovideo.jp) web APIs — videos, search, ranking, mylists, series, users, comments, and DMS/HLS streaming.

Every endpoint in this library was probed against the live service and the behaviour documented here reflects what it actually does today, not what the published unofficial docs say. Several of those docs are stale; the [API notes](#api-notes) section records where they diverge.

- **No runtime surprises.** Guest access works for every read endpoint; a session cookie unlocks the rest.
- **Typed against real responses.** Shapes were taken from live payloads, not from examples.
- **Strict by construction.** `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `isolatedDeclarations`, with `oxlint` type-aware lint clean.

## Install

```bash
npm add @kongyo2/niconicojs
```

Requires Node 20+ (uses `fetch`, `AbortSignal.any` and `Headers.getSetCookie`).

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

### Authenticating

niconico's login moved to a single-page app behind a Cloudflare Turnstile challenge, so **there is no `login(email, password)`** — a headless client cannot produce a Turnstile token. Sign in once in a browser, copy the `user_session` cookie, and pass it in:

```ts
const nico = new NiconicoClient({ session: process.env["NICONICO_SESSION"] });

const me = await nico.auth.verifySession();
console.log(`${me.nickname} (#${me.userId})`);
```

The `session` option accepts any of these, so a paste from devtools works as-is:

```
user_session_12345678_abcdef…
user_session=user_session_12345678_abcdef…
Cookie: nicosid=1.2; user_session=user_session_12345678_abcdef…
```

A value it cannot parse throws at construction rather than silently falling back to guest access.

### Playing a video

The DMS (domand) flow needs three steps, and `getHlsFromWatch` does all of them:

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
import { pickBestVideo, pickAudioForVideo } from "@kongyo2/niconicojs";

const domand = watch.data.media.domand;
if (domand?.accessRightKey != null) {
  const video = pickBestVideo(domand);
  const audio = video && pickAudioForVideo(domand, video);
  const hls = await nico.streaming.createHlsAccessRights({
    videoId: watch.data.video.id,
    accessRightKey: domand.accessRightKey,
    actionTrackId: watch.actionTrackId, // must match the watch call
    videoStreamId: video?.id,
    audioStreamId: audio!.id,
  });
}
```

> The `actionTrackId` is baked into `accessRightKey`. Reusing the one from the watch call is mandatory — a fresh one returns `400 INVALID_PARAMETER`. `WatchResult` carries it for exactly this reason.

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

Each module is also exported standalone (`createSearchApi(http)`, …) if you want one surface without the client.

## Error handling

```ts
import { isNiconicoApiError, NiconicoApiError } from "@kongyo2/niconicojs";

try {
  await nico.likes.like("sm9");
} catch (error) {
  if (isNiconicoApiError(error)) {
    if (error.isAbuseBlocked()) {
      // 403 / errorDetail AB001 — see "Write endpoints" below.
    }
    console.error(error.status, error.errorCode, error.url);
  }
}
```

| Error | Raised when |
| --- | --- |
| `NiconicoApiError` | Non-2xx, or HTTP 200 with a failing `meta.status` |
| `NiconicoNetworkError` | Transport failure after the retry budget is spent |
| `NiconicoTimeoutError` | The request exceeded `timeoutMs` |
| `NiconicoAuthError` | A session is missing or was rejected |
| `ThreadKeyRejectedError` | nvcomment rejected a thread key (expired, or guest-issued) |
| `ThumbInfoError` | `getthumbinfo` reported `status="fail"` |
| `DomandUnavailableError` | No playable DMS media for the video |

Transient failures (408, 429, 5xx, transport errors) are retried with exponential backoff and `Retry-After` support. **Writes are never retried** unless explicitly marked idempotent, so a `POST` is never silently replayed.

## API notes

Findings from live probing (2026-09-08). These are the places where the service diverges from the [niconicolibs unofficial docs](https://github.com/niconicolibs/api), and each one is exercised by the live test suite.

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
npm install
npm run check        # typecheck + test typecheck + lint + format + tests + build
npm run lint:types   # type-aware lint (slower; run deliberately)
npm test             # unit tests only — no network
```

Live verification against the real service is deliberately outside `check`:

```bash
# Guest endpoints only
npm run verify:live

# Including authenticated endpoints
NICONICO_SESSION="user_session_…" npm run verify:live

# The same coverage as a vitest suite
NICONICO_LIVE=1 NICONICO_SESSION="user_session_…" npm test
```

`verify:live` prints a pass/fail row per endpoint and exits non-zero if any fails — it is the check that catches niconico changing an API underneath the library.

This codebase keeps comments out of the source; run `npm run comments:strip` after editing and `npm run comments:check` to verify.

### Releasing

Publishing is a manual GitHub Action: **Actions → Publish to npm → Run workflow**.

| Input | Meaning |
| --- | --- |
| `version` | `patch` / `minor` / `major` / `prerelease`, an exact `1.2.3`, or `current` to publish `package.json` as-is |
| `tag` | npm dist-tag (`latest`, `next`, `beta`) |
| `dry_run` | Run every check and pack the tarball, but stop before publishing |

The job runs `check`, the type-aware lint and the comment gate, refuses to overwrite a version already on npm, validates the tarball with `attw` and `publint`, then publishes with npm provenance. A version bump (anything but `current`) is committed, tagged and released on GitHub afterwards.

It needs two repository settings: an `npm-publish` environment and an `NPM_TOKEN` secret holding an npm automation token with publish rights.

## Legal

Unofficial and unaffiliated with DWANGO Co., Ltd. These are private web APIs that can change or disappear without notice. Respect niconico's [terms of service](https://account.nicovideo.jp/rules/account) and rate limits — the comment API's 3 req/sec cap is enforced by this client, but everything else is your responsibility.

## License

MIT
