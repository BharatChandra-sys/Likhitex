/**
 * Typed API contract, mirroring the FastAPI schemas in `apps/api/app`.
 *
 * Hand-written rather than generated so the frontend stays buildable without the
 * API running. Field names match the snake_case JSON the API emits; there is
 * deliberately no global key-rewriting layer, because a silent transform hides
 * mismatches instead of surfacing them.
 */

// --- Shared primitives -----------------------------------------------------

export type UUID = string;

export type Role = "viewer" | "editor" | "owner";

export type Severity = "error" | "warning";

/** A single editor diagnostic, produced by the compiler's log parser. */
export interface Diagnostic {
  /** Project-relative path; empty when the engine did not attribute one. */
  file: string;
  /** 1-based; 0 when TeX reported no line. */
  line: number;
  message: string;
  severity: Severity;
}

// --- Users -----------------------------------------------------------------

/**
 * Profile returned by `/api/users/me`.
 *
 * `is_blocked` is deliberately absent: the API reports a blocked user as
 * forbidden (403), never as a field, so there is nothing here to branch on.
 */
export interface UserResponse {
  id: string;
  email: string;
  full_name: string | null;
  quota_used_bytes: number;
  created_at: string;
  last_login_at: string | null;
}

/**
 * The reduced user embedded in project responses.
 *
 * This is a different schema from the `/api/users/me` one above -- the API
 * declares two `UserResponse` classes -- so it gets its own name here rather
 * than silently reusing the profile shape and inventing fields.
 */
export interface ProjectUserResponse {
  id: string;
  email: string;
  full_name: string | null;
}

export interface QuotaResponse {
  used_bytes: number;
  quota_bytes: number;
  remaining_bytes: number;
  percentage_used: number;
}

// --- Projects --------------------------------------------------------------

export interface ProjectResponse {
  id: UUID;
  name: string;
  description: string | null;
  owner_id: string;
  size_bytes: number;
  created_at: string;
  updated_at: string;
  last_compiled_at: string | null;
}

/** Membership is nested under `user`; there are no flat `user_id`/`project_id`. */
export interface ProjectMemberResponse {
  id: UUID;
  user: ProjectUserResponse;
  role: Role;
  added_at: string;
}

export interface ProjectDetailResponse extends ProjectResponse {
  owner: ProjectUserResponse;
  members: ProjectMemberResponse[];
  file_count: number;
}

export interface ProjectListResponse {
  projects: ProjectResponse[];
  total: number;
  page: number;
  page_size: number;
}

// --- Files -----------------------------------------------------------------

/**
 * File metadata, as returned by list/create/update.
 *
 * The API calls the file-type discriminator `type` (not `content_type`), and
 * also returns a `hash`. Both are required here because the request schemas use
 * `extra="forbid"`: sending a field the backend does not declare is a 422, not a
 * silently ignored extra.
 */
export interface FileResponse {
  id: UUID;
  project_id: UUID;
  path: string;
  /** Short alphanumeric file type, e.g. `tex`, `bib`, `png`. */
  type: string;
  size_bytes: number;
  hash: string;
  created_at: string;
  updated_at: string;
}

/** A single file plus its inline content, as returned by `GET .../files/{id}`. */
export interface FileDetailResponse extends FileResponse {
  content: string | null;
  storage_key: string | null;
  download_url: string | null;
}

/**
 * The result of `GET .../files/`.
 *
 * This is a wrapper object, not a bare array, and carries the project's total
 * size. Treating it as an array yields `undefined` for every field.
 */
export interface FileListResponse {
  files: FileResponse[];
  total_size_bytes: number;
}

/**
 * Body of `POST .../files/`.
 *
 * Named rather than inlined at the call site so the contract test can compare it
 * against the API's `FileUpload` schema -- an inline object type is invisible to
 * that check, which is how a `content_type` typo survived review here.
 *
 * `type` is optional and, when given, must be alphanumeric: the API rejects a
 * slash, so `text/plain` is a 422. The backend derives the stored type from the
 * file extension regardless, so omitting it is the simplest correct call.
 */
export interface FileUploadPayload {
  /** Project-relative path. Must not be absolute or traverse upwards. */
  path: string;
  /** File content: text, or base64 for binary. */
  content: string;
  /** Short alphanumeric type override, e.g. `tex`. Usually omitted. */
  type?: string;
}

// --- Compile ---------------------------------------------------------------

export interface CompileResponse {
  success: boolean;
  /** Base64-encoded PDF, or null when compilation failed. */
  pdf: string | null;
  log: string;
  /** Base64-encoded SyncTeX data, used for editor/PDF scroll sync. */
  synctex: string | null;
  errors: Diagnostic[];
  warnings: Diagnostic[];
  /** Wall-clock seconds. */
  compile_time: number;
  error: string | null;
  /** Stable machine-readable failure kind, e.g. 'timeout', 'blocked_package'. */
  error_type: string | null;
}

// --- Errors ----------------------------------------------------------------

/**
 * Structured API failure.
 *
 * Every error path returns `{ error, message, request_id }`, so `requestId` is
 * always worth surfacing: it is the only way to tie a user-reported failure to
 * a specific server log line.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly details: unknown;

  constructor(
    status: number,
    message: string,
    options: {
      code?: string | null;
      requestId?: string | null;
      details?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = options.code ?? null;
    this.requestId = options.requestId ?? null;
    this.details = options.details ?? null;
  }

  /** True when the user needs to sign in again. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** True when the account is blocked or not invited. */
  get isForbidden(): boolean {
    return this.status === 403;
  }

  /** True when the resource is missing, or hidden from this user. */
  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** True when a storage or input quota was exceeded. */
  get isQuotaExceeded(): boolean {
    return this.status === 413;
  }

  /** True for conflicts such as duplicate membership or duplicate path. */
  get isConflict(): boolean {
    return this.status === 409;
  }

  /** True when the request failed schema validation. */
  get isValidation(): boolean {
    return this.status === 422;
  }

  /** True for network failures and timeouts, where no HTTP status exists. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}