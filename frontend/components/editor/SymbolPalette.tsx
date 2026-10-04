"use client";

/**
 * LaTeX symbol palette.
 *
 * Replaces a decorative "Σ" button that did nothing. Inserting the right command
 * is the whole point of such a palette, so each entry carries the literal LaTeX
 * and the label is the rendered glyph the user recognises.
 */

import { useState } from "react";

export interface SymbolEntry {
  /** The rendered character, for recognition. */
  glyph: string;
  /** The LaTeX inserted at the caret. */
  latex: string;
  label: string;
}

export const SYMBOL_GROUPS: { title: string; symbols: SymbolEntry[] }[] = [
  {
    title: "Sections",
    symbols: [
      { glyph: "§", latex: "\\section{Title}\n", label: "Section" },
      { glyph: "§§", latex: "\\subsection{Title}\n", label: "Subsection" },
      { glyph: "¶", latex: "\\paragraph{Title}\n", label: "Paragraph" },
      { glyph: "❝", latex: "\\begin{quote}\n\n\\end{quote}\n", label: "Quote" },
    ],
  },
  {
    title: "Math",
    symbols: [
      { glyph: "eq", latex: "\\begin{equation}\n\n\\end{equation}\n", label: "Equation" },
      { glyph: "∑", latex: "\\sum_{i=1}^{n} ", label: "Summation" },
      { glyph: "∫", latex: "\\int_{a}^{b} ", label: "Integral" },
      { glyph: "√", latex: "\\sqrt{} ", label: "Square root" },
      { glyph: "α", latex: "\\alpha ", label: "Alpha" },
      { glyph: "β", latex: "\\beta ", label: "Beta" },
      { glyph: "λ", latex: "\\lambda ", label: "Lambda" },
      { glyph: "μ", latex: "\\mu ", label: "Mu" },
      { glyph: "≤", latex: "\\leq ", label: "Less than or equal" },
      { glyph: "≠", latex: "\\neq ", label: "Not equal" },
      { glyph: "→", latex: "\\to ", label: "Right arrow" },
    ],
  },
  {
    title: "Text",
    symbols: [
      { glyph: "B", latex: "\\textbf{text}", label: "Bold" },
      { glyph: "I", latex: "\\textit{text}", label: "Italic" },
      { glyph: "U", latex: "\\underline{text}", label: "Underline" },
      { glyph: "TT", latex: "\\texttt{text}", label: "Monospace" },
      { glyph: "M", latex: "\\emph{text}", label: "Emphasised" },
    ],
  },
  {
    title: "References",
    symbols: [
      { glyph: "❞", latex: "\\cite{key}", label: "Citation" },
      { glyph: "#", latex: "\\label{eq:label}", label: "Label" },
      { glyph: "↔", latex: "\\ref{eq:label}", label: "Cross-reference" },
      { glyph: "⧉", latex: "\\footnote{Note}", label: "Footnote" },
      { glyph: "❝❞", latex: "\\begin{tabular}{cc}\n & \\\\\n\\end{tabular}\n", label: "Table" },
    ],
  },
];

export interface SymbolPaletteProps {
  /** Appends the snippet to the open buffer. */
  onInsert: (latex: string) => void;
}

export default function SymbolPalette({ onInsert }: SymbolPaletteProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title="Insert LaTeX symbol"
        aria-label="Insert LaTeX symbol"
        className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
          isOpen
            ? "bg-primary-fixed text-primary"
            : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low"
        }`}
      >
        <span className="font-mono text-sm font-semibold">&Sigma;</span>
      </button>

      {isOpen && (
        <>
          <button
            type="button"
            aria-label="Close symbol palette"
            tabIndex={-1}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />

          <div
            role="dialog"
            aria-label="LaTeX symbols"
            className="absolute left-0 top-9 z-40 w-[340px] max-h-[420px] overflow-y-auto rounded-xl bg-surface-container-lowest border border-surface-container-high shadow-xl p-3"
          >
            {SYMBOL_GROUPS.map((group) => (
              <div key={group.title} className="mb-3 last:mb-0">
                <h3 className="text-[10px] font-semibold uppercase tracking-wider text-outline mb-1.5">
                  {group.title}
                </h3>
                <div className="grid grid-cols-5 gap-1">
                  {group.symbols.map((symbol) => (
                    <button
                      key={symbol.label}
                      type="button"
                      title={`${symbol.label} — ${symbol.latex.replace(/\n/g, "\\n")}`}
                      aria-label={`Insert ${symbol.label}`}
                      onClick={() => {
                        onInsert(symbol.latex);
                        setIsOpen(false);
                      }}
                      className="h-8 rounded-lg text-sm text-on-surface hover:bg-primary-fixed hover:text-primary transition-colors font-mono"
                    >
                      {symbol.glyph}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
