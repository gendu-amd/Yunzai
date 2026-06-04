# 外部插件接入与统一管理 · 研究

> 目标:把要接入的外部插件(WeChat / StarRail / yenai / ZZZ-Plugin / Atlas)先**研究清楚**——
> 功能、用法、实现状态,**尤其是它们各自怎么处理账号(ck/stoken/device)与状态**——
> 再决定如何**纳入我们的统一管理**(单一账号源、契约消费、避免各存一套)。
>
> 方法:分阶段研究,每阶段记录到本文 → 末尾给统一接入方案 + 反思。**不盲装、不盲改第三方编译产物。**

---

## 0. 背景

我们已把 genshin/miao/xiaoyao 的**账号(ck/uid)统一到 genshin SQLite DB**(经 `Bot.core` 的 `account`/`gacha`/`gameData`/`gameRegistry` 契约消费)。接入新插件时的核心风险是:**它们可能各自再存一套 ck/stoken/device**,重新制造"绑了对不上、改一处要改多处"的碎片化。所以接入前先查清,接入后要么**让它消费我们的单一源**,要么**明确它的自有状态边界**(像 stoken/device 这种第三方独有的,承认其单 owner,不强行合并)。

---

## 1. 插件清单(仓库 / 定位 / 前缀)

| 插件 | 仓库(upstream) | 定位 | 前缀/帮助 | 是否走米游社账号 |
|---|---|---|---|---|
| **Atlas**(已装) | `Nwflower/Atlas` | 多游戏**图鉴/wiki**(gs/sr/zzz) | `#图鉴` 等 | 否(纯资料,推测) |
| **ZZZ-Plugin**(已装) | `ZZZure/ZZZ-Plugin` | 绝区零**面板/抽卡/伤害** | `%`/`#绝区零` `%帮助` | 是(自带 device,抽卡依赖逍遥) |
| **StarRail-plugin**(待装) | `TsukinaKasumi/StarRail-plugin` | 星穹铁道**面板/体力/抽卡/模拟宇宙** | `#星铁帮助` | 是(米游社) |
| **yenai-plugin**(待装) | `yeyang52/yenai-plugin` | **群管 + 状态监控 + 搜图/娱乐** | `#椰奶帮助` | 否(群管/系统向) |
| **WeChat-Plugin**(待装) | `TimeRainStarSky/Yunzai-WeChat-Plugin` | **微信协议适配端**(官方标注极易封号) | `#微信登录` | 否(协议端) |

> 注:StarRail-plugin 与我们现有的 miao(`*面板`)+ xiaoyao(`*体力`/抽卡)在星铁上**功能重叠**,接入前要评估是否冲突/重复(同一命令多插件抢)。

---

## 2. 研究框架(每个插件要回答的问题)

**A. 账号/状态(统一管理的关键)**
- 是否有**自己的 cookie/uid/stoken/device 存储**?(redis key / yaml / db)
- 是否消费我们的 `Bot.core` 契约(account/gameData…)?还是直连米游社/自建?
- device 指纹怎么来(自带共享默认 / 每用户 / getFp)?——这是 zzz 10041 的根。
- 与现有账号源**重复/冲突点**在哪。

**B. 功能/用法**:核心命令、依赖(如抽卡依赖逍遥)、出图路径。

**C. 实现状态**:活跃/弃用、是否编译产物(dist,改动困难)、版本。

**D. 统一接入结论**:
- ✅可统一(让它走我们的契约 / 我们提供它需要的)
- ⚠️边界自有(第三方独有状态,承认单 owner,不合并)
- ⛔冲突(命令重叠/需取舍)

---

## 3. 分阶段研究记录(阶段1+2,基于沙盒 clone 代码审查)

### StarRail-plugin(TsukinaKasumi,v1.2.1,无 dist,2026-05 仍活跃)
- **账号 cookie:与 genshin 同源 ✅**。`utils/common.js:213` `getCk` 走 `../../genshin/model/user.js`→NoteUser→genshin SQLite,只读 `getMysUser('sr')`。**不另存 ck**。
- **但有侧车存储(与 genshin/xiaoyao 并行)**:
  - UID:Redis `STAR_RAILWAY:UID:${qq}`(第二轨;**TRSS 下 `bindSRUid` 被 `apps/MiaoOrStarrail.js:105` 拦截**,应只用 genshin sr uid,但部分代码仍先读 Redis)
  - 抽卡 authkey:Redis `STAR_RAILWAY:AUTH_KEY` + 本地 `data/gatcha/${uid}/*.json`(**第三轨**,独立于 genshin `data/gachaJson`/xiaoyao)
  - device_fp:Redis `STARRAIL:DEVICE_FP:${uid}`(与 genshin `mysApi` 的 fp **不同 key**,同 uid 两套指纹)
  - 面板缓存 `data/panel/${uid}.json`、配置 `config/*.yaml`
