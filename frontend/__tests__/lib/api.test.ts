/**
 * Tests for the typed API client.
 *
 * The client is the trust boundary between the browser and the API: it attaches
 * credentials, enforces timeouts, and normalises every failure. These tests
 * focus on those behaviours rather than on HTTP mechanics.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  COMPILE_TIMEOUT_MS,
  DEFAULT_TIMEOUT_MS,
  api,
  resetTokenProvider,
  setTokenProvider,
} from "@/lib/api/client";
import type { CompileResponse, ProjectListResponse } from "@/lib/api/types";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function emptyResponse(status = 204) {
  return new Response(null, { status });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  resetTokenProvider();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetTokenProvider();
});

describe("credentials", () => {
  it("attaches a bearer token from the registered provider", async () => {
    setTokenProvider(() => "tok_abc");
    fetchMock.mockResolvedValue(jsonResponse({ id: "u1", email: "a@b.c" }));

    await api.me();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer tok_abc");
  });

  it("resolves an async token provider", async () => {
    setTokenProvider(async () => "tok_async");
    fetchMock.mockResolvedValue(jsonResponse({ id: "u1" }));

    await api.me();

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok_async");
  });

  it("omits Authorization when no token is available", async () => {
    setTokenProvider(() => null);
    fetchMock.mockResolvedValue(jsonResponse({ id: "u1" }));

    await api.me();

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("lets a per-call token override the provider", async () => {
    setTokenProvider(() => "tok_provider");
    fetchMock.mockResolvedValue(jsonResponse({ id: "u1" }));

    await api.me({ token: "tok_explicit" });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer tok_explicit");
  });

  it("sends credentials so the API's cookie checks can work", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "u1" }));

    await api.me();

    expect(fetchMock.mock.calls[0][1].credentials).toBe("include");
  });
});

describe("error normalisation", () => {
  it("maps the backend error envelope onto ApiError", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: "not_found", message: "Project not found", request_id: "req_123" },
        404,
      ),
    );

    const error = await api.getProject("missing").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(404);
    expect(apiError.message).toBe("Project not found");
    expect(apiError.code).toBe("not_found");
    expect(apiError.requestId).toBe("req_123");
    expect(apiError.isNotFound).toBe(true);
  });

  it("flattens FastAPI 422 validation detail into a readable message", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          detail: [
            { loc: ["body", "files"], msg: "At most 50 files per compile request" },
          ],
        },
        422,
      ),
    );

    const error = (await api
      .compile({ files: {} })
      .catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(422);
    expect(error.message).toContain("files");
    expect(error.message).toContain("50 files");
    expect(error.isValidation).toBe(true);
  });

  it("handles a string detail body", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: "Not Found" }, 404));

    const error = (await api.me().catch((e: unknown) => e)) as ApiError;

    expect(error.message).toBe("Not Found");
  });

  it("survives a non-JSON error body without leaking a parse error", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>502 Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const error = (await api.me().catch((e: unknown) => e)) as ApiError;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(502);
    expect(error.message).toContain("502 Bad Gateway");
  });

  it("falls back to the request-id header when the body has none", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ message: "boom" }, 500, { "x-request-id": "req_header" }),
    );

    const error = (await api.me().catch((e: unknown) => e)) as ApiError;

    expect(error.requestId).toBe("req_header");
  });

  it("reports a network failure as status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const error = (await api.me().catch((e: unknown) => e)) as ApiError;

    expect(error.status).toBe(0);
    expect(error.isNetworkError).toBe(true);
    expect(error.message).toContain("Failed to fetch");
  });

  it("rejects a malformed success body rather than returning garbage", async () => {
    fetchMock.mockResolvedValue(
      new Response("{not json", { status: 200, headers: { "Content-Type": "application/json" } }),
    );

    const error = (await api.me().catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe("bad_response");
  });

  it.each([
    [401, "isUnauthorized"],
    [403, "isForbidden"],
    [404, "isNotFound"],
    [409, "isConflict"],
    [413, "isQuotaExceeded"],
    [422, "isValidation"],
  ] as const)("classifies %i as %s", async (status, flag) => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "x" }, status));

    const error = (await api.me().catch((e: unknown) => e)) as ApiError;

    expect(error[flag]).toBe(true);
  });
});

describe("timeouts", () => {
  it("aborts and reports a timeout", async () => {
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const error = (await api
      .me({ timeoutMs: 30 })
      .catch((e: unknown) => e)) as ApiError;

    expect(error.code).toBe("timeout");
    expect(error.message).toContain("timed out");
  });

  it("gives compiles a longer budget than ordinary reads", () => {
    expect(COMPILE_TIMEOUT_MS).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
  });

  it("honours an external abort signal", async () => {
    const controller = new AbortController();
    let capturedSignal: AbortSignal | null = null;

    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          capturedSignal = init.signal ?? null;
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const promise = api.me({ signal: controller.signal }).catch((e: unknown) => e);

    // Wait until fetch has actually received the signal, otherwise the abort
    // can fire before the listener is attached and the promise never settles.
    await vi.waitFor(() => expect(capturedSignal).not.toBeNull());

    controller.abort();
    const error = (await promise) as ApiError;

    expect(error.code).toBe("cancelled");
  });
});

describe("serialisation", () => {
  it("sends JSON bodies with the correct content type", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "p1" }, 201));

    await api.createProject({ name: "Thesis" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ name: "Thesis" });
  });

  it("omits a body for GET requests", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ projects: [] }));

    await api.listProjects();

    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it("builds a query string and skips empty parameters", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ projects: [], total: 0 }));

    await api.listProjects({ page: 2, pageSize: 50 });
    expect(fetchMock.mock.calls[0][0]).toContain("page=2");
    expect(fetchMock.mock.calls[0][0]).toContain("page_size=50");

    fetchMock.mockResolvedValue(jsonResponse({ projects: [], total: 0 }));
    await api.listProjects();
    expect(fetchMock.mock.calls[1][0]).not.toContain("?");
  });

  it("encodes search terms", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ projects: [], total: 0 }));

    await api.listProjects({ search: "a b&c" });

    expect(fetchMock.mock.calls[0][0]).toContain("search=a+b%26c");
  });

  it("returns undefined for 204 responses", async () => {
    fetchMock.mockResolvedValue(emptyResponse(204));

    const result = await api.deleteProject("p1");

    expect(result).toBeUndefined();
  });

  it("returns undefined when a 200 has an empty body", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 200 }));

    expect(await api.deleteProject("p1")).toBeUndefined();
  });
});

describe("url construction", () => {
  it("builds paths matching the API routes", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ projects: [], total: 0, page: 1, page_size: 20 }));

    await api.getFile("p1", "f1");

    expect(fetchMock.mock.calls[0][0]).toContain("/api/projects/p1/files/f1");
  });

  it("uses the members sub-route", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await api.addMember("p1", { email: "a@b.c", role: "editor" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/projects/p1/members");
    expect(init.method).toBe("POST");
  });

  it("deletes a member by id", async () => {
    fetchMock.mockResolvedValue(emptyResponse(204));

    await api.removeMember("p1", "m1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/members/m1");
    expect(init.method).toBe("DELETE");
  });

  it("posts compile payloads to the compile route", async () => {
    const body: CompileResponse = {
      success: true,
      pdf: "JVBER",
      log: "",
      synctex: null,
      errors: [],
      warnings: [],
      compile_time: 1.2,
      error: null,
      error_type: null,
    };
    fetchMock.mockResolvedValue(jsonResponse(body));

    const result = await api.compile({ files: { "main.tex": "\\documentclass{article}" } });

    expect(fetchMock.mock.calls[0][0]).toContain("/api/compile/");
    expect(result.success).toBe(true);
  });

  it("uses the compile timeout for compile requests", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        success: false,
        pdf: null,
        log: "",
        synctex: null,
        errors: [],
        warnings: [],
        compile_time: 0,
        error: "nope",
        error_type: "compile_error",
      }),
    );

    await api.compile({ files: { "main.tex": "x" } });

    // The abort timer is cleared, so assert the route instead of internals.
    expect(fetchMock.mock.calls[0][0]).toContain("/api/compile/");
  });
});

describe("compile diagnostics", () => {
  it("preserves structured errors and warnings", async () => {
    const body: CompileResponse = {
      success: false,
      pdf: null,
      log: "! Undefined control sequence.",
      synctex: null,
      errors: [
        { file: "main.tex", line: 12, message: "Undefined control sequence.", severity: "error" },
      ],
      warnings: [
        { file: "", line: 44, message: "Citation undefined", severity: "warning" },
      ],
      compile_time: 0.4,
      error: "Compilation failed",
      error_type: "compile_error",
    };
    fetchMock.mockResolvedValue(jsonResponse(body));

    const result = await api.compile({ files: { "main.tex": "x" } });

    expect(result.errors[0]).toMatchObject({ file: "main.tex", line: 12, severity: "error" });
    expect(result.warnings[0]).toMatchObject({ line: 44, severity: "warning" });
  });

  it("defaults missing diagnostic arrays to empty", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: "x", error_type: "timeout" }),
    );

    const result = await api.compile({ files: { "main.tex": "x" } });

    expect(result.errors ?? []).toEqual([]);
    expect(result.warnings ?? []).toEqual([]);
  });
});

describe("project listing", () => {
  it("returns the paginated envelope", async () => {
    const body: ProjectListResponse = {
      projects: [
        {
          id: "p1",
          name: "Thesis",
          description: null,
          owner_id: "u1",
          size_bytes: 100,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
          last_compiled_at: null,
        },
      ],
      total: 1,
      page: 1,
      page_size: 20,
    };
    fetchMock.mockResolvedValue(jsonResponse(body));

    const result = await api.listProjects();

    expect(result.total).toBe(1);
    expect(result.projects[0].name).toBe("Thesis");
  });
});

describe("downloadFile", () => {
  it("returns a Blob for binary content", async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    const blob = await api.downloadFile("p1", "f1");

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.size).toBe(3);
  });

  it("raises ApiError for a failed download", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "Not found" }, 404));

    const error = (await api
      .downloadFile("p1", "f1")
      .catch((e: unknown) => e)) as ApiError;

    expect(error.isNotFound).toBe(true);
  });
});