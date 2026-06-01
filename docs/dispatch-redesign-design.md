# 派发重设计 + 实例化根治 · 设计文档（评审稿）

> 状态：**设计评审中（未写码）** · 2026-06-01 · 对应 Phase D 深水区 / ADR-006
> 前置已就绪：`0-00` 回归基线已**加厚到 23 条**(含别名→游戏路由/边界/无命中守卫),`--check` 稳定 PASS——作为本重设计的回归网。
> 读前提示：本文严格区分两类改动——**(R) 行为保持的结构重构**(baseline 必须仍 PASS)与 **(S) 语义变更**(会改 baseline,需单独决策 + 重做快照)。**默认只做 R;S 仅在你明确批准后单独进行。**

## 1. 现状与痛点（As-Is,带 file:line）

消息生命周期(`lib/events/message.js` → `loader.deal`)：
```
adapter → Bot.em() → message.js execute(e) → loader.deal(e):
  count → checkBlack → checkLimit → dealEvent → [游戏前缀 gamePrefix] →
  setLimit/reply包装 → Runtime.init → activateLazy → 构建priority(过滤) →
  getContext循环 → only_reply_at门 → accept循环 → rule匹配循环(首匹配即return)
```
痛点：
1. **未 await + 无顶层 try/catch**：`message.js:12` `this.plugins.deal(e)` 未 await;deal 内 context/accept/rule 各有局部 try/catch 但**顶层无边界** → 易成 unhandled rejection,错误静默(§2.1.2)。
2. **单体 deal()**：所有阶段写死在一个 ~120 行方法里,新增横切关注点(tracing/错误边界/新匹配语义)必须改单体,易引入回归。
3. **派发语义**：rule 首个正则匹配且执行即 `return`(`loader.js:308`)——**权限被拒/handler 抛错后,后续插件无机会**(§2.1.1)。注:这是**现有行为**,baseline 已固化它。
4. **插件双实例化**：`loadPlugin` `new p()` 跑 `init()`(`:138`),再 `new p()` 用于 rule(`:145`)→ **init 在实例#1 的副作用,rule 用的是实例#2**,丢失;且两次构造开销(§2.1.4)。
5. **adapter 热更重复 push**：adapter 在 `plugins/adapter/*` 经插件扫描加载,但注册到 `Bot.adapter`/`Bot.wsf`;`changePlugin`/watch 不在 priority 体系内 → 热改**重复 push**,副作用叠加(§2.1.5)。

---

## 2. 目标（To-Be）

- **(R)** 把 deal() 拆成**有序中间件管道**(每段单一职责、可单测),`deal = await pipeline.run(ctx)`;顶层 await + try/catch + 结构化 tracing。**逐段行为与现状逐字一致**。
- **(R)** 插件**单次实例化**:一个实例承载 init + rule。
- **(R)** adapter **幂等注册**:重复加载/热更不叠加。
- **(S，单独决策)** 派发语义可选改良:权限拒绝/handler 异常 → `continue` 给后续插件机会(**会改 baseline**)。

---

## 3. 设计

### 3.1 中间件管道（R · 行为保持）
```js
// lib/plugins/pipeline.js（新，纯框架，无业务）
// 中间件签名：async (ctx, next) => { ...; await next(); ... }   (Koa 洋葱模型)
// ctx = { e, loader, state }
class Pipeline {
  use(name, fn) { this.stack.push({ name, fn }) }
  async run(ctx) { /* 依序执行，支持 ctx.stop() 短路 */ }
}
```
deal() 改为按**与现状完全相同的顺序**装配中间件：
```
mwBlacklist → mwCooldown → mwPrepareEvent(dealEvent+gamePrefix+isXx setter)
→ mwReplyWrap → mwRuntimeInit → mwActivateLazy → mwDispatch(getContext+accept+rule)
```
- **关键约束**：每个中间件**搬运现有代码、不改逻辑/顺序/短路点**。`mwDispatch` 内部仍保持"首匹配即 return"(R 阶段不动语义)。
- 顶层:`async deal(e){ try { await this.pipeline.run({e}) } catch(err){ Bot.makeLog("error",["派发异常",err]) } }`,且 `message.js` 改 `await this.plugins.deal(e)`。
- **验证**:`baseline --check` 必须仍 PASS(23 条路由不变);新增 tracing 不影响匹配。

