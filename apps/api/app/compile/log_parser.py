"""
LaTeX log parser for extracting errors and warnings.

Parses pdflatex/xelatex log output to extract structured diagnostics.
"""

import re
from typing import Any


def parse_latex_log(log: str) -> dict[str, list[dict[str, Any]]]:
    """
    Parse LaTeX log output to extract errors and warnings.
    
    Returns a dict with 'errors' and 'warnings' keys, each containing a list
    of diagnostics with 'file', 'line', 'message', and 'severity' fields.
    """
    errors: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    
    lines = log.split("\n")
    i = 0
    
    while i < len(lines):
        line = lines[i]
        
        # Match LaTeX errors: "! LaTeX Error:"
        if line.startswith("! LaTeX Error:"):
            message = line[len("! LaTeX Error:"):].strip()
            file, line_num = _extract_location(lines, i)
            errors.append({
                "file": file or "",
                "line": line_num or 0,
                "message": message,
                "severity": "error"
            })
            i += 1
            continue
        
        # Match general errors: "! "
        if line.startswith("! "):
            message = line[2:].strip()
            # Skip empty error lines
            if not message:
                i += 1
                continue
            file, line_num = _extract_location(lines, i)
            errors.append({
                "file": file or "",
                "line": line_num or 0,
                "message": message,
                "severity": "error"
            })
            i += 1
            continue
        
        # Match file not found errors
        if "cannot \read from terminal" in line.lower() or "file not found" in line.lower():
            file, line_num = _extract_location(lines, i)
            errors.append({
                "file": file or "",
                "line": line_num or 0,
                "message": line.strip(),
                "severity": "error"
            })
            i += 1
            continue
        
        # Match package errors
        pkg_error_match = re.match(r"^! Package (\w+) Error: (.+)$", line)
        if pkg_error_match:
            package, message = pkg_error_match.groups()
            file, line_num = _extract_location(lines, i)
            errors.append({
                "file": file or "",
                "line": line_num or 0,
                "message": f"[{package}] {message}",
                "severity": "error"
            })
            i += 1
            continue
        
        # Match warnings
        if line.startswith("LaTeX Warning:"):
            message = line[len("LaTeX Warning:"):].strip()
            file, line_num = _extract_location(lines, i)
            warnings.append({
                "file": file or "",
                "line": line_num or 0,
                "message": message,
                "severity": "warning"
            })
            i += 1
            continue
        
        # Match package warnings
        pkg_warn_match = re.match(r"^Package (\w+) Warning: (.+)$", line)
        if pkg_warn_match:
            package, message = pkg_warn_match.groups()
            file, line_num = _extract_location(lines, i)
            warnings.append({
                "file": file or "",
                "line": line_num or 0,
                "message": f"[{package}] {message}",
                "severity": "warning"
            })
            i += 1
            continue
        
        # Match Underfull/Overfull hbox (common but usually low-priority)
        if line.startswith("Underfull \\hbox") or line.startswith("Overfull \\hbox"):
            # Extract line number if present
            line_match = re.search(r"lines? (\d+)", line)
            line_num = int(line_match.group(1)) if line_match else 0
            # These are common, so only report if they're really bad
            if "badness" in line:
                badness_match = re.search(r"badness (\d+)", line)
                if badness_match and int(badness_match.group(1)) > 5000:
                    warnings.append({
                        "file": "",
                        "line": line_num,
                        "message": line.strip(),
                        "severity": "warning"
                    })
            i += 1
            continue
        
        i += 1
    
    return {"errors": errors, "warnings": warnings}


def _extract_location(lines: list[str], start_idx: int) -> tuple[str, int]:
    """
    Extract file and line number from surrounding log context.
    
    LaTeX logs typically show the file in parentheses like (./main.tex)
    and line numbers in subsequent lines like "l.42 \\end{document}".
    """
    file = ""
    line_num = 0
    
    # Look backwards for file context (up to 10 lines)
    for i in range(max(0, start_idx - 10), start_idx):
        line = lines[i]
        # Match file paths in parentheses
        file_match = re.search(r'\(\./([\w/\-_.]+\.tex)', line)
        if file_match:
            file = file_match.group(1)
    
    # Look forward for line number (up to 5 lines)
    for i in range(start_idx, min(len(lines), start_idx + 5)):
        line = lines[i]
        # Match line numbers like "l.42 " or "line 42"
        line_match = re.match(r'^l\.(\d+)', line)
        if line_match:
            line_num = int(line_match.group(1))
            break
        # Also try "on input line 42"
        input_line_match = re.search(r'on input line (\d+)', line)
        if input_line_match:
            line_num = int(input_line_match.group(1))
            break
    
    return file, line_num
