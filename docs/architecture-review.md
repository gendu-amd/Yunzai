# TRSS-Yunzai 多仓系统性架构评审

> 目的：盘清 Yunzai 本体 + 各插件的**定位、职责、脆弱点、重构建议**,回答"为什么现在功能感觉脆弱"。
> 创建：`2026-05-31`。只读评审,未改任何业务代码。
>
> **本文是「现状诊断(As-Is)」**——只到"问题 + 方向"。**目标架构与官方扩展接口的详细设计见 `docs/target-architecture.md`(To-Be)**;生态调研与路线见 `docs/unified-refactor-plan.md`。

## 0. 分析方法（过程记录）

- 并行派 4 个只读探查代理深入:① 框架核心(`lib/`、`app.js`、`renderers/`、`plugins/adapter|system`);② `genshin` 插件;③ `miao-plugin`;④ `xiaoyao / TRSS / Guoba / ark` 四个支撑插件。
- 结合既有 `docs/multi-game-refactor.md`(多游戏耦合审计 + SR authkey 定论)。
- 结论按"定位 → 职责 → 脆弱点(带 file:line) → 重构建议"组织,跨仓共性问题汇总在 §3。

---

## 1. 整体架构

```
应用端 = 本仓 TRSS-Yunzai (WS 服务端, 2536)
  ├── 框架核心 lib/        : 进程/事件总线/插件调度/渲染/配置  ← "运行时宿主"
  └── plugins/
       ├── adapter/*       : 协议适配(OneBotv11/ComWeChat/stdin…) → Bot.wsf 路由
       ├── system|other/*  : 内置系统/运维命令
       ├── genshin         : 米游社 API/账号/抽卡/札记/体力 —— 数据&账号 SSOT(基础设施)
       ├── miao-plugin     : 角色 meta/面板/伤害/评分/排行/统计 —— 角色域事实标准库
       ├── xiaoyao-cvs     : 签到/扫码登录/体力美化/充值 —— genshin 之上的 UX 扩展
       ├── TRSS-Plugin     : 官方工具箱 + Bot 全局能力补丁 + 登录
       ├── Guoba-Plugin    : Web 配置面板(:2536/guoba)
       └── ark-plugin      : miao 的侵入式扩展(全服排名/幽境危战/OCR)
```

**核心依赖链(也是最大脆弱来源)**:
```
框架 runtime.js ──硬 import──> genshin(gsCfg/MysApi/NoteUser) ──import #miao.models──> miao-plugin
     │                                                                                    ▲
     └── render() 硬编码 _miao_path → miao 资源                                            │
xiaoyao ──file:// 动态 import──> genshin(mysInfo/gachaLog/payLog/games)                    │
ark-plugin ──覆盖/monkey-patch──────────────────────────────────────────────────────────┘
```
即:**框架→genshin→miao 三层强耦合,xiaoyao 深度寄生 genshin,ark 直接改写 miao 文件**。任一层接口/路径变动都会向上击穿。

---

## 2. 各仓定位 · 职责 · 关键脆弱点 · 重构建议

