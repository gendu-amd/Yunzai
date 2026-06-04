# 代码库审计（2026-06）— 三轮深挖问题图谱 + 框架真实结构

> **本文定位**:这是当前代码库**真实状态**的权威基准。区别于 `target-architecture.md`(愿景)、
> `refactor-progress.md`(时序日志,含历史叙述与漂移)。后续动工前以本文为准对齐"到底哪里有问题"。
>
> **方法**:对 `lib/` 框架核心 + genshin / miao-plugin / xiaoyao-cvs-plugin / ark / adapter 等,
> 分三轮、共 14 个维度做只读纵深审查(按 repo 横扫 → 按维度纵切 → 专项深挖),去重后归纳为 A–U 类。
>
> **核验说明**:子代理审查的引用偶有偏差(尤其安全类),凡标 ✅ 的为人工 Read/Grep **已核验属实**;
> 未标的为审查报告所述、动工时需就地复核(file:line 可能有 ±,问题方向可信)。

---

## 0. 一句话结论

Yunzai 多游戏生态当前是一个 **"迁移进行中 + 单机信任模型 + 自动化护栏≈零"** 的系统:
契约层(`Bot.core`)已挂载但 monorepo 内**几乎无人消费**,账号/出图/游戏判定仍由**框架硬连 genshin/miao**承载;
`e.game` 不是单一事实源,`e.isSr` 二元世界 + games.js 副本遍地;并存若干**会崩的潜伏缺陷**与**无 TTL 泄漏**。
"看起来已大一统,实际仍单体 + 硬编码"。

---

## 1. 框架真实结构(已核验)

消息链路仍是经典单体:

```
OICQ/协议事件 → lib/events/{message,notice,request}.js → PluginsLoader.deal → _deal → _mwDispatch
            → 各插件 rule(首个正则命中即 return,后续插件无机会)
```

- **双实例模型**:加载期每插件一个单例(存元信息),派发期 `new class(e)`。loader 用
  `Object.assign(i.plugin,{e})` 把当前事件写回**加载期单例**兜 `getContext`,语义脆弱。
- **L0→L2 倒挂(根因)**:`lib/plugins/runtime.js:14-21` 动态 import genshin 的
  `gsCfg/MysApi/MysInfo/NoteUser/MysUser`;`lib/plugins/plugin.js:2-4` 基类 `import("#miao")`;
  `runtime.render` 写死 `plugins/miao-plugin/resources/` + `_miao_path` + miao 布局。
- **契约层挂载 ≠ 被用**:`account/gameRegistry/gacha/gameData/rank` 都 provide 了,但
  monorepo 内消费方几乎不 `require`;genshin 自己都不消费自己 provide 的 `gameRegistry`。
- **出图实际只有一条 Chromium 管道**(art-template → `renderers/puppeteer/`),外面包了 **5 套入口**
  语义不一(见 §2.R)。
- **启动时序**:`Bot.core`/`gamePrefix` 空表在 Bot 实例化前即挂载,adapter `load()` 排在全部插件
  import 之后,HTTP/WS 入站有 `online===2` 门控 → 正常运行下 port 自注册时 `Bot.core` 已就绪。
  薄弱点在**热更与副作用注册**(见 §2.L)。

---

## 2. 全局问题图谱(A–U)

> 严重度:`[严重]`=会崩/会泄露凭证;`[高]`=结构性债/数据不一致;`[中]`/`[低]`=可维护性。

### 根因层

**【A】L0→L2 倒挂(框架反向依赖具体插件)** — 总根
- `[高]` `lib/plugins/runtime.js:14-21` 动态 import genshin 5 个 model;`193-215` `render()` 写死 miao 资源/布局
- `[高]` `lib/plugins/plugin.js:2-4` 基类加载期 `import("#miao")`,失败时 `renderImg` 运行时才炸
- `#miao` 别名仅在根 `package.json` 注册,把**框架 + genshin 数据层**绑死 miao(§2.U)

