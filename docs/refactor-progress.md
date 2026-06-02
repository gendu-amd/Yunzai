# 大一统重构 · 实时进度 & 调试日志（活文档）

> **这是日常工作面**:每次动手前后都更新。任务勾选 + 决策(ADR) + 调试/排查日志 + 阻塞项。
> 方向看 `target-architecture.md`(目标)/`unified-refactor-plan.md`(路线);本文只管"现在做到哪、卡在哪、怎么定位"。
> 📌 **封存/续作入口**:`docs/SESSION-SNAPSHOT.md`(2026-05-31 封存,下周续作的总览 + 剩余工作 + 验证命令)。
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
- **当前能力地图**:genshin→`account`/`gameRegistry`/`gacha`;miao→`gameData` + 发布 hook `profile:beforeRender`;框架(yunzai-core)→`pluginRegistry`/`renderer` + `core.hook.{emit,emitAsync,veto}`。供需自洽。
- **已完成(追加)**:`core.hook.emitAsync`(await 异步监听,Yunzai `df88366`);miao 在面板渲染真实点埋 `profile:beforeRender`(miao `6637567`)——**ark 去侵入的官方 seam 就位**(取代覆盖文件/monkey-patch)。baseline `--check` PASS。
- **已完成(追加)**:退场清单 **A-2**——已迁 8 处(MysInfo/region/dailyNote/payLog/gachaLog/userck×2/bindCookie),分别经 account/gameRegistry/gacha 消费,均验数据一致 + baseline PASS。**⚠️ 全仓复扫纠正**:之前漏 3 处(gsCfg `roleNameToID/roleIdToName` ×2、`NoteUser.forEach`),不能盲迁(换实现会改数据),已记入待办待逐个验证。
- **✅ A-2 主体完成**:xiaoyao 全部 8 处 genshin 内部 `file://` 依赖均 core 优先 + 带告警回退(genshin 配套 provide:account 扩 checkUidBing/init/bindCookie/forEachUser、新增 gacha;复用 gameRegistry/gameData)。剩:① 静态/动态 import 的物理删除(ADR-004 零命中周期后)② 死分支(`lib/app/*` 缺失)③ 框架 config 访问(非侵入)——均后续。
- **当前能力地图**:genshin→`account`/`gameRegistry`/`gacha`;miao→`gameData`/`rank` + hook `profile:beforeRender`;框架→`pluginRegistry`/`renderer`/`gamePrefix`/`core.hook.*`。
- **A-3 起步(2026-05-31,Yunzai `ef1c1fe`)**:按"框架自有注册表"正确解落地——`gamePrefix` 注册表(L0,默认 sr/zzz,插件可 register),loader 前缀判定改走它(留 fallback)。**首个派发核心改动**,baseline `--check` PASS 验证零回归(0-00 基线首次实战守住 Phase D)。下一步可在此基础上做"懒激活"(命令前缀命中才激活)。`_miao_path` 耦合、`isSr` setter、`createMysApi` 布尔兼容另议。
- **退场清单**:A-2 主体✅;A-1(ark)⏸延后PC;A-3(框架 srReg/isSr/_miao_path)⬜未动。
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
- [x] **P0 结构地基(经 ADR-006 R 阶段正解落地,2026-06-01)**:R-1 顶层 await+try/catch+tracing(`4ba9869`)、R-2 派发核心模块化 `_mwDispatch`(`e494f4c`)、R-3 插件单次实例化根治(`74bcc54`)、R-4 adapter 按 id 幂等根治(`374559d`)。区别于已 revert 的补丁:这些是在加厚基线(23 条)护栏下、行为保持的结构重构。派发语义"拒绝/异常→continue"(S-1)属行为变更,延后单独决策。
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
  - **第二步 ✅ L-1/L-2/L-3/L-4(2026-06-01)**:懒激活机制落地(`b2e589e`)——manifest.activation 触发器→懒占位→命中 import→eager 兜底;试点 `_lazytest` 端到端验证、baseline PASS、试点已删。红线改"作者声明 + 框架事后告警"。**L-4 作者指南** `docs/lazy-activation-guide.md`。
  - **L-5 结论(2026-06-01,客观限制)**:复扫核心仓 6 个目录型插件(genshin/miao/ark/Guoba/xiaoyao/TRSS)——**全部含红线**(启动期 provide 能力 / `Bot.*` 打补丁 / task / accept),**均不适合懒激活**。故 L-5 暂无核心候选;机制服务于未来小型纯命令插件 + 第三方生态 opt-in。**懒激活线程到此告一段落(机制完备 + 文档齐全)**。
