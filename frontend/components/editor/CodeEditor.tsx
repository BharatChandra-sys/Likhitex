"use client";

/**
 * CodeMirror 6 source editor.
 *
 * The view is created once and then driven imperatively. Recreating it on every
 * keystroke would lose the cursor, undo history and scroll position, so content
 * is pushed in via transactions instead. Anything that must be swappable at
 * runtime -- the language mode and read-only state -- sits in a Compartment, since
 * reconfiguring the whole extension set would also drop the update listener that
 * reports edits.
 *
 * LaTeX highlighting uses the STeX parser from `@codemirror/legacy-modes`.
 */

import { useEffect, useEffectEvent, useRef } from "react";
import {
  Compartment,
  EditorSelection,
  EditorState,
  type ChangeSpec,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  undo,
  redo,
  undoDepth,
  redoDepth,
} from "@codemirror/commands";
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  HighlightStyle,
  indentUnit,
  StreamLanguage,
} from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags as t } from "@lezer/highlight";

import { extensionOf } from "@/lib/fileTree";
import {
  environmentAfterCaret,
  hasClosingEnvironment,
  itemContinuation,
  planToggleComment,
  planWrap,
  type EditorCommand,
} from "@/lib/latexInsert";

/** Extensions that get the LaTeX/STeX parser; everything else is plain text. */
const LATEX_EXTENSIONS = new Set(["tex", "sty", "cls", "ltx", "def", "cfg", "bib"]);

/**
 * Highlight colours follow the app's Material 3 palette so the code pane does not
 * read as a foreign surface inside the surrounding UI.
 */
const highlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#7C3AED" },
  { tag: [t.controlKeyword, t.moduleKeyword], color: "#4F46E5" },
  { tag: [t.string, t.special(t.string)], color: "#B45309" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#6B7280", fontStyle: "italic" },
  { tag: [t.number, t.integer, t.float], color: "#0F766E" },
  { tag: [t.function(t.variableName), t.macroName], color: "#2563EB" },
  { tag: [t.definition(t.variableName), t.variableName], color: "#191C1E" },
  { tag: [t.typeName, t.className], color: "#9333EA" },
  { tag: [t.bracket, t.punctuation, t.separator], color: "#464555" },
  { tag: [t.operator, t.operatorKeyword], color: "#BE123C" },
  { tag: [t.meta, t.processingInstruction], color: "#777587" },
  { tag: [t.propertyName, t.attributeName], color: "#0891B2" },
  { tag: t.invalid, color: "#BA1A1A" },
]);

/**
 * Theme overrides that prevent blank space appearing when scrolling past the
 * last line. By default the scroller fills its container and the content block
 * is allowed to sit anywhere inside it; clamping the content height and removing
 * the bottom padding stops the whitespace from appearing at both edges.
 */
const noOverscrollTheme = EditorView.theme({
  "&": {
    height: "100%",
    overflow: "hidden",
  },
  ".cm-scroller": {
    overflow: "auto",
    height: "100%",
  },
  ".cm-content": {
    paddingBottom: "0",
    minHeight: "unset",
  },
  ".cm-gutters": {
    minHeight: "unset",
  },
});

/**
 * A request to change the buffer from the toolbar.
 *
 * The nonce is what makes this usable: the user may click the same tool twice in
 * a row, and without a discriminator the second click would be an identical prop
 * and the effect would not fire again.
 */
export type { EditorCommand } from "@/lib/latexInsert";

/** Whether undo and redo currently have anything to work on. */
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
}

export interface CursorPosition {
  line: number;
  column: number;
}

export interface CodeEditorProps {
  /** Path of the open file; changing it loads a different document. */
  path: string;
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  /** Fired on Ctrl/Cmd+S, which the page turns into an explicit save. */
  onSave?: () => void;
  /** Reports the caret position for the status bar. */
  onCursorChange?: (position: CursorPosition) => void;
  /**
   * 1-based line to move the caret to, e.g. when a compile error is clicked.
   * A plain number is used rather than a callback so the effect below fires on
   * each new request even when the line repeats.
   */
  jumpToLine?: number | null;
  /**
   * A toolbar edit to perform, e.g. wrap the selection in `\textbf{}`.
   *
   * The command runs here rather than in the parent for two reasons: the parent
   * only knows the caret as a line and column, and pushing the resulting text
   * back down as a whole-document replacement would discard the undo history that
   * the edit itself should be undoable as.
   */
  command?: EditorCommand | null;
  /** Reports whether undo and redo are available, so the toolbar can disable them. */
  onHistoryChange?: (state: HistoryState) => void;
}

