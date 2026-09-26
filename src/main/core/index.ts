/**
 * 宿主服务聚合层的中立替身。
 *
 * 真实实现在闭源的 qihe-box 仓 `src/main/core/index.ts`（约 300 行，聚合索引 / 工作区 /
 * 客户 / 报价 / 回收站等业务服务，不属公开面）。本仓只需要让 `protocol.ts` 通过类型检查：
 * 它把 BoxService 当**类型**用（`protocol.ts:22` 导入、`:220` 形参标注），运行时只访问
 * `box.workspace.currentWorkspacePath()` 一个成员（`protocol.ts:329`，拿工作区根做
 * realpath 前缀比对，挡符号链接逃逸）。
 *
 * 因此这里只声明那一个成员的形状，不补假实现、不写多余字段——多写一个成员就等于
 * 公开一个宿主并未承诺的 API。装配方（闭源）注入的是真 BoxService，结构上满足本类型。
 */
export type BoxService = {
  workspace: {
    currentWorkspacePath(): string
  }
}
