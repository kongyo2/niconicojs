import { buildQuery, NICOVIDEO_ORIGIN, type NiconicoHttp, type RequestOptions, pickRequestOptions } from "./http.js";
import type { EssentialVideo } from "./types.js";

const NVAPI = "https://nvapi.nicovideo.jp";
const WRITE_HEADERS: Record<string, string> = { "X-Request-With": NICOVIDEO_ORIGIN };

export type WatchHistoryContentType = "long" | "short";

export interface WatchHistoryItem {
  itemId?: string;
  viewedAt?: string;
  isMaybeLikeUserItem?: boolean;
  video: EssentialVideo;
}

export interface WatchHistoryResult {
  items: WatchHistoryItem[];
  nextCursor: string | undefined;
}

export interface WatchHistoryParams extends RequestOptions {
  limit?: number | undefined;
  cursor?: string | undefined;
  selectContentType?: WatchHistoryContentType | undefined;
}

export interface HistoryApi {
  getMyWatchHistory(params?: WatchHistoryParams): Promise<WatchHistoryResult>;
  iterateMyWatchHistory(params?: WatchHistoryParams): AsyncGenerator<WatchHistoryItem>;
  removeMyWatchHistory(videoId: string, options?: RequestOptions): Promise<string[]>;
}

export function createHistoryApi(http: NiconicoHttp): HistoryApi {
  const base = `${NVAPI}/v2/users/me/watch/history`;

  const api: HistoryApi = {
    async getMyWatchHistory(params = {}) {
      const query = buildQuery({
        selectContentType: params.selectContentType ?? "long",
        limit: params.limit,
        cursor: params.cursor !== undefined && params.cursor.length > 0 ? params.cursor : undefined,
      });
      const res = await http.getJson<{ data?: { items?: WatchHistoryItem[]; nextCursor?: string } }>(
        `${base}${query}`,
        pickRequestOptions(params),
      );
      return { items: res.data?.items ?? [], nextCursor: res.data?.nextCursor };
    },

    async *iterateMyWatchHistory(params = {}) {
      let cursor = params.cursor;
      for (;;) {
        const page: WatchHistoryParams = { ...params };
        if (cursor !== undefined) page.cursor = cursor;
        const result = await api.getMyWatchHistory(page);
        for (const item of result.items) yield item;
        if (result.items.length === 0 || result.nextCursor === undefined || result.nextCursor === cursor) {
          return;
        }
        cursor = result.nextCursor;
      }
    },

    async removeMyWatchHistory(videoId, options = {}) {
      const res = await http.sendJson<{ data?: { deletedItemIds?: string[] } }>(
        `${base}${buildQuery({ target: videoId })}`,
        "DELETE",
        undefined,
        { ...options, headers: { ...WRITE_HEADERS, ...options.headers } },
      );
      return res.data?.deletedItemIds ?? [];
    },
  };

  return api;
}
