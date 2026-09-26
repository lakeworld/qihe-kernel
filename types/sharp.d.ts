// 插件图像处理能力用的 sharp 是原生模块（按平台带二进制），本仓不装它也能把公开面读完。
// 这里只给 host.ts:699 `await import('sharp')` 一个类型形状，让本仓能独立 typecheck；
// 真实安装与调用在闭源宿主仓，行为以宿主仓依赖声明为准。
declare module 'sharp' {
  const sharp: unknown
  export default sharp
}
