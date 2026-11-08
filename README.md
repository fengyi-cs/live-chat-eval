# live-chat-eval

直播间 AI 主播对话评估框架。需求见 [docs/requirements.md](docs/requirements.md)，架构见 [docs/architecture.md](docs/architecture.md)。

## 启动

需要 Node >= 22 和 pnpm。

```bash
pnpm install
pnpm start        # 构建前端并启动，打开 http://127.0.0.1:8787
```

开发模式（前端热更新，http://localhost:5173）：

```bash
pnpm dev
```

本地状态保存在 `data/app.db`（不进 git）。可用 `LCE_DB_PATH`、`PORT`、`HOST` 环境变量覆盖。

## 检查

```bash
pnpm test
pnpm typecheck
```

## 当前进度

- [x] md 聊天记录导入：解析发言人、选择角色、主播档案按名字识别、场次去重
- [x] 回复配对：关联弹幕、响应延迟、主动发言、动作挂接、未回应弹幕
- [ ] 模型接入（服务商、模型列表、对话）
- [ ] 主播人设与回复策略
- [ ] 单人 / 多人剧本模拟
- [ ] 规则分与 LLM 裁判评估
