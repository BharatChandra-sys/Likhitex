"""
Compiler runner unit tests.

These exercise the hardening logic in `apps/compiler/runner.py` directly, with
no Docker required, so the controls are covered in CI even where containers
cannot run. The container-level behaviour is covered separately by
`tests/security/test_compiler_security.py`.
"""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

RUNNER_PATH = Path(__file__).resolve().parents[2] / "compiler" / "runner.py"


def _load_runner():
    """Import runner.py as a module without installing the compiler package."""
    spec = importlib.util.spec_from_file_location("likhitex_compiler_runner", RUNNER_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules["likhitex_compiler_runner"] = module
    spec.loader.exec_module(module)
    return module


runner = _load_runner()

TEX = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}"


# --- Path validation ---------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "",
        "/etc/passwd",
        "../../etc/passwd",
        "..",
        "../",
        "a/../../b.tex",
        "..\\windows",
        "C:\\evil.tex",
        "-option.tex",
        ".hidden.tex",
        "sub/.hidden.tex",
        "bad\x00.tex",
        "bell\x07.tex",
        "x" * 300,
    ],
)
def test_validate_path_rejects_unsafe(path):
    """Unsafe paths never reach the filesystem."""
    with pytest.raises(runner.CompileError):
        runner.validate_path(path)


@pytest.mark.parametrize(
    "path",
    ["main.tex", "chapters/intro.tex", "images/fig 1.png", "a-b_c.tex", "refs.bib"],
)
def test_validate_path_accepts_normal(path):
    """Ordinary project-relative paths are accepted unchanged."""
    assert str(runner.validate_path(path)) == path


def test_setup_compile_dir_rejects_traversal(tmp_path):
    """A traversal filename aborts before anything is written."""
    with pytest.raises(runner.CompileError) as exc:
        runner.setup_compile_dir({"../../etc/passwd": b"x", "main.tex": b"y"}, tmp_path)

    assert "path" in str(exc.value).lower()


def test_setup_compile_dir_enforces_file_count(tmp_path, monkeypatch):
    """The file-count cap is enforced."""
    monkeypatch.setattr(runner, "MAX_FILES", 2)

    with pytest.raises(runner.CompileError):
        runner.setup_compile_dir({f"f{i}.tex": b"x" for i in range(5)}, tmp_path)


def test_setup_compile_dir_enforces_total_size(tmp_path, monkeypatch):
    """The total-size cap is enforced."""
    monkeypatch.setattr(runner, "MAX_TOTAL_BYTES", 64)

    with pytest.raises(runner.CompileError):
        runner.setup_compile_dir({"main.tex": b"A" * 256}, tmp_path)


def test_setup_compile_dir_enforces_per_file_size(tmp_path, monkeypatch):
    """The per-file cap is enforced."""
    monkeypatch.setattr(runner, "MAX_FILE_BYTES", 16)

    with pytest.raises(runner.CompileError):
        runner.setup_compile_dir({"main.tex": b"A" * 64}, tmp_path)


def test_setup_compile_dir_writes_files(tmp_path):
    """Valid input is materialised under the job directory."""
    compile_dir = runner.setup_compile_dir({"main.tex": TEX.encode(), "refs.bib": b"@x{}"}, tmp_path)

    assert (compile_dir / "main.tex").read_text() == TEX
    assert (compile_dir / "refs.bib").read_bytes() == b"@x{}"


def test_setup_compile_dir_rejects_empty(tmp_path):
    """An empty job is rejected."""
    with pytest.raises(runner.CompileError):
        runner.setup_compile_dir({}, tmp_path)


# --- Hostile construct scanning ---------------------------------------------


@pytest.mark.parametrize("package", runner.BLOCKED_PACKAGES)
def test_blocked_packages_are_rejected(package):
    """Every denylisted package is refused, named in the error."""
    tex = f"\\documentclass{{article}}\n\\usepackage{{{package}}}\n\\begin{{document}}x\\end{{document}}"

    with pytest.raises(runner.CompileError) as exc:
        runner.scan_source_for_hostile_constructs({"main.tex": tex})

    assert package in str(exc.value).lower()


