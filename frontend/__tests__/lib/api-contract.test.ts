import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contract test: the TypeScript response types must match the FastAPI schemas.
 *
 * The frontend types are hand-written (so the app builds without the API running),
 * which means nothing forces them to stay in step with the backend. A renamed or
 * added field shows up at runtime as `undefined` in the UI rather than as a type
 * error. This test compares the two directly.
 *
 * It reads `openapi.json` from a live API. When the API is not running the suite
 * is skipped rather than failed, so `npm test` still works offline -- the skip is
 * reported so a silent loss of coverage is visible.
 */

const OPENAPI_URL =
  process.env.OPENAPI_URL ?? "http://localhost:8000/openapi.json";

interface OpenApiSchema {
  properties: Record<string, unknown>;
}

interface OpenApiDocument {
  components: { schemas: Record<string, OpenApiSchema> };
  paths: Record<string, Record<string, unknown>>;
}

let document: OpenApiDocument | null = null;
let unreachable = false;

try {
  // Bounded by a race rather than an AbortSignal: under vitest's jsdom
  // environment the global AbortController produces a signal that Node's fetch
  // rejects with "Expected signal to be an instance of AbortSignal". Without
  // this bound, a host that drops the connection instead of refusing it leaves
  // the request pending for minutes, which stalls collection and reports the
  // suite as skipped for the wrong reason.
  const response = await Promise.race([
    fetch(OPENAPI_URL),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("openapi.json did not respond in time")), 3000),
    ),
  ]);
  if (response.ok) document = (await response.json()) as OpenApiDocument;
  else unreachable = true;
} catch {
  unreachable = true;
}

/** Fields the API actually sends, ignoring nullability wrappers. */
function apiFields(document_: OpenApiDocument, schemaName: string): string[] {
  const schema = document_.components.schemas[schemaName];
  if (!schema) throw new Error(`Schema ${schemaName} not found in openapi.json`);
  return Object.keys(schema.properties).sort();
}

/**
 * The field names declared on a TypeScript interface.
 *
 * Parsed from the source rather than imported so the assertion stays honest: a
 * value-level import would be erased at runtime and could not be inspected.
 */
function tsFields(sourcePath: string, interfaceName: string): string[] {
  // Resolved relative to this file so the test does not depend on cwd.
  const url = new URL(sourcePath, import.meta.url);
  return readInterfaceFields(url.pathname.replace(/^\/([A-Za-z]:)/, "$1"), interfaceName);
}

function readInterfaceFields(absolutePath: string, interfaceName: string): string[] {
  return collectInterfaceFields(absolutePath, interfaceName, new Set());
}

/**
 * Reads an interface's fields, unioning in those of any interface it extends.
 *
 * The union is required because the two sides model inheritance differently.
 * OpenAPI flattens a subclass's schema, so `FileDetailResponse` reports the
 * inherited fields alongside its own. A TypeScript `extends` clause does not: the
 * base fields live in the parent declaration. Comparing the local fields alone
 * would report a spurious mismatch for every inherited response type.
 */
function collectInterfaceFields(
  absolutePath: string,
  interfaceName: string,
  seen: Set<string>,
): string[] {
  // Guards against a cyclic `extends` chain, which TypeScript allows.
  if (seen.has(interfaceName)) return [];
  seen.add(interfaceName);

  const source = readFileSync(absolutePath, "utf8");

  const declaration = source.match(
    new RegExp(
      `(?:export\\s+)?interface\\s+${interfaceName}\\b([^{]*)\\{([\\s\\S]*?)\\n\\}`,
      "m",
    ),
  );
  if (!declaration) throw new Error(`Interface ${interfaceName} not found in ${absolutePath}`);

  const fields = new Set<string>();

  const bases = declaration[1].match(/extends\s+([\w\s,]+)/);
  if (bases) {
    for (const base of bases[1].split(",").map((name) => name.trim()).filter(Boolean)) {
      for (const field of collectInterfaceFields(absolutePath, base, seen)) fields.add(field);
    }
  }

  for (const line of declaration[2].split("\n")) {
    // Skip comments, nested braces and optionality markers.
    const match = line.match(/^\s{2}([A-Za-z_][A-Za-z0-9_]*)\??\s*:/);
    if (match) fields.add(match[1]);
  }

  return [...fields].sort();
}

