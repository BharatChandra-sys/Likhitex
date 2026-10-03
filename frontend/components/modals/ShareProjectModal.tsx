"use client";

import { useCallback, useEffect, useState } from "react";
import { X, UserPlus, ChevronDown, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, ApiError } from "@/lib/api/client";
import type { ProjectMemberResponse, Role } from "@/lib/api/types";
import { displayName, initialsOf } from "@/lib/format";

interface ShareProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string | null;
  projectTitle: string;
}

type LoadState = "loading" | "ready" | "error";

/** Roles a non-owner member can hold. `owner` is not assignable from this dialog. */
const ASSIGNABLE_ROLES: Role[] = ["editor", "viewer"];

export function ShareProjectModal({
  isOpen,
  onClose,
  projectId,
  projectTitle,
}: ShareProjectModalProps) {
  const [members, setMembers] = useState<ProjectMemberResponse[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [error, setError] = useState<string | null>(null);
  /** Which project the current `members` belong to; guards against showing the wrong list. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("editor");
  const [isAdding, setIsAdding] = useState(false);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());

  /**
   * Fetches without touching state, so both the mount effect and the
   * post-mutation refresh can share it. State is committed by the caller's
   * promise handlers, which keeps the commits on the microtask queue instead of
   * inside the effect body.
   */
  const fetchMembers = useCallback(async (): Promise<ProjectMemberResponse[]> => {
    if (!projectId) return [];
    return api.listMembers(projectId);
  }, [projectId]);

  // Refetch on every open so the list is never stale. Nothing is reset on close:
  // the component renders nothing while closed, and a successful fetch replaces
  // the list wholesale.
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    fetchMembers()
      .then((result) => {
        if (cancelled) return;
        setMembers(result);
        setLoadedFor(projectId);
        setError(null);
        setState("ready");
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof ApiError ? cause.message : "Could not load collaborators");
        setState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, projectId, fetchMembers]);

  /** Re-read the list after a mutation, committing state on the microtask queue. */
  const load = useCallback(async () => {
    try {
      const result = await fetchMembers();
      setMembers(result);
      setLoadedFor(projectId);
      setError(null);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not load collaborators");
      setState("error");
    }
  }, [fetchMembers, projectId]);

  /** A result from a different project must never be shown for this one. */
  const isStale = loadedFor !== projectId;

  const markPending = useCallback((id: string, pending: boolean) => {
    setPendingIds((current) => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const handleAdd = useCallback(async () => {
    if (!projectId) return;
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;

    setIsAdding(true);
    setError(null);
    try {
      await api.addMember(projectId, { email: trimmed, role });
      setEmail("");
      await load();
    } catch (cause) {
      if (cause instanceof ApiError && cause.isConflict) {
        setError("That person already has access to this project.");
      } else if (cause instanceof ApiError && cause.isNotFound) {
        setError("No Likhitex member with that email address. Ask them to join first.");
      } else {
        setError(cause instanceof ApiError ? cause.message : "Could not add that person.");
      }
    } finally {
      setIsAdding(false);
    }
  }, [projectId, email, role, load]);

  const handleRoleChange = useCallback(
    async (member: ProjectMemberResponse, nextRole: Role) => {
      if (!projectId || nextRole === member.role) return;
      markPending(member.id, true);
      setError(null);
      try {
        await api.updateMember(projectId, member.id, { role: nextRole });
        await load();
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Could not change that role.");
      } finally {
        markPending(member.id, false);
      }
    },
    [projectId, load, markPending],
  );

  const handleRemove = useCallback(
    async (member: ProjectMemberResponse) => {
      if (!projectId) return;
      markPending(member.id, true);
      setError(null);
      try {
        await api.removeMember(projectId, member.id);
        await load();
      } catch (cause) {
        setError(cause instanceof ApiError ? cause.message : "Could not remove that person.");
      } finally {
        markPending(member.id, false);
      }
    },
    [projectId, load, markPending],
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-[#0f172a]/45 backdrop-blur-[2px]" onClick={onClose} />

      <div className="relative z-50 w-[560px] max-w-full bg-surface-container-lowest rounded-lg border border-surface-container-high shadow-2xl flex flex-col text-on-surface overflow-hidden m-4">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-surface-container-high">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-primary-fixed flex items-center justify-center text-primary shrink-0">
                <UserPlus className="w-[17px] h-[17px]" />
              </div>
              <h2 className="text-[17px] font-semibold text-on-surface leading-tight truncate">
                Share &quot;{projectTitle}&quot;
              </h2>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low transition-colors shrink-0"
              title="Close dialog"
            >
              <X className="w-[18px] h-[18px]" />
            </button>
          </div>
          <p className="text-xs text-on-surface-variant mt-1.5 ml-9">
            Manage collaborators and access permissions for this LaTeX workspace.
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {/* Add People */}
          <div className="px-6 py-4 border-b border-surface-container-high">
            <label htmlFor="share-email" className="block text-xs font-medium text-on-surface mb-2">
              Add people
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  id="share-email"
                  type="email"
                  placeholder="Enter email address"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handleAdd();
                  }}
                  disabled={isAdding}
                  className="pr-24"
                />
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as Exclude<Role, "owner">)}
                  disabled={isAdding}
                  aria-label="Role to grant"
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-6 px-2 pr-6 bg-surface-container-low hover:bg-surface-container text-on-surface text-xs rounded appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary-container transition-colors border-0"
                >
                  {ASSIGNABLE_ROLES.map((option) => (
                    <option key={option} value={option}>
                      {option === "editor" ? "Editor" : "Viewer"}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3 h-3 text-outline pointer-events-none" />
              </div>
              <Button
                variant="primary"
                size="md"
                onClick={() => void handleAdd()}
                disabled={isAdding || !email.trim()}
              >
                {isAdding ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                ) : null}
                Add
              </Button>
            </div>
            <p className="text-[11px] text-on-surface-variant mt-2 flex items-center gap-1">
              <AlertCircle className="w-3 h-3 shrink-0" />
              Only existing Likhitex members can be added
            </p>
          </div>

          {/* People with access */}
          <div className="px-6 py-4">
            <h3 className="text-xs font-semibold text-on-surface mb-3 uppercase tracking-wider text-outline">
              People with access
            </h3>

            {error && (
              <p role="alert" className="mb-3 text-[11px] text-error">
                {error}
              </p>
            )}

            {state === "loading" || isStale ? (
              <div className="flex items-center gap-2 py-4 text-xs text-on-surface-variant">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading collaborators
              </div>
            ) : members.length === 0 ? (
              <p className="py-4 text-xs text-on-surface-variant">
                No collaborators yet. Only you have access.
              </p>
            ) : (
              <div className="space-y-2">
                {members.map((member) => {
                  const name = displayName(member.user?.full_name, member.user?.email);
                  const isOwner = member.role === "owner";
                  const isPending = pendingIds.has(member.id);

                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-surface-container-low transition-colors"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-surface-container flex items-center justify-center text-on-surface text-[10px] font-semibold shrink-0">
                          {initialsOf(member.user?.full_name, member.user?.email)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-on-surface truncate block">
                            {name}
                          </span>
                          <span className="text-xs text-on-surface-variant truncate block font-[family-name:var(--font-mono)]">
                            {member.user?.email}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        {isPending && (
                          <Loader2 className="w-3.5 h-3.5 text-outline animate-spin" aria-label="Saving" />
                        )}
                        {isOwner ? (
                          <span className="text-xs text-on-surface-variant font-medium px-2 py-1">
                            Owner
                          </span>
                        ) : (
                          <>
                            <div className="relative">
                              <select
                                value={member.role}
                                disabled={isPending}
                                aria-label={`Role for ${name}`}
                                onChange={(event) =>
                                  void handleRoleChange(member, event.target.value as Role)
                                }
                                className="h-7 pl-2 pr-6 bg-surface-container-low hover:bg-surface-container text-on-surface text-xs rounded appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary-container transition-colors border-0 disabled:opacity-50"
                              >
                                {ASSIGNABLE_ROLES.map((option) => (
                                  <option key={option} value={option}>
                                    {option === "editor" ? "Editor" : "Viewer"}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-outline pointer-events-none" />
                            </div>
                            <button
                              onClick={() => void handleRemove(member)}
                              disabled={isPending}
                              className="w-7 h-7 rounded flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-error-container/20 transition-colors disabled:opacity-40"
                              title={`Remove ${name}`}
                              aria-label={`Remove ${name}`}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/*
            Public link sharing has no backend representation: Project carries no
            sharing flag and the API exposes no endpoint to set one. It is
            omitted rather than shown as a toggle that would silently do nothing.
          */}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-surface-container-high flex items-center justify-end">
          <Button variant="primary" size="md" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
