# LaTeX Compiler Image with Security Hardening
# Phase 1: Basic TeX Live scheme with essential packages

FROM debian:12-slim

# Install TeX Live and dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    texlive-latex-base \
    texlive-latex-recommended \
    texlive-latex-extra \
    texlive-fonts-recommended \
    texlive-fonts-extra \
    texlive-xetex \
    texlive-luatex \
    texlive-bibtex-extra \
    latexmk \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies for runner script
RUN pip3 install --no-cache-dir --break-system-packages \
    pydantic \
    typing-extensions

# Create non-root user for compilation
RUN useradd -m -u 1000 -s /bin/bash texuser

# Create directories
RUN mkdir -p /app /compile /texmf-local \
    && chown -R texuser:texuser /app /compile

# Copy hardened texmf.cnf
COPY texmf.cnf /etc/texmf/web2c/texmf.cnf

# Copy runner script
COPY runner.py /app/runner.py
RUN chmod +x /app/runner.py

# Make TeX tree read-only (security)
RUN chmod -R a-w /usr/share/texlive /usr/share/texmf

# Switch to non-root user
USER texuser
WORKDIR /compile

# Test LaTeX installation
RUN echo '\documentclass{article}\begin{document}Hello\end{document}' > test.tex \
    && pdflatex -interaction=nonstopmode test.tex \
    && rm -f test.*

ENTRYPOINT ["python3", "/app/runner.py"]