**【B】`isSr`/`e.game` 双轨 + 游戏硬编码遍地**
- genshin ~80 处 `e.isSr ? : ` / `game==='sr'`(`gachaLog/ledger/calculator/logCount/exportLog/note/gsCfg`)
- miao 几乎全模型 gs/sr 二元(`Profile*/Dmg*/Attr*/Elem/Meta/Button/Base`)
- `[高]` `gachaLog.js:15-27` 存储路径按 `isSr`、卡池按 `e.game`,**二者可不一致**
- `mysInfo.js:98/157/204` 入口仍 `e?.game || (e?.isSr?'sr':'gs')` 回退,与 `games.getGame()` 语义分裂

**【C】SSOT 不单一 — games.js 之外 ≥3 份副本**
- 游戏 key/getGameKey:`genshin/MysUtil.js:3-39`、`genshin/user.js:285-297`(`nap` 别名只有 games.js 有)
- 卡池:`logCount.js:20-54`、`exportLog.js:26-64` vs `games.gachaPools`(typeName 还不一致)
- region 推断 **4 份**:`mysApi`(已对齐)、`gachaLog.getServer:1031-1049`(sr 默认值疑似 bug)、`takeBirthdayPhoto.getServer`、`xiaoyao/mys/utils.js:86`
- miao 平行表:`Elem.js:25-82`、`Calendar*.js`(biz/region)、`Serv.js:37-75`

**【P】game 检测确证不是单一事实源**
- `e.game` 最接近 SSOT,但 **`#`原神命令从不写 `e.game`**(靠 undefined→各处兜底 `gs`)
- 双轨:loader 前缀(sr/zzz)+ 业务侧写(`gachaLog` URL 正则 / `ledger` `msg.includes('星琼')` / miao 文案 / `Player.create`)
- 同一条消息可被 **前缀→URL→文案→角色名 多次改写**;`%绝区零...星琼` 会把 zzz 冲成 sr
- **zzz 系统性缺失**:`Player.create` zzz→gs(面板进错目录)、排行/练度/图鉴/抽卡统计只认 gs/sr

### 会崩的潜伏缺陷

**【J】latent crash(走到就报错,因路径少见而存活)**
- ✅`[严重]` `genshin/model/mys/MysUser.js:223` 调 `MysUser.getCkUid()` —— **该静态方法不存在**(只在 NoteUser),`checkCkStatus` 必崩
- `[严重]` `genshin/model/mys/mysInfo.js:223-225` 批量 `Promise.all` 后某项为 `false` 时访问 `res[i].api` → 抛错中断整批
- `[高]` `adapter/Satori.js:469/487/503` `pickFriend/Member/Group` 调用类内未实现的 `getXxxInfo` → TypeError
- `[高]` `adapter/OPQBot.js:21-25` 超时回调引用未定义的 `ws` → ReferenceError
- `[高]` `adapter/ComWeChat.js:496-516` `request_type` 从未赋值 → emit `request.undefined.*`,请求事件全失效
- `[高]` `miao-plugin/components/Cfg.js:30` `lodash.isUndefined(cfg)` 应为 `ret` → 默认值逻辑错
- `[高]` `miao ProfileDmg.js:109` `cfg.enemyName || this.isGs ? '小宝':'弱点敌人'` 运算符优先级 → 敌人名被吞
- `[高]` `miao CharCfg.js:51` `getCalcRule` 不分 gs/sr cfgMap → 同名角色配置串游戏;`Attr.js:139` 无守卫 TypeError

### 持久化

