# 大一统重构 · 实时进度 & 调试日志（活文档）

> **这是日常工作面**:每次动手前后都更新。任务勾选 + 决策(ADR) + 调试/排查日志 + 阻塞项。
> 方向看 `target-architecture.md`(目标)/`unified-refactor-plan.md`(路线);本文只管"现在做到哪、卡在哪、怎么定位"。
> 状态图例:`[ ]`待办 `[~]`进行中 `[x]`完成 `[!]`阻塞 `[-]`放弃/不做

---

## 0. 当前焦点
- **纠偏(2026-05-31)**:`chapter0-01/02/03` 经自查判定为**给旧结构打补丁的脚手架**(顶层 try/catch 吞错、加固将被替换的派发循环、只修 wsf 没修 Bot.adapter 重复),已 **`git reset --hard 78758a6` 全部 revert**(reflog 可找回)。
- **新纪律**:不再"碰软躲硬";严格按"目标+计划"从**地基(keystone)**做起;凡行为改动必先有**回归基线**;错误**浮现/计入待修**,不许吞。
- **当前**:HEAD=`78758a6`(干净起点)。`ADR-001` 已定:**复用 Cordis**(POC 实证 Service/dispose/hook 全通过)。
- **已完成**:L1 契约层**立(`9183ad3`)+ 挂载(`bbd3f82`)+ 首个 provider account(genshin 仓 `a5192d9`)**,均 verify PASS;运行 bot 实测 `account` 已注册。
- **闭环已验证**:dev 测试经 `core.require('account')` 取到真实 dailyNote(`retcode=0`),provider→core→consumer 跑通。
- **已完成(追加)**:`1-02b` genshin 再提供 `gameRegistry`(genshin 仓 `bd742f8`,dev 值校验全对);**`0-00` 回归基线**(`.devenv/baseline.sh` + 快照,`--check` PASS)——**Phase D / 懒激活护栏就位**。
- **已完成(追加)**:miao 提供 `gameData`(miao `e0ef478`)、**框架提供 `renderer`(带降级)**(Yunzai `c29303e`)→ **manifest 供需闭环已归零(`checkRequires={}`)**;ADR-004 退场标准固化(`0ee4b44`)。均 baseline `--check` PASS。
- **当前能力地图**:genshin→`account`/`gameRegistry`;miao→`gameData` + 发布 hook `profile:beforeRender`;框架(yunzai-core)→`pluginRegistry`/`renderer` + `core.hook.{emit,emitAsync,veto}`。供需自洽。
- **已完成(追加)**:`core.hook.emitAsync`(await 异步监听,Yunzai `df88366`);miao 在面板渲染真实点埋 `profile:beforeRender`(miao `6637567`)——**ark 去侵入的官方 seam 就位**(取代覆盖文件/monkey-patch)。baseline `--check` PASS。
- **已完成(追加)**:退场清单 **A-2 起步**——xiaoyao `apps/user.js` region 改走 `core.require('gameRegistry')`(xiaoyao `61cff46`),12 例数据逐字一致,baseline `--check` PASS。
- **ark(A-1)改判**(2026-05-31 调研结论):ark `init.js:491` 是 miao render 的**近乎整段 fork**,增量字段(`dmgRankData/artisRankData/top1/scoreAndRank/selfRank`)**全部来自 ark 排名服务器(网络)**,且需模板名切换(`-ark`)+ 字段重命名(`hsr_paths`→`path`)。**本环境无法比对数据**(依赖网络排名服务),**单 hook 也不足**(需可改写模板名)。→ **A-1 延后到 PC + 排名服务可达**,届时:① 给 `profile:beforeRender` payload 增加可改写的 `tplName`;② ark 改订阅注入排名;③ 删 render 覆盖 + replaceFile。
- **下一步候选**:A-2 续(`adapter/mys.js` MysInfo → account port,需扩 port `checkUidBing/init` + 真账号验)/ miao `provide('rank')` / `1-05` 第二步懒激活(改 loader,有护栏)。

---

