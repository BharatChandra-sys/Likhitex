"use client";

import { Plus, Upload } from "lucide-react";

interface EmptyStateProps {
  onNewProject: () => void;
  onUploadZip: () => void;
}

export function EmptyState({ onNewProject, onUploadZip }: EmptyStateProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8 py-16 bg-[radial-gradient(circle,_#E5E7EB_1px,_transparent_1px)] bg-[length:24px_24px]">
      {/* Quill & Blank Paper Illustration */}
      <div className="relative mb-6">
        <div className="w-24 h-32 bg-white rounded-md border border-gray-300 shadow-sm relative overflow-hidden flex flex-col justify-between p-3 rotate-[-3deg] transition-transform hover:rotate-0 duration-300">
          {/* LaTeX Document Header Preview */}
          <div className="space-y-1.5 opacity-40">
            <div className="h-2 w-12 bg-gray-800 rounded-sm"></div>
            <div className="h-1 w-full bg-gray-300 rounded-sm"></div>
            <div className="h-1 w-4/5 bg-gray-300 rounded-sm"></div>
            <div className="h-1 w-3/4 bg-gray-300 rounded-sm"></div>
          </div>
          <div className="space-y-1 opacity-25">
            <div className="h-1 w-full bg-gray-300 rounded-sm"></div>
            <div className="h-1 w-5/6 bg-gray-300 rounded-sm"></div>
          </div>
          <div className="text-[9px] font-mono text-gray-400 text-right">.tex</div>
        </div>

        {/* Stylized Quill & Bracket Badge */}
        <div className="absolute -bottom-3 -right-3 w-12 h-12 rounded-full bg-indigo-50 border-2 border-white shadow-md flex items-center justify-center text-indigo-600">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19l7-7 3 3-7 7-3-3z"/>
            <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/>
            <path d="M2 2l7.586 7.586"/>
            <circle cx="11" cy="11" r="2"/>
          </svg>
        </div>
      </div>

      {/* Typography */}
      <h3 className="text-base font-semibold text-gray-900 mb-1">Create your first project</h3>
      <p className="text-xs text-gray-500 max-w-sm mb-6 leading-relaxed">
        Collaborate on academic papers, theses, or problem sets in real-time with verified institutional peers.
      </p>

      {/* Action Buttons (32px compact controls) */}
      <div className="flex items-center gap-3">
        <button
          onClick={onNewProject}
          className="h-8 px-3.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-md shadow-sm flex items-center gap-1.5 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Project</span>
        </button>
        <button
          onClick={onUploadZip}
          className="h-8 px-3.5 bg-white hover:bg-gray-50 text-gray-700 text-xs font-medium border border-gray-300 rounded-md shadow-sm flex items-center gap-1.5 transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />
          <span>Upload zip</span>
        </button>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-200/60 w-full max-w-xs flex items-center justify-center gap-2 text-[11px] text-gray-400 font-mono">
        <span>TeX Live 2024</span>
        <span>•</span>
        <span>Git backed</span>
        <span>•</span>
        <span>Instant sync</span>
      </div>
    </div>
  );
}
