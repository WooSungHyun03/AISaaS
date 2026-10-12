# AutoBiz FFmpeg worker. Build from the repository root or this folder:  docker build -t autobiz-ffmpeg-worker worker/ffmpeg
FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-noto-cjk librsvg2-bin ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production PORT=8080 WORKER_TMP_DIR=/tmp/autobiz-worker
# No dependencies to install: the worker uses Node built-ins and the system ffmpeg.
RUN useradd --system --create-home worker && mkdir -p /tmp/autobiz-worker && chown worker /tmp/autobiz-worker
USER worker
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.mjs"]