### 2.1 框架核心 `lib/`（运行时宿主）
- **定位**:进程启动、全局 `Bot` 单例(HTTP/WS 服务+事件总线+多账号路由)、插件扫描/调度(CD/权限/黑白名单)、渲染器、配置/Redis。**定契约与管道,不含业务**。
- **消息生命周期**:adapter → `Bot.em()`(事件冒泡+`prepareEvent` 注入) → `lib/events/message.js` → `PluginsLoader.deal()`(统计→黑白名单→CD→`dealEvent`→**游戏前缀**→`reply`包装→`Runtime.init`→按 priority 过滤→正则匹配派发) → `e.reply()` → adapter 发送。
- **关键脆弱点**:
  1. **派发语义**:`loader.js` 首个正则匹配即 `return`——即使权限被拒/未执行 handler,后续插件也无机会(`loader.js:271-303`)。
  2. `lib/events/message.js:12` **未 await `deal()`** + context/accept/rule 无 try/catch → 易成 unhandled rejection。
  3. **全局单例 + Proxy 魔法**:`Yunzai` 构造返回 Proxy,属性解析链含"随机 bot 重定向"(`bot.js:72-84`),隐式行为多、难调试。
  4. **插件双实例化**:init 用一个实例、rule 用另一个新实例,init 副作用丢失(`loader.js:134-146`);加载顺序不确定。
  5. **热更新缺陷**:`changePlugin` 只换 priority 已有项;adapter 也被 watch 但不在 priority,热改会**重复 push** `Bot.adapter`/`Bot.wsf`(副作用叠加)。
  6. **游戏业务侵入核心**:`srReg/zzzReg`、`isSr/isGs/isZzz` setter 写在 loader(`loader.js:197-228`)。
  7. **Puppeteer 硬依赖**:启动即加载渲染后端,无降级路径(注释自带"待简化重构");Redis 连接失败可直接 `Bot.exit()`。
- **重构建议**:修正派发语义(拒绝/未命中→continue);`await deal` + 顶层 try/catch;依赖注入替代全局 Bot;消除双实例化、显式插件依赖与拓扑;adapter 移出 plugin 扫描+幂等 load;游戏前缀下沉到 genshin 的 preDeal hook;Puppeteer 懒加载+文本降级;Redis 可选(内存兜底 CD/计数)。

### 2.2 `genshin`（数据 & 账号 SSOT,基础设施）
- **定位**:米游社 live API + CK/UID 绑定 + 札记/体力/抽卡/充值/公告/兑换码。框架与 xiaoyao 都依赖它。
- **职责**:19 个 app(user 绑定、dailyNote 体力、gcLog 抽卡、ledger 札记、payLog 充值、role 角色深渊、calculator 养成、material 素材、mysNews 公告、exchange 兑换码、gacha 十连、noteZzz/buddy 绝区零…);`model/mys/*` 是全生态共享的米游社基础设施(mysApi 签名/缓存、apiTool URL 表、MysUser/NoteUser、DailyCache 公共 CK 池)。
- **关键脆弱点**:
  1. **DS 签名 salt 硬编码**(`mysApi.js:201-211`)、device_fp 伪造 payload——米游社策略变更即整体失效。
  2. **payLog 仅原神**(域名/`game_biz` 全 hk4e,`payLogData.js:180-206`)——**唯一真功能缺口**。
  3. **SR 抽卡 authkey** 扫码/cookie 拿不到(平台设计,见 multi-game §4)。
  4. 大量 `isSr ? a : b` 配置性分支未收敛(抽卡路径/Redis key、logCount、ledger 等)。
  5. **CK 校验只用 gs 接口**(`MysUser.js:228-247`)→ 纯 sr/zzz 账号可能被误判失效。
  6. `mysApi.getData` 失败仅 `return false`,无 retcode 分层。
- **重构建议**:region/biz/路径/key 统一查 `games.js`(删 `mysApi` 重复 region 表);CK 校验按账号实际拥有的 game 分流;`apiTool` 改声明式配置 + salt/app_version 外置便于热修;`getData` 返回 `{ok,retcode,message,data}`;payLog 需 sr/zzz 接口调研后再做。

### 2.3 `miao-plugin`（角色域事实标准库）
- **定位**:角色 meta + 面板 + 伤害计算 + 圣遗物评分 + 群排行 + 图鉴 + 深渊统计。是 genshin 的 Character/Weapon 数据与渲染素材来源。
- **职责**:8 个 app(profile 面板/排行/练度、character 卡片、stat 深渊统计[**胡桃DB,原神专属**]、wiki 图鉴/日历、gacha 抽卡分析…);`models/*` 领域模型(Character/Player/Avatar/ProfileDmg/ProfileRank/Meta);`resources/meta-gs|sr` 两套静态数据 + `calc.js` 伤害规则。
- **关键脆弱点**:
  1. **二元 gs/sr 模型,无 zzz**(`Base.isSr/isGs`、`models/index.js:20` 写死 `['gs','sr']`、无 `meta-zzz`)。
  2. **资源路径字面量** `meta-gs/meta-sr` 散布各模型;框架 `runtime.js` 写死 `_miao_path`。
  3. **被 ark-plugin 覆盖文件**(ProfileRank/ProfileDetail 等)→ `#喵喵更新`(`git checkout . && git pull`,`admin.js:152`)会**丢弃本地修改/与覆盖冲突**。
  4. stat 全家 Genshin-only(HutaoDB);`ProfileRank` 用 `redis.keys`(大群阻塞)。
  5. genshin↔miao **双向耦合**:miao 数据结构变更会 break genshin。
