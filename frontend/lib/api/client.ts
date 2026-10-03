/**
 * Typed HTTP client for the Likhitex API.
 *
 * Responsibilities are deliberately narrow:
 * - attach the Clerk bearer token
 * - normalise every failure into `ApiError`
 * - enforce a request timeout so a hung call cannot wedge the UI
 * - surface `request_id` so a user-reported bug maps to a server log
 *
 * It does not cache, retry, or hold state. That belongs to the caller, so the
 * behaviour stays visible rather than hidden behind the transport.
 */

import { ApiError } from "./types";
export { ApiError } from "./types";
import type {
  CompileResponse,
  FileDetailResponse,
  FileListResponse,
  FileResponse,
  FileUploadPayload,
  ProjectDetailResponse,
  ProjectListResponse,
  ProjectMemberResponse,
  ProjectResponse,
  QuotaResponse,
  Role,
  UserResponse,
} from "./types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") ?? "http://localhost:8000";

/** Default per-request budget: long enough for a cold start, short enough to fail visibly. */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Compiles get a larger budget because TeX is legitimately slow. */
export const COMPILE_TIMEOUT_MS = 90_000;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
  timeoutMs?: number;
  /**
   * Allows the request to outlive the page. Use only for fire-and-forget saves on
   * unload: the browser silently drops a body over 64 KiB when this is set.
   */
  keepalive?: boolean;
}

/** Reads a bearer token from Clerk, tolerating the hook being absent in tests. */
export type TokenProvider = () => string | null | Promise<string | null>;

/**
 * Module-level token source, registered once by the Clerk provider.
 *
 * A provider indirection keeps `@clerk/nextjs` out of this module, so the client
 * stays unit-testable with neither the SDK nor React present.
 */
let tokenProvider: TokenProvider = () => null;

export function setTokenProvider(provider: TokenProvider): void {
  tokenProvider = provider;
}

/** Test seam: forget any registered provider. */
export function resetTokenProvider(): void {
  tokenProvider = () => null;
}

interface ErrorBody {
  error?: string;
  message?: string;
  request_id?: string;
  detail?: unknown;
}

/**
 * Build an AbortSignal that fires after `timeoutMs`.
 *
 * The caller's own signal is honoured too, so a component unmounting cancels
 * its request instead of leaking it.
 */
function buildSignal(
  timeoutMs: number,
  external?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let didTimeout = false;

  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  external?.addEventListener("abort", onExternalAbort);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onExternalAbort);
    },
    timedOut: () => didTimeout,
  };
}

/**
 * Parse an error response into a structured `ApiError`.
 *
 * FastAPI emits two shapes: `detail` for HTTPException, and
 * `error`/`message`/`request_id` from the app's own handlers. Both are handled
 * so no failure ever surfaces to a user as `[object Object]`.
 */
async function toApiError(response: Response): Promise<ApiError> {
  let body: ErrorBody = {};
  let text = "";

  try {
    text = await response.text();
    if (text) body = JSON.parse(text) as ErrorBody;
  } catch {
    // A non-JSON body (proxy HTML, gateway text) is still a useful message.
    body = { message: text.slice(0, 300) };
  }

  let message = body.message ?? body.error ?? response.statusText;
  const detail = body.detail;

  if (Array.isArray(detail)) {
    // 422 validation: [{ loc, msg, type }, ...]
    message = detail
      .map((item) => {
        const entry = item as { loc?: unknown[]; msg?: string };
        const field = entry.loc?.filter((part) => part !== "body").join(".");
        return field ? `${field}: ${entry.msg ?? "invalid"}` : (entry.msg ?? "invalid");
      })
      .join("; ");
  } else if (typeof detail === "string") {
    message = detail;
  }

  return new ApiError(response.status, message || "Request failed", {
    code: body.error ?? null,
    requestId: body.request_id ?? response.headers.get("x-request-id"),
    details: detail ?? null,
  });
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    token,
    signal: externalSignal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    keepalive = false,
  } = options;

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const resolvedToken = token ?? (await tokenProvider());
  if (resolvedToken) headers.Authorization = `Bearer ${resolvedToken}`;

  const { signal, cleanup, timedOut } = buildSignal(timeoutMs, externalSignal);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      // Clerk session tokens live in an httpOnly cookie; this lets the API's own
      // cookie-based checks work without widening CORS further.
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      // Lets an autosave survive the page being closed. The browser drops bodies
      // over 64 KiB when this is set, so callers must check the size first.
      keepalive,
    });
  } catch (error) {
    cleanup();
    if (timedOut()) {
      throw new ApiError(0, `Request timed out after ${Math.round(timeoutMs / 1000)}s`, {
        code: "timeout",
      });
    }
    if (externalSignal?.aborted) {
      throw new ApiError(0, "Request cancelled", { code: "cancelled" });
    }
    throw new ApiError(
      0,
      error instanceof Error ? error.message : "Network request failed",
      { code: "network_error" },
    );
  }

  cleanup();

  if (!response.ok) {
    throw await toApiError(response);
  }

  // 204 and 205 carry no body by definition.
  if (response.status === 204 || response.status === 205) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, "Malformed response from server", {
      code: "bad_response",
      details: text.slice(0, 300),
    });
  }
}

// --- Endpoint helpers ------------------------------------------------------

