# Docker 部署指南

本文档说明如何用 Docker 部署 **Polymarket WhaleWatch**（实时大额交易告警面板 + 内嵌告警引擎）。

## 架构概览

应用是一个 **Next.js 16** 服务，单进程内同时承担两件事：

- **Dashboard**：实时告警面板（HTTP）
- **告警引擎**：通过 `instrumentation.ts` 内嵌在 Next 进程里自动启动，无需单独的 worker 容器

数据存储为 **SQLite**（`better-sqlite3` 原生模块），引擎写入、面板读取同一个数据库文件。

```
┌─────────────────────────────────────────────┐
│  Docker 容器: polymarket-whalewatch           │
│                                               │
│   Next.js (:3000)                             │
│   ├─ Dashboard (HTTP)  ──┐                    │
│   └─ 内嵌告警引擎        ├─► /app/data/data.sqlite
│      (instrumentation)  ──┘     │             │
└──────────────────────────────── │ ────────────┘
                                   ▼
                        命名卷 whalewatch-data（持久化）
```

## 相关文件

| 文件 | 作用 |
|------|------|
| `Dockerfile` | 两阶段构建：`builder` 编译原生模块并 `next build`；`runner` 仅含运行所需文件 |
| `.dockerignore` | 排除宿主机的 `node_modules`、`.next`、`*.sqlite*`、`.env` 等 |
| `docker-compose.yml` | 服务编排：端口映射、数据卷、环境变量注入 |

## 前置要求

- Docker Engine 20.10+
- Docker Compose v2（`docker compose` 子命令）

## 快速开始

```bash
# 1. 准备环境变量（首次）
cp .env.example .env
# 按需编辑 .env

# 2. 构建并后台启动
docker compose up -d --build

# 3. 访问面板
open http://localhost:3007
```

## 常用命令

```bash
docker compose up -d --build   # 构建镜像并后台启动
docker compose up -d           # 用已有镜像启动
docker compose logs -f         # 实时查看日志
docker compose ps              # 查看容器状态
docker compose stop            # 停止容器（保留数据卷）
docker compose start           # 重新启动已停止的容器
docker compose restart         # 重启
docker compose down            # 停止并删除容器（数据卷保留）
docker compose down -v         # 停止并删除容器 + 数据卷（⚠️ 清空所有告警数据）
```

## 环境变量

`docker-compose.yml` 通过 `env_file: .env` 加载以下变量，并用 `environment:` 固定容器内的 `PORT` 与 `DASH_DB`。

| 变量 | 说明 | 默认 / 示例 |
|------|------|------|
| `TELEGRAM_BOT_TOKEN` | Telegram 机器人 token（可选） | 空 |
| `TELEGRAM_CHANNEL_ID` | Telegram 频道 id（可选） | 空 |
| `LARGE_THRESHOLDS` | 大额告警阈值（逗号分隔，USD） | `10000,50000` |
| `POLL_INTERVAL_MS` | 轮询间隔（毫秒） | `4000` |
| `PORT` | 容器内监听端口（由 compose 固定为 `3000`） | `3000` |
| `DASH_DB` | SQLite 路径（由 compose 固定指向数据卷） | `/app/data/data.sqlite` |

> **Telegram 是可选的**：`TELEGRAM_BOT_TOKEN` 和 `TELEGRAM_CHANNEL_ID` 必须**同时**非空才会推送；否则引擎运行在「仅记录到 SQLite」模式，告警只在面板展示。修改 `.env` 后执行 `docker compose up -d` 即可生效。

## 端口

容器内固定监听 `3000`，映射到宿主机 `3007`：

```yaml
ports:
  - "3007:3000"   # 宿主机:容器
```

如需换宿主机端口，只改左侧数字，例如 `- "8080:3000"`，然后 `docker compose up -d`。

## 数据持久化

SQLite 数据库存放在命名卷 `whalewatch-data`（挂载到容器 `/app/data`），容器重建/重启都不会丢数据。

```bash
# 查看卷
docker volume ls | grep whalewatch
docker volume inspect polymarket-whalewatch_whalewatch-data

# 备份数据库（容器需在运行中）
docker compose exec whalewatch \
  sh -c 'sqlite3 /app/data/data.sqlite ".backup /app/data/backup.sqlite"' 2>/dev/null \
  || docker cp polymarket-whalewatch:/app/data/data.sqlite ./backup-data.sqlite
```

### 导入已有的本地数据库

如果想保留宿主机根目录 `data.sqlite` 里的历史告警，把它拷进卷（容器需先存在）：

```bash
docker compose up -d
docker cp ./data.sqlite polymarket-whalewatch:/app/data/data.sqlite
docker compose restart
```

## 设计说明（为什么这么做）

- **原生模块必须在容器内重新编译**：`better-sqlite3` 是平台相关的原生模块。`.dockerignore` 排除了宿主机的 `node_modules`，`builder` 阶段用 `npm ci` 从 `package-lock.json` 在 Linux 环境重新编译，避免「macOS 二进制在 Linux 跑不起来」。
- **单容器**：告警引擎随 Next 进程通过 `instrumentation.ts` 自动启动，因此不需要独立的 worker 容器。
- **两阶段构建**：`builder` 含编译工具链（python3 / make / g++）与构建产物，`runner` 仅复制运行所需文件，镜像更小。

## 故障排查

| 现象 | 处理 |
|------|------|
| 面板打不开 | `docker compose logs -f` 看是否报错；确认宿主机端口未被占用 |
| 看不到新告警 | 日志若出现 `telegram=off (records to SQLite only)` 属正常；确认网络可访问 Polymarket API |
| 数据丢失 | 检查是否误用了 `docker compose down -v`（会删卷）；用命名卷而非 bind mount |
| 改了 `.env` 不生效 | 环境变量在容器启动时注入，需 `docker compose up -d` 重建容器 |
| 改了代码不生效 | 需重新构建：`docker compose up -d --build` |
