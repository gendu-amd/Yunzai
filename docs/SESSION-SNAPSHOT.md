# 重构封存快照 · 2026-05-31（下周续作）

> 一句话状态：**L1 契约层 + 能力面板已成型,xiaoyao 去 `file://` 侵入主体完成,Phase D(派发核心)已起步并验证(gamePrefix 注册表 + 懒激活机制)。所有改动均经 dev 数据一致性 + `baseline --check` 验证、分仓提交。**
>
> 续作前必读：本文件 + `docs/refactor-progress.md`（活文档/TODO）+ `docs/lazy-activation-design.md`（懒激活设计）。

---

## 1. 本轮完成（按主题）

### A. L1 契约层 / 能力面板（chapter1~2）
| 能力 | 提供方 | commit |
|---|---|---|
| `account`(getUid/getData/mysApi/checkUidBing/init/bindCookie/forEachUser) | genshin | a5192d9,6aeacfe,a94d637,3a05560 |
| `gameRegistry`(多游戏 SSOT) | genshin | bd742f8 |
| `gacha`(抽卡/充值) | genshin | 29ea89d |
| `gameData`(角色/武器/圣遗物/画像) | miao | e0ef478 |
| `rank`(群排行) | miao | 60f68bd |
| `renderer`(带文本降级) | 框架 | c29303e |
| `pluginRegistry`(manifest 注册表) | 框架 | 30794c2 |
| `gamePrefix`(游戏前缀注册表) | 框架 | ef1c1fe |
| `core.hook.{on,emit,emitAsync,veto}` + `profile:beforeRender` hook | 框架/miao | df88366,6637567 |

`checkRequires` 供需闭环已归零（account/renderer 均被满足）。

### B. 退场清单 A-2：xiaoyao 去 genshin `file://` 侵入（主体完成）
全部 **8 处** genshin 内部 `file://` 依赖改为「`core.require()` 优先 + 带 `[deprecated]` 告警回退」：
MysInfo/dailyNote→`account`、region→`gameRegistry`、payLog/gachaLog→`gacha`、绑CK→`account.bindCookie`、角色名↔ID→`gameData`、遍历CK→`account.forEachUser`。
commit(xiaoyao)：61cff46,5ed64b2,698215c,1bb1820,db83bac,f38d2c0,4aa1f48。每处均 dev 数据一致性验证 + baseline PASS。

### C. Phase D（派发核心）起步
- **gamePrefix 注册表**（A-3,ef1c1fe）：框架自有「前缀→游戏+归一化」可扩展注册表(默认 sr/zzz,正则与旧 srReg/zzzReg 逐字一致),loader 改走它+留 fallback。**首个派发核心改动**,15 例 dev + baseline 双验零回归。
- **懒激活机制**（1-05 第二步 L-1/L-2/L-3,b2e589e）：manifest.activation 触发器→懒占位→命中 import→eager 兜底;试点 `_lazytest` 端到端验证通过、已删。

### D. 方法论 / 护栏
- `0-00` 回归基线 `.devenv/baseline.sh`（仓外本地工具）：命令→命中 `[plugin(fnc)]` 快照,`--check` 逐命令 diff。**改派发前后的护栏**,本轮 Phase D 改动全靠它守住。
- ADR-001~005（见 refactor-progress.md §2）。

---

## 2. 各仓提交范围（本轮）

- **Yunzai(主)**：`936a2f6` → `41a1093`（契约层 index/挂载、renderer/gamePrefix/懒激活 loader、全部 docs）。
- **genshin**：`a5192d9` → `3a05560`（account/gameRegistry/gacha ports + manifest + CONTRACTS）。
- **miao-plugin**：`e0ef478` → `60f68bd`（gameData/rank ports + manifest + profile:beforeRender hook + CONTRACTS）。
- **xiaoyao-cvs-plugin**：`61cff46` → `4aa1f48`（8 处 file:// 改 core 优先）。

> 各仓工作区均干净（已提交）。**未推送远端**（sandbox 无凭据,需你本地 push）。

---

## 3. 剩余工作（下周续作）

