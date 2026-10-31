import { NiconicoApiError, NiconicoError } from "./errors.js";
import { buildQuery, NICOVIDEO_ORIGIN, readCookieValue, type NiconicoHttp } from "./http.js";
import type { EssentialVideo, Genre, Thumbnail, VideoCount } from "./types.js";

export type CommentFork = "owner" | "main" | "easy";

export interface WatchThreadId {
  id: number;
  fork: number;
  forkLabel: CommentFork;
}

export interface WatchCommentThread {
  id: number;
  fork: number;
  forkLabel: CommentFork;
  videoId: string;
  isActive: boolean;
  isDefaultPostTarget: boolean;
  isEasyCommentPostTarget: boolean;
  isLeafRequired: boolean;
  isOwnerThread: boolean;
  isThreadkeyRequired: boolean;
  threadkey: string | null;
  is184Forced: boolean;
  hasNicoscript: boolean;
  label: string;
  postkeyStatus: number;
  server: string;
}

export interface NvCommentTarget {
  id: string;
  fork: CommentFork;
}

export interface NvCommentParams {
  threadKey: string;
  server: string;
  params: {
    targets: NvCommentTarget[];
    language: string;
  };
}

export interface DomandVideoStream {
  id: string;
  isAvailable: boolean;
  label: string;
  bitRate: number;
  width: number;
  height: number;
  qualityLevel: number;
  recommendedHighestAudioQualityLevel: number;
}

export interface DomandAudioStream {
  id: string;
  isAvailable: boolean;
  bitRate: number;
  samplingRate: number;
  integratedLoudness: number;
  truePeak: number;
  qualityLevel: number;
  loudnessCollection?: Array<{ type: string; value: number }>;
}

export interface DomandMedia {
  videos: DomandVideoStream[];
  audios: DomandAudioStream[];
  isStoryboardAvailable: boolean;
  accessRightKey: string | null;
}

export interface WatchVideo {
  id: string;
  contentType?: string;
  title: string;
  description: string;
  count: VideoCount;
  duration: number;
  thumbnail: Thumbnail;
  rating: { isAdult: boolean };
  registeredAt: string;
  isPrivate: boolean;
  isDeleted: boolean;
  isNoBanner: boolean;
  isAuthenticationRequired: boolean;
  isEmbedPlayerAllowed: boolean;
  isGiftAllowed: boolean;
  viewer: unknown;
  watchableUserTypeForPayment: string;
  commentableUserTypeForPayment: string;
  hasLyrics?: boolean;
  [k: string]: unknown;
}

export interface WatchTagItem {
  name: string;
  isCategory: boolean;
  isCategoryCandidate: boolean;
  isNicodicArticleExists: boolean;
  isLocked: boolean;
}

export interface WatchTag {
  items: WatchTagItem[];
  hasR18Tag: boolean;
  isPublishedNicoscript: boolean;
  edit: { isEditable: boolean; uneditableReason: string | null; editKey: string | null };
  viewer: unknown;
}

export interface WatchOwner {
  id: number;
  nickname: string;
  iconUrl: string;
  channel: unknown;
  live: unknown;
  isVideosPublic: boolean;
  isMylistsPublic: boolean;
  videoLiveNotice: unknown;
  viewer: { isFollowing?: boolean } | null;
}

export interface WatchViewer {
  id: number;
  nickname: string;
  isPremium: boolean;
  allowSensitiveContents?: boolean;
  existence?: { age: number | null; prefecture: string | null; sex: string | null };
  [k: string]: unknown;
}

export interface WatchComment {
  server: { url: string };
  keys: { userKey: string };
  layers: Array<{ index: number; isTranslucent: boolean; threadIds: WatchThreadId[] }>;
  threads: WatchCommentThread[];
  ng: unknown;
  isAttentionRequired: boolean;
  nvComment: NvCommentParams | null;
  assist?: unknown;
}

