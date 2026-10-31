import { NiconicoApiError, NiconicoError } from "./errors.js";
import { NICOVIDEO_ORIGIN, readCookieValue, type NiconicoHttp } from "./http.js";
import type { WatchResult, WatchV4Result } from "./watch.js";

const NVAPI = "https://nvapi.nicovideo.jp";

export interface HlsAccessRightsResult {
  contentUrl: string;
  domandBidCookie: string | undefined;
  createTime: string | undefined;
  expireTime: string | undefined;
}

export interface StreamCandidate {
  id: string;
  isAvailable: boolean;
  qualityLevel: number;
}

export type AnyWatchResult = WatchResult | WatchV4Result;

export function isWatchV4Result(watch: AnyWatchResult): watch is WatchV4Result {
  return "lazy" in watch.data;
}

interface StreamSource {
  videoId: string;
  okReason: string;
  guest: boolean;
  media: {
    videos: readonly (StreamCandidate & { recommendedHighestAudioQualityLevel?: number })[];
    audios: readonly StreamCandidate[];
    accessRightKey: string | null;
    isStoryboardAvailable: boolean;
  } | null;
}

function streamSource(watch: AnyWatchResult): StreamSource {
  if (isWatchV4Result(watch)) {
    const media = watch.data.media;
    return {
      videoId: watch.data.video.id,
      okReason: watch.data.okReason,
      guest: watch.guest,
      media:
        media === null
          ? null
          : {
              videos: media.contents.videos,
              audios: media.contents.audios,
              accessRightKey: media.accessRightKey,
              isStoryboardAvailable: media.isStoryboardAvailable,
            },
    };
  }
  return {
    videoId: watch.data.video.id,
    okReason: watch.data.okReason,
    guest: watch.guest === true,
    media: watch.data.media.domand,
  };
}

export interface StoryboardAccessRightsResult {
  contentUrl: string;
  domandBidCookie: string | undefined;
}

export function domandCookieHeader(result: Pick<HlsAccessRightsResult, "domandBidCookie">): string | undefined {
  return result.domandBidCookie === undefined ? undefined : `domand_bid=${result.domandBidCookie}`;
}

export function domandRequestHeaders(result: Pick<HlsAccessRightsResult, "domandBidCookie">): Record<string, string> {
  const headers: Record<string, string> = {
    Origin: NICOVIDEO_ORIGIN,
    Referer: `${NICOVIDEO_ORIGIN}/`,
  };
  const cookie = domandCookieHeader(result);
  if (cookie !== undefined) headers["Cookie"] = cookie;
  return headers;
}

function highest<T extends StreamCandidate>(streams: readonly T[]): T | undefined {
  return streams
    .filter((stream) => stream.isAvailable)
    .reduce<T | undefined>(
      (best, stream) => (best === undefined || stream.qualityLevel > best.qualityLevel ? stream : best),
      undefined,
    );
}

export function pickBestVideo<V extends StreamCandidate>(media: { videos: readonly V[] }): V | undefined {
  return highest(media.videos);
}

export function pickBestAudio<A extends StreamCandidate>(media: { audios: readonly A[] }): A | undefined {
  return highest(media.audios);
}

export function pickAudioForVideo<A extends StreamCandidate>(
  media: { audios: readonly A[] },
  video: { recommendedHighestAudioQualityLevel?: number },
): A | undefined {
  const cap = video.recommendedHighestAudioQualityLevel;
  const withinCap = cap === undefined ? [] : media.audios.filter((audio) => audio.qualityLevel <= cap);
  return highest(withinCap) ?? highest(media.audios);
}

