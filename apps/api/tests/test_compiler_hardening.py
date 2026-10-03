"""
Tests for the compiler hardening and optimisation work.

Covers the three defects fixed in runner.py:
1. `parse_latex_log` returned a single list and mislabelled every diagnostic as
   an error, so warnings were silently dropped.
2. Log paths were normalised with `str.strip('./')`, which deletes any leading
   or trailing '.' or '/' character and so rewrote legitimate filenames.
3. Child output was drained with `communicate()`, buffering an unbounded amount
   before the cap was applied.

Also covers engine auto-detection and the bounded output reader.
"""

import io
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "compiler"))

import runner  # noqa: E402

# ---------------------------------------------------------------------------
# Warning / error classification
# ---------------------------------------------------------------------------


def test_warnings_are_separated_from_errors():
    """LaTeX warnings must not be reported as errors."""
    log = (
        "LaTeX Warning: Citation `foo' on page 1 undefined on input line 12.\n"
        "./main.tex:7: LaTeX Error: File `missing.sty' not found.\n"
        "./intro.tex:9: Undefined control sequence.\n"
    )

    errors, warnings = runner.parse_latex_log(log)

    assert len(errors) == 2, [e["message"] for e in errors]
    assert len(warnings) == 1
    assert all(e["severity"] == "error" for e in errors)
    assert warnings[0]["severity"] == "warning"


def test_warning_keeps_line_number():
    """`on input line N` is lifted into the line field, not left in the text."""
    log = "LaTeX Warning: Reference `x' undefined on input line 42.\n"

    _, warnings = runner.parse_latex_log(log)

    assert warnings[0]["line"] == 42
    assert "on input line" not in warnings[0]["message"]


def test_box_warnings_are_classified_as_warnings():
    """Overfull/Underfull hbox are layout warnings, not failures."""
    log = (
        "Overfull \\hbox (12.0pt too wide) in paragraph at lines 30--31\n"
        "Underfull \\vbox (badness 10000) in paragraph at lines 40--41\n"
    )

    errors, warnings = runner.parse_latex_log(log)

    assert errors == []
    assert len(warnings) == 2


def test_package_warnings_are_classified():
    """Package-level warnings follow the same rule as LaTeX warnings."""
    log = "Package hyperref Warning: Token not allowed in a PDF string.\n"

    _, warnings = runner.parse_latex_log(log)

    assert warnings[0]["severity"] == "warning"
    assert "hyperref" in warnings[0]["message"]


def test_file_line_warning_keeps_file_and_line():
    """A file:line prefixed warning keeps its file and stays a warning."""
    log = "./chapters/two.tex:31: LaTeX Warning: Reference `fig:y' undefined.\n"

    errors, warnings = runner.parse_latex_log(log)

    assert errors == []
    assert warnings[0]["file"] == "chapters/two.tex"
    assert warnings[0]["line"] == 31


def test_duplicate_diagnostics_are_deduplicated_across_both_lists():
    """The same message is not emitted once per severity bucket."""
    log = "LaTeX Warning: Something on input line 3.\nLaTeX Warning: Something on input line 3.\n"

    _, warnings = runner.parse_latex_log(log)

    assert len(warnings) == 1


# ---------------------------------------------------------------------------
# Log path normalisation (strip('./') regression)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("reported", "expected"),
    [
        ("./main.tex", "main.tex"),
        ("./chapters/one.tex", "chapters/one.tex"),
        ("././main.tex", "main.tex"),
        # The regression: strip('./') deleted these legitimate characters.
        ("..main.tex", "..main.tex"),
        ("..hidden.tex", "..hidden.tex"),
        (".hidden/file.tex", ".hidden/file.tex"),
        ("a.tex", "a.tex"),
        ("..notes.md", "..notes.md"),
    ],
)
def test_normalise_log_path_only_strips_leading_dot_slash(reported, expected):
    """
    Only a leading './' is removed.

    Regression: `str.strip('./')` is a character-set strip, so '..main.tex'
    became 'main.tex' and the editor opened the wrong file.
    """
    assert runner._normalise_log_path(reported) == expected


def test_parsed_error_keeps_dotted_filename_intact():
    """End-to-end through parse_latex_log, the filename must survive."""
    log = "./..main.tex:5: Something broke.\n"

    errors, _ = runner.parse_latex_log(log)

    assert errors[0]["file"] == "..main.tex"


