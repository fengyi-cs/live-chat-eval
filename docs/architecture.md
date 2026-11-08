# 架构说明

## 技术栈

| 层 | 选型 |
|---|---|
| 仓库 | pnpm workspace monorepo，TypeScript |
| 后端 | Node + Hono，SSE 推送流式输出与评估进度 |
| 存储 | SQLite（better-sqlite3）+ Drizzle ORM，`data/app.db` |
| 校验 | zod（导入数据、API 入参、裁判 JSON 输出） |
| 前端 | React + Vite + Tailwind + shadcn/ui |
| 前端状态 | TanStack Query（服务端数据）+ Zustand（页面状态） |
| 图表 | Recharts |
| 测试 | Vitest |

## 目录

```
live-chat-eval/
├─ apps/
│  ├─ server/            # Hono API、SSE、数据库、评估任务
│  └─ web/               # React 前端
├─ packages/
│  └─ core/              # 纯领域逻辑，无 IO，可单测
│     └─ src/
│        ├─ domain/      # 类型：会话、消息、主播、剧本、评分
│        ├─ importers/   # md 聊天记录解析
│        ├─ pairing/     # 回复配对、主动发言、延迟、动作挂接
│        ├─ runtime/     # 剧本时间轴回放（实时/加速/单步）
│        ├─ strategies/  # 回复策略接口与内置策略、可调参数
│        ├─ providers/   # 模型适配器：openai 兼容/anthropic/gemini/ollama/自有大脑
│        └─ eval/        # rules / rubric / judge prompt / aggregate
├─ fixtures/             # 脱敏样例
├─ data/                 # 本地状态（gitignore）
└─ docs/
```

## 数据模型

| 表 | 内容 |
|---|---|
| `providers` | 服务商：类型、base_url、api_key |
| `anchors` | 主播档案：**name 为主键**、编号、别名、人设 prompt、性格 |
| `anchor_configs` | 可运行配置：主播 + 模型 + 策略及参数（对比实验在此层扩展） |
| `speaker_roles` | 发言人名 → 角色（主播/观众/动作/忽略）的记忆 |
| `sessions` | 会话：来源（导入/单人/剧本）、场次 ID、主播、时间 |
| `messages` | 消息：发言人、角色、时间、正文、回应的弹幕 id、延迟、是否主动、挂接动作 |
| `scripts` | 多人弹幕剧本 |
| `rubrics` | 评分模板：维度（名称、细则、1-5 锚点、权重、粒度） |
| `eval_runs` | 评估任务：会话、模板快照、裁判模型、状态 |
| `turn_scores` / `session_scores` | 分数：维度、分值、理由、来源（rule/llm） |

## 评估流水线

```
会话 → 配对 → 规则分 → 按模板拼裁判 prompt
     → 逐条打分（并发、结构化 JSON、zod 校验、失败重试）
     → 整场打分 → 加权汇总 0-100 → 报告
```

进度通过 SSE 推送到前端。

## 扩展点

- `ReplyStrategy`：外部回复逻辑以适配器形式接入。
- `ModelProvider`：公司自有大脑实现同一接口即可。
- `Importer`：新聊天记录格式加一个解析器。
