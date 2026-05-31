# Yunzai 目标架构设计（统一架构 + 官方扩展接口）

> 本文是**目标设计(To-Be)**,回答"统一架构长什么样、官方扩展接口怎么定、各 repo 如何按它迁移"。
> 配套:`architecture-review.md`(现状诊断 As-Is)、`unified-refactor-plan.md`(生态调研 + 路线)、`multi-game-refactor.md`(多游戏)。
> 设计目标(四条硬约束):**① repo 内部自洽 ② repo 之间解耦独立 ③ 功能紧密协作 ④ 绝不侵入式改造**。
> 创建：`2026-05-31`。本文为设计,不含改动。

---

## 1. 目标架构总览

### 1.1 分层(自下而上)
```
┌─ L0 核心运行时 Core Runtime  (lib/)──────────────────────────────┐
│   进程/事件总线/消息派发/插件生命周期/配置/Redis。零游戏逻辑。     │
├─ L1 契约层 Core SDK / Contracts (lib/contracts, 版本化)──────────┤
│   接口定义 + 三大基础设施: CapabilityRegistry · HookBus · ServiceLocator │
│   领域契约: AccountPort · GameRegistry · GameDataProvider ·       │
│             RankProvider · StatProvider · Renderer · TemplateRegistry │
├─ L2 能力提供者 Capability Providers (插件,provide 能力)──────────┤
│   account-provider(米游社账号)  game-data-provider(角色/面板/伤害) │
│   renderer-provider(出图)        (各自 core.provide(...))          │
├─ L3 功能插件 Feature Plugins (消费能力 + 提供命令)───────────────┤
│   genshin功能(体力/札记/抽卡)  miao功能(面板/群排行)  xiaoyao(签到/美化)│
├─ L4 扩展插件 Extension Plugins (只通过 hook 挂接,不碰他人文件)────┤
│   ark(全服排名/幽境/嵌入)  liangshi(伤害)  Atlas(图鉴) …          │
└──────────────────────────────────────────────────────────────────┘
通信规则: 上层只依赖 L1 契约;实现通过 L1 注册/发现;扩展只通过 HookBus。
禁止: 跨 repo `import` 内部文件、`fs.cpSync` 覆盖他人文件、monkey-patch 他人方法。
```

### 1.2 每层职责
| 层 | 职责 | 不该做 |
|---|---|---|
| L0 运行时 | 收发消息、派发、CD/权限、加载、渲染调度 | 不含 gs/sr 游戏判断、不 import 任何插件内部 |
| L1 契约 | 定义接口 + 注册/发现/hook 基础设施 | 不含具体实现(只接口 + mock) |
| L2 提供者 | 实现并 `provide` 一种能力 | 不直接 import 其它提供者实现 |
| L3 功能 | `require` 能力 + 注册命令出图 | 不 import 他人内部、不假设他人存在(降级) |
| L4 扩展 | `hook.on(...)` 注入增强 | 不覆盖/不 patch,只订阅 hook |

### 1.3 四条硬约束如何落地
- **独立**:任一 repo 只 `import 'contracts'`。删掉 miao,genshin 仍加载(面板类降级提示)。
- **解耦**:实现通过 `CapabilityRegistry` 运行时注入;消费方拿到的是接口。
- **紧密协作**:provider 启动注册能力,consumer 调接口即得到对方能力,体验上"无缝"。
- **非侵入**:增强他人行为 = 订阅他人发布的 hook;**永不改他人文件**。

---

## 2. 官方扩展接口规范（Core SDK / Contracts）

> 放在 `lib/contracts/`(或独立包 `@yunzai/core`)。**全部版本化**(`contracts.version`),破坏性变更升大版本。
> 下列签名为设计意图(伪代码),最终以 TS 风格类型 + JSDoc 落地。

