"use client";

/**
 * Read-only viewer for files kept in object storage (images, PDFs, EPS).
 *
 * The bytes come through the API's authenticated download route rather than
 * the presigned URL, so the same code works for local storage in development
 * and Backblaze B2 in production.
 */

import { useEffect, useState } from "react";
import { Download, FileImage, Loader2, TriangleAlert } from "lucide-react";

import { api } from "@/lib/api/client";

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export interface BinaryFilePreviewProps {
  projectId: string;
  fileId: string | undefined;
  path: string;
  sizeBytes: number;
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BinaryFilePreview({
  projectId,
  fileId,
  path,
  sizeBytes,
}: BinaryFilePreviewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const extension = extensionOf(path);
  const name = path.split("/").pop() ?? path;
  const kind = extension in IMAGE_TYPES ? "image" : extension === "pdf" ? "pdf" : "other";

  useEffect(() => {
    if (!fileId) return;

    let objectUrl: string | null = null;
    // The parent keys this component by file id, so state starts fresh for
    // every file and needs no reset here.
    let cancelled = false;

    (async () => {
      try {
        const blob = await api.downloadFile(projectId, fileId);
        if (cancelled) return;
        // Re-type the blob: <img> will not render an SVG served as
        // application/octet-stream, and the iframe needs application/pdf.
        const type = IMAGE_TYPES[extension] ?? (extension === "pdf" ? "application/pdf" : blob.type);
        objectUrl = URL.createObjectURL(new Blob([blob], { type }));
        setUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [projectId, fileId, extension]);

  return (
    <div className="h-full flex flex-col min-h-0 bg-surface-container-low">
      <div className="h-9 px-3 border-b border-surface-container-high flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2 min-w-0 text-xs text-on-surface-variant">
          <FileImage className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate font-mono">{name}</span>
          <span className="text-outline shrink-0">· {formatBytes(sizeBytes)}</span>
          <span className="text-outline shrink-0">· read only</span>
        </div>
        {url && (
          <a
            href={url}
            download={name}
            className="h-7 px-2 rounded flex items-center gap-1.5 text-xs text-on-surface-variant hover:bg-surface-container transition-colors"
            aria-label={`Download ${name}`}
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </a>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto flex items-center justify-center p-6">
        {failed ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <TriangleAlert className="w-6 h-6 text-red-600" />
            <p className="text-sm text-on-surface">Could not load {name}</p>
            <p className="text-xs text-outline">The file may still be uploading. Try selecting it again.</p>
          </div>
        ) : !url ? (
          <div className="flex items-center gap-2 text-sm text-on-surface-variant">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading {name}…
          </div>
        ) : kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob URL, not an optimisable asset
          <img
            src={url}
            alt={name}
            className="max-w-full max-h-full object-contain rounded shadow-sm bg-white"
          />
        ) : kind === "pdf" ? (
          <iframe src={url} title={name} className="w-full h-full border-0 rounded bg-white" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-center">
            <FileImage className="w-8 h-8 text-outline" />
            <p className="text-sm text-on-surface">No preview for .{extension} files</p>
            <p className="text-xs text-outline">It is still included when the project compiles.</p>
          </div>
        )}
      </div>
    </div>
  );
}
