# syntax=docker/dockerfile:1.12
ARG NODE_VERSION=26.7.0
FROM node:${NODE_VERSION}-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update \
    && apt-get install --yes --no-install-recommends build-essential python3 \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    SEQUENT_DATA_DIR=/var/lib/sequent
WORKDIR /app
RUN groupadd --system --gid 10001 sequent && useradd --system --uid 10001 --gid sequent --home-dir /nonexistent sequent
COPY --from=build --chown=sequent:sequent /app/build ./build
COPY --from=build --chown=sequent:sequent /app/node_modules ./node_modules
COPY --from=build --chown=sequent:sequent /app/package.json ./package.json
USER sequent
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "build"]
