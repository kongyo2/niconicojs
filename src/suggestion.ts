import type { NiconicoHttp, RequestOptions } from "./http.js";

export interface SuggestionApi {
  expand(query: string, options?: RequestOptions): Promise<string[]>;
}

export function createSuggestionApi(http: NiconicoHttp): SuggestionApi {
  return {
    async expand(query, options = {}) {
      const url = `https://sug.search.nicovideo.jp/suggestion/expand/${encodeURIComponent(query)}`;
      const res = await http.getJson<{ candidates?: string[] }>(url, {
        validateMeta: false,
        ...options,
      });
      return res.candidates ?? [];
    },
  };
}
