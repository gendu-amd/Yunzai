# 懒激活作者指南（L-4）

> 面向插件作者：如何让一个插件支持"命令前缀命中才加载"(懒激活),降低启动期脆弱性/占用。
> 机制详见 `docs/lazy-activation-design.md`;状态见 `docs/refactor-progress.md`。

## 适用条件（先自检，红线!）

懒激活会把插件代码的加载推迟到**首次命中触发器**。因此插件**必须满足全部**以下条件,否则**不要**用(会丢功能):

- ✅ **目录型插件**(`plugins/<你的插件>/index.js`)。单文件插件(如 `plugins/example/*.js`)暂不支持。
- ✅ **纯命令驱动**:只靠 `rule` 响应命令。
- ❌ **不含** `accept(e)`(每条消息都跑)
- ❌ **不含** `task`(定时任务,与消息无关)
- ❌ **不含** `handler` / `Handler.add`(供他人 `Handler.call`)
- ❌ **不含** `getContext` 多步会话
- ❌ **index.js 无启动期副作用**:不在加载时 `Bot.xxx=` 打补丁、不 `core.provide` 注册能力、不跑数据迁移等

> 框架在**首次激活后**会做事后告警:若检测到 accept/task/handler,会提示"建议改 eager"。但激活前这些行为已缺失,所以请在采用前自检。

## 怎么做（两步）

### 1. 在插件根目录加 `manifest.js`（零副作用）
```js
// plugins/<你的插件>/manifest.js —— 只导出数据,不要 import 重模块、不要调用 Bot.core
export const manifest = {
  name: "your-plugin",
  type: "plugin",
  activation: {
    // 命中其一即加载。prefix 为前缀(startsWith);需要正则时用 regex(字符串)
    prefix: ["#你的命令", "#yp"],
    // regex: ["^#你的(帮助|菜单)"],
    // priority: 100,   // 可选,懒占位排序用;默认 100
  },
}
export default manifest
```

### 2. 确认 index.js 满足红线
- 命令逻辑照常写在插件类的 `rule` 里。**触发器(manifest.activation)应覆盖你所有命令的前缀**,否则没覆盖到的命令"叫不醒"插件。
- 建议:`activation.prefix` 与插件 `rule[].reg` 的前缀部分保持一致。

## 验证（务必）
```bash
bash .devenv/verify.sh "#你的命令"     # 应见日志:启动"懒激活待命[N个]" → 首发命令"懒激活 [你的插件]" → 正常响应
bash .devenv/baseline.sh --check       # 路由零回归(若你的命令在基线语料里)
```
- 首次命中应只 import 一次;再次发命令不应重复出现"懒激活"日志。
- 改造前后,命令的回复与 `[plugin(fnc)]` 路由应完全一致。

## 当前现状（2026-05-31）

> **核心仓内现有插件(genshin/miao/ark/Guoba/xiaoyao/TRSS)均不满足红线**——它们都在启动期 provide 能力、打 `Bot.*` 补丁或含 task/accept。故**暂无核心插件适合懒激活**;机制主要服务于**未来新增的小型纯命令插件**与第三方生态 opt-in。这是当前的客观限制,不是缺陷。