- **重构建议**:Base 游戏判断改 Games 表驱动、meta 路径走 `Meta.path(game,...)`;**给 ark 提供生命周期 hook/EventEmitter,替代文件覆盖**;`#喵喵更新` 改 `git stash`+提示,禁止无提示 `checkout .`;meta 数据与代码分离(submodule/data 包)降 merge 频率;`KEYS`→`SCAN`。

### 2.4 `xiaoyao-cvs-plugin`（genshin 之上的账号/UX 扩展）
- **定位**:米游社账号体系(cookie/stoken/扫码/密码)、多游戏签到、**可换肤体力便笺**、抽卡/充值、图鉴。**数据走 genshin,画面走自家模板**。
- **关键脆弱点**:genshin 硬依赖(多处 `file://` 动态 import,路径/API 变更即崩);V2/V3 双栈残留;**第三方验证码 URL**(`api.fuckmys.tk`)合规/可靠性风险;含 authkey 的导出链接私聊下发有泄露风险;`#体力` 与 genshin dailyNote **双渲染器竞争**(`sys.Note` 开关决定出哪张图)。
- **重构建议**:抽象 `MysAccountPort` 接口由 genshin 实现、失败降级而非 crash;删 V2 路径;验证码服务可配置化;导出链接短时效/一次性 token;体力模板做 `TemplateRegistry`。

### 2.5 `TRSS-Plugin`（官方工具箱 + Bot 全局补丁）
- **定位**:为 Yunzai 打全局能力补丁(`Bot.exec/glob/download`)+ 一组工具 app(米哈游登录、系统信息、图片修复/抠图、语音、网盘、**远程命令/文件**)。非游戏数据插件。
- **关键脆弱点**:**RemoteCommand/File 在主人权限下可执行 shell/读写文件 → RCE 面**;Python 子系统环境易缺失;miHoYoLogin 与 xiaoyao/genshin 登录重叠(cookie 格式可能不一致);全局 Bot monkey-patch 冲突风险。
- **重构建议**:远程命令默认关 + 独立 token + 白名单;Python 模块 lazy-load + feature probe;登录统一为"仅取 cookie,绑定走 genshin"。

### 2.6 `Guoba-Plugin`（Web 配置面板）
- **定位**:插件商店 + Bot/系统/各插件**在线改配置**的 Web UI。TRSS 整合模式下挂在 `:2536/guoba`(独立模式端口 50831)。
- **机制**:扫描 `plugins/*/guoba.support.js` 的 `supportGuoba()` 注册配置 schema;插件安装执行 `git clone`+`pnpm`。
- **关键脆弱点**:**Web 面板 = 管理权**,`skip_auth` 放行 mount 路径、仅靠 JWT secret,URL 泄露即失控;插件安装是供应链风险;端口 50831 vs 2536 认知易混。
- **重构建议**:强制改 JWT secret + HTTPS + IP 白名单 + 关群聊登录;插件安装 allowlist/签名 + diff 预览;README 写清两种访问 URL。