export interface WatchPayment {
  video: {
    isPpv: boolean;
    isAdmission: boolean;
    isContinuationBenefit: boolean;
    isPremium: boolean;
    watchableUserType: string;
    commentableUserType: string;
    billingType?: string;
  };
  preview: unknown;
}

export interface WatchRanking {
  genre: { genre: string; rank: number; time: string } | null;
  popularTag: Array<{ tag: string; regularizedTag?: string; rank: number; genre?: string; time?: string }>;
  teiban: { featuredKey: string; label: string; rank: number } | null;
}

export interface WatchData {
  video: WatchVideo;
  viewer: WatchViewer | null;
  owner: WatchOwner | null;
  channel: unknown;
  community: unknown;
  genre: Genre & { isImmoral: boolean; isDisabled: boolean; isNotSet?: boolean };
  tag: WatchTag;
  media: {
    domand: DomandMedia | null;
    delivery: unknown;
    deliveryLegacy: unknown;
  };
  comment: WatchComment;
  series: { id: number; title: string; [k: string]: unknown } | null;
  ranking: WatchRanking;
  payment: WatchPayment;
  client: {
    nicosid: string;
    watchId: string;
    watchTrackId: string;
  };
  system: { serverTime: string; isPeakTime: boolean; isStellaAlive?: boolean };
  easyComment: { phrases: Array<{ text: string; nicodic?: unknown }> };
  okReason: string;
  [k: string]: unknown;
}

export interface WatchResult {
  data: WatchData;
  actionTrackId: string;
  guest?: boolean;
}

