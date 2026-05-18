# ═══════════════════════════════════════════════════════════════════════════════
# Stage 1 — base
#   Common foundation shared by all subsequent stages.
#   Node 22 Alpine + pnpm enabled through corepack.
# ═══════════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Suppress Husky git-hooks setup in every stage — no .git dir in Docker
ENV HUSKY=0

RUN corepack enable

WORKDIR /app

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 2 — deps
#   Install all dependencies (dev + prod) needed to compile the application.
#
#   --ignore-scripts:  skips all package lifecycle scripts (install/postinstall).
#     This project has no native binaries in its dependency tree.
#     package.json also declares pnpm.onlyBuiltDependencies=[] as an explicit
#     audit that no package here requires a build script — satisfying pnpm 11's
#     ERR_PNPM_IGNORED_BUILDS check at the config level regardless of version.
#
#   This layer is cached separately: only rebuilds when the lockfile changes.
# ═══════════════════════════════════════════════════════════════════════════════
FROM base AS deps

COPY package.json pnpm-lock.yaml ./

RUN pnpm install --frozen-lockfile --ignore-scripts

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 3 — build
#   Compile TypeScript source → dist/ using NestJS CLI.
# ═══════════════════════════════════════════════════════════════════════════════
FROM base AS build

COPY --from=deps /app/node_modules ./node_modules

# Copy only the files required for compilation
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN pnpm build

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 4 — development
#   Full dependency set with source available for hot-reload.
#   Used by: docker compose -f docker-compose.yml -f docker-compose.dev.yml up
# ═══════════════════════════════════════════════════════════════════════════════
FROM base AS development

ENV NODE_ENV=development

# Install dependencies directly in this stage so pnpm 11 writes a correct
# workspace-state.json inside node_modules.  The anonymous volume declared in
# docker-compose.dev.yml (/app/node_modules) is initialised from this image
# layer, giving pnpm a consistent, readable state file at container start.
#
# pnpm-workspace.yaml MUST be present here: pnpm 11 records its content hash
# in the workspace state.  If it is absent at install time but present at
# runtime (via bind mount), pnpm detects a mismatch and tries to purge
# node_modules — which fails without a TTY (ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

# Source is bind-mounted at runtime (see docker-compose.dev.yml).
# This COPY acts as a fallback when no volume is provided.
COPY . .

EXPOSE 3000

CMD ["pnpm", "start:dev"]

# ═══════════════════════════════════════════════════════════════════════════════
# Stage 5 — production  ← default target for docker-compose.yml
#   Runtime-only image: node_modules from deps + compiled dist from build.
#   No source code, no dev tooling, no build cache.
#   Runs as a non-root user for container security.
# ═══════════════════════════════════════════════════════════════════════════════
FROM node:22-alpine AS production

ENV NODE_ENV=production

WORKDIR /app

# Copy runtime dependencies (pnpm virtual store preserved inside node_modules)
COPY --from=deps /app/node_modules ./node_modules

# Copy compiled application
COPY --from=build /app/dist ./dist

# package.json is needed for Node.js module-type resolution at runtime
COPY package.json ./

# Create a non-root system user and take ownership of the app directory
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nestjs \
    && chown -R nestjs:nodejs /app

USER nestjs

EXPOSE 3000

# Verify the application is responding (any non-connection-error = healthy)
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD wget -qO /dev/null http://localhost:3000/api || exit 1

CMD ["node", "dist/main"]