## 工作流约定（提交 / 章节）⭐
> 固化用户定义的流程,严格执行。
- **每一小步循环**:重构 → `bash .devenv/verify.sh "相关命令"` 验证 → 更新本文件 → **commit**。**验证不过不进下一步**。
- **commit 信息格式**:`chapter<X>-<NN>: <做了什么>`(例:`chapter0-01: 派发顶层错误边界+await`)。提交内容 = 本步代码 + 本文件(进度)更新。
- **业务改动 → 同步更新对应 repo 文档**(genshin/miao 等改动更新各自 repo 内文档,框架/进度更新本文件)。
- **章节合并**:一个 chapter 的所有 `chapter<X>-*` 全部验证通过后,**squash 合并为 1 个** `chapter<X>: <章节成果>`,再进入下一章(`chapter<X+1>-00`…)。
- **push**:沙盒无 git 凭据,由用户在本地执行;本环境只做本地 commit/squash。
- **章节映射**:Chapter 0=P0 · 1=P1 · 2=P2 · 3=P3 · 4=P4 · 5=P5。

---

## 1. 章节任务跟踪（commit 按 chapterX-NN）

### Chapter 0（P0）— ⚠️ 已 revert,重新定义
> 原 `0-01/02/03` 是补丁式脚手架,已全部 revert(见 §0 纠偏)。P0 重新定位为"**只做不可省的地基**":回归基线。派发/错误隔离/生命周期等**结构问题**统一在 keystone(Context 模型)里"由设计解决",不再单独打补丁。
- [-] `0-01/02/03`(顶层错误边界 / 逐插件隔离 / adapter 幂等)→ **已 revert**(补丁式,不推进架构;正解在 keystone)
- [x] `0-00` **回归基线**(2026-05-31,本地工具 `.devenv/baseline.sh`,`--check` PASS):14 条命令语料(帮助/状态/版本 + `#`gs/`*`sr/`%`zzz 多游戏前缀 + 抽卡/面板/素材)→ 采集每条命中的 `[plugin(fnc)]` 序列为快照 `.devenv/baseline/dispatch.snapshot`。采集点=loader 在 handler 执行**前**打的 `[开始处理]`,只反映**匹配决策**、与网络/出图无关 → 确定性可复现。`--check` 重跑逐命令 diff,作为**改真实派发/懒激活(Phase D)前后的护栏**。harness 在仓外(零污染,同 `verify.sh`)。
  - 快照样例:`#帮助→[喵喵:喵喵帮助(help)]`、`#状态→[状态统计(status)]`、`#体力/*体力/%体力→[体力查询(note)]`、`#原神抽卡记录→[抽卡记录(getLog)]`、`*星铁抽卡记录→[喵喵:抽卡统计(Yzdetail)]`、`#今日素材→[喵喵:角色资料(today)] [角色素材(material)]`。
  - **隔离环境踩坑(已修)**:沙箱内 `pkill` 杀不掉上轮遗留、已 reparent 到 PID1 的 bot,导致多实例同读输入、命中被回显 N 次。修法=① 采集对命中 `awk '!seen'` **去重**(快照与实例数无关、根上免疫);② harness 整轮在沙箱外跑使内部 kill 生效、跑完不留孤儿。

### Chapter 1（P1）— keystone:契约层 / Context（当前主线）
- [x] `1-00` **ADR-001 Cordis/Context POC**(2026-05-31):`.devenv/poc-cordis` 实证 Service/dispose/hook 全通过 → **决定复用 Cordis**(详见 ADR-001)。
- [x] `1-02-pre` **宿主适配设计**(2026-05-31):写进 `target-architecture.md §10`(`core` 门面 + 单根 Context + 渐进迁移 A→D)。
- [x] `1-01` **L1 `core` 门面**(2026-05-31,commit `9183ad3`,SMOKE+verify PASS):加 `cordis@3.18.1` 依赖;`lib/contracts/index.js` 暴露 `core.{provide,require,has,list,hook.on/emit/veto,scope}` + 领域 ports JSDoc。**Phase A 纯新增、无人引用,bot 启动零影响**。
- [x] `1-02` **宿主挂载**(2026-05-31,commit `bbd3f82`,verify PASS):`lib/bot.js` 挂 `Bot.core`(门面)+ `Bot.ctx`(单根 Context);cordis 随框架启动加载、零启动错误。纯接线,不改派发。
- [x] `1-00b` 版本策略(2026-05-31):选 **cordis `3.18.1` 稳定版**(非 4.0-RC);3.18.1 复跑 POC 通过。
- [x] `1-03` genshin 提供 `account`(2026-05-31,**genshin 仓** commit `a5192d9`,verify+注册日志 PASS):`model/accountPort.js`(包 MysInfo/MysApi)注册 `Bot.core.provide('account')`;运行 bot 实测打印 `[contracts] genshin 提供能力：account`;旧路径全保留(非侵入);genshin 仓加 `CONTRACTS.md`。
- [x] `1-02b` genshin 提供 `gameRegistry`(2026-05-31,**genshin 仓** commit `bd742f8`,verify+dev 值校验 PASS):`model/gameRegistryPort.js` 包 `model/games.js`(纯配置查表、无副作用/网络)注册 `Bot.core.provide('gameRegistry')`;dev 实测 `term(sr,weapon)=光锥`/`region(100098441,gs)=cn_gf01`/`biz(sr)=hkrpg_cn`/`uigfKey(sr)=hkrpg`/`games=[gs,sr,zzz]` 全对;旧 `games.js` 调用全保留(非侵入)。
- [~] `1-04` **消费者闭环已验证(real data)**:一次性 dev 命令经 `Bot.core.require('account')` → `getUid` 返回真实 uid `100098441`、`getData(e,'dailyNote')` 返回 **`retcode=0`**(真取数)。**provider(genshin)→core→consumer 在运行 bot 里跑通**。dev 测试已删、不提交。
  - ⚠️ 诚实记录:原计划改 xiaoyao `Note.js` 作首个**生产**消费者,但本环境 `sys.Note` 未开 + `#体力` 被 genshin `dailyNote` 抢占 → 该路径**根本不执行、无法验证**,故**已 revert,不提交未验证代码**。
  - 待办:**生产消费者迁移延后到可验证环境**(PC/真实配置:命令真正路由到目标消费者处)。选消费者时先确认"该命令确实路由到它"。
