import { NiconicoApiError, NiconicoError } from "./errors.js";
import { COMMENT_RATE_LIMIT_MS, type NiconicoHttp, type RequestOptions } from "./http.js";
import type { CommentFork, NvCommentParams, NvCommentTarget, WatchCommentThread } from "./watch.js";

const NVCOMMENT = "https://public.nvcomment.nicovideo.jp";
const NVAPI = "https://nvapi.nicovideo.jp";

export interface CommentItem {
  id: string;
  no: number;
  vposMs: number;
  body: string;
  commands: string[];
  userId: string;
  isPremium: boolean;
  isMyPost?: boolean;
  nicoruCount?: number;
  nicoruId?: string | null;
  score?: number;
  postedAt?: string;
  source?: string;
}

export interface CommentThread {
  id: string;
  fork: CommentFork;
  commentCount?: number;
  comments: CommentItem[];
}

interface ThreadsResponse {
  meta?: { status?: number; errorCode?: string };
  data?: { threads?: CommentThread[]; globalComments?: Array<{ id: string; count: number }> };
}

export interface ThreadsRequestBody {
  params: {
    targets: NvCommentTarget[];
    language: string;
  };
  threadKey: string;
  additionals?: {
    when?: number;
    res_from?: number;
  };
}

export interface FetchAllCommentsOptions {
  includeEasy?: boolean | undefined;
  maxRoundsPerThread?: number | undefined;
  maxTotalCount?: number | undefined;
  startWhenUnixSec?: number | undefined;
  signal?: AbortSignal | undefined;
  onProgress?: ((fetched: number) => void) | undefined;
}

export interface CommentsApi {
  fetchComments(
    nvComment: NvCommentParams,
    options?: RequestOptions & { language?: string | undefined },
  ): Promise<CommentThread[]>;
  fetchCommentsWithKey(
    threadKey: string,
    targets: readonly NvCommentTarget[],
    options?: RequestOptions & {
      language?: string | undefined;
      when?: number | undefined;
      resFrom?: number | undefined;
    },
  ): Promise<CommentThread[]>;
  getThreadKey(videoId: string, options?: RequestOptions): Promise<string>;
  fetchCommentsByVideoId(
    videoId: string,
    options?: RequestOptions & { includeEasy?: boolean | undefined; language?: string | undefined },
  ): Promise<CommentThread[]>;
  fetchAllComments(nvComment: NvCommentParams, options?: FetchAllCommentsOptions): Promise<CommentItem[]>;
  postComment(params: PostCommentParams): Promise<PostCommentResult>;
  getPostKey(threadId: string | number, options?: RequestOptions): Promise<string>;
}

