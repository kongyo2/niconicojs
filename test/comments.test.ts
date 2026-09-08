import { describe, expect, it } from "vitest";
import {
  createCommentsApi,
  normalizeFork,
  ThreadKeyRejectedError,
  sortCommentsByVpos,
  threadsToTargets,
  type CommentItem,
} from "../src/comments.js";
import type { NvCommentParams, WatchCommentThread } from "../src/watch.js";
import { NiconicoError } from "../src/errors.js";
import { mockFetch, testHttp, type MockFetch } from "./helpers.js";

const nvComment: NvCommentParams = {
  threadKey: "jwt",
  server: "https://public.nvcomment.nicovideo.jp",
  params: {
    targets: [
      { id: "1173108780", fork: "owner" },
      { id: "1173108780", fork: "main" },
      { id: "1173108780", fork: "easy" },
    ],
    language: "ja-jp",
  },
};

const noResolver = () => Promise.reject(new Error("resolver should not be called"));

function comments(count: number, startNo: number, secondsAgo = 0): CommentItem[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: String(startNo + index),
    no: startNo + index,
    vposMs: index * 10,
    body: `c${startNo + index}`,
    commands: [],
    userId: "u",
    isPremium: false,
    postedAt: new Date((1_700_000_000 - secondsAgo) * 1000).toISOString(),
  }));
}

function threadBody(fork: string, items: CommentItem[]) {
  return { meta: { status: 200 }, data: { threads: [{ id: "1173108780", fork, comments: items }] } };
}

describe("normalizeFork", () => {
  it("maps numeric and string forks, defaulting to main", () => {
    expect(normalizeFork(0)).toBe("main");
    expect(normalizeFork("1")).toBe("owner");
    expect(normalizeFork(2)).toBe("easy");
    expect(normalizeFork("main")).toBe("main");
    expect(normalizeFork("nonsense")).toBe("main");
  });
});

describe("threadsToTargets", () => {
  const threads = [
    { id: 1, forkLabel: "owner", isActive: true },
    { id: 1, forkLabel: "main", isActive: true },
    { id: 1, forkLabel: "easy", isActive: true },
    { id: 1, forkLabel: "main", isActive: false },
  ] as unknown as WatchCommentThread[];

  it("keeps active threads and drops easy by default", () => {
    expect(threadsToTargets(threads)).toEqual([
      { id: "1", fork: "owner" },
      { id: "1", fork: "main" },
    ]);
  });

  it("includes easy on request", () => {
    expect(threadsToTargets(threads, true)).toHaveLength(3);
  });
});