describe.skipIf(unreachable)("frontend types match the API contract", () => {
  it("exposes the documented project endpoints", () => {
    const paths = Object.keys(document!.paths);
    for (const path of [
      "/api/projects/",
      "/api/projects/{project_id}",
      "/api/projects/{project_id}/members",
      "/api/projects/{project_id}/quota",
    ]) {
      expect(paths).toContain(path);
    }
  });

  it("matches ProjectResponse", () => {
    expect(tsFields("../../lib/api/types.ts", "ProjectResponse")).toEqual(
      apiFields(document!, "ProjectResponse"),
    );
  });

  it("matches ProjectListResponse", () => {
    expect(tsFields("../../lib/api/types.ts", "ProjectListResponse")).toEqual(
      apiFields(document!, "ProjectListResponse"),
    );
  });

  it("matches ProjectMemberResponse", () => {
    expect(tsFields("../../lib/api/types.ts", "ProjectMemberResponse")).toEqual(
      apiFields(document!, "ProjectMemberResponse"),
    );
  });

  it("matches ProjectDetailResponse", () => {
    expect(tsFields("../../lib/api/types.ts", "ProjectDetailResponse")).toEqual(
      apiFields(document!, "ProjectDetailResponse"),
    );
  });

  it("matches the /api/users/me response", () => {
    expect(tsFields("../../lib/api/types.ts", "UserResponse")).toEqual(
      apiFields(document!, "app__users__schemas__UserResponse"),
    );
  });

  it("matches the user embedded in project responses", () => {
    expect(tsFields("../../lib/api/types.ts", "ProjectUserResponse")).toEqual(
      apiFields(document!, "app__projects__schemas__UserResponse"),
    );
  });

  it("matches QuotaResponse", () => {
    expect(tsFields("../../lib/api/types.ts", "QuotaResponse")).toEqual(
      apiFields(document!, "QuotaResponse"),
    );
  });

  /**
   * File coverage.
   *
   * These endpoints were previously unchecked, which let two real defects through:
   * `listFiles` was typed as a bare array when the API returns a wrapper, and the
   * upload body used `content_type` against a `FileUpload` schema that forbids it.
   */
  it("matches FileResponse", () => {
    expect(tsFields("../../lib/api/types.ts", "FileResponse")).toEqual(
      apiFields(document!, "FileResponse"),
    );
  });

  it("matches FileDetailResponse", () => {
    expect(tsFields("../../lib/api/types.ts", "FileDetailResponse")).toEqual(
      apiFields(document!, "FileDetailResponse"),
    );
  });

  it("matches FileListResponse", () => {
    expect(tsFields("../../lib/api/types.ts", "FileListResponse")).toEqual(
      apiFields(document!, "FileListResponse"),
    );
  });

  it("matches the FileUpload request body", () => {
    expect(tsFields("../../lib/api/types.ts", "FileUploadPayload")).toEqual(
      apiFields(document!, "FileUpload"),
    );
  });

  it("exposes the documented file endpoints", () => {
    const paths = Object.keys(document!.paths);
    for (const path of [
      "/api/projects/{project_id}/files/",
      "/api/projects/{project_id}/files/{file_id}",
      "/api/projects/{project_id}/files/{file_id}/download",
    ]) {
      expect(paths).toContain(path);
    }
  });

  /**
   * The editor reads the PDF, the diagnostics and the wall-clock time straight off
   * this response, so a renamed field there breaks the preview and the logs drawer
   * rather than surfacing as a type error.
   */
  it("matches CompileResponse", () => {
    expect(tsFields("../../lib/api/types.ts", "CompileResponse")).toEqual(
      apiFields(document!, "CompileResponse"),
    );
  });

  /** Errors are `list[dict]`, so the shape is enforced by the log parser's tests. */
  it("matches Diagnostic, the shape the compiler's parser emits", () => {
    // Declared locally rather than imported: the assertion reads the source text,
    // and a value import would be erased before the test could inspect it.
    expect(tsFields("../../lib/api/types.ts", "Diagnostic")).toEqual([
      "file",
      "line",
      "message",
      "severity",
    ]);
  });

  it("exposes the compile endpoint the editor posts to", () => {
    expect(Object.keys(document!.paths)).toContain("/api/compile/");
  });

  /**
   * Guards the UI's honesty about what the backend cannot do. If someone adds
   * ZIP export, duplication, tags or templates to the API, these assertions fail
   * and the "not implemented yet" affordances in the dashboard get revisited.
   */
  it("still lacks the endpoints the dashboard reports as unimplemented", () => {
    const paths = Object.keys(document!.paths);
    for (const path of [
      "/api/projects/{project_id}/duplicate",
      "/api/projects/{project_id}/export",
      "/api/projects/{project_id}/tags",
      "/api/templates/",
    ]) {
      expect(paths).not.toContain(path);
    }
  });
});