export interface WatchParams {
  noSideEffect?: boolean | undefined;
  skipHarmful?: boolean | undefined;
  actionTrackId?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface WatchV4Thread {
  id: number;
  fork: number;
  forkLabel: CommentFork;
  videoId: string;
  isPostTarget: boolean;
  isOwnerThread: boolean;
  is184Forced: boolean;
  label: string;
  postNgReason: string | null;
  syncBufferTime: number;
  [k: string]: unknown;
}

export interface WatchV4Layer {
  index: number;
  isTranslucent: boolean;
  components: Array<{ threadId: number; fork: number; forkLabel: CommentFork }>;
}

export interface WatchV4Comment {
  threads: WatchV4Thread[];
  layers: WatchV4Layer[];
  ng: {
    ngScore: { isDisabled: boolean };
    owner: unknown[];
    viewer: {
      revision: number;
      count: number;
      items: Array<{ type: string; source: string; registeredAt?: string }>;
    } | null;
  };
  isAttentionRequired: boolean;
  nvComment: NvCommentParams | null;
  assist?: unknown;
}

export interface WatchV4VideoStream {
  id: string;
  isAvailable: boolean;
  qualityLevel: number;
  label: string;
  bitRate: number;
  width: number;
  height: number;
}

export interface WatchV4AudioStream {
  id: string;
  isAvailable: boolean;
  qualityLevel: number;
  bitRate: number;
  samplingRate: number;
  integratedLoudness: number;
  truePeak: number;
  loudnessCollection?: Array<{ type: string; value: number }>;
  label?: { quality: string; bitrate: string };
}

export interface WatchV4Hls {
  url: string;
  outputs: Array<{ assetUnitNames: string[] }>;
  createdAt: string;
  expiredAt: string;
}

export interface WatchV4Media {
  contents: { videos: WatchV4VideoStream[]; audios: WatchV4AudioStream[] };
  isStoryboardAvailable: boolean;
  accessRightKey: string | null;
  hls: WatchV4Hls | null;
  lowDataMode?: { videoUpperLimit: number; audioUpperLimit: number };
}

export interface WatchV4Thumbnail {
  normal: string | null;
  middle: string | null;
  large: string | null;
  player: string | null;
  ogp: string | null;
  short: string | null;
}

export interface WatchV4Video {
  id: string;
  contentType: string;
  title: string;
  description: string;
  count: VideoCount;
  duration: number;
  thumbnail: WatchV4Thumbnail;
  registeredAt: string;
  permission: {
    isPrivate: boolean;
    isDeleted: boolean;
    isAuthenticationRequired: boolean;
    isEmbedPlayerAllowed: boolean;
    isGiftAllowed: boolean;
    rating: { isAdult: boolean };
    [k: string]: unknown;
  };
  hasLyrics: boolean;
  isChannelVideo: boolean;
  isOwnedByViewer: boolean;
  isLikedByViewer: boolean;
  [k: string]: unknown;
}

export interface WatchV4Tags {
  items: Array<{ name: string; isLocked: boolean }>;
  hasR18Tag: boolean;
  isPublishedNicoscript: boolean;
  edit: { isEditable: boolean; uneditableReason: string | null; editKey: string | null };
}

export interface WatchV4PaymentFlag {
  isEnabled: boolean;
  showPromotion: boolean;
}

export interface WatchV4Payment {
  ppv: WatchV4PaymentFlag;
  admission: WatchV4PaymentFlag;
  continuationBenefit: WatchV4PaymentFlag;
  premium: WatchV4PaymentFlag;
  watchableUserType: string;
  commentableUserType: string;
  billingType: string;
}

export interface WatchV4Viewer {
  id: number;
  nickname: string;
  isPremium: boolean;
  allowSensitiveContents: boolean;
  [k: string]: unknown;
}

export interface WatchV4Data {
  responseType: string;
  client: { nicosid: string; watchId: string; watchTrackId: string };
  comment: WatchV4Comment;
  media: WatchV4Media | null;
  video: WatchV4Video;
  genre: Genre & { isImmoral: boolean; isDisabled: boolean; isNotSet?: boolean };
  tags: WatchV4Tags;
  lazy: { authKey: string };
  system: { serverTime: string; isStellaAlive?: boolean; [k: string]: unknown };
  viewer: WatchV4Viewer | null;
  payment: WatchV4Payment;
  okReason: string;
  [k: string]: unknown;
}

export interface WatchV4Result {
  data: WatchV4Data;
  actionTrackId: string;
  guest: boolean;
  domandBidCookie: string | undefined;
}

export interface WatchV4Params {
  asGuest?: boolean | undefined;
  actionTrackId?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface WatchLazyUserOwner {
  type: "user";
  visibility: string;
  id: number;
  nickname: string;
  icon: { url: string };
  follow: { isFollowed: boolean } | null;
  ownedChannel: { id: string; name: string; url: string } | null;
  currentLive: { programId: string; title: string; url: string; begunAt: string; [k: string]: unknown } | null;
  upcomingVideoLive: unknown;
  [k: string]: unknown;
}

export interface WatchLazyChannelOwner {
  type: "channel";
  visibility: string;
  id: string;
  name: string;
  isOfficialAnime: boolean;
  thumbnail: { url: string; smallUrl: string };
  follow: { isFollowed: boolean } | null;
  [k: string]: unknown;
}

export interface WatchLazySeries {
  id: number;
  title: string;
  description: string;
  thumbnailUrl: string;
  video: { prev: EssentialVideo | null; next: EssentialVideo | null; first: EssentialVideo | null };
}

export interface WatchLazyData {
  owner: WatchLazyUserOwner | WatchLazyChannelOwner | null;
  ranking: { teiban: { featuredKey: string; label: string; rank: number } | null };
  series: WatchLazySeries | null;
  waku: Record<string, unknown>;
  [k: string]: unknown;
}

export type WatchRefSource = "mylist" | "series";

export interface WatchLazyParams {
  keyToken: string;
  actionTrackId: string;
  noSideEffect?: boolean | undefined;
  refSource?: WatchRefSource | undefined;
  refSourceId?: string | undefined;
  guest?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface RecordViewOptions {
  refSource?: WatchRefSource | undefined;
  refSourceId?: string | undefined;
  signal?: AbortSignal | undefined;
}

export class WatchKeyRejectedError extends NiconicoError {
  readonly errorCode: string;
  constructor(videoId: string, errorCode: string) {
    super(`watch lazy rejected the keyToken for ${videoId} (${errorCode}). Refetch watch data with getWatchV4.`);
    this.errorCode = errorCode;
  }
}

export interface WatchApi {
  getGuestWatchData(videoId: string, params?: WatchParams): Promise<WatchResult>;
  getWatchData(videoId: string, params?: WatchParams): Promise<WatchResult>;
  getBestWatchData(videoId: string, params?: WatchParams): Promise<WatchResult>;
  getWatchV4(videoId: string, params?: WatchV4Params): Promise<WatchV4Result>;
  getWatchLazy(
    watch: WatchV4Result,
    options?: {
      noSideEffect?: boolean | undefined;
      refSource?: WatchRefSource | undefined;
      refSourceId?: string | undefined;
      signal?: AbortSignal | undefined;
    },
  ): Promise<WatchLazyData>;
  getWatchLazyWithKey(videoId: string, params: WatchLazyParams): Promise<WatchLazyData>;
  recordView(watch: WatchV4Result, options?: RecordViewOptions): Promise<void>;
}

const TRACK_ID_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function generateActionTrackId(): string {
  let random = "";
  for (let i = 0; i < 10; i += 1) {
    random += TRACK_ID_CHARS[Math.floor(Math.random() * TRACK_ID_CHARS.length)];
  }
  return `${random}_${Date.now()}`;
}

export function extractVideoId(input: string): string {
  const trimmed = input.trim();
  try {
    const url = new URL(trimmed);
    const watch = url.pathname.match(/\/watch\/([^/?#]+)/);
    if (watch?.[1] !== undefined) return decodeURIComponent(watch[1]);
    if (url.hostname === "nico.ms") {
      const short = url.pathname.match(/^\/([^/?#]+)/);
      if (short?.[1] !== undefined) return decodeURIComponent(short[1]);
    }
  } catch {}
  return trimmed;
}

export function isVideoId(value: string): boolean {
  return /^(?:[a-z]{2}\d+|\d+)$/.test(value);
}

const NVAPI = "https://nvapi.nicovideo.jp";

const WATCH_V4_HEADERS: Readonly<Record<string, string>> = { "X-Request-With": NICOVIDEO_ORIGIN };

export function createWatchApi(http: NiconicoHttp): WatchApi {
  const base = "https://www.nicovideo.jp/api/watch";

  async function fetchWatch(endpoint: "v3" | "v3_guest", videoId: string, params: WatchParams): Promise<WatchResult> {
    const actionTrackId = params.actionTrackId ?? generateActionTrackId();
    const guest = endpoint === "v3_guest";
    const query = buildQuery({
      actionTrackId,
      noSideEffect: params.noSideEffect,
      skips: params.skipHarmful === true ? "harmful" : undefined,
    });
    const url = `${base}/${endpoint}/${encodeURIComponent(videoId)}${query}`;
    const res = await http.getJson<{ data?: WatchData }>(url, { signal: params.signal, anonymous: guest });
    if (res.data === undefined) {
      throw new NiconicoError(`watch ${endpoint}: response for ${videoId} had no data field`);
    }
    return { data: res.data, actionTrackId, guest };
  }

  const api: WatchApi = {
    getGuestWatchData(videoId, params = {}) {
      return fetchWatch("v3_guest", extractVideoId(videoId), params);
    },

    getWatchData(videoId, params = {}) {
      return fetchWatch("v3", extractVideoId(videoId), params);
    },

    getBestWatchData(videoId, params = {}) {
      return fetchWatch(http.isLoggedIn() ? "v3" : "v3_guest", extractVideoId(videoId), params);
    },

    async getWatchV4(videoId, params = {}) {
      const id = extractVideoId(videoId);
      const guest = params.asGuest === true || !http.isLoggedIn();
      const requestedTrackId = params.actionTrackId ?? generateActionTrackId();
      const url = `${NVAPI}/v4/watch/${encodeURIComponent(id)}`;
      const body = guest ? { actionTrackId: requestedTrackId, asGuest: true } : { actionTrackId: requestedTrackId };
      const raw = await http.request(
        url,
        { method: "POST", body: JSON.stringify(body) },
        { ...WATCH_V4_HEADERS, "Content-Type": "application/json" },
        { signal: params.signal, idempotent: true, anonymous: guest },
      );
      const res = http.parseJsonResponse<{ data?: WatchV4Data }>(url, raw, true);
      if (res.data === undefined) {
        throw new NiconicoError(`watch v4: response for ${id} had no data field`);
      }
      return {
        data: res.data,
        actionTrackId: requestedTrackId,
        guest,
        domandBidCookie: readCookieValue(raw.response, "domand_bid"),
      };
    },

    async getWatchLazyWithKey(videoId, params) {
      const id = extractVideoId(videoId);
      const noSideEffect = params.noSideEffect ?? true;
      const body: Record<string, string | boolean> = {
        actionTrackId: params.actionTrackId,
        keyToken: params.keyToken,
        noSideEffect,
      };
      if (params.refSource !== undefined) body["refSource"] = params.refSource;
      if (params.refSourceId !== undefined) body["refSourceId"] = params.refSourceId;
      const url = `${NVAPI}/v4/watch/lazy/${encodeURIComponent(id)}`;
      let res: { data?: WatchLazyData };
      try {
        res = await http.sendJson<{ data?: WatchLazyData }>(url, "POST", body, {
          headers: WATCH_V4_HEADERS,
          signal: params.signal,
          anonymous: params.guest === true,
          idempotent: noSideEffect,
        });
      } catch (error) {
        if (
          error instanceof NiconicoApiError &&
          (error.errorCode === "KEY_EXPIRED" || error.errorCode === "INVALID_KEY")
        ) {
          throw new WatchKeyRejectedError(id, error.errorCode);
        }
        throw error;
      }
      if (res.data === undefined) {
        throw new NiconicoError(`watch lazy: response for ${id} had no data field`);
      }
      return res.data;
    },

    async getWatchLazy(watch, options = {}) {
      const watchId = watch.data.client.watchId;
      const params: WatchLazyParams = {
        keyToken: watch.data.lazy.authKey,
        actionTrackId: watch.actionTrackId,
        guest: watch.guest,
        noSideEffect: options.noSideEffect,
        refSource: options.refSource,
        refSourceId: options.refSourceId,
        signal: options.signal,
      };
      try {
        return await api.getWatchLazyWithKey(watchId, params);
      } catch (error) {
        if (!(error instanceof WatchKeyRejectedError) || error.errorCode !== "KEY_EXPIRED") throw error;
        const fresh = await api.getWatchV4(watchId, { asGuest: watch.guest, signal: options.signal });
        return api.getWatchLazyWithKey(watchId, {
          ...params,
          keyToken: fresh.data.lazy.authKey,
          actionTrackId: fresh.actionTrackId,
        });
      }
    },

    async recordView(watch, options = {}) {
      const body: Record<string, string> = { actionTrackId: watch.actionTrackId };
      if (options.refSource !== undefined) body["refSource"] = options.refSource;
      if (options.refSourceId !== undefined) body["refSourceId"] = options.refSourceId;
      await http.sendJson(
        `${NVAPI}/v4/watch/${encodeURIComponent(watch.data.client.watchId)}/side-effect`,
        "POST",
        body,
        { headers: WATCH_V4_HEADERS, signal: options.signal, anonymous: watch.guest },
      );
    },
  };

  return api;
}
