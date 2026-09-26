# 启禾文件管理（qihe-box）· 本地产品资料工作台 —— 本仓是其开源宿主内核

> **启禾文件管理**（qihe-box）是一款面向电商与销售的**本地产品资料工作台**：产品图包、证书、质检报告、发票按「产品集」归档，找图几秒、拖一下就发给客户。Windows / Linux 桌面应用，资料存在自己机器里，下载即用。
>
> 本仓 **qihe-kernel** 公开的是它的**插件宿主内核 + 插件协议**（Apache-2.0）——那一层代码决定宿主如何加载插件、如何授权，以及**这个软件到底往网络上传了什么**。
>
> 我们把决定隐私的那一层单独公开出来，是因为它恰好也是插件作者需要的全部。想让源码可见性服务于"我的文件会不会被传走"这个问题，公开这一层比公开整仓更对症，也真的读得完。

**下载**：<https://www.qihebook.cloud/file-manager> ｜ **插件协议**：[docs/PLUGIN.md](docs/PLUGIN.md) ｜ **示例插件**：[src/plugins/hello/](src/plugins/hello/) ｜ **隐私与安全证据面**：[docs/SECURITY.md](docs/SECURITY.md)

## 它在解决什么问题

产品图片、证书、说明书散落在微信、钉钉、邮件和各个文件夹里——要用时翻半天，发给客户还怕拿错版本。启禾文件管理把散落的产品资料按「产品集」归拢到一处，几秒找到、直接外发。对照看是不是你：

- 做电商（Temu、亚马逊、独立站、国内平台）要频繁给客户发主图、详情页图、白底图，图包散在多个文件夹；
- 供应商发来的图片和证书堆在微信、钉钉、邮件里，下载下来就更找不到是哪家哪个型号；
- 客户临时要 3C 证或质检报告，得在几秒内翻出来，而不是重开网盘从头搜；
- 证书快到期没人提醒，等客户问起来才发现过期；
- 产品资料不想上传到任何云端，但换电脑时希望整个文件夹拷走就能接着用。

## 适合谁

