# LaTeX Compiler Service

Hardened Docker container for compiling LaTeX documents securely.

## Security Features

- **Non-root user:** Runs as `texuser` (uid 1000)
- **Read-only TeX tree:** Cannot modify LaTeX installation
- **Disabled shell-escape:** Prevents arbitrary code execution
- **Paranoid file access:** Only reads from compile directory
- **Resource limits:** CPU, memory, timeout enforced
- **Process group timeout:** Kills entire job tree on timeout
- **Fresh temp directory:** Isolated per job
- **No network access:** (via Docker `--network none`)

## Build

```bash
cd apps/compiler
docker build -t likhitex-compiler .
```

## Test Locally

```bash
# Create test document
echo '{
  "files": {
    "main.tex": "\\documentclass{article}\n\\begin{document}\nHello, World!\n\\end{document}"
  }
}' > test_input.json

# Run compiler
docker run --rm -i \
  --network none \
  --read-only \
  --tmpfs /compile:rw,noexec,nosuid,size=100m \
  --tmpfs /tmp:rw,noexec,nosuid,size=50m \
  --cap-drop ALL \
  --security-opt no-new-privileges \
  --pids-limit 50 \
  --memory 512m \
  --cpus 0.5 \
  likhitex-compiler < test_input.json > test_output.json

# Check output
cat test_output.json | jq .success
# Should output: true

# Extract PDF
cat test_output.json | jq -r .pdf | base64 -d > output.pdf
```

## Input Format

```json
{
  "files": {
    "main.tex": "LaTeX content here",
    "references.bib": "BibTeX content",
    "image.png": "<base64 encoded>"
  }
}
```

## Output Format

```json
{
  "success": true,
  "pdf": "<base64 encoded PDF>",
  "log": "Full LaTeX log output",
  "synctex": "<base64 encoded .synctex.gz>",
  "errors": [
    {
      "file": "main.tex",
      "line": 10,
      "message": "Undefined control sequence",
      "severity": "error"
    }
  ],
  "warnings": [],
  "compile_time": 2.34
}
```

## Error Codes

- `0` - Success
- `1` - Compilation error (LaTeX syntax error)
- `2` - Internal error (runner script failure)
- `124` - Timeout (exceeded 60s)

## Security Tests

See `apps/api/tests/security/` for adversarial test suite.

Must pass before deployment:
- `test_shell_escape.py` - Prevents `\write18{}`
- `test_path_traversal.py` - Prevents `/etc/passwd` reads
- `test_resource_limits.py` - Enforces timeout and memory

## Blocked Packages

The following packages require shell-escape and are blocked:

- `minted` (syntax highlighting via Pygments)
- `pythontex` (Python code execution)
- `sagetex` (SageMath integration)

Use alternatives:
- `listings` instead of `minted`
- `lua-tikz` instead of shell-escape TikZ externalization

## Allowed Packages

All standard TeX Live packages are available, including:

- `tikz`, `pgfplots` (graphics)
- `amsmath`, `amssymb` (math)
- `geometry`, `fancyhdr` (layout)
- `biblatex`, `biber` (citations)
- `hyperref`, `cleveref` (links)
- `xcolor`, `graphicx` (colors, images)

## Compilation Flow

1. Runner receives JSON via stdin
2. Creates temp directory `/compile/<uuid>/`
3. Writes files to temp directory
4. Finds main .tex file (priority: main.tex > document.tex > first .tex)
5. Runs `latexmk -pdf` with:
   - Timeout: 60s
   - Memory limit: 512MB (set by Docker)
   - CPU limit: 0.5 cores (set by Docker)
6. Parses errors from .log file
7. Returns PDF + log + errors as JSON
8. Cleans up temp directory

## Docker Security Flags

When running in production (Phase 4), use:

```bash
docker run \
  --network none           # No network access
  --read-only              # Filesystem read-only
  --tmpfs /compile:rw,noexec,nosuid,size=100m  # Writable scratch space
  --cap-drop ALL           # Drop all capabilities
  --security-opt no-new-privileges  # Prevent privilege escalation
  --pids-limit 50          # Max 50 processes
  --memory 512m            # Max 512MB RAM
  --cpus 0.5               # Max 0.5 CPU cores
  likhitex-compiler
```

For maximum isolation (Phase 4+), add gVisor:

```bash
docker run --runtime=runsc \
  # ... other flags ...
  likhitex-compiler
```

## Troubleshooting

### "No .tex file found"
- Ensure at least one .tex file in `files` dict
- Or name your main file `main.tex`

### Timeout errors
- Large documents may exceed 60s
- Increase `COMPILE_TIMEOUT_SECONDS` env var
- Or optimize document (reduce TikZ complexity, smaller images)

### Out of memory
- Reduce image sizes
- Simplify TikZ diagrams
- Increase Docker `--memory` limit

### Package not found
- Check package is in `texlive-latex-extra`
- May need to add to Dockerfile `apt-get install`

## Future Enhancements (Phase 4+)

- [ ] On-demand package installation with `tlmgr`
- [ ] Incremental build caching
- [ ] gVisor runtime for kernel isolation
- [ ] Remote compile service (separate VPS)
- [ ] Support for LuaLaTeX with `--safer`
