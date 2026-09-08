import { createAccountPublicApi, type AccountPublicApi } from "./account-public.js";
import { createAuthApi, type AuthApi } from "./auth.js";
import { createCommentsApi, type CommentsApi } from "./comments.js";
import { createFeedApi, type FeedApi } from "./feed.js";
import { createGenresApi, type GenresApi } from "./genres.js";
import { createHistoryApi, type HistoryApi } from "./history.js";
import { extractUserSession, NiconicoHttp, type NiconicoHttpOptions } from "./http.js";
import { createLikesApi, type LikesApi } from "./likes.js";
import { createMylistsApi, type MylistsApi } from "./mylists.js";
import { createRankingApi, type RankingApi } from "./ranking.js";
import { createSearchApi, type SearchApi } from "./search.js";
import { createSeriesApi, type SeriesApi } from "./series.js";
import { createSnapshotApi, type SnapshotApi } from "./snapshot.js";
import { createStreamingApi, type StreamingApi } from "./streaming.js";
import { createSuggestionApi, type SuggestionApi } from "./suggestion.js";
import { createThumbInfoApi, type ThumbInfoApi } from "./thumb-info.js";
import { createUsersApi, type UsersApi } from "./users.js";
import { createVideosApi, type VideosApi } from "./videos.js";
import { NiconicoError } from "./errors.js";
import { createWatchApi, type NvCommentParams, type WatchApi } from "./watch.js";

export interface NiconicoClientOptions extends NiconicoHttpOptions {
  session?: string | undefined;
}

export class NiconicoClient {
  readonly http: NiconicoHttp;

  readonly auth: AuthApi;
  readonly accountPublic: AccountPublicApi;
  readonly users: UsersApi;
  readonly search: SearchApi;
  readonly snapshot: SnapshotApi;
  readonly suggestion: SuggestionApi;
  readonly ranking: RankingApi;
  readonly mylists: MylistsApi;
  readonly series: SeriesApi;
  readonly videos: VideosApi;
  readonly genres: GenresApi;
  readonly watch: WatchApi;
  readonly comments: CommentsApi;
  readonly streaming: StreamingApi;
  readonly thumbInfo: ThumbInfoApi;
  readonly feed: FeedApi;
  readonly history: HistoryApi;
  readonly likes: LikesApi;

  constructor(options: NiconicoClientOptions = {}) {
    const { session, ...httpOptions } = options;
    this.http = new NiconicoHttp({ ...httpOptions, session: normalizeSession(session) });

    this.accountPublic = createAccountPublicApi(this.http);
    this.auth = createAuthApi(this.http, this.accountPublic);
    this.users = createUsersApi(this.http);
    this.search = createSearchApi(this.http);
    this.snapshot = createSnapshotApi(this.http);
    this.suggestion = createSuggestionApi(this.http);
    this.ranking = createRankingApi(this.http);
    this.mylists = createMylistsApi(this.http);
    this.series = createSeriesApi(this.http);
    this.videos = createVideosApi(this.http);
    this.genres = createGenresApi(this.http);
    this.watch = createWatchApi(this.http);
    this.streaming = createStreamingApi(this.http);
    this.thumbInfo = createThumbInfoApi(this.http);
    this.feed = createFeedApi(this.http);
    this.history = createHistoryApi(this.http);
    this.likes = createLikesApi(this.http);
    this.comments = createCommentsApi(this.http, async (videoId, commentOptions) => {
      const watch = await this.watch.getBestWatchData(videoId, {
        noSideEffect: true,
        ...commentOptions,
      });
      const nvComment = watch.data.comment.nvComment;
      if (nvComment === null) {
        throw new NiconicoError(`watch data for ${videoId} carried no nvComment credentials`);
      }
      return nvComment satisfies NvCommentParams;
    });
  }

  isLoggedIn(): boolean {
    return this.http.isLoggedIn();
  }
}

function normalizeSession(input: string | undefined): string | undefined {
  if (input === undefined) return undefined;
  const trimmed = input.trim();
  if (trimmed.length === 0) return undefined;
  const value = extractUserSession(trimmed);
  if (value === undefined) {
    throw new NiconicoError(
      "NiconicoClient: `session` must be a user_session value, a `user_session=…` pair, or a Cookie header containing one.",
    );
  }
  return value;
}
