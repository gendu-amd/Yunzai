/**
 * Yunzai 契约层 L1 · core 门面
 *
 * 插件间的稳定接口:provider 用 `core.provide(name, impl)` 注册能力,consumer 用 `core.require(name)`
 * 取用(取不到→null,自行降级);另含 `core.hook` 事件总线(provider 发布扩展点、扩展插件订阅)。
 * 轻量自管:能力=Map、hook=简易事件总线,无外部依赖(ADR-008 去 cordis)。各 provider 在自己
 * index/port 直接 `core.provide`(无 manifest/反射装配)。
 *
 * 现有能力:`account`/`gameRegistry`/`gacha`(genshin)、`gameData`/`rank`(miao)、`renderer`(框架)。
 * 现有 hook 点:`profile:beforeRender`(miao 面板渲染前,供 ark 等订阅就地改写 renderData)。
 * 各能力的方法详见对应仓的 CONTRACTS.md。
 */
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

/** 框架级出图能力 `renderer`（带文本降级）。包 global.Renderer 现有后端。 */
core.provide("renderer", createRenderer())

/**
 * 框架级游戏命令前缀注册表 `core.gamePrefix`(loader 派发归一化用,非领域能力故不进 require 表)。
 * 框架只持空表;具体游戏前缀由各游戏插件直接 `core.gamePrefix.register(...)`(genshin 在其 index 注册)。
 */
core.gamePrefix = createGamePrefixRegistry()

export default core