- [ ] `1-06` 协议文档 + 版本化

### Chapter 2（P2）· 核心面向契约
- [~] genshin:`provide('account')`✅`provide('gameRegistry')`✅`provide('gacha')`✅;region/biz/路径收敛 games.js(已有 SSOT,xiaoyao 已接入);getData 结构化(待)
- [~] miao:`provide('gameData')`✅`provide('rank')`✅(群排行,2026-05-31 miao `60f68bd`,工厂包 ProfileRank,dev 验同类+静态一致,baseline PASS);全服排名(ark)规划 `rank.getGlobalRank?`(2026-05-31,**miao 仓** commit `e0ef478`,verify+baseline `--check` PASS):`models/gameDataPort.js`(包 Character/Weapon/ArtifactSet/Player)注册 `gameData` + `manifest.js` 声明 `provides=[gameData] requires=[account,renderer]`;dev 实测 `getCharacter(胡桃)={name,id:10000046,elem:pyro,star:5}`、`resolveName(雷神)=雷电将军`、`checkRequires={miao:[renderer]}`(**account 已被 genshin 满足→首个真实供需闭环**);miao 内部调用全保留(非侵入)。**待**:`provide('rank')` + 埋 hook 点(profile:beforeRender)
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
- **ADR-007 · manifest 统一装配(单一声明源,框架自动接线)** · `已定·已实现` · 2026-06-02
  - **动机**:之前 provides/hook/gamePrefix/激活 是分散机制 + 每插件手写 `*Port.js`+`Bot.core.provide` 样板。统一为:**manifest = 唯一声明源**,框架 `loader.wireManifests()` 据声明自动接线。
  - **实现**:① `provides:{能力名:()=>import(...)}` → 框架自动 `core.provide`(genshin `6836120`、miao `36380ce`,删全部手写 provide 样板);② `contributes.gamePrefix:[{game,test,cmd}]` → 框架自动注册(sr/zzz 从框架硬编码 seed 移到 genshin manifest,`a8f1d74`/`18b85ba`,层级正确);③ pluginRegistry 兼容 provides 数组/对象;④ 框架 `5d4bd00`。向后兼容(数组式 provides 不自动装配,自注册照旧)。
  - **验证**:5 能力全自动装配(account/gameRegistry/gacha←genshin、gameData/rank←miao),`has` 全 true、`getCharacter(胡桃).id=10000046`、`gameRegistry.term(sr,weapon)=光锥`、`checkRequires={}`、`names=[yunzai-core,genshin,miao]`;别名→游戏路由不变;baseline `--check` PASS。
  - **可拓展性达成**:加能力/游戏前缀/hook = 改插件 manifest 一处,框架自动接线,**无需改框架、无需写注册样板**。