- [~] `1-05` PluginManifest:**第一步声明式那半已完成**(2026-05-31,Yunzai `30794c2` + genshin 仓 `a103040`,verify+baseline `--check` PASS):
  - L1 宿主内建 `pluginRegistry`(`lib/contracts/pluginRegistry.js`):`register/get/list/names/providersOf/consumersOf/hookDeclarers/checkRequires/validate`;经 `core.provide('pluginRegistry')` 暴露 + 别名 `core.manifest`;在插件加载前就绪。
  - genshin 声明首份 `manifest.js`:`provides=[account, gameRegistry]`、`type=data-provider`、`guoba=true`;dev 实测 `providersOf(account)=[genshin]`、`checkRequires={}`。
  - **纯加层、不触碰 loader/派发** → `baseline --check` PASS(零回归)。
  - **第二步(待)**:懒激活(命令前缀命中才激活,改 loader)——现已有 `0-00` 护栏,可安全做。
- [ ] `1-06` 协议文档 + 版本化

### Chapter 2（P2）· 核心面向契约
- [~] genshin:`provide('account')`✅`provide('gameRegistry')`✅;region/biz/路径收敛 games.js(已有 SSOT,待消费方接入);getData 结构化(待)
- [~] miao:`provide('gameData')`✅(2026-05-31,**miao 仓** commit `e0ef478`,verify+baseline `--check` PASS):`models/gameDataPort.js`(包 Character/Weapon/ArtifactSet/Player)注册 `gameData` + `manifest.js` 声明 `provides=[gameData] requires=[account,renderer]`;dev 实测 `getCharacter(胡桃)={name,id:10000046,elem:pyro,star:5}`、`resolveName(雷神)=雷电将军`、`checkRequires={miao:[renderer]}`(**account 已被 genshin 满足→首个真实供需闭环**);miao 内部调用全保留(非侵入)。**待**:`provide('rank')` + 埋 hook 点(profile:beforeRender)
- [x] 框架提供 `renderer` 能力(2026-05-31,Yunzai `c29303e`,verify+baseline `--check` PASS):`lib/contracts/rendererPort.js` 包 `global.Renderer` 后端,`core.provide('renderer')` **带文本降级**(后端缺失/Chromium 不可用/截图失败 → 返回 fallbackText);注册框架内建 manifest `yunzai-core`(provides=[pluginRegistry, renderer])。dev 实测:本机 `available=false`(诚实上报)、`render→fallbackText`(降级生效)、`providersOf(renderer)=[yunzai-core]`、**`checkRequires={}`(miao 的 account+renderer 全满足,供需闭环归零)**。非侵入(renderImg/Common.render 全保留)。
- [ ] 框架 render 去 `_miao_path` 硬编码;游戏前缀下沉 hook

