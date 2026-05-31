/**
 * 游戏命令前缀注册表（chapter2 A-3 / Phase D 起步 · 框架级 L1 内建）
 *
 * 目的：把 loader 里硬编码的 srReg/zzzReg「前缀→游戏 + 归一化命令」做成**框架自有**的
 * 可扩展注册表（contributes 雏形）。框架(L0)拥有注册表与默认项；插件可经
 * `core.gamePrefix.register(...)` 贡献新游戏，**新增游戏无需改 loader**。
 *
 * ⚠️ 层级：注册表归框架所有（不反向依赖任何插件），避免 L0→L2 倒挂。
 *    loader 仍保留 srReg/zzzReg 作 fallback；本注册表权威，行为与旧硬编码逐字等价。
 *
 * @typedef {Object} GamePrefixEntry
 * @property {string} game            游戏 key（sr/zzz/...）
 * @property {RegExp} test            命中正则（建议 ^ 锚定）
 * @property {string} cmd             归一化后替换的命令前缀（如 "#星铁"）
 */
export function createGamePrefixRegistry() {
  /** @type {GamePrefixEntry[]} 有序：先注册先匹配（与 loader 原 if-else 顺序一致） */
  const entries = []

  return {
    /** 注册一个游戏前缀（插件贡献新游戏用）。重复 game 追加在后，不覆盖既有顺序。 */
    register({ game, test, cmd }) {
      if (!game || !(test instanceof RegExp) || typeof cmd !== "string") {
        logger?.warn?.(`[gamePrefix] 非法注册项：game=${game}`)
        return this
      }
      entries.push({ game, test, cmd })
      return this
    },

    /**
     * 检测消息前缀。命中→返回 { game, msg(归一化) }；未命中→null。
     * 顺序匹配，第一个命中即返回（与 loader 旧 srReg→zzzReg 顺序一致）。
     */
    detect(msg) {
      if (typeof msg !== "string") return null
      for (const e of entries) {
        if (e.test.test(msg)) return { game: e.game, msg: msg.replace(e.test, e.cmd) }
      }
      return null
    },

    /** 已注册的游戏 key（按注册顺序） */
    list() {
      return entries.map(e => e.game)
    },
  }
}

export default createGamePrefixRegistry
