import { buildQuery, type NiconicoHttp, type RequestOptions } from "./http.js";
import type { EssentialVideo } from "./types.js";

const NVAPI = "https://nvapi.nicovideo.jp";

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
        { signal: params.signal },
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
  };

  return api;
}