### 2.1 ServiceLocator + CapabilityRegistry（能力注册/发现）
```js
// 提供者注册(在插件 init 时)
core.provide('account', accountImpl, { version: '1.x', plugin: 'genshin' })
core.provide('gameData', miaoDataImpl, { version: '1.x', plugin: 'miao-plugin' })

// 消费者获取(取不到 → null,调用方负责降级)
const account = core.require('account')        // => AccountPort | null
if (!account) return e.reply('账号能力未安装')

core.has('rank')                                // => boolean
core.list()                                     // => [{name, version, plugin}]
```
- **一种能力可被多 provider 注册**(如多个面板数据源),按 `priority`/配置选择。
- **降级语义**:`require` 失败不抛错,返回 null;功能插件据此给友好提示。

### 2.2 HookBus（生命周期事件 —— 替代侵入的核心）
```js
// 订阅(扩展插件)
core.hook.on('profile:beforeRender', 20, async (ctx) => {
  // ctx 可读可改: ctx.data, ctx.uid, ctx.game; 返回 void 或修改后的 ctx
  ctx.data.globalRank = await myRankApi(ctx.uid)
})

// 发布(被增强方,如 miao 在渲染前)
ctx = await core.hook.emit('profile:beforeRender', ctx)   // 串行、按 priority、可改 ctx
const passed = await core.hook.filter('rank:allow', e)     // 任一返回 false 即拦截
```
**标准 hook 点(初版清单,可扩展)**:
| Hook | 时机 | 典型订阅者 |
|---|---|---|
| `message:preDeal` | deal() 早期(游戏前缀解析也走这里) | genshin(设 e.game) |
| `account:afterBind` | 绑定/扫码成功后 | 统计、欢迎 |
| `profile:afterData` | 面板数据取到、计算前 | liangshi(伤害) |
| `profile:beforeRender` | 面板出图前(可塞全服排名/嵌入) | **ark** |
| `rank:query` | 群/全服排名查询 | **ark**(全服) |
| `gacha:afterFetch` | 抽卡数据抓取后 | 自定义分析 |
| `render:before` / `render:after` | 出图前后 | 水印/降级 |

> **ark 全服排名/嵌入排名 = `hook.on('profile:beforeRender')` + `provide('rank', 全服Impl)`**,不再覆盖 `ProfileRank.js`。

### 2.3 领域契约接口（节选,签名示意）
```js
// 账号(genshin 实现)
interface AccountPort {
  getUid(e, game): Promise<string|null>
  getCookie(e, game): Promise<string|null>
  getStoken(e): Promise<object|null>
  mysApi(uid, ck, { game }): MysApiClient        // 取数客户端
  genAuthKey(e, { game, game_uid, region }): Promise<string|null>
}

// 多游戏 SSOT(genshin/games.js 实现; L1 也可内置默认)
interface GameRegistry {
  games(): string[]                               // ['gs','sr','zzz']
  resolveGame(e): string
  biz(game, isOs?): string
  region(uid, game): string
  prefix(game): string                            // '#' '*' '%'
  term(game, key): string                         // weapon/relic/talent...
  gachaPools(game): Pool[]
  tplDir(game): string
  uigfKey(game): string
}

// 角色/面板/伤害(miao 实现)
interface GameDataProvider {
  getCharacter(name, game): Character|null
  getProfile(uid, game): Profile|null
  calcDamage(profile, opts): DmgResult
  scoreArtifact(profile, opts): MarkResult
  metaPath(game, type, name, file): string        // 取代散落字面量
}

// 排行/统计(miao 群排行 + ark 全服)
interface RankProvider {
  getGroupRank(groupId, charId, mode, game): Promise<Entry[]>
  getGlobalRank?(uid, charId, game): Promise<Entry|null>   // 可选(ark)
}
interface StatProvider { getAbyss?(game): ...; getStygian?(game): ... }  // 可空,无则命令提示"暂不支持"

// 出图(框架/puppeteer 实现,带降级)
interface Renderer {
  render(tpl, data, { fallbackText? }): Promise<Image|Text>
}

// 模板注册(体力/面板皮肤等)
interface TemplateRegistry {
  register(name, meta): void
  list(category): TemplateMeta[]
  resolve(category, id): TemplateMeta
}
```

