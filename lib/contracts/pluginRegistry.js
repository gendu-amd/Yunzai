/**
 * PluginManifest 注册表（chapter1-05 第一步 · 声明式那半，纯加层）
 *
 * 框架级（L1 宿主内建）能力：插件用 `core.require('pluginRegistry').register(manifest)`
 * 声明自己的清单（provides/requires/hooks/version/...），框架据此可做：
 *   - 能力提供/消费关系查询（providersOf/consumersOf）
 *   - 依赖体检（checkRequires，仅诊断、不强制——运行时缺失由 core.require()→null 降级）
 *   - 后续懒激活 / Guoba 发现 的元信息来源
 *
 * ⚠️ 本模块**不触碰 loader / 派发**：只是一个声明式元信息容器，对现有行为零影响。
 *    懒激活（命令前缀命中才激活）属第二步、改 loader，须有 0-00 基线护栏后再做。
 *
 * @typedef {Object} PluginManifest
 * @property {string}    name              插件唯一名
 * @property {string}   [version="0.0.0"]  语义化版本
 * @property {string}   [type="plugin"]    类型：plugin / data-provider / extension / tool ...
 * @property {string[]} [provides=[]]      对外提供的能力名（对应 core.provide）
 * @property {string[]} [requires=[]]      依赖的能力名（缺失→降级，不崩）
 * @property {string[]} [hooks=[]]         声明发布/订阅的 hook 点
 * @property {boolean}  [guoba=false]      是否提供 Guoba Web 配置
 */

/** 校验 manifest，返回错误信息数组（空数组=合法） */
export function validate(m) {
  const errs = []
  if (!m || typeof m !== "object") return ["manifest 必须是对象"]
  if (!m.name || typeof m.name !== "string") errs.push("缺少 name:string")
  if (m.version != null && typeof m.version !== "string") errs.push("version 必须是 string")
  if (m.type != null && typeof m.type !== "string") errs.push("type 必须是 string")
  // provides 允许 string[] 或 {能力名: importer} 对象;requires/hooks 仍为 string[]
  if (
    m.provides != null &&
    !(
      (Array.isArray(m.provides) && m.provides.every(x => typeof x === "string")) ||
      (typeof m.provides === "object" && !Array.isArray(m.provides))
    )
  )
    errs.push("provides 必须是 string[] 或 {name: importer} 对象")
  for (const k of ["requires", "hooks"]) {
    if (m[k] != null && (!Array.isArray(m[k]) || m[k].some(x => typeof x !== "string")))
      errs.push(`${k} 必须是 string[]`)
  }
  return errs
}

function normalize(m) {
  // provides 兼容两种写法:① 数组(纯声明名)② 对象 {能力名: importer}(声明 + 框架自动装配)。
  // 统一对外暴露为能力名数组,装配用的 importer 仍可从 raw.provides 取。
  const provideNames = Array.isArray(m.provides)
    ? m.provides
    : Object.keys(m.provides ?? {})
  return {
    name: m.name,
    version: m.version ?? "0.0.0",
    type: m.type ?? "plugin",
    provides: provideNames,
    requires: m.requires ?? [],
    hooks: m.hooks ?? [],
    guoba: !!m.guoba,
    raw: m,
  }
}

export function createPluginRegistry() {
  /** @type {Map<string, ReturnType<typeof normalize>>} */
  const manifests = new Map()

  return {
    /** 声明清单（校验失败抛错，便于早发现）；返回规范化 manifest */
    register(m) {
      const errs = validate(m)
      if (errs.length) throw new Error(`manifest 非法：${errs.join("；")}`)
      const norm = normalize(m)
      manifests.set(norm.name, norm)
      return norm
    },
    get: name => manifests.get(name) ?? null,
    has: name => manifests.has(name),
    list: () => [...manifests.values()],
    names: () => [...manifests.keys()],
    /** 声明 provides 了能力 cap 的插件名 */
    providersOf: cap => [...manifests.values()].filter(m => m.provides.includes(cap)).map(m => m.name),
    /** 声明 requires 了能力 cap 的插件名 */
    consumersOf: cap => [...manifests.values()].filter(m => m.requires.includes(cap)).map(m => m.name),
    /** 声明涉及 hook 点的插件名 */
    hookDeclarers: hook => [...manifests.values()].filter(m => m.hooks.includes(hook)).map(m => m.name),
    /**
     * 依赖体检（仅诊断）：每个 manifest 的 requires 是否有人满足。
     * @param {(cap:string)=>boolean} [isAvailable] 额外可用性判定（如运行时 core.has），
     *        默认仅按"已声明的 provides"判断。
     * @returns {Record<string,string[]>} { 插件名: [缺失能力...] }
     */
    checkRequires(isAvailable) {
      const declared = new Set([...manifests.values()].flatMap(m => m.provides))
      const ok = cap => declared.has(cap) || (typeof isAvailable === "function" && isAvailable(cap))
      const missing = {}
      for (const m of manifests.values()) {
        const miss = m.requires.filter(r => !ok(r))
        if (miss.length) missing[m.name] = miss
      }
      return missing
    },
    validate,
  }
}

export default createPluginRegistry
