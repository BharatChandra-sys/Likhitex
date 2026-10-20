"use client";

import { FolderPlus, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: "folder" | "file";
  primaryAction?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({
  title,
  description,
  icon = "folder",
  primaryAction,
  secondaryAction,
}: EmptyStateProps) {
  const Icon = icon === "folder" ? FolderPlus : FileText;

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] px-4">
      <div className="w-24 h-24 rounded-2xl bg-surface-container flex items-center justify-center mb-6">
        <Icon className="w-12 h-12 text-outline" />
      </div>
      
      <h2 className="text-xl font-semibold text-on-surface mb-2 text-center">
        {title}
      </h2>
      
      <p className="text-sm text-on-surface-variant mb-8 text-center max-w-md">
        {description}
      </p>

      <div className="flex items-center gap-3">
        {primaryAction && (
          <Button
            variant="primary"
            size="lg"
            onClick={primaryAction.onClick}
          >
            {primaryAction.label}
          </Button>
        )}
        
        {secondaryAction && (
          <Button
            variant="outline"
            size="lg"
            onClick={secondaryAction.onClick}
          >
            {secondaryAction.label}
          </Button>
        )}
      </div>
    </div>
  );
}