### 本地可做（有护栏、可验数据一致）
- **L-4 懒激活推广文档** + **L-5 核心插件逐个 opt-in**（甄别纯命令、无 accept/task/handler 的插件,每个过 baseline + 等价验证）。
- **genshin 内部 `isSr?a:b` 二元分支收敛**（P4）：gachaLog/logCount/exportLog 仍有多处;纯函数部分(region/term 文案)可本地验,涉抽卡数据的部分需 PC。
- **ADR-004 真删 fallback 旧 import**：已迁路径的旧 `file://`/静态 import 仍作 fallback;按退场标准（deprecation 零命中一个周期后）物理删除。

### 需 PC（出图/网络）
- **A-1 ark 去覆盖**（退场清单最大项）：ark `init.js:491` 整段 fork miao render,增量来自 ark 排名服务器(网络)。三步：① 给 `profile:beforeRender` payload 加可改写 `tplName`;② ark 改订阅注入排名;③ 删 `#ark替换文件`+monkey-patch。**需排名服务可达 + 出图终验**。
- 所有出图视觉终验、生产消费者端到端。

### 需设计 / 大件
- **A-3 续**：`_miao_path`（框架 render→miao 资源路径耦合,影响所有出图,需"布局/资源 provider"设计）、`isSr/isGs` setter。
- **Phase D 深水区**：命令派发语义迁入 Context/中间件、adapter 双实例化根治。

---

## 4. 如何续作（环境 & 验证）

```bash
# 隔离环境(仓外工具,零污染):redis 6399 + bot,注入命令,校验日志
bash .devenv/verify.sh "#状态" "#体力"        # 启动 + 路由/数据/错误边界
bash .devenv/baseline.sh --check               # 派发回归护栏(改 loader 必跑)
bash .devenv/baseline.sh                        # 重新生成基线快照(确认是预期改动后)
```
- 本机**无 Chromium**：只验加载/路由/数据/降级,**出图留 PC**。
- 沙箱内 `pkill` 杀不掉 reparent 的遗留 bot → 每轮在沙箱外跑 harness;基线已对命中去重免疫多实例。
- 关键文件：`lib/contracts/*`（契约层）、`lib/plugins/loader.js`（派发/懒激活）、各插件 `manifest.js`/`*Port.js`/`CONTRACTS.md`。

---

## 4b. 续作补记（2026-06-01）
- **懒激活线程收尾**:L-4 作者指南(`docs/lazy-activation-guide.md`)+ L-5 结论(核心仓 6 插件全含红线、无 lazy-safe 候选)。机制完备 + 文档齐全。
- **未验证切片盘点(诚实)**:① 所有出图视觉(无 Chromium,留 PC);② bindCookie 写流程/gacha 全流程(同类构造已验,全流程留 PC);③ fallback 旧路径分支(core 常驻不触发,加 `[deprecated]` 当探针);④ baseline 原仅 14 条只覆盖路由。→ **已把 baseline 加厚到 23 条**(别名/边界/无命中),`--check` 稳定 PASS,作为派发重写护栏。
- **ADR-006 派发重设计 R 阶段全部完成**(2026-06-01,行为保持、baseline 23 条守):R-1 顶层 await+try/catch+tracing(`4ba9869`)、R-2 派发核心抽成 `_mwDispatch`(`e494f4c`)、R-3 插件单次实例化根治(`74bcc54`)、R-4 adapter 按 id 幂等(`374559d`)。**S-1**(派发语义"拒绝/异常→continue")属行为变更,**未做**,需单独批准 + 重做 baseline。
- **下一步候选**:S-1(需决策+重做基线)/ PC 终验(出图+ark A-1+退场删除)/ 其余大件(_miao_path 解耦、Context 化更深)。

## 5. 纪律备忘（延续）
- 凡行为改动**先有基线**;派发改动必跑 `baseline --check`。
- 重构**不是加冗余层**：能力必须替代真实旧路径,旧路径退场要真删（ADR-004）。
- 不确定等价的**先 dev 验数据一致**再迁（如角色名↔ID 17 例验证）。
- 错误浮现/计入待修,不吞;不碰软躲硬。