export interface PostCommentParams {
  threadId: string | number;
  videoId: string;
  body: string;
  vposMs: number;
  commands?: readonly string[] | undefined;
  postKey?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface PostCommentResult {
  id: string;
  no: number;
}

const FORK_BY_INDEX: Readonly<Record<string, CommentFork>> = {
  "0": "main",
  "1": "owner",
  "2": "easy",
  main: "main",
  owner: "owner",
  easy: "easy",
};

export function normalizeFork(fork: string | number): CommentFork {
  return FORK_BY_INDEX[String(fork)] ?? "main";
}

export function threadsToTargets(threads: readonly WatchCommentThread[], includeEasy = false): NvCommentTarget[] {
  return threads
    .filter((thread) => thread.isActive)
    .filter((thread) => includeEasy || thread.forkLabel !== "easy")
    .map((thread) => ({ id: String(thread.id), fork: thread.forkLabel }));
}

export function sortCommentsByVpos(comments: readonly CommentItem[]): CommentItem[] {
  return [...comments].sort((a, b) => a.vposMs - b.vposMs || a.no - b.no);
}

export class ThreadKeyRejectedError extends NiconicoError {
  readonly errorCode: string;
  constructor(errorCode: string, hint: string) {
    super(`nvcomment rejected the threadKey (${errorCode}). ${hint}`);
    this.errorCode = errorCode;
  }
}

const EXPIRED_HINT = "Thread keys are short-lived — refetch watch data or call getThreadKey again.";
const GUEST_HINT =
  "Reading past comments (additionals.when) requires a logged-in session; a guest key is only accepted for the initial payload.";

export function createCommentsApi(http: NiconicoHttp, resolveWatchThreads: WatchThreadResolver): CommentsApi {
  function rejectKey(errorCode: string, walkedBackwards: boolean): never {
    throw new ThreadKeyRejectedError(
      errorCode,
      errorCode === "INVALID_TOKEN" && walkedBackwards && !http.isLoggedIn() ? GUEST_HINT : EXPIRED_HINT,
    );
  }

  async function postThreads(body: ThreadsRequestBody, signal: AbortSignal | undefined): Promise<CommentThread[]> {
    const url = `${NVCOMMENT}/v1/threads`;
    const walkedBackwards = body.additionals?.when !== undefined;
    let res: ThreadsResponse;
    try {
      res = await http.postJson<ThreadsResponse>(url, body, {
        validateMeta: false,
        rateLimitMs: COMMENT_RATE_LIMIT_MS,
        idempotent: true,
        signal,
      });
    } catch (error) {
      if (
        error instanceof NiconicoApiError &&
        (error.errorCode === "INVALID_TOKEN" || error.errorCode === "EXPIRED_TOKEN")
      ) {
        rejectKey(error.errorCode, walkedBackwards);
      }
      throw error;
    }
    const meta = res.meta;
    if (meta?.errorCode === "EXPIRED_TOKEN" || meta?.errorCode === "INVALID_TOKEN") {
      rejectKey(meta.errorCode, walkedBackwards);
    }
    if (meta?.status !== undefined && meta.status >= 400) {
      throw new NiconicoError(`nvcomment API error: ${meta.status} ${meta.errorCode ?? ""}`.trim());
    }
    return (res.data?.threads ?? []).map((thread) => ({ ...thread, comments: thread.comments ?? [] }));
  }

  const api: CommentsApi = {
    fetchComments(nvComment, options = {}) {
      return api.fetchCommentsWithKey(nvComment.threadKey, nvComment.params.targets, {
        ...options,
        language: options.language ?? nvComment.params.language,
      });
    },

    fetchCommentsWithKey(threadKey, targets, options = {}) {
      const additionals: ThreadsRequestBody["additionals"] = {};
      if (options.when !== undefined) additionals.when = options.when;
      if (options.resFrom !== undefined) additionals.res_from = options.resFrom;
      return postThreads(
        {
          params: { targets: [...targets], language: options.language ?? "ja-jp" },
          threadKey,
          additionals,
        },
        options.signal,
      );
    },

    async getThreadKey(videoId, options = {}) {
      const res = await http.getJson<{ data?: { threadKey?: string } }>(
        `${NVAPI}/v1/comment/keys/thread?videoId=${encodeURIComponent(videoId)}`,
        options,
      );
      const threadKey = res.data?.threadKey;
      if (threadKey === undefined) {
        throw new NiconicoError(`comment keys/thread: no threadKey returned for ${videoId}`);
      }
      return threadKey;
    },

    async fetchCommentsByVideoId(videoId, options = {}) {
      const nvComment = await resolveWatchThreads(videoId, options);
      const targets =
        options.includeEasy === true
          ? nvComment.params.targets
          : nvComment.params.targets.filter((target) => target.fork !== "easy");
      return api.fetchCommentsWithKey(nvComment.threadKey, targets, options);
    },

    async getPostKey(threadId, options = {}) {
      const res = await http.getJson<{ data?: { postKey?: string } }>(
        `${NVAPI}/v1/comment/keys/post?threadId=${encodeURIComponent(String(threadId))}`,
        options,
      );
      const postKey = res.data?.postKey;
      if (postKey === undefined) {
        throw new NiconicoError(`comment keys/post: no postKey returned for thread ${String(threadId)}`);
      }
      return postKey;
    },

    async postComment(params) {
      const postKey = params.postKey ?? (await api.getPostKey(params.threadId, { signal: params.signal }));
      const url = `${NVCOMMENT}/v1/threads/${encodeURIComponent(String(params.threadId))}/comments`;
      const res = await http.postJson<{ data?: { id?: string; no?: number } }>(
        url,
        {
          videoId: params.videoId,
          body: params.body,
          commands: [...(params.commands ?? [])],
          vposMs: params.vposMs,
          postKey,
        },
        { rateLimitMs: COMMENT_RATE_LIMIT_MS, signal: params.signal, headers: { "X-Client-Os-Type": "others" } },
      );
      const id = res.data?.id;
      const no = res.data?.no;
      if (id === undefined || no === undefined) {
        throw new NiconicoError(`postComment: unexpected response for thread ${String(params.threadId)}`);
      }
      return { id, no };
    },

    async fetchAllComments(nvComment, options = {}) {
      const includeEasy = options.includeEasy ?? false;
      const maxRounds = options.maxRoundsPerThread ?? 10_000;
      const targets = nvComment.params.targets.filter((target) => includeEasy || target.fork !== "easy");
      const ordered = [
        ...targets.filter((target) => target.fork === "owner"),
        ...targets.filter((target) => target.fork !== "owner"),
      ];

      const seen = new Map<string, CommentItem>();
      let reachedLimit = false;

      for (const target of ordered) {
        if (reachedLimit) break;
        options.signal?.throwIfAborted();
        let when = options.startWhenUnixSec ?? Math.floor(Date.now() / 1000);
        let lowestSeenNo = Number.POSITIVE_INFINITY;

        for (let round = 0; round < maxRounds; round += 1) {
          options.signal?.throwIfAborted();

          const threads = await api.fetchCommentsWithKey(nvComment.threadKey, [target], {
            language: nvComment.params.language,
            when,
            resFrom: -1000,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
          const batch = threads.flatMap((thread) => thread.comments);
          if (batch.length === 0) break;

          for (const comment of batch) {
            seen.set(`${target.id}:${target.fork}:${comment.no}`, comment);
          }
          options.onProgress?.(seen.size);

          if (options.maxTotalCount !== undefined && seen.size >= options.maxTotalCount) {
            reachedLimit = true;
            break;
          }

          const batchMinNo = batch.reduce((min, comment) => Math.min(min, comment.no), Number.POSITIVE_INFINITY);
          if (batchMinNo >= lowestSeenNo) break;
          lowestSeenNo = batchMinNo;
          if (batchMinNo <= 1) break;

          const earliestSec = batch.reduce((min, comment) => {
            const posted = comment.postedAt === undefined ? Number.NaN : Date.parse(comment.postedAt);
            return Number.isNaN(posted) ? min : Math.min(min, Math.floor(posted / 1000));
          }, Number.POSITIVE_INFINITY);

          const next = Number.isFinite(earliestSec) && earliestSec < when ? earliestSec : when - 1;
          if (next <= 0) break;
          when = next;
        }
      }

      const result = Array.from(seen.values());
      return options.maxTotalCount === undefined ? result : result.slice(0, options.maxTotalCount);
    },
  };

  return api;
}

export type WatchThreadResolver = (
  videoId: string,
  options: { signal?: AbortSignal | undefined },
) => Promise<NvCommentParams>;
