# 懒激活（Lazy Activation）设计文档 · 评审稿

> 状态：**设计评审中（未写码）** · 2026-05-31 · 对应 `1-05` 第二步 / Phase D
> 目标读者：评审后据此实现。实现前请确认本文"正确性约束"全部接受。

## 1. 目标与动机

- **现状**：`loader.load()` 启动时 **import 全部插件文件 + `new p()` 实例化**,把每个 `plugin.rule` 的正则收进 `this.priority`。
- **痛点**：① 启动期脆弱（任一文件 import 失败/超时影响加载,虽已加 per-plugin 隔离）;② 资源占用（全部模块常驻内存,即使从不触发）;③ 启动慢。
- **目标**：对**声明了激活触发器**的插件,**命中触发器才 import + 实例化**(VS Code `activationEvents` 模型),降低启动脆弱性/占用。**非目标**:改变任何命令的路由结果与执行行为。

## 2. 根本约束（鸡生蛋）—— 决定设计形态

**`plugin.rule[].reg` 正则定义在插件类内部,只有 `import + new p()` 之后才可知。**
→ 要"命中才加载",框架就必须在**不运行插件代码**的前提下知道"该插件被什么触发"。
→ **唯一正确解**:触发器**在 manifest 里声明**(对标 VS Code `contributes.commands`/`activationEvents`、NoneBot `PluginMetadata`)。复用本项目已有的 `pluginRegistry` + `manifest.js`。

> 推论:**没有声明触发器的插件无法安全懒加载**(框架不知道何时该唤醒它)。故懒激活**必须 opt-in**,默认保持现有 eager 行为。

## 3. 正确性约束（"功能完备"的红线）

懒加载会把"插件代码的执行"推迟到首次命中。以下能力**在命中前就需要存在**,因此**带这些的插件必须保持 eager**(不可懒加载),否则功能必然缺失:

| 能力 | 为何不能懒 | 处置 |
|---|---|---|
| `accept(e)` | 每条消息都跑(非命令匹配) | 有 `accept` → 强制 eager |
| `task`(定时任务) | 与消息无关,按 cron 跑 | 有 `task` → 强制 eager |
| `handler`(Handler.add) | 供他人 `Handler.call` 调用,无命令触发 | 有 `handler` → 强制 eager |
| `getContext` 上下文 | 多步会话中途态 | 有上下文用法 → 强制 eager |
| `init()` 副作用 | 启动期初始化(注册能力/迁移等) | 有 `init` → 强制 eager（或显式声明 init 安全可懒） |
| 无 `rule`/触发器不可枚举 | 无法声明触发器 | 不可懒,eager |

**规则:懒加载是"声明触发器 且 不含上述任一项"的插件才允许。** 框架在加载清单时自动判定,任何不满足者回退 eager。这样**不会有任何插件因懒加载而功能缺失**。

## 4. 设计

### 4.1 manifest 声明触发器（新增字段,向后兼容）
```js
// 插件 manifest.js 新增可选字段
activation: {
  // 命中其一即激活;regex 为字符串(框架编译)。建议与插件内 rule 的"前缀部分"一致。
  prefix: ["#xxx", "*xxx"],        // 快速前缀(startsWith)
  regex: ["^#xxx(帮助|菜单)"],      // 需要正则时
  // 该插件激活后承载的 rule 数(用于自检,可选)
}
```
- **不声明 `activation` → 永远 eager**(现状,零变化)。
- 框架校验:声明了 `activation` 但插件含 §3 任一"不可懒"能力 → **告警并回退 eager**(以正确性优先)。

### 4.2 loader 加载期：建"懒占位"
- `getPlugins()` 不变(枚举文件)。
- 对**有 `activation` 且通过 §3 判定**的插件:**不 import**,而是据 manifest 在 `this.priority` 注册一个 **lazy 占位项**:
  ```
  { lazy:true, key, file, activation:{compiledMatchers}, priority:manifestPriority, loader: ()=>import(file) }
  ```
  > 占位项的 `priority` 必须来自 manifest（与该插件真实 priority 一致,保证排序不变)。
- 其余插件:**eager**,走现有 `importPlugin/loadPlugin`(完全不变)。

