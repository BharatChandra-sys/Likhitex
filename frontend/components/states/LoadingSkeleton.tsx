"use client";

import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-surface-container",
        className
      )}
      style={style}
    />
  );
}

export function EditorLoadingSkeleton() {
  return (
    <div className="flex h-full">
      {/* File Tree Skeleton */}
      <div className="w-60 border-r border-surface-container-high p-4 space-y-2">
        <Skeleton className="h-8 w-full mb-4" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-6 w-5/6 ml-4" />
        <Skeleton className="h-6 w-4/5 ml-4" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-6 w-5/6 ml-4" />
        <Skeleton className="h-6 w-2/3 ml-4" />
      </div>

      {/* Editor Skeleton */}
      <div className="flex-1 p-4 space-y-2">
        <Skeleton className="h-10 w-full mb-4" />
        {Array.from({ length: 20 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-4"
            // Deterministic widths: Math.random() here differs between the
            // server render and hydration.
            style={{ width: `${60 + ((i * 37) % 40)}%` }}
          />
        ))}
      </div>

      {/* PDF Preview Skeleton */}
      <div className="w-96 border-l border-surface-container-high p-4">
        <Skeleton className="h-10 w-full mb-4" />
        <Skeleton className="w-full aspect-[8.5/11] rounded-lg" />
      </div>
    </div>
  );
}

export function ProjectListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 rounded-lg border border-surface-container-high">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-8 rounded" />
        </div>
      ))}
    </div>
  );
}
