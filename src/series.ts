import { buildQuery, type NiconicoHttp, type RequestOptions, pickRequestOptions } from "./http.js";
import type { SortOrder } from "./types.js";
import type { SeriesDetail, SeriesItem } from "./types.js";
import type { MylistSortKey } from "./mylists.js";

const NVAPI = "https://nvapi.nicovideo.jp";

export interface SeriesGetParams extends RequestOptions {
  pageSize?: number | undefined;
  page?: number | undefined;
  sortKey?: MylistSortKey | undefined;
  sortOrder?: SortOrder | undefined;
}

export interface SeriesResult {
  detail: SeriesDetail;
  totalCount: number;
  items: SeriesItem[];
}

export interface SeriesApi {
  getSeries(seriesId: number | string, params?: SeriesGetParams): Promise<SeriesResult>;
  getSeriesV1(seriesId: number | string, params?: SeriesGetParams): Promise<SeriesResult>;
  iterateSeriesItems(seriesId: number | string, params?: SeriesGetParams): AsyncGenerator<SeriesItem>;
}

export function createSeriesApi(http: NiconicoHttp): SeriesApi {
  async function fetchSeries(
    version: "v1" | "v2",
    seriesId: number | string,
    params: SeriesGetParams,
  ): Promise<SeriesResult> {
    const query = buildQuery({
      pageSize: params.pageSize,
      page: params.page,
      sortKey: params.sortKey,
      sortOrder: params.sortOrder,
    });
    const res = await http.getJson<{
      data: { detail: SeriesDetail; totalCount?: number; items?: SeriesItem[] };
    }>(`${NVAPI}/${version}/series/${encodeURIComponent(String(seriesId))}${query}`, pickRequestOptions(params));
    const items = res.data.items ?? [];
    return { detail: res.data.detail, totalCount: res.data.totalCount ?? items.length, items };
  }

  const api: SeriesApi = {
    getSeries(seriesId, params = {}) {
      return fetchSeries("v2", seriesId, params);
    },

    getSeriesV1(seriesId, params = {}) {
      return fetchSeries("v1", seriesId, params);
    },

    async *iterateSeriesItems(seriesId, params = {}) {
      const pageSize = params.pageSize ?? 100;
      let page = params.page ?? 1;
      let seen = 0;
      for (;;) {
        const result = await api.getSeries(seriesId, { ...params, pageSize, page });
        for (const item of result.items) yield item;
        seen += result.items.length;
        if (result.items.length === 0 || seen >= result.totalCount) return;
        page += 1;
      }
    },
  };

  return api;
}
