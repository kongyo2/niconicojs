import { NiconicoError } from "./errors.js";
import { buildQuery, type NiconicoHttp } from "./http.js";
import type { Genre, Thumbnail, VideoCount } from "./types.js";

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
}

export interface WatchParams {
  noSideEffect?: boolean | undefined;
  skipHarmful?: boolean | undefined;
  actionTrackId?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface WatchApi {
  getGuestWatchData(videoId: string, params?: WatchParams): Promise<WatchResult>;
  getWatchData(videoId: string, params?: WatchParams): Promise<WatchResult>;
  getBestWatchData(videoId: string, params?: WatchParams): Promise<WatchResult>;
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

export function createWatchApi(http: NiconicoHttp): WatchApi {
  const base = "https://www.nicovideo.jp/api/watch";

  async function fetchWatch(endpoint: "v3" | "v3_guest", videoId: string, params: WatchParams): Promise<WatchResult> {
    const actionTrackId = params.actionTrackId ?? generateActionTrackId();
    const query = buildQuery({
      actionTrackId,
      noSideEffect: params.noSideEffect,
      skips: params.skipHarmful === true ? "harmful" : undefined,
    });
    const url = `${base}/${endpoint}/${encodeURIComponent(videoId)}${query}`;
    const res = await http.getJson<{ data?: WatchData }>(url, { signal: params.signal });
    if (res.data === undefined) {
      throw new NiconicoError(`watch ${endpoint}: response for ${videoId} had no data field`);
    }
    return { data: res.data, actionTrackId };
  }

  return {
    getGuestWatchData(videoId, params = {}) {
      return fetchWatch("v3_guest", extractVideoId(videoId), params);
    },

    getWatchData(videoId, params = {}) {
      return fetchWatch("v3", extractVideoId(videoId), params);
    },

    getBestWatchData(videoId, params = {}) {
      return fetchWatch(http.isLoggedIn() ? "v3" : "v3_guest", extractVideoId(videoId), params);
    },
  };
}