export default function CodeEditor({
  path,
  value,
  onChange,
  readOnly = false,
  onSave,
  onCursorChange,
  jumpToLine,
  command,
  onHistoryChange,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const readonlyCompartment = useRef(new Compartment());

  /**
   * The document text most recently pushed to the parent.
   *
   * CodeMirror virtualises rendering but stores the document as a rope tree, so
   * `doc.toString()` is a full O(n) serialisation of the whole file. Calling it on
   * every keystroke would re-materialise the entire document per character and
   * throw away exactly what the rope exists to avoid. Tracking the last emitted
   * string lets the change comparison in the effect below skip that cost
   * completely, since the parent's `value` is by construction the string this
   * editor last emitted.
   */
  const lastEmitted = useRef<string>("");

  // The keymap and update listener are built once, so they need a stable way to
  // reach the current handlers. `useEffectEvent` gives a stable identity that
  // always sees the latest props, without assigning refs during render.
  const emitChange = useEffectEvent((next: string) => onChange(next));
  const emitCursor = useEffectEvent((position: CursorPosition) =>
    onCursorChange?.(position),
  );
  const emitSave = useEffectEvent(() => onSave?.());
  /**
   * Reports undo and redo availability to the toolbar.
   *
   * `undoDepth` and `redoDepth` are the authoritative view of the history stack,
   * so the buttons reflect real state rather than an assumption that a fresh
   * document can always be undone.
   */
  const emitHistory = useEffectEvent((canUndo: boolean, canRedo: boolean) =>
    onHistoryChange?.({ canUndo, canRedo }),
  );

  const languageFor = (filePath: string): Extension =>
    LATEX_EXTENSIONS.has(extensionOf(filePath))
      ? // `stex` is a StreamParser, not a LanguageSupport, so it needs wrapping.
        StreamLanguage.define(stex)
      : [];

  /**
   * Enter, taught about LaTeX.
   *
   * Two behaviours, both taken from the established editors: pressing Enter
   * directly after `\begin{env}` opens a matching `\end{env}` and leaves the
   * caret between them (TeXstudio's `\end` script), and Enter on a list item
   * starts the next `\item` (LaTeX Workshop's auto-`\item`). Without these,
   * every environment and list costs a trip to the end of the file to close.
   *
   * Runs before the default Enter binding and returns false when neither rule
   * applies, so an ordinary newline behaves exactly as before.
   */
  const smartEnter = (view: EditorView): boolean => {
    const { state } = view;
    const range = state.selection.main;
    // A range selection is a real selection the user means to act on.
    if (!range.empty) return false;

    const head = range.head;
    const line = state.doc.lineAt(head);
    const upToCaret = state.sliceDoc(line.from, head);
    const indent = /^\s*/.exec(upToCaret)?.[0] ?? "";

    const env = environmentAfterCaret(upToCaret);
    // Only close what is not already closed somewhere in the document, or a
    // second `\end` would be left behind as a compile error.
    if (env && !hasClosingEnvironment(state.doc.toString(), env)) {
      view.dispatch({
        changes: {
          from: head,
          insert: `\n${indent}\t\n${indent}\\end{${env}}`,
        },
        selection: EditorSelection.cursor(head + 1 + indent.length + 1),
        userEvent: "input",
      });
      return true;
    }

    const item = itemContinuation(line.text);
    if (item?.action === "continue") {
      view.dispatch({
        changes: { from: head, insert: `\n${indent}\\item ` },
        selection: EditorSelection.cursor(head + 1 + indent.length + "\\item ".length),
        userEvent: "input",
      });
      return true;
    }

    if (item?.action === "clear") {
      // A bare `\item` means the list is finished, so Enter replaces it with a
      // plain indented line rather than adding another empty item.
      view.dispatch({
        changes: { from: line.from, to: head, insert: indent },
        selection: EditorSelection.cursor(line.from + indent.length),
        userEvent: "input",
      });
      return true;
    }

    return false;
  };

  useEffect(() => {
    if (!hostRef.current) return;

    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: "",
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          history(),
          foldGutter(),
          drawSelection(),
          indentOnInput(),
          indentUnit.of("  "),
          bracketMatching(),
          closeBrackets(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          syntaxHighlighting(highlightStyle),
          keymap.of([
            // Returns true so CodeMirror does not also apply its default binding.
            { key: "Mod-s", run: () => (emitSave(), true) },
            { key: "Enter", run: smartEnter },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          languageCompartment.current.of(languageFor(path)),
          readonlyCompartment.current.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          noOverscrollTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              // Recorded here, not in the parent. The parent's `value` is, by
              // construction, this exact string, so recording it makes the adopt
              // effect below a no-op for local edits. Without this the comparison
              // always missed and each keystroke was answered by a whole-document
              // replacement, which resets the caret and breaks undo.
              const next = update.state.doc.toString();
              lastEmitted.current = next;
              emitChange(next);
            }
            if (update.selectionSet || update.docChanged) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              emitCursor({ line: line.number, column: head - line.from + 1 });
            }
            // Undo and redo availability moves with the history stack, which a
            // plain edit changes even when the selection does not move.
            if (update.docChanged || update.transactions.some((tr) => tr.isUserEvent("undo") || tr.isUserEvent("redo"))) {
              emitHistory(undoDepth(update.state) > 0, redoDepth(update.state) > 0);
            }
          }),
          cmPlaceholder("Start writing your LaTeX here\u2026"),
        ],
      }),
    });

    viewRef.current = view;
    // Seed the toolbar's undo/redo buttons, which start unavailable on a new
    // document and would otherwise look actionable until the first keystroke.
    emitHistory(undoDepth(view.state) > 0, redoDepth(view.state) > 0);
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Created once for the lifetime of the component. Later props are applied to
    // the live view by the effects below, which is what preserves the cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Adopt content from props. This is the only path that writes to the document.
   *
   * The comparison is against the last string this editor emitted rather than
   * `doc.toString()`: on an ordinary keystroke `value` is exactly what was just
   * emitted, so the comparison is O(1) instead of serialising the whole file. The
   * document is only replaced when the parent genuinely disagrees -- a different
   * file, or an external reload.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (value === lastEmitted.current) return;

    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    lastEmitted.current = value;
  }, [value]);

  // A different file needs different parsing rules; drop the emission guard so the
  // next real edit is compared against the correct baseline.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    lastEmitted.current = "";
    view.dispatch({
      effects: languageCompartment.current.reconfigure(languageFor(path)),
    });
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: readonlyCompartment.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  // Move the caret when the parent asks, e.g. from a compile error.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !jumpToLine) return;

    // Clamp rather than throw: a stale diagnostic can point past the new file.
    const target = Math.min(Math.max(1, jumpToLine), view.state.doc.lines);
    const line = view.state.doc.line(target);

    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
  }, [jumpToLine]);

  /**
   * Perform a toolbar command.
   *
   * Every branch goes through one transaction so the whole action is a single
   * undo step, and the caret is placed explicitly each time rather than left to
   * CodeMirror, which would drop the selection it just wrote.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !command) return;

    const { state } = view;
    const { from, to } = state.selection.main;

    if (command.kind === "undo" || command.kind === "redo") {
      const applied = command.kind === "undo" ? undo(view) : redo(view);
      if (applied) view.focus();
      return;
    }

    if (command.kind === "find") {
      openSearchPanel(view);
      return;
    }

    if (command.kind === "insert") {
      view.dispatch({
        changes: { from, to, insert: command.text },
        selection: EditorSelection.cursor(from + command.text.length),
        userEvent: "input.snippet",
      });
      view.focus();
      return;
    }

    if (command.kind === "wrap") {
      const plan = planWrap(state.sliceDoc(from, to), command.open, command.close, command.placeholder);
      view.dispatch({
        changes: { from, to, insert: plan.text },
        selection: EditorSelection.range(from + plan.selectionFrom, from + plan.selectionTo),
        userEvent: "input.snippet",
      });
      view.focus();
      return;
    }

    // Comments apply to whole lines, so the range is widened to line boundaries
    // first; commenting a partial line is not a thing LaTeX has.
    const firstLine = state.doc.lineAt(from);
    const lastLine = state.doc.lineAt(to);
    const lines: string[] = [];
    for (let number = firstLine.number; number <= lastLine.number; number += 1) {
      lines.push(state.doc.line(number).text);
    }

    const plan = planToggleComment(lines);
    const changes: ChangeSpec[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (plan.lines[index] === lines[index]) continue;
      const line = state.doc.line(firstLine.number + index);
      changes.push({ from: line.from, to: line.to, insert: plan.lines[index] });
    }
    if (changes.length === 0) return;

    view.dispatch({
      changes,
      // The lines move length, so the original range is no longer meaningful;
      // collapsing to the start of the block keeps the view predictable.
      selection: EditorSelection.cursor(firstLine.from),
      userEvent: "input.snippet",
    });
    view.focus();
  }, [command]);

  return (
    <div
      ref={hostRef}
      className="h-full w-full overflow-hidden bg-surface-container-lowest [&_.cm-editor]:h-full [&_.cm-editor]:outline-none [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-sm"
      data-testid="code-editor"
    />
  );
}
