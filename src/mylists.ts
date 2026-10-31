import { NiconicoError } from "./errors.js";
import { buildQuery, NICOVIDEO_ORIGIN, type NiconicoHttp, type RequestOptions, pickRequestOptions } from "./http.js";
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
  memo?: string;
  decoratedMemoHtml?: string;
  description?: string;
  addedAt?: string;
  status?: string;
  video: EssentialVideo;
}

export interface MylistCompact {
  id: number;
  isPublic: boolean;
  name: string;
  description: string;
  createdAt?: string;
}

export interface MyMylistsParams extends RequestOptions {
  sampleItemCount?: number | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  title?: string | undefined;
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

export interface UpdateMylistParams extends RequestOptions {
  mylistId: number | string;
  name: string;
  description: string;
  isPublic: boolean;
  defaultSortKey: MylistSortKey;
  defaultSortOrder: SortOrder;
}

export interface MylistsApi {
  getMylist(mylistId: number | string, params?: MylistGetParams): Promise<MylistDetail>;
  iterateMylistItems(mylistId: number | string, params?: MylistGetParams): AsyncGenerator<MylistItem>;
  getMyMylist(mylistId: number | string, params?: MylistGetParams): Promise<MylistDetail>;
  iterateMyMylistItems(mylistId: number | string, params?: MylistGetParams): AsyncGenerator<MylistItem>;
  getMyMylists(params?: MyMylistsParams): Promise<{ totalCount: number; hasNext: boolean; mylists: MylistMeta[] }>;
  getMyMylistsCompact(options?: RequestOptions): Promise<MylistCompact[]>;
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
  addWatchLater(
    watchId: string,
    params?: RequestOptions & { memo?: string | undefined },
  ): Promise<WatchLaterItem | undefined>;
  removeWatchLater(items: readonly (number | string)[], options?: RequestOptions): Promise<void>;
}

type MylistEnvelope = {
  data: {
    mylist: MylistMeta & {
      items?: MylistItem[];
      totalItemCount?: number;
      hasNext?: boolean;
      hasInvisibleItems?: boolean;
    };
  };
};

const NUMERIC_ID = /^\d+$/;

export function createMylistsApi(http: NiconicoHttp): MylistsApi {
  function write(url: string, method: "POST" | "PUT" | "DELETE", options: RequestOptions): Promise<{ data?: unknown }> {
    return http.sendJson<{ data?: unknown }>(url, method, undefined, {
      ...options,
      headers: { ...WRITE_HEADERS, ...options.headers },
    });
  }

  function writeForm<T>(
    url: string,
    method: "POST" | "PUT",
    form: Readonly<Record<string, string | boolean>>,
    options: RequestOptions,
  ): Promise<T> {
    return http.sendForm<T>(url, method, form, { ...options, headers: { ...WRITE_HEADERS, ...options.headers } });
  }

  async function readMylist(path: string, params: MylistGetParams): Promise<MylistDetail> {
    const query = buildQuery({
      pageSize: params.pageSize,
      page: params.page,
      sortKey: params.sortKey,
      sortOrder: params.sortOrder,
    });
    const res = await http.getJson<MylistEnvelope>(`${NVAPI}${path}${query}`, pickRequestOptions(params));
    const mylist = res.data.mylist;
    const items = mylist.items ?? [];
    return {
      ...mylist,
      items,
      totalItemCount: mylist.totalItemCount ?? items.length,
      hasNext: mylist.hasNext ?? false,
    };
  }

  async function* iterateItems(
    read: (params: MylistGetParams) => Promise<MylistDetail>,
    params: MylistGetParams,
  ): AsyncGenerator<MylistItem> {
    const pageSize = params.pageSize ?? 100;
    let page = params.page ?? 1;
    for (;;) {
      const result = await read({ ...params, pageSize, page });
      for (const item of result.items) yield item;
      if (!result.hasNext || result.items.length === 0) return;
      page += 1;
    }
  }

  async function resolveWatchLaterItemIds(
    items: readonly (number | string)[],
    options: RequestOptions,
  ): Promise<string[]> {
    const itemIds: string[] = [];
    const wanted = new Set<string>();
    for (const item of items) {
      const value = String(item).trim();
      if (NUMERIC_ID.test(value)) itemIds.push(value);
      else wanted.add(value);
    }
    for (let page = 1; wanted.size > 0; page += 1) {
      const result = await api.getMyWatchLater({ ...pickRequestOptions(options), pageSize: 100, page });
      for (const entry of result.items) {
        const watchId = entry.watchId ?? entry.video.id;
        if (entry.itemId !== undefined && wanted.delete(watchId)) itemIds.push(String(entry.itemId));
      }
      if (!result.hasNext || result.items.length === 0) break;
    }
    if (wanted.size > 0) {
      throw new NiconicoError(`removeWatchLater: not in watch-later: ${[...wanted].join(", ")}`);
    }
    return itemIds;
  }

  const api: MylistsApi = {
    getMylist(mylistId, params = {}) {
      return readMylist(`/v2/mylists/${encodeURIComponent(String(mylistId))}`, params);
    },

    iterateMylistItems(mylistId, params = {}) {
      return iterateItems((page) => api.getMylist(mylistId, page), params);
    },

    getMyMylist(mylistId, params = {}) {
      return readMylist(`/v1/users/me/mylists/${encodeURIComponent(String(mylistId))}`, params);
    },

    iterateMyMylistItems(mylistId, params = {}) {
      return iterateItems((page) => api.getMyMylist(mylistId, page), params);
    },

    async getMyMylists(params = {}) {
      const query = buildQuery({
        sampleItemCount: params.sampleItemCount,
        page: params.page,
        pageSize: params.pageSize,
        title: params.title,
      });
      const res = await http.getJson<{
        data: { totalCount?: number; hasNext?: boolean; mylists?: MylistMeta[] };
      }>(`${NVAPI}/v1/users/me/mylists${query}`, pickRequestOptions(params));
      const mylists = res.data.mylists ?? [];
      return {
        totalCount: res.data.totalCount ?? mylists.length,
        hasNext: res.data.hasNext ?? false,
        mylists,
      };
    },

    async getMyMylistsCompact(options = {}) {
      const res = await http.getJson<{ data: { mylists?: MylistCompact[] } }>(
        `${NVAPI}/v1/users/me/mylists/compact`,
        options,
      );
      return res.data.mylists ?? [];
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
      }>(`${NVAPI}/v1/users/me/watch-later${query}`, pickRequestOptions(params));
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
      const res = await writeForm<{ data?: { mylistId?: number } }>(
        `${NVAPI}/v1/users/me/mylists`,
        "POST",
        {
          name: params.name,
          description: params.description ?? "",
          isPublic: params.isPublic ?? false,
          defaultSortKey: params.defaultSortKey ?? "addedAt",
          defaultSortOrder: params.defaultSortOrder ?? "desc",
        },
        pickRequestOptions(params),
      );
      const mylistId = res.data?.mylistId;
      if (mylistId === undefined) {
        throw new NiconicoError("createMylist: the response carried no mylistId");
      }
      return mylistId;
    },

    async updateMylist(params) {
      await writeForm(
        `${NVAPI}/v1/users/me/mylists/${encodeURIComponent(String(params.mylistId))}`,
        "PUT",
        {
          name: params.name,
          description: params.description,
          isPublic: params.isPublic,
          defaultSortKey: params.defaultSortKey,
          defaultSortOrder: params.defaultSortOrder,
        },
        pickRequestOptions(params),
      );
    },

    async deleteMylist(mylistId, options = {}) {
      await write(`${NVAPI}/v1/users/me/mylists/${encodeURIComponent(String(mylistId))}`, "DELETE", options);
    },

    async addMylistItem(mylistId, watchId, params = {}) {
      const query = buildQuery({ itemId: watchId, description: params.description ?? "" });
      await write(
        `${NVAPI}/v1/users/me/mylists/${encodeURIComponent(String(mylistId))}/items${query}`,
        "POST",
        pickRequestOptions(params),
      );
    },

    async removeMylistItems(mylistId, itemIds, options = {}) {
      if (itemIds.length === 0) return;
      const query = buildQuery({ itemIds: itemIds.map(String).join(",") });
      await write(
        `${NVAPI}/v1/users/me/mylists/${encodeURIComponent(String(mylistId))}/items${query}`,
        "DELETE",
        options,
      );
    },

    async addWatchLater(watchId, params = {}) {
      const res = await writeForm<{ data?: { watchLater?: { item?: WatchLaterItem } } }>(
        `${NVAPI}/v1/users/me/watch-later`,
        "POST",
        { watchId, memo: params.memo ?? "" },
        pickRequestOptions(params),
      );
      return res.data?.watchLater?.item;
    },

    async removeWatchLater(items, options = {}) {
      if (items.length === 0) return;
      const itemIds = await resolveWatchLaterItemIds(items, options);
      await write(`${NVAPI}/v1/users/me/watch-later${buildQuery({ itemIds: itemIds.join(",") })}`, "DELETE", options);
    },
  };

  return api;
}
