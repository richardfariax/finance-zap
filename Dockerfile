# syntax=docker/dockerfile:1

FROM debian:bookworm-slim AS whisper-builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    cmake \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

ARG WHISPER_TAG=v1.8.4
RUN git clone --depth 1 --branch "${WHISPER_TAG}" https://github.com/ggml-org/whisper.cpp.git /whisper
WORKDIR /whisper
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON \
  && cmake --build build --config Release -j"$(nproc)" --target whisper-cli \
  && strip build/bin/whisper-cli \
  && install -m755 build/bin/whisper-cli /usr/local/bin/whisper-cli

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare yarn@1.22.22 --activate
WORKDIR /app

FROM base AS deps
COPY package.json yarn.lock ./
RUN HUSKY=0 yarn install --frozen-lockfile

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN node scripts/ensure-env.mjs
RUN yarn prisma:generate
RUN yarn build

FROM node:22-bookworm AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    tesseract-ocr \
    tesseract-ocr-por \
    tesseract-ocr-eng \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=whisper-builder /usr/local/bin/whisper-cli /usr/local/bin/whisper-cli

ARG WHISPER_MODEL_FILE=ggml-base.bin

RUN mkdir -p /opt/whisper-models \
  && curl -fsSL -o "/opt/whisper-models/${WHISPER_MODEL_FILE}" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL_FILE}"

ENV WHISPER_CLI_PATH=/usr/local/bin/whisper-cli
ENV WHISPER_MODEL_PATH=/opt/whisper-models/${WHISPER_MODEL_FILE}
ENV FFMPEG_PATH=ffmpeg
ENV TESSERACT_LANG=por+eng
ENV WHISPER_LANG=pt

RUN corepack enable && corepack prepare yarn@1.22.22 --activate \
  && npm install -g prisma@6.5.0 tsx@4.19.3

COPY package.json yarn.lock ./
RUN HUSKY=0 yarn install --production --frozen-lockfile

COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/src/shared ./src/shared

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3009
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/app/server.js"]
