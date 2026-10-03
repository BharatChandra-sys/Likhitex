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
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
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
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
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
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { tags as t } from "@lezer/highlight";

import { extensionOf } from "@/lib/fileTree";

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

export interface CursorPosition {
  line: number;
  column: number;
}

/**
 * A request to insert literal text at the caret.
 *
 * The nonce is what makes this usable: the user may click the same symbol twice
 * in a row, and without a discriminator the second click would be an identical
 * prop and the effect would not fire again.
 */
export interface TextInsertRequest {
  text: string;
  nonce: number;
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
   * Inserts text at the caret when set, for the snippet and symbol toolbars.
   *
   * The insert runs here rather than in the parent for two reasons: the parent
   * only knows the caret as a line and column, and pushing the new text back down
   * as a whole-document replacement would discard the undo history that the
   * insertion itself should be undoable as.
   */
  insertRequest?: TextInsertRequest | null;
}

export default function CodeEditor({
  path,
  value,
  onChange,
  readOnly = false,
  onSave,
  onCursorChange,
  jumpToLine,
  insertRequest,
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

  const languageFor = (filePath: string): Extension =>
    LATEX_EXTENSIONS.has(extensionOf(filePath))
      ? // `stex` is a StreamParser, not a LanguageSupport, so it needs wrapping.
        StreamLanguage.define(stex)
      : [];

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
          }),
          cmPlaceholder("Start writing your LaTeX here\u2026"),
        ],
      }),
    });

    viewRef.current = view;
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
   * Insert toolbar text at the caret as a normal edit.
   *
   * Replacing the selection rather than the empty range makes the insert respect
   * an active selection, and the explicit cursor keeps the caret after the new
   * text so consecutive inserts compose instead of stacking up in reverse.
   */
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !insertRequest) return;

    const { from, to } = view.state.selection.main;
    const head = from + insertRequest.text.length;

    view.dispatch({
      changes: { from, to, insert: insertRequest.text },
      selection: EditorSelection.cursor(head),
      // Tags the step so it is one entry in the undo history rather than being
      // folded into the surrounding keystrokes.
      userEvent: "input.snippet",
    });
    view.focus();
  }, [insertRequest]);

  return (
    <div
      ref={hostRef}
      className="h-full w-full overflow-hidden bg-surface-container-lowest [&_.cm-editor]:h-full [&_.cm-editor]:outline-none [&_.cm-scroller]:font-mono [&_.cm-scroller]:text-sm"
      data-testid="code-editor"
    />
  );
}
