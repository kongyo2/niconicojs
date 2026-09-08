import { buildQuery, type NiconicoHttp, type RequestOptions, pickRequestOptions } from "./http.js";
import type {
  EssentialVideo,
  MinimalUser,
  MylistMeta,
  SensitiveContents,
  SeriesMeta,
  SortOrder,
  UserDetail,
  UserDetailWithRelationships,
  UserIdOrMe,
  UserRelationships,
} from "./types.js";

const NVAPI = "https://nvapi.nicovideo.jp";

export type UserVideosSortKey =
  "registeredAt" | "viewCount" | "lastCommentTime" | "commentCount" | "likeCount" | "mylistCount" | "duration";

export interface UserVideosParams extends RequestOptions {
  sortKey?: UserVideosSortKey | undefined;
  sortOrder?: SortOrder | undefined;
  pageSize?: number | undefined;
  page?: number | undefined;
  sensitiveContents?: SensitiveContents | undefined;
}

export interface UserVideosResult {
  totalCount: number;
  items: EssentialVideo[];
}

export interface UserSeriesResult {
  totalCount: number;
  items: SeriesMeta[];
}

export interface UserMylistsResult {
  totalCount: number;
  hasNext: boolean;
  mylists: MylistMeta[];
}

export type FollowUser = MinimalUser;

export interface FollowSummary {
  followees?: number;
  followers?: number;
  hasNext?: boolean;
  cursor?: string;
}

export interface FollowUsersResult {
  items: FollowUser[];
  summary: FollowSummary;
}

export interface FollowListParams extends RequestOptions {
  pageSize: number;
  page?: number | undefined;
  cursor?: string | undefined;
}

export interface CreatorSupportResult {
  isSupportable: boolean;
  canOpenCreatorSupport: boolean;
  defaultSupporterRegistrationAppealMessage?: string;
  supporterStatus: {
    isSupporting: boolean;
    isBanned: boolean;
  };
}

export interface UsersApi {
  getUser(userId: UserIdOrMe, options?: RequestOptions): Promise<UserDetailWithRelationships>;
  getUserVideos(userId: UserIdOrMe, params?: UserVideosParams): Promise<UserVideosResult>;
  getUserSeries(
    userId: UserIdOrMe,
    params?: RequestOptions & { pageSize?: number | undefined; page?: number | undefined },
  ): Promise<UserSeriesResult>;
  getUserMylists(
    userId: UserIdOrMe,
    params?: RequestOptions & { sampleItemCount?: number | undefined },
  ): Promise<UserMylistsResult>;
  getUserFollowing(userId: UserIdOrMe, params: FollowListParams): Promise<FollowUsersResult>;
  getUserFollowedBy(userId: UserIdOrMe, params: FollowListParams): Promise<FollowUsersResult>;
  getCreatorSupport(userId: UserIdOrMe, options?: RequestOptions): Promise<CreatorSupportResult>;
  iterateUserFollowing(userId: UserIdOrMe, params?: FollowListParams): AsyncGenerator<FollowUser>;
  iterateUserFollowedBy(userId: UserIdOrMe, params?: FollowListParams): AsyncGenerator<FollowUser>;
  iterateUserVideos(userId: UserIdOrMe, params?: UserVideosParams): AsyncGenerator<EssentialVideo>;
}

export function userPathSegment(userId: UserIdOrMe): string {
  return userId === "me" ? "me" : String(userId);
}

