"use client";

/**
 * Editor insert toolbar.
 *
 * This is the row a LaTeX author reaches for constantly, so it carries the tools
 * the mature desktop editors put one click away: text formatting that wraps the
 * selection, float and list templates, comment toggling, undo and redo, and a
 * live word count. The layout follows the design reference -- tools in the
 * centre, document metrics on the right -- with the write tools hidden for
 * VIEWERs, because the API rejects their writes with a 403 and a live-looking
 * button that always fails is worse than no button.
 *
 * The LaTeX for each tool lives here rather than in the page so the whole set can
 * be read in one place; the behaviour behind them is in `@/lib/latexInsert`.
 */

import type { ComponentType, ReactNode } from "react";
import { useMemo } from "react";
import {
  Image as ImageIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  MessageSquarePlus,
  Redo2,
  Table as TableIcon,
  Undo2,
} from "lucide-react";

import { formatBytes } from "@/lib/format";
import {
  WRAP_PRESETS,
  countWords,
  type EditorCommand,
} from "@/lib/latexInsert";

/** A full figure float, the shape TeXstudio's "insert graphic" produces. */
const FIGURE_TEMPLATE = `\\begin{figure}[htbp]
  \\centering
  \\includegraphics[width=0.8\\textwidth]{example-image}
  \\caption{Caption}
  \\label{fig:caption}
\\end{figure}`;

/** A 2x2 table, which is the smallest shape worth starting a real table from. */
const TABLE_TEMPLATE = `\\begin{table}[htbp]
  \\centering
  \\begin{tabular}{ll}
    \\hline
    Header & \\\\
    \\hline
     &      \\\\
    \\hline
  \\end{tabular}
  \\caption{Caption}
  \\label{tab:caption}
\\end{table}`;

const ITEMIZE_TEMPLATE = `\\begin{itemize}
  \\item First item
  \\item Second item
\\end{itemize}`;

const ENUMERATE_TEMPLATE = `\\begin{enumerate}
  \\item First item
  \\item Second item
\\end{enumerate}`;

interface ToolButton {
  key: string;
  /** Tooltip and accessible name. */
  label: string;
  /** Text glyph, used where the design calls for typography rather than an icon. */
  glyph?: string;
  icon?: ComponentType<{ className?: string }>;
  glyphClassName?: string;
  /** Builds the command; `nonce` is what lets a repeated click fire again. */
  command: (nonce: number) => EditorCommand;
  /** Renders a separator before this tool, grouping the bar. */
  dividerBefore?: boolean;
}

const TEXT_TOOLS: ToolButton[] = [
  {
    key: "bold",
    label: "Bold (Ctrl/Cmd+B) — \\textbf{}",
    glyph: "B",
    glyphClassName: "font-bold",
    command: (nonce) => ({ kind: "wrap", ...WRAP_PRESETS.bold, nonce }),
  },
  {
    key: "italic",
    label: "Italic (Ctrl/Cmd+I) — \\textit{}",
    glyph: "I",
    glyphClassName: "italic font-serif",
    command: (nonce) => ({ kind: "wrap", ...WRAP_PRESETS.italic, nonce }),
  },
  {
    key: "math",
    label: "Inline math — $...$",
    glyph: "$x$",
    glyphClassName: "font-mono text-[11px] font-semibold text-primary",
    command: (nonce) => ({ kind: "wrap", ...WRAP_PRESETS.math, nonce }),
  },
  {
    key: "link",
    label: "Insert link — \\href",
    icon: LinkIcon,
    command: (nonce) => ({ kind: "wrap", ...WRAP_PRESETS.link, nonce }),
  },
  {
    key: "figure",
    label: "Insert figure — figure float with \\includegraphics",
    icon: ImageIcon,
    command: (nonce) => ({ kind: "insert", text: FIGURE_TEMPLATE, nonce }),
  },
  {
    key: "table",
    label: "Insert table — table float with tabular",
    icon: TableIcon,
    command: (nonce) => ({ kind: "insert", text: TABLE_TEMPLATE, nonce }),
  },
];