### 2.4 插件清单 PluginManifest（声明式元信息）
```js
// 每插件根 manifest.js(替代隐式约定)
export default {
  name: 'ark-plugin', version: '2.x',
  provides: ['rank'],                       // 我提供的能力
  requires: ['gameData', 'account'],        // 我依赖的能力(缺失→降级)
  hooks: ['profile:beforeRender', 'rank:query'],
  guoba: true,                              // 是否提供 Web 配置
}
```
→ 框架据此做**依赖拓扑加载**、缺失能力**降级而非崩溃**、Guoba 自动发现。

---

## 3. 现状 → 目标 · 各 repo 映射

| repo | 现状角色 | 目标角色 | provide | require | 去除的侵入 |
|---|---|---|---|---|---|
| **lib/(框架)** | 运行时 + 夹带游戏逻辑 | 纯 L0 运行时 + 承载 L1 契约 | HookBus/Registry/Renderer | — | 移除 `srReg/isSr` 等游戏逻辑→hook |
| **genshin** | 数据&账号 + 大量硬编码 | L2 `account-provider` + L3 功能 | `account`、`gameRegistry` | `gameData`(图标/别名)、`renderer` | 不再被 xiaoyao `file://` 直 import |
| **miao** | 角色域 + 被 ark 改写 | L2 `game-data-provider` + L3 面板/群排行 + **发 hook** | `gameData`、`rank`(群) | `account`、`renderer` | 暴露 hook,**不再被覆盖文件** |
| **xiaoyao** | 寄生 genshin | L3 功能(签到/体力皮肤) | `template`(体力皮肤) | `account`、`gameRegistry`、`renderer` | 删 `file://` import,改 `require('account')` |
| **ark** | **覆盖 miao 文件** | L4 扩展 | `rank`(全服,可选) | `gameData` + hook 订阅 | **删除 `#ark替换文件` + monkey-patch** |
| **TRSS-Plugin** | 工具箱 + Bot 补丁 | L3/工具 | — | — | 全局 Bot 补丁改为显式 import;远程命令收口 |
| **Guoba** | Web 配置 | 运维(读 manifest.guoba) | — | manifest | 走 manifest 发现而非约定文件 |

---

## 4. 关键改造范例（前后对比）

### 4.1 ark 全服排名:覆盖文件 → 订阅 hook
**现状(侵入)**:
```text
#ark替换文件miao-rank  →  fs.cpSync 覆盖 miao/apps/profile/ProfileRank.js 等 5 文件
+ 运行时 monkey-patch miao ProfileDetail.render
→ miao 升级即冲突/失效
```
**目标(非侵入)**:
```js
// miao 在渲染面板前发布 hook(miao 自己加,一次性)
ctx = await core.hook.emit('profile:beforeRender', { uid, game, data })

// ark 订阅(完全独立,不碰 miao 文件)
core.hook.on('profile:beforeRender', 20, async (ctx) => {
  ctx.data.globalRank = await arkApi.getRank(ctx.uid, ctx.game)  // 失败则跳过
})
core.provide('rank', { getGlobalRank: arkApi.getRank })          // 提供全服排名能力
```
→ miao `git pull` 不再冲突;ark 装/卸即插即用;关掉 ark,miao 面板照常(无 globalRank 字段)。

### 4.2 xiaoyao 体力:`file://` import genshin → require 能力
**现状**:`await import('file://.../genshin/model/mys/mysInfo.js')`(路径/API 变即崩)。
**目标**:
```js
const account = core.require('account')
if (!account) return e.reply('账号能力未安装,请安装 genshin 提供者')
const note = await account.mysApi(uid, ck, { game }).getData('dailyNote')
// 体力皮肤改为 templateRegistry 选择
```

### 4.3 框架渲染:去 `_miao_path` 硬编码
**现状**:`runtime.render()` 写死 `plugins/miao-plugin/resources/`。
**目标**:渲染数据里的资源前缀由 `gameData.metaPath()` / 已注册 renderer 资源根提供;无 miao 时用占位图降级。

