"use client";

/**
 * Account settings.
 *
 * Built against the endpoints that exist: `GET /api/users/me`,
 * `PATCH /api/users/me` and `GET /api/users/me/quota`. Nothing here is
 * placeholder data.
 *
 * Two capabilities the original design showed are deliberately absent, because the
 * API has no route for them and a control that cannot work is worse than no
 * control:
 * - Exporting the account as an archive: no endpoint exists.
 * - Deleting the account: no endpoint exists.
 * Both are named explicitly below so the gap is visible rather than looking like
 * an oversight. The per-project figures come from the projects list, which is
 * real data rather than a per-file-type breakdown the API cannot produce.
 */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Cloud,
  HardDrive,
  Loader2,
  LogOut,
  Pencil,
  User,
} from "lucide-react";
import { UserButton } from "@clerk/nextjs";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api/client";
import type { ProjectResponse, QuotaResponse, UserResponse } from "@/lib/api/types";
import { formatAbsoluteTime, formatBytes, formatQuotaPair, initialsOf } from "@/lib/format";

type Section = "profile" | "storage";

const SECTIONS: { id: Section; label: string; icon: typeof User }[] = [
  { id: "profile", label: "Profile", icon: User },
  { id: "storage", label: "Storage", icon: Cloud },
];

export default function SettingsPage() {
  const [section, setSection] = useState<Section>("profile");

  const [user, setUser] = useState<UserResponse | null>(null);
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [projects, setProjects] = useState<ProjectResponse[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draftName, setDraftName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  /**
   * Fetches everything the page shows, without touching state.
   *
   * Kept pure so the effect can await it inside its own async body. A callback that
   * both fetched and set state would be indistinguishable from a synchronous
   * `setState` call to the compiler's lint rules.
   */
  const fetchProfileData = useCallback(async (signal?: AbortSignal) => {
    const [profile, userQuota, projectList] = await Promise.all([
      api.me({ signal }),
      api.myQuota({ signal }),
      // The list endpoint is paginated; the first page is enough to show the
      // largest projects, and there is no server-side sort to lean on.
      api.listProjects({ pageSize: 50 }, { signal }),
    ]);

    return { profile, userQuota, projects: projectList.projects };
  }, []);

  const applyProfileData = useCallback(
    (data: Awaited<ReturnType<typeof fetchProfileData>>) => {
      setUser(data.profile);
      setQuota(data.userQuota);
      setProjects(data.projects);
      setDraftName(data.profile.full_name ?? "");
    },
    [],
  );

  const reportLoadFailure = useCallback((cause: unknown) => {
    setLoadError(cause instanceof ApiError ? cause.message : "Could not load your account");
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      try {
        const data = await fetchProfileData(controller.signal);
        if (controller.signal.aborted) return;
        applyProfileData(data);
      } catch (cause) {
        if (controller.signal.aborted) return;
        reportLoadFailure(cause);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();

    return () => controller.abort();
  }, [applyProfileData, fetchProfileData, reportLoadFailure]);

  /** Re-runs the load from a user gesture, where a loading reset is expected. */
  const retry = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);

    void (async () => {
      try {
        applyProfileData(await fetchProfileData());
      } catch (cause) {
        reportLoadFailure(cause);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [applyProfileData, fetchProfileData, reportLoadFailure]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    setIsSaved(false);

    try {
      const trimmed = draftName.trim();
      // An empty box clears the name, which the API models as an explicit null.
      const updated = await api.updateProfile({ full_name: trimmed === "" ? null : trimmed });
      setUser(updated);
      setDraftName(updated.full_name ?? "");
      setIsSaved(true);
    } catch (cause) {
      setSaveError(
        cause instanceof ApiError ? cause.message : "Could not save your profile",
      );
    } finally {
      setIsSaving(false);
    }
  }, [draftName]);

  const isNameChanged = (draftName.trim() || null) !== (user?.full_name ?? null);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-primary animate-spin" aria-label="Loading settings" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="h-14 bg-surface-container-lowest border-b border-surface-container-high sticky top-0 z-50">
        <div className="max-w-[1440px] mx-auto px-6 h-full flex items-center justify-between">
          <Image src="/logo.png" alt="Likhitex" width={140} height={40} priority className="h-7 w-auto" />

          <div className="flex items-center gap-3">
            <Link href="/projects">
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4" />
                Back to Projects
              </Button>
            </Link>
            <UserButton />
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-6 py-8 flex gap-8">
        {/* Section nav */}
        <nav className="w-56 shrink-0" aria-label="Settings sections">
          <ul className="space-y-1">
            {SECTIONS.map((item) => {
              const Icon = item.icon;
              const isActive = section === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSection(item.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                      isActive
                        ? "bg-primary-fixed text-primary"
                        : "text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-6 pt-4 border-t border-surface-container-high">
            <button
              type="button"
              onClick={() => document.getElementById("unavailable")?.scrollIntoView({ behavior: "smooth" })}
              className="w-full text-left px-3 py-2 rounded-lg text-sm font-medium text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              Account &amp; data
            </button>
          </div>
        </nav>

        <div className="flex-1 min-w-0 max-w-3xl">
          {loadError && (
            <div
              role="alert"
              className="mb-6 flex items-start gap-2 rounded-lg bg-error-container/50 border border-error/30 px-4 py-3 text-sm text-on-error-container"
            >
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Could not load your account</p>
                <p className="mt-0.5">{loadError}</p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-2 text-sm font-semibold underline underline-offset-2"
                >
                  Try again
                </button>
              </div>
            </div>
          )}

          {section === "profile" && user && (
            <section aria-labelledby="profile-heading">
              <h1 id="profile-heading" className="text-xl font-semibold text-on-surface">
                Profile
              </h1>
              <p className="text-sm text-on-surface-variant mt-1">
                How you appear to collaborators on shared projects.
              </p>

              <div className="mt-6 bg-surface-container-lowest border border-surface-container-high rounded-xl p-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full bg-primary-fixed text-primary flex items-center justify-center text-lg font-semibold shrink-0">
                    {initialsOf(user.full_name ?? user.email, user.email)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-on-surface truncate">
                      {user.full_name || "No name set"}
                    </p>
                    <p className="text-xs text-on-surface-variant truncate">{user.email}</p>
                  </div>
                </div>

                <form
                  className="mt-6 pt-6 border-t border-surface-container-high"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleSave();
                  }}
                >
                  <label htmlFor="full-name" className="block text-sm font-medium text-on-surface">
                    Display name
                  </label>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    Shown next to your edits. Leave empty to clear it.
                  </p>

                  <div className="mt-3 flex items-center gap-2">
                    <Input
                      id="full-name"
                      value={draftName}
                      maxLength={100}
                      placeholder="Ada Lovelace"
                      onChange={(event) => {
                        setDraftName(event.target.value);
                        setIsSaved(false);
                      }}
                      className="max-w-xs"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={isSaving || !isNameChanged}
                    >
                      {isSaving ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : isSaved && !isNameChanged ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Pencil className="w-4 h-4" />
                      )}
                      {isSaved && !isNameChanged ? "Saved" : "Save"}
                    </Button>
                  </div>

                  {saveError && (
                    <p role="alert" className="mt-2 text-sm text-error">
                      {saveError}
                    </p>
                  )}
                </form>

                <dl className="mt-6 pt-6 border-t border-surface-container-high grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <dt className="text-xs text-on-surface-variant">Email</dt>
                    <dd className="mt-0.5 text-on-surface">{user.email}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-on-surface-variant">User ID</dt>
                    <dd className="mt-0.5 text-on-surface font-mono text-xs break-all">{user.id}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-on-surface-variant">Member since</dt>
                    <dd className="mt-0.5 text-on-surface">{formatAbsoluteTime(user.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-on-surface-variant">Last sign-in</dt>
                    <dd className="mt-0.5 text-on-surface">{formatAbsoluteTime(user.last_login_at)}</dd>
                  </div>
                </dl>
              </div>
            </section>
          )}

          {section === "storage" && (
            <section aria-labelledby="storage-heading">
              <h1 id="storage-heading" className="text-xl font-semibold text-on-surface">
                Storage
              </h1>
              <p className="text-sm text-on-surface-variant mt-1">
                Your quota covers every file across all your projects.
              </p>

              {quota && (
                <div className="mt-6 bg-surface-container-lowest border border-surface-container-high rounded-xl p-6">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-on-surface flex items-center gap-2">
                      <HardDrive className="w-4 h-4 text-outline" />
                      Used
                    </span>
                    <span className="text-on-surface-variant">
                      {formatQuotaPair(quota.used_bytes, quota.quota_bytes)}
                    </span>
                  </div>

                  <div
                    role="progressbar"
                    aria-valuenow={Math.round(quota.percentage_used)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Storage used"
                    className="mt-3 h-2 rounded-full bg-surface-container-high overflow-hidden"
                  >
                    <div
                      className="h-full bg-primary rounded-full"
                      // Clamped so a quota over-report can never overflow the bar.
                      style={{ width: `${Math.min(100, Math.max(0, quota.percentage_used))}%` }}
                    />
                  </div>

                  <p className="mt-2 text-xs text-on-surface-variant">
                    {formatBytes(quota.remaining_bytes)} remaining of{" "}
                    {formatBytes(quota.quota_bytes)}
                  </p>
                </div>
              )}

              <h2 className="mt-8 text-sm font-semibold text-on-surface">Projects by size</h2>
              {projects.length === 0 ? (
                <p className="mt-2 text-sm text-on-surface-variant">
                  You have no projects yet.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-surface-container-high bg-surface-container-lowest border border-surface-container-high rounded-xl overflow-hidden">
                  {[...projects]
                    .sort((a, b) => b.size_bytes - a.size_bytes)
                    .map((project) => (
                      <li key={project.id}>
                        <Link
                          href={`/editor/${project.id}`}
                          className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-surface-container-low transition-colors"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm text-on-surface truncate">
                              {project.name}
                            </span>
                            <span className="block text-xs text-on-surface-variant">
                              Updated {formatAbsoluteTime(project.updated_at)}
                            </span>
                          </span>
                          <span className="text-sm text-on-surface-variant shrink-0 tabular-nums">
                            {formatBytes(project.size_bytes)}
                          </span>
                        </Link>
                      </li>
                    ))}
                </ul>
              )}
            </section>
          )}

          {/* Named gaps, so the absence reads as a decision rather than a bug. */}
          <section
            id="unavailable"
            aria-labelledby="unavailable-heading"
            className="mt-10 pt-6 border-t border-surface-container-high"
          >
            <h2 id="unavailable-heading" className="text-sm font-semibold text-on-surface">
              Not available yet
            </h2>
            <p className="text-xs text-on-surface-variant mt-1 max-w-prose leading-relaxed">
              These controls are omitted on purpose: the API has no endpoint for them, so
              offering them would only produce an error.
            </p>
            <ul className="mt-3 space-y-2 text-sm text-on-surface-variant">
              <li className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-outline" />
                <span>
                  <span className="text-on-surface font-medium">Export account.</span> There is no
                  archive endpoint, so nothing can be downloaded.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-outline" />
                <span>
                  <span className="text-on-surface font-medium">Delete account.</span> No deletion
                  endpoint exists. Removing an account has to be done server-side.
                </span>
              </li>
              <li className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-outline" />
                <span>
                  <span className="text-on-surface font-medium">Per-category breakdown.</span> The
                  API reports one total per project, so a source/image/PDF split cannot be
                  computed accurately.
                </span>
              </li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  );
}
