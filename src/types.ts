export interface Thumbnail {
  url: string;
  middleUrl: string | null;
  largeUrl: string | null;
  listingUrl?: string | null;
  nHdUrl?: string | null;
  shortUrl?: string | null;
  player?: string | null;
  ogp?: string | null;
}

export interface VideoCount {
  view: number;
  comment: number;
  mylist: number;
  like: number;
}

export interface Owner {
  ownerType?: string;
  type: string;
  visibility?: string;
  id: string;
  name: string;
  iconUrl: string;
  [k: string]: unknown;
}

export interface EssentialVideo {
  type?: string;
  id: string;
  contentType?: string;
  title: string;
  registeredAt?: string;
  count: VideoCount;
  thumbnail: Thumbnail;
  duration?: number;
  shortDescription?: string;
  latestCommentSummary?: string;
  isChannelVideo?: boolean;
  isPaymentRequired?: boolean;
  playbackPosition?: number | null;
  owner: Owner | null;
  requireSensitiveMasking?: boolean;
  videoLive?: unknown;
  isMuted?: boolean;
  [k: string]: unknown;
}

export interface UserIcons {
  small: string;
  large: string;
}

export interface UserRelationships {
  sessionUser?: { isFollowing?: boolean };
  isMe?: boolean;
}

export interface MinimalUser {
  type?: string;
  id: number;
  nickname: string;
  icons: UserIcons;
  isPremium?: boolean;
  description?: string;
  strippedDescription?: string;
  shortDescription?: string;
  relationships?: UserRelationships;
  [k: string]: unknown;
}

export interface UserLevel {
  currentLevel: number;
  nextLevelThresholdExperience: number;
  nextLevelExperience: number;
  currentLevelExperience: number;
}

export interface UserSns {
  type: string;
  label: string;
  iconUrl?: string;
  screenName?: string;
  url?: string;
}

export interface UserDetail {
  id: number;
  nickname: string;
  icons: UserIcons;
  description?: string;
  decoratedDescriptionHtml?: string;
  strippedDescription?: string;
  isPremium?: boolean;
  registeredVersion?: string;
  followeeCount?: number;
  followerCount?: number;
  userLevel?: UserLevel;
  userChannel?: unknown;
  isNicorepoReadable?: boolean;
  coverImage?: unknown;
  sns?: UserSns[];
  [k: string]: unknown;
}

export interface UserDetailWithRelationships {
  user: UserDetail;
  relationships: UserRelationships;
}

export interface Genre {
  key: string;
  label: string;
}

export interface MylistMeta {
  id: number;
  isPublic?: boolean;
  name: string;
  description: string;
  decoratedDescriptionHtml?: string;
  defaultSortKey?: string;
  defaultSortOrder?: string;
  itemsCount?: number;
  owner?: Owner;
  sampleItems?: MylistItem[];
  followerCount?: number;
  createdAt?: string;
  isFollowing?: boolean;
  [k: string]: unknown;
}

export interface SeriesMeta {
  id: number;
  owner: { type: string; id: string };
  title: string;
  isListed: boolean;
  description: string;
  thumbnailUrl: string;
  itemsCount: number;
}

export interface MylistItem {
  itemId: number;
  watchId: string;
  description?: string;
  decoratedDescriptionHtml?: string;
  addedAt?: string;
  status?: string;
  video: EssentialVideo;
}

export interface SeriesDetail {
  id: number;
  owner: {
    type: string;
    id: string;
    user?: MinimalUser;
  };
  title: string;
  description: string;
  decoratedDescriptionHtml?: string;
  thumbnailUrl: string;
  isListed: boolean;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: unknown;
}

export interface SeriesItem {
  meta: {
    id: string;
    order: number;
    createdAt: string;
    updatedAt: string;
  };
  video: EssentialVideo;
}

export type SensitiveContents = "mask" | "filter";

export type SortOrder = "asc" | "desc";

export type UserIdOrMe = number | "me";