> 选型:不引入 Koa 依赖,自写 ~30 行 Pipeline(洋葱模型);未来可与 cordis Context 打通(cordis 有 lifecycle,但派发管道用轻量自管更可控)。

### 3.2 插件单次实例化（R · 行为保持,但需谨慎）
`loadPlugin` 改为:
```js
const plugin = new p()
if (plugin.init && (await plugin.init()) === "return") return  // 同一实例
// ...collectTask / rule 正则编译 / push 均用同一 plugin
```
- **风险**:现状是"rule 用全新实例",若某插件在 `init()` 里 mutate 了实例字段、又**期望 rule 阶段是干净实例**,合并后行为变。**评估**:绝大多数 init 是注册任务/读配置(幂等),合并更符合直觉;但**必须全量验证**——deal 每次匹配时本就 `new i.class(e)`(`:285`)生成执行实例,所以 priority 里存的实例主要用于读 `rule`/`accept`/`task` 元信息,**合并风险低**。但仍列为需重点回归项。
- **验证**:baseline --check + 抽样若干含 init 的插件(genshin/miao)启动日志与能力注册不变。

### 3.3 adapter 幂等注册（R）
- 现状 adapter 经插件扫描加载并 push 到 `Bot.adapter`/`Bot.wsf`。
- 方案:注册按 **adapter id 去重**(已存在则替换而非 push);或将 adapter 加载**移出 plugin 扫描**单独管理(更彻底,但改动面大)。
- **R 首选**:幂等 push(按 id 替换),最小改动、消除热更叠加;"移出扫描"作为后续 S/大件。
- **验证**:启动 + 模拟热更(touch adapter 文件)后,`Bot.adapter` 长度不增、ws 路由不重复。

### 3.4 （S）派发语义改良 —— 默认不做,单独决策
- 改"首匹配即 return"为"权限拒绝/handler 抛错 → continue 给后续插件"。
- **风险**:可能导致**同一命令被多个插件响应**(原本被首个拦截),行为变化面大、难预判。
- **若要做**:必须 ① 明确新语义规则(什么情况 continue/什么情况 stop);② **重做 baseline 快照**并人工逐条 review diff;③ 充分回归。**列为独立提案,不混入 R。**

---

## 4. 分期实施（评审通过后，每步 baseline 守；R 优先）

- **R-1 顶层边界**：`message.js` await + `deal` 顶层 try/catch + 结构化 tracing(event/plugin/耗时)。baseline PASS。(最低风险,先落)
- **R-2 管道骨架**：`Pipeline` + 把现有阶段**原样**搬成中间件,deal=pipeline.run。逐段对照,baseline PASS。
- **R-3 单次实例化**：loadPlugin 合并实例,重点回归 init 插件。baseline PASS + 能力注册日志比对。
- **R-4 adapter 幂等**：按 id 去重注册,模拟热更验证不叠加。
- **S-1（可选,需批准）**：派发语义改良 + 重做 baseline。

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 管道搬运时漏掉某短路/顺序 | 逐段 diff 对照原 deal;baseline 23 条守路由;新增 tracing 不改判定 |
| 单次实例化改变依赖实例状态的插件 | 评估低风险(执行用 new i.class);重点回归 genshin/miao 启动+能力注册 |
| adapter 去重误伤多账号/多协议 | 按 id 去重(不同 id 不冲突);保留多 adapter 并存 |
| 出图/网络行为本机不可验 | R 不碰出图/网络;PC 终验兜底 |
| 语义改良(S)误改行为 | 默认不做;做则重做 baseline + 人工 review |

## 6. 评审决策点
1. **只做 R(行为保持)、S 暂不做** —— 接受?
2. R 顺序 R-1→R-4,每步 baseline 守 —— 接受?
3. 自写轻量 Pipeline(不引 Koa,暂不绑 cordis lifecycle)—— 接受?
4. 单次实例化(3.2)的低风险评估 —— 接受?还是要先单独验证再合并?

> 评审通过后从 **R-1**(顶层 await + try/catch + tracing)开始,最低风险先落地。
