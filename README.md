# live-chat-eval

直播间 AI 主播对话评估框架。需求见 [docs/requirements.md](docs/requirements.md)，架构见 [docs/architecture.md](docs/architecture.md)，开发工作流见 [docs/workflow.md](docs/workflow.md)。

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
- [x] 模型接入：服务商配置、自动识别接口格式（多格式探测）、可搜索多选模型池、手动添加模型、流式测试对话
- [x] 主播配置：人设上传 / 在线编辑、编号与来源字段（导入 / 手建）、回复配置与主播解耦（任意主播可用）
- [x] 单人实时 / 多人弹幕剧本模拟：剧本编辑与解析预览、实时 / 倍速 / 跳过等待 / 单步回放、回复策略与模型选弹幕生效、会话自动保存
- [x] 评估：规则基础分 + LLM 裁判逐条 / 整场打分、可编辑评分模板、综合指数报告
- [x] 实时评估：直播中开启后每条主播回复自动打分，分数气泡展示在消息上
- [x] 导航重构：4 个顶层页面（直播间 / 评估分析 / 评分标准 / 设置），URL 路由，直播间内子页切换
- [x] 前端基础组件：shadcn/ui（17 个组件）、dnd-kit、react-router、模型池选择器
- [x] 视觉美化：消息气泡重设计（头像、打字动效、入场动画）、评分颜色编码、直播状态脉冲点、按钮平滑过渡、毛玻璃 header
