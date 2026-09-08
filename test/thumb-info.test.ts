import { describe, expect, it } from "vitest";
import { createThumbInfoApi, parseThumbInfoXml, parseThumbLength, ThumbInfoError } from "../src/thumb-info.js";
import { mockFetch, testHttp } from "./helpers.js";

const USER_VIDEO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nicovideo_thumb_response status="ok"><thumb><video_id>sm500873</video_id><title>組曲『ニコニコ動画』 </title><description>700万再生、ありがとうございました。</description><thumbnail_url>https://nicovideo.cdn.nimg.jp/thumbnails/500873/500873</thumbnail_url><first_retrieve>2007-06-23T18:27:06+09:00</first_retrieve><length>10:48</length><movie_type>mp4</movie_type><size_high>1</size_high><size_low>1</size_low><view_counter>12291900</view_counter><comment_num>5022240</comment_num><mylist_counter>157228</mylist_counter><last_res_body>うぽつ</last_res_body><watch_url>https://www.nicovideo.jp/watch/sm500873</watch_url><thumb_type>video</thumb_type><embeddable>1</embeddable><no_live_play>0</no_live_play><tags domain="jp"><tag lock="1">音楽</tag><tag category="1">アレンジ</tag><tag>ニコニコメドレーシリーズ</tag></tags><genre>音楽・サウンド</genre><user_id>145217</user_id><user_nickname>しも</user_nickname><user_icon_url>https://secure-dcdn.cdn.nimg.jp/nicoaccount/usericon/defaults/blank.jpg</user_icon_url></thumb></nicovideo_thumb_response>`;

const CHANNEL_VIDEO_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nicovideo_thumb_response status="ok"><thumb><video_id>so46750735</video_id><title>鉄鍋のジャン！ 第9話</title><description>d</description><length>23:35</length><view_counter>72530</view_counter><comment_num>11980</comment_num><mylist_counter>127</mylist_counter><embeddable>1</embeddable><no_live_play>0</no_live_play><tags domain="jp"><tag lock="1">アニメ</tag></tags><genre>アニメ</genre><ch_id>2650214</ch_id><ch_name>鉄鍋のジャン！</ch_name><ch_icon_url>https://secure-dcdn.cdn.nimg.jp/comch/channel-icon/128x128/ch2650214.jpg</ch_icon_url></thumb></nicovideo_thumb_response>`;

const NOT_FOUND_XML = `<?xml version="1.0" encoding="UTF-8"?>
<nicovideo_thumb_response status="fail"><error><code>NOT_FOUND</code><description>not found or invalid</description></error></nicovideo_thumb_response>`;

describe("parseThumbLength", () => {
  it("converts mm:ss and h:mm:ss", () => {
    expect(parseThumbLength("10:48")).toBe(648);
    expect(parseThumbLength("1:02:03")).toBe(3723);
    expect(parseThumbLength("0:05")).toBe(5);
  });

  it("returns 0 for malformed input", () => {
    expect(parseThumbLength("")).toBe(0);
    expect(parseThumbLength("::")).toBe(0);
  });
});

describe("parseThumbInfoXml", () => {
  it("parses a user video, including per-tag attributes", () => {
    const result = parseThumbInfoXml(USER_VIDEO_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const info = result.info;
    expect(info.videoId).toBe("sm500873");
    expect(info.title).toBe("組曲『ニコニコ動画』 ");
    expect(info.durationSeconds).toBe(648);
    expect(info.viewCounter).toBe(12291900);
    expect(info.embeddable).toBe(true);
    expect(info.noLivePlay).toBe(false);
    expect(info.genre).toBe("音楽・サウンド");
    expect(info.tagDomain).toBe("jp");
    expect(info.tags).toEqual([
      { tag: "音楽", category: false, lock: true },
      { tag: "アレンジ", category: true, lock: false },
      { tag: "ニコニコメドレーシリーズ", category: false, lock: false },
    ]);
    expect(info.userId).toBe("145217");
    expect(info.userNickname).toBe("しも");
    expect(info.channelId).toBeNull();
  });

  it("parses a channel video, where ch_* replaces user_*", () => {
    const result = parseThumbInfoXml(CHANNEL_VIDEO_XML);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.channelId).toBe("2650214");
    expect(result.info.channelName).toBe("鉄鍋のジャン！");
    expect(result.info.userId).toBeNull();
    expect(result.info.userNickname).toBeNull();
  });

  it("returns the failure block for a deleted or unknown video", () => {
    const result = parseThumbInfoXml(NOT_FOUND_XML);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toEqual({ code: "NOT_FOUND", description: "not found or invalid" });
  });

  it("reports malformed XML instead of throwing", () => {
    const result = parseThumbInfoXml("<html>nope</html>");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.code).toBe("MALFORMED_RESPONSE");
  });
});

describe("ThumbInfoApi", () => {
  it("fetches and parses", async () => {
    const mock = mockFetch({ text: USER_VIDEO_XML, headers: { "Content-Type": "text/xml" } });
    const info = await createThumbInfoApi(testHttp(mock)).getThumbInfo("sm500873");
    expect(info.videoId).toBe("sm500873");
    expect(mock.only().url).toBe("https://ext.nicovideo.jp/api/getthumbinfo/sm500873");
  });

  it("throws ThumbInfoError carrying the API code", async () => {
    const mock = mockFetch({ text: NOT_FOUND_XML });
    const error = (await createThumbInfoApi(testHttp(mock))
      .getThumbInfo("sm1")
      .catch((e: unknown) => e)) as ThumbInfoError;
    expect(error).toBeInstanceOf(ThumbInfoError);
    expect(error.code).toBe("NOT_FOUND");
  });

  it("returns null from tryGetThumbInfo instead of throwing", async () => {
    const mock = mockFetch({ text: NOT_FOUND_XML });
    await expect(createThumbInfoApi(testHttp(mock)).tryGetThumbInfo("sm1")).resolves.toBeNull();
  });
});