def test_blocked_package_detected_with_options():
    """A denylisted package is caught inside a bracketed option list."""
    tex = "\\documentclass[12pt]{article}\n\\usepackage[french]{babel}\n"

    runner.scan_source_for_hostile_constructs({"main.tex": tex})

    with pytest.raises(runner.CompileError):
        runner.scan_source_for_hostile_constructs(
            {"main.tex": tex + "\\usepackage[backend=pygmentize]{minted}\n"}
        )


@pytest.mark.parametrize(
    ("tex", "marker"),
    [
        (r"\immediate\write18{rm -rf /}", "write18"),
        (r"\write18{id}", "write18"),
        (r"\input|ls", "injection"),
        (r"\openout1=x", "openout"),
        (r"\special(ps: cmd)", "special"),
    ],
)
def test_blocked_constructs_are_rejected(tex, marker):
    """Execution primitives are refused with the offending name reported."""
    with pytest.raises(runner.CompileError) as exc:
        runner.scan_source_for_hostile_constructs({"main.tex": tex})

    assert marker in str(exc.value).lower()


def test_legitimate_document_passes_the_scan():
    """An ordinary document is not blocked by the scanner."""
    tex = (
        "\\documentclass[11pt,a4paper]{article}\n"
        "\\usepackage[utf8]{inputenc}\n"
        "\\usepackage{graphicx}\n"
        "\\usepackage{amsmath}\n"
        "\\begin{document}\n"
        "Hello $x^2$.\n"
        "\\end{document}\n"
    )

    runner.scan_source_for_hostile_constructs({"main.tex": tex})


# --- Error sanitisation ------------------------------------------------------


@pytest.mark.parametrize(
    "message",
    [
        "! I can't find file '/etc/passwd'.",
        "/root/.ssh/id_rsa: permission denied",
        "/home/texuser/.texlive2023/texmf-var",
        "/usr/share/texlive/texmf-dist/texmf.cnf",
        "/var/lib/texmf/web2c",
    ],
)
def test_sanitize_redacts_absolute_paths(message):
    """Absolute host paths never leave the container."""
    redacted = runner.sanitize(message)

    for leak in ("/etc/", "/root/", "/usr/share/texlive", "/var/lib/texmf"):
        assert leak not in redacted


def test_sanitize_keeps_project_relative_paths():
    """
    Project-relative references stay readable.

    Users need the failing file name to fix their document; only host paths
    are sensitive.
    """
    message = "error in ./chapters/intro.tex line 42"

    assert "chapters/intro.tex" in runner.sanitize(message)


# --- Main file resolution ----------------------------------------------------


def test_find_main_file_prefers_main_tex(tmp_path):
    """main.tex wins over other candidates."""
    (tmp_path / "other.tex").write_text(TEX)
    (tmp_path / "main.tex").write_text(TEX)

    assert runner.find_main_file(tmp_path) == "main.tex"


def test_find_main_file_requires_tex(tmp_path):
    """A project with no source document is an error."""
    (tmp_path / "readme.md").write_text("hello")

    with pytest.raises(runner.CompileError):
        runner.find_main_file(tmp_path)


def test_find_main_file_rejects_ambiguity(tmp_path):
    """Ambiguity is an error rather than a coin flip."""
    (tmp_path / "a.tex").write_text(TEX)
    (tmp_path / "b.tex").write_text(TEX)

    with pytest.raises(runner.CompileError):
        runner.find_main_file(tmp_path)


def test_find_main_file_honours_explicit_main(tmp_path):
    """An explicit main file must exist."""
    (tmp_path / "a.tex").write_text(TEX)
    (tmp_path / "b.tex").write_text(TEX)

    assert runner.find_main_file(tmp_path, "b.tex") == "b.tex"

    with pytest.raises(runner.CompileError):
        runner.find_main_file(tmp_path, "missing.tex")


