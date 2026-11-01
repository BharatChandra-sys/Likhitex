import { Check, FileText, Folder } from "lucide-react";

import styles from "./landing.module.css";

/**
 * A miniature of the editor: LaTeX source on the left, the compiled page on the
 * right. Built in markup rather than a screenshot so the text stays sharp at any
 * width and costs no image bytes. It is decorative, so assistive technology gets
 * one description instead of the fragments.
 */

const TREE = [
  { name: "sections", dir: true },
  { name: "introduction.tex", depth: 1 },
  { name: "method.tex", depth: 1, active: true },
  { name: "figures", dir: true },
  { name: "references.bib" },
];

const CMD = "text-primary";
const ARG = "text-on-surface-variant";
const MATH = "text-[#0F766E]";

const SOURCE = [
  [<span key="a" className={CMD}>\section</span>, <span key="b" className={ARG}>{"{Method}"}</span>],
  [<span key="a" className={CMD}>\label</span>, <span key="b" className={ARG}>{"{sec:method}"}</span>],
  [],
  ["We fine-tune the encoder of"],
  [<span key="a" className={CMD}>\cite</span>, <span key="b" className={ARG}>{"{vaswani2017}"}</span>, " and minimise"],
  [<span key="a" className={CMD}>\begin</span>, <span key="b" className={ARG}>{"{equation}"}</span>],
  [<span key="a" className={MATH}>{"  \\mathcal{L} = -\\sum_i y_i \\log \\hat{y}_i"}</span>],
  [<span key="a" className={CMD}>\end</span>, <span key="b" className={ARG}>{"{equation}"}</span>],
  [<span key="a" className={CMD}>\includegraphics</span>, <span key="b" className={ARG}>{"{figures/arch}"}</span>],
];

export default function EditorPreview() {
  return (
    <div
      role="img"
      aria-label="The Likhitex editor: LaTeX source for a Method section on the left, and the compiled PDF page with its equation and figure on the right."
      className={styles.fadeBottom}
    >
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-xl border border-surface-container-high bg-surface-container-lowest shadow-[0_1px_2px_rgba(25,28,30,0.04),0_24px_48px_-24px_rgba(25,28,30,0.18)]"
      >
        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-surface-container-high bg-surface-container-low px-3 py-2 text-[11px]">
          <span className="flex gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-surface-container-highest" />
            <span className="h-2.5 w-2.5 rounded-full bg-surface-container-highest" />
            <span className="h-2.5 w-2.5 rounded-full bg-surface-container-highest" />
          </span>
          <span className="truncate font-mono text-on-surface-variant">
            thesis / sections / <span className="text-on-surface">method.tex</span>
          </span>
          <span className="ml-auto hidden rounded border border-surface-container-high bg-surface-container-lowest px-1.5 py-0.5 text-on-surface-variant sm:inline">
            Editor
          </span>
          <span className="flex shrink-0 items-center gap-1 text-secondary">
            <Check className="h-3 w-3" strokeWidth={3} />
            Compiled
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-[180px_1fr_1fr]">
          {/* File tree */}
          <div className="hidden border-r border-surface-container-high p-2 lg:block">
            {TREE.map((entry) => (
              <div
                key={entry.name}
                className={`flex items-center gap-1.5 rounded px-1.5 py-1 font-mono text-[11px] ${
                  entry.active ? "bg-primary-fixed text-primary" : "text-on-surface-variant"
                } ${entry.depth ? "pl-5" : ""}`}
              >
                {entry.dir ? (
                  <Folder className="h-3 w-3 shrink-0" />
                ) : (
                  <FileText className="h-3 w-3 shrink-0" />
                )}
                <span className="truncate">{entry.name}</span>
              </div>
            ))}
          </div>

          {/* Source */}
          <div className="overflow-hidden border-r border-surface-container-high py-3 font-mono text-[10px] leading-[18px] text-on-surface sm:text-[12px] sm:leading-[21px]">
            {SOURCE.map((line, index) => (
              <div key={index} className="flex whitespace-pre pr-3">
                <span className="hidden w-8 shrink-0 select-none pr-3 text-right text-on-surface-variant/60 sm:inline">
                  {index + 1}
                </span>
                <span className="pl-3 sm:pl-0">
                  {line.length ? line : " "}
                  {index === SOURCE.length - 1 && (
                    <span className={`${styles.caret} ml-px inline-block h-[1.1em] w-px translate-y-[0.2em] bg-primary`} />
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Compiled page on the PDF viewer's grey */}
          <div className="bg-surface-container p-2.5 sm:p-5">
            <div
              className="rounded-sm bg-white px-3 py-3 font-serif text-[8.5px] leading-[1.45] text-on-surface shadow-sm sm:px-7 sm:py-6 sm:text-[12.5px]"
            >
              <p className="text-[1.25em] font-semibold">2&ensp;Method</p>
              <p className="mt-[0.8em] text-justify">
                We fine-tune the encoder of [1] and minimise the cross-entropy
                objective over the training set,
              </p>
              <p className="my-[0.9em] flex items-center justify-center italic">
                <span className="flex-1" />
                <span>
                  ℒ = −∑<sub className="not-italic">i</sub> y<sub>i</sub> log ŷ<sub>i</sub>
                </span>
                <span className="flex-1 text-right not-italic">(1)</span>
              </p>
              <svg viewBox="0 0 200 56" className="mx-auto w-[88%]">
                <g fill="none" stroke="#777587" strokeWidth="1">
                  <rect x="4" y="16" width="44" height="24" rx="3" />
                  <rect x="78" y="8" width="44" height="40" rx="3" fill="#E2DFFF" stroke="#4F46E5" />
                  <rect x="152" y="16" width="44" height="24" rx="3" />
                  <path d="M48 28h28M122 28h28" markerEnd="url(#lx-arrow)" />
                </g>
                <defs>
                  <marker id="lx-arrow" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto">
                    <path d="M0 0l6 3-6 3z" fill="#777587" />
                  </marker>
                </defs>
              </svg>
              <p className="mt-[0.6em] text-center text-[0.9em]">Figure 2: Model architecture.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