### P3 · 扩展去侵入（未开始）
- [ ] xiaoyao:删 `file://` import,改 `require('account')`;体力 TemplateRegistry
- [ ] **ark:改 hook 订阅,删除 `#ark替换文件` + monkey-patch**
- [ ] 数据迁移脚本(改 redis key/路径处)

### P4 · 多游戏/平台收敛（未开始）
- [ ] gs/sr/zzz 剩余二元分支清零;zzz 端到端(meta-zzz/签到)
- [ ] 协议/平台统一 adapter 契约

### P5 · 健壮/安全 + 扩展性验收（未开始）
- [ ] Puppeteer 懒加载 + 文本降级;Redis 内存兜底
- [ ] 安全:Guoba/TRSS 远程能力默认关+token+白名单;authkey 链接短时效
- [ ] **终极验收**:新增功能/新游戏"零改核心"跑通

---

## 2. 决策记录（ADR-lite）
> 格式:ADR-编号 · 标题 · 状态(提议/已定/搁置) · 日期 · 决定 + 理由

- **ADR-001 · 契约层基座:复用 Cordis vs 自研** · `已定:复用 Cordis` · 2026-05-31
  - **POC(`.devenv/poc-cordis`,cordis 4.0.0-rc.6)实证**:① Service `provide/inject` 承载 AccountPort ✅;② Context `dispose` 可逆——卸载 provider 后 `ctx.account` 自动消失 ✅(根治双实例化/热更新副作用);③ HookBus:`emit`+引用改写可注入(ark 非侵入扩展)、`bail` 可否决 ✅。
  - **决定**:L1 契约层构建在 Cordis 之上,不自研 Registry/HookBus/lifecycle。
  - **版本决定(1-00b)**:用 **cordis `3.18.1` 稳定版**(不押 4.0-RC)。3.18.1 实测同样满足 Service/provide/dispose/emit-引用改写/bail(POC 复跑通过);成熟 68 版、Koishi 时代验证。锁 `~3.18`。
  - **其它约束**:bail veto 约定=返回真值拦截;3.x 的 DI(`inject`/`using`)时序细节在 1-01 敲定;需写"宿主适配层"让现有 `Bot`/loader 承载一个 Context(**渐进迁移,非一次性替换**)。
- **ADR-002 · HookBus 语义对齐 tapable** · `已定` · 2026-05-31
  - `emit`=Waterfall(可改 ctx)、`filter`=Bail(任一 false 否决)、`notify`=Series(纯通知);named tap 便于 tracing。
- **ADR-003 · 资源/数据层独立版本化** · `已定` · 2026-05-31
  - miao `meta/calc/模板`、术语/卡池等高频数据抽成可独立更新的数据包,与引擎解耦;根治 ark 覆盖/喵喵更新冲突。
- **ADR-004 · 旧路径退场标准(避免"永远到不了的 P4")** · `已定` · 2026-05-31
  - **背景**:Phase B 期间"新老并存、旧路径留 deprecated 垫片",但若无可度量的退场标准,垫片会永久滞留。本 ADR 把"何时可删旧路径"写成硬门槛 + 逐条清单。
  - **退场标准(逐能力,全满足才删对应旧路径)**:
    1. **新路径可用**:provider 已 `core.provide`,且 dev/真实数据验证通过(对出图功能须 **PC 出图终验**)。
    2. **消费者清零**:全仓搜索确认无任何调用方仍走旧路径(`file://` / 直接 import 内部文件);消费者已切 `core.require()`。
    3. **deprecation 缓冲**:旧路径保留并打 **deprecation 告警日志**至少一个发布周期,期间**实测零命中**(给生态第三方插件迁移缓冲)。
    4. **回归护栏**:`baseline.sh --check` PASS;改派发相关的另跑对应验证。
  - **退场清单(tracking,做到一条勾一条)**:
    - [~] xiaoyao `file://` import genshin `mysInfo/gachaLog/payLog/games` → 改 `core.require('account'/'gameRegistry')`(满足 1-4 后删)
      - **A-2 起步**(2026-05-31,xiaoyao 仓 `61cff46`):`apps/user.js` 的 `getRegion` 用法已改走 `core.require('gameRegistry').region`,回退旧直连带 deprecation 告警;dev 验 12 例 region 新旧逐字一致(纯函数、无需账号)。line 15 静态 import 暂留 fallback(零命中周期后删)。
      - **待**:`adapter/mys.js` 的 `MysInfo.{get,getUid,checkUidBing,init}` → 需先给 account port 补 `checkUidBing/init`,再迁(需真账号验数据一致);`Note.js`/`mhyTopUpLogin.js` 的 `dailyNote` file:// 同理。
    - [ ] ark `#ark替换文件` + monkey-patch miao → 改 `core.hook.on(...)` 订阅(满足 1-4 后删)
      - **seam 已就位**(2026-05-31,miao `6637567`):miao 在 `ProfileDetail.render` 真实渲染点发布 `profile:beforeRender`(异步,可改写 renderData),正是 ark `init.js:491` 覆盖 render 注入排名的同一点。**待办**:ark 改订阅 → 删 `init.js` 的 render 覆盖 + `replaceFile` 覆盖(需 PC 出图终验后删)。
    - [ ] genshin/miao 内部跨插件直接 import → 收敛到 `core.require()`
    - [ ] 框架 `lib/` 内 `srReg/isSr/_miao_path` 等游戏硬编码 → 下沉 hook / gameRegistry(满足 1-4 后删)
  - **机制**:旧路径加 `logger.warn('[deprecated] …,请改用 core.require(...)')`;退场清单随每次迁移更新勾选,P4 收敛时清单清空=垫片删尽。

