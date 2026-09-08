import { NiconicoError } from "./errors.js";
import { buildQuery, type NiconicoHttp, type RequestOptions, pickRequestOptions } from "./http.js";
import type { EssentialVideo, Genre, MinimalUser, Owner, SensitiveContents } from "./types.js";

const NVAPI = "https://nvapi.nicovideo.jp";

export type VideoSearchSortKey =
  | "registeredAt"
  | "viewCount"
  | "lastCommentTime"
  | "commentCount"
  | "likeCount"
  | "mylistCount"
  | "duration"
  | "hot"
  | "personalized";

export type VideoSearchSortOrder = "asc" | "desc" | "none";

export type ChannelVideoListingStatus = "included" | "excluded" | "only";

export interface VideoSearchParams extends RequestOptions {
  keyword?: string | undefined;
  tag?: string | undefined;
  pageSize?: number | undefined;
  page?: number | undefined;
  sortKey?: VideoSearchSortKey | undefined;
  sortOrder?: VideoSearchSortOrder | undefined;
  sensitiveContents?: SensitiveContents | undefined;
  genres?: readonly string[] | undefined;
  channelVideoListingStatus?: ChannelVideoListingStatus | undefined;
  allowFutureContents?: boolean | undefined;
  minRegisteredAt?: string | undefined;
  maxRegisteredAt?: string | undefined;
  maxDuration?: number | undefined;
}

export interface SearchAdditionalTag {
  text: string;
  type: string;
}

export interface VideoSearchResult {
  searchId: string;
  keyword: string | null;
  tag: string | null;
  genres: Genre[];
  totalCount: number;
  hasNext: boolean;
  items: EssentialVideo[];
  additionalTags: SearchAdditionalTag[];
}

export type FacetParams = Omit<VideoSearchParams, "pageSize" | "page" | "sortKey" | "sortOrder">;

export interface FacetResult {
  items: Array<{ genre: Genre; count: number }>;
}

export type UserSearchSortKey = "_personalized" | "followerCount" | "videoCount" | "liveCount";

export interface UserSearchParams extends RequestOptions {
  keyword: string;
  sortKey?: UserSearchSortKey | undefined;
  pageSize?: number | undefined;
  page?: number | undefined;
}

export interface SearchUser extends MinimalUser {
  followerCount?: number;
  videoCount?: number;
  liveCount?: number;
}

export interface UserSearchResult {
  requestId: string;
  totalCount: number;
  hasNext: boolean;
  items: SearchUser[];
}

export type ListSearchSortKey = "_hotTotalScore" | "videoCount" | "startTime";
export type ListType = "mylist" | "series";

export interface ListSearchParams extends RequestOptions {
  keyword: string;
  sortKey?: ListSearchSortKey | undefined;
  types?: ListType | undefined;
  pageSize?: number | undefined;
  page?: number | undefined;
}

export interface SearchListItem {
  id: number;
  type: ListType;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  videoCount?: number;
  owner?: Owner;
  followerCount?: number;
  isFollowing?: boolean;
  lastVideoAddedAt?: string;
  [k: string]: unknown;
}

export interface ListSearchResult {
  searchId: string;
  totalCount: number;
  hasNext: boolean;
  items: SearchListItem[];
}

export interface NewArrivalParams extends RequestOptions {
  pageSize: number;
  page: number;
  sensitiveContents?: SensitiveContents | undefined;
}

export interface NewArrivalResult {
  hasNext: boolean;
  items: EssentialVideo[];
  createdAt: string | null;
}

export interface SearchApi {
  searchVideos(params: VideoSearchParams): Promise<VideoSearchResult>;
  searchFacets(params: FacetParams): Promise<FacetResult>;
  searchUsers(params: UserSearchParams): Promise<UserSearchResult>;
  searchLists(params: ListSearchParams): Promise<ListSearchResult>;
  getNewArrivalVideos(params: NewArrivalParams): Promise<NewArrivalResult>;
  iterateVideos(params?: VideoSearchParams & { maxItems?: number | undefined }): AsyncGenerator<EssentialVideo>;
}

function requireQuery(method: string, params: { keyword?: string | undefined; tag?: string | undefined }): void {
  if (params.keyword === undefined && params.tag === undefined) {
    throw new NiconicoError(`${method}: either keyword or tag is required`);
  }
}

