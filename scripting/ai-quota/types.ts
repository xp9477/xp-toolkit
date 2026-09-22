export interface Config {
  cpaBaseUrl: string;
  cpaApiKey: string;
  configError?: string;
}

export interface ServiceAccountDetail {
  name: string;
  remainingPct: number | null;
  resetHint: string | null;
  resetAt: number | null;
  remaining5hPct?: number | null;
  reset5hHint?: string | null;
  reset5hAt?: number | null;
  extra?: string;
}

export type ServiceId = "grok" | "chatgpt" | "gemini";

export interface ServiceQuota {
  id: ServiceId;
  name: string;
  plan: string;
  remainingPct: number | null;
  usedPct: number | null;
  windowLabel: string;
  resetHint: string | null;
  resetAt: number | null;
  remaining5hPct: number | null;
  reset5hHint: string | null;
  reset5hAt: number | null;
  extra: string;
  url: string;
  ok: boolean;
  accountCount?: number;
  totalAccounts?: number;
  accountDetails?: ServiceAccountDetail[];
  warnings?: string[];
}

export interface CPAAuth {
  name?: string;
  provider?: string;
  type?: string;
  disabled?: boolean;
  auth_index?: string | number;
  authIndex?: string | number;
  account?: string;
  email?: string;
  account_id?: string;
  accountId?: string;
  chatgpt_account_id?: string;
  chatgptAccountId?: string;
  project_id?: string;
  projectId?: string;
  id_token?: { chatgpt_account_id?: string };
  idToken?: { chatgptAccountId?: string };
  [key: string]: any;
}

export interface CPAApiResponse {
  status_code?: number;
  statusCode?: number;
  body?: any;
}

export interface QuotaData {
  fetchedAt: string;
  grok: ServiceQuota;
  chatgpt: ServiceQuota;
  gemini: ServiceQuota;
  errors?: string[];
  isCached?: boolean;
}

export interface UsageWindow {
  usedPct: number | null;
  remainingPct: number | null;
  seconds: number | null;
  resetHint: string | null;
  resetAt: number | null;
  label: string;
  latent: boolean;
}

export interface CachePayload {
  scope: string;
  savedAt: string;
  data: QuotaData;
}
