# 架构说明

> 本文描述已实现的结构。设计变更时同步修改本文。

## 技术栈

| 层 | 选型 |
|---|---|
| 仓库 | pnpm workspace monorepo，TypeScript |
| 后端 | Node + Hono；SSE 推送模型流式输出、直播间事件、评估进度 |
| 存储 | SQLite（better-sqlite3）+ Drizzle ORM，默认 `data/app.db`（`LCE_DB_PATH` 可改） |
| 校验 | zod（API 入参、评分模板） |
| 前端 | React + Vite + Tailwind CSS v4；shadcn/ui（17 个组件）；dnd-kit（剧本拖排）；TanStack Query（服务端数据）；react-router v8（URL 路由）；页面本地状态用 `usePersistentState`（localStorage） |
| 测试 | Vitest |

## 目录

```
live-chat-eval/
├─ apps/
│  ├─ server/src/
│  │  ├─ db/          # schema 与连接；迁移在 apps/server/drizzle（drizzle-kit 生成）
│  │  ├─ services/    # 业务逻辑：imports / providers / anchors / scripts / sims / rubrics / evals
│  │  └─ routes/      # Hono 路由，薄封装 services
│  └─ web/src/
│     ├─ components/  # 通用组件：ModelPicker、ScorePill、GuidedTour、HintBubble
│     │  └─ ui/       # shadcn/ui 组件（badge、button、checkbox、command、dialog、
│     │               #   dropdown-menu、input、label、popover、scroll-area、select、
│     │               #   separator、sheet、switch、tabs、textarea、tooltip）
│     └─ pages/       # 页面组件（LiveRoom、EvalsPage、RubricsPage、ProvidersPage）
│                     # 及对话框/表单（AnchorDialog、ConfigEditor、ConfigSheet、
│                     #   ImportSheet、ScriptSheet、SessionSheet、SessionView、
│                     #   SessionsPage、TrialPanel、MessageBubble）
│                     # 直播间子组件（room/）
├─ packages/core/src/ # 纯逻辑，不读写数据库
│  ├─ importers/      # md 聊天记录解析、角色推荐
│  ├─ pairing/        # 回复配对、延迟、主动发言、动作挂接
│  ├─ providers/      # 模型适配器（OpenAI 兼容 / Anthropic / Gemini / Ollama）与地址识别
│  ├─ anchor/         # 回复策略决策、主播提示词组装
│  ├─ runtime/        # 剧本解析、虚拟/真实时钟、直播间模拟引擎、模型选弹幕
│  └─ eval/           # 评分模板、规则基础分、裁判提示词与解析重试、汇总
├─ fixtures/          # 脱敏样例聊天记录
├─ scripts/           # 交付脚本（launcher、doctor、smoke）
└─ docs/
```

## 数据模型

| 表 | 内容 |
|---|---|
| `providers` | 服务商：类型、base_url、api_key（接口只返回掩码）、模型列表缓存、默认模型 |
| `anchors` | 主播档案：name 为主键、编号、人设 prompt |
| `anchor_configs` | 主播配置：模型、温度、上下文轮数、回复要求、主动发言提示、回复策略参数 |
| `speaker_roles` | 发言人 → 角色的记忆 |
| `scripts` | 弹幕剧本原文与默认间隔 |
| `sessions` | 会话：来源（import / live / script）、状态（done / running / stopped / error）、配置快照 |
| `messages` | 消息：角色、时间、正文、回应的弹幕、延迟、主动发言、动作、生成耗时 |
| `rubrics` | 评分模板（整份模板存为 JSON） |
| `evals` | 一次评估：会话、模板快照、裁判模型、状态、规则分结果、汇总、调用次数 |
| `eval_items` | 评估条目：每条主播发言一项、整场一项；状态、各维度分数与理由、调用次数 |

快照原则：会话保存开播时的配置快照，评估保存当时的模板快照。之后修改或删除配置、模板，旧数据不变。

## 直播间模拟

- 引擎 `LiveRoomEngine` 只依赖 `SimClock`：剧本模式用虚拟时钟（倍速 / 跳过等待 / 单步，可随时切换），单人模式用真实时间。
- 循环：放入到点的弹幕 → `decideReply` 决定回复、主动发言或等待 → 生成 → 记录。模型调用耗时按实际毫秒计入虚拟时间。
- 生成期间到达的弹幕先排队，记录顺序排在这次回复之前，等这次回复完成后再处理。
- 服务端 `SimulationManager` 负责落库与 SSE 广播；重连时先发 `hello` 和已有事件。服务重启后，`running` 的会话标为 `stopped`。

## 评估流水线

```
会话 → 规则基础分（同步计算） → 规划条目（每条主播发言 + 整场）
     → 逐条调用裁判（串行，JSON 解析失败把错误回给模型重试，可多次打分取平均）
     → 每完成一条就更新汇总并经 SSE 推送 → 综合指数
```

- 没有启用 LLM 维度的模板，评估立刻完成，不调用模型。
- 停止时，未打分的条目保持 `pending`；服务重启后，`running` 的评估标为 `stopped`。

## 扩展点

- 新服务商（如公司自有大脑）：实现 `ProviderAdapter` 并注册。
- 新回复逻辑：替换或扩展 `decideReply`，或在引擎外接适配器。
- 新聊天记录格式：在 `importers/` 加一个解析器。
- 对比实验：同一剧本 × 多套 `anchor_configs` × `evals`，数据结构已支持，界面未做。