def test_find_main_file_rejects_traversal_in_main(tmp_path):
    """`main` cannot be used to point outside the project."""
    with pytest.raises(runner.CompileError):
        runner.find_main_file(tmp_path, "../outside.tex")


# --- Input decoding ----------------------------------------------------------


def test_decode_input_files_rejects_bad_base64():
    """Malformed base64 for a binary asset is a client error."""
    with pytest.raises(runner.CompileError):
        runner.decode_input_files({"fig.png": "!!!not base64!!!"})


def test_decode_input_files_rejects_disallowed_type():
    """Executable and script file types are refused."""
    with pytest.raises(runner.CompileError):
        runner.decode_input_files({"payload.exe": "MZ"})


def test_decode_input_files_accepts_text_and_binary():
    """Text stays UTF-8; binary is base64-decoded."""
    import base64

    decoded = runner.decode_input_files(
        {"main.tex": TEX, "fig.png": base64.b64encode(b"\x89PNG").decode()}
    )

    assert decoded["main.tex"] == TEX.encode("utf-8")
    assert decoded["fig.png"] == b"\x89PNG"


# --- Log parsing -------------------------------------------------------------


def test_parse_latex_log_extracts_errors():
    """File:line errors from -file-line-error are captured."""
    log = (
        "./main.tex:12: Undefined control sequence.\n"
        "l.12 \\badcommand\n"
        "./refs.bib:3: I couldn't open database file.\n"
        "! Emergency stop.\n"
    )

    errors, _warnings = runner.parse_latex_log(log)

    messages = [e["message"] for e in errors]
    assert any("Undefined control sequence" in m for m in messages)
    assert any("Emergency stop" in m for m in messages)
    assert all("severity" in e for e in errors)


def test_parse_latex_log_bounds_output():
    """A pathological log cannot produce unbounded error objects."""
    log = "\n".join(f"./f{i}.tex:{i}: error {i}" for i in range(5000))

    errors, warnings = runner.parse_latex_log(log)
    assert len(errors) <= 200
    assert len(warnings) <= 200


# --- Result envelope ---------------------------------------------------------


def test_build_result_sanitises_and_defaults():
    """Results carry the documented fields with sanitised strings."""
    result = runner.build_result(
        success=False,
        error="failed reading /etc/shadow",
        error_type="compile_error",
    )

    assert result["success"] is False
    assert result["pdf"] is None
    assert result["compile_time"] == 0.0
    assert "/etc/shadow" not in result["error"]
    assert json.dumps(result)  # JSON-serialisable


def test_timeout_error_type_maps_to_distinct_exit_code():
    """Timeout and resource-limit failures use distinct exit codes."""
    assert runner.CompileTimeout("x").error_type == "timeout"
    assert runner.CompileResourceLimit("x").error_type == "resource_limit"


# --- Environment confinement -------------------------------------------------


def test_build_environment_confines_tex_to_job_directory(tmp_path):
    """
    TeX's read/write roots are the job directory.

    This is what makes `openin_any = p` in texmf.cnf actually contain a job.
    """
    compile_dir = tmp_path / "project"
    compile_dir.mkdir()
    scratch = tmp_path / "scratch"
    scratch.mkdir()

    env = runner._build_environment(compile_dir, scratch)

    assert env["TEXMFOUTPUT"] == str(compile_dir)
    assert env["TEXMFINPUT"].startswith(str(compile_dir))
    assert env["openin_any"] == "p"
    assert env["openout_any"] == "p"
    assert env["shell_escape"] == "f"
    # Nothing may write into the read-only image.
    assert env["HOME"] == str(scratch)
    assert env["TEXMFVAR"] == str(scratch / "texmf-var")
    assert (scratch / "texmf-var").is_dir()