---

## 5. 目录 / 包布局(目标)
```
Yunzai/
├── lib/
│   ├── core/                 # L0 运行时(派发/生命周期,去游戏逻辑)
│   └── contracts/            # L1 契约层(本次新增,核心)
│       ├── index.js          # 导出 core: { provide, require, has, hook, ... }
│       ├── registry.js       # CapabilityRegistry + ServiceLocator
│       ├── hookbus.js        # HookBus(on/emit/filter, priority)
│       ├── ports/            # AccountPort/GameRegistry/GameDataProvider/... 接口 + JSDoc
│       └── mock/             # 各接口 mock 实现(供插件单测/独立运行)
└── plugins/
    ├── genshin/              # provide:account,gameRegistry ; manifest.js
    ├── miao-plugin/          # provide:gameData,rank ; 发 hook ; manifest.js
    ├── xiaoyao-cvs-plugin/   # require:account ; provide:template
    └── ark-plugin/           # hook.on + provide:rank(全服) ; 无文件覆盖
```
> 契约层先放本仓 `lib/contracts`(零外部依赖);成熟后可抽成 npm 包 `@yunzai/core` 供生态共用(给社区一个"官方扩展接口")。

---

## 6. 迁移顺序(细化,对齐 unified-refactor-plan 的 P0–P5)
1. **P0 护栏**:回归基线 + 修派发语义/await/错误边界 + adapter 隔离 + 消除双实例化。(不引入契约,纯加固)
2. **P1 立契约**:写 `lib/contracts`(Registry/HookBus/接口/mock) + manifest 规范 + 文档。**此时无人使用,零风险**。
3. **P2 提供者接入**:genshin `provide('account','gameRegistry')`;miao `provide('gameData','rank')` 并**埋 hook 点**;框架 render 去硬编码。旧 import 路径保留为兼容垫片(deprecated)。
4. **P3 消费者/扩展迁移**:xiaoyao 改 `require`;**ark 改 hook 订阅,删 `#ark替换文件`**;其它扩展按指南接入。
5. **P4 收敛**:删兼容垫片;多游戏二元分支清零;协议/平台统一 adapter 契约。
6. **P5 验收**:写一个"新功能/新游戏"demo,**只加 1 插件 + 配置、零改 L0/L1**,跑通取数→计算→出图→回复。

每步:行为保持(对回归基线)、可独立上线/回退、本机逻辑校验 + PC 出图终验。

---

## 7. 关键设计决策与取舍
- **为何用 Registry+Hook 而非直接 import?** 直接 import 造成编译期硬耦合 + 侵入;Registry/Hook 是运行期、可选、可降级,天然满足"独立+紧密+非侵入"。
- **为何契约要版本化?** 生态插件众多,接口演进必然;版本化让 provider/consumer 能协商兼容,避免一改全崩。
- **为何先放 `lib/contracts` 而非立刻抽 npm 包?** 降低初期成本与发布复杂度;稳定后再抽包回馈社区(成为"官方扩展接口")。
- **兼容垫片(shim)策略**:P2/P3 期间保留旧 `#miao.models`/`file://` 路径作 deprecated 转发,给生态插件迁移缓冲,P4 再移除。
- **降级优先**:任何 `require` 失败、renderer 缺失、provider 未装 → 友好提示 + 功能降级,杜绝 crash/静默失败。
- **非目标(本期不做)**:不重写 miao 伤害引擎、不替换 Enka 等外部数据源、不强推社区插件改造(只提供接口 + 指南)。

## 8. 参考架构借鉴与查漏补强（2026-05-31）