- **ADR-006 · 派发重设计 + 实例化根治** · `已定·R-1~R-4 已实现(S 未做)` · 2026-06-01
  - ✅ R-1 顶层 await+try/catch+tracing(`4ba9869`)/ R-2 抽取派发核心 _mwDispatch(`e494f4c`)/ R-3 插件单次实例化(`74bcc54`)/ R-4 adapter 按 id 幂等(`374559d`)。每步 baseline `--check` PASS(23 条);R-3 验能力注册不变。⏸ S-1(派发语义改 continue)未做,需单独批准+重做基线。
  - 详见 `docs/dispatch-redesign-design.md`。核心:① 严格区分 **(R) 行为保持重构**(baseline 必须仍 PASS)与 **(S) 语义变更**(改 baseline,单独决策);② R 含:deal 顶层 await+try/catch+tracing、拆中间件管道(原样搬阶段、不改顺序/短路)、loadPlugin 单次实例化、adapter 按 id 幂等注册;③ S(派发"权限拒绝/异常→continue")**默认不做**,需批准 + 重做基线;④ 分期 R-1~R-4,每步 baseline 守。
  - **前置**:`0-00` 基线已**加厚到 23 条**(别名→游戏路由/边界 `*`/无命中守卫),`--check` 稳定 PASS,作为派发重写的回归网。