**【D/K】账号/cookie 状态分散 + 泄漏 + 命名空间混乱**
- ✅`[高]` `DailyCache.clearOutdatedData`(`DailyCache.js:67-77`)正则 `Yz:cache:(mys|hoyolab|config)-MM-DD` 与真实 key `Yz:cache:gs:cn_gf01-MM-DD`/`Yz:cache:sys:config-MM-DD` **不匹配** → 显式清理失效、泄漏
- `[高]` **无 TTL 永久膨胀**:`Yz:count:*`、`Yz:apgl:*`、`miao:rank:*`、`ark-plugin:stygian*`、`genshin:user-cfg`/`miao:user-cfg`
- `[高]` **UID 映射四轨**:`Yz:genshin:mys:qq-uid` / `Yz:srJson:mys:qq-uid` / `genshin:uid`(xiaoyao 写) / legacy `genshin:id-uid`(miao 读)
- `[高]` **Cookie 五处落地**:SQLite `data/db/data.db`(已是 SSOT) + `data/MysCookie/*.yaml` + xiaoyao `data/yaml` + `yunToken` + `NoteCookie.json`
- `[中]` 跨命名空间写:xiaoyao 写 `genshin:*`、ark 写 `miao:original-picture` + `plugins/miao-plugin/config/group/`
- `[中]` redis v4 误用:`xiaoyao_image.js:175` 第三参 `10800` 非 `{EX}`;多处 `JSON.parse(redis.get())` 无 try;`setEx`/`zScore` 未 await
- `[中]` zzz 存储链断裂(无 `PlayerData/zzz/`、无 zzz uid 前缀);`lib/util.js` LevelDB 工具**全仓零调用**

### 契约 / 框架

**【E】契约层挂载但零消费 + 部分坏/分层倒置**
- ✅`[高]` `core.renderer` **死且坏**:`rendererPort` 读 `globalThis.Renderer.getRenderer()`,但 `lib/renderer/loader.js:8` 把 `global.Renderer` 设成 art-template 类(**无 `getRenderer`**),真后端注册表是该文件 default export。→ `available()` 恒 false、`render()` 恒降级,且全仓零消费
- `[高]` `gachaPort.js:6` 契约层 import `apps/payLog.js`(L1→app 倒置)
- `[中]` hook:仅 1 个调用方(miao `ProfileDetail.js:262`,本次已对齐为 `emit`),0 个订阅者;`core.gamePrefix` 走旁路不经 `require/has/list`

**【F】单体派发 + 未接线子系统 + 死代码**
- `[高]` `lib/plugins/handler.js` 整个 Handler 子系统全仓零消费(`callAll` 空体)
- `[高]` ~~`lib/plugins/config.js:makeConfig` 零引用死文件~~ **更正**:本仓零引用,但它是**框架对外 API**(第三方插件如 WeChat-Plugin 会 import),非死代码,**已恢复**,勿删;`lib/common/common.js` 大部分零引用(同理需先确认无外部插件依赖)
- `[中]` `_mwDispatch` 首个 rule 命中即 return;`notice/request` 也跑完整 `deal`(含游戏/账号 init)
- `[中]` 热更 `changePlugin` 只改 priority,不刷新 Handler/定时任务/adapter

### 适配层 / 定时

**【L】适配层重复 + 热更副作用泄漏**
- `[高]` `Bot.wsf[path].push` / `express.post` **全部无幂等**(OneBot/OPQ/ComWeChat/Milky/GSUIDCore)→ 热更/重连堆叠 `ws.on('message')`,消息重复派发
- `[高]` `loader.changePlugin` 重 import adapter 但不调 `adapter.load()`、不清 `Bot.wsf`;`unlink` 留幽灵适配器
- `[中]` 7 套适配器各自复制 `sendApi`+echo+超时、消息归一化、`pick*`(Milky≈OneBot 重写,~千行重复)
- `[中]` 事件粒度不一致:Satori/ComWeChat/stdin emit 缺 `sub_type` → `filtEvent` 三段匹配可能失效

