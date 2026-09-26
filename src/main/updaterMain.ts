// 宿主实现闭源。本文件是私有仓 `src/main/updaterMain.ts`（更新引擎的 Electron 侧薄壳：
// 落盘下载、替换 .exe / AppImage、重启进程）在公开内核仓里的**形状替身**——
// 私有仓的 updater.ts:124 会动态 import 它，缺了这个文件公开面无法通过 typecheck。
//
// 网络出口不在这里：下载 URL 的解析与包校验全在 src/main/core/updatePlan.ts（本仓公开），
// updater.ts 只把校验通过的包交给引擎装。薄壳本身不做任何请求，因此替身不改变可审计结论。

import type { UpdateEngine } from './core/updatePlan'

export function createUpdateEngine(): UpdateEngine {
  throw new Error('qihe-kernel：更新引擎的 Electron 侧实现在闭源宿主仓，本仓只提供类型形状')
}