> 调研了两个成熟大项目作为镜子(均非 Yunzai 插件,仅借鉴架构):
> **MAA**([MaaAssistantArknights](https://github.com/MaaAssistantArknights/MaaAssistantArknights),21k★,明日方舟自动化)——**可扩展架构范本**;
> **arkime**([arkime/arkime](https://github.com/arkime/arkime),7.4k★,网络抓包分析)——组件解耦 + 安全基线。

### 8.1 印证(我们的方向是对的)
| 借鉴点 | 来源 | 对应我们的设计 |
|---|---|---|
| **框架/资源分离**:通用引擎 `MaaFramework` + 游戏数据 `resource/`(JSON+图),加关卡≈改 JSON 不动引擎 | MAA | L0/L1 核心 vs L2+ 游戏数据分层 ✅ |
| **声明式协议 + 多语言稳定 API**(任务流程/回调消息协议、`interface.json`) | MAA | 契约层 + Manifest + HookBus ✅ |
| **独立组件用稳定数据格式通信**(capture/viewer/DB via PCAP/SPI) | arkime | 能力注册 + 契约接口 ✅ |
| **可插拔集成服务**(`wiseService` 情报) | arkime | CapabilityRegistry/Provider ✅ |

### 8.2 查漏补强(之前漏掉,纳入设计,避免返工)
1. **测试/CI 一等公民**:重构前先建**回归测试套件 + CI**(stdin 注入命令断言输出、契约 mock 单测、关键家族快照)。MAA(`unit_test`+`MaaTestSet`)/arkime(`tests/`)均重度测试。→ 落到 P0,作为每步"行为保持"的护栏。
2. **资源/数据层独立版本化**:miao 的 `meta/calc/模板`、术语、卡池、攻略图等"高频变更数据"抽成**可独立更新的数据包**(submodule 或 data 包),与引擎代码解耦、各自版本化。**直接根治** ark 覆盖 + `#喵喵更新` 冲突 + calc.js 频繁 merge。MAA 的 resource/binary 分离即此。
3. **声明式"功能/命令协议"**:不止"配置驱动"——把**命令/功能定义也做成声明式 manifest**(命令 → 能力依赖 → 渲染模板),加功能 ≈ 加声明 + 数据,零改引擎。对标 MAA 任务流程协议。
4. **协议文档作为交付物 + 版本化**:`contracts`/HookBus/Manifest/数据包格式都要有**正式协议文档 + 版本号**(对标 MAA 的协议文档),否则生态无法照接;这是"官方扩展接口"真正可用的前提。
5. **数据迁移策略**:重构改 redis key/存储路径(抽卡/绑定等)时,必须配**迁移脚本 + 兼容读取**(旧 key 命中则迁移),保证老用户数据不丢。→ 列入各改存储的任务验收项。
6. **安全基线作为横切原则**(对标 arkime):认证(Guoba JWT/TRSS 远程命令)、配置/密钥保护、最小权限、含 authkey 链接短时效、第三方上传 opt-in。→ 提升为设计原则(§1.3 之外的第 8 条"默认安全")。
7. **可观测性**(已在 P0):结构化 tracing(event/plugin/耗时/错误),便于定位"静默失败"。

### 8.3 边界(借鉴但不照搬)
- arkime 是多进程/大数据/多语言重型系统,Yunzai 是单进程 Node 小型 bot——**不引入** ES/多语言/微服务那套,只取"组件解耦 + 稳定契约 + 安全基线"。
- MAA 是本地 GUI + 图像识别,**不引入** CV/任务调度引擎;只取"框架/资源分离 + 声明式协议 + 测试文化"。

---

## 9. 开源框架借鉴与设计收敛（IM bot 框架 + 通用扩展系统）

> 取经 4 个标杆,把本设计从"自创"升级为"对齐成熟范式"。其中 **Koishi/Cordis 与我们同领域,几乎量身定做**。

### 9.1 标杆与可借鉴模式
| 项目 | 领域 | 关键模式 |
|---|---|---|
| **Koishi / Cordis** | TS 聊天机器人框架 | **Context**(插件唯一句柄,副作用自动追踪,`ctx.dispose()` 一键回收→真热重载/零泄漏/加载顺序无关);**Service**(provide/inject 的 IoC,生命周期按依赖关系而非加载顺序,provider 卸载 consumer 自动停,required/optional,服务隔离) |
| **NoneBot2** | Python 机器人框架 | `require()` 声明跨插件依赖;`PluginMetadata`(type=library/application、config、supported_adapters、extra);社区明确反对"侵入式改默认行为" |
| **VS Code 扩展** | 编辑器扩展(非侵入金标准) | **contributes** 声明式贡献点(不跑代码注册能力);**activationEvents 懒激活**(用到才加载);只经 **API** 互通绝不碰彼此代码;**扩展宿主进程隔离** + 单一权威协议 `extHost.protocol.ts`;`subscriptions` 清理 |
| **tapable**(webpack) | 通用 hook 库 | **带类型 hook**:Waterfall(值一路传/改)、Bail(返回非空即否决/中断)、Series/Parallel(通知);hook 挂 `this.hooks` 自描述;`tap(名字,fn)` 便于诊断 |

### 9.2 收敛决定（"如何统一"的答案）
| 本文原设计(§2) | 对齐到 | 收敛后决定 | 根治的脆弱点 |
|---|---|---|---|
| CapabilityRegistry | Koishi **Service** | provide/inject + required/optional + **生命周期按依赖(非加载顺序)** + provider 卸载 consumer 自动停 | 加载顺序不确定、跨插件硬 import |
| (原缺) | Koishi **Context + dispose** | 每插件 scoped `ctx`,副作用自动追踪,`dispose()` 回收 | **双实例化、热更新重复 push、副作用泄漏** |
| HookBus | **tapable** typed hooks | 分 Waterfall(改 ctx)/Bail(否决)/Series(通知),named tap + interceptor 追踪 | ark 非侵入扩展的载体 |
| PluginManifest | VS Code **contributes** + NoneBot **PluginMetadata** | 声明式 contributes(命令/配置/hook)+ **懒激活** + metadata(type/requires/provides/version) | 启动脆弱、Guoba 配置发现 |
| "禁止碰他人文件" | VS Code **API 边界** + NoneBot 立场 | 只经 service/hook/API,**绝不 import 内部/覆盖文件/monkey-patch** | ark 侵入、xiaoyao 寄生 |
| 稳定隔离 | VS Code **扩展宿主** | 单进程 Node 无法进程隔离 → 用**每插件错误边界 + 单一权威 contracts 协议**达等效稳定 | 单插件错误拖垮全局 |

### 9.3 最重要的两条结论
1. **P0 的"消除双实例化/修热更新"升级为"引入 Context+dispose+Service 模型"**——这是**根治**(Koishi 已证明聊天机器人框架可以有干净可逆插件),而非打补丁。
2. **不必重造轮子**:Koishi 内核 **[Cordis](https://github.com/cordiverse/cordis)** 是独立可复用的 DI/插件框架(Context/Service/dispose 即来自它)。**契约层(L1)可评估直接构建在 Cordis 之上**,我们只聚焦"领域契约(AccountPort/GameData/…)+ hook 点 + 迁移",大幅降低自研成本与风险。
3. **新增"懒激活"原则**(VS Code):插件/功能按需激活(命令前缀命中才加载),降低启动期脆弱性与资源占用。

### 9.4 对落地的影响(调整 §2/§6)
- §2 的 `Registry/HookBus` 实现**优先评估 Cordis**;若自研,语义须对齐(Service 依赖生命周期、tapable hook 类型)。
- §6 迁移顺序 P1 增加任务:**"评估 Cordis 作为契约层基座 vs 自研"** 的技术选型决策(POC + 取舍)。
- HookBus 的 `emit/filter` 明确语义:`emit`=Waterfall(可改 ctx)、`filter`=Bail(任一 false 否决)、`notify`=Series(纯通知)。

---

## 10. 宿主适配层 & 渐进迁移（基于 cordis 3.18.1，落地设计）

> ADR-001 定:L1 基座复用 **cordis `3.18.1`**(稳定版)。本节定"怎么把它挂进现有 Yunzai、且不爆改"。

### 10.1 核心思路:`core` 门面隔离 + 单根 Context
- 启动时(Bot 初始化后)建**一个根 Context**,挂到 `Bot.ctx`(进程级 L1 宿主)。
- 在其上暴露一层**薄门面 `core`**,**所有插件只用 `core.*`,不直接碰 cordis API**——这样 cordis 升级/将来换实现都不波及业务:
```js
// lib/contracts/index.js（设计草图，1-01 实现）
import { Context } from "cordis"
const ctx = new Context()
export const core = {
  provide: (name, impl) => ctx.set(name, impl),      // 能力注册（Service/set）
  require: (name) => ctx[name] ?? null,              // 取能力（取不到→null→降级）
  has: (name) => ctx[name] != null,
  hook: {
    on:   (name, fn) => ctx.on(name, fn),
    emit: (name, payload) => ctx.emit(name, payload),// notify/改ctx（引用改写）
    veto: (name, ...a) => !!ctx.bail(name, ...a),    // 否决（返真值=拦截，ADR-002）
  },
  scope: (fn) => ctx.plugin(fn),                     // 子作用域（dispose 可逆）
}
export default core
```
> POC 已验证:`set/取` 能力、`emit`+引用改写、`bail` 否决、`dispose` 卸载即移除,均通过。

### 10.2 与现有框架共存（不替换 loader）
- **旧 `lib/plugins/loader.js` 不动**:命令插件继续按老方式加载/派发(短期)。
- **新增能力/契约/hook 走 `core`**:
  - 提供方(genshin/miao)在各自插件 `init` 里 `core.provide('account', impl)`;
  - 消费方 `core.require('account')`,**取不到就降级提示**(不 crash);
  - 扩展(ark)`core.hook.on('profile:beforeRender', …)`,**不再覆盖文件**。
- **hook 埋点逐步加**:在 miao 渲染面板前加 `core.hook.emit('profile:beforeRender', data)` 等,一处一处接。

### 10.3 渐进迁移阶段（每步可独立验证/回退）
| 阶段 | 内容 | 行为变化 |
|---|---|---|
| **A** | 立 `Bot.ctx` + `core` 门面 + mock,**无人使用** | 零(纯新增) |
| **B** | genshin `provide('account','gameRegistry')`;旧 `file://` import 留 deprecated 垫片 | 零(新老并存) |
| **C** | miao `provide('gameData','rank')` + 埋 hook 点;**ark 改 `hook.on`,删 `#ark替换文件`** | ark 行为等价、不再侵入 |
| **D** | 命令派发迁入 Context/中间件(大件,需回归基线);删垫片 | 需基线护住 |

### 10.4 设计要点 / 风险
- **门面隔离**是关键:业务只依赖 `core` 接口,cordis 是可替换实现细节。
- 一个进程一个根 Context;每插件用 `core.scope()` 拿子作用域,卸载即回收(根治双实例化/热更新)。
- 3.x DI 时序(`inject`/`using` 何时触发)在 1-01 用真例敲定。
- D 阶段(派发迁移)风险最高,**必须先有 `0-00` 回归基线**。

---

## 变更记录
- `2026-05-31` 创建:目标分层 + 官方扩展接口规范(Registry/HookBus/领域契约/Manifest) + 各 repo 映射 + ark 等改造范例 + 目录布局 + 迁移顺序 + 设计取舍。
- `2026-05-31` 补 §8:借鉴 MAA(框架/资源分离·声明式协议·测试)与 arkime(组件解耦·安全基线);查漏补强 7 项(测试CI/资源独立版本化/声明式功能协议/协议文档/数据迁移/安全基线/可观测性)。
- `2026-05-31` 补 §9:借鉴 Koishi/Cordis(Context+dispose·Service DI)、NoneBot2(require·metadata)、VS Code(contributes·懒激活·API 边界·宿主隔离)、tapable(typed hooks);收敛决定 + 评估直接复用 Cordis 作为契约层基座。
- `2026-05-31` 补 §10:ADR-001 POC 实证后定**复用 cordis 3.18.1 稳定版**;给出宿主适配层(`core` 门面 + 单根 Context)与渐进迁移 A→D 设计(不爆改、可回退)。
