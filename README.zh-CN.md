# Agendum

[English](README.md) | 中文

Agendum 是一个 Windows 本地的定时 Agent 自动化控制台。

灵感来自 Codex app 的 Automations：当一个工作流已经打磨稳定，就不该再反复消耗稀缺的高级模型额度去跑它。Agendum 让你把这些已经验证过的自动化 prompt 粘贴进本地调度器，接上更便宜的模型供应商，以可重复任务的形式运行——带日志、记忆、通知、重试和灵活的执行规则。

名字来自拉丁语：**agendum** 意为"待办之事"，与 **agent** 同根，都源自 *agere*（行动）。一个词说完整个产品：要做的事，和替你做事的 agent。

## 为什么做这个

Codex app 的自动化之所以好用，是因为它把重复性工作变成了可靠的循环：醒来、检查上下文、执行命令、对失败做推理、提交简报。

痛点是额度和成本。Plus 档的容量对"已经稳定的例行工作流"来说太奢侈了。Agendum 瞄准的是中间地带：

- 保留 Codex 式自动化的形态；
- 在自己的机器上本地运行；
- 接 OpenAI 兼容或 Anthropic 兼容的低成本 provider；
- 直接粘贴你在 Codex 里已经验证过的自动化 prompt；
- 补上更柔性的执行行为：重试、记忆注入、补跑策略、通知。

它不是要替代探索性的 Codex 工作，而是去跑那些 Codex 帮你结晶出来的工作流。

## 功能

- **脚本任务**：按计划执行 PowerShell 命令，支持超时、重试、工作目录与环境变量。
- **Agent 任务**：自然语言指令交给本地 agent loop 执行——可以跑命令、读写文件、更新任务记忆、提交结构化简报。
- **Provider 降级链**：任务级有序备用 provider，主 provider 调用失败后运行中途自动切换。
- **对话式建任务**：右侧拉手唤起对话面板，模型一次只问一个问题（单选/多选/文本）补全需求，生成配置草稿回填表单，人工核对后创建；随时可「直接生成」跳过问询。
- **运行控制**：运行详情页可取消进行中的运行，正在执行的命令立即终止。
- **升级告警**：连续失败达 N 次才通知（恢复前不再重复），从连败恢复时另行通知。
- **Token 统计**：agent 任务按次记录输入/输出 token，任务页展示累计。
- **调度**：cron 规则、固定间隔、法定工作日时刻、启动触发、手动运行、webhook 触发。
- **补跑策略**：错过的计划可选补跑一次（run_once）或跳过（skip）。
- **记忆**：每次 agent 简报可沉淀为任务记忆，注入后续运行。
- **Provider**：支持 Anthropic 兼容与 OpenAI 兼容两套协议，内置常见预设。
- **通知**：飞书群机器人 webhook、lark-cli 命令模板、Server酱、Windows toast。
- **网络代理**：统一开关 + 分项（GitHub 流量 / Agent 调用），provider 级可单独覆盖。
- **开机自启**：设置页一键开关当前用户的 Windows 自启。
- **运行证据**：运行历史、脚本日志、agent 执行轨迹、简报、失败原因、记忆条目。
- **本地优先**：daemon 只监听 `127.0.0.1`，数据存本地 SQLite。

## 架构

```text
tray/smardydy-tray.ps1
  Windows 托盘守护。拉起并监控 daemon、显示健康状态、
  掉线自动重启、双击打开本地管理界面。

src/daemon
  Bun + TypeScript 常驻 daemon，http://127.0.0.1:8787
  - scheduler：cron / 间隔 / 启动 / webhook / 补跑
  - runner/script：PowerShell 命令执行
  - runner/agent：模型循环、工具调用、记忆、结构化简报
  - notify：飞书、lark-cli、Server酱、Windows toast
  - api：REST API 与 Web UI 静态托管

web
  React + Vite + Ant Design 管理界面。

data
  本地运行数据：SQLite 数据库、运行日志、agent 轨迹、节假日缓存。
```

## 隐私与本地数据

API Key、任务配置、webhook token、通知密钥、运行记录、日志、agent 轨迹都存在 `data/smardydy.db` 和 `data/logs/`，已被 git 刻意忽略：

- `data/*.db`、`data/*.db-*`
- `data/logs/`、`data/tray.log`
- `.env*`
- `node_modules/`、`web/dist/`、`build/`、`release/`

打包或公开发布前先跑审计：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\audit-private-data.ps1
```

审计会检查数据库、运行记录、依赖目录、构建产物、env 文件、高置信度密钥特征是否被 git 跟踪，以及所有 `.ps1` 是否带 UTF-8 BOM。

## 开发快速开始

环境要求：Windows、Bun、PowerShell 5.1+。

```powershell
bun install
bun run --cwd web install

# 开发运行
bun run daemon
bun run dev:web
```

打开 `http://127.0.0.1:8787`。

构建 Web UI：

```powershell
bun run build:web
```

