import { NiconicoError } from "./errors.js";
import { buildQuery, type NiconicoHttp, type RequestOptions } from "./http.js";
import type { EssentialVideo } from "./types.js";

const NVAPI = "https://nvapi.nicovideo.jp";
const NICOAD = "https://api.nicoad.nicovideo.jp";

export interface VideoLookupResult {
  watchId: string;
  video: EssentialVideo | null;
}

export interface RecommendItem {
  id: string;
  contentType?: string;
  content?: EssentialVideo;
  [k: string]: unknown;
}

export interface RecommendResult {
  recipeId: string;
  recommendId: string;
  items: RecommendItem[];
}

export interface NicoAdInfo {
  id: string;
  title: string;
  targetUrl: string;
  thumbnailUrl: string;
  totalPoint?: number;
  activePoint?: number;
  serverTime?: number;
  [k: string]: unknown;
}

export interface VideosApi {
  getVideo(watchId: string, options?: RequestOptions): Promise<EssentialVideo | null>;
  getVideos(
    watchIds: readonly string[],
    options?: RequestOptions & { concurrency?: number | undefined },
  ): Promise<VideoLookupResult[]>;
  getRecommendations(videoId: string, options?: RequestOptions): Promise<RecommendResult>;
  getNicoAd(videoId: string, options?: RequestOptions): Promise<NicoAdInfo>;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await task(item, index);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createVideosApi(http: NiconicoHttp): VideosApi {
  const api: VideosApi = {
    async getVideo(watchId, options = {}) {
      const res = await http.getJson<{
        data: { items?: Array<{ watchId: string; video?: EssentialVideo | null }> };
      }>(`${NVAPI}/v1/videos${buildQuery({ watchIds: watchId })}`, options);
      const entry = (res.data.items ?? []).find((item) => item.watchId === watchId) ?? res.data.items?.[0];
      return entry?.video ?? null;
    },

    async getVideos(watchIds, options = {}) {
      if (watchIds.length === 0) {
        throw new NiconicoError("getVideos: watchIds must not be empty");
      }
      const { concurrency, ...requestOptions } = options;
      return mapWithConcurrency(watchIds, concurrency ?? 4, async (watchId) => ({
        watchId,
        video: await api.getVideo(watchId, requestOptions),
      }));
    },

    async getRecommendations(videoId, options = {}) {
      const query = buildQuery({
        recipeId: "video_watch_recommendation",
        site: "nicovideo",
        videoId,
      });
      const res = await http.getJson<{
        data: { recipe?: { id?: string }; recommendId?: string; items?: RecommendItem[] };
      }>(`${NVAPI}/v1/recommend${query}`, options);
      return {
        recipeId: res.data.recipe?.id ?? "video_watch_recommendation",
        recommendId: res.data.recommendId ?? "",
        items: res.data.items ?? [],
      };
    },

    async getNicoAd(videoId, options = {}) {
      const res = await http.getJson<{ data?: NicoAdInfo }>(
        `${NICOAD}/v1/contents/video/${encodeURIComponent(videoId)}`,
        options,
      );
      if (res.data === undefined) {
        throw new NiconicoError(`nicoad: no data returned for ${videoId}`);
      }
      return res.data;
    },
  };

  return api;
}
