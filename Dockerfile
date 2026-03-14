FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HOME=/data/home
ENV MONO_CONFIG_DIR=/data/home/.mono

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY docs ./docs
COPY test ./test
COPY docker ./docker
COPY .mono ./.mono
COPY README.md ./README.md

RUN pnpm install --frozen-lockfile && pnpm build

RUN chmod +x /app/docker/entrypoint.sh \
  && mkdir -p /data/home/.mono /workspace

WORKDIR /workspace

ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD []
