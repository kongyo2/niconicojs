import { buildQuery, NICOVIDEO_ORIGIN, type NiconicoHttp, type RequestOptions } from "./http.js";
import type { EssentialVideo, MylistItem, MylistMeta, SortOrder } from "./types.js";

const NVAPI = "https://nvapi.nicovideo.jp";

const WRITE_HEADERS: Record<string, string> = { "X-Request-With": NICOVIDEO_ORIGIN };

export type MylistSortKey =
  | "addedAt"
  | "title"
  | "mylistComment"
  | "registeredAt"
  | "viewCount"
  | "lastComment"
  | "commentCount"
  | "likeCount"
  | "mylistCount"
  | "duration";

export interface MylistGetParams extends RequestOptions {
  pageSize?: number | undefined;
  page?: number | undefined;
  sortKey?: MylistSortKey | undefined;
  sortOrder?: SortOrder | undefined;
}

export interface MylistDetail extends MylistMeta {
  items: MylistItem[];
  totalItemCount: number;
  hasNext: boolean;
  hasInvisibleItems?: boolean;
}

export interface WatchLaterItem {
  itemId?: number;
  watchId?: string;
  description?: string;
  addedAt?: string;
  status?: string;
  video: EssentialVideo;
}

export interface WatchLaterResult {
  items: WatchLaterItem[];
  hasInvisibleItems: boolean;
  totalCount: number;
  hasNext: boolean;
}

export interface CreateMylistParams extends RequestOptions {
  name: string;
  description?: string | undefined;
  isPublic?: boolean | undefined;
  defaultSortKey?: MylistSortKey | undefined;
  defaultSortOrder?: SortOrder | undefined;
}

export interface UpdateMylistParams extends CreateMylistParams {
  mylistId: number | string;
}

export interface MylistsApi {
  getMylist(mylistId: number | string, params?: MylistGetParams): Promise<MylistDetail>;
  iterateMylistItems(mylistId: number | string, params?: MylistGetParams): AsyncGenerator<MylistItem>;
  getMyMylists(
    params?: RequestOptions & { sampleItemCount?: number | undefined },
  ): Promise<{ totalCount: number; hasNext: boolean; mylists: MylistMeta[] }>;
  getMyWatchLater(
    params?: RequestOptions & {
      pageSize?: number | undefined;
      page?: number | undefined;
      sortKey?: MylistSortKey | undefined;
      sortOrder?: SortOrder | undefined;
    },
  ): Promise<WatchLaterResult>;
  createMylist(params: CreateMylistParams): Promise<number>;
  updateMylist(params: UpdateMylistParams): Promise<void>;
  deleteMylist(mylistId: number | string, options?: RequestOptions): Promise<void>;
  addMylistItem(
    mylistId: number | string,
    watchId: string,
    params?: RequestOptions & { description?: string | undefined },
  ): Promise<void>;
  removeMylistItems(
    mylistId: number | string,
    itemIds: readonly (number | string)[],
    options?: RequestOptions,
  ): Promise<void>;
  addWatchLater(watchId: string, options?: RequestOptions): Promise<void>;
  removeWatchLater(watchIds: readonly string[], options?: RequestOptions): Promise<void>;
}

