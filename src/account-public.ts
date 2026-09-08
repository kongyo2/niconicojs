import { NiconicoError } from "./errors.js";
import { buildQuery, type NiconicoHttp, type RequestOptions } from "./http.js";

const BASE = "https://account.nicovideo.jp/api/public";

export interface AccountPublicUser {
  userId: string;
  nickname: string;
  description: string;
  hasPremiumOrStrongerRights?: boolean;
  hasSuperPremiumOrStrongerRights?: boolean;
  icons: { urls: Record<string, string> };
}

export interface AccountOwnUser {
  userId: string;
  nickname: string;
  area?: string;
  language?: string;
  locale?: string;
  timezone?: string;
  isExplicitlyLoginable?: boolean;
  description?: string;
  hasPremiumOrStrongerRights?: boolean;
  hasSuperPremiumOrStrongerRights?: boolean;
  premium?: { type: string };
  icons: { urls: Record<string, string> };
  existence?: {
    residence?: { country?: string; prefecture?: string };
    birthday?: string;
    sex?: string;
  };
  contacts?: {
    emails?: Record<string, { address?: string; is_feature_phone?: boolean; is_confirmed?: boolean }>;
  };
  [k: string]: unknown;
}

export interface AccountPublicApi {
  getUsers(userIds: readonly (number | string)[], options?: RequestOptions): Promise<AccountPublicUser[]>;
  getMe(options?: RequestOptions): Promise<AccountOwnUser>;
}

export function createAccountPublicApi(http: NiconicoHttp): AccountPublicApi {
  return {
    async getUsers(userIds, options = {}) {
      if (userIds.length === 0) {
        throw new NiconicoError("getUsers: userIds must not be empty");
      }
      const query = buildQuery({ userIds: userIds.map(String) });
      const res = await http.getJson<{ data?: AccountPublicUser[] }>(`${BASE}/v1/users.json${query}`, options);
      return res.data ?? [];
    },

    async getMe(options = {}) {
      const res = await http.getJson<{ data?: AccountOwnUser }>(`${BASE}/v2/user.json`, options);
      if (res.data === undefined) {
        throw new NiconicoError("account public API: /v2/user.json returned no data");
      }
      return res.data;
    },
  };
}
