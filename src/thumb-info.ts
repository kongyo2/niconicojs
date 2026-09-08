import { XMLParser } from "fast-xml-parser";
import { NiconicoError } from "./errors.js";
import type { NiconicoHttp, RequestOptions } from "./http.js";

export interface ThumbInfoTag {
  tag: string;
  category: boolean;
  lock: boolean;
}

export interface ThumbInfo {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  firstRetrieve: string;
  length: string;
  durationSeconds: number;
  movieType: string;
  sizeHigh: number;
  sizeLow: number;
  viewCounter: number;
  commentCount: number;
  mylistCounter: number;
  lastResBody: string;
  watchUrl: string;
  thumbType: string;
  embeddable: boolean;
  noLivePlay: boolean;
  genre: string | null;
  tags: ThumbInfoTag[];
  tagDomain: string | null;
  userId: string | null;
  userNickname: string | null;
  userIconUrl: string | null;
  channelId: string | null;
  channelName: string | null;
  channelIconUrl: string | null;
}

export interface ThumbInfoFailure {
  code: string;
  description: string;
}

export class ThumbInfoError extends NiconicoError {
  readonly videoId: string;
  readonly code: string;
  readonly description: string;

  constructor(videoId: string, failure: ThumbInfoFailure) {
    super(`getthumbinfo failed for ${videoId}: ${failure.code} (${failure.description})`);
    this.videoId = videoId;
    this.code = failure.code;
    this.description = failure.description;
  }
}

export interface ThumbInfoApi {
  getThumbInfo(videoId: string, options?: RequestOptions): Promise<ThumbInfo>;
  tryGetThumbInfo(videoId: string, options?: RequestOptions): Promise<ThumbInfo | null>;
}

interface RawTag {
  "#text"?: string | number;
  "@_lock"?: string | number;
  "@_category"?: string | number;
}

interface RawTags {
  tag?: RawTag | string | number | Array<RawTag | string | number>;
  "@_domain"?: string;
}

interface RawThumb {
  video_id?: string | number;
  title?: string | number;
  description?: string | number;
  thumbnail_url?: string;
  first_retrieve?: string;
  length?: string | number;
  movie_type?: string;
  size_high?: number | string;
  size_low?: number | string;
  view_counter?: number | string;
  comment_num?: number | string;
  mylist_counter?: number | string;
  last_res_body?: string | number;
  watch_url?: string;
  thumb_type?: string;
  embeddable?: number | string;
  no_live_play?: number | string;
  genre?: string | number;
  tags?: RawTags | RawTags[];
  user_id?: string | number;
  user_nickname?: string | number;
  user_icon_url?: string;
  ch_id?: string | number;
  ch_name?: string | number;
  ch_icon_url?: string;
}

interface RawResponse {
  nicovideo_thumb_response?: {
    "@_status"?: string;
    thumb?: RawThumb;
    error?: { code?: string; description?: string };
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
});

function text(value: string | number | undefined): string {
  return value === undefined ? "" : String(value);
}

function optionalText(value: string | number | undefined): string | null {
  const s = text(value);
  return s.length > 0 ? s : null;
}

