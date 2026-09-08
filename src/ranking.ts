import { NiconicoError } from "./errors.js";
import { buildQuery, type NiconicoHttp, type RequestOptions, pickRequestOptions } from "./http.js";
import type { EssentialVideo } from "./types.js";

export type RankingTerm = "hour" | "24h" | "week" | "month" | "total";

export const RANKING_ALL_KEY = "e9uj2uks";

export interface RankingGenre {
  featuredKey: string;
  label: string;
  isEnabledTrendTag: boolean;
  isMajorFeatured: boolean;
  isTopLevel: boolean;
  isImmoral: boolean;
  isEnabled: boolean;
}

export interface RankingPagination {
  page: number;
  pageSize: number;
  totalCount: number;
  maxPage: number | null;
}

export interface RankingNewsItem {
  rank: number;
  id: string;
  title: string;
  link: string;
  thumbnailUrl: string;
  commentCount: number;
}

export interface RankingPageInfo {
  pagination: RankingPagination;
  currentTag: string | null;
  currentTerm: RankingTerm;
  availableTerms: Array<{ label: string; value: string }>;
  niconewsRanking?: RankingNewsItem[];
  foryouRanking?: {
    recommendId: string;
    featuredKey: string;
    label: string;
    tag: string | null;
    items: EssentialVideo[];
  } | null;
  [k: string]: unknown;
}

export interface RankingResult {
  featuredKey: string;
  label: string;
  tag: string | null;
  items: EssentialVideo[];
  hasNext: boolean;
  maxItemCount: number | undefined;
  trendTags: string[];
  pagination: RankingPagination | undefined;
  page: RankingPageInfo | undefined;
  genres: RankingGenre[];
}

export interface RankingParams extends RequestOptions {
  featuredKey?: string | undefined;
  term?: RankingTerm | undefined;
  tag?: string | undefined;
  page?: number | undefined;
}

export interface RankingApi {
  getRanking(params?: RankingParams): Promise<RankingResult>;
  getRankingGenres(options?: RequestOptions): Promise<RankingGenre[]>;
  getTrendTags(featuredKey: string, options?: RequestOptions): Promise<string[]>;
  iterateRanking(params?: RankingParams & { maxItems?: number | undefined }): AsyncGenerator<EssentialVideo>;
}

interface BffResponse {
  data?: {
    response?: {
      $getTeibanRanking?: {
        data?: {
          featuredKey?: string;
          label?: string;
          tag?: string | null;
          maxItemCount?: number;
          items?: EssentialVideo[];
          hasNext?: boolean;
        };
      };
      $getTeibanRankingFeaturedKeyAndTrendTags?: { data?: { trendTags?: string[] } };
      $getTeibanRankingFeaturedKeys?: { data?: { items?: RankingGenre[] } };
      page?: RankingPageInfo;
    };
  };
}

export function createRankingApi(http: NiconicoHttp): RankingApi {
  const base = "https://www.nicovideo.jp/ranking/genre";

  function fetchBff(featuredKey: string, params: RankingParams): Promise<BffResponse> {
    const query = buildQuery({
      responseType: "json",
      term: params.term,
      tag: params.tag !== undefined && params.tag.length > 0 ? params.tag : undefined,
      page: params.page,
    });
    return http.getJson<BffResponse>(`${base}/${encodeURIComponent(featuredKey)}${query}`, {
      ...pickRequestOptions(params),
      validateMeta: false,
    });
  }

  const api: RankingApi = {
    async getRanking(params = {}) {
      const featuredKey = params.featuredKey ?? RANKING_ALL_KEY;
      const res = await fetchBff(featuredKey, params);
      const response = res.data?.response;
      const ranking = response?.$getTeibanRanking?.data;
      if (ranking === undefined) {
        throw new NiconicoError(`ranking BFF returned no data for featuredKey=${featuredKey}`);
      }
      return {
        featuredKey: ranking.featuredKey ?? featuredKey,
        label: ranking.label ?? "",
        tag: ranking.tag ?? null,
        items: ranking.items ?? [],
        hasNext: ranking.hasNext ?? false,
        maxItemCount: ranking.maxItemCount,
        trendTags: response?.$getTeibanRankingFeaturedKeyAndTrendTags?.data?.trendTags ?? [],
        pagination: response?.page?.pagination,
        page: response?.page,
        genres: response?.$getTeibanRankingFeaturedKeys?.data?.items ?? [],
      };
    },

    async getRankingGenres(options = {}) {
      const res = await fetchBff(RANKING_ALL_KEY, options);
      const items = res.data?.response?.$getTeibanRankingFeaturedKeys?.data?.items ?? [];
      return items.filter((genre) => genre.isEnabled);
    },

    async getTrendTags(featuredKey, options = {}) {
      const res = await fetchBff(featuredKey, options);
      return res.data?.response?.$getTeibanRankingFeaturedKeyAndTrendTags?.data?.trendTags ?? [];
    },

    async *iterateRanking(params = {}) {
      if (params.maxItems !== undefined && params.maxItems <= 0) return;
      let page = params.page ?? 1;
      let yielded = 0;
      for (;;) {
        const result = await api.getRanking({ ...params, page });
        for (const video of result.items) {
          yield video;
          yielded += 1;
          if (params.maxItems !== undefined && yielded >= params.maxItems) return;
        }
        if (!result.hasNext || result.items.length === 0) return;
        const maxPage = result.pagination?.maxPage;
        if (maxPage !== null && maxPage !== undefined && page >= maxPage) return;
        page += 1;
      }
    },
  };

  return api;
}