### 2.7 `ark-plugin`（miao 的侵入式扩展）
- **定位**:全服排名、群排行增强、幽境危战排名(akasha.cv)、面板 OCR、面板导入导出。
- **机制**:**双轨注入**——① 运行时 monkey-patch miao 的 `ProfileDetail/ProfileRank` 方法;② `#ark替换文件miao-rank` 用 `fs.cpSync` **覆盖 miao 的 5 个文件**(ProfileDetail.js/ProfileRank.js/profile.js + 2 html)。本套 miao 2.3.3,ark 改版 ProfileRank.js ~50% 重写。
- **关键脆弱点**:**直接改写 miao 源码**→miao 升级后冲突/静默失效(`#喵喵更新` 会丢弃);monkey-patch+覆盖双轨调试困难;**默认向第三方(ark.ivny.top)上传 UID+完整面板**、OCR 传图外发(隐私/合规);第三方服务单点;`fs.cpSync` 无原子回滚。
- **重构建议**:优先纯 runtime hook、放弃文件覆盖;全服排名做 opt-in + 本地排名默认开;排名/OCR 离线降级 + 缓存;替换前强制备份 + checksum。
- **注**:幽境危战排名**无需替换文件**即可用;替换只为群面板排行增强。详见 `docs/`(本仓已审查 ark 替换清单与风险)。

---

## 3. 为什么"感觉脆弱"——跨仓共性问题(根因)

1. **三层强耦合 + 寄生/侵入**:框架→genshin→miao 硬依赖,xiaoyao 寄生 genshin,ark 改写 miao。**没有稳定接口边界**,任一处变动横向击穿。
2. **派发语义脆弱**:首个正则匹配即终止 + 不 await + 多处无 try/catch → 一条规则的小问题可能吞掉后续插件或变成静默失败。
3. **全局可变状态**:`global.Bot` Proxy、全局 Map(stateArr/cacheMap)、monkey-patch,行为隐式、热更新易泄漏/叠加副作用。
4. **多游戏二元化**:gs/sr 写死、无 zzz 数据、配置性分支散布;加游戏成本高。
5. **米游社 API 易碎**:salt/device_fp/authkey 硬编码且随官方策略失效(SR 抽卡 authkey 直接不可得)。
6. **侵入式升级冲突**:ark 覆盖 miao、各处本地 fork 改动,`git pull/checkout .` 易冲突或丢改动。
7. **安全面**:Guoba Web 面板、TRSS 远程命令、含 authkey 的导出链接、第三方上传——任一配置不当即高风险。
8. **运维硬依赖**:Puppeteer(出图)、Redis(CD/缓存)无降级,缺一即大面积功能不可用。

---

## 4. 重构优先级路线（建议）

**P0 稳健性地基(低风险高收益)**
- 修 `loader.deal()` 派发语义(拒绝/未命中→continue)、`await deal` + 顶层 try/catch、结构化 tracing(event/plugin/耗时)。
- adapter 移出 plugin 扫描 + `load()` 幂等;消除插件双实例化。
- region/biz/路径/key 收敛到 `games.js`(genshin);CK 校验按 game 分流。

**P1 边界与接口化**
- 定义稳定接口:`MysAccountPort`(账号)、`GameMeta/StatProvider/RankProvider`(miao 域)、`Renderer`(出图降级)。
- miao 给 ark 提供 **hook/事件** 替代文件覆盖;`#喵喵更新` 安全化。
- 多游戏 Games 表驱动收敛剩余二元分支。

**P2 健壮性与安全**
- Puppeteer 懒加载 + 文本/预渲染降级;Redis 可选内存兜底。
- Guoba/TRSS 远程能力默认关 + token + 白名单 + HTTPS;含 authkey 链接短时效。
- ark 全服排名/OCR opt-in + 离线降级。

**P3 功能缺口与产品**
- payLog 多游戏(需接口调研);SR 抽卡 UX(贴一次链接 + 24h 缓存,文档化);zzz 端到端(meta-zzz/签到补全,延后)。

---

## 5. 变更记录
- `2026-05-31` 创建:4 路并行只读探查 + 综合,产出本评审(框架/genshin/miao/xiaoyao/TRSS/Guoba/ark 七部分 + 跨仓根因 + P0–P3 路线)。
