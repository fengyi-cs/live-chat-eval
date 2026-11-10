# 部署说明

## 目录

- [方式一：本地 Node 原生启动](#方式一本地-node-原生启动)
- [方式二：Docker Compose](#方式二docker-compose)
- [配置参数](#配置参数)
- [升级与备份](#升级与备份)
- [停止与卸载](#停止与卸载)

---

## 方式一：本地 Node 原生启动

### 前置条件

- [Node.js >= 22 LTS](https://nodejs.org/)（推荐 22.x 或 24.x，不支持 18 及以下）
- 网络（首次安装依赖时联网下载）

验证 Node 版本：

```bash
node --version   # 应输出 v22.x.x 或更高
```

### 启动

在项目根目录运行：

```bash
node scripts/launcher.mjs
```

脚本会自动：

1. 检查 Node 版本（< 22 时报错退出）
2. 安装或更新 corepack / pnpm（固定版本 10.28.2）
3. `pnpm install --frozen-lockfile`（冻结安装，不升级依赖）
4. 构建前端（`pnpm build`）
5. 启动服务端，打印访问地址

**首次启动**约需 1–3 分钟（下载依赖 + 编译前端）。后续启动因有本地缓存会更快，但每次仍会重新构建前端（约 15–30 秒）。

打开浏览器访问：**http://localhost:8787**

### 仅启动（跳过重新构建）

如果前端没有变化，可以直接启动服务端，跳过前端重建：

```bash
pnpm --filter @lce/server start
```

### 开发模式

前端热更新 + 服务端热重载（需两个终端）：

```bash
pnpm dev
# 前端：http://localhost:5173（代理 API 请求到 8787）
# 服务端：http://localhost:8787
```

---

## 方式二：Docker Compose

### 前置条件

- **Windows / macOS**：安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)，启动后在设置中确认已启用 Docker Engine
- **Linux**：安装 Docker Engine 和 Compose 插件（`docker compose` 命令）

验证：

```bash
docker compose version   # 应输出 v2.x.x
```

### 首次启动

在项目根目录运行：

```bash
docker compose up --build
```

这会构建镜像（约 3–8 分钟，主要是依赖下载和前端编译）并启动容器。

打开浏览器访问：**http://localhost:8787**

> **注意**：服务默认只绑定到本机回环地址（`127.0.0.1`），外部机器无法访问。如需局域网访问，参见 [配置参数](#配置参数) 修改 `APP_HOST`。

### 后台运行

```bash
docker compose up -d        # 后台启动
docker compose logs -f      # 查看日志
docker compose down         # 停止（保留数据）
```

### 数据持久化

Docker Compose 使用命名卷 `lce_data` 存储 SQLite 数据库，容器删除后数据仍保留。

查看数据卷位置：

```bash
docker volume inspect lce_data
```

备份数据（停止容器后）：

```bash
docker compose down
docker run --rm -v lce_data:/data -v $(pwd)/backup:/backup alpine \
  tar czf /backup/lce_data_$(date +%Y%m%d).tar.gz -C /data .
```

---

## 配置参数

复制 `.env.example` 为 `.env`（可选，所有变量都有默认值，不创建也能正常启动）：

```bash
cp .env.example .env
```

### 原生启动（`node scripts/launcher.mjs`）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `8787` | 服务监听端口 |
| `HOST` | `127.0.0.1` | 服务监听地址；改为 `0.0.0.0` 可局域网访问（注意网络安全） |
| `LCE_DB_PATH` | `data/app.db` | SQLite 数据库文件路径（相对项目根目录） |

原生启动不会自动读取 `.env` 文件，需要在命令行前置传入，或提前 `export`：

```bash
PORT=9000 node scripts/launcher.mjs
```

### Docker Compose（`docker compose up`）

容器内的监听端口和数据库路径已固定（`PORT=8787`、`HOST=0.0.0.0`、`LCE_DB_PATH=/app/data/app.db`），
只需配置宿主机侧的绑定地址和端口：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `APP_PORT` | `8787` | 宿主机侧发布端口（即浏览器访问的端口） |
| `APP_HOST` | `127.0.0.1` | 宿主机侧绑定地址；改为 `0.0.0.0` 可局域网访问 |

这两个变量可以在 `.env` 文件中设置，也可以在命令行前置传入：

```bash
APP_PORT=9000 docker compose up
```

> **API Key 不在 `.env` 里配置**。模型服务的 Key 通过应用内「设置 → 模型服务」页面配置，存储在本地 SQLite 数据库文件（`data/app.db` 或 Docker 卷），备份数据库文件时 Key 也会一并备份，请勿将含 Key 的备份对外共享。

---

## 升级与备份

### 升级前备份

```bash
# 原生启动：先停止服务（Ctrl+C），再备份 data 目录
# 直接拷贝运行中的 SQLite 数据库可能产生不一致，建议停服务后再备份
cp -r data/ data_backup_$(date +%Y%m%d)/

# Docker：先停止再备份卷（见上方备份命令）
docker compose down
```

### 获取新版本

```bash
git pull
```

### 重新启动（原生）

```bash
node scripts/launcher.mjs
# 脚本会自动重新安装依赖（若有变化）并重新构建前端
```

### 重新构建并启动（Docker）

```bash
docker compose up --build
```

### 数据库迁移

服务端启动时自动执行数据库迁移，无需手动操作。迁移是增量的（新增表或列），不会删除现有数据。

**重要**：迁移未承诺向下兼容。若需回滚版本，必须同时恢复对应版本的数据备份，仅切换代码无法保证旧版本能正常读取新版本写入的数据。

---

## 停止与卸载

**原生**：在终端按 `Ctrl+C`，服务会正常关闭数据库连接并退出。

**Docker**：

```bash
docker compose down          # 停止并移除容器，保留数据卷
docker compose down -v       # 停止并移除容器和数据卷（数据会丢失）
docker rmi live-chat-eval-app  # 删除镜像（可选）
```
