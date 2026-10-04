import { describe, expect, it } from "vitest";
import {
  WRAP_PRESETS,
  countWords,
  environmentAfterCaret,
  hasClosingEnvironment,
  itemContinuation,
  planToggleComment,
  planWrap,
} from "@/lib/latexInsert";

/**
 * These cover the decisions that shape an edit in the editor. The CodeMirror view
 * that applies them cannot be mounted under jsdom, so the logic is separated out
 * precisely so it can be tested here.
 */

describe("planWrap", () => {
  it("wraps a selection and leaves it selected so typing replaces it", () => {
    const plan = planWrap("deep learning", WRAP_PRESETS.bold.open, WRAP_PRESETS.bold.close, "Bold text");

    expect(plan.text).toBe("\\textbf{deep learning}");
    // The selection covers the original words, not the whole command.
    expect(plan.text.slice(plan.selectionFrom, plan.selectionTo)).toBe("deep learning");
  });

  it("falls back to a selected placeholder when nothing is selected", () => {
    const plan = planWrap("", WRAP_PRESETS.bold.open, WRAP_PRESETS.bold.close, "Bold text");

    expect(plan.text).toBe("\\textbf{Bold text}");
    expect(plan.text.slice(plan.selectionFrom, plan.selectionTo)).toBe("Bold text");
  });

  it("does not treat an empty selection as content to wrap", () => {
    // The regression this guards: an empty string is falsy, so a naive check
    // would have produced `\\textbf{}` with the caret after the braces.
    const plan = planWrap("", WRAP_PRESETS.math.open, WRAP_PRESETS.math.close, "x");

    expect(plan.text).toBe("$x$");
  });

  it("builds both arguments of a two-argument command", () => {
    const plan = planWrap("", WRAP_PRESETS.link.open, WRAP_PRESETS.link.close, "https://");

    expect(plan.text).toBe("\\href{https://}{}");
    expect(plan.text.slice(plan.selectionFrom, plan.selectionTo)).toBe("https://");
  });
});

describe("environmentAfterCaret", () => {
  it("finds the environment when the caret sits just after it", () => {
    expect(environmentAfterCaret("\\begin{equation}")).toBe("equation");
  });

  it("keeps the star on a starred environment", () => {
    expect(environmentAfterCaret("\\begin{align*}")).toBe("align*");
  });

  it("ignores leading indentation", () => {
    expect(environmentAfterCaret("  \\begin{itemize}")).toBe("itemize");
  });

  it("returns null when the line continues past the begin", () => {
    // The rest of the document follows on the same line, so this is not a bare
    // `\begin` and auto-closing would duplicate the closing tag.
    expect(environmentAfterCaret("\\begin{itemize}\\item one")).toBeNull();
  });

  it("returns null for an ordinary line", () => {
    expect(environmentAfterCaret("\\section{Methods}")).toBeNull();
  });
});

describe("hasClosingEnvironment", () => {
  it("finds an existing close", () => {
    expect(hasClosingEnvironment("\\begin{x}a\\end{x}", "x")).toBe(true);
  });

  it("reports a missing close", () => {
    expect(hasClosingEnvironment("\\begin{x}a", "x")).toBe(false);
  });

  it("does not match a different environment with a shared prefix", () => {
    // `equation` must not be considered closed by an `equation*`.
    expect(hasClosingEnvironment("\\end{equation*}", "equation")).toBe(false);
  });
});

describe("itemContinuation", () => {
  it("continues a list item", () => {
    expect(itemContinuation("\\item First")).toEqual({ action: "continue" });
  });

  it("continues an item that carries an optional argument", () => {
    expect(itemContinuation("\\item[x] First")).toEqual({ action: "continue" });
  });

  it("clears a bare item so the list can end", () => {
    expect(itemContinuation("\\item")).toEqual({ action: "clear" });
  });

  it("leaves prose alone", () => {
    expect(itemContinuation("Some ordinary text")).toBeNull();
  });

  it("does not treat the word itemize as an item", () => {
    expect(itemContinuation("\\begin{itemize}")).toBeNull();
  });
});

describe("planToggleComment", () => {
  it("comments every line of a selection", () => {
    const plan = planToggleComment(["first", "second"]);

    expect(plan.commented).toBe(true);
    expect(plan.lines).toEqual(["% first", "% second"]);
  });

  it("uncomments a fully commented block", () => {
    const plan = planToggleComment(["% first", "% second"]);

    expect(plan.commented).toBe(false);
    expect(plan.lines).toEqual(["first", "second"]);
  });

  it("keeps the indentation when uncommenting", () => {
    const plan = planToggleComment(["  % indented"]);

    expect(plan.lines).toEqual(["  indented"]);
  });

  it("comments rather than double-commenting a mixed block", () => {
    // One uncommented line is enough that the intent is "comment this", and
    // layering a second `%` on the already-commented line would be wrong.
    const plan = planToggleComment(["% already", "fresh"]);

    expect(plan.commented).toBe(true);
    expect(plan.lines).toEqual(["% % already", "% fresh"]);
  });

  it("leaves blank lines alone so LaTeX paragraph breaks survive", () => {
    const plan = planToggleComment(["first", "", "second"]);

    expect(plan.lines).toEqual(["% first", "", "% second"]);
  });
});

describe("countWords", () => {
  it("counts prose words", () => {
    expect(countWords("the quick brown fox")).toBe(4);
  });

  it("keeps a command's braced argument as a word", () => {
    expect(countWords("\\textbf{result} of the experiment")).toBe(4);
  });

  it("ignores comments", () => {
    expect(countWords("visible % these words are hidden")).toBe(1);
  });

  it("treats an escaped percent as prose, not a comment", () => {
    // `\%` is a literal percent sign, so everything after it still counts.
    expect(countWords("50\\% of the cases")).toBe(4);
  });

  it("excludes inline math", () => {
    expect(countWords("the value $x^2 + y^2$ follows")).toBe(3);
  });

  it("excludes display math and its environments", () => {
    const source = "before \\begin{equation} a = b \\end{equation} after";
    expect(countWords(source)).toBe(2);
  });

  it("returns zero for an empty document", () => {
    expect(countWords("")).toBe(0);
  });

  it("does not count braces and other layout punctuation", () => {
    expect(countWords("{}[]& ~")).toBe(0);
  });
});
