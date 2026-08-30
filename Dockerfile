# syntax=docker/dockerfile:1.12

ARG NODE_IMAGE=node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8

FROM ${NODE_IMAGE} AS toolchain
ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /workspace

FROM toolchain AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY packages/ai-evidence/package.json packages/ai-evidence/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/artifact-indexer/package.json packages/artifact-indexer/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/data/package.json packages/data/package.json
COPY packages/reporting/package.json packages/reporting/package.json
COPY packages/security/package.json packages/security/package.json
RUN --mount=type=cache,id=matchbase-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages packages
COPY config/slice3 config/slice3
COPY deployment/gcp/Assert-ProductionWorkerPolicy.mjs deployment/gcp/Assert-ProductionWorkerPolicy.mjs
COPY deployment/gcp/Assert-ProductionImageEnvironment.mjs deployment/gcp/Assert-ProductionImageEnvironment.mjs
COPY scripts/package-next-standalone.mjs scripts/package-next-standalone.mjs
RUN test -f packages/auth/src/risc.ts \
    && pnpm --filter @matchbase/web... build

FROM builder AS worker-packager
ARG DEPLOYMENT_ENVIRONMENT
ARG ROUTE_POLICY_PATH
ARG ROUTE_POLICY_SHA256
RUN node deployment/gcp/Assert-ProductionWorkerPolicy.mjs "$DEPLOYMENT_ENVIRONMENT" "$ROUTE_POLICY_PATH" "$ROUTE_POLICY_SHA256" \
    && mkdir -p /worker-config \
    && cp "$ROUTE_POLICY_PATH" /worker-config/research-route-policy.v1.json \
    && pnpm --filter @matchbase/application --prod deploy --legacy /worker

FROM ${NODE_IMAGE} AS web-runtime
ARG DEPLOYMENT_ENVIRONMENT
COPY --from=builder /workspace/deployment/gcp/Assert-ProductionImageEnvironment.mjs /tmp/Assert-ProductionImageEnvironment.mjs
RUN node /tmp/Assert-ProductionImageEnvironment.mjs "$DEPLOYMENT_ENVIRONMENT" \
    && rm /tmp/Assert-ProductionImageEnvironment.mjs
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=8080
WORKDIR /app
RUN groupadd --gid 10001 matchbase \
    && useradd --uid 10001 --gid matchbase --shell /usr/sbin/nologin --no-create-home matchbase
COPY --from=builder --chown=10001:10001 /workspace/apps/web/.next/standalone/apps/web/ ./
COPY --chmod=0555 deployment/gcp/runtime-entrypoint.sh /app/runtime-entrypoint.sh
ENV MATCHBASE_RUNTIME_KIND=web
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/runtime-entrypoint.sh"]
CMD ["node", "server.js"]

FROM ${NODE_IMAGE} AS worker-runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --gid 10001 matchbase \
    && useradd --uid 10001 --gid matchbase --shell /usr/sbin/nologin --no-create-home matchbase
COPY --from=worker-packager --chown=10001:10001 /worker/ ./
COPY --from=worker-packager --chown=10001:10001 /worker-config/research-route-policy.v1.json ./config/slice3/research-route-policy.v1.json
COPY --chmod=0555 deployment/gcp/runtime-entrypoint.sh /app/runtime-entrypoint.sh
ENV MATCHBASE_RUNTIME_KIND=worker
USER 10001:10001
ENTRYPOINT ["/app/runtime-entrypoint.sh"]
CMD ["node", "dist/combined-worker.js"]
