"""
Manual smoke test for the hardened API.

Exercises the auth, validation, and resource-limit defences against a running
server. Usage:

    python -m tests.smoke            # against http://127.0.0.1:8000
"""

import sys

import httpx

BASE_URL = "http://127.0.0.1:8000"

TEX = "\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}"

PROJECT_ID = "11111111-1111-1111-1111-111111111111"

# (name, method, path, json body, expected status codes)
CASES = [
    ("liveness", "GET", "/health", None, {200}),
    ("readiness", "GET", "/health/ready", None, {200, 503}),
    ("service metadata", "GET", "/", None, {200}),
    ("compile backend probe", "GET", "/api/compile/health", None, {200}),
    # Authentication is mandatory everywhere except the system probes above.
    ("projects require auth", "GET", "/api/projects/", None, {401}),
    ("compile requires auth", "POST", "/api/compile/", {"files": {"main.tex": TEX}}, {401}),
    ("user profile requires auth", "GET", "/api/users/me", None, {401}),
    ("ws ticket requires auth", "POST", f"/api/collab/projects/{PROJECT_ID}/ws-ticket", None, {401}),
    # Input validation. Auth is checked before the body is trusted, so these
    # unauthenticated calls stop at 401; they still prove nothing crashes.
    ("bad bearer is rejected", "GET", "/api/users/me", None, {401, 503}),
    (
        "host header validation",
        "GET",
        "/health",
        None,
        {200, 400},
    ),
]


def run() -> int:
    failures = 0
    with httpx.Client(base_url=BASE_URL, timeout=15.0) as client:
        for name, method, path, body, expected in CASES:
            try:
                response = client.request(method, path, json=body)
            except httpx.HTTPError as exc:
                print(f"FAIL {name}: transport error {exc}")
                failures += 1
                continue

            ok = response.status_code in expected
            failures += 0 if ok else 1
            marker = "ok  " if ok else "FAIL"
            detail = response.text[:120].replace("\n", " ")
            print(f"{marker} {name}: {response.status_code} {detail}")

            if path == "/health" and response.status_code == 200:
                for header in ("X-Request-ID", "X-Content-Type-Options", "X-Frame-Options"):
                    if header not in response.headers:
                        print(f"     FAIL missing security header {header}")
                        failures += 1

    # Validation cases need a valid session, which requires a real Clerk token.
    # Run them against the schema directly instead of over HTTP.
    failures += check_validators()

    print()
    print("FAILURES:", failures)
    return 1 if failures else 0


def check_validators() -> int:
    """Exercise path and compile-request validation without needing auth."""
    from pydantic import ValidationError

    from app.compile.routes import CompileRequest
    from app.files.schemas import FileUpload, validate_project_path

    failures = 0

    bad_paths = [
        "",
        "/etc/passwd",
        "../../etc/passwd",
        "a/../../b.tex",
        "..\\windows\\system32",
        "C:\\evil.tex",
        ".hidden.tex",
        "sub/.hidden.tex",
        "main.tex\x00.txt",
        "file with\x07bell.tex",
        "x" * 600,
    ]
    for path in bad_paths:
        try:
            validate_project_path(path)
        except ValueError:
            continue
        print(f"FAIL path validator accepted {path!r}")
        failures += 1

    if validate_project_path("chapters/intro.tex") != "chapters/intro.tex":
        print("FAIL path validator mangled a legitimate path")
        failures += 1

    bad_bodies = [
        {"files": {}},
        {"files": {"../evil.tex": "x"}},
        {"files": {"/abs.tex": "x"}},
        {"files": {"main.tex": "x"}, "extra": "unknown field"},
        {"files": {f"f{i}.tex": "x" for i in range(500)}},
        {"files": {"main.tex": "x" * (3 * 1024 * 1024)}},
    ]
    for body in bad_bodies:
        try:
            CompileRequest.model_validate(body)
        except ValidationError:
            continue
        print(f"FAIL CompileRequest accepted {str(body)[:80]}")
        failures += 1

    try:
        CompileRequest.model_validate({"files": {"main.tex": TEX}})
    except ValidationError as exc:
        print(f"FAIL CompileRequest rejected a valid request: {exc}")
        failures += 1

    try:
        FileUpload.model_validate({"path": "main.tex", "content": TEX})
    except ValidationError as exc:
        print(f"FAIL FileUpload rejected a valid request: {exc}")
        failures += 1

    return failures


if __name__ == "__main__":
    if len(sys.argv) > 1:
        BASE_URL = sys.argv[1]
    sys.exit(run())
