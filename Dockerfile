# syntax=docker/dockerfile:1.12
ARG NODE_VERSION=26.7.0
ARG NODE_IMAGE_DIGEST=sha256:4db36457f406501e6f608802e5da617e5fbd0e80b75901b6a09de1ae5a667d32
FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS dependencies
WORKDIR /app
RUN npm install --global npm@12.0.2 \
    && apt-get update \
    && apt-get install --yes --no-install-recommends build-essential=12.9 python3=3.11.2-1+b1 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim@${NODE_IMAGE_DIGEST} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HOME=/var/lib/sequent \
    SEQUENT_DATA_DIR=/var/lib/sequent \
    SEQUENT_CODEX_HOME=/var/lib/sequent/.codex
WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
      ca-certificates file ghostscript imagemagick libreoffice-calc libreoffice-writer openssl \
      ocrmypdf poppler-utils tesseract-ocr tesseract-ocr-ita unzip \
    && if [ ! -e /usr/local/bin/magick ]; then ln -s /usr/bin/convert /usr/local/bin/magick; fi \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 sequent \
    && useradd --system --uid 10001 --gid sequent --home-dir /var/lib/sequent sequent
RUN install -d -o sequent -g sequent -m 0700 /var/lib/sequent
COPY --from=build --chown=sequent:sequent /app/build ./build
COPY --from=build --chown=sequent:sequent /app/node_modules ./node_modules
COPY --from=build --chown=sequent:sequent /app/package.json ./package.json
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health',{headers:{'X-Forwarded-For':'127.0.0.1'}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "build"]
