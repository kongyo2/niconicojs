import { buildQuery, NICOVIDEO_ORIGIN, type NiconicoHttp, type RequestOptions, pickRequestOptions } from "./http.js";
import type { EssentialVideo } from "./types.js";

const NVAPI = "https://nvapi.nicovideo.jp";
const WRITE_HEADERS: Record<string, string> = { "X-Request-With": NICOVIDEO_ORIGIN };

export interface LikedItem {
  likedAt?: string;
  status?: string;
  video: EssentialVideo;
  [k: string]: unknown;
}

export interface LikesResult {
  items: LikedItem[];
  hasNext: boolean;
  getNextPageNgReason: string | null;
}

export interface LikesApi {
  getMyLikes(
    params?: RequestOptions & { pageSize?: number | undefined; page?: number | undefined },
  ): Promise<LikesResult>;
  like(videoId: string, options?: RequestOptions): Promise<void>;
  unlike(videoId: string, options?: RequestOptions): Promise<void>;
}

export function createLikesApi(http: NiconicoHttp): LikesApi {
  return {
    async getMyLikes(params = {}) {
      const query = buildQuery({ pageSize: params.pageSize, page: params.page });
      const res = await http.getJson<{
        data: {
          items?: LikedItem[];
          summary?: { hasNext?: boolean; canGetNextPage?: boolean; getNextPageNgReason?: string | null };
        };
      }>(`${NVAPI}/v1/users/me/likes${query}`, pickRequestOptions(params));
      return {
        items: res.data.items ?? [],
        hasNext: res.data.summary?.hasNext ?? false,
        getNextPageNgReason: res.data.summary?.getNextPageNgReason ?? null,
      };
    },

    async like(videoId, options = {}) {
      await http.sendJson(`${NVAPI}/v1/users/me/likes/items${buildQuery({ videoId })}`, "POST", undefined, {
        ...options,
        headers: { ...WRITE_HEADERS, ...options.headers },
      });
    },

    async unlike(videoId, options = {}) {
      await http.sendJson(`${NVAPI}/v1/users/me/likes/items${buildQuery({ videoId })}`, "DELETE", undefined, {
        ...options,
        headers: { ...WRITE_HEADERS, ...options.headers },
      });
    },
  };
}
