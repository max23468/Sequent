# syntax=docker/dockerfile:1.12
FROM node:26.7.0-trixie-slim@sha256:5758d367d7b4f48b73a9bb3530e687e47efb289f3b43f9c0450a25225ae0db5d AS node-base
ARG DEBIAN_SNAPSHOT=20260827T000000Z
RUN sed -i \
      -e "s|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}|" \
      -e "s|http://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}|" \
      /etc/apt/sources.list.d/debian.sources \
    && printf '%s\n' 'Acquire::Check-Valid-Until "false";' \
      > /etc/apt/apt.conf.d/99sequent-snapshot \
    && npm install --global npm@12.0.2 \
    && test "$(npm --version)" = 12.0.2

FROM node-base AS dependencies
WORKDIR /app
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
      build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node-base AS ocr
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
      python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*
COPY requirements-ocr.txt /tmp/requirements-ocr.txt
RUN python3 -m venv /opt/ocr \
    && /opt/ocr/bin/python -m pip install --no-cache-dir --upgrade pip==26.2.1 \
    && /opt/ocr/bin/python -m pip install --no-cache-dir --requirement /tmp/requirements-ocr.txt \
    && /opt/ocr/bin/python -m pip check

FROM dependencies AS build
COPY . .
RUN npm run build \
    && npm prune --omit=dev

FROM node-base AS runtime
WORKDIR /app
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
      ca-certificates file fonts-dejavu-core ghostscript icc-profiles-free imagemagick jbig2 libcap2-bin \
      libreoffice-calc-nogui libreoffice-core-nogui libreoffice-writer-nogui openssl pngquant \
      bubblewrap poppler-utils python3 qpdf tesseract-ocr tesseract-ocr-ita unpaper unzip \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 sequent \
    && useradd --uid 10001 --gid 10001 --home-dir /var/lib/sequent \
      --no-create-home --shell /usr/sbin/nologin sequent
RUN install -d -o sequent -g sequent -m 0700 /var/lib/sequent
COPY --from=ocr --chown=root:root /opt/ocr /opt/ocr
COPY --from=build --chown=root:root /app/build ./build
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/package.json ./package.json
COPY --from=build --chown=root:root /app/scripts/admin ./scripts/admin
COPY --from=build --chown=root:root /app/src ./src
COPY --from=build --chown=root:root /app/private/official-sources/modello-dichiarazione-successione-2025.pdf ./official-sources/modello-dichiarazione-successione-2025.pdf
RUN find / -xdev -type f -perm /6000 -exec chmod a-s {} + \
    && getcap -r / 2>/dev/null \
      | while IFS= read -r capability_line; do \
          capability_path="${capability_line%% *}"; \
          test -z "$capability_path" || setcap -r "$capability_path"; \
        done \
    && chmod 4755 /usr/bin/bwrap \
    && test -z "$(getcap -r / 2>/dev/null)" \
    && test "$(find / -xdev -type f -perm /6000 -print)" = /usr/bin/bwrap \
    && test -z "$(find /app/node_modules/@openai -perm /022 -print -quit)"
ARG APP_COMMIT_SHA=unversioned
LABEL org.opencontainers.image.source="https://github.com/max23468/Sequent" \
  org.opencontainers.image.revision=$APP_COMMIT_SHA
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HOME=/var/lib/sequent \
    PATH=/opt/ocr/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    CODEX_HOME=/var/lib/sequent/.codex-sequent \
    SEQUENT_COMMIT_SHA=$APP_COMMIT_SHA \
    SEQUENT_DATA_DIR=/var/lib/sequent \
    SEQUENT_CODEX_HOME=/var/lib/sequent/.codex-sequent
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health',{headers:{'X-Forwarded-For':'127.0.0.1'}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "build"]
