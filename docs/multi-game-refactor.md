# 多游戏架构重构 — 结论与状态

> 目标：把"原神 / 崩坏星穹铁道 / 绝区零（gs / sr / zzz）"的触发逻辑统一、游戏差异收敛为**配置驱动**，
> 让"加新游戏 ≈ 加一份配置 + 一份数据"，而非到处 `if 原神/崩铁` 分支。zzz 当前不实现功能、仅留扩展位。
>
> 触发契约（定死）：`#`=原神(gs)、`*`/`星铁`=崩铁(sr)、`%`/`绝区零`=zzz。命令正则一律游戏无关，游戏只由 `e.game` 决定。

---

## 1. 功能 × 游戏支持矩阵（现状）

| 功能家族 | gs | sr | zzz | 实现 |
|------|:--:|:--:|:--:|------|
| 抽卡记录/分析/导入导出/统计 | ✅ | ✅* | ❌ | genshin `gachaLog/exportLog/logCount`（*sr 抽卡 authkey 见 §3） |
| 札记/星琼月历 | ✅ | ✅ | ❌ | genshin `ledger` |
| 体力实时便笺 | ✅ | ✅ | ⚠️独立 | genshin `dailyNote`(gs/sr) + 独立 `noteZzz`；另见 §4.1 双渲染器 |
| 充值/消费记录 | ✅ | ❌ | ❌ | `payLog` 写死 hk4e（**唯一真功能缺口**） |
| 养成/伤害计算 | ✅ | ✅ | ❌ | genshin `calculator` |
| 面板/遗器/排名 | ✅ | ✅ | ❌ | miao `profile`（排行见 §4.2） |
| 兑换码 / 公告资讯 | ✅ | ✅ | 部分 | genshin `exchange`/`mysNews`（gid 映射，较好） |
| 练度/深渊统计、模拟十连 | ✅ | ❌ | ❌ | miao `stat`、genshin `gacha`（原神专属） |
| CK/UID 绑定/扫码登录/签到 | ✅ | ✅ | 部分 | 基础设施 + TRSS login（游戏无关） |

> **功能现状 ≠ 重构现状**：多数功能 gs/sr 早已支持，重构只是把旧 `isSr?a:b` 写法改为查 `Games` 表。
> 基础设施层（`genshin/model/mys/*`：apiTool/mysApi/MysUser/MysUtil）已 N-游戏就绪，是最好的底座。

---

## 2. 目标架构与重构范围标准

### 2.1 Games 注册中心（单一真相源 SSOT）
`plugins/genshin/model/games.js`：集中每个游戏的 `biz`/`region`/卡池/术语(武器·光锥)/札记货币字段/UIGF键/模板目录/启用位。
业务层把 `e.isSr ? a : b` 改为查表：`ledgerFields(e.game)`、`term(e.game,'weapon')`、`gachaPools(e.game)`、`getRegion(uid,game)`、`uigfKey(e.game)`。
收益：**加 zzz = 配置加一条 + 补数据/模板，业务层近乎零改动。**

### 2.2 重构范围判断标准（重要）
| 分支类型 | 特征 | 处理 |
|---------|------|------|
| **配置性**（该改） | 字段名/术语/卡池/biz/region/模板后缀的二选一 | 改查 `Games` 表 |
| **结构性**（不该硬改） | gs/sr 走不同算法/解析/方法（material `getImg` vs `getImgSr`、note 数据结构不同、calendar 按游戏分文件） | **保留**，硬塞配置只会更乱 |
| **格式敏感**（需 PC 验） | UIGF 导入导出，改错损坏数据 | 单独验证 |
| **重复代码**（可改） | 同一知识多处实现（xiaoyao region 曾 3 份） | 收敛到共享工具 |

---

## 3. 进度

**已完成并提交**（3 个仓库各一提交，已 push）：
- 主仓 `84d50e8`：P0 框架地基 —— `loader.js` 游戏识别前移到 `Runtime.init` 之前、去 `only_reply_at` 拦截、新增 `isZzz` 三态安全 setter；`runtime.js` `getMysApi/createMysApi` 接受 `game`。
- genshin `231b945`：新增 `games.js` SSOT；`ledger/gachaLog/logCount/exportLog` 改查表；修 `ysLedger` MysApi 第4参 bug。
- xiaoyao `1b6e38e`：region 映射委托 `getRegion`，删 33 行重复实现。
- 真机验证：gs/sr 的货币字段、卡池(gs 4池/sr 6池)、术语(武器/光锥)、导出 UIGF 顶层键(hk4e)全部正确。

**剩余（未做，按价值排序）**：
- `payLog` 星铁/绝区零（**真功能缺口**，需充值记录接口信息）。
- xiaoyao 体力 `Note.js` 仍 gs 硬编码（结构性，价值中）。
- miao-plugin P3（meta 引导/资源路径/`Base.isXxx` 注册化）—— 大工程、与上游冲突风险高，需权衡。
- zzz 端到端（meta-zzz 数据缺、签到空壳）—— 延后。
- 结构性分支（material/note/calendar）—— 刻意保留，不改。

---

## 4. SR/ZZZ 抽卡 authkey 定论（务必先读，避免重复踩坑）

