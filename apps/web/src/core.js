/**
 * 核心包引用点。
 *
 * 整个 Web 应用只通过这里访问 @xideng/core，因此打包脚本
 * （scripts/build.mjs）只需要改写这一个 import 路径，
 * 就能把"开发时引用仓库源码"切换为"发布时引用 dist/core"。
 */
export * from "../../../packages/core/src/index.js";