---

## 3. 调试 / 排查日志（时间倒序）
> 现象 → 定位 → 结论。已查清的坑都记这里,避免重复踩。

- **2026-05-31 · SR/ZZZ 抽卡 authkey 不可得** · `已定论`
  - 现象:`*更新抽卡记录` → hkrpg getGachaLog `-100 authkey error`。
  - 定位:独立脚本 `.devenv/sr-authkey-diag.mjs` 矩阵实测(host×signgame×端点全 -100),GS 同法成功;cross-check UIGF 接口库 + genshin.py。
  - 结论:**扫码/cookie 无法得 SR 抽卡 authkey,平台设计;只能游戏客户端链接**。详见 `multi-game-refactor.md §4`。
- **2026-05-31 · ark `#ark替换文件miao-rank` 覆盖 miao 5 文件** · `已查清`
  - 定位:`backup-default.json` 映射 + `fs.cpSync` 覆盖 `ProfileDetail.js/ProfileRank.js/profile.js`+2html;ProfileRank ~50% 重写。
  - 结论:侵入式,miao 升级即冲突;**幽境危战排名无需替换即可用**。→ 目标:改 hook 订阅(P3)。
- **2026-05-31 · 体力图与别群不同** · `已查清`
  - 结论:`#体力` 被 genshin(原版) 与 xiaoyao(花哨多模板,`sys.Note` 开关) **双渲染器**争用,差异是配置不同,非 bug。
- **2026-05-31 · `#幽境/白厄排行` 看不到** · `已查清`
  - 结论:miao 群排行需 group_id + groupRank 开 + 群友上传面板;全服/幽境危战排名属 **ark**(本套未装时,`#幽境排名` 被 miao 排名正则误匹配→静默)。

---

## 4. 阻塞项 / 风险
- [!] **强推依赖凭据**:本沙盒环境无 GitHub push 凭据,涉及 push 需用户在本地执行(见之前 dev.sh 提交)。
- 本机(RHEL8 无 root)**渲染不出图**(缺 Chromium 库),出图视觉验证留 PC/部署机。

## 5. 验证方法 / 回归基线
- **一键验证脚本**:`bash .devenv/verify.sh "命令1" "命令2" …`(默认 `#状态`)。
  - 流程:保留 redis 6399 → 重启 bot → 等"加载插件[N]"就绪 → 注入命令 → 汇总"完成数/消息处理异常/启动硬错误" → PASS/FAIL。
  - **每轮改动后跑一次**;需真连米游社的命令(抽卡/账号)跑 verify 时加 `full_network` 权限,否则 `fetch failed`。
  - **覆盖**:插件加载、命令路由、数据取数(有网时)、错误边界。**不覆盖**:出图(本机无 Chromium,视觉留 PC)。
- **已知非本次引入的问题**(verify 时发现,待办):xiaoyao `*更新抽卡记录` 在 fetch 失败时 `Cannot read properties of undefined (reading 'includes')`(无兜底);被逐规则 try/catch 捕获未崩。
- [ ] 正式回归基线快照(改造前后逐命令 diff)——P1 收尾前补。

## 变更记录
- `2026-05-31` 创建:阶段任务跟踪(P0–P5)+ ADR(Cordis/HookBus/数据层)+ 调试日志(SR authkey/ark/体力/排行)+ 阻塞项。
