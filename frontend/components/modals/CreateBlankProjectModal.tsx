"use client";

import { useState } from "react";
import { X, ArrowRight, Check, FileText } from "lucide-react";

interface CreateBlankProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string;
    mainFile: string;
    compiler: string;
    initTemplate: boolean;
  }) => void;
}

export default function CreateBlankProjectModal({
  isOpen,
  onClose,
  onCreate,
}: CreateBlankProjectModalProps) {
  const [projectName, setProjectName] = useState("Neural-PDE-Survey-2025");
  const [mainFile] = useState("main.tex");
  const [compiler, setCompiler] = useState<"pdflatex" | "xelatex" | "lualatex">(
    "pdflatex"
  );
  const [initTemplate, setInitTemplate] = useState(true);

  if (!isOpen) return null;

  const handleCreate = () => {
    onCreate({
      name: projectName,
      mainFile,
      compiler,
      initTemplate,
    });
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-[420px] bg-white rounded-xl shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 flex items-start justify-between bg-white">
          <div className="flex flex-col gap-0.5">
            <h2 className="text-xl font-semibold text-neutral-900">
              Create blank project
            </h2>
            <p className="text-sm text-neutral-600">
              Initialize an isolated workspace with a root document
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-md flex items-center justify-center text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 transition-colors"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>

        {/* Form Fields */}
        <div className="p-5 flex flex-col gap-4 bg-neutral-50/40">
          {/* Field 1: Project Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-neutral-900 flex items-center justify-between">
              <span>Project Name</span>
              <span className="text-xs font-mono text-neutral-500">
                slug-safe
              </span>
            </label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="h-8 px-3 rounded-lg bg-white text-sm text-neutral-900 shadow-sm border border-neutral-200 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600"
            />
          </div>

          {/* Field 2: Main File Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-neutral-900">
              Main Entry Point
            </label>
            <div className="flex items-center rounded-lg bg-white px-3 h-8 shadow-sm border border-neutral-200">
              <span className="font-mono text-sm text-neutral-900 flex-1">
                {mainFile}
              </span>
              <FileText className="w-4 h-4 text-neutral-400" />
            </div>
            <span className="text-sm text-neutral-600">
              Default compiler entry execution unit
            </span>
          </div>

          {/* Field 3: TeX Engine Selection */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-neutral-900">
                TeX Compiler Engine
              </label>
              <span className="text-xs font-mono text-green-700 bg-neutral-200 px-1.5 py-0.5 rounded">
                Recommended
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1 bg-neutral-200 p-1 rounded-lg">
              <button
                onClick={() => setCompiler("pdflatex")}
                className={`h-7 rounded-md font-mono text-xs font-medium flex items-center justify-center gap-1 transition-all ${
                  compiler === "pdflatex"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "hover:bg-white/50 text-neutral-900"
                }`}
              >
                {compiler === "pdflatex" && (
                  <Check className="w-3.5 h-3.5" />
                )}
                <span>pdfLaTeX</span>
              </button>
              <button
                onClick={() => setCompiler("xelatex")}
                className={`h-7 rounded-md font-mono text-xs flex items-center justify-center transition-colors ${
                  compiler === "xelatex"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "hover:bg-white/50 text-neutral-900"
                }`}
              >
                XeLaTeX
              </button>
              <button
                onClick={() => setCompiler("lualatex")}
                className={`h-7 rounded-md font-mono text-xs flex items-center justify-center transition-colors ${
                  compiler === "lualatex"
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "hover:bg-white/50 text-neutral-900"
                }`}
              >
                LuaLaTeX
              </button>
            </div>
          </div>

          {/* Field 4: Template Option Checkbox */}
          <div className="flex items-start gap-2 pt-1">
            <input
              type="checkbox"
              id="preamble-init"
              checked={initTemplate}
              onChange={(e) => setInitTemplate(e.target.checked)}
              className="mt-0.5 accent-indigo-600 h-4 w-4 rounded cursor-pointer"
            />
            <label
              htmlFor="preamble-init"
              className="text-sm text-neutral-900 cursor-pointer"
            >
              Initialize document with standard template (
              <code className="text-xs font-mono text-indigo-600 bg-neutral-200 px-1 rounded">
                \documentclass&#123;article&#125;
              </code>
              )
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-white flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="h-8 px-3 rounded-lg hover:bg-neutral-100 text-sm text-neutral-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium shadow-sm transition-colors flex items-center gap-1.5"
          >
            <span>Create Project</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </>
  );
}
