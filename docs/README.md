# Yunzai 项目文档索引（从这里开始）

> 本目录文档分三大块:**架构目标(要去哪)→ 当前架构(在哪)→ 如何重构(怎么去)**,外加**实时进度/调试日志**与**专题/运维**。
> 后续开干:先看 §1–§3 对齐方向,然后在 **`refactor-progress.md` 边做边记**(任务勾选 + 调试发现 + 决策)。

---

## 1. 架构目标（To-Be）— 要去哪
📄 **`target-architecture.md`** — 统一架构的"宪法"。
- 目标分层(L0 运行时 / L1 契约 / L2 提供者 / L3 功能 / L4 扩展)、四条硬约束(独立·解耦·紧密·非侵入)。
- **官方扩展接口规范**:CapabilityRegistry/Service、HookBus、AccountPort/GameRegistry/GameDataProvider/RankProvider/Renderer、PluginManifest。
- §8 借鉴 MAA/arkime;§9 借鉴 Koishi-Cordis/NoneBot/VSCode/tapable + **收敛决定**(原评估复用 Cordis 作基座,后经 ADR-008 改为轻量自管、去 cordis 依赖)。

## 2. 当前架构（As-Is）— 在哪
📄 **`architecture-review.md`** — 现状诊断。
- 各 repo(框架/genshin/miao/xiaoyao/TRSS/Guoba/ark)定位·职责·脆弱点(带 file:line)。
- §3 跨仓"为什么脆弱"8 根因;§4 P0–P3 概览。

## 3. 如何重构优化（计划/路线）— 怎么去
📄 **`unified-refactor-plan.md`** — 生态调研 + 功能流程 + 目标原则 + **P0–P5 路线**。
- 社区插件生态分层;功能清单与消息生命周期;落地节奏建议。
- 路线与 `target-architecture.md §6` 一致;**具体执行进度在下面的进度日志里跟踪**。

## 4. 实时进度 & 调试日志 — 边干边记 ⭐
📄 **`refactor-progress.md`** — **活文档**:阶段任务勾选、决策记录(ADR)、调试/排查日志(时间倒序)、阻塞项、回归基线状态。
> 规则:**每次动手前后都更新这里**——做了什么、卡在哪、怎么定位、结论。方便随时 debug/排查、避免重复踩坑。

## 5. 专题
📄 **`multi-game-refactor.md`** — 多游戏(gs/sr/zzz)配置化专题 + **SR 抽卡 authkey 不可得的三方实证定论** + 体力双渲染器/排行门槛排查。

## 6. 运维 / 部署
- 📄 **`wechat-deploy.md`** — 接入微信群(架构、协议端选型、ComWeChat 傻瓜教程、风险)。
- 📄 **`local-test-credentials.md`** — `.devenv` 测试凭据存放位置与一键清理。

---

## 建议阅读顺序
1. 新人/对齐方向:`architecture-review`(现状) → `target-architecture`(目标) → `unified-refactor-plan`(路线)。
2. 开始动手:打开 `refactor-progress.md`,认领任务、记录进度与调试。
3. 碰到多游戏/SR 抽卡问题:查 `multi-game-refactor.md`。
4. 要上线到群里:查 `wechat-deploy.md`。

## 文档维护约定
- `target-architecture`/`architecture-review`/`unified-refactor-plan`:**相对稳定**,大改才更新。
- `refactor-progress`:**高频更新**,是日常工作面。
- 每篇文档底部都有"变更记录",改动追加一行。
