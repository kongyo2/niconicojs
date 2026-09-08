import { NiconicoError } from "./errors.js";
import { buildQuery, type NiconicoHttp, type RequestOptions } from "./http.js";

const FEED = "https://api.feed.nicovideo.jp";

export interface FeedActor {
  id: string;
  type: string;
  name: string;
  iconUrl?: string;
  url?: string;
  [k: string]: unknown;
}

export interface FeedActivityContent {
  type: string;
  id: string;
  title: string;
  url?: string;
  video?: { duration?: number; [k: string]: unknown };
  [k: string]: unknown;
}

export interface FeedActivity {
  id?: string;
  createdAt: string;
  kind?: string;
  actor?: FeedActor;
  content?: FeedActivityContent;
  thumbnailUrl?: string;
  [k: string]: unknown;
}

export interface FeedActivitiesResult {
  activities: FeedActivity[];
  impressionId: string | undefined;
  nextCursor: string | undefined;
}

export interface FeedApi {
  getActors(params?: RequestOptions & { limit?: number | undefined }): Promise<FeedActor[]>;
  getFollowingsVideo(
    params?: RequestOptions & { limit?: number | undefined; cursor?: string | undefined },
  ): Promise<FeedActivitiesResult>;
  iterateFollowingsVideo(
    params?: RequestOptions & { limit?: number | undefined; cursor?: string | undefined },
  ): AsyncGenerator<FeedActivity>;
}

function assertFeedOk(url: string, code: string | undefined): void {
  if (code !== "ok") {
    throw new NiconicoError(`feed API returned code=${code ?? "<missing>"} for ${url}`);
  }
}

export const FEED_MAX_LIMIT = 50;

function clampLimit(limit: number | undefined, fallback: number): number {
  return Math.min(Math.max(1, Math.trunc(limit ?? fallback)), FEED_MAX_LIMIT);
}

export function createFeedApi(http: NiconicoHttp): FeedApi {
  const api: FeedApi = {
    async getActors(params = {}) {
      const url = `${FEED}/v1/actors${buildQuery({ limit: clampLimit(params.limit, FEED_MAX_LIMIT) })}`;
      const res = await http.getJson<{ code?: string; actors?: FeedActor[] }>(url, {
        validateMeta: false,
        signal: params.signal,
      });
      assertFeedOk(url, res.code);
      return res.actors ?? [];
    },

    async getFollowingsVideo(params = {}) {
      const url = `${FEED}/v1/activities/followings/video${buildQuery({
        context: "my_timeline",
        limit: clampLimit(params.limit, 25),
        cursor: params.cursor !== undefined && params.cursor.length > 0 ? params.cursor : undefined,
      })}`;
      const res = await http.getJson<{
        code?: string;
        activities?: FeedActivity[];
        impressionId?: string;
        nextCursor?: string;
      }>(url, { validateMeta: false, signal: params.signal });
      assertFeedOk(url, res.code);
      return {
        activities: res.activities ?? [],
        impressionId: res.impressionId,
        nextCursor: res.nextCursor,
      };
    },

    async *iterateFollowingsVideo(params = {}) {
      let cursor = params.cursor;
      for (;;) {
        const page: RequestOptions & { limit?: number | undefined; cursor?: string | undefined } = { ...params };
        if (cursor !== undefined) page.cursor = cursor;
        const result = await api.getFollowingsVideo(page);
        for (const activity of result.activities) yield activity;
        if (result.activities.length === 0 || result.nextCursor === undefined || result.nextCursor === cursor) {
          return;
        }
        cursor = result.nextCursor;
      }
    },
  };

  return api;
}
