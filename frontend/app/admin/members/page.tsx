"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  Search,
  UserPlus,
  MoreVertical,
  Mail,
  Ban,
  Check,
  X,
  Shield,
  Clock,
  HardDrive,
  Terminal,
  Activity,
} from "lucide-react";

interface Member {
  id: string;
  name: string;
  email: string;
  status: "active" | "invited" | "disabled";
  projects: number;
  storage: string;
  lastActive: string;
}

export default function AdminMembersPage() {
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [emailList, setEmailList] = useState("");
  const [activeTab, setActiveTab] = useState<"members" | "activity">("members");

  const members: Member[] = [
    {
      id: "1",
      name: "Elena Rostova",
      email: "elena.r@university.edu",
      status: "active",
      projects: 12,
      storage: "184 MB",
      lastActive: "2 minutes ago",
    },
    {
      id: "2",
      name: "Marcus Chen",
      email: "m.chen@university.edu",
      status: "active",
      projects: 8,
      storage: "142 MB",
      lastActive: "1 hour ago",
    },
    {
      id: "3",
      name: "Sarah Lin",
      email: "sarah.lin@university.edu",
      status: "invited",
      projects: 0,
      storage: "0 MB",
      lastActive: "Never",
    },
    {
      id: "4",
      name: "Alex Kumar",
      email: "alex.k@university.edu",
      status: "active",
      projects: 24,
      storage: "312 MB",
      lastActive: "5 minutes ago",
    },
    {
      id: "5",
      name: "Jordan Smith",
      email: "j.smith@university.edu",
      status: "disabled",
      projects: 3,
      storage: "89 MB",
      lastActive: "3 days ago",
    },
  ];

  const activityLogs = [
    {
      timestamp: "2 minutes ago",
      user: "Elena Rostova",
      action: "Compiled project",
      details: "Thesis Draft v8",
    },
    {
      timestamp: "15 minutes ago",
      user: "Marcus Chen",
      action: "Shared project",
      details: "Neural PDE Paper with Sarah Lin",
    },
    {
      timestamp: "1 hour ago",
      user: "Admin",
      action: "Invited new member",
      details: "sarah.lin@university.edu",
    },
    {
      timestamp: "2 hours ago",
      user: "Alex Kumar",
      action: "Deleted project",
      details: "Draft LaTeX Template",
    },
    {
      timestamp: "3 hours ago",
      user: "Admin",
      action: "Disabled account",
      details: "jordan.smith@university.edu",
    },
  ];

  const handleBulkInvite = () => {
    const emails = emailList.split("\n").filter((e) => e.trim());
    console.log("Inviting:", emails);
    setShowInviteModal(false);
    setEmailList("");
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex flex-col">
      {/* Fixed Header */}
      <header className="fixed top-0 left-0 right-0 h-14 z-50 bg-white border-b border-neutral-200 flex items-center justify-between px-4 select-none">
        <div className="flex items-center gap-3 w-60">
          <Image
            src="/logo.png"
            alt="Likhitex"
            width={100}
            height={32}
            className="h-8 w-auto"
          />
          <span className="text-sm font-semibold text-neutral-900">
            Likhitex
          </span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-50 rounded-full">
            <span className="w-2 h-2 rounded-full bg-green-600 animate-pulse" />
            <span className="text-xs font-mono text-green-700 font-medium">
              Cluster Sync Active
            </span>
          </div>
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-indigo-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Return to LaTeX Editor
          </Link>
        </div>
      </header>

      {/* Admin Sub-navigation */}
      <div className="fixed top-14 left-0 right-0 h-12 z-40 bg-neutral-50 border-b border-neutral-200 px-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-neutral-600">
          <span className="flex items-center text-indigo-600 font-medium">
            <Shield className="w-4 h-4 mr-1" />
            Admin Console
          </span>
          <span className="text-neutral-400">/</span>
          <span className="font-mono">CAMPUS-CLUSTER-09</span>
          <span className="text-neutral-400">/</span>
          <span className="text-neutral-900 font-semibold">
            Members & Whitelist
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab("members")}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
              activeTab === "members"
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            Members
          </button>
          <button
            onClick={() => setActiveTab("activity")}
            className={`h-8 px-3 rounded-lg text-xs font-medium transition-colors ${
              activeTab === "activity"
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            Activity Log
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="pt-26 px-6 py-6 mt-26">
        {activeTab === "members" ? (
          <>
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-semibold text-neutral-900">
                    Members & Workspace Access
                  </h1>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 bg-neutral-100 rounded-full border border-neutral-200">
                    <span className="w-2 h-2 rounded-full bg-green-600" />
                    <span className="text-xs font-mono text-neutral-900 font-medium">
                      87 of 200 seats used
                    </span>
                  </div>
                </div>
                <p className="text-sm text-neutral-600">
                  Control domain whitelisting, review member compute
                  allocations, and enforce strict institutional access policies.
                </p>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-2 w-4 h-4 text-neutral-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Filter by name, email, dept..."
                    className="w-full h-8 pl-8 pr-3 bg-white border border-neutral-200 rounded-lg text-sm focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 transition-colors"
                  />
                </div>
                <button
                  onClick={() => setShowInviteModal(true)}
                  className="h-8 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap"
                >
                  <UserPlus className="w-4 h-4" />+ Invite by Email
                </button>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 bg-white p-4 rounded-xl border border-neutral-200">
              <div className="flex flex-col gap-1 p-3 border-r border-neutral-200 last:border-r-0">
                <div className="flex items-center justify-between text-neutral-500">
                  <span className="text-[10px] font-semibold uppercase tracking-wider">
                    Seats Quota
                  </span>
                  <Shield className="w-4 h-4" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold text-neutral-900">
                    87 / 200
                  </span>
                  <span className="text-xs font-mono text-green-700 font-medium">
                    43.5%
                  </span>
                </div>
                <div className="w-full h-1.5 bg-neutral-100 rounded-full overflow-hidden mt-1">
                  <div
                    className="h-full bg-indigo-600 rounded-full"
                    style={{ width: "43.5%" }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1 p-3 border-r border-neutral-200 last:border-r-0">
                <div className="flex items-center justify-between text-neutral-500">
                  <span className="text-[10px] font-semibold uppercase tracking-wider">
                    Total Storage
                  </span>
                  <HardDrive className="w-4 h-4" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold text-neutral-900">
                    1,842 MB
                  </span>
                  <span className="text-xs text-neutral-500">of 10 GB</span>
                </div>
                <div className="w-full h-1.5 bg-neutral-100 rounded-full overflow-hidden mt-1">
                  <div
                    className="h-full bg-green-600 rounded-full"
                    style={{ width: "18.4%" }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1 p-3 border-r border-neutral-200 last:border-r-0">
                <div className="flex items-center justify-between text-neutral-500">
                  <span className="text-[10px] font-semibold uppercase tracking-wider">
                    Active Compiles
                  </span>
                  <Terminal className="w-4 h-4" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold text-neutral-900">
                    423
                  </span>
                  <span className="text-xs text-neutral-500">today</span>
                </div>
              </div>

              <div className="flex flex-col gap-1 p-3">
                <div className="flex items-center justify-between text-neutral-500">
                  <span className="text-[10px] font-semibold uppercase tracking-wider">
                    Active Now
                  </span>
                  <Activity className="w-4 h-4" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-xl font-semibold text-neutral-900">
                    23
                  </span>
                  <span className="text-xs text-neutral-500">users online</span>
                </div>
              </div>
            </div>

            {/* Members Table */}
            <div className="bg-white rounded-xl border border-neutral-200 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-neutral-50 text-neutral-600 text-xs font-medium border-b border-neutral-200">
                    <th className="py-3 px-4 font-medium">Member</th>
                    <th className="py-3 px-4 font-medium">Email</th>
                    <th className="py-3 px-4 font-medium">Status</th>
                    <th className="py-3 px-4 font-medium text-right">
                      Projects
                    </th>
                    <th className="py-3 px-4 font-medium text-right">
                      Storage
                    </th>
                    <th className="py-3 px-4 font-medium">Last Active</th>
                    <th className="py-3 px-4 font-medium text-right">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-200 text-sm">
                  {members.map((member) => (
                    <tr
                      key={member.id}
                      className="hover:bg-neutral-50 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold">
                            {member.name
                              .split(" ")
                              .map((n) => n[0])
                              .join("")}
                          </div>
                          <span className="font-medium text-neutral-900">
                            {member.name}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-mono text-xs text-neutral-600">
                          {member.email}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {member.status === "active" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                            <Check className="w-3 h-3" />
                            Active
                          </span>
                        )}
                        {member.status === "invited" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                            <Clock className="w-3 h-3" />
                            Invited
                          </span>
                        )}
                        {member.status === "disabled" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-medium">
                            <Ban className="w-3 h-3" />
                            Disabled
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-neutral-900">
                        {member.projects}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-neutral-900">
                        {member.storage}
                      </td>
                      <td className="py-3 px-4 text-xs text-neutral-500">
                        {member.lastActive}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button className="h-7 w-7 rounded-lg hover:bg-neutral-100 flex items-center justify-center text-neutral-600">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            {/* Activity Log */}
            <div className="flex flex-col gap-0.5 mb-6">
              <h2 className="text-2xl font-semibold text-neutral-900">
                Activity Log
              </h2>
              <p className="text-sm text-neutral-600">
                Recent member actions, logins, shares, and system events.
              </p>
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 divide-y divide-neutral-200">
              {activityLogs.map((log, index) => (
                <div
                  key={index}
                  className="p-4 hover:bg-neutral-50 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center">
                        <Activity className="w-4 h-4 text-neutral-600" />
                      </div>
                      <div>
                        <div className="text-sm text-neutral-900">
                          <span className="font-medium">{log.user}</span>{" "}
                          {log.action.toLowerCase()}
                        </div>
                        <div className="text-xs text-neutral-500 mt-0.5">
                          {log.details}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-neutral-500 font-mono">
                      {log.timestamp}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      {/* Bulk Invite Modal */}
      {showInviteModal && (
        <>
          <div
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50"
            onClick={() => setShowInviteModal(false)}
          />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg">
            <div className="bg-white border border-neutral-200 rounded-lg shadow-xl overflow-hidden">
              <div className="p-5">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="text-lg font-semibold text-neutral-900 mb-1">
                      Invite members by email
                    </h2>
                    <p className="text-xs text-neutral-600">
                      Enter one email address per line. Valid institutional
                      domains only.
                    </p>
                  </div>
                  <button
                    onClick={() => setShowInviteModal(false)}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-neutral-500 hover:bg-neutral-100 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <textarea
                  value={emailList}
                  onChange={(e) => setEmailList(e.target.value)}
                  placeholder="alice@university.edu&#10;bob@university.edu&#10;charlie@university.edu"
                  className="w-full h-40 px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-lg text-sm font-mono focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 resize-none"
                />

                <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <Mail className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-900">
                      <span className="font-medium">Note:</span> Only
                      pre-approved institutional domains (@university.edu) can be
                      invited. Invalid emails will be skipped.
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-5 py-3 bg-neutral-50 border-t border-neutral-200 flex items-center justify-end gap-2">
                <button
                  onClick={() => setShowInviteModal(false)}
                  className="h-8 px-3 rounded-lg hover:bg-neutral-100 text-sm text-neutral-900 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleBulkInvite}
                  className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium shadow-sm transition-colors flex items-center gap-1.5"
                >
                  <UserPlus className="w-4 h-4" />
                  Send Invites
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
