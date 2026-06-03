/**
 * 框架级游戏命令前缀注册表 —— loader 派发前用它把「游戏前缀」归一化成标准命令(如 `*角色` → `#星铁角色`)。
 *
 * 框架(L0)只持空表、不硬编码任何游戏;具体前缀由各游戏插件在自己 index 经
 * `core.gamePrefix.register(...)` 贡献，**新增游戏无需改 loader**(注册表归框架所有,不反向依赖插件)。
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
     * 顺序匹配，第一个命中即返回（先注册先匹配）。
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