**【M】定时任务生命周期失控**
- `[高]` xiaoyao `apps/index.js:137-156` 4 个 `scheduleJob` 模块顶层注册、**永不 cancel**、热更不安全
- `[中]` `other/update.js` `update_cron` + `update_time`(递归 setTimeout)双通道并存
- `[中]` cron 构造期冻结,改 yaml 不重建;`loader.this.task` 数组永不清空

### Mys 内核 / 多服

**【N】签名/限流/池 契约缺口**
- `[高]` DS `salt`、`app_version`、UA、`device_fp` 硬编码散落 `mysApi.js:159-170` + `apiTool.js`(假 device_fp 重复 6 次),米游社升版即断签
- `[高]` retcode 双轨且有洞:无限流 `-110xx`;验证码依赖的 `mys.req.err` Handler **全仓无实现**;CK 失效只在 message 含 login 文案时才删
- `[高]` 公共 CK 池无锁、`initPubCk` 未注入 `ck`、计数语义混乱(`disable` 用 `zDel` vs score=99)
- `[高]` 多处绕过 `MysInfo.get` 直连 fetch 无 DS:`MysUser.getGameRole`、`setPubCk.checkCk`、`blueprint.js`、`mysNews`、`takeBirthdayPhoto`

**【U】依赖与多服**
- genshin/xiaoyao **无 package.json**;ark 装真 lodash 4.x vs 根 es-toolkit 垫片双栈;死依赖 `strip-ansi/sequelize/sqlite3`;`express-art-template` 缺失;`puppeteer:*` 不可复现;lock 残留 cordis
- 国际服三套判定(region 正则 / UID 首位启发式 / `biz(isOs)`),xiaoyao `uid[0]>5` 与 genshin `getRegion` 不一致;`biz(isOs)` SSOT 建了业务几乎不用;payLog/直播兑换码/miao 日历/xiaoyao 签到(`osSalt` 空)偏国服;全局 `TZ=Asia/Shanghai` + cron 按国服日界

### 出图 / 伤害引擎

**【R】出图层:一条管道 + 5 套入口**
- 入口:runtime / puppeteer shim(标"废弃"实为 critical) / contracts renderer(坏·死) / `renderImg`糖 / xiaoyao Common(与 genshin `#体力` 双渲染器竞争)
- `[高]` `_miao_path` 在 runtime/miao Render/genshin base 三处重复硬编码;genshin 模板依赖 miao `meta-gs/sr` 资源,靠 `...data` spread 顺序"碰巧"保住路径
- `[高]` puppeteer 后端无截图队列/无串行锁、超时仅打日志(TODO)、`browserWSEndpoint` redis 缓存 30 天易连僵尸

**【Q】miao 伤害引擎**
- 架构:固定乘区引擎 + 每角色 `calc.js` JS-DSL;gs/sr 硬分叉贯穿,无 zzz,加游戏≈写新引擎模块
- 确定性 bug 见 §2.J(ProfileDmg:109 / CharCfg:51 / Attr:139 / Character.forEach:210)

### 测试 / 安全

**【S】测试与护栏 ≈ 零(对重构是最大风险)**
- 无单测/无 CI/无 lint gate(`npm run lint` 只是 prettier);唯一护栏是 **workspace 外** `.devenv/`(22 条派发快照 baseline + 弱冒烟 verify),不进 git、他人 clone 不可复现
- 文档漂移见 §6;盲区:出图/真实 API/抽卡/DB·Redis 迁移/写账号/各 adapter/插件 fork 内逻辑全无自动覆盖

