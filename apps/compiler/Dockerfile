# LaTeX compiler image, hardened for untrusted input.
#
# The container is not trusted to defend itself: it is run with --network none,
# --read-only, --cap-drop ALL, no-new-privileges and hard memory/CPU/PID caps
# (see app/compile/backend.py). Everything below is defence in depth.
#
# Build:  docker build -t likhitex-compiler apps/compiler/

FROM debian:12-slim

ENV DEBIAN_FRONTEND=noninteractive \
    TEXMFHOME=/tmp/texmf-home \
    TEXMFCONFIG=/tmp/texmf-config \
    TEXMFVAR=/tmp/texmf-var

# latexmk + TeX Live. python3 is the only runtime dependency; the runner uses
# nothing outside the standard library, so no pip installs are needed.
RUN apt-get update && apt-get install -y --no-install-recommends \
        latexmk \
        python3 \
        texlive-latex-base \
        texlive-latex-recommended \
        texlive-latex-extra \
        texlive-fonts-recommended \
        texlive-fonts-extra \
        texlive-xetex \
        texlive-luatex \
        texlive-bibtex-extra \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Unprivileged compile user with a fixed uid.
RUN groupadd --gid 1000 texuser \
    && useradd --uid 1000 --gid 1000 --create-home --shell /bin/bash texuser

# Writable scratch space. The root filesystem is mounted read-only at run time,
# so the scratch dirs live on the tmpfs mounted over /tmp.
RUN mkdir -p /app /compile \
    && chown -R texuser:texuser /app /compile

COPY texmf.cnf /etc/texmf/web2c/texmf.cnf
COPY runner.py /app/runner.py
RUN chmod 0555 /app/runner.py

# Make the TeX tree read-only so a compromised job cannot plant a macro.
RUN chmod -R a-w /usr/share/texlive /usr/share/texmf /usr/local/share/texmf 2>/dev/null || true

USER texuser
WORKDIR /compile

# Fail the build if the toolchain is broken, rather than shipping an image whose
# every compile fails at runtime.
RUN printf '%s\n' '\documentclass{article}' '\begin{document}' 'build check' '\end{document}' > check.tex \
    && HOME=/tmp latexmk -pdf -no-shell-escape -interaction=nonstopmode check.tex \
    && rm -f check.* \
    && latexmk --version

# Bounded entrypoint: no shell, no argument injection surface.
ENTRYPOINT ["python3", "/app/runner.py"]
CMD []