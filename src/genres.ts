import type { NiconicoHttp, RequestOptions } from "./http.js";
import type { Genre } from "./types.js";

const NVAPI = "https://nvapi.nicovideo.jp";

export interface PopularTagsResult {
  startAt: string | null;
  tags: string[];
}

export interface GenresApi {
  getGenres(options?: RequestOptions): Promise<Genre[]>;
  getPopularTags(genreKey: string, options?: RequestOptions): Promise<PopularTagsResult>;
}

export function createGenresApi(http: NiconicoHttp): GenresApi {
  return {
    async getGenres(options = {}) {
      const res = await http.getJson<{ data: { genres?: Genre[] } }>(`${NVAPI}/v2/genres`, options);
      return res.data.genres ?? [];
    },

    async getPopularTags(genreKey, options = {}) {
      const res = await http.getJson<{ data: { startAt?: string; tags?: string[] } }>(
        `${NVAPI}/v1/genres/${encodeURIComponent(genreKey)}/popular-tags`,
        options,
      );
      return { startAt: res.data.startAt ?? null, tags: res.data.tags ?? [] };
    },
  };
}
