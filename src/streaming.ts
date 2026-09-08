import { NiconicoApiError, NiconicoError } from "./errors.js";
import { NICOVIDEO_ORIGIN, readCookieValue, type NiconicoHttp } from "./http.js";
import type { DomandAudioStream, DomandMedia, DomandVideoStream, WatchResult } from "./watch.js";

const NVAPI = "https://nvapi.nicovideo.jp";

export interface HlsAccessRightsResult {
  contentUrl: string;
  domandBidCookie: string | undefined;
  createTime: string | undefined;
  expireTime: string | undefined;
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

export function pickBestVideo(media: DomandMedia): DomandVideoStream | undefined {
  return media.videos
    .filter((video) => video.isAvailable)
    .reduce<DomandVideoStream | undefined>(
      (best, video) => (best === undefined || video.qualityLevel > best.qualityLevel ? video : best),
      undefined,
    );
}

export function pickBestAudio(media: DomandMedia): DomandAudioStream | undefined {
  return media.audios
    .filter((audio) => audio.isAvailable)
    .reduce<DomandAudioStream | undefined>(
      (best, audio) => (best === undefined || audio.qualityLevel > best.qualityLevel ? audio : best),
      undefined,
    );
}

export function pickAudioForVideo(media: DomandMedia, video: DomandVideoStream): DomandAudioStream | undefined {
  const withinCap = media.audios.filter(
    (audio) => audio.isAvailable && audio.qualityLevel <= video.recommendedHighestAudioQualityLevel,
  );
  const pool = withinCap.length > 0 ? withinCap : media.audios.filter((audio) => audio.isAvailable);
  return pool.reduce<DomandAudioStream | undefined>(
    (best, audio) => (best === undefined || audio.qualityLevel > best.qualityLevel ? audio : best),
    undefined,
  );
}

export interface HlsSessionParams {
  videoId: string;
  accessRightKey: string;
  actionTrackId: string;
  videoStreamId?: string | undefined;
  audioStreamId: string;
  signal?: AbortSignal | undefined;
}

export interface StoryboardSessionParams {
  videoId: string;
  accessRightKey: string;
  actionTrackId: string;
  signal?: AbortSignal | undefined;
}

export interface StreamingApi {
  createHlsAccessRights(params: HlsSessionParams): Promise<HlsAccessRightsResult>;
  createStoryboardAccessRights(params: StoryboardSessionParams): Promise<StoryboardAccessRightsResult>;
  getStoryboardFromWatch(
    watch: WatchResult,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<StoryboardAccessRightsResult>;
  getHlsFromWatch(
    watch: WatchResult,
    options?: {
      videoStreamId?: string | undefined;
      audioStreamId?: string | undefined;
      signal?: AbortSignal | undefined;
    },
  ): Promise<HlsAccessRightsResult>;
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
  ): Promise<{ contentUrl: string; createTime?: string; expireTime?: string; domandBidCookie: string | undefined }> {
    const url =
      `${NVAPI}/v1/watch/${encodeURIComponent(videoId)}/access-rights/${kind}` +
      `?actionTrackId=${encodeURIComponent(actionTrackId)}`;

    const response = await http.request(
      url,
      { method: "POST", body: JSON.stringify(body) },
      {
        "Content-Type": "application/json",
        "X-Access-Right-Key": accessRightKey,
        "X-Request-With": NICOVIDEO_ORIGIN,
      },
      { signal },
    );

    const json = await http.parseJsonResponse<{
      data?: { contentUrl?: string; createTime?: string; expireTime?: string };
    }>(url, response, false);

    const contentUrl = json.data?.contentUrl;
    if (contentUrl === undefined) {
      throw new NiconicoApiError(url, { status: response.status, errorCode: "MISSING_CONTENT_URL" });
    }
    return {
      contentUrl,
      ...(json.data?.createTime === undefined ? {} : { createTime: json.data.createTime }),
      ...(json.data?.expireTime === undefined ? {} : { expireTime: json.data.expireTime }),
      domandBidCookie: readCookieValue(response, "domand_bid"),
    };
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
        {},
        params.signal,
      );
      return { contentUrl: result.contentUrl, domandBidCookie: result.domandBidCookie };
    },

    getStoryboardFromWatch(watch, options = {}) {
      const videoId = watch.data.video.id;
      const domand = watch.data.media.domand;
      if (domand === null) {
        throw new DomandUnavailableError(videoId, `media.domand is null (okReason=${watch.data.okReason})`);
      }
      if (!domand.isStoryboardAvailable) {
        throw new DomandUnavailableError(
          videoId,
          "isStoryboardAvailable is false — storyboards need watch data fetched with a session",
        );
      }
      if (domand.accessRightKey === null) {
        throw new DomandUnavailableError(videoId, "accessRightKey is null — the session may lack watch rights");
      }
      const params: StoryboardSessionParams = {
        videoId,
        accessRightKey: domand.accessRightKey,
        actionTrackId: watch.actionTrackId,
      };
      if (options.signal !== undefined) params.signal = options.signal;
      return api.createStoryboardAccessRights(params);
    },

    getHlsFromWatch(watch, options = {}) {
      const videoId = watch.data.video.id;
      const domand = watch.data.media.domand;
      if (domand === null) {
        throw new DomandUnavailableError(videoId, `media.domand is null (okReason=${watch.data.okReason})`);
      }
      if (domand.accessRightKey === null) {
        throw new DomandUnavailableError(videoId, "accessRightKey is null — the session may lack watch rights");
      }

      const video =
        options.videoStreamId === undefined
          ? pickBestVideo(domand)
          : domand.videos.find((candidate) => candidate.id === options.videoStreamId);
      if (options.videoStreamId !== undefined && video === undefined) {
        throw new DomandUnavailableError(videoId, `unknown video stream ${options.videoStreamId}`);
      }

      const audio =
        options.audioStreamId !== undefined
          ? domand.audios.find((candidate) => candidate.id === options.audioStreamId)
          : video === undefined
            ? pickBestAudio(domand)
            : pickAudioForVideo(domand, video);
      if (audio === undefined) {
        throw new DomandUnavailableError(videoId, "no available audio stream");
      }

      const params: HlsSessionParams = {
        videoId,
        accessRightKey: domand.accessRightKey,
        actionTrackId: watch.actionTrackId,
        audioStreamId: audio.id,
      };
      if (video !== undefined) params.videoStreamId = video.id;
      if (options.signal !== undefined) params.signal = options.signal;
      return api.createHlsAccessRights(params);
    },
  };

  return api;
}
