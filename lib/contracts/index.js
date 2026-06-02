/**
 * Yunzai 契约层 L1 · core 门面（chapter1-01 / Phase A）
 *
 * 目标(见 docs/target-architecture.md §2/§10)：
 *  - 业务/插件只依赖本模块的 `core.*`(provide/require/has/list + hook.on/emit/emitAsync/veto)。
 *  - 实现是细节、可替换。
 *
 * 基座：**轻量自管**(能力=Map,hook=简易事件总线)，无外部 DI 依赖(ADR-008)。
 *   —— 原 cordis 仅被当 Map+EventEmitter 用,其 Service/dispose/scope 等独有能力生产中从未使用,
 *      为减依赖、更透明/易管理,改为 ~40 行自管实现,`core.*` API 完全不变。
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
import { createPluginRegistry } from "./pluginRegistry.js"
import { createRenderer } from "./rendererPort.js"
import { createGamePrefixRegistry } from "./gamePrefixRegistry.js"

/** 能力表(名→实现) */
const caps = new Map()
/** hook 总线(名→监听集合) */
const hooks = new Map()
const listeners = name => hooks.get(name) ?? []

export const core = {
  /** 契约版本（破坏性变更升大版本） */
  version: "0.2.0",

  /** 注册能力。name 如 'account'/'gameData'/'rank'/'renderer'/'gameRegistry' */
  provide(name, impl) {
    caps.set(name, impl)
    return core
  },

  /** 取能力；取不到返回 null，调用方负责降级（不抛错） */
  require(name) {
    return caps.get(name) ?? null
  },

  /** 能力是否就绪 */
  has(name) {
    return caps.get(name) != null
  },

  /** 列出已注册能力名 */
  list() {
    return [...caps.keys()].filter(k => caps.get(k) != null)
  },

  hook: {
    /** 订阅 hook；返回退订函数(可逆) */
    on(name, fn) {
      if (!hooks.has(name)) hooks.set(name, new Set())
      hooks.get(name).add(fn)
      return () => hooks.get(name)?.delete(fn)
    },
    /** 同步触发：依序通知 + 引用改写（payload 被监听就地修改并返回）；不等待 async 监听 */
    emit(name, payload) {
      for (const fn of listeners(name))
        try {
          fn(payload)
        } catch (err) {
          logger?.warn?.(`[hook:${name}] 监听异常:${err?.message}`)
        }
      return payload
    },
    /**
     * 异步触发：**等待**所有监听（含 async）跑完,监听就地改写 payload 后返回。
     * 用于"渲染前注入数据"等需 await 的扩展点（如 profile:beforeRender，ark 拉排名后改写）。
     */
    async emitAsync(name, payload) {
      await Promise.all(
        [...listeners(name)].map(async fn => {
          try {
            return await fn(payload)
          } catch (err) {
            logger?.warn?.(`[hook:${name}] 监听异常:${err?.message}`)
          }
        }),
      )
      return payload
    },
    /** 否决：任一监听返回非空值即拦截(ADR-002:返回真值=拦截)；按序短路 */
    veto(name, ...args) {
      for (const fn of listeners(name)) {
        const r = fn(...args)
        if (r != null) return !!r
      }
      return false
    },
  },
}

/**
 * PluginManifest 注册表（框架内建，chapter1-05）。在插件加载【前】就绪。
 * 既以 capability 形式暴露（`core.require('pluginRegistry')`，统一发现），
 * 也提供便捷别名 `core.manifest`。纯声明式元信息，不触碰 loader/派发。
 */
const pluginRegistry = createPluginRegistry()
core.provide("pluginRegistry", pluginRegistry)
core.manifest = pluginRegistry

/**
 * 框架级出图能力 `renderer`（带文本降级，chapter2）。包 global.Renderer 现有后端。
 */
core.provide("renderer", createRenderer())

/**
 * 框架级游戏命令前缀注册表 `gamePrefix`（chapter2 A-3 / ADR-007）。框架只持有**空注册表**,
 * 具体游戏(sr/zzz)前缀由**各游戏插件在 manifest.contributes.gamePrefix 声明**,框架 wireManifests
 * 自动注册——游戏知识归插件、框架不硬编码(层级正确、加游戏=改 manifest)。loader 仍留 srReg/zzzReg fallback。
 */
const gamePrefix = createGamePrefixRegistry()
core.provide("gamePrefix", gamePrefix)
core.gamePrefix = gamePrefix

/**
 * 框架内建 manifest：声明框架自身提供的能力，使 providersOf/checkRequires 全程 manifest 驱动。
 */
pluginRegistry.register({
  name: "yunzai-core",
  version: core.version,
  type: "framework",
  provides: ["pluginRegistry", "renderer"],
  requires: [],
  hooks: [],
})

export default core
