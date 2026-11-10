# live-chat-eval

直播间 AI 主播对话评估框架。导入或实时模拟直播对话，对主播回复做规则评分与 LLM 裁判评分，生成综合报告。

版本：v0.1.0-rc.1 · [使用指南](docs/guide.md) · [部署说明](docs/deployment.md) · [故障排查](docs/troubleshooting.md)

---

## 快速开始

### 方式一：本地 Node 启动（推荐技术用户）

需要 [Node.js >= 22 LTS](https://nodejs.org/) 和网络（首次安装依赖时）。

```bash
# 克隆仓库后，在项目根目录运行
node scripts/launcher.mjs
```

脚本会自动检测环境、安装 pnpm 和依赖、构建前端、启动服务，并打印访问地址。

环境诊断：

```bash
node scripts/doctor.mjs
```

### 方式二：Docker Compose（推荐非 Node 用户 / 隔离环境）

需要 [Docker Desktop](https://www.docker.com/products/docker-desktop/)（Windows / macOS）或 Docker Engine + Compose（Linux）。

```bash
# 首次启动（需要构建镜像，约 2-5 分钟）
docker compose up --build

# 之后启动
docker compose up -d

# 停止
docker compose down
```

启动后打开：**http://localhost:8787**

---

## 配置

复制 `.env.example` 为 `.env`，根据需要修改端口或数据路径：

```bash
cp .env.example .env
```

端口和数据路径默认值已可直接使用，不修改也能正常启动。模型服务的 API Key 在应用内的设置页面配置，不在 `.env` 中。

---

## 数据

- 本地数据存储在 `data/app.db`（原生启动）或 Docker 命名卷 `lce_data`（Compose 启动）
- 首次启动自动建表并写入预设主播、配置和剧本
- 升级前请先备份 `data/` 目录，详见 [部署说明 · 升级与备份](docs/deployment.md#升级与备份)

---

## 检查

```bash
pnpm test        # 单元测试
pnpm typecheck   # 类型检查
```

---

## 文档

| 文档 | 说明 |
|------|------|
| [docs/guide.md](docs/guide.md) | 首次使用、两条主要任务路径 |
| [docs/deployment.md](docs/deployment.md) | Docker、原生安装、配置、升级、备份 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 常见问题与诊断 |
| [docs/validation.md](docs/validation.md) | 验证者功能清单与反馈模板 |
| [docs/architecture.md](docs/architecture.md) | 技术架构（开发者阅读）|
| [CHANGELOG.md](CHANGELOG.md) | 版本历史 |

---

## 当前进度（v0.1.0-rc.1）

- [x] 聊天记录导入：解析发言人、选择角色、主播档案按名字识别、场次去重
- [x] 回复配对：关联弹幕、响应延迟、主动发言、动作挂接、未回应弹幕
- [x] 模型接入：服务商配置、自动识别接口格式（OpenAI 兼容 / Anthropic / Gemini / Ollama）、流式测试
- [x] 主播配置：人设上传 / 在线编辑、回复配置与主播解耦
- [x] 单人实时 / 多人弹幕剧本模拟：剧本编辑、实时 / 倍速 / 单步回放、会话自动保存
- [x] 评估：规则基础分 + LLM 裁判逐条 / 整场打分、可编辑评分模板、综合指数报告
- [x] 实时评估：直播中每条主播回复自动打分，分数气泡展示
- [x] 导航：4 个顶层页面（直播间 / 评估分析 / 评分标准 / 设置），URL 路由