const STRUCTURE_TOOLS: ToolButton[] = [
  {
    key: "enumerate",
    label: "Numbered list — enumerate",
    icon: ListOrdered,
    dividerBefore: true,
    command: (nonce) => ({ kind: "insert", text: ENUMERATE_TEMPLATE, nonce }),
  },
  {
    key: "itemize",
    label: "Bulleted list — itemize",
    icon: List,
    command: (nonce) => ({ kind: "insert", text: ITEMIZE_TEMPLATE, nonce }),
  },
  {
    key: "comment",
    label: "Toggle comment — % on the selected lines",
    icon: MessageSquarePlus,
    command: (nonce) => ({ kind: "toggleComment", nonce }),
  },
];

const TOOL_CLASS =
  "w-7 h-7 rounded flex items-center justify-center text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors disabled:opacity-35 disabled:pointer-events-none";

export interface EditorToolbarProps {
  /** Open file contents, or null when no file is open. */
  content: string | null;
  canUndo: boolean;
  canRedo: boolean;
  /** False for VIEWERs, who cannot write. */
  canEdit: boolean;
  onCommand: (command: EditorCommand) => void;
  /** Rendered before the tools, e.g. the open-file chip. */
  leading?: ReactNode;
}

export default function EditorToolbar({
  content,
  canUndo,
  canRedo,
  canEdit,
  onCommand,
  leading,
}: EditorToolbarProps) {
  /**
   * Word count and size for the metrics on the right.
   *
   * `countWords` walks the document with several passes, which is wasted work on
   * every keystroke if it is not tied to the text it describes, hence the memo.
   */
  const metrics = useMemo(() => {
    if (content === null) return null;
    return {
      words: countWords(content),
      // The API stores and returns UTF-8, so measuring encoded length is what the
      // file actually weighs rather than a JS character count.
      bytes: new TextEncoder().encode(content).length,
    };
  }, [content]);

  const renderTool = (tool: ToolButton) => (
    <button
      key={tool.key}
      type="button"
      title={tool.label}
      aria-label={tool.label}
      onClick={() => onCommand(tool.command(Date.now()))}
      className={TOOL_CLASS}
    >
      {tool.glyph ? (
        <span className={`text-xs ${tool.glyphClassName ?? ""}`}>{tool.glyph}</span>
      ) : (
        tool.icon && <tool.icon className="w-4 h-4" />
      )}
    </button>
  );

  return (
    <div className="h-10 px-2 border-b border-surface-container-high flex items-center justify-between shrink-0 bg-surface-container-lowest gap-3">
      <div className="flex items-center gap-1 min-w-0">{leading}</div>

      {canEdit && (
        <div className="flex items-center gap-0.5 text-on-surface-variant overflow-x-hidden">
          {TEXT_TOOLS.map(renderTool)}
          {STRUCTURE_TOOLS.map(renderTool)}

          <div className="h-4 w-[1px] bg-surface-container-high mx-1" />

          <button
            type="button"
            title="Undo (Ctrl/Cmd+Z)"
            aria-label="Undo"
            disabled={!canUndo}
            onClick={() => onCommand({ kind: "undo", nonce: Date.now() })}
            className={TOOL_CLASS}
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="Redo (Ctrl/Cmd+Shift+Z)"
            aria-label="Redo"
            disabled={!canRedo}
            onClick={() => onCommand({ kind: "redo", nonce: Date.now() })}
            className={TOOL_CLASS}
          >
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 shrink-0">
        {metrics ? (
          <>
            <span className="font-mono text-[11px] text-outline" data-testid="word-count">
              {metrics.words.toLocaleString("en")} words
            </span>
            <span className="font-mono text-[11px] text-outline" data-testid="file-size">
              {formatBytes(metrics.bytes)}
            </span>
          </>
        ) : (
          <span className="font-mono text-[11px] text-outline">No file open</span>
        )}
      </div>
    </div>
  );
};
