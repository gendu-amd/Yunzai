# 本地测试 · 敏感信息存放位置与清理指南

> 用途：本地真机验证 P1/P2 时会绑定**真实米游社账号**（扫码/stoken），凭据会落在以下位置。
> **验证结束后务必按"一键清理"删除。** 这些都在本机/workspace 内，不会进 git（已核对，下方标注例外）。

## 一、凭据会写到哪里

### 1. SQLite 主库（最关键）
- 路径：`/mnt/workspace/gen/Yunzai/data/db/data.db`
- 内容：CK、stoken、device、各游戏 UID 绑定（genshin `MysUser`/`NoteUser`/`UserDB`）。
- ⚠️ **注意**：主仓库 `.gitignore` **未忽略 `data/`**。本仓库提交时**绝不要 `git add data/`**（我们只精确 add 改动代码文件）。

### 2. xiaoyao 插件数据（gitignored，安全）
- `/mnt/workspace/gen/Yunzai/plugins/xiaoyao-cvs-plugin/data/yaml/`  ← stoken
- `/mnt/workspace/gen/Yunzai/plugins/xiaoyao-cvs-plugin/data/yunToken/`  ← 云原神 token
- （`plugins/*` 已被 .gitignore，不会进 git）

### 3. 其他个人数据（非凭据，但属个人信息）
- `/mnt/workspace/gen/Yunzai/data/NoteCookie/`（体力 cookie，部分路径）
- `/mnt/workspace/gen/Yunzai/data/gachaJson/`、`data/srJson/`（抽卡记录）
- `/mnt/workspace/gen/Yunzai/data/payLog/`（充值记录）
- `/mnt/workspace/gen/Yunzai/data/stdin/`（stdin 适配器历史 + 二维码图片）

### 4. Redis（独立实例 6399，数据在 `.devenv/redis-data`）
- 键前缀：`Yz:genshin:mys:*`（uid 绑定）、`Yz:genshin:*url:*` / `Yz:genshin:payLog:*`（authkey）、`xiaoyao:*` 等。
- 注意：**系统 redis 6379 不碰**；我们只用 6399。

## 二、一键清理（验证结束后执行）

```bash
cd /mnt/workspace/gen/Yunzai

# 1) 删 SQLite 主库 + 个人数据目录
rm -rf data/db data/NoteCookie data/gachaJson data/srJson data/payLog data/stdin

# 2) 删 xiaoyao 凭据
rm -rf plugins/xiaoyao-cvs-plugin/data/yaml plugins/xiaoyao-cvs-plugin/data/yunToken

# 3) 清空我们的 6399 redis（仅 6399，不碰系统 6379）
redis-cli -p 6399 flushall    # 或者直接停掉 6399 实例并删 .devenv/redis-data

# 4) 确认无残留我们的 bot / 6399 进程
pkill -9 -f "node \." 2>/dev/null
pkill -9 -f "redis-server \*:6399" 2>/dev/null
```

> 若整个 `.devenv` 也不想留，直接 `rm -rf /mnt/workspace/gen/.devenv`（含 Node/pnpm/redis 数据），彻底清空。

## 三、清理核对
```bash
# 应全部不存在 / 无输出
ls data/db 2>/dev/null
redis-cli -p 6399 --scan --pattern "Yz:*" 2>/dev/null | head
ls plugins/xiaoyao-cvs-plugin/data/yaml 2>/dev/null
```

## 变更记录
- `2026-05-30` 创建：记录扫码登录验证期间的凭据落点与清理步骤。