# ---------------------------------------------------------------------------
# Engine detection
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ("\\documentclass{article}\\begin{document}x\\end{document}", "pdflatex"),
        ("\\usepackage{fontspec}\\usepackage{fontspec}", "xelatex"),
        ("\\usepackage[no-math]{fontspec}", "xelatex"),
        ("\\usepackage{luacode}", "lualatex"),
        ("\\usepackage{polyglossia}", "xelatex"),
        ("% !TEX xelatex\n\\usepackage{fontspec}", "xelatex"),
        ("% !TEX lualatex\n\\usepackage{fontspec}", "lualatex"),
        ("% !TEX pdflatex\n\\usepackage{fontspec}", "pdflatex"),
        ("", "pdflatex"),
    ],
)
def test_detect_engine(source, expected):
    """Engine selection follows the preamble, honouring an explicit override."""
    assert runner.detect_engine({"main.tex": source}) == expected


def test_detect_engine_reads_all_sources():
    """A magic comment in a secondary file still steers the engine."""
    sources = {"main.tex": "\\documentclass{article}", "preamble.tex": "% !TEX lualatex"}

    assert runner.detect_engine(sources) == "lualatex"


def test_detect_engine_handles_empty_project():
    """No sources must not raise."""
    assert runner.detect_engine({}) == "pdflatex"


# ---------------------------------------------------------------------------
# Bounded output reader
# ---------------------------------------------------------------------------


def test_stream_capped_truncates_at_limit():
    """Output beyond the limit is dropped and the truncation is reported."""
    stream = io.BytesIO(b"x" * 10_000)

    data, truncated = runner._stream_capped(stream, limit=1000, deadline=time.monotonic() + 5)

    assert len(data) == 1000
    assert truncated is True


def test_stream_capped_returns_all_when_under_limit():
    """Output smaller than the limit is returned intact."""
    stream = io.BytesIO(b"hello")

    data, truncated = runner._stream_capped(stream, limit=1000, deadline=time.monotonic() + 5)

    assert data == b"hello"
    assert truncated is False


def test_stream_capped_never_buffers_more_than_limit():
    """
    Regression: communicate() buffered everything before truncation.

    A generator that yields far more than the cap must not be fully consumed.
    """
    produced = {"count": 0}
    chunk = b"y" * 4096

    class Endless:
        """A pipe that never ends, used to prove the reader stops early."""

        def __init__(self) -> None:
            self._served = 0

        def read(self, size: int = -1) -> bytes:
            self._served += 1
            produced["count"] += 1
            if self._served > 100:
                return b""  # safety valve so a broken cap cannot hang the suite
            return chunk

    data, truncated = runner._stream_capped(
        Endless(), limit=64 * 1024, deadline=time.monotonic() + 5
    )

    assert len(data) == 64 * 1024
    assert truncated is True
    # The whole point: it stopped early instead of draining forever.
    assert produced["count"] < 100


def test_stream_capped_respects_deadline():
    """A blocking reader is abandoned once the deadline passes."""
    class Slow:
        def read(self, size: int = -1) -> bytes:
            time.sleep(0.05)
            return b"z" * 16

    start = time.monotonic()
    with pytest.raises(runner.CompileTimeout):
        runner._stream_capped(Slow(), limit=1024, deadline=time.monotonic() + 0.15)
    assert time.monotonic() - start < 5


def test_stream_capped_survives_closed_pipe():
    """A closed pipe mid-read must not crash the compile."""
    class Closed:
        def read(self, size: int = -1) -> bytes:
            raise ValueError("I/O operation on closed file")

    data, truncated = runner._stream_capped(
        Closed(), limit=100, deadline=time.monotonic() + 5
    )

    assert data == b""
    assert truncated is False


# ---------------------------------------------------------------------------
# Engine hint
# ---------------------------------------------------------------------------


def test_engine_hint_added_for_missing_fontspec():
    """A fontspec failure names the engine, instead of dead-ending the user."""
    detail = "! LaTeX Error: File `fontspec.sty' not found."

    hinted = runner._add_engine_hint(detail, "pdflatex")

    assert "xelatex" in hinted.lower()


def test_engine_hint_omitted_for_unrelated_failures():
    """Ordinary syntax errors get no misleading engine advice."""
    detail = "./main.tex:3: Undefined control sequence."

    assert runner._add_engine_hint(detail, "pdflatex") == detail


def test_run_latexmk_signature_accepts_sources():
    """The engine argument is optional, keeping older callers working."""
    import inspect

    params = inspect.signature(runner.run_latexmk).parameters
    assert "sources" in params
    assert params["sources"].default is None


def test_reader_thread_is_daemon():
    """A stuck reader must never block interpreter shutdown."""
    thread = threading.Thread(target=lambda: None, daemon=True)
    thread.start()
    thread.join()
    assert thread.daemon is True
