"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { api, ApiError } from "@/lib/api/client";
import type {
  ProjectListResponse,
  ProjectResponse,
  QuotaResponse,
  UserResponse,
} from "@/lib/api/types";

/**
 * Dashboard data: the signed-in user, their storage quota, and one page of
 * projects.
 *
 * Every request here is user-initiated or first-load, so there is no polling and
 * no cache. Two details are load-bearing:
 *
 * - A stale response cannot overwrite a newer one. Rapid arrow-key paging or a
 *   fast search fires overlapping requests, and without the sequence guard the
 *   slower earlier response lands last and shows stale rows.
 * - `reload` is exposed so mutations (create, rename, delete) can refresh the
 *   list without each caller re-implementing fetching.
 */

export type LoadState = "loading" | "ready" | "error";

export interface UseProjectsResult {
  projects: ProjectResponse[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  /** Set while the first page loads; subsequent pages keep the table visible. */
  isInitialLoading: boolean;
  /** True while any request is in flight, used to dim rather than blank the UI. */
  isRefreshing: boolean;
  error: ApiError | null;
  search: string;
  setSearch: (value: string) => void;
  /** The search term actually sent to the server, after debounce. */
  appliedSearch: string;
  goToPage: (page: number) => void;
  reload: () => void;
}

const PAGE_SIZE = 20;

/** Debounce for the search box; long enough to avoid a request per keystroke. */
const SEARCH_DEBOUNCE_MS = 300;

export function useProjects(): UseProjectsResult {
  const { isLoaded, isSignedIn } = useAuth();
  const [data, setData] = useState<ProjectListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Monotonic request id; only the newest response is allowed to commit.
  const requestIdRef = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);

  // Whether any response has landed yet.
  const hasLoadedRef = useRef(false);

  // Debounce the search term into `appliedSearch`.
  useEffect(() => {
    if (search === appliedSearch) return;
    const timer = setTimeout(() => {
      setAppliedSearch(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, appliedSearch]);

  useEffect(() => {
    // Wait until Clerk has loaded and the token provider is registered.
    if (!isLoaded || !isSignedIn) {
      if (isLoaded && !isSignedIn) setIsInitialLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    if (hasLoadedRef.current) setIsRefreshing(true);
    else setIsInitialLoading(true);

    api
      .listProjects(
        { page, pageSize: PAGE_SIZE, search: appliedSearch || undefined },
        { signal: controller.signal },
      )
      .then((response) => {
        if (requestId !== requestIdRef.current) return;
        hasLoadedRef.current = true;
        setData(response);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (requestId !== requestIdRef.current) return;
        if (cause instanceof ApiError && cause.code === "cancelled") return;
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError(0, "Could not load projects", { code: "unknown" }),
        );
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        setIsInitialLoading(false);
        setIsRefreshing(false);
      });

    return () => controller.abort();
  }, [isLoaded, isSignedIn, page, appliedSearch, reloadToken]);

  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  return {
    projects: data?.projects ?? [],
    total: data?.total ?? 0,
    page,
    pageSize: PAGE_SIZE,
    pageCount,
    isInitialLoading,
    isRefreshing,
    error,
    search,
    setSearch,
    appliedSearch,
    goToPage: useCallback((next: number) => {
      setPage(Math.min(Math.max(1, next), pageCount));
    }, [pageCount]),
    reload: useCallback(() => setReloadToken((token) => token + 1), []),
  };
}

/** Signed-in profile, used for the header identity and the avatar chip. */
export interface UseCurrentUserResult {
  user: UserResponse | null;
  quota: QuotaResponse | null;
  error: ApiError | null;
  isLoading: boolean;
}

export function useCurrentUser(): UseCurrentUserResult {
  const { isLoaded, isSignedIn } = useAuth();
  const [user, setUser] = useState<UserResponse | null>(null);
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Wait until Clerk has loaded — otherwise the token provider isn't
    // registered yet and every call returns 401.
    if (!isLoaded) return;

    // Not signed in: nothing to fetch.
    if (!isSignedIn) {
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    // The quota is decoration on the header; a failure there must not blank the
    // name next to it, so the two are fetched independently and each settles on
    // its own rather than via Promise.all.
    api
      .me({ signal: controller.signal })
      .then((response) => {
        if (!cancelled) setUser(response);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof ApiError && cause.code === "cancelled") return;
        setError(
          cause instanceof ApiError
            ? cause
            : new ApiError(0, "Could not load your profile", { code: "unknown" }),
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    api
      .myQuota({ signal: controller.signal })
      .then((response) => {
        if (!cancelled) setQuota(response);
      })
      .catch(() => {
        // Left null; the meter renders an indeterminate state.
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isLoaded, isSignedIn]);

  return { user, quota, error, isLoading };
}

/**
 * Splits the fetched projects into the two buckets the sidebar can honestly
 * offer.
 *
 * The API exposes a single list containing owned *and* shared projects with no
 * server-side filter, so the split is derived here. It is therefore scoped to
 * the loaded page: the counts are page-local unless the whole set fits in one
 * page, which the hook's return value makes explicit.
 */
export function useProjectBuckets(projects: ProjectResponse[], currentUserId: string | null | undefined) {
  return useMemo(() => {
    const owned = projects.filter((project) =>
      currentUserId ? project.owner_id === currentUserId : true,
    );
    const shared = projects.filter(
      (project) => (currentUserId ? project.owner_id !== currentUserId : false),
    );
    return { owned, shared, all: projects };
  }, [projects, currentUserId]);
}