- **电商卖家、品牌运营、供应链销售、线下客户经理**——凡是经常要给客户发产品图、发证书的人；
- **一到三五人的小团队**：资料天然按客户 / 系列 / 项目成组，每天大量时间花在"找图—发图—收图"上；
- **要把数据留在自己机器里的人**：工作区就是一个普通文件夹，放进坚果云 / OneDrive / NAS 即可多设备使用——同步由你自己选的服务承担，本软件不碰；
- 需要**能核对的隐私承诺**的场景：宿主内核公开、联网出口由测试钉死（见[隐私一节](#隐私与联网边界可逐行核对)）。

**不适合什么**（先说清楚，省彼此时间）：

- 它**不是网盘**：没有外链分享、多人在线协作、跨账号同步；
- 它**不是 DAM 全家桶**：没有版本审批、在线评论、转码流水线；几十人共用一套素材库、需要权限模型的，建议评估专业 DAM；
- 它**不是进销存 / CRM**：库存、订单、客户跟进属于启禾的另一条产品线（[启禾 OS](https://www.qihebook.cloud/)）。文件管理是独立工具，不依赖那边的账号即可使用。

## 能做什么

资料结构：`产品集`（一个客户 / 一个产品系列 / 一个项目）→ `图包 / 证书` → 子文件夹（主图、详情页、白底图、3C、质检…）。跟着业务习惯走，不需要学新概念。

| 能力 | 实测口径 |
|---|---|
| 万图不卡 | 图包库 / 证书库虚拟滚动，1 万张图的列表 DOM 卡片稳定在 36~54 个，滚动丝滑、内存不涨 |
| 跟手拖出即发 | 拖出去的就是你正在拖的那张真实图片，拖到桌面 / 微信 / 邮件即原图；复制后在聊天窗口 `Ctrl+V` |
| 拖拽导入自动归档 | 图片 / 证书拖进去，按命名模板自动重命名、归到对应子文件夹，不用手动整理 |
| 证书到期提醒 | 填上到期日，到期前 30 天在仪表盘提醒，不再错过续证 |
| 全局秒搜 | `Ctrl+K` 搜全部，结果按「产品集 / 文件」分组；库内名称搜索可与标签筛选叠加 |
| 本地预览 | 图片、PDF（连续滚动、文字选中复制、全文搜索、缩放 40%–400%、跳页）、视频（自动抓帧缩略图、点击即播） |
| 批量与压缩分享 | 批量复制 / 打标签 / 重命名 / 删除；选中文件流式打包 zip（实时进度、可取消，上限 4GB / 65535 个文件） |
| 回收站兜底 | 删除先进回收站，30 天内可恢复，每条显示剩余天数，标签、备注、缩略图原样找回 |
| 托盘常驻 | 关窗最小化到托盘，点开原样恢复（实测 p95 35ms）；常驻约 490MB，开机自启不建窗约 285MB |
| 数据自包含 | 文件、配置、元数据全在工作区文件夹内：无数据库、纯 JSON 持久化，备份 = 复制整个文件夹；15000 文件的工作区首页统计 125ms |

## 平台与获取

- **Windows 10 / 11**、**Linux**（Ubuntu / Deepin；deb amd64 与 AppImage）。
- 安装包由官网自托管：<https://www.qihebook.cloud/file-manager>（下载前过一次图形验证码，只为挡批量抓取）。
- 更新：启动时与每 24 小时静默检查，应用内「下载更新 → 退出并安装」；deb 版引导到官网下载。
- Windows 安装时提示"未知发布者"属正常（未购买商业签名证书，点「更多信息 → 仍要运行」）——**请只从官网获取安装包**。
- 三分钟上手：下载安装 → 选一个常用文件夹当工作区（首次打开会自动建一个）→ 把图片 / 证书文件夹拖进来 → 建产品集、打标签、搜索外发。

## 本仓包含什么

| 内容 | 路径 | 为什么在这里 |
|---|---|---|
| 插件协议与宿主 API 类型 | [`src/plugins/types.ts`](src/plugins/types.ts) | 第三方插件作者的唯一规范来源，v1 发布即冻结、只增不删 |
| 插件协议文档 | [`docs/PLUGIN.md`](docs/PLUGIN.md) | 契约规范：清单字段、能力域、信任分级、`.qbox` 打包格式 |
| 示例插件 | [`src/plugins/hello/`](src/plugins/hello/) | 15 分钟上手的教学样板（含 [README](src/plugins/hello/README.md)） |
| 协议与文件服务 | [`src/main/protocol.ts`](src/main/protocol.ts) | `qihebox://` scheme、工作区文件的 realpath 边界校验、插件面 CSP |
| 插件加载与隔离 | [`src/main/plugins/`](src/main/plugins/) | 宿主：注册表、下载、加密取钥、缩略图 |
| **全部对外网络出口** | 见[下文隐私一节](#隐私与联网边界可逐行核对) | 账号、心跳、更新、插件目录 |
| 本地存储与日志 | [`src/main/core/`](src/main/core/) | 原子写 JSON、路径引擎、日志 |

**不包含**：渲染层（SolidJS 界面）、文件业务逻辑（产品集 / 图包 / 证书 / 发票 / 台账）、测试、构建配置。

本仓有两处**替身**：`src/main/core/index.ts` 只给出被公开代码真正读到的最小结构，`src/main/updaterMain.ts` 是零网络出口的更新引擎薄壳（下载与校验逻辑在公开的 `src/main/core/updatePlan.ts` 里）。两处都在文件头部写明了替谁、为什么可以替——审计时请把它们当边界读，别当成实现的简化版。

## 隐私与联网边界（可逐行核对）

一句话：**宿主本体没有任何文件上传实现，全部对外请求只指向 `www.qihebook.cloud` 一个域名。** 这一句既能被本仓代码逐行核对，也能被机器验证——完整披露、逐条出处与把关测试都在 **[`docs/SECURITY.md`](docs/SECURITY.md)**，那里同时写明**本软件做不到什么**。

- **七条链路，没有第八项**：检查更新、下载更新包、账号登录、活跃心跳、插件目录、插件包下载、插件云能力（代签中继）。新增一处出口或一个新域名，上游的门禁测试直接红，改动合不进来。
- **零**：遥测、analytics、崩溃上报、广告 SDK、第三方 CDN；中文字体是随包本地子集。
- **账号与心跳都可选且最小**：不登录，则登录与心跳两条从来不会发生；心跳只在已登录时每 1 小时一次，只带 `device_id`（本机随机 UUID，不含硬件标识）/ `platform` / `version` 三个字段，登出即停。本地文件管理的全部功能与是否联网无关；服务地址还可三级回退自建。
- **必须说清的边界**（不是免责话术，是架构事实）：本体零上传 ≠ 整个生态零上传。**AI 识别、云端备份这类能力由插件承担**——您主动交给它什么，它才可能传什么（例如您选中去识别的那张图），且只在您主动使用该功能时发生；插件清单里的 `permissions.network` 目前是**声明式披露，宿主不在运行时拦截**，所以请只安装官方插件或您信任的第三方插件。局域网协作插件不出内网，但同网段设备能看见它。

给普通用户看的隐私协议随安装包与官网发布，不在本仓（本仓只公开内核这一层）；这里的 [`docs/SECURITY.md`](docs/SECURITY.md) 是给愿意读代码的人读的证据面，两者说的是同一件事。

## 许可

- 本仓全部内容：**Apache License 2.0**（见 [LICENSE](LICENSE)）。可自由使用、修改、再分发，含商业用途，需保留版权声明。商标「启禾」不受该许可授予。
- 启禾文件管理**本体（含渲染层与业务实现）：闭源**；本地文件管理本体**永久免费、无广告、无激活、无功能锁**，增值能力（AI 识别、云端备份等官方插件）按订阅提供。本仓的 Apache-2.0 **不**授予对本体其余部分的任何权利。
- 基于本内核构建并分发的插件，其自身许可证由插件作者声明。

## 本地校验

```bash
npm i
npm run typecheck          # 两份 tsconfig：宿主内核 + 示例插件
npm run check:leaks        # 泄漏门禁（凭据 / 私人标识 / 本机路径 / 提交身份）
```

仓库根 `.kernel-provenance.json` 记下每次导出对应的上游 commit 与逐文件 sha256。

## 出处

本仓每个文件都来自上游 qihe-box 的某个 commit：多数是逐字节复制，少数由本仓另给一份内容——`src/main/core/index.ts` 与 `src/main/updaterMain.ts` 是最小形状替身，`scripts/check-no-secrets.mjs` 与 `scripts/build-hello-plugin.mjs` 只换文件头注释（剥掉内部沿革），规则与构建逻辑本体逐字节来自上游。**上游仓闭源**，所以「那个 commit 里确实有这些字节」这一环外人核不到——它由导出脚本与私有仓的门禁测试（`kernelSync`）把关，是您可以要求我们兑现的承诺，不是您可以自证的等式。

您在克隆里能自证的是另一半：**本仓内容与 `.kernel-provenance.json` 逐字节一致**（`sha256sum -b` 对照即可），这足以发现导出之后被人动过；以及**本仓没有导入 qihe-box 的提交历史**——整仓只有一个提交，且对象库里的 blob 数正好等于跟踪文件数（`git cat-file --batch-all-objects --batch-check | grep -c ' blob '` 对 `git ls-files | wc -l`）。

## 反馈与贡献

本仓内容由上游闭源仓 qihe-box 单向导出（按白名单、逐字节复制），**不接受外部直接提交的代码改动**，也**不开 Issues、不收 PR**——公开面保持只读。

- **核对出问题**（协议不符、本仓与代码对不上、本地校验跑不通）：发邮件到 `ai_qihe@vip.qq.com`，附上你跑的判据与读数——能复现的差异一定跟进。
- **使用问题与新功能建议**：用户群 <https://www.qihebook.cloud/wechat-group>（扫码入群，长期有效），或软件内「我的」页的入群与反馈入口。
- **想写插件**：从 [docs/PLUGIN.md](docs/PLUGIN.md) 与 [示例插件](src/plugins/hello/README.md) 开始，15 分钟上手。

## English summary

**qihe-box**（启禾文件管理）is a **local-first product-asset workspace for e-commerce and sales teams**: product image packs, certificates, QC reports and invoices are filed per *product set*, found in seconds, and dragged straight into WeChat / DingTalk / email. Windows and Linux desktop app (Electron + TypeScript + SolidJS); the local file-management core is free, with no ads and no activation.

This repository, **qihe-kernel**, is its **open-source plugin host and plugin protocol** (Apache-2.0): plugin loading and capability grants, the `qihebox://` scheme with realpath boundary checks, the update engine, local storage — and, deliberately, the complete set of network egress points. The application itself (renderer + business logic) stays closed-source, while the layer that decides *what this software may send over the network* is public line by line and pinned by a machine check (`tests/unit/networkEgress.test.ts`) rather than by prose.

**便于检索**：文件管理 · 本地优先 · 离线 · 电商 · 产品图 · 主图 · 详情图 · 图包 · 素材管理 · 证书管理 · 质检报告 · 发票 · 桌面应用 · 插件宿主 · 开源内核 · Electron · SolidJS · TypeScript · Apache-2.0 · Windows · Linux ｜ local-first file manager · product images · certificate management · plugin host
