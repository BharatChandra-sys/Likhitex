/**
 * Public entry point for the API layer.
 *
 * `types.legacy.ts` holds the original hand-rolled interfaces from before the
 * schema was verified against the backend. Several of its endpoints do not
 * exist (`/archive`, `/restore`, `/upload`) and its file routes key on path
 * rather than the UUIDs the API actually uses, so it is not exported here.
 */

export { api, API_BASE_URL, COMPILE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS } from "./client";
export type { RequestOptions, TokenProvider } from "./client";
export { setTokenProvider, resetTokenProvider } from "./client";

export { ApiError } from "./types";
export type {
  CompileResponse,
  Diagnostic,
  FileResponse,
  ProjectDetailResponse,
  ProjectListResponse,
  ProjectMemberResponse,
  ProjectResponse,
  QuotaResponse,
  Role,
  Severity,
  UUID,
  UserResponse,
} from "./types";