**【T】安全:单机信任模型(不可裸奔公网)**
- ✅`[严重]` `genshin/model/user.js:559` `#我的ck` 直接 `reply(完整 Cookie)`,方法内无私聊门控
- `[严重]` 凭证进日志:`system/master.js` 设主人验证码 `logger.mark`;xiaoyao 登录/充值 `JSON.stringify`;HTTP 全量 body;mysApi 成功响应整包进 redis;authkey 明文 redis
- ✅`[结构]` `lib/plugins/loader.js:343` `!v.permission || e.isMaster` —— 无 `permission` 字段=全员可用(Yunzai 标准设计,风险在危险命令漏标)
- `[严重·第三方]` `TRSS-Plugin` RemoteCommand `eval`/`exec` 无 permission + md5 固定后门 → 非主人 RCE;`File.js` 路径穿越
- `[严重·第三方]` Guoba `/api/helper/transit` 免鉴权 SSRF;快速登录 6 位码;配置/插件写接口;TRSS 模式 `skip_auth`
- `[高]` 公共 CK 池:任意用户查任意 uid、无限流 → 池账号易被封
- *范围:TRSS/Guoba 是第三方插件,不在多游戏重构目标内,但部署里确实存在*

---

## 3. 已人工核验的关键缺陷(5 个抽样,4 真 1 引用偏差但问题真)

| # | 缺陷 | 位置 | 核验结果 |
|---|------|------|----------|
| 1 | `MysUser.getCkUid` 静态方法不存在 | `genshin/model/mys/MysUser.js:223` | ✅ 真(只在 NoteUser 上有) |
| 2 | DailyCache 清理正则与 key 格式不匹配 | `genshin/model/mys/DailyCache.js:67-77` | ✅ 真(几乎不命中) |
| 3 | `core.renderer` 读错 global、能力死且坏 | `lib/renderer/loader.js:8` vs `rendererPort.js` | ✅ 真(art-template 类无 getRenderer) |
| 4 | `#我的ck` 回显完整 Cookie | `genshin/model/user.js:559`(报告误写 apps/) | ✅ 真(方法内无私聊门控) |
| 5 | 无 `permission` 字段=全员可用 | `lib/plugins/loader.js:343` | ✅ 真(标准设计,危险命令漏标即开放) |

---

## 4. 根因优先级

1. **A(L0→L2 倒挂)** 是总根 —— 不解决,契约层永远是装饰。
2. **S(护栏≈零)** 是**前置阻塞** —— 没有回归网,P2+ 是"改了不知道坏没坏"。
3. **D/K(状态分散)** 最影响"可管理";**C+B+P(SSOT/双轨/检测)** 是同一块硬币,要一起做。
4. **J(潜伏崩溃)、E(契约坏)、T(凭证泄漏)** 低风险高收益,可先行止血。

---

## 5. 修正后的分阶段重构方案

| 阶段 | 主题 | 内容 | 风险/护栏 |
|---|---|---|---|
| **P-1 立护栏**(前置) | S | `.devenv` 回归网入仓 + 加厚 baseline 语料 + 最小契约层单测 + 修文档漂移(§6) | 必做,否则后续盲改 |
| **P0 止血** | J/E/K/T | 修已核验崩溃(getCkUid/批量查询/Cfg 默认值/ProfileDmg 运算符)、补 DailyCache 正则与 TTL、修 `core.renderer`(接真后端或删)、`#我的ck` 私聊门控 + 凭证日志脱敏 | 低,纯收益 |
| **P0.5 清死代码** | F/G | `lib/app/*` 死路径、`makeConfig`、`common.js`、死函数、stale 注释 | 低 |
| **P1 契约定稿** | E | `gachaPort` 去 import apps;hook 定稿;契约消费方真正接上 | 低 |
| **P2 SSOT 收敛** | C+B+P | games.js 收编所有副本;**收敛 game 检测写入口**(删 isSr 侧写、`#`显式写 e.game);isSr→e.game | 中,需逐处验等价 |
| **P3 状态统一** | D/K | 账号/cookie/uid 收敛单一 account+DB;统一 redis 命名空间;xiaoyao 退场 yaml/yunToken;zzz 存储链补齐 | 中高,需 PC 验 |
| **P4 适配/定时治理** | L/M/N | adapter 公共基类 + `Bot.wsf` push 幂等 + 热更清理;xiaoyao 旁路 scheduleJob 纳入框架;签名常量集中化 | 中 |
| **P5 解倒挂** | A/R/U | runtime/plugin 去 genshin/miao 硬 import;出图 5 套入口合一;`_miao_path` 解耦;依赖 manifest 化 | 高,需 PC 出图终验 |
| **P6 扩展/安全** | Q/T | ark monkey-patch → hook+provide('rank');第三方插件(TRSS/Guoba)安全加固(另议) | 需排名服务/另立项 |

---

## 6. 文档漂移清单(需纠正)

审查发现以下文档声称的内容**与现盘不符或文件不存在**:

| 文档 | 漂移内容 | 现状 |
|------|----------|------|
| `refactor-progress.md` | `core.hook.{emit,emitAsync,veto}`、`pluginRegistry` | 已删,hook 仅 `{on,emit}`;本次已修当前能力地图行,旧时序条目作历史保留 |
| `SESSION-SNAPSHOT.md:22` | `core.hook.{on,emit,emitAsync,veto}` + `pluginRegistry` | 同上,需更正 |
| `target-architecture.md` | `core.list()→[{name,version,plugin}]`、`hook.on(name,priority,fn)`、`hook.filter`、多 provider 按 priority、一长串未实现 hook 点 | 与精简实现大幅背离(愿景文档,需标注或重写为现状) |
| 多文档 | "baseline 23 条 PASS" | 实际 `.devenv` 语料 **22 条** |
| `docs/` | `lazy-activation-design.md`、`lazy-activation-guide.md`、`poc-cordis`、`ADR-*` 文件 | **均不存在**(被引用但找不到) |
| `unified-refactor-plan.md` P0 | 全 `[ ]` 未勾 | 与 `refactor-progress.md` 大量 `[x]` **自相矛盾** |
| `test-routing.sh` | grep `DEVTEST` | 源码已无 `DEVTEST`,脚本可能失效 |

---

## 变更记录
- 2026-06-03:初版。三轮 14 维度审计汇总;5 个关键缺陷人工核验;给出修正后 P-1~P6 方案与文档漂移清单。
- 2026-06-03(P0 止血批次,已落地 + baseline `--check` PASS):
  - **【J】崩溃**:`MysUser.checkCkStatus` 改用 `create+setCkData+reqMysUid`(替不存在的 `getCkUid`);
    `mysInfo.js` 批量 `Promise.all` 守卫 `res[i]` 为 false;`miao Cfg.js:30` `isUndefined(ret)`;
    `ProfileDmg.js:109` 敌人名加括号;`Attr.js:139` `getCalcRule()||{}`;`Character.forEach` `!==game`;
    `CharCfg` init 重置 char + `getCalcRule` 按 game 选 cfgMapGs/Sr(修浅拷贝共享引用)。
  - **【K】泄漏/误用**:`DailyCache.clearOutdatedData` 正则改为匹配任意 `-MM-DD`;`xiaoyao_image` redis `{EX}`。
  - **【E】契约坏**:`rendererPort` 改读 `RendererLoader` 真后端(弃 `global.Renderer`)。
  - **【L】适配器**:`OPQBot` 超时用 `Bot[id].ws`;`ComWeChat.makeRequest` 设 `request_type`。
  - **【T】凭证**:`#我的ck` 群聊不再明文回显 Cookie(仅私聊)。
  - **【F】死代码**:~~删 `lib/plugins/config.js`(`makeConfig`)~~ **已撤销/恢复**(它是框架对外 API,第三方插件在用,误删)。
  - 未做(需 PC/数据等价/排名服务终验):P2 SSOT 收敛、P3 状态统一、P4 适配层去重、P5 解倒挂、P6 ark/出图终验;
    及无 TTL key 加期(`Yz:count`/`apgl`/`miao:rank` 等改动可能丢数据,需 PC 评估)、xiaoyao `lib/app/*` 死分支(控制流复杂)、`common.js` 部分死代码(被 runtime import)。
