# Agendum

Agendum is a local scheduled-agent automation console for Windows.

It is inspired by the automation experience in Codex app: once a workflow has become stable, you should not have to spend scarce premium-model quota running the same thing again and again. Agendum lets you paste those hardened automation prompts into a local scheduler, connect cheaper model providers, and run them as repeatable tasks with logs, memory, notifications, retries, and flexible execution rules.

The name comes from Latin: **agendum** means "a thing to be done". It shares the same root as **agent**, from *agere*, "to act". That is the product in one word: things to be done, and agents that do them.

## Why This Exists

Codex app automations are useful because they turn recurring work into a reliable loop: wake up, inspect context, run commands, reason about failures, and report back.

The pain point is quota and cost. Plus-plan capacity can be too limited for routine, already-solid workflows. Agendum is built for the middle ground:

- keep the Codex-style automation shape;
- run the work locally on your own machine;
- use lower-cost OpenAI-compatible or Anthropic-compatible providers;
- paste in automation prompts you have already proven in Codex;
- add softer execution behavior, such as retries, memory injection, catch-up rules, and notifications.

It is not meant to replace exploratory Codex work. It is meant to run the workflows that Codex helped you crystallize.

## What It Does

- **Script tasks**: run PowerShell commands on a schedule, with timeout, retries, working directory, and environment variables.
- **Agent tasks**: run natural-language instructions through a local agent loop that can execute commands, read/write files, update task memory, and submit structured reports.
- **Scheduling**: cron rules, fixed intervals, legal workday times, startup triggers, manual runs, and webhook triggers.
- **Flexible catch-up**: choose whether a task should run once after missed schedules or skip missed runs.
- **Memory**: each agent report can become task memory and be injected into future runs.
- **Providers**: configure model providers using Anthropic-compatible or OpenAI-compatible protocols.
- **Notifications**: Feishu/Lark webhook, lark-cli command templates, ServerChan, and Windows toast notifications.
- **Run evidence**: inspect run history, script logs, agent transcripts, summaries, failures, and memory entries.
- **Local-first**: daemon listens on `127.0.0.1` and stores data in a local SQLite database.

## Architecture

```text
tray/smardydy-tray.ps1
  Windows tray supervisor. Starts and monitors the daemon, shows health,
  auto-restarts on failure, and opens the local UI.

src/daemon
  Bun + TypeScript daemon on http://127.0.0.1:8787
  - scheduler: cron, interval, startup, webhook, catch-up
  - runner/script: PowerShell command execution
  - runner/agent: model loop, tool calls, memory, structured report
  - notify: Feishu/Lark, lark-cli, ServerChan, Windows toast
  - api: REST API and static web UI hosting

web
  React + Vite + Ant Design management UI.

data
  Local runtime data: SQLite database, run logs, agent transcripts, holiday cache.
```

## Privacy And Local Data

Local API keys, configured tasks, webhook tokens, notification secrets, run records, logs, and agent transcripts live in `data/smardydy.db` and `data/logs/`.

Those files are intentionally ignored by git:

- `data/*.db`
- `data/*.db-*`
- `data/logs/`
- `data/tray.log`
- `.env*`
- `node_modules/`
- `web/dist/`
- `build/`
- `release/`

Before packaging or publishing, run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\audit-private-data.ps1
```

The audit checks that local databases, run records, dependency folders, build outputs, env files, and high-confidence secret patterns are not tracked.

## Quick Start For Development

Requirements:

- Windows
- Bun
- PowerShell 5.1 or later

Install dependencies:

```powershell
bun install
bun run --cwd web install
```

Run in development:

```powershell
bun run daemon
bun run dev:web
```

Open:

```text
http://127.0.0.1:8787
```

Build the web UI:

```powershell
bun run build:web
```

Install tray autostart for the current checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-autostart.ps1
```

Remove tray autostart:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall-autostart.ps1
```

## First Run

1. Open `http://127.0.0.1:8787`.
2. Go to **Provider** and add a model provider.
   - Anthropic-compatible example: `https://open.bigmodel.cn/api/anthropic`
   - OpenAI-compatible example: `https://api.openai.com/v1`
3. Go to **通知渠道** and add notification channels if needed.
4. Go to **任务** and create a task.
   - Use `script` for deterministic PowerShell jobs.
   - Use `agent` for flexible natural-language workflows.
5. Configure schedule, catch-up behavior, timeout, memory injection, and notification rules.

You can paste a stable Codex automation prompt into an Agent task and let Agendum run it on your own cadence.

## Windows Installer

Agendum can be packaged into a Windows installer exe.

Build staging files and the installer:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-windows-installer.ps1 -Version 0.1.0
```

Output:

```text
release\AgendumSetup-0.1.0.exe
```

The installer includes:

- compiled `agendum-daemon.exe`;
- built `web/dist` UI;
- tray supervisor script;
- autostart install/uninstall scripts;
- holiday data cache.

It does **not** include your local database, API keys, configured tasks, run logs, or memory records.

If Inno Setup is missing, the build script will generate:

```text
build\windows\Agendum
```

Then install Inno Setup and rerun the script:

```text
https://jrsoftware.org/isdl.php
```

## API

See [docs/api-contract.md](docs/api-contract.md).

Important endpoints:

- `GET /health`
- `GET /api/tasks`
- `POST /api/tasks`
- `POST /api/tasks/:id/run`
- `GET /api/runs`
- `GET /api/runs/:id`
- `POST /hook/:taskId`

Webhook triggers require the task-level token via `X-Token` header or `?token=`.

## Behavior Notes

- Schedules use local time.
- If a task is still running when the next trigger arrives, the new run is skipped.
- On daemon restart, stale running records are marked as failed.
- Run history is pruned per task.
- Agent tasks should end with a structured report. Reports can be injected into later runs as task memory.
- The daemon listens only on `127.0.0.1`.

## Project Status

Agendum is a local personal automation tool. The current focus is:

- robust Windows packaging;
- reliable scheduled execution;
- cheaper-provider compatibility;
- convenient migration of proven Codex automation prompts;
- clear run evidence and memory management.
