/**
 * LaTeX autocompletion for CodeMirror.
 *
 * Three contexts, the ones TeXstudio and Overleaf complete: `\command`,
 * `\begin{environment}` (which also writes the matching `\end`), and the keys
 * inside `\ref{}`/`\cite{}`, gathered from every loaded buffer's `\label{}` and
 * every loaded `.bib` file's entry keys.
 */

import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";

const COMMANDS: [string, string][] = [
  ["section", "\\section{#{title}}"],
  ["subsection", "\\subsection{#{title}}"],
  ["subsubsection", "\\subsubsection{#{title}}"],
  ["chapter", "\\chapter{#{title}}"],
  ["paragraph", "\\paragraph{#{title}}"],
  ["textbf", "\\textbf{#{text}}"],
  ["textit", "\\textit{#{text}}"],
  ["emph", "\\emph{#{text}}"],
  ["underline", "\\underline{#{text}}"],
  ["texttt", "\\texttt{#{text}}"],
  ["label", "\\label{#{key}}"],
  ["ref", "\\ref{#{key}}"],
  ["eqref", "\\eqref{#{key}}"],
  ["cite", "\\cite{#{key}}"],
  ["footnote", "\\footnote{#{text}}"],
  ["href", "\\href{#{url}}{#{text}}"],
  ["url", "\\url{#{url}}"],
  ["includegraphics", "\\includegraphics[width=#{0.8}\\textwidth]{#{file}}"],
  ["caption", "\\caption{#{text}}"],
  ["usepackage", "\\usepackage{#{package}}"],
  ["documentclass", "\\documentclass{#{article}}"],
  ["input", "\\input{#{file}}"],
  ["include", "\\include{#{file}}"],
  ["title", "\\title{#{title}}"],
  ["author", "\\author{#{name}}"],
  ["maketitle", "\\maketitle"],
  ["tableofcontents", "\\tableofcontents"],
  ["bibliography", "\\bibliography{#{file}}"],
  ["bibliographystyle", "\\bibliographystyle{#{plain}}"],
  ["item", "\\item "],
  ["centering", "\\centering"],
  ["newcommand", "\\newcommand{\\#{name}}{#{definition}}"],
  ["frac", "\\frac{#{a}}{#{b}}"],
  ["sqrt", "\\sqrt{#{x}}"],
  ["sum", "\\sum_{#{i=1}}^{#{n}}"],
  ["int", "\\int_{#{a}}^{#{b}}"],
  ["mathbb", "\\mathbb{#{R}}"],
  ["mathcal", "\\mathcal{#{A}}"],
  ["mathrm", "\\mathrm{#{text}}"],
  ["left", "\\left#{(} #{} \\right#{)}"],
  ["hline", "\\hline"],
  ["newline", "\\newline"],
  ["vspace", "\\vspace{#{1em}}"],
  ["hspace", "\\hspace{#{1em}}"],
];

const ENVIRONMENTS = [
  "document", "abstract", "figure", "table", "tabular", "equation", "equation*",
  "align", "align*", "gather", "itemize", "enumerate", "description", "center",
  "quote", "verbatim", "minipage", "theorem", "lemma", "proof", "definition",
  "frame", "thebibliography", "matrix", "pmatrix", "bmatrix", "cases",
];

const COMMAND_OPTIONS: Completion[] = COMMANDS.map(([name, template]) =>
  snippetCompletion(template, { label: `\\${name}`, type: "keyword" }),
);

export interface ProjectReferences {
  labels: string[];
  citeKeys: string[];
  /** Commands defined with \newcommand / \renewcommand / \DeclareMathOperator. */
  commands: string[];
}

const unique = (values: Iterable<string>) => [...new Set(values)].sort();

/** Scans buffers (path -> text) for labels, bibliography keys and macros. */
export function collectReferences(buffers: Readonly<Record<string, string>>): ProjectReferences {
  const labels: string[] = [];
  const citeKeys: string[] = [];
  const commands: string[] = [];

  for (const [path, text] of Object.entries(buffers)) {
    if (path.endsWith(".bib")) {
      for (const m of text.matchAll(/@(\w+)\s*\{\s*([^,\s{}]+)\s*,/g)) {
        if (!/^(string|preamble|comment)$/i.test(m[1])) citeKeys.push(m[2]);
      }
      continue;
    }
    for (const m of text.matchAll(/\\label\{([^}]+)\}/g)) labels.push(m[1]);
    for (const m of text.matchAll(/\\bibitem(?:\[[^\]]*\])?\{([^}]+)\}/g)) citeKeys.push(m[1]);
    for (const m of text.matchAll(/\\(?:re)?newcommand\*?\s*\{?\\([a-zA-Z]+)|\\DeclareMathOperator\*?\s*\{\\([a-zA-Z]+)/g)) {
      commands.push(m[1] ?? m[2]);
    }
  }

  return { labels: unique(labels), citeKeys: unique(citeKeys), commands: unique(commands) };
}

/** Writes `name}` plus the matching `\end{name}`, leaving the caret inside. */
function applyEnvironment(name: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const { state } = view;
    // closeBrackets has usually already typed the `}`.
    const end = state.sliceDoc(to, to + 1) === "}" ? to + 1 : to;
    const line = state.doc.lineAt(from);
    const indent = /^\s*/.exec(line.text)?.[0] ?? "";
    const head = `${name}}\n${indent}  `;
    view.dispatch({
      changes: { from, to: end, insert: `${head}\n${indent}\\end{${name}}` },
      selection: { anchor: from + head.length },
      userEvent: "input.complete",
    });
  };
}

/** Builds the completion source; `getBuffers` is read lazily on each request. */
export function latexCompletionSource(getBuffers: () => Readonly<Record<string, string>>) {
  return (context: CompletionContext): CompletionResult | null => {
    // Inside \ref{...} or \cite{a,b...}: complete the key under the caret.
    const keyed = context.matchBefore(/\\(?:[a-zA-Z]*ref|[a-zA-Z]*cite[a-zA-Z]*\*?(?:\[[^\]]*\])*)\{[^}]*/);
    if (keyed) {
      const isCite = /cite/.test(keyed.text);
      const start = keyed.from + Math.max(keyed.text.lastIndexOf("{"), keyed.text.lastIndexOf(",")) + 1;
      const refs = collectReferences(getBuffers());
      const values = isCite ? refs.citeKeys : refs.labels;
      return {
        from: start,
        options: values.map((label) => ({ label, type: isCite ? "text" : "variable" })),
        validFor: /^[^},]*$/,
      };
    }

    const env = context.matchBefore(/\\begin\{[a-zA-Z*]*/);
    if (env) {
      return {
        from: env.from + "\\begin{".length,
        options: ENVIRONMENTS.map((name) => ({ label: name, type: "type", apply: applyEnvironment(name) })),
        validFor: /^[a-zA-Z*]*$/,
      };
    }

    const command = context.matchBefore(/\\[a-zA-Z]*/);
    if (!command) return null;
    const own = collectReferences(getBuffers()).commands
      .filter((name) => !COMMANDS.some(([known]) => known === name))
      .map((name) => ({ label: `\\${name}`, type: "function" }));
    return { from: command.from, options: [...COMMAND_OPTIONS, ...own], validFor: /^\\[a-zA-Z]*$/ };
  };
}
