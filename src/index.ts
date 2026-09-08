export { NiconicoClient, type NiconicoClientOptions } from "./client.js";

export {
  NiconicoHttp,
  RateLimiter,
  buildQuery,
  commentRateLimiter,
  extractUserSession,
  isNiconicoHost,
  readCookieValue,
  readSetCookies,
  COMMENT_RATE_LIMIT_MS,
  NICOVIDEO_ORIGIN,
  type FrontendId,
  type FetchLike,
  type HttpMethod,
  type NiconicoHttpOptions,
  type RequestOptions,
} from "./http.js";

export {
  NiconicoApiError,
  NiconicoError,
  NiconicoNetworkError,
  NiconicoTimeoutError,
  assertNvapiMeta,
  isNiconicoApiError,
  isNiconicoError,
  type NiconicoApiErrorPayload,
  type NvapiMeta,
} from "./errors.js";

export {
  createAuthApi,
  NiconicoAuthError,
  LOGIN_PAGE_URL,
  SESSION_COOKIE_NAME,
  type AuthApi,
  type SessionUser,
} from "./auth.js";

export {
  createAccountPublicApi,
  type AccountOwnUser,
  type AccountPublicApi,
  type AccountPublicUser,
} from "./account-public.js";

export {
  createCommentsApi,
  normalizeFork,
  sortCommentsByVpos,
  threadsToTargets,
  ThreadKeyRejectedError,
  type CommentItem,
  type CommentThread,
  type CommentsApi,
  type FetchAllCommentsOptions,
  type PostCommentParams,
  type PostCommentResult,
  type ThreadsRequestBody,
  type WatchThreadResolver,
} from "./comments.js";

export {
  createFeedApi,
  FEED_MAX_LIMIT,
  type FeedActivitiesResult,
  type FeedActivity,
  type FeedActivityContent,
  type FeedActor,
  type FeedApi,
} from "./feed.js";

export { createGenresApi, type GenresApi, type PopularTagsResult } from "./genres.js";

export {
  createHistoryApi,
  type HistoryApi,
  type WatchHistoryContentType,
  type WatchHistoryItem,
  type WatchHistoryParams,
  type WatchHistoryResult,
} from "./history.js";

export { createLikesApi, type LikedItem, type LikesApi, type LikesResult } from "./likes.js";

export {
  createMylistsApi,
  type CreateMylistParams,
  type MylistDetail,
  type MylistGetParams,
  type MylistSortKey,
  type MylistsApi,
  type UpdateMylistParams,
  type WatchLaterItem,
  type WatchLaterResult,
} from "./mylists.js";

export {
  createRankingApi,
  RANKING_ALL_KEY,
  type RankingApi,
  type RankingGenre,
  type RankingNewsItem,
  type RankingPageInfo,
  type RankingPagination,
  type RankingParams,
  type RankingResult,
  type RankingTerm,
} from "./ranking.js";

export {
  createSearchApi,
  type ChannelVideoListingStatus,
  type FacetParams,
  type FacetResult,
  type ListSearchParams,
  type ListSearchResult,
  type ListSearchSortKey,
  type ListType,
  type NewArrivalParams,
  type NewArrivalResult,
  type SearchAdditionalTag,
  type SearchApi,
  type SearchListItem,
  type SearchUser,
  type UserSearchParams,
  type UserSearchResult,
  type UserSearchSortKey,
  type VideoSearchParams,
  type VideoSearchResult,
  type VideoSearchSortKey,
  type VideoSearchSortOrder,
} from "./search.js";

export { createSeriesApi, type SeriesApi, type SeriesGetParams, type SeriesResult } from "./series.js";

export {
  createSnapshotApi,
  normalizeSnapshotSort,
  SNAPSHOT_FIELDS,
  SNAPSHOT_SORTABLE,
  SNAPSHOT_TARGETS,
  type SnapshotApi,
  type SnapshotField,
  type SnapshotItem,
  type SnapshotRangeFilter,
  type SnapshotSearchParams,
  type SnapshotSearchResult,
  type SnapshotSortField,
  type SnapshotTarget,
} from "./snapshot.js";

export {
  createStreamingApi,
  DomandUnavailableError,
  domandCookieHeader,
  domandRequestHeaders,
  pickAudioForVideo,
  pickBestAudio,
  pickBestVideo,
  type HlsAccessRightsResult,
  type HlsSessionParams,
  type StoryboardAccessRightsResult,
  type StoryboardSessionParams,
  type StreamingApi,
} from "./streaming.js";

export { createSuggestionApi, type SuggestionApi } from "./suggestion.js";

export {
  createThumbInfoApi,
  parseThumbInfoXml,
  parseThumbLength,
  ThumbInfoError,
  type ThumbInfo,
  type ThumbInfoApi,
  type ThumbInfoFailure,
  type ThumbInfoTag,
} from "./thumb-info.js";

export {
  createUsersApi,
  userPathSegment,
  type CreatorSupportResult,
  type FollowListParams,
  type FollowSummary,
  type FollowUser,
  type FollowUsersResult,
  type UserMylistsResult,
  type UserSeriesResult,
  type UserVideosParams,
  type UserVideosResult,
  type UserVideosSortKey,
  type UsersApi,
} from "./users.js";

export {
  createVideosApi,
  type NicoAdInfo,
  type RecommendItem,
  type RecommendResult,
  type VideoLookupResult,
  type VideosApi,
} from "./videos.js";

export {
  createWatchApi,
  extractVideoId,
  generateActionTrackId,
  isVideoId,
  type CommentFork,
  type DomandAudioStream,
  type DomandMedia,
  type DomandVideoStream,
  type NvCommentParams,
  type NvCommentTarget,
  type WatchApi,
  type WatchComment,
  type WatchCommentThread,
  type WatchData,
  type WatchOwner,
  type WatchParams,
  type WatchPayment,
  type WatchRanking,
  type WatchResult,
  type WatchTag,
  type WatchTagItem,
  type WatchThreadId,
  type WatchVideo,
  type WatchViewer,
} from "./watch.js";

export type {
  EssentialVideo,
  Genre,
  MinimalUser,
  MylistItem,
  MylistMeta,
  Owner,
  SensitiveContents,
  SeriesDetail,
  SeriesItem,
  SeriesMeta,
  SortOrder,
  Thumbnail,
  UserDetail,
  UserDetailWithRelationships,
  UserIcons,
  UserIdOrMe,
  UserLevel,
  UserRelationships,
  UserSns,
  VideoCount,
} from "./types.js";