> ⚠️ manifest 当前在**插件自身 index.js 运行时**注册(side-effect import)。懒加载要求"不运行插件代码就拿到 manifest" → **manifest 必须能被框架在加载期静态发现**。方案:约定每个可懒加载插件在仓根放 `manifest.js`(纯数据导出,无副作用),框架加载期 `import(manifest.js)` 单独读取(manifest.js 必须零副作用、不 import 重模块)。**这是实现前需落实的前置**。

### 4.3 派发期：命中→激活→正常路由
`deal(e)` / `dealEvent` 之后,匹配循环前:
1. 遍历 lazy 占位项,用 `activation` matcher 测 `e.msg`。
2. 命中者:`await loader()` import 真实模块 → 走 `loadPlugin` 把真实 rule 实例化进 `priority` → **移除该 lazy 占位** → **重排序**。
3. 之后照常进入现有匹配循环(此时该插件的真实 rule 已在 priority 中,路由/执行与 eager **完全一致**)。
4. 激活仅一次;后续该插件已是常规 eager 项。

> 关键:激活后,**最终的匹配/执行走的还是插件真实的 `rule`**,不是 manifest 的触发器。manifest 触发器只决定"何时把代码加载进来",**不参与最终路由判定** → 路由结果与 eager 等价。

### 4.4 热更新/卸载
- 文件变更:lazy 占位插件被改 → 失效其占位 + 已激活则按现有 watch 卸载重载。
- `core.scope`/dispose 语义不变。

## 5. 验证策略（本地可验，确保正确）

1. **路由零回归**:`0-00 baseline --check` 必须 PASS（eager 插件路由不变;lazy 插件在 corpus 命中时应被激活并路由到**相同** `plugin(fnc)`）。→ **为此需把至少一个被改为 lazy 的插件的命令加入 baseline 语料**,确保 diff 能覆盖"懒加载后路由仍一致"。
2. **试点等价**:选 1 个**纯命令、无 accept/task/handler** 的插件做试点(如 example 下某个),改造为 lazy:
   - dev 验证:首次发其命令 → 日志出现"懒激活 import" → 正常回复;再次发 → 不重复 import;
   - 对照:改造前后,该命令的回复/`plugin(fnc)` 一致。
3. **不可懒判定**:故意给一个含 `accept` 的插件声明 `activation`,验证框架**告警并回退 eager**(正确性兜底生效)。
4. **启动计数**:`加载插件[N个]` 中 lazy 插件**不计入启动期实例化**(或单列"懒待激活[M个]"),量化收益。

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| manifest 触发器与真实 rule 不一致 → 命令"叫不醒" | ①触发器建议由插件作者据 rule 前缀声明;②提供自检:激活后比对真实 rule 是否真的匹配,不匹配则告警;③baseline 语料覆盖 |
| 含 accept/task/handler 的插件误懒 → 功能缺失 | §3 自动判定强制 eager + 告警(红线) |
| manifest.js 有副作用/重 import | 约定 manifest.js 零副作用;框架隔离读取并校验 |
| 首次命中 import 延迟 → 首条命令变慢 | 可接受(一次性);可选"空闲预热" |
| 生态插件无 manifest | 默认 eager,零影响;懒加载纯 opt-in 增益 |

## 7. 分期实施（评审通过后）

- **L-1 机制**:loader 支持 lazy 占位 + 命中激活 + eager 兜底(默认无人用,行为零变化);baseline PASS。
- **L-2 manifest 静态发现**:框架加载期读取 `manifest.js`(零副作用约定)。
- **L-3 试点**:1 个纯命令插件改 lazy + 加入 baseline 语料,dev 验等价 + "不可懒"回退验证。
- **L-4 推广文档**:写"如何让插件支持懒激活"指南,生态 opt-in。
- **L-5（可选）**:核心仓内符合条件的插件逐个 opt-in(每个都过 baseline + 等价验证)。

## 8. 决策点（需评审确认）

1. **opt-in + eager 默认**(不强制全量改造)—— 接受?
2. **§3 不可懒红线**(accept/task/handler/context/init → 强制 eager)—— 接受?
3. **manifest.js 零副作用约定**(框架静态读取)—— 接受?
4. 实施顺序按 §7 L-1→L-5,每步 baseline 守 —— 接受?

> 评审通过后从 **L-1** 开始写码,严格逐步 + baseline 守护。
