import { NiconicoError } from "./errors.js";
import type { NiconicoHttp, RequestOptions } from "./http.js";

const BASE = "https://snapshot.search.nicovideo.jp/api/v2/snapshot/video/contents/search";

export const SNAPSHOT_FIELDS = [
  "contentId",
  "title",
  "description",
  "userId",
  "channelId",
  "viewCounter",
  "mylistCounter",
  "likeCounter",
  "lengthSeconds",
  "thumbnailUrl",
  "startTime",
  "lastResBody",
  "commentCounter",
  "lastCommentTime",
  "categoryTags",
  "tags",
  "genre",
] as const;

export const SNAPSHOT_TARGETS = ["title", "description", "tags", "tagsExact", "categoryTags"] as const;

export const SNAPSHOT_SORTABLE = [
  "viewCounter",
  "mylistCounter",
  "likeCounter",
  "commentCounter",
  "lengthSeconds",
  "startTime",
  "lastCommentTime",
] as const;

export type SnapshotField = (typeof SNAPSHOT_FIELDS)[number] | (string & {});
export type SnapshotTarget = (typeof SNAPSHOT_TARGETS)[number] | (string & {});
export type SnapshotSortField = (typeof SNAPSHOT_SORTABLE)[number] | (string & {});

export interface SnapshotRangeFilter {
  field: SnapshotSortField;
  gte?: number | string | undefined;
  lte?: number | string | undefined;
  gt?: number | string | undefined;
  lt?: number | string | undefined;
}

export interface SnapshotSearchParams extends RequestOptions {
  q: string;
  targets: SnapshotTarget | readonly SnapshotTarget[];
  fields: SnapshotField | readonly SnapshotField[];
  sort?: SnapshotSortField | readonly SnapshotSortField[] | undefined;
  order?: "asc" | "desc" | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
  filters?: Readonly<Record<string, readonly (string | number)[]>> | undefined;
  rangeFilters?: readonly SnapshotRangeFilter[] | undefined;
  context?: string | undefined;
}

export interface SnapshotItem {
  contentId: string;
  title?: string;
  description?: string | null;
  tags?: string | null;
  categoryTags?: string | null;
  genre?: string | null;
  userId?: number | null;
  channelId?: number | null;
  viewCounter?: number;
  mylistCounter?: number;
  likeCounter?: number;
  commentCounter?: number;
  lengthSeconds?: number;
  thumbnailUrl?: string;
  startTime?: string;
  lastResBody?: string | null;
  lastCommentTime?: string | null;
  [field: string]: string | number | null | undefined;
}

export interface SnapshotSearchResult {
  meta: { status: number; totalCount: number; id: string };
  data: SnapshotItem[];
}

export interface SnapshotApi {
  search(params: SnapshotSearchParams): Promise<SnapshotSearchResult>;
  iterate(params: SnapshotSearchParams & { maxItems?: number | undefined }): AsyncGenerator<SnapshotItem>;
}

const DEFAULT_CONTEXT = "niconicojs";
const MAX_OFFSET = 1600;

function joinList(value: string | readonly string[]): string {
  return typeof value === "string" ? value : value.join(",");
}

export function normalizeSnapshotSort(
  sort: string | readonly string[] | undefined,
  order: "asc" | "desc" | undefined,
): string {
  if (sort === undefined) {
    return order === "asc" ? "+startTime" : "-startTime";
  }
  const fields = typeof sort === "string" ? [sort] : sort;
  const sign = (order ?? "desc") === "asc" ? "+" : "-";
  return fields.map((field) => (field.startsWith("+") || field.startsWith("-") ? field : `${sign}${field}`)).join(",");
}

export function createSnapshotApi(http: NiconicoHttp): SnapshotApi {
  const api: SnapshotApi = {
    async search(params) {
      const search = new URLSearchParams();
      search.set("q", params.q);
      search.set("targets", joinList(params.targets));
      search.set("fields", joinList(params.fields));
      search.set("_sort", normalizeSnapshotSort(params.sort, params.order));
      if (params.offset !== undefined) search.set("_offset", String(params.offset));
      if (params.limit !== undefined) search.set("_limit", String(params.limit));
      search.set("_context", params.context ?? DEFAULT_CONTEXT);

      for (const [field, values] of Object.entries(params.filters ?? {})) {
        values.forEach((value, index) => {
          search.append(`filters[${field}][${index}]`, String(value));
        });
      }
      for (const filter of params.rangeFilters ?? []) {
        for (const bound of ["gte", "lte", "gt", "lt"] as const) {
          const value = filter[bound];
          if (value !== undefined) {
            search.set(`filters[${filter.field}][${bound}]`, String(value));
          }
        }
      }

      const url = `${BASE}?${search.toString()}`;
      const res = await http.getJson<SnapshotSearchResult>(url, {
        validateMeta: false,
        signal: params.signal,
      });
      if (res.meta.status >= 400) {
        throw new NiconicoError(`snapshot search failed: ${res.meta.status} (id=${res.meta.id})`);
      }
      return res;
    },

    async *iterate(params) {
      const limit = params.limit ?? 100;
      let offset = params.offset ?? 0;
      let yielded = 0;
      for (;;) {
        const result = await api.search({ ...params, offset, limit });
        for (const item of result.data) {
          yield item;
          yielded += 1;
          if (params.maxItems !== undefined && yielded >= params.maxItems) return;
        }
        offset += result.data.length;
        if (result.data.length === 0 || offset >= result.meta.totalCount || offset > MAX_OFFSET) return;
      }
    },
  };

  return api;
}