export function createUsersApi(http: NiconicoHttp): UsersApi {
  function followList(
    kind: "following" | "followed-by",
    userId: UserIdOrMe,
    params: FollowListParams,
  ): Promise<FollowUsersResult> {
    const query = buildQuery({ pageSize: params.pageSize, page: params.page, cursor: params.cursor });
    return http
      .getJson<{ data: { items?: FollowUser[]; summary?: FollowSummary } }>(
        `${NVAPI}/v1/users/${userPathSegment(userId)}/${kind}/users${query}`,
        pickRequestOptions(params),
      )
      .then((res) => ({ items: res.data.items ?? [], summary: res.data.summary ?? {} }));
  }

  async function* iterateFollows(
    kind: "following" | "followed-by",
    userId: UserIdOrMe,
    params: FollowListParams,
  ): AsyncGenerator<FollowUser> {
    let cursor = params.cursor;
    for (;;) {
      const page: FollowListParams = { ...params, pageSize: params.pageSize };
      if (cursor !== undefined) page.cursor = cursor;
      const result = await followList(kind, userId, page);
      for (const item of result.items) yield item;
      const next = result.summary.cursor;
      if (result.items.length === 0 || result.summary.hasNext !== true || next === undefined || next === cursor) {
        return;
      }
      cursor = next;
    }
  }

  const api: UsersApi = {
    async getUser(userId, options = {}) {
      const res = await http.getJson<{
        data: { user: UserDetail; relationships?: UserRelationships };
      }>(`${NVAPI}/v1/users/${userPathSegment(userId)}`, options);
      return { user: res.data.user, relationships: res.data.relationships ?? {} };
    },

    async getUserVideos(userId, params = {}) {
      const query = buildQuery({
        sortKey: params.sortKey,
        sortOrder: params.sortOrder,
        pageSize: params.pageSize,
        page: params.page,
        sensitiveContents: params.sensitiveContents,
      });
      const res = await http.getJson<{
        data: {
          totalCount?: number;
          items?: Array<{ series?: unknown; essential?: EssentialVideo }>;
        };
      }>(`${NVAPI}/v3/users/${userPathSegment(userId)}/videos${query}`, pickRequestOptions(params));
      const items = (res.data.items ?? [])
        .map((entry) => entry.essential)
        .filter((video): video is EssentialVideo => video !== undefined);
      return { totalCount: res.data.totalCount ?? items.length, items };
    },

    async getUserSeries(userId, params = {}) {
      const query = buildQuery({ pageSize: params.pageSize, page: params.page });
      const res = await http.getJson<{ data: { totalCount?: number; items?: SeriesMeta[] } }>(
        `${NVAPI}/v1/users/${userPathSegment(userId)}/series${query}`,
        pickRequestOptions(params),
      );
      const items = res.data.items ?? [];
      return { totalCount: res.data.totalCount ?? items.length, items };
    },

    async getUserMylists(userId, params = {}) {
      const query = buildQuery({ sampleItemCount: params.sampleItemCount });
      const res = await http.getJson<{
        data: { totalCount?: number; hasNext?: boolean; mylists?: MylistMeta[] };
      }>(`${NVAPI}/v1/users/${userPathSegment(userId)}/mylists${query}`, pickRequestOptions(params));
      const mylists = res.data.mylists ?? [];
      return {
        totalCount: res.data.totalCount ?? mylists.length,
        hasNext: res.data.hasNext ?? false,
        mylists,
      };
    },

    getUserFollowing(userId, params) {
      return followList("following", userId, params);
    },

    getUserFollowedBy(userId, params) {
      return followList("followed-by", userId, params);
    },

    async getCreatorSupport(userId, options = {}) {
      const res = await http.getJson<{ data: { creatorSupport: CreatorSupportResult } }>(
        `${NVAPI}/v1/users/${userPathSegment(userId)}/creator-support`,
        options,
      );
      return res.data.creatorSupport;
    },

    iterateUserFollowing(userId, params = { pageSize: 100 }) {
      return iterateFollows("following", userId, params);
    },

    iterateUserFollowedBy(userId, params = { pageSize: 100 }) {
      return iterateFollows("followed-by", userId, params);
    },

    async *iterateUserVideos(userId, params = {}) {
      const pageSize = params.pageSize ?? 100;
      const firstPage = params.page ?? 1;
      let page = firstPage;
      for (;;) {
        const result = await api.getUserVideos(userId, { ...params, pageSize, page });
        for (const video of result.items) yield video;
        if (page * pageSize >= result.totalCount) return;
        page += 1;
      }
    },
  };

  return api;
}