- **不消费 `Bot.core`**(全仓 0 处);请求内核 `runtime/MysSRApi.js` extends genshin `mysApi`。
- **命令冲突**:`*体力` priority **5** vs genshin `dailyNote` priority **300** → **StarRail 会压过 genshin/xiaoyao 的星铁体力**(归一化后 `#星铁体力` 同时匹配,小 priority 先执行且命中即停)。面板有 `MiaoOrStarrail` 兼容层(默认只开 miao)。抽卡命令正则不同、数据各一套。
- ⚠️ 安全:面板 API 签名 `utils/auth.js` 从 base64 文件 **eval** 加载。

### yenai-plugin(yeyang52,v2 分支 2.0.x,重事件/重配置)
- 配置:自有 `config/config/*.yaml` + `config/group/{群}.json`;Redis 前缀 **`yenai:`**(与框架 `Yz:` 不撞)。
- **直接改框架黑白名单**:`#拉黑白` 写 **Yunzai 根 `config/config/other.yaml`** 的 `blackUser/blackGroup`(`apps/assistant/blockOne.js:50`),与框架 `loader.checkBlack` **同文件同字段**;另有自有 `groupAdmin.blackQQ`(**两套黑名单不同步**)。
- 事件监听会改 bot 行为:`request`(加群/好友→通知主人)、黑名单自动拒/踢、入群验证、违禁词(accept priority 1 最先吃群消息)、可选"全量消息转发主人"。
- `monitor.open` 默认 **true** → 启动即持续采集系统信息 + 每分钟 `redis.info`(偏重)。
- 依赖:需 `pnpm i`(systeminformation/cheerio/jimp);搜图/Pixiv 需各自 API key;出图复用框架 puppeteer。
- 默认 **不抢** `#状态`(除非开 `defaultState`)。

### WeChat-Plugin(TimeRainStarSky,**官方已弃用**)
- 机制:`wechat4u` **网页版微信协议**、进程内直连;`Bot.adapter.push`,`adapter.id="WeChat"`。
- **致命冲突两点**:① `id="WeChat"` 与已装的 **ComWeChat 同 id**,R-4 幂等注册下互相覆盖,甚至双通道入站;② **`import makeConfig from "../../lib/plugins/config.js"`** —— 该文件曾被我误删(已恢复)。
- 不稳:README 标弃用/极易封号;离线 5 分钟失效、重登用户 ID 全变(代码无兜底)。
- **结论:不装。微信走已有的 ComWeChat(`wechat-deploy.md` 认定的开箱路径)。**

### ZZZ-Plugin / Atlas(已装,补充结论)
- ZZZ-Plugin:cookie 读 genshin;**device 自带共享默认 → zzz 端点 10041 风控**(见 deploy 排查);抽卡依赖逍遥。device 是 zzz 专属一套,非账号问题。
- Atlas:纯图鉴/资料,不碰米游社账号(无统一需求)。

---

## 4. 统一接入方案(summary)

| 插件 | 接入结论 | 处理 |
|---|---|---|
| **StarRail-plugin** | ⚠️ cookie 已统一,但 UID/抽卡/device **侧车三轨** + 命令抢占 | 接入需评估:`*体力` 抢 genshin/xiaoyao(可调 priority 或只留一家);抽卡数据不互通(接受或后续对接) |
| **yenai-plugin** | ✅ 可接入(群管/状态),但**配置面要纳入运维统一** | 明确"框架 autoFriend/checkBlack" vs "椰奶 通知/blackQQ/验证/违禁词"四条独立开关;`monitor.open` 按需关 |
| **WeChat-Plugin** | ⛔ 不接入 | 用 ComWeChat |
| **ZZZ-Plugin** | 已接入 | 面板走 Enka(`%更新展柜面板`)或 `%绑定设备` 避 10041 |
| **Atlas** | 已接入 | 无需统一 |

**统一管理的现实**:这些第三方插件**都不消费我们的 `Bot.core` 契约**(StarRail 直接相对 import genshin)。真正"经契约统一"需要改第三方源码(侵入),不划算。可行的统一 = ①cookie 都落 genshin DB(StarRail 已是)②文档化各自侧车状态(UID/抽卡/device)③解决命令抢占(priority/取舍)。

---

## 5. 反思与遗漏
- **反思1(自己的错)**:`lib/plugins/config.js`(`makeConfig`)被我当死代码删过 —— 实为框架对外 API,WeChat-Plugin 等第三方在用。**已恢复**。教训:"全仓零引用"不等于死代码,要排除"对外 API/被外部插件调用"。
- **反思2(命令抢占)**:接外部游戏插件最大隐患不是账号,是**命令前缀抢占**(StarRail `*体力` priority 5 压过 genshin 300)。叠插件前必须按 priority + "命中即停"语义评估冲突。
- **反思3(侧车状态)**:cookie 易统一(都走 DB),但 **UID/抽卡 authkey/device_fp** 这类每个游戏插件都自己存一套,跨插件天然碎片化;除非改第三方,否则只能文档化边界。
- 待补:Atlas 的 redis/文件占用未深查(图鉴资料,低风险);ZZZ-Plugin 抽卡与 StarRail/xiaoyao 是否还有交叉未逐一比对。

---

## 变更记录
- 2026-06-04:初版 + 阶段1/2 完成(WeChat/StarRail/yenai 代码审查;ZZZ/Atlas 补充)。给出接入方案与反思。恢复被误删的 `lib/plugins/config.js`。
