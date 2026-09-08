import { NiconicoApiError, NiconicoError } from "./errors.js";
import type { NiconicoHttp, RequestOptions } from "./http.js";
import type { AccountPublicApi } from "./account-public.js";

export const LOGIN_PAGE_URL = "https://account.nicovideo.jp/login?site=niconico";

export const SESSION_COOKIE_NAME = "user_session";

export interface SessionUser {
  userId: number;
  nickname: string;
  isPremium: boolean;
  premiumType: string | undefined;
  iconUrl: string | undefined;
}

export interface AuthApi {
  isLoggedIn(): boolean;
  verifySession(options?: RequestOptions): Promise<SessionUser>;
  isSessionValid(options?: RequestOptions): Promise<boolean>;
}

export class NiconicoAuthError extends NiconicoError {
  constructor(message: string) {
    super(`${message} Sign in at ${LOGIN_PAGE_URL} and pass the ${SESSION_COOKIE_NAME} cookie.`);
  }
}

export function createAuthApi(http: NiconicoHttp, accountPublic: AccountPublicApi): AuthApi {
  const api: AuthApi = {
    isLoggedIn() {
      return http.isLoggedIn();
    },

    async verifySession(options = {}) {
      if (!http.isLoggedIn()) {
        throw new NiconicoAuthError("No session cookie is configured.");
      }
      let me;
      try {
        me = await accountPublic.getMe(options);
      } catch (error) {
        if (error instanceof NiconicoApiError && (error.status === 401 || error.status === 403)) {
          throw new NiconicoAuthError(`The session cookie was rejected (HTTP ${error.status}).`);
        }
        throw error;
      }
      const userId = Number(me.userId);
      if (!Number.isFinite(userId)) {
        throw new NiconicoAuthError(`The session response carried no usable user id (${me.userId}).`);
      }
      return {
        userId,
        nickname: me.nickname,
        isPremium: me.hasPremiumOrStrongerRights ?? false,
        premiumType: me.premium?.type,
        iconUrl: me.icons.urls["150x150"] ?? me.icons.urls["50x50"],
      };
    },

    async isSessionValid(options = {}) {
      try {
        await api.verifySession(options);
        return true;
      } catch (error) {
        if (error instanceof NiconicoAuthError) return false;
        if (error instanceof NiconicoApiError) return false;
        throw error;
      }
    },
  };

  return api;
}
