# syntax=docker/dockerfile:1
# 多阶段构建：builder 生成前端，runner 运行服务端（tsx 执行 TS 源码 + 迁移文件）

# ── Builder 阶段：安装依赖 + 构建前端 ────────────────────────────────────────
FROM node:24-slim AS builder

WORKDIR /app

# 安装 pnpm 10.28.2
RUN corepack enable pnpm && corepack use pnpm@10.28.2

# 安装原生模块编译工具（better-sqlite3 需要 node-gyp）
# 用镜像自带的 Node 头文件，避免构建期额外网络下载
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# 复制 workspace 配置与锁文件，冻结安装
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY packages/core/package.json ./packages/core/

RUN npm_config_nodedir=/usr/local pnpm install --frozen-lockfile

# 复制源码并构建前端
COPY . .
RUN pnpm --filter @lce/web build

# ── Runner 阶段：保留后端源码、迁移文件、前端 dist 与运行时依赖 ─────────────
FROM node:24-slim AS runner

WORKDIR /app

# 安装 pnpm 10.28.2
RUN corepack enable pnpm && corepack use pnpm@10.28.2

# 安装原生模块编译工具（better-sqlite3 需要 node-gyp）
# 用镜像自带的 Node 头文件，避免构建期额外网络下载
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 make g++ && \
    rm -rf /var/lib/apt/lists/*

# 复制 workspace 配置
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/server/package.json ./apps/server/
COPY packages/core/package.json ./packages/core/

# 安装运行时依赖（包括 tsx 与原生模块）
RUN npm_config_nodedir=/usr/local pnpm install --frozen-lockfile --prod=false

# 从 builder 复制构建产物
COPY --from=builder /app/apps/web/dist ./apps/web/dist

# 复制后端源码与迁移文件
COPY apps/server ./apps/server
COPY packages/core ./packages/core
COPY tsconfig.base.json ./

# 创建数据目录（容器内）
RUN mkdir -p /app/data

ENV PORT=8787 HOST=0.0.0.0 LCE_DB_PATH=/app/data/app.db NODE_ENV=production

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>r.ok||process.exit(1))"

# 用 tsx 的真实 JS 入口（不用 .bin 包装脚本，该脚本是 shell 脚本无法被 node 直接执行）
CMD ["node", "apps/server/node_modules/tsx/dist/cli.mjs", "apps/server/src/main.ts"]
