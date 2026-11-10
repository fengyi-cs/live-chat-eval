# 故障排查

## 目录

- [环境诊断](#环境诊断)
- [启动问题](#启动问题)
- [模型服务问题](#模型服务问题)
- [Docker 问题](#docker-问题)
- [数据与迁移问题](#数据与迁移问题)

---

## 环境诊断

遇到问题时，先运行诊断脚本：

```bash
node scripts/doctor.mjs
```

输出包含 Node 版本、pnpm 版本、端口占用情况等信息（不包含 API Key 等敏感内容），可以直接附在反馈里。

---

## 启动问题

### `node: command not found`

未安装 Node.js，或 Node 未加入 PATH。从 [nodejs.org](https://nodejs.org/) 下载安装 22 LTS 版本。

### `Error: Node.js >= 22 required`

当前 Node 版本低于要求。升级 Node.js，或使用 [nvm](https://github.com/nvm-sh/nvm) / [fnm](https://github.com/Schniz/fnm) 切换版本：

```bash
nvm install 22 && nvm use 22
```

### 端口 8787 被占用

错误信息类似 `EADDRINUSE: address already in use`。

- 检查已有实例是否仍在运行：
  ```bash
  # Linux / macOS
  lsof -i :8787
  # Windows
  netstat -ano | findstr :8787
  ```
- 停止占用进程，或用环境变量换端口：
  ```bash
  PORT=9000 node scripts/launcher.mjs
  ```

### `better-sqlite3` 安装失败 / 原生模块构建失败

better-sqlite3 包含原生 C++ 模块，安装时需要编译工具：

- **Linux**：`sudo apt install build-essential python3`（Debian/Ubuntu）
- **macOS**：`xcode-select --install`
- **Windows**：安装 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，勾选「C++ 生成工具」

安装后重试：`pnpm install`

### `pnpm: command not found`（已有 Node 的情况）

launcher.mjs 会自动处理，直接运行 `node scripts/launcher.mjs` 即可，不需要提前手动安装 pnpm。

如果 corepack 安装也失败：

```bash
npm install -g pnpm@10.28.2
```

---

## 模型服务问题

### 无法连接模型服务

在「设置 → 模型服务」页面点击「测试连接」，观察错误信息：

- **网络超时 / 连接拒绝**：确认服务地址正确、服务正在运行。
- **401 Unauthorized**：API Key 错误或无效。
- **404**：API 地址路径不对，检查是否需要加 `/v1` 后缀。

### Docker 容器内无法连接宿主机的 Ollama / 本地服务

Docker 容器内的 `localhost` 指向容器自身，不是宿主机。

- **macOS / Windows（Docker Desktop）**：将地址中的 `localhost` 或 `127.0.0.1` 改为 `host.docker.internal`，例如 `http://host.docker.internal:11434`。
- **Linux**：在 `compose.yaml` 中已添加 `extra_hosts: - "host.docker.internal:host-gateway"`，直接使用 `http://host.docker.internal:11434` 即可。

如果宿主机上的服务只监听 `127.0.0.1`（非 `0.0.0.0`），即使改了地址也可能连不上，需要将宿主机服务配置为监听所有接口，或使用网络转发。

### 代理环境下模型请求失败

应用使用 Node.js 内置 `fetch` 发送模型请求，标准环境变量 `HTTP_PROXY` / `HTTPS_PROXY` **不会自动影响** Node 的 `fetch`，需要额外配置代理支持（当前版本未内置）。

临时方案：如果条件允许，直接在网络层配置代理（系统代理或 TUN 模式），而不是通过应用层环境变量。

---

## Docker 问题

### `docker compose` 命令不存在

新版 Docker 使用 `docker compose`（有空格），旧版插件是 `docker-compose`（连字符）。建议升级到 Docker Compose V2。

### 构建时依赖下载很慢

受网络环境影响，可考虑配置 Docker 镜像源（`/etc/docker/daemon.json`），或在网络条件较好时构建。

### 容器启动后页面打不开

```bash
docker compose logs app
```

查看是否有错误。常见原因：

- 端口映射冲突（见启动问题中的端口占用）
- 数据卷权限问题（容器内无法写入数据库）

---

## 数据与迁移问题

### 数据库迁移失败

错误信息包含 `migrate` 或 `migration`。可能原因：

- 数据库文件损坏：恢复备份（见 [部署说明 · 升级与备份](deployment.md#升级与备份)）
- 降级到了旧版本但使用了新版数据库：同步回滚数据文件

### 数据文件路径

- 原生启动：`data/app.db`（相对项目根目录）
- Docker：命名卷 `live-chat-eval_lce_data`

### 健康检查

```bash
# 原生启动时
curl http://localhost:8787/api/health

# Docker
docker compose exec app curl http://localhost:8787/api/health
```

返回 `{"status":"ok","version":"0.1.0-rc.1"}` 表示服务正常。

---

## 仍未解决

请按 [验证清单与反馈模板](validation.md) 整理信息后反馈。