describe("sortCommentsByVpos", () => {
  it("orders by playback position, then post order, without mutating", () => {
    const input: CommentItem[] = [
      { id: "b", no: 2, vposMs: 100, body: "", commands: [], userId: "", isPremium: false },
      { id: "a", no: 1, vposMs: 100, body: "", commands: [], userId: "", isPremium: false },
      { id: "c", no: 3, vposMs: 10, body: "", commands: [], userId: "", isPremium: false },
    ];
    expect(sortCommentsByVpos(input).map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(input[0]?.id).toBe("b");
  });
});

describe("fetchComments", () => {
  it("posts the targets and key to /v1/threads", async () => {
    const mock = mockFetch({ json: threadBody("main", comments(2, 1)) });
    const api = createCommentsApi(testHttp(mock), noResolver);
    const threads = await api.fetchComments(nvComment);

    const call = mock.only();
    expect(call.url).toBe("https://public.nvcomment.nicovideo.jp/v1/threads");
    expect(call.method).toBe("POST");
    expect(JSON.parse(call.body ?? "{}")).toEqual({
      params: { targets: nvComment.params.targets, language: "ja-jp" },
      threadKey: "jwt",
      additionals: {},
    });
    expect(threads[0]?.comments).toHaveLength(2);
  });

  it("names an expired key so the caller knows to refetch watch data", async () => {
    const mock = mockFetch({ json: { meta: { status: 200, errorCode: "EXPIRED_TOKEN" } } });
    const api = createCommentsApi(testHttp(mock), noResolver);
    await expect(api.fetchComments(nvComment)).rejects.toBeInstanceOf(ThreadKeyRejectedError);
  });

  it("catches a rejected key delivered as HTTP 400, not just inside a 200 body", async () => {
    const mock = mockFetch({ status: 400, json: { meta: { status: 400, errorCode: "INVALID_TOKEN" } } });
    const api = createCommentsApi(testHttp(mock), noResolver);
    await expect(api.fetchComments(nvComment)).rejects.toBeInstanceOf(ThreadKeyRejectedError);
  });

  it("tells a guest that past comments need a session", async () => {
    const mock = mockFetch({ status: 400, json: { meta: { status: 400, errorCode: "INVALID_TOKEN" } } });
    const api = createCommentsApi(testHttp(mock), noResolver);
    await expect(api.fetchAllComments(nvComment)).rejects.toThrow(/requires a logged-in session/);
  });

  it("does not blame the session when the client has one", async () => {
    const mock = mockFetch({ status: 400, json: { meta: { status: 400, errorCode: "INVALID_TOKEN" } } });
    const api = createCommentsApi(testHttp(mock, { session: "s" }), noResolver);
    await expect(api.fetchAllComments(nvComment)).rejects.toThrow(/short-lived/);
  });

  it("defaults a missing comments array to empty", async () => {
    const mock = mockFetch({ json: { meta: { status: 200 }, data: { threads: [{ id: "1", fork: "owner" }] } } });
    const api = createCommentsApi(testHttp(mock), noResolver);
    const threads = await api.fetchComments(nvComment);
    expect(threads[0]?.comments).toEqual([]);
  });
});

describe("getThreadKey", () => {
  it("fetches a key without a watch round-trip", async () => {
    const mock = mockFetch({ json: { meta: { status: 200 }, data: { threadKey: "standalone-jwt" } } });
    const api = createCommentsApi(testHttp(mock), noResolver);
    await expect(api.getThreadKey("sm9")).resolves.toBe("standalone-jwt");
    expect(mock.only().url).toBe("https://nvapi.nicovideo.jp/v1/comment/keys/thread?videoId=sm9");
  });

  it("reports a response with no key", async () => {
    const mock = mockFetch({ json: { meta: { status: 200 }, data: {} } });
    const api = createCommentsApi(testHttp(mock), noResolver);
    await expect(api.getThreadKey("sm9")).rejects.toBeInstanceOf(NiconicoError);
  });
});

describe("fetchCommentsByVideoId", () => {
  it("resolves targets through the watch resolver and drops the easy fork", async () => {
    const mock = mockFetch({ json: threadBody("main", comments(1, 1)) });
    const api = createCommentsApi(testHttp(mock), () => Promise.resolve(nvComment));
    await api.fetchCommentsByVideoId("sm9");
    const sent = JSON.parse(mock.only().body ?? "{}") as { params: { targets: Array<{ fork: string }> } };
    expect(sent.params.targets.map((t) => t.fork)).toEqual(["owner", "main"]);
  });

  it("keeps the easy fork when asked", async () => {
    const mock = mockFetch({ json: threadBody("main", []) });
    const api = createCommentsApi(testHttp(mock), () => Promise.resolve(nvComment));
    await api.fetchCommentsByVideoId("sm9", { includeEasy: true });
    const sent = JSON.parse(mock.only().body ?? "{}") as { params: { targets: unknown[] } };
    expect(sent.params.targets).toHaveLength(3);
  });
});

describe("fetchAllComments", () => {
  function bodyOf(
    mock: MockFetch,
    index: number,
  ): { params: { targets: Array<{ fork: string }> }; additionals: { when?: number; res_from?: number } } {
    const call = mock.calls[index];
    if (call === undefined) throw new Error(`no call at ${index}`);
    return JSON.parse(call.body ?? "{}") as never;
  }

  it("walks backwards with res_from -1000 and stops when no lower comment arrives", async () => {
    const mock = mockFetch([
      { json: threadBody("owner", []) },
      { json: threadBody("main", comments(3, 10, 0)) },
      { json: threadBody("main", comments(3, 5, 100)) },
      { json: threadBody("main", comments(3, 5, 200)) },
    ]);
    const api = createCommentsApi(testHttp(mock), noResolver);
    const all = await api.fetchAllComments(nvComment);

    expect(bodyOf(mock, 1).additionals.res_from).toBe(-1000);
    expect(bodyOf(mock, 0).params.targets[0]?.fork).toBe("owner");
    expect(all.map((c) => c.no).sort((a, b) => a - b)).toEqual([5, 6, 7, 10, 11, 12]);
  });

  it("stops at the first comment of a thread", async () => {
    const mock = mockFetch([{ json: threadBody("owner", []) }, { json: threadBody("main", comments(2, 1)) }]);
    const api = createCommentsApi(testHttp(mock), noResolver);
    const all = await api.fetchAllComments(nvComment);
    expect(all).toHaveLength(2);
    expect(mock.calls).toHaveLength(2);
  });

  it("honours maxTotalCount", async () => {
    const mock = mockFetch([{ json: threadBody("owner", []) }, { json: threadBody("main", comments(10, 100)) }]);
    const api = createCommentsApi(testHttp(mock), noResolver);
    const all = await api.fetchAllComments(nvComment, { maxTotalCount: 4 });
    expect(all).toHaveLength(4);
  });

  it("reports progress as comments accumulate", async () => {
    const mock = mockFetch([{ json: threadBody("owner", []) }, { json: threadBody("main", comments(3, 1)) }]);
    const api = createCommentsApi(testHttp(mock), noResolver);
    const seen: number[] = [];
    await api.fetchAllComments(nvComment, { onProgress: (n) => seen.push(n) });
    expect(seen).toEqual([3]);
  });

  it("deduplicates repeats of the same comment number", async () => {
    const mock = mockFetch([
      { json: threadBody("owner", []) },
      { json: threadBody("main", comments(3, 10, 0)) },
      { json: threadBody("main", comments(3, 10, 0)) },
    ]);
    const api = createCommentsApi(testHttp(mock), noResolver);
    const all = await api.fetchAllComments(nvComment);
    expect(all).toHaveLength(3);
  });
});

describe("postComment", () => {
  it("fetches a post key then submits the comment", async () => {
    const mock = mockFetch([
      { json: { meta: { status: 200 }, data: { postKey: "pk" } } },
      { json: { meta: { status: 200 }, data: { id: "c1", no: 5 } } },
    ]);
    const api = createCommentsApi(testHttp(mock), noResolver);
    const result = await api.postComment({
      threadId: 1173108780,
      videoId: "sm9",
      body: "うぽつ",
      vposMs: 1000,
      commands: ["184"],
    });

    expect(mock.calls[0]?.url).toBe("https://nvapi.nicovideo.jp/v1/comment/keys/post?threadId=1173108780");
    const posted = mock.calls[1];
    expect(posted?.url).toBe("https://public.nvcomment.nicovideo.jp/v1/threads/1173108780/comments");
    expect(JSON.parse(posted?.body ?? "{}")).toEqual({
      videoId: "sm9",
      body: "うぽつ",
      commands: ["184"],
      vposMs: 1000,
      postKey: "pk",
    });
    expect(result).toEqual({ id: "c1", no: 5 });
  });

  it("skips the key fetch when one is supplied", async () => {
    const mock = mockFetch({ json: { meta: { status: 200 }, data: { id: "c1", no: 1 } } });
    const api = createCommentsApi(testHttp(mock), noResolver);
    await api.postComment({ threadId: 1, videoId: "sm9", body: "x", vposMs: 0, postKey: "given" });
    expect(mock.calls).toHaveLength(1);
  });
});

describe("regressions from review", () => {
  it("rejects on cancellation instead of resolving with a partial archive", async () => {
    const controller = new AbortController();
    controller.abort();
    const mock = mockFetch({ json: threadBody("main", comments(1, 1)) });
    const api = createCommentsApi(testHttp(mock), noResolver);
    await expect(api.fetchAllComments(nvComment, { signal: controller.signal })).rejects.toBeTruthy();
    expect(mock.calls).toHaveLength(0);
  });
});