为当前 checkout 注册 / 取消托盘开机自启：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-autostart.ps1
```

## 首次运行

1. 打开 `http://127.0.0.1:8787`。
2. 进 **Provider** 添加模型供应商。
   - Anthropic 兼容示例：`https://open.bigmodel.cn/api/anthropic`
   - OpenAI 兼容示例：`https://api.openai.com/v1`
3. 需要通知就进 **通知渠道** 配置。
4. 进 **任务** 新建任务：确定性的 PowerShell 作业用 `script`，灵活的自然语言工作流用 `agent`。
5. 配好调度、补跑、超时、记忆注入和通知绑定。
6. 想让 Agendum 随 Windows 登录自动运行，去 **设置** 打开开机自启。

把一段在 Codex 里已经稳定的自动化 prompt 粘进 agent 任务，让 Agendum 按你的节奏跑它。

## 网络代理

**设置 → 网络代理**：一个代理地址 + 总开关 + 两个分项——**GitHub 流量**（更新检查/下载、`git fetch/pull`、节假日数据）与 **Agent 调用**。每个 provider 还可以单独覆盖（跟随全局 / 强制走代理 / 强制直连），国内 provider 直连、国外 provider 走代理可以共存。通知渠道恒直连。git 不继承程序内代理，网络型 git 命令会自动注入 `-c http(s).proxy`。

## 备份与恢复

**设置 → 备份与恢复** 把全部状态导出为一个很小的 `agendum-backup-<时间戳>.json.gz`：任务（含 webhook token）、provider（**含 API Key，注意保管文件**）、通知渠道、运行历史记录、任务记忆、全部设置项（含代理配置）。磁盘上的运行日志与可重新拉取的节假日缓存不包含在内。

导入为整体覆盖：单事务清空重建并刷新调度。备份带 schema 版本校验，旧备份可以导入更新的 Agendum。

## Windows 安装包

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-windows-installer.ps1 -Version 0.1.3
```

产出 `release\AgendumSetup-0.1.3.exe`，包含编译好的 `agendum-daemon.exe`、构建好的 Web UI、托盘脚本、自启脚本和节假日缓存。**不包含**你的本地数据库、API Key、任务配置、日志和记忆。

没装 Inno Setup 时脚本只产出暂存目录 `build\windows\Agendum`，装好后重跑即可：<https://jrsoftware.org/isdl.php>

## 用 GitHub Actions 发版

不需要在本地打包。推一个版本 tag，GitHub 全部代劳：

1. 改 `package.json` 的 `version`（daemon 的 `/health` 会上报这个版本）。
2. 提交后打 tag 推送：

```powershell
git tag v0.2.0
git push origin master --tags
```

`Release` workflow 在 `windows-latest` 上编译 daemon、构建 Web UI、用 Inno Setup 产出 `AgendumSetup-<version>.exe` 并挂到 GitHub Release；tag 与 `package.json` 版本不一致会直接失败。`CI` workflow 在每次 push 时跑 daemon typecheck、web 构建，以及"所有 `.ps1` 必须带 UTF-8 BOM"的守门检查（Windows PowerShell 5.1 会把无 BOM 文件按 ANSI 解析，中文直接碎掉）。

## 软件更新

更新严格手动：daemon 从不主动联网检查。**设置 → 软件更新**，点 **检查更新**，确认后点 **立即更新**。

机制按运行模式自动区分（设置页会显示当前模式）：

- **安装版（编译 exe）**：检查最新 GitHub Release，下载 `AgendumSetup-*.exe`，移交给独立更新器——停托盘和 daemon、静默安装、由安装器把一切拉回来。
- **源码运行（`bun run`）**：检查落后 `origin` 多少提交，然后 `git pull --ff-only`、重装依赖、重建 Web UI、重启 daemon。

有任务正在运行时拒绝更新。仓库是 public 的，更新检查走匿名 GitHub API，不需要任何凭据。

## API

见 [docs/api-contract.md](docs/api-contract.md)。常用端点：

- `GET /health`
- `GET /api/tasks` / `POST /api/tasks` / `POST /api/tasks/:id/run`
- `GET /api/runs` / `GET /api/runs/:id`
- `GET /api/backup/export` / `POST /api/backup/import`
- `POST /hook/:taskId`

webhook 触发需要任务级 token：`X-Token` 请求头或 `?token=`。

## 行为约定

- 调度使用本地时区。
- 任务还在运行时下一次触发到来，新一轮直接跳过。
- daemon 重启后，上个进程遗留的 running 状态记录会标记为失败。
- 运行历史按任务保留上限自动裁剪。
- agent 任务应以结构化简报收尾；简报可注入后续运行作为任务记忆。
- daemon 只监听 `127.0.0.1`。

## 项目状态

Agendum 是一个本地个人自动化工具，当前关注点：

- 健壮的 Windows 打包；
- 可靠的定时执行；
- 低成本 provider 兼容；
- 把验证过的 Codex 自动化 prompt 顺滑迁移进来；
- 清晰的运行证据与记忆管理。
