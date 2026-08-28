# syntax=docker/dockerfile:1.12
ARG NODE_VERSION=26.7.0
ARG NODE_IMAGE_VARIANT=alpine3.23
ARG NODE_IMAGE_DIGEST=sha256:ce3cc39fe3b8b2602d3b1c4d63d301e46b48c550ecb627869853ddcdda418b63
FROM node:${NODE_VERSION}-${NODE_IMAGE_VARIANT}@${NODE_IMAGE_DIGEST} AS dependencies
WORKDIR /app
RUN apk upgrade --no-cache \
    && apk add --no-cache build-base python3 \
    && npm install --global npm@12.0.2
COPY package.json package-lock.json ./
RUN npm ci

FROM node:${NODE_VERSION}-${NODE_IMAGE_VARIANT}@${NODE_IMAGE_DIGEST} AS ocr
RUN apk upgrade --no-cache \
    && apk add --no-cache python3
COPY requirements-ocr.txt /tmp/requirements-ocr.txt
RUN python3 -m venv /opt/ocr \
    && /opt/ocr/bin/python -m pip install --no-cache-dir --upgrade pip==26.2.1 \
    && /opt/ocr/bin/python -m pip install --no-cache-dir --requirement /tmp/requirements-ocr.txt \
    && /opt/ocr/bin/python -m pip check

FROM dependencies AS build
COPY . .
RUN cc -O2 -Wall -Wextra -Werror -fPIE -pie -Wl,-z,relro,-z,now \
      -o /tmp/codex-launcher scripts/codex-launcher.c \
    && npm run build \
    && npm prune --omit=dev

FROM node:${NODE_VERSION}-${NODE_IMAGE_VARIANT}@${NODE_IMAGE_DIGEST} AS runtime
ARG APP_COMMIT_SHA=unversioned
LABEL org.opencontainers.image.source="https://github.com/max23468/Sequent" \
  org.opencontainers.image.revision=$APP_COMMIT_SHA
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    HOME=/var/lib/sequent \
    PATH=/opt/ocr/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    SEQUENT_DATA_DIR=/var/lib/sequent \
    SEQUENT_CODEX_HOME=/var/lib/sequent/.codex
WORKDIR /app
RUN apk upgrade --no-cache \
    && apk add --no-cache \
      ca-certificates file ghostscript gcompat imagemagick jbig2enc libstdc++ \
      libreoffice-calc libreoffice-common libreoffice-writer openssl pngquant \
      poppler-utils python3 qpdf tesseract-ocr tesseract-ocr-data-ita unpaper unzip \
    && rm -rf /usr/lib/python3.12/ensurepip \
    && addgroup -S -g 10001 sequent \
    && adduser -S -D -H -u 10001 -G sequent -h /var/lib/sequent sequent
RUN install -d -o sequent -g sequent -m 0700 /var/lib/sequent
COPY --from=ocr --chown=root:root /opt/ocr /opt/ocr
COPY --from=build --chown=sequent:sequent /app/build ./build
COPY --from=build --chown=sequent:sequent /app/node_modules ./node_modules
COPY --from=build --chown=sequent:sequent /app/package.json ./package.json
COPY --from=build /tmp/codex-launcher /tmp/codex-launcher
RUN find / -xdev -type f -perm /6000 -exec chmod a-s {} + \
    && codex_path="$(find /app/node_modules/@openai -type f -path '*/bin/codex' -print -quit)" \
    && test -n "$codex_path" \
    && mv "$codex_path" "$codex_path.real" \
    && chown root:root "$codex_path.real" \
    && chmod 0755 "$codex_path.real" \
    && install -o root -g root -m 4755 /tmp/codex-launcher "$codex_path" \
    && test "$(find / -xdev -type f -perm /6000 | wc -l)" -eq 1
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health',{headers:{'X-Forwarded-For':'127.0.0.1'}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "build"]
