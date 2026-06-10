# smardydy HTTP API 契约

daemon 监听 `http://127.0.0.1:8787`。所有 `/api/*` 返回 JSON；错误返回 `{ "error": string }` 配合 4xx/5xx 状态码。
类型定义见 `src/shared/types.ts`（前端复制为 `web/src/types.ts`）。

## 健康检查
- `GET /health` → `Health`

## 任务
- `GET /api/tasks` → `Task[]`
- `POST /api/tasks` body=`TaskInput` → `Task`（201）
- `GET /api/tasks/:id` → `Task`
- `PUT /api/tasks/:id` body=`TaskInput` → `Task`
- `DELETE /api/tasks/:id` → `{ ok: true }`
- `POST /api/tasks/:id/run` → `{ runId: number }`（手动立即运行；若任务正在运行返回 409）
- `GET /api/tasks/:id/runs?limit=50` → `Run[]`（按时间倒序）
- `GET /api/tasks/:id/memory` → `MemoryEntry[]`（倒序）

## 运行
- `GET /api/runs?limit=50` → `Run[]`（全部任务，倒序）
- `GET /api/runs/:id` → `RunDetail`（含 log / transcript）

## 记忆
- `DELETE /api/memory/:id` → `{ ok: true }`

## Provider
- `GET /api/providers` → `Provider[]`
- `POST /api/providers` body=`ProviderInput` → `Provider`
- `PUT /api/providers/:id` body=`ProviderInput` → `Provider`
- `DELETE /api/providers/:id` → `{ ok: true }`
- `POST /api/providers/:id/test` → `{ ok: boolean, reply?: string, error?: string }`（发一条最小对话验证连通）

## 通知渠道
- `GET /api/channels` → `Channel[]`
- `POST /api/channels` body=`ChannelInput` → `Channel`
- `PUT /api/channels/:id` body=`ChannelInput` → `Channel`
- `DELETE /api/channels/:id` → `{ ok: true }`
- `POST /api/channels/:id/test` → `{ ok: boolean, error?: string }`（发送测试消息）

## Webhook 外部触发
- `POST /hook/:taskId`，鉴权：header `X-Token: <task.webhookToken>` 或 query `?token=`
  → `{ runId: number }`；token 错误 401；任务未启用 webhook 404。

## 约定
- 时间一律 ISO 8601 字符串。
- daemon 同时托管 `web/dist` 静态文件（生产模式）；开发时前端用 Vite 代理 `/api`、`/health`、`/hook` 到 8787。
- CORS 已放开（仅监听 127.0.0.1）。