export function createSearchApi(http: NiconicoHttp): SearchApi {
  const api: SearchApi = {
    async searchVideos(params) {
      requireQuery("searchVideos", params);
      const query = buildQuery({
        keyword: params.keyword,
        tag: params.tag,
        pageSize: params.pageSize,
        page: params.page,
        sortKey: params.sortKey ?? "hot",
        sortOrder: params.sortOrder ?? "none",
        sensitiveContents: params.sensitiveContents,
        genres: params.genres,
        channelVideoListingStatus: params.channelVideoListingStatus,
        allowFutureContents: params.allowFutureContents,
        minRegisteredAt: params.minRegisteredAt,
        maxRegisteredAt: params.maxRegisteredAt,
        maxDuration: params.maxDuration,
      });
      const res = await http.getJson<{
        data: {
          searchId: string;
          keyword: string | null;
          tag: string | null;
          genres?: Genre[];
          totalCount?: number;
          hasNext?: boolean;
          items?: EssentialVideo[];
          additionals?: { tags?: SearchAdditionalTag[] };
        };
      }>(`${NVAPI}/v2/search/video${query}`, pickRequestOptions(params));
      return {
        searchId: res.data.searchId,
        keyword: res.data.keyword,
        tag: res.data.tag,
        genres: res.data.genres ?? [],
        totalCount: res.data.totalCount ?? 0,
        hasNext: res.data.hasNext ?? false,
        items: res.data.items ?? [],
        additionalTags: res.data.additionals?.tags ?? [],
      };
    },

    async searchFacets(params) {
      requireQuery("searchFacets", params);
      const query = buildQuery({
        keyword: params.keyword,
        tag: params.tag,
        sensitiveContents: params.sensitiveContents,
        genres: params.genres,
        channelVideoListingStatus: params.channelVideoListingStatus,
        allowFutureContents: params.allowFutureContents,
        minRegisteredAt: params.minRegisteredAt,
        maxRegisteredAt: params.maxRegisteredAt,
        maxDuration: params.maxDuration,
      });
      const res = await http.getJson<{ data: { items?: Array<{ genre: Genre; count: number }> } }>(
        `${NVAPI}/v2/search/facet${query}`,
        pickRequestOptions(params),
      );
      return { items: res.data.items ?? [] };
    },

    async searchUsers(params) {
      const query = buildQuery({
        keyword: params.keyword,
        sortKey: params.sortKey,
        pageSize: params.pageSize,
        page: params.page,
      });
      const res = await http.getJson<{
        data: { requestId: string; totalCount?: number; hasNext?: boolean; items?: SearchUser[] };
      }>(`${NVAPI}/v1/search/user${query}`, pickRequestOptions(params));
      return {
        requestId: res.data.requestId,
        totalCount: res.data.totalCount ?? 0,
        hasNext: res.data.hasNext ?? false,
        items: res.data.items ?? [],
      };
    },

    async searchLists(params) {
      const query = buildQuery({
        keyword: params.keyword,
        sortKey: params.sortKey,
        types: params.types,
        pageSize: params.pageSize,
        page: params.page,
      });
      const res = await http.getJson<{
        data: { searchId: string; totalCount?: number; hasNext?: boolean; items?: SearchListItem[] };
      }>(`${NVAPI}/v1/search/list${query}`, pickRequestOptions(params));
      return {
        searchId: res.data.searchId,
        totalCount: res.data.totalCount ?? 0,
        hasNext: res.data.hasNext ?? false,
        items: res.data.items ?? [],
      };
    },

    async getNewArrivalVideos(params) {
      const query = buildQuery({
        pageSize: params.pageSize,
        page: params.page,
        sensitiveContents: params.sensitiveContents ?? "mask",
      });
      const res = await http.getJson<{
        data: { hasNext?: boolean; items?: EssentialVideo[]; createdAt?: string | null };
      }>(`${NVAPI}/v1/new-arrival/videos${query}`, pickRequestOptions(params));
      return {
        hasNext: res.data.hasNext ?? false,
        items: res.data.items ?? [],
        createdAt: res.data.createdAt ?? null,
      };
    },

    async *iterateVideos(params = {}) {
      if (params.maxItems !== undefined && params.maxItems <= 0) return;
      const pageSize = params.pageSize ?? 100;
      let page = params.page ?? 1;
      let yielded = 0;
      for (;;) {
        const result = await api.searchVideos({ ...params, pageSize, page });
        for (const video of result.items) {
          yield video;
          yielded += 1;
          if (params.maxItems !== undefined && yielded >= params.maxItems) return;
        }
        if (!result.hasNext || result.items.length === 0) return;
        page += 1;
      }
    },
  };

  return api;
}
