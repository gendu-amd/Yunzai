/**
 * 框架级 `renderer` 能力 —— 包装出图后端（RendererLoader.getRenderer()，默认 puppeteer），
 * **带文本降级**：后端缺失 / Chromium 起不来 / 截图失败 → 返回 fallbackText（或 null），让消费方
 * 优雅降级而非崩溃。插件现有出图路径全部保留。
 *
 * 注：后端来自 `lib/renderer/loader.js` 的 default export（RendererLoader 实例，含 getRenderer）。
 * 旧实现误读 `global.Renderer`（那是 art-template 的 Renderer 类、无 getRenderer），导致 available
 * 恒 false、render 恒降级 —— 已改为直接引用真正的后端注册表。
 */
import RendererLoader from "../renderer/loader.js"

export function createRenderer() {
  return {
    /** 出图后端是否已注册（注意：true 不代表 Chromium 一定可用，真失败时 render 会走降级） */
    available() {
      const b = RendererLoader?.getRenderer?.()
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
        const backend = RendererLoader?.getRenderer?.()
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
