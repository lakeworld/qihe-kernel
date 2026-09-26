# 隐私与安全证据面

> @回答: 宿主到底往网络上发了什么、插件能做什么、哪些边界目前**不**成立。
> @类型: 契约
> @权威: 本仓的隐私判据以本文件为准；代码是最终权威，本文件只是导读
> @窗口: 2026-09-27

写给两类人：想核实承诺的用户，和想写插件的作者。每条都指出可以在本仓直接读到的实现位置——不能指出的，就明说不能。

## 一、对外网络出口（穷举）

宿主主动发起的对外请求只有下面七条，全部指向启禾自有域名。**没有第八项，且这一条由机器把关**（见第四节）。

| # | 链路 | 方法 | 何时 | 请求体内容 | 实现 |
|---|---|---|---|---|---|
| 1 | 检查更新 | GET | 启动 / 手动检查 | 无 | `src/main/updater.ts` |
| 2 | 下载更新包 | GET | 用户点「下载更新」 | 无（只下不上） | `src/main/core/updatePlan.ts` |
| 3 | 账号登录 | POST | 用户主动登录 | 邮箱或用户名 + 口令 | `src/main/account.ts` |
| 4 | 活跃心跳 | POST | **仅已登录**，每 1 小时 | `device_id` / `platform` / `version` | `src/main/account.ts` |
| 5 | 插件目录（登录态=完整目录；未登录=匿名骨架：名称/图标/一句话描述＋登录好处文本，不含下载地址） | GET | 打开插件管理页；未登录时打开「我的」账号区 | 无 | `src/main/plugins/catalog.ts` |
| 6 | 插件包下载 | GET | 用户点安装 | 无（只下不上） | `src/main/plugins/download.ts` |
| 7 | 插件云能力（代签中继） | POST | 用户在插件内主动操作 | 取决于插件 | `src/main/plugins/host.ts` |

三条要在意的细节：

- **服务地址不写死在插件面代码里。** 第 3–7 条的 `baseUrl` 由装配层注入（`account.ts` 的 `deps.baseUrl`、`catalog.ts` 的 `deps.baseUrl`、`host.ts` 的 `cloudFetchImpl.baseUrl`）。装配层如何解析服务器地址（环境变量 / 配置文件三级回退）住在闭源的 `src/main/index.ts`，**本仓核不到这一条**；本仓能核到的是：这些模块内部没有任何硬编码的第三方地址，未注入 baseUrl 时功能直接报 `NO_SERVER` 而不发请求。
- **全仓只有两处出现字面域名**：`src/main/updater.ts` 与 `src/main/core/updatePlan.ts`（更新链必须知道去哪找新版，这两处是出厂默认值）。新增第三处 ⇒ 门禁红。
- **第 7 条有路径白名单**：`host.ts` 的代签中继只放行 `/api/box/*` 与 `/api/ai/*`，插件不能借宿主的登录态打任意路径。

零第三方依赖：无遥测、无 analytics、无崩溃上报、无广告 SDK、无 CDN 引用；中文字体是随包本地子集。

## 二、宿主本体不上传文件

`src/main/**` 内 `multipart` / `FormData` / `putObject` 的命中数是零。工作区文件、文件名、目录清单都不在任何请求体里。心跳那三个字段：`device_id` 是本机随机生成的 UUID（不含硬件标识；登出只停上报、不作废它——标识留在本机、重登复用），`platform` 含 CPU 架构，`version` 是软件版本。

**但插件可以上传您交给它的内容**——这是本文件最重要的一条，别跳过：您启用的 AI 识别 / 云端备份类插件，会把您选中的那张图的 base64、或那份文档的正文，经第 7 条链路发往启禾云。不启用就不出本机；停用、卸载均可停。

## 三、诚实说明：目前**不**成立的边界

把不成立的写清楚，比让人自己发现强。

1. **`permissions.network` 是声明式披露，不是运行时强制。** 插件清单里的网络权限用于安装时明示与事后审计（定义见 `src/plugins/types.ts`）；宿主**不在运行时拦截**插件向未声明域名发请求——插件主进程跑在 Node 环境，技术上具备自行发起任意 HTTP 请求的能力。因此：只安装官方插件或您信任的第三方插件。要做运行时域名强制是另一件产品级安全工程，会牵动已发货插件，未做。
2. **主窗口 `sandbox: false`。** 窗口创建的 webPreferences 实现在闭源仓，本仓读不到，故把原文贴在这里作为证据片段（`src/main/window.ts` 的 `new BrowserWindow` 段）：

   ```ts
   webPreferences: {
     preload: path.join(__dirname, '../preload/index.mjs'),
     contextIsolation: true,
     nodeIntegration: false,
     sandbox: false, // ESM preload 需要；阶段 6 安全评估
     spellcheck: false,
     webgl: false,
     v8CacheOptions: 'code',
   },
   ```

   `contextIsolation` 开、`nodeIntegration` 关；`sandbox` 为 false 的原因是 ESM preload 的技术限制，不是省事。本仓可核实的是渲染层入口只经 `qihebox://` 协议与 contextBridge，见 `src/main/protocol.ts`。
3. **插件包的加密不是防破解。** 解密逻辑全在本仓 `src/main/plugins/encryption.ts`，公开即承认：安全依赖密钥服务端化与取钥审计（`plugin-key` 按订阅门槛裁决发钥），防的是静态提取与无账号分发，**不防**有决心的用户自行转储明文。这是 Kerckhoffs 前提下的有意选择，不是漏洞。
4. **局域网协作插件**（官方 `lan`）会在本机监听端口，把工作区文件字节发给已配对的对端。它不出内网，但同网段设备能看见它；不需要时请在插件管理页停用。

## 四、这些承诺由什么把关

`tests/unit/networkEgress.test.ts`（随本仓导出，可本地跑）常驻断言四件事：

1. `src/**` 里出现的全部字面 host ⊆ 允许集（`tests/unit/__baselines__/network-egress.json`）；
2. 字面 `www.qihebook.cloud` 只准出现在第一节说的那两个文件里（文件级棘轮，第三个文件即红）；
3. `src/main/**` 的出口调用点清单与基线逐项一致（新增出口即红，删除出口也即红）；
4. `src/main/**` 内文件上传原语命中数为零。

所以本文件不会与代码悄悄分叉：改了代码不改基线，测试就红；改了本文件而代码没变，读代码的人一眼能看出来。

## 五、发现问题怎么告诉我们

本仓**不开 Issues、不收 PR**（公开面保持只读）。如果你的核对发现协议不符、本文件与代码对不上、或本地校验跑不通，请发邮件到 `ai_qihe@vip.qq.com`，附上你跑的判据与读数——能复现的差异一定会被跟进（README「出处」一节同渠道）。
