/**
 * Renderer 能力（chapter2 · 框架级 L1 内建）
 *
 * 把框架现有出图后端（global.Renderer.getRenderer()，默认 puppeteer）包装成 L1 契约层
 * 的 `renderer` 能力，**带文本降级**：后端缺失 / Chromium 起不来 / 截图失败 → 返回 fallbackText
 * （或 null），让消费方优雅降级而非崩溃。
 *
 * ⚠️ 非侵入：仅"新增" core 通道；插件现有 `this.renderImg` / `Common.render` 路径全部保留。
 *    懒读 global.Renderer，注册顺序与渲染后端加载顺序无关。
 */
export function createRenderer() {
  return {
    meta: { provider: "framework" },

    /** 出图后端是否已注册（注意：true 不代表 Chromium 一定可用，真失败时 render 会走降级） */
    available() {
      const b = globalThis.Renderer?.getRenderer?.()
      return !!(b && typeof b.render === "function" && b.id)
    },

    /**
     * 渲染模板为图片消息；失败/无后端 → 文本降级（fallbackText）或 null。
     * @param {string} name  业务名（日志 / 临时文件名）
     * @param {object} data  透传后端，需含 `tplFile`（模板路径）等
     * @param {object} [opt]
     * @param {string} [opt.fallbackText] 失败时回退文本（返回该字符串，调用方可直接 reply）
     * @param {boolean}[opt.wrap=true]    是否用 segment.image 包裹 buffer（多图返回数组）
     * @returns {Promise<any>} segment.image | segment.image[] | fallbackText | null
     */
    async render(name, data = {}, opt = {}) {
      const { fallbackText = null, wrap = true } = opt
      try {
        const backend = globalThis.Renderer?.getRenderer?.()
        if (!backend || typeof backend.render !== "function") return fallbackText
        const img = await backend.render(name, data)
        if (!img) return fallbackText
        if (!wrap || typeof globalThis.segment?.image !== "function") return img
        return Array.isArray(img) ? img.map(b => segment.image(b)) : segment.image(img)
      } catch (err) {
        logger?.warn?.(`[contracts] renderer.render 失败，降级：${err?.message}`)
        return fallbackText
      }
    },
  }
}

export default createRenderer
