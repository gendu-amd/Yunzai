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
- **已完成(追加)**:`1-02b` genshin 再提供 `gameRegistry` 能力(genshin 仓 `bd742f8`),dev 值校验全对(纯配置、本环境可完整验证)。
- **下一步候选**:`1-05` PluginManifest 规范 / 生产消费者迁移(延后到 PC 可验证)。改真实派发(Phase D)前必补 `0-00` 基线。

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
- [ ] `0-00` **回归基线**:命令→匹配插件(fnc)→完成/异常 的快照,作为改派发/生命周期前的护栏(开始改真实派发前做)

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
- [ ] `1-05` PluginManifest 规范(contributes/requires/provides/version)+ 懒激活
- [ ] `1-06` 协议文档 + 版本化

### Chapter 2（P2）· 核心面向契约
- [~] genshin:`provide('account')`✅`provide('gameRegistry')`✅;region/biz/路径收敛 games.js(已有 SSOT,待消费方接入);getData 结构化(待)
- [ ] miao:`provide('gameData','rank')` + 埋 hook 点(profile:beforeRender 等);Base 查表;meta 路径 `Meta.path()`
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
