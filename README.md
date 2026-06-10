# smardydy

本地定时任务 + Agent 自动化中枢（Windows）。对标 Codex app 的 Automations：既能纯规则地定时执行脚本，也能把自然语言指令交给 agent 执行（执行命令、判断结果、修复脚本后重试、提交结构化简报）。完全本地、自托管，模型供应商可自定义（Anthropic / OpenAI 两种兼容协议，如智谱 BigModel coding plan）。

## 架构

```
┌─ 托盘守护 (tray/smardydy-tray.ps1)        开机自启入口
│   拉起并监控 daemon，绿/红图标，掉线弹通知并自动重启（最多5次）
│
└─ daemon (src/daemon, Bun + TS)            http://127.0.0.1:8787
    ├─ scheduler   cron / 固定间隔 / 启动时触发；补跑策略；重叠跳过
    ├─ runner      script: PowerShell 执行 + 重试 + 超时
    │              agent:  自研 agent loop（双协议 provider）
    │                      工具: run_command / read_file / write_file / update_memory / report
    ├─ memory      简报即记忆：每次运行简报自动沉淀，下次运行注入；agent 可写长期备忘
    ├─ notify      飞书群机器人 webhook / 本机 lark-cli / Server酱 / Windows toast
    ├─ api         REST（docs/api-contract.md）+ webhook 触发（带 token）
    └─ 静态托管 web/dist
web/  React + Vite + antd 中文管理界面
data/ smardydy.db（SQLite）、logs/（运行日志与 agent 轨迹）、tray.log
```

## 使用

```powershell
bun install && bun run --cwd web install   # 首次
bun run build:web                          # 构建前端
.\scripts\install-autostart.ps1            # 注册开机自启并启动托盘（托盘会拉起 daemon）
```

打开 http://127.0.0.1:8787 ：

1. 「Provider」页添加模型供应商（如智谱 anthropic 协议：baseUrl `https://open.bigmodel.cn/api/anthropic`）；
2. 「通知渠道」页按需添加渠道并测试；
3. 「任务」页新建任务：script 填 PowerShell 命令；agent 填自然语言指令，配置调度、补跑策略、资源上限（最大轮数/超时）、记忆注入和通知绑定。

开发：`bun run daemon` 起后端，`bun run dev:web` 起前端（Vite 已代理 API）。

## 行为约定

- 调度为本地时区；同一任务上次还在跑时到点自动跳过本次。
- 「错过补跑」：daemon 启动/休眠唤醒后，错过超过 10 分钟的调度按任务的补跑策略处理（run_once 补一次 / skip 跳过），同一周期只补一次。
- agent 任务结束必须提交 report（success/summary/details），简报自动写入任务记忆；记忆在 Web UI 任务详情页可查看、可删除。
- 运行历史每任务保留最近 200 条；daemon 重启会把遗留 running 状态标记为失败。

## 注意

- `tray/` 和 `scripts/` 下的 .ps1 必须保存为 **UTF-8 with BOM**（Windows PowerShell 5.1 否则会把中文读成乱码导致解析失败）。
- daemon 仅监听 127.0.0.1；webhook 触发需任务级 token（header `X-Token` 或 query `?token=`）。
- 本地健康探活已显式禁用系统代理（代理会把"连接被拒"包装成 502）。
- `test/mock-llm.ts`：本地 mock LLM（双协议），用于不耗 API 额度地端到端测试 agent loop。
