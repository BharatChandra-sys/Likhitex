# FastAPI backend for Render (free tier: 512MB RAM, no card required).
#
# COMPILE_BACKEND=direct runs pdflatex inside this container, so TeX Live is
# installed here. The hardened texmf.cnf from the compiler image is reused, and
# app/compile/backend.py gives every job a scrubbed environment.
#
# Build (from repo root): docker build -t likhitex-api -f apps/api/Dockerfile .
# Run:                    docker run -p 8000:8000 --env-file apps/api/.env likhitex-api

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive

# TeX Live for in-process compilation, plus curl for the health check.
# texlive-fonts-extra is left out: it adds ~1GB for rarely used fonts.
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
        texlive-latex-base \
        texlive-latex-recommended \
        texlive-latex-extra \
        texlive-fonts-recommended \
        texlive-science \
        texlive-bibtex-extra \
        lmodern \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /usr/share/doc/texlive* /usr/share/texlive/texmf-dist/doc

# Paranoid file access and no shell escape, even if the per-job env is lost.
COPY apps/compiler/texmf.cnf /etc/texmf/web2c/texmf.cnf

WORKDIR /app

# Dependencies and app together: setuptools needs the package to exist.
COPY apps/api/pyproject.toml ./
COPY apps/api/app ./app
RUN pip install --no-cache-dir .

COPY apps/api/alembic ./alembic
COPY apps/api/alembic.ini ./

RUN useradd --create-home --shell /bin/bash appuser \
    && chown -R appuser:appuser /app

USER appuser

# Fail the build rather than ship an image whose every compile fails.
RUN cd /tmp \
    && printf '%s\n' '\documentclass{article}' '\usepackage{amsmath,graphicx,hyperref,geometry,microtype}' \
        '\begin{document}' 'build check $E=mc^2$' '\end{document}' > check.tex \
    && pdflatex -no-shell-escape -interaction=nonstopmode check.tex > /dev/null \
    && test -s check.pdf \
    && rm -f check.*

# Render injects PORT (10000); 8000 is the local default.
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT:-8000}/health" || exit 1

# Migrations run on every boot; they are idempotent. --proxy-headers so rate
# limits see the real client IP behind Render's proxy.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1 --proxy-headers --forwarded-allow-ips='*' --log-level info"]