export interface HlsSessionParams {
  videoId: string;
  accessRightKey: string;
  actionTrackId: string;
  videoStreamId?: string | undefined;
  audioStreamId: string;
  anonymous?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface StoryboardSessionParams {
  videoId: string;
  accessRightKey: string;
  actionTrackId: string;
  anonymous?: boolean | undefined;
  signal?: AbortSignal | undefined;
}

export interface StreamingApi {
  createHlsAccessRights(params: HlsSessionParams): Promise<HlsAccessRightsResult>;
  createStoryboardAccessRights(params: StoryboardSessionParams): Promise<StoryboardAccessRightsResult>;
  getStoryboardFromWatch(
    watch: AnyWatchResult,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<StoryboardAccessRightsResult>;
  getHlsFromWatch(
    watch: AnyWatchResult,
    options?: {
      videoStreamId?: string | undefined;
      audioStreamId?: string | undefined;
      signal?: AbortSignal | undefined;
    },
  ): Promise<HlsAccessRightsResult>;
  getPreissuedHls(watch: WatchV4Result): HlsAccessRightsResult | undefined;
}

export class DomandUnavailableError extends NiconicoError {
  readonly videoId: string;
  constructor(videoId: string, reason: string) {
    super(`No DMS stream available for ${videoId}: ${reason}`);
    this.videoId = videoId;
  }
}

export function createStreamingApi(http: NiconicoHttp): StreamingApi {
  async function requestAccessRights(
    videoId: string,
    kind: "hls" | "storyboard",
    accessRightKey: string,
    actionTrackId: string,
    body: unknown,
    signal: AbortSignal | undefined,
    anonymous: boolean,
  ): Promise<{ contentUrl: string; createTime?: string; expireTime?: string; domandBidCookie: string | undefined }> {
    const url =
      `${NVAPI}/v1/watch/${encodeURIComponent(videoId)}/access-rights/${kind}` +
      `?actionTrackId=${encodeURIComponent(actionTrackId)}`;

    const headers: Record<string, string> = {
      "X-Access-Right-Key": accessRightKey,
      "X-Request-With": NICOVIDEO_ORIGIN,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const raw = await http.request(
      url,
      body === undefined ? { method: "POST" } : { method: "POST", body: JSON.stringify(body) },
      headers,
      { signal, anonymous },
    );

    const json = http.parseJsonResponse<{
      data?: { contentUrl?: string; createTime?: string; expireTime?: string };
    }>(url, raw, false);

    const contentUrl = json.data?.contentUrl;
    if (contentUrl === undefined) {
      throw new NiconicoApiError(url, { status: raw.response.status, errorCode: "MISSING_CONTENT_URL" });
    }
    return {
      contentUrl,
      ...(json.data?.createTime === undefined ? {} : { createTime: json.data.createTime }),
      ...(json.data?.expireTime === undefined ? {} : { expireTime: json.data.expireTime }),
      domandBidCookie: readCookieValue(raw.response, "domand_bid"),
    };
  }

  function requireMedia(source: StreamSource): NonNullable<StreamSource["media"]> & { accessRightKey: string } {
    const media = source.media;
    if (media === null) {
      throw new DomandUnavailableError(source.videoId, `media.domand is null (okReason=${source.okReason})`);
    }
    if (media.accessRightKey === null) {
      throw new DomandUnavailableError(source.videoId, "accessRightKey is null — the session may lack watch rights");
    }
    return { ...media, accessRightKey: media.accessRightKey };
  }

  const api: StreamingApi = {
    async createHlsAccessRights(params) {
      const outputs =
        params.videoStreamId === undefined ? [[params.audioStreamId]] : [[params.videoStreamId, params.audioStreamId]];
      const result = await requestAccessRights(
        params.videoId,
        "hls",
        params.accessRightKey,
        params.actionTrackId,
        { outputs },
        params.signal,
        params.anonymous === true,
      );
      return {
        contentUrl: result.contentUrl,
        domandBidCookie: result.domandBidCookie,
        createTime: result.createTime,
        expireTime: result.expireTime,
      };
    },

    async createStoryboardAccessRights(params) {
      const result = await requestAccessRights(
        params.videoId,
        "storyboard",
        params.accessRightKey,
        params.actionTrackId,
        undefined,
        params.signal,
        params.anonymous === true,
      );
      return { contentUrl: result.contentUrl, domandBidCookie: result.domandBidCookie };
    },

    getStoryboardFromWatch(watch, options = {}) {
      const source = streamSource(watch);
      if (source.media !== null && !source.media.isStoryboardAvailable) {
        throw new DomandUnavailableError(
          source.videoId,
          "isStoryboardAvailable is false — storyboards need watch data fetched with a session",
        );
      }
      const media = requireMedia(source);
      const params: StoryboardSessionParams = {
        videoId: source.videoId,
        accessRightKey: media.accessRightKey,
        actionTrackId: watch.actionTrackId,
        anonymous: source.guest,
      };
      if (options.signal !== undefined) params.signal = options.signal;
      return api.createStoryboardAccessRights(params);
    },

    getHlsFromWatch(watch, options = {}) {
      const source = streamSource(watch);
      const videoId = source.videoId;
      const media = requireMedia(source);

      let video: (StreamCandidate & { recommendedHighestAudioQualityLevel?: number }) | undefined;
      if (options.videoStreamId === undefined) {
        video = pickBestVideo(media);
      } else {
        const requested = media.videos.find((candidate) => candidate.id === options.videoStreamId);
        if (requested === undefined) {
          throw new DomandUnavailableError(videoId, `unknown video stream ${options.videoStreamId}`);
        }
        if (!requested.isAvailable) {
          throw new DomandUnavailableError(videoId, `video stream ${requested.id} is not available`);
        }
        video = requested;
      }

      let audio: StreamCandidate | undefined;
      if (options.audioStreamId === undefined) {
        audio = video === undefined ? pickBestAudio(media) : pickAudioForVideo(media, video);
      } else {
        const requested = media.audios.find((candidate) => candidate.id === options.audioStreamId);
        if (requested === undefined) {
          throw new DomandUnavailableError(videoId, `unknown audio stream ${options.audioStreamId}`);
        }
        if (!requested.isAvailable) {
          throw new DomandUnavailableError(videoId, `audio stream ${requested.id} is not available`);
        }
        audio = requested;
      }
      if (audio === undefined) {
        throw new DomandUnavailableError(videoId, "no available audio stream");
      }

      const params: HlsSessionParams = {
        videoId,
        accessRightKey: media.accessRightKey,
        actionTrackId: watch.actionTrackId,
        audioStreamId: audio.id,
        anonymous: source.guest,
      };
      if (video !== undefined) params.videoStreamId = video.id;
      if (options.signal !== undefined) params.signal = options.signal;
      return api.createHlsAccessRights(params);
    },

    getPreissuedHls(watch) {
      const hls = watch.data.media?.hls;
      if (hls === null || hls === undefined) return undefined;
      return {
        contentUrl: hls.url,
        domandBidCookie: watch.domandBidCookie,
        createTime: hls.createdAt,
        expireTime: hls.expiredAt,
      };
    },
  };

  return api;
}