function num(value: string | number | undefined): number {
  const parsed = Number(text(value).trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function flag(value: string | number | undefined): boolean {
  return text(value).trim() === "1";
}

export function parseThumbLength(length: string): number {
  const parts = length.trim().split(":");
  if (parts.length === 0 || parts.some((p) => p.length === 0)) return 0;
  return parts.reduce((total, part) => total * 60 + (Number(part) || 0), 0);
}

function normalizeTags(raw: RawTags | RawTags[] | undefined): { tags: ThumbInfoTag[]; domain: string | null } {
  if (raw === undefined) return { tags: [], domain: null };
  const groups = Array.isArray(raw) ? raw : [raw];
  const tags: ThumbInfoTag[] = [];
  let domain: string | null = null;
  for (const group of groups) {
    domain ??= group["@_domain"] ?? null;
    const entries = group.tag === undefined ? [] : Array.isArray(group.tag) ? group.tag : [group.tag];
    for (const entry of entries) {
      if (typeof entry === "string" || typeof entry === "number") {
        tags.push({ tag: String(entry), category: false, lock: false });
      } else {
        tags.push({
          tag: text(entry["#text"]),
          category: flag(entry["@_category"]),
          lock: flag(entry["@_lock"]),
        });
      }
    }
  }
  return { tags, domain };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readResponseRoot(parsed: unknown): NonNullable<RawResponse["nicovideo_thumb_response"]> | undefined {
  if (!isRecord(parsed)) return undefined;
  const root = parsed["nicovideo_thumb_response"];
  if (!isRecord(root)) return undefined;
  return {
    ...(typeof root["@_status"] === "string" ? { "@_status": root["@_status"] } : {}),
    ...(isRecord(root["thumb"]) ? { thumb: root["thumb"] } : {}),
    ...(isRecord(root["error"]) ? { error: root["error"] } : {}),
  };
}

export function parseThumbInfoXml(
  xml: string,
): { ok: true; info: ThumbInfo } | { ok: false; failure: ThumbInfoFailure } {
  const parsed: unknown = parser.parse(xml);
  const root = readResponseRoot(parsed);
  if (root === undefined) {
    return { ok: false, failure: { code: "MALFORMED_RESPONSE", description: "no nicovideo_thumb_response element" } };
  }
  const thumb = root.thumb;
  if (root["@_status"] !== "ok" || thumb === undefined) {
    return {
      ok: false,
      failure: {
        code: root.error?.code ?? "UNKNOWN",
        description: root.error?.description ?? "",
      },
    };
  }

  const { tags, domain } = normalizeTags(thumb.tags);
  const length = text(thumb.length);
  return {
    ok: true,
    info: {
      videoId: text(thumb.video_id),
      title: text(thumb.title),
      description: text(thumb.description),
      thumbnailUrl: text(thumb.thumbnail_url),
      firstRetrieve: text(thumb.first_retrieve),
      length,
      durationSeconds: parseThumbLength(length),
      movieType: text(thumb.movie_type),
      sizeHigh: num(thumb.size_high),
      sizeLow: num(thumb.size_low),
      viewCounter: num(thumb.view_counter),
      commentCount: num(thumb.comment_num),
      mylistCounter: num(thumb.mylist_counter),
      lastResBody: text(thumb.last_res_body),
      watchUrl: text(thumb.watch_url),
      thumbType: text(thumb.thumb_type),
      embeddable: flag(thumb.embeddable),
      noLivePlay: flag(thumb.no_live_play),
      genre: optionalText(thumb.genre),
      tags,
      tagDomain: domain,
      userId: optionalText(thumb.user_id),
      userNickname: optionalText(thumb.user_nickname),
      userIconUrl: optionalText(thumb.user_icon_url),
      channelId: optionalText(thumb.ch_id),
      channelName: optionalText(thumb.ch_name),
      channelIconUrl: optionalText(thumb.ch_icon_url),
    },
  };
}

export function createThumbInfoApi(http: NiconicoHttp): ThumbInfoApi {
  const base = "https://ext.nicovideo.jp/api/getthumbinfo";

  async function fetchParsed(videoId: string, options: RequestOptions) {
    const xml = await http.getText(`${base}/${encodeURIComponent(videoId)}`, options);
    return parseThumbInfoXml(xml);
  }

  return {
    async getThumbInfo(videoId, options = {}) {
      const result = await fetchParsed(videoId, options);
      if (!result.ok) {
        throw new ThumbInfoError(videoId, result.failure);
      }
      return result.info;
    },

    async tryGetThumbInfo(videoId, options = {}) {
      const result = await fetchParsed(videoId, options);
      return result.ok ? result.info : null;
    },
  };
}
