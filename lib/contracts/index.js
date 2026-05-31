/**
 * Yunzai 契约层 L1 · core 门面（chapter1-01 / Phase A）
 *
 * 目标(见 docs/target-architecture.md §2/§10)：
 *  - 业务/插件只依赖本模块的 `core.*`，不直接 import cordis —— cordis 是可替换实现细节。
 *  - 提供"能力注册/发现(provide/require) + HookBus(on/emit/veto) + 子作用域(scope, dispose 可逆)"。
 *
 * 基座：cordis 3.18.1（ADR-001 实证选定）。
 *
 * ⚠️ Phase A：本模块为纯新增，**当前无人 import**，不改变任何现有行为。
 *    后续 genshin/miao 等在各自 init 里 `core.provide(...)`，消费方 `core.require(...)`（取不到→null→降级）。
 *
 * 领域契约(端口) —— 形状约定(JSDoc，实现由各 provider 注册)：
 * @typedef {Object} AccountPort   账号能力(genshin 提供)
 *   getUid(e, game): Promise<string|null>
 *   getCookie(e, game): Promise<string|null>
 *   mysApi(uid, ck, {game}): MysApiClient
 * @typedef {Object} GameRegistry  多游戏 SSOT
 *   games(): string[]; biz(game,isOs); region(uid,game); term(game,key); prefix(game)
 * @typedef {Object} GameDataProvider 角色/面板/伤害(miao 提供)
 *   getCharacter(name,game); getProfile(uid,game); calcDamage(...); scoreArtifact(...)
 * @typedef {Object} RankProvider  排行(miao 群排行 / ark 全服)
 *   getGroupRank(...); getGlobalRank?(...)
 * @typedef {Object} Renderer      出图(带文本降级)
 *   render(tpl, data, {fallbackText?})
 *
 * 标准 hook 点(初版，详见 §2.2)：
 *   message:preDeal / account:afterBind / profile:afterData / profile:beforeRender /
 *   rank:query / gacha:afterFetch / render:before / render:after
 */
import { Context } from "cordis"

/** 进程级单根 Context（L1 宿主）。后续由宿主适配层挂到 Bot.ctx。 */
export const ctx = new Context()

export const core = {
  /** 契约版本（破坏性变更升大版本） */
  version: "0.1.0",

  /** 逃生舱：过渡期允许少数处直接拿 cordis ctx（应尽量只用下面的 core.*） */
  ctx,

  /** 注册能力。name 如 'account'/'gameData'/'rank'/'renderer'/'gameRegistry' */
  provide(name, impl) {
    ctx.set(name, impl)
    return core
  },

  /** 取能力；取不到返回 null，调用方负责降级（不抛错） */
  require(name) {
    return ctx[name] ?? null
  },

  /** 能力是否就绪 */
  has(name) {
    return ctx[name] != null
  },

  /** 列出已注册能力名 */
  list() {
    return Object.keys(ctx).filter(k => ctx[k] != null && typeof ctx[k] === "object")
  },

  hook: {
    /** 订阅 hook（扩展插件用，不碰他人代码） */
    on: (name, fn) => ctx.on(name, fn),
    /** 触发：通知 + 引用改写（payload 可被监听就地修改并返回） */
    emit: (name, payload) => {
      ctx.emit(name, payload)
      return payload
    },
    /** 否决：任一监听返回真值即拦截（ADR-002 约定：返回真值=拦截） */
    veto: (name, ...args) => !!ctx.bail(name, ...args),
    /** 异步否决 */
    vetoAsync: async (name, ...args) => !!(await ctx.serial(name, ...args)),
  },

  /**
   * 子作用域：fn 收到一个 cordis 子 ctx，在其中注册的能力/监听随作用域 dispose 自动回收。
   * 返回的 fork 调 .dispose() 即卸载（热重载/可逆，根治副作用泄漏）。
   */
  scope(fn) {
    return ctx.plugin(fn)
  },
}

export default core