**结论：扫码/cookie 无法得到星铁(及绝区零)抽卡 authkey，这是 miHoYo 刻意设计；原神是唯一例外。**

- 现象：`*更新抽卡记录` → hkrpg `getGachaLog` 返回 `-100 authkey error`。
- 根因：用 stoken 经 `binding/api/genAuthKey`(game_biz=hkrpg_cn) 生成的 authkey **不被星铁抽卡接口接受**（原神同法 hk4e_cn 可用，星铁不认）。
- **三方交叉印证（定论）**：
  1. 自测（独立脚本 `.devenv/sr-authkey-diag.mjs`）：用 cookie 自报的真实 SR uid(102225675)/region(prod_gf_cn)，矩阵实测 host(`api-takumi.mihoyo.com`/`miyoushe.com`)×`x-rpc-signgame`×多端点，**全部 -100**；同账号 GS 同法 `getGachaLog` `retcode=0` ✅。已排除 uid/region/host/签名头/编码等我方因素。
  2. UIGF 接口库：原神抽卡 authkey 列"游戏缓存 **或** genAuthKey"两法，**星铁只列"游戏缓存"一法**。
  3. `genshin.py` 官方文档：从 cookie/stoken **无法**取得星铁 warp authkey，该 key **只由游戏客户端生成**。
- 所有社区工具（genshin-wish-export / HoYo.Gacha / star-rail-warp-export 等）**全部读游戏本地缓存/代理**，无一用 genAuthKey。
- **影响范围**：仅"抽卡/跃迁记录"这一功能。SR/ZZZ 其余功能（体力/角色/遗器光锥/忘却之庭/月历等走 **cookie**）扫码后均自动可用。
- **可行折中**（非消除）：用户贴一次真实 hkrpg 链接（`gcLog.logUrl` 已支持自动识别），authkey ~24h 有效、期间缓存自动续抓。
- 关联 bug 已修：xiaoyao `gclog` 冷却 key 加游戏维度 `xiaoyao:gclog:<game>:<uid>`（否则原神更新后星铁被同一冷却挡"请求过快"）。
- ⚠️ 注：为排查此问题加的 `SRDBG` 调试日志（gachaLog.js / xiaoyao user.js）已**全部撤回**（用户判定无意义），当前工作树干净。

---

## 5. 现象排查记录（用户反馈，均非 bug）

### 5.1 「体力图片和别的群不一样」
`#体力` 被**两个插件**争用，两套模板：
- `xiaoyao-cvs-plugin/apps/Note.js`：`resources/dailyNote/Template/` + 背景图，**多套可换肤模板**（`#体力模板列表`/`#体力模板设置X`）；受 `Cfg.get("sys.Note")` 开关控制。
- `genshin/apps/dailyNote.js`：`daily-note-gs.html` 官方原版、简洁。

**`sys.Note` 开 → 走 xiaoyao 花哨图；关 → 落 genshin 原版图。** 群间不一致 = 该开关/模板选择/插件版本不同，是配置差异。

### 5.2 「(星铁角色如白厄)排行 看不到」
`排行` 来自 miao `apps/profile/ProfileRank.js`，4 道门槛、只支持 gs/sr：
1. **游戏**：`game = e.isSr ? 'sr':'gs'`——**zzz 无排行**；星铁角色必须用 `*` 前缀（`*白厄排行`），用 `#` 会当成原神角色查不到、静默无响应。
2. **必须在群里**（私聊无 `group_id`，直接返回）。
3. **开关**：`#喵喵设置` 开 groupRank、本群未 `#关闭排名`。
4. **要有面板数据**：需群友先发 `*面板`/`*白厄面板`上传，否则「暂无排名」。
（白厄本身 miao 已支持，含 `meta-sr/character/白厄/calc.js` 伤害规则。）

---

## 6. 本地验证环境（约束）

- `.devenv`：Node 23 + pnpm + 独立 redis(6399)；已用真实账号扫码登录（ck 入库 `data/db/data.db`）。**凭据位置与一键清理见 `docs/local-test-credentials.md`。**
- ⚠️ 本机（RHEL8、无 root）**渲染不出图**：缺 ~13 个 Chromium GUI 库。故验证用"真实数据 + 日志值比对"（改造点临时打印选出的字段/参数，与旧 `isSr?a:b` 已知结果逐一比对；临时打印提交前删除）。出图视觉留到 PC/部署机终验。
- 系统 redis 6379 / 用户 8765(bilibili) 全程不碰。

---

## 7. 变更记录
- `2026-05-30` 完成全量审查 + P0 框架地基 + genshin 配置性重构(ledger/gacha/logCount/exportLog) + xiaoyao region 去重，3 仓库提交并 push；真机验证 gs/sr 取值全对。
- `2026-05-30` SR authkey 三方实证定论：扫码/cookie 无法得 SR/ZZZ 抽卡 authkey（见 §4）。
- `2026-05-30` 排查体力双渲染器、排行门槛两现象（见 §5），均非 bug。
- `2026-05-30` 撤回 SR 调试改动（SRDBG 日志），工作树恢复干净。
- `2026-05-30` 文档精简：合并 SR 结论、压缩流水账、删 pc-verify（验证清单并入 `wechat-deploy.md`）。
