import { NiconicoError } from "./errors.js";
import type { NiconicoHttp, RequestOptions } from "./http.js";

const NVAPI = "https://nvapi.nicovideo.jp";
const NG_HEADERS: Record<string, string> = { "X-Request-With": "nicovideo" };

export type NgCommentType = "word" | "id" | "command";

export interface NgCommentTarget {
  type: NgCommentType;
  source: string;
}

export interface NgCommentItem {
  type: NgCommentType | (string & {});
  source: string;
  registeredAt?: string;
}

export interface NgCommentList {
  revision: number;
  count: number;
  items: NgCommentItem[];
}

export interface NgCommentsApi {
  getMyNgComments(options?: RequestOptions): Promise<NgCommentList>;
  addNgComment(target: NgCommentTarget, options?: RequestOptions): Promise<NgCommentList>;
  removeNgComments(targets: readonly NgCommentTarget[], options?: RequestOptions): Promise<NgCommentList>;
}

function readList(url: string, data: Partial<NgCommentList> | undefined): NgCommentList {
  if (data === undefined || !Array.isArray(data.items)) {
    throw new NiconicoError(`ng-comments: response from ${url} carried no items list`);
  }
  return { revision: data.revision ?? 0, count: data.count ?? data.items.length, items: data.items };
}

export function createNgCommentsApi(http: NiconicoHttp): NgCommentsApi {
  const base = `${NVAPI}/v1/users/me/ng-comments/client`;

  const api: NgCommentsApi = {
    async getMyNgComments(options = {}) {
      const res = await http.getJson<{ data?: Partial<NgCommentList> }>(base, options);
      return readList(base, res.data);
    },

    async addNgComment(target, options = {}) {
      const res = await http.sendForm<{ data?: Partial<NgCommentList> }>(
        base,
        "POST",
        { type: target.type, source: target.source },
        { ...options, headers: { ...NG_HEADERS, ...options.headers } },
      );
      return readList(base, res.data);
    },

    async removeNgComments(targets, options = {}) {
      if (targets.length === 0) return api.getMyNgComments(options);
      const url = `${base}/items`;
      const res = await http.sendJson<{ data?: Partial<NgCommentList> }>(
        url,
        "DELETE",
        { targets: targets.map((target) => ({ type: target.type, source: target.source })) },
        { ...options, headers: { ...NG_HEADERS, ...options.headers } },
      );
      return readList(url, res.data);
    },
  };

  return api;
}
