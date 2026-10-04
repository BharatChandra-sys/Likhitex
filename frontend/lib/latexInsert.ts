/**
 * LaTeX insertion behaviour shared by the editor toolbar and the buffer.
 *
 * These are the decisions that shape an edit: what a wrap command becomes, what
 * Enter does on a list line, whether a comment toggle adds or removes, how many
 * words a document has. They are kept free of React and of CodeMirror so they can
 * be unit tested directly -- a CodeMirror view needs real layout measurement and
 * cannot be mounted under jsdom, so testing it end to end is not practical.
 */

/** A change the toolbar asks the editor to perform. */
export type EditorCommand =
  | { kind: "insert"; text: string; nonce: number }
  | { kind: "wrap"; open: string; close: string; placeholder: string; nonce: number }
  | { kind: "toggleComment"; nonce: number }
  | { kind: "undo"; nonce: number }
  | { kind: "redo"; nonce: number }
  | { kind: "find"; nonce: number };

/**
 * Delimiters for the text-formatting tools.
 *
 * One definition for both the toolbar buttons and the keyboard shortcuts, so the
 * two cannot drift into offering different LaTeX for the same formatting.
 */
export const WRAP_PRESETS = {
  bold: { open: "\\textbf{", close: "}", placeholder: "Bold text" },
  italic: { open: "\\textit{", close: "}", placeholder: "Italic text" },
  math: { open: "$", close: "$", placeholder: "x" },
  // Two arguments, so the closing half is `}{}`; the URL is left selected.
  link: { open: "\\href{", close: "}{}", placeholder: "https://" },
} as const;

/**
 * The edit a wrap produces.
 *
 * Offsets are relative to the start of the range being replaced, so the caller
 * can turn them into absolute document positions without knowing the range.
 */
export interface WrapPlan {
  text: string;
  selectionFrom: number;
  selectionTo: number;
}

/**
 * Work out what a wrap command should produce for the given selection.
 *
 * A real selection is wrapped and left selected, so typing over it replaces the
 * words in place. This is what every mature editor does -- LaTeX Workshop's
 * "surround selection", TeXstudio's "quote a selection" -- and the alternative of
 * inserting a fixed `\textbf{text}` template at the caret is what made the
 * original toolbar feel broken.
 *
 * With nothing selected the placeholder is inserted and selected instead, so the
 * first keystroke lands inside the braces rather than after them.
 */
export function planWrap(
  selected: string,
  open: string,
  close: string,
  placeholder: string,
): WrapPlan {
  if (selected.length > 0) {
    return {
      text: `${open}${selected}${close}`,
      selectionFrom: open.length,
      selectionTo: open.length + selected.length,
    };
  }

  return {
    text: `${open}${placeholder}${close}`,
    selectionFrom: open.length,
    selectionTo: open.length + placeholder.length,
  };
}

/** `\begin{env}` alone on the line, capturing the name and any star. */
const OPEN_ENV_LINE = /^\s*\\begin\{([a-zA-Z]+)(\*?)\}\s*$/;

/** The environment name when the caret sits just after an opening `\begin{...}`. */
export function environmentAfterCaret(lineUpToCaret: string): string | null {
  const match = OPEN_ENV_LINE.exec(lineUpToCaret);
  return match ? `${match[1]}${match[2]}` : null;
}

/** Whether the document already closes `env` somewhere, so closing again would duplicate it. */
export function hasClosingEnvironment(source: string, env: string): boolean {
  const escaped = env.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\\\end\\{${escaped}\\}`).test(source);
}

/** A line that opens an item, with or without an optional argument. */
const ITEM_LINE = /^\s*\\item(\[[^\]]*\])?/;

/** A line holding nothing but the item marker. */
const BARE_ITEM_LINE = /^\s*\\item(\[[^\]]*\])?\s*$/;

/** What Enter should do on the current line. */
export type ItemContinuation =
  | { action: "continue" }
  /** A bare `\item` ends the list, so the line is emptied rather than extended. */
  | { action: "clear" }
  | null;

/**
 * Whether Enter should start a new `\item`.
 *
 * Continuing the marker is what makes lists bearable to type; LaTeX Workshop
 * does this automatically and TeXstudio offers it as a script.
 */
export function itemContinuation(line: string): ItemContinuation {
  if (!ITEM_LINE.test(line)) return null;
  if (BARE_ITEM_LINE.test(line)) return { action: "clear" };
  return { action: "continue" };
}

/** The result of a comment toggle. */
export interface CommentPlan {
  lines: string[];
  /** True when `%` was added, false when it was removed. */
  commented: boolean;
}

/**
 * Toggle `%` comments across whole lines.
 *
 * Uncommenting only when *every* non-blank line is already a comment matters: a
 * partially commented block would otherwise collect a second layer of `%` on
 * the lines that had none, which is never what anyone wants.
 */
export function planToggleComment(lines: string[]): CommentPlan {
  const meaningful = lines.filter((line) => line.trim().length > 0);
  const allCommented =
    meaningful.length > 0 && meaningful.every((line) => /^\s*%/.test(line));

  if (allCommented) {
    return {
      lines: lines.map((line) => line.replace(/^(\s*)%\s?/, "$1")),
      commented: false,
    };
  }

  return {
    // Blank lines are left alone: a lone `%` on its own line is noise, and it
    // stops LaTeX from treating the following blank line as a paragraph break.
    lines: lines.map((line) => (line.trim().length === 0 ? line : `% ${line}`)),
    commented: true,
  };
}

/** Math environments whose contents are not prose. */
const MATH_ENV = /\\begin\{(equation|align|gather|multline|eqnarray|math|pmatrix|bmatrix|vmatrix|matrix|Bmatrix|Vmatrix|split|cases)\*?\}[\s\S]*?\\end\{(?:equation|align|gather|multline|eqnarray|math|pmatrix|bmatrix|vmatrix|matrix|Bmatrix|Vmatrix|split|cases)\*?\}/g;

/**
 * Words of prose in a LaTeX document.
 *
 * Comments and math are excluded, matching how Overleaf and LaTeX Workshop count:
 * a thesis word count is about the writing, not about `x^2 + y^2`. Command names
 * are dropped but their braced arguments are kept, so `\textbf{result}` still
 * contributes a word.
 */
export function countWords(source: string): number {
  const text = source
    // Comments, but not an escaped `\%` which is a literal percent sign.
    .replace(/(^|[^\\])%.*$/gm, "$1")
    .replace(MATH_ENV, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\$[^$\n]*\$/g, " ")
    .replace(/\\\[[\s\S]*?\\\]/g, " ")
    .replace(/\\\([\s\S]*?\\\)/g, " ")
    // Command names, leaving their arguments behind as prose.
    .replace(/\\[a-zA-Z@]+\*?/g, " ")
    // Layout punctuation, including `~` which is a non-breaking space.
    .replace(/[{}[\]&~]/g, " ");

  return text
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
}
