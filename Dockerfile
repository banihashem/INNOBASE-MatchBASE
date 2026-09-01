# syntax=docker/dockerfile:1.12

ARG NODE_IMAGE=node:24.14.0-bookworm-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8
ARG VERAPDF_IMAGE=verapdf/cli:v1.30.1@sha256:20202b4bcc2410a25db1f637c7b461a2e0dda1d97dd8a6df658286b30d56c842
ARG DEBIAN_SNAPSHOT=20260831T000000Z

FROM ${VERAPDF_IMAGE} AS verapdf-toolchain

FROM ${NODE_IMAGE} AS pdf-python-toolchain
ARG DEBIAN_SNAPSHOT
COPY --from=verapdf-toolchain /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/%s bookworm main\ndeb [check-valid-until=no] https://snapshot.debian.org/archive/debian/%s bookworm-updates main\ndeb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/%s bookworm-security main\n' "$DEBIAN_SNAPSHOT" "$DEBIAN_SNAPSHOT" "$DEBIAN_SNAPSHOT" > /etc/apt/sources.list \
    && rm -f /etc/apt/sources.list.d/debian.sources
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3=3.11.2-1+b1 python3-venv=3.11.2-1+b1 \
    && python3 -m venv /opt/matchbase/pdf-venv \
    && rm -rf /var/lib/apt/lists/*
COPY packages/reporting/pdf-toolchain/requirements.lock /tmp/requirements.lock
RUN /opt/matchbase/pdf-venv/bin/pip install --disable-pip-version-check --no-cache-dir --require-hashes -r /tmp/requirements.lock \
    && rm /tmp/requirements.lock

FROM ${NODE_IMAGE} AS pdf-runtime
ARG DEBIAN_SNAPSHOT
COPY --from=verapdf-toolchain /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
RUN printf 'deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/%s bookworm main\ndeb [check-valid-until=no] https://snapshot.debian.org/archive/debian/%s bookworm-updates main\ndeb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/%s bookworm-security main\n' "$DEBIAN_SNAPSHOT" "$DEBIAN_SNAPSHOT" "$DEBIAN_SNAPSHOT" > /etc/apt/sources.list \
    && rm -f /etc/apt/sources.list.d/debian.sources
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      python3=3.11.2-1+b1 \
      libpango-1.0-0=1.50.12+ds-1 \
      libpangoft2-1.0-0=1.50.12+ds-1 \
      libharfbuzz-subset0=6.0.0+dfsg-3 \
      fontconfig=2.14.1-4 \
      libjpeg62-turbo=1:2.1.5-2 \
      libopenjp2-7=2.5.0-2+deb12u3 \
      fonts-dejavu-core=2.37-6 \
      openjdk-17-jre-headless=17.0.20.1+1-1~deb12u1 \
      poppler-utils=22.12.0-2+deb12u3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=pdf-python-toolchain --chown=0:0 /opt/matchbase/pdf-venv /opt/matchbase/pdf-venv
COPY --from=verapdf-toolchain --chown=0:0 /opt/verapdf /opt/verapdf
COPY --chown=0:0 packages/reporting/pdf-toolchain/report.css packages/reporting/pdf-toolchain/a4.css packages/reporting/pdf-toolchain/letter.css packages/reporting/pdf-toolchain/fonts.conf packages/reporting/pdf-toolchain/template-attestation.json packages/reporting/pdf-toolchain/template-qualification-evidence.json /opt/matchbase/report-assets/
RUN mkdir -p /opt/matchbase/fonts \
    && cp /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf /opt/matchbase/fonts/DejaVuSans.ttf \
    && echo 'abdc775b21b1bc470d50c97e790d276f2054b7504e56e5bd3e64f48d68582322  /opt/matchbase/fonts/DejaVuSans.ttf' | sha256sum -c - \
    && XDG_CACHE_HOME=/tmp FONTCONFIG_FILE=/opt/matchbase/report-assets/fonts.conf fc-cache -f
RUN mkdir -p /tmp/fontconfig && chmod 1777 /tmp/fontconfig
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
ENV FONTCONFIG_FILE=/opt/matchbase/report-assets/fonts.conf
ENV LANG=C.UTF-8
ENV LC_ALL=C.UTF-8
ENV TZ=UTC
ENV MATCHBASE_PDF_TOOLCHAIN_STATUS=conditional
RUN /opt/matchbase/pdf-venv/bin/weasyprint --version | grep -Fx 'WeasyPrint version 69.0' \
    && /opt/verapdf/verapdf --version 2>&1 | grep -Fx 'veraPDF 1.30.1'

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
    && pnpm --config.inject-workspace-packages=true --filter @matchbase/application --prod deploy /worker

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
    && useradd --uid 10001 --gid matchbase --shell /usr/sbin/nologin --no-create-home matchbase \
    && mkdir -p /work \
    && chown 10001:10001 /work \
    && chmod 0700 /work
COPY --from=builder --chown=10001:10001 /workspace/apps/web/.next/standalone/apps/web/ ./
COPY --from=worker-packager --chown=10001:10001 /worker-config/research-route-policy.v1.json ./config/slice3/research-route-policy.v1.json
COPY --chmod=0555 deployment/gcp/runtime-entrypoint.sh /app/runtime-entrypoint.sh
ENV MATCHBASE_RUNTIME_KIND=web
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/runtime-entrypoint.sh"]
CMD ["node", "server.js"]

FROM pdf-runtime AS worker-runtime
ENV NODE_ENV=production
WORKDIR /app
RUN groupadd --gid 10001 matchbase \
    && useradd --uid 10001 --gid matchbase --shell /usr/sbin/nologin --no-create-home matchbase
COPY --from=worker-packager --chown=10001:10001 /worker/ ./
COPY --from=worker-packager --chown=10001:10001 /worker-config/research-route-policy.v1.json ./config/slice3/research-route-policy.v1.json
COPY --chmod=0555 deployment/gcp/runtime-entrypoint.sh /app/runtime-entrypoint.sh
RUN node --input-type=module -e "await Promise.all([import('./dist/index.js'),import('@matchbase/ai-evidence'),import('@matchbase/contracts'),import('@matchbase/data'),import('@matchbase/security')])"
ENV MATCHBASE_RUNTIME_KIND=worker
ENV MATCHBASE_WEASYPRINT=/opt/matchbase/pdf-venv/bin/weasyprint
ENV MATCHBASE_VERAPDF=/opt/verapdf/verapdf
USER 10001:10001
ENTRYPOINT ["/app/runtime-entrypoint.sh"]
CMD ["node", "dist/combined-worker.js"]