- **ADR-005 · 懒激活设计(manifest 声明触发器 + opt-in + eager 兜底)** · `已定·L-1/L-2/L-3 已实现` · 2026-05-31
  - 详见 `docs/lazy-activation-design.md`。核心:① 根本约束=`rule` 正则在插件代码内,**必须 manifest 声明触发器**才能"命中才加载"(VS Code activationEvents 模型);② **正确性红线**=含 `accept/task/handler/getContext/init` 的插件**强制 eager**(否则功能缺失);③ **opt-in**,未声明 `activation` 的插件零变化;④ manifest 触发器只决定"何时加载",**最终路由仍走插件真实 rule**→ 与 eager 等价;⑤ 分期 L-1~L-5,每步 `baseline --check` 守。
  - **待评审决策点**:opt-in+eager 默认 / 不可懒红线 / manifest.js 零副作用约定 / 实施顺序。通过后从 L-1 写码。
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
      - **A-2 续**(2026-05-31,xiaoyao `5ed64b2` + genshin `6aeacfe`):account port 补 `checkUidBing/init`;`adapter/mys.js` 的 `MysInfo.{get,getUid,checkUidBing,init}` 全改走 `core.require('account')`(回退旧直连带告警)。dev 真账号验 `checkUidBing/getUid/init` 与旧 MysInfo 逐项一致(uid=100098441)。line 1 静态 import 暂留 fallback。
      - **依赖全量分析(2026-05-31,先析后做)**:xiaoyao 全部动态 import 分五类——
        1. **已有能力可直接迁(account/gameRegistry)**:`apps/user.js` region✅、`adapter/mys.js` MysInfo✅、`Note.js:55` `dailyNote`✅(xiaoyao `698215c`,真账号验新旧 retcode 逐字一致)。
           ⚠️ 注:本类当时判"清完"基于**文件局部扫描**;后经全仓复扫发现仍有 3 处(见下方"纠正")。
        2. **需新增能力(genshin 提供)**:
           - ✅ **`gacha` 能力**(2026-05-31,genshin `29ea89d` provide + xiaoyao `1bb1820` consume):`gachaPort.js` 工厂包 GachaLog/payLog;xiaoyao `user.js` 抽卡/充值改走 `core.require('gacha')`,dev 验工厂返回同类、baseline `--check` PASS。覆盖 `user.js:123` payLog、`user.js:197` gachaLog。
           - ✅ **`bindCookie`**:`user.js`/`mhyTopUpLogin.js` 的 `new userck(e).bing()` → `account.bindCookie`(genshin `a94d637` + xiaoyao `db83bac`)。写操作不在 dev 执行,等价由同类构造保证 + load/baseline PASS。
      - **⚠️ 纠正(2026-05-31,全仓复扫)**:之前分析按文件逐个扫,**遗漏 3 处** genshin 内部依赖(commit `db83bac` 信息里"已全部迁完"不准确)。全仓 `rg plugins/genshin/` 复扫后完整清单如下,**这 3 处不能盲迁**(换实现会改数据,违反数据一致原则),需各自分析+验证:
        - ✅ `apps/xiaoyao_image.js:92` + `model/note.js:144` → genshin `gsCfg.roleNameToID/roleIdToName` **已迁 `gameData`**(xiaoyao `f38d2c0`)。**等价已证**:genshin gsCfg 第7行 `import {Character} from '#miao.models'`,其方法即 `Character.get(...).id/.name`,与 `gameData.getCharacter()` 同一函数;dev 验 17 例(含别名 雷神/綾華)逐字一致。shim 保持下游调用零改动。
        - ✅ `model/user.js:373` → genshin `NoteUser.forEach` **已迁 `account.forEachUser`**(genshin `3a05560` + xiaoyao `4aa1f48`)。dev 验计数一致(users:1,mys:1)。
      - **✅ A-2 主体完成(2026-05-31)**:全仓复扫确认 xiaoyao 对 genshin 内部的**全部 8 处 `file://` 依赖**均改为"`core.require()` 优先 + 带 `[deprecated]` 告警回退"(MysInfo/dailyNote→account、region→gameRegistry、payLog/gachaLog→gacha、绑CK→account.bindCookie、名↔ID→gameData、遍历CK→account.forEachUser)。旧路径全部退到 else 分支作 fallback,按 ADR-004 待零命中周期后删除静态/动态 import。
      - **已迁 5 处(均在 fallback 分支保留旧路径)**:MysInfo/payLog/gachaLog/userck(×2)→ account/gacha;region→gameRegistry;dailyNote→account。
        3. **框架 lib/ 访问(非跨插件侵入,低优先)**:`gsCfg.js:40`/`mihoyoApi.js:575` import 框架 `lib/config/config.js`(存在)——合法宿主访问,暂留。
        4. **死分支(框架 `lib/app/*` 实际缺失,V2 兼容)**:`Note.js:118` `lib/app/mysApi.js`、`user.js:202` `lib/app/gachaLog.js`、`user.js:392`/`mhyTopUpLogin.js:114` `lib/app/dailyNote.js`、`Note.js:196` `lib/render.js` ——**这些路径框架内不存在**,在 V2 分支(V3 环境走不到/import 即抛错被吞),属死代码,清理优先级低。
        5. **非依赖(自身/npm/资源)**:`Note.js:191` 自身 adapter、`Data.js:92` 自身数据、`mihoyoApi.js:583` npm 等,不动。
      - **待**:第 2 类(`gacha` 能力 + `bindCookie`)——属"需新增能力",非纯迁移,需 genshin 侧先 provide。
    - [ ] ark `#ark替换文件` + monkey-patch miao → 改 `core.hook.on(...)` 订阅(满足 1-4 后删)
      - **seam 已就位**(2026-05-31,miao `6637567`):miao 在 `ProfileDetail.render` 真实渲染点发布 `profile:beforeRender`(异步,可改写 renderData),正是 ark `init.js:491` 覆盖 render 注入排名的同一点。**待办**:ark 改订阅 → 删 `init.js` 的 render 覆盖 + `replaceFile` 覆盖(需 PC 出图终验后删)。
    - [ ] genshin/miao 内部跨插件直接 import → 收敛到 `core.require()`
    - [~] 框架 `lib/` 内 `srReg/isSr/_miao_path` 等游戏硬编码 → 下沉 hook / gameRegistry(满足 1-4 后删)
      - ✅ **srReg/zzzReg → 框架自有 `gamePrefix` 注册表**(2026-05-31,Yunzai `ef1c1fe`):loader 前缀归一化改走 `core.gamePrefix.detect`,框架 L0 自有注册表(默认 sr/zzz,正则逐字一致)+ 插件可 register 新游戏(contributes 雏形,新增游戏不改 loader);保留本地正则 fallback。**派发核心改动**,dev 15 例 + baseline `--check` 双验零回归。待:零命中周期后删 loader 本地 srReg/zzzReg。
      - ⬜ `_miao_path`(框架 render→miao 资源路径耦合)、`isSr/isGs` setter:单独立项(大件/与 Context 重设计相关)。
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