export function createMylistsApi(http: NiconicoHttp): MylistsApi {
  function write(url: string, method: "POST" | "PUT" | "DELETE", options: RequestOptions): Promise<{ data?: unknown }> {
    return http.sendJson<{ data?: unknown }>(url, method, undefined, {
      ...options,
      headers: { ...WRITE_HEADERS, ...options.headers },
    });
  }

  const api: MylistsApi = {
    async getMylist(mylistId, params = {}) {
      const query = buildQuery({
        pageSize: params.pageSize,
        page: params.page,
        sortKey: params.sortKey,
        sortOrder: params.sortOrder,
      });
      const res = await http.getJson<{
        data: {
          mylist: MylistMeta & {
            items?: MylistItem[];
            totalItemCount?: number;
            hasNext?: boolean;
            hasInvisibleItems?: boolean;
          };
        };
      }>(`${NVAPI}/v2/mylists/${encodeURIComponent(String(mylistId))}${query}`, { signal: params.signal });
      const mylist = res.data.mylist;
      const items = mylist.items ?? [];
      return {
        ...mylist,
        items,
        totalItemCount: mylist.totalItemCount ?? items.length,
        hasNext: mylist.hasNext ?? false,
      };
    },

    async *iterateMylistItems(mylistId, params = {}) {
      const pageSize = params.pageSize ?? 100;
      let page = params.page ?? 1;
      for (;;) {
        const result = await api.getMylist(mylistId, { ...params, pageSize, page });
        for (const item of result.items) yield item;
        if (!result.hasNext || result.items.length === 0) return;
        page += 1;
      }
    },

    async getMyMylists(params = {}) {
      const query = buildQuery({ sampleItemCount: params.sampleItemCount });
      const res = await http.getJson<{
        data: { totalCount?: number; hasNext?: boolean; mylists?: MylistMeta[] };
      }>(`${NVAPI}/v1/users/me/mylists${query}`, { signal: params.signal });
      const mylists = res.data.mylists ?? [];
      return {
        totalCount: res.data.totalCount ?? mylists.length,
        hasNext: res.data.hasNext ?? false,
        mylists,
      };
    },

    async getMyWatchLater(params = {}) {
      const query = buildQuery({
        pageSize: params.pageSize,
        page: params.page,
        sortKey: params.sortKey,
        sortOrder: params.sortOrder,
      });
      const res = await http.getJson<{
        data: {
          watchLater?: {
            items?: WatchLaterItem[];
            hasInvisibleItems?: boolean;
            totalCount?: number;
            hasNext?: boolean;
          };
        };
      }>(`${NVAPI}/v1/users/me/watch-later${query}`, { signal: params.signal });
      const watchLater = res.data.watchLater;
      const items = watchLater?.items ?? [];
      return {
        items,
        hasInvisibleItems: watchLater?.hasInvisibleItems ?? false,
        totalCount: watchLater?.totalCount ?? items.length,
        hasNext: watchLater?.hasNext ?? false,
      };
    },

    async createMylist(params) {
      const query = buildQuery({
        name: params.name,
        description: params.description ?? "",
        isPublic: params.isPublic ?? false,
        defaultSortKey: params.defaultSortKey ?? "addedAt",
        defaultSortOrder: params.defaultSortOrder ?? "desc",
      });
      const res = await http.sendJson<{ data?: { mylistId?: number } }>(
        `${NVAPI}/v1/users/me/mylists${query}`,
        "POST",
        undefined,
        { headers: WRITE_HEADERS, signal: params.signal },
      );
      return res.data?.mylistId ?? 0;
    },

    async updateMylist(params) {
      const query = buildQuery({
        name: params.name,
        description: params.description ?? "",
        isPublic: params.isPublic ?? false,
        defaultSortKey: params.defaultSortKey ?? "addedAt",
        defaultSortOrder: params.defaultSortOrder ?? "desc",
      });
      await write(`${NVAPI}/v1/users/me/mylists/${encodeURIComponent(String(params.mylistId))}${query}`, "PUT", {
        signal: params.signal,
      });
    },

    async deleteMylist(mylistId, options = {}) {
      await write(`${NVAPI}/v1/users/me/mylists/${encodeURIComponent(String(mylistId))}`, "DELETE", options);
    },

    async addMylistItem(mylistId, watchId, params = {}) {
      const query = buildQuery({ itemId: watchId, description: params.description ?? "" });
      await write(`${NVAPI}/v1/users/me/mylists/${encodeURIComponent(String(mylistId))}/items${query}`, "POST", {
        signal: params.signal,
      });
    },

    async removeMylistItems(mylistId, itemIds, options = {}) {
      const query = buildQuery({ itemIds: itemIds.map(String) });
      await write(
        `${NVAPI}/v1/users/me/mylists/${encodeURIComponent(String(mylistId))}/items${query}`,
        "DELETE",
        options,
      );
    },

    async addWatchLater(watchId, options = {}) {
      await write(`${NVAPI}/v1/users/me/watch-later${buildQuery({ watchId })}`, "POST", options);
    },

    async removeWatchLater(watchIds, options = {}) {
      await write(`${NVAPI}/v1/users/me/watch-later${buildQuery({ watchIds: [...watchIds] })}`, "DELETE", options);
    },
  };

  return api;
}
