# Yunzai 大一统重构规划（生态调研 + 功能流程 + 目标架构 + TODO）

> 目标：让"单个 repo 内部自洽、repo 之间解耦独立,但功能紧密协作,且**绝不侵入式改造**(杜绝 ark 式覆盖文件)",
> 形成可持续扩展的统一架构,为后续**加功能/加游戏/加平台**打基础。
> 文档总入口见 **`docs/README.md`**;**执行进度/调试在 `docs/refactor-progress.md` 实时记录**(本文是稳定路线,进度不写这里)。
> 配套阅读:`docs/target-architecture.md`(目标设计)、`docs/architecture-review.md`(现状诊断)、`docs/multi-game-refactor.md`(多游戏与 SR 结论)。
> 创建：`2026-05-31`。本文为**规划**,不含改动。

---

## 第一步 · 社区 Yunzai 插件生态调研

数据源:[yhArcadia/Yunzai-Bot-plugins-index](https://github.com/yhArcadia/Yunzai-Bot-plugins-index)(1.2k★ 官方风索引)+ 各插件仓库。
**共性约定**:所有插件都遵循"克隆进 `plugins/<name>/` → `pnpm i` → 自动加载"的契约;命令前缀 `#`原神 / `*`星铁 / `%`绝区零。

### 生态分层(按职责)
| 层 | 代表插件 | 说明 |
|---|---|---|
| **框架/应用端** | TRSS-Yunzai、Miao-Yunzai、Yunzai-V3 | WS 服务端 + 调度 |
| **协议适配** | 内置 adapter、ws-plugin、TRSS-WeChat-OC | 接入 QQ/微信/onebot |
| **游戏数据核心** | **genshin**(米游社 API/账号)、**miao-plugin**(面板/伤害/排行)、ZZZ-Plugin(绝区零)、StarRail | 数据 + 计算 |
| **游戏数据扩展** | **ark-plugin**(全服排名/幽境,**侵入式**)、liangshi-calc(伤害)、Atlas(图鉴)、panel-plugin(面板数据操作)、xiaoyao-cvs(签到/体力美化) | 大多**依赖/扩展 miao 或 genshin** |
| **管理/运维** | Guoba(Web 配置)、group-plugin、blacklist、Napcat/mcsmanager、micro-plugin | |
| **AI/绘图/语音** | siliconflow、Y-Tian、chatai、nai/mj/vits/fish-speech | |
| **推送/订阅** | GamePush(版本)、yuki(B站/微博)、bililivePush | |
| **娱乐** | Gi/liulian/wordle/steam/pixiv… | 海量 |

### 关键观察(对重构的启示)
1. **扩展插件普遍"寄生"核心**:ark / liangshi-calc / panel-plugin / xiaoyao 都依赖 miao 或 genshin 的**内部实现**(import 内部文件、甚至覆盖文件)。这正是脆弱性来源——**社区缺乏"官方扩展接口",于是大家靠 hack**。
2. **我们的机会**:若我们的核心(genshin+miao 这套)对外暴露**稳定契约 + hook/事件**,扩展插件就能"挂接"而非"改写"——这正是"紧密协作但非侵入"的解法。
3. **加载契约已统一**(`plugins/*` 自动加载),所以解耦的关键不在"加载",而在**模块间的调用方式**(内部 import vs 契约接口)。

---

## 第二步 · 功能清单与执行流程

### 2.1 功能清单(本套已装,按家族)
| 家族 | 命令示例 | 提供者 | 数据源 |
|---|---|---|---|
| 账号绑定/扫码登录 | `#绑定ck` `#扫码登录` | genshin + xiaoyao + TRSS | 米游社 |
| 体力/便笺 | `#体力` `*体力` | genshin(原版) / xiaoyao(美化) **双渲染** | 米游社 dailyNote |
| 札记/月历 | `#原石` `*星琼` | genshin ledger | 米游社 |
| 抽卡记录/分析 | `#抽卡分析` `*更新抽卡记录` | genshin gcLog(+miao 分析) | authkey(SR 需贴链接) |
| 充值记录 | `#充值记录` | genshin payLog(**仅原神**) | 米游社自助 |
| 角色面板/伤害/圣遗物 | `#雷神面板` | miao | Enka/MiniGG/米游社 |
| 群内面板排行 | `#面板排行` | miao ProfileRank | 群内上传面板 |
| 全服排名/幽境危战 | `#幽境危战排名` | **ark(侵入式)** | akasha.cv / ark.ivny.top |
| 图鉴/日历/今日素材 | `#日历` `#今日素材` | miao / Atlas | 静态 meta |
| 兑换码/公告 | `#兑换码` `#公告` | genshin | 米游社 |
| Web 配置 | `:2536/guoba` | Guoba | guoba.support.js |

### 2.2 统一执行流程(消息生命周期)
```
协议端(微信/QQ) ──reverse WS──> adapter(plugins/adapter/*) ──Bot.em(事件)──>
  lib/events/message.js ──> PluginsLoader.deal(e):
    统计 → 黑白名单 → CD/节流 → dealEvent(解析 msg/at/isMaster)
      → 游戏前缀(e.game) → reply 包装 → Runtime.init(建 e.user/MysInfo)
      → 按 priority 过滤 → 首个正则命中的插件 fnc(e)
    ──> 业务: 取数(米游社/Enka) → 计算(miao) → 渲染(puppeteer 出图) → e.reply()
  ──> adapter sendMsg ──> 协议端 ──> 群里
```
> 典型差异:`#体力`=取数(genshin/米游社)+出图(genshin 或 xiaoyao 模板);`#面板`=Enka 取展柜→miao 计算伤害/评分→出图;`#幽境危战排名`=ark 调 akasha→出图。
> 流程脆弱点(详见 architecture-review §1/§2):**首个正则命中即终止**、未 await、出图硬依赖 puppeteer、取数依赖米游社签名/authkey。

---

## 第三步 · 架构依赖现状 → 目标架构

### 3.1 现状依赖(问题:强耦合 + 侵入)
```
框架 runtime ──硬import──> genshin ──import #miao.models──> miao
xiaoyao ──file://动态import 内部文件──> genshin
ark ──覆盖文件 + monkey-patch──> miao        ← 侵入式,升级即冲突
```
**三类耦合**:① 框架↔核心硬依赖;② 扩展↔核心"import 内部实现";③ ark 式"改写文件"。**都违背"独立 + 非侵入"**。

### 3.2 目标架构原则(本次重构的"宪法")
> 一句话:**repo 之间只通过"稳定契约"通信,扩展只通过"注册 hook/能力"挂接,任何 repo 都不读/改另一个 repo 的内部文件。**

1. **契约层(Core SDK / Contracts)**:抽出一个**稳定接口层**(可放本仓 `lib/contracts` 或独立小包),定义跨 repo 的接口与事件,**版本化**。所有 repo 只依赖契约,不依赖彼此内部。
2. **能力注册 + 服务发现(Capability Registry)**:插件启动时向核心注册自己**提供的能力**(如 `account`、`gameMeta`、`panelProvider`、`rankProvider`、`renderer`),消费方按接口取用,而非 `import '../../x/model/y.js'`。
3. **Hook / 事件总线(替代侵入)**:核心在关键节点(如"面板渲染前/后""排名更新""出图")发布 hook;扩展(如 ark)**订阅 hook 注入逻辑**,而不是覆盖文件。→ **彻底消灭 ark 式文件覆盖**。
4. **依赖倒置**:miao 依赖 `GameDataProvider` 接口(谁实现无所谓);genshin 提供 `MysAccountPort`;扩展依赖接口而非实现。
5. **配置驱动多游戏(Games SSOT)**:gs/sr/zzz/未来新游戏 = 一份配置 + 一份数据,业务层查表(延续 `games.js`)。
6. **内部自洽**:每个 repo 内部分层清晰(adapter/契约实现/业务/数据),可独立测试、独立运行(给一个 mock 契约就能跑)。
7. **降级而非崩溃**:契约缺失/依赖未装时,功能优雅降级 + 明确提示,而非 crash 或静默失败。

### 3.3 "独立但紧密结合"如何同时成立
- **独立**:repo A 不 import repo B 的内部文件;A 只依赖 `contracts` 中的接口。删掉 B,A 仍能加载(功能降级)。
- **紧密结合**:B 在运行时通过"能力注册/hook"把实现注入,A 调接口即得到 B 的能力。
- **非侵入**:A 永远不改 B 的文件;B 想增强 A 的行为,用 A 暴露的 hook。

---

## 第四步 · 大一统重构 TODO 计划(分阶段)

> 原则:**先立契约与基线,再逐插件迁移到契约,最后用"加新功能零改核心"验收**。每阶段可独立上线/回退,行为保持(有回归基线)。

### P0 · 基线与护栏(必须先做)
- [ ] **回归基线**:用 stdin 适配器 + 真实账号,录制关键命令现状输出(体力/札记/抽卡/面板/排行),作为"行为不变"的对照。
- [ ] **框架稳健性**(architecture-review P0):修 `loader.deal()` 派发语义(拒绝/未命中→continue)、`await deal` + 顶层 try/catch、结构化 tracing。
- [ ] **adapter 隔离**:移出插件扫描或标记 type=adapter,`load()` 幂等(消除热更新重复 push)。
- [ ] **消除插件双实例化**。
- 验收:派发不再"吞插件";单插件报错不影响其他;启动/路由测试通过。

### P1 · 定义契约层(Core SDK / Contracts)
- [ ] 新增 `lib/contracts/`(或独立包),定义并**版本化**接口:
  - `AccountPort`(取 ck/uid/stoken、米游社 API)
  - `GameRegistry`(game_biz/region/术语/卡池/模板/启用位 —— 复用 `games.js`)
  - `GameDataProvider`(角色/武器/meta/面板/伤害)
  - `RankProvider` / `StatProvider`(排行/统计,可空)
  - `Renderer`(出图,带文本降级)
  - `HookBus`(生命周期事件:beforeRender/afterPanel/onRankUpdate/preDeal…)
  - `CapabilityRegistry`(注册/发现能力)
- [ ] 写**契约文档 + mock 实现**(让任一插件能脱离他人单测)。
- 验收:契约有类型/文档 + mock;不依赖任何具体插件。

### P2 · 核心插件改造为"面向契约"
- [ ] **genshin**:对外只暴露 `AccountPort` + `GameRegistry` 实现并注册到 `CapabilityRegistry`;内部收敛 region/biz/路径到 `games.js`;`getData` 返回结构化结果;payLog 留待接口。
- [ ] **miao**:对外暴露 `GameDataProvider`/`RankProvider`;**新增 HookBus 挂载点**(面板渲染前后、排名更新);内部 Base 游戏判断改 Games 表;资源路径走 `Meta.path()`。
- [ ] **框架 runtime**:`render()` 的 `_miao_path` 改为按"已注册 renderer/资源能力"解析,去硬编码;游戏前缀下沉到 genshin 的 `preDeal` hook。
- 验收:删掉 miao 后 genshin 仍能加载(面板类功能降级提示);xiaoyao 不再 `file://` import genshin 内部。

### P3 · 扩展插件去侵入化
- [ ] **xiaoyao**:改为消费 `AccountPort`/`GameRegistry`,删除对 genshin 内部文件的 `file://` import;体力模板做 `TemplateRegistry`。
- [ ] **ark**:**用 miao 的 HookBus 订阅** 实现全服排名/幽境/嵌入排名,**彻底删除 `#ark替换文件`**;全服上传 opt-in + 本地降级。
- [ ] 其它社区扩展(Atlas/liangshi-calc/panel-plugin)接入同一 hook/能力契约(文档化扩展指南)。
- 验收:`#喵喵更新`/`git pull` 后扩展功能不受影响(不再有文件覆盖冲突)。

### P4 · 多游戏 & 平台配置化收敛
- [ ] gs/sr/zzz 剩余二元分支清零(走 Games 表);zzz 端到端(meta-zzz/签到补全)。
- [ ] 协议/平台抽象统一(微信/QQ 走同一 adapter 契约)。
- 验收:加 zzz 功能 ≈ 加配置 + 数据。

### P5 · 健壮性 & 安全 & 扩展性验收
- [ ] Puppeteer 懒加载 + 文本降级;Redis 内存兜底。
- [ ] Guoba/TRSS 远程能力默认关 + token + 白名单;authkey 链接短时效。
- [ ] **终极验收(扩展性)**:新增一个"虚构功能/新游戏",**只新增一个插件 + 一份配置,零改核心**,即可跑通取数→计算→出图→回复。达成即证明"大一统"成功。

---

## 第五步 · 落地方式与节奏建议
- **先 P0+P1**(护栏 + 契约):这是地基,风险低、收益最大;之后每个插件迁移都能独立验证。
- **每阶段一条龙真机验证**(本机逻辑校验 + PC 出图终验),延续现有 `.devenv` 流程。
- **fork 策略**:核心改动落在我们 fork;对 miao/ark 的改造尽量做成"上游可接受的 hook 接口"(便于回馈上游、减少长期 merge 冲突)。
- **文档驱动**:契约层(P1)定下来后,写一份"**扩展开发指南**",让以后加功能的人照接口写,不再 hack。

## 变更记录
- `2026-05-31` 创建:完成社区生态调研 + 功能流程梳理 + 目标架构原则(独立/紧密/非侵入)+ P0–P5 大一统重构 TODO。