export const api = {
  // Users
  me: (options?: RequestOptions) => request<UserResponse>("/api/users/me", options),

  myQuota: (options?: RequestOptions) => request<QuotaResponse>("/api/users/me/quota", options),

  /**
   * Updates the display name.
   *
   * `full_name` is the only writable field; the API rejects anything else, and a
   * cleared name is sent as an explicit null rather than omitted, since the API
   * distinguishes "absent" (no-op) from "present but empty" (clear the name).
   */
  updateProfile: (payload: { full_name: string | null }, options?: RequestOptions) =>
    request<UserResponse>("/api/users/me", {
      ...options,
      method: "PATCH",
      body: payload,
    }),

  // Projects
  listProjects: (
    params: { page?: number; pageSize?: number; search?: string } = {},
    options?: RequestOptions,
  ) => {
    const query = new URLSearchParams();
    if (params.page) query.set("page", String(params.page));
    if (params.pageSize) query.set("page_size", String(params.pageSize));
    if (params.search) query.set("search", params.search);
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return request<ProjectListResponse>(`/api/projects/${suffix}`, options);
  },

  getProject: (id: string, options?: RequestOptions) =>
    request<ProjectDetailResponse>(`/api/projects/${id}`, options),

  createProject: (
    payload: { name: string; description?: string | null },
    options?: RequestOptions,
  ) =>
    request<ProjectResponse>("/api/projects/", {
      ...options,
      method: "POST",
      body: payload,
    }),

  updateProject: (
    id: string,
    payload: { name?: string; description?: string | null },
    options?: RequestOptions,
  ) =>
    request<ProjectResponse>(`/api/projects/${id}`, {
      ...options,
      method: "PATCH",
      body: payload,
    }),

  deleteProject: (id: string, options?: RequestOptions) =>
    request<void>(`/api/projects/${id}`, { ...options, method: "DELETE" }),

  projectQuota: (id: string, options?: RequestOptions) =>
    request<QuotaResponse>(`/api/projects/${id}/quota`, options),

  // Members
  listMembers: (id: string, options?: RequestOptions) =>
    request<ProjectMemberResponse[]>(`/api/projects/${id}/members`, options),

  addMember: (id: string, payload: { email: string; role: Role }, options?: RequestOptions) =>
    request<ProjectMemberResponse>(`/api/projects/${id}/members`, {
      ...options,
      method: "POST",
      body: payload,
    }),

  updateMember: (
    id: string,
    memberId: string,
    payload: { role: Role },
    options?: RequestOptions,
  ) =>
    request<ProjectMemberResponse>(`/api/projects/${id}/members/${memberId}`, {
      ...options,
      method: "PATCH",
      body: payload,
    }),

  removeMember: (id: string, memberId: string, options?: RequestOptions) =>
    request<void>(`/api/projects/${id}/members/${memberId}`, { ...options, method: "DELETE" }),

  // Files
  /**
   * Returns a wrapper object, not a bare array. The previous signature typed this
   * as `FileResponse[]`, which made every read of `.path` or `.id` undefined at
   * runtime while still type-checking.
   */
  listFiles: (id: string, options?: RequestOptions) =>
    request<FileListResponse>(`/api/projects/${id}/files/`, options),

  /**
   * `type` is the field the API declares. Its request schema is
   * `extra="forbid"`, so sending `content_type` instead is rejected with a 422.
   */
  uploadFile: (
    id: string,
    payload: FileUploadPayload,
    options?: RequestOptions,
  ) =>
    request<FileResponse>(`/api/projects/${id}/files/`, {
      ...options,
      method: "POST",
      body: payload,
    }),

  /** Returns the file with its inline `content`. */
  getFile: (id: string, fileId: string, options?: RequestOptions) =>
    request<FileDetailResponse>(`/api/projects/${id}/files/${fileId}`, options),

  updateFile: (
    id: string,
    fileId: string,
    payload: { content: string },
    options?: RequestOptions,
  ) =>
    request<FileResponse>(`/api/projects/${id}/files/${fileId}`, {
      ...options,
      method: "PUT",
      body: payload,
    }),

  deleteFile: (id: string, fileId: string, options?: RequestOptions) =>
    request<void>(`/api/projects/${id}/files/${fileId}`, { ...options, method: "DELETE" }),

  /** Fetch raw bytes, e.g. to render a PDF preview. */
  downloadFile: async (id: string, fileId: string, options?: RequestOptions): Promise<Blob> => {
    const headers: Record<string, string> = {};
    const resolvedToken = options?.token ?? (await tokenProvider());
    if (resolvedToken) headers.Authorization = `Bearer ${resolvedToken}`;

    const { signal, cleanup, timedOut } = buildSignal(
      options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      options?.signal,
    );

    let response: Response;
    try {
      response = await fetch(
        `${API_BASE_URL}/api/projects/${id}/files/${fileId}/download`,
        { headers, credentials: "include", signal },
      );
    } catch (error) {
      cleanup();
      if (timedOut()) throw new ApiError(0, "Download timed out", { code: "timeout" });
      throw new ApiError(
        0,
        error instanceof Error ? error.message : "Network request failed",
        { code: "network_error" },
      );
    }

    cleanup();
    if (!response.ok) throw await toApiError(response);
    return response.blob();
  },

  // Compile
  compile: (
    payload: { files: Record<string, string>; main?: string },
    options?: RequestOptions,
  ) =>
    request<CompileResponse>("/api/compile/", {
      ...options,
      method: "POST",
      body: payload,
      timeoutMs: COMPILE_TIMEOUT_MS,
    }),

  compileHealth: (options?: RequestOptions) =>
    request<Record<string, unknown>>("/api/compile/health", options),

  // Collaboration
  createWsTicket: (id: string, options?: RequestOptions) =>
    request<{ ticket: string; expires_in: number }>(
      `/api/collab/projects/${id}/ws-ticket`,
      { ...options, method: "POST" },
    ),
};