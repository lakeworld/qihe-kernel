/**
 * 账号服务（v2.2.0）：可选登录（复用 ERP PocketBase 账号）+ 活跃心跳。
 *
 * 设计：
 * - 登录为可选；登录态供后续插件能力复用（host.account，见 PLUGIN.md）；统计是心跳副产品
 * - 隐私边界：心跳仅上报设备标识 / 平台 / 版本，文件与目录内容永不上传
 * - token 优先 safeStorage 加密落盘，Linux 无 keyring 时降级明文（本地单用户，JWT 过期即失效）
 * - **设备标识与 token 分家（v2.6.7 车 0）**：deviceId 单独落在 userData 之外的一枚明文随机 UUID 文件，
 *   不经解密闸门、不随 account.json 删除而消失。理由见 `readDeviceId()` 上方注释。
 * - 依赖注入（fetch / 加解密 / 版本 / 日志），主进程装配，vitest 可独立单测
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { writeJsonAtomic } from './core/jsonStore'
import {
  isUsernameConflict,
  looksLikeEmail,
  mapAccountApiError,
  MIN_PASSWORD_LEN,
  usernameFromEmail,
  withRandomSuffix,
  type AccountApiCall,
  type CaptchaChallenge,
} from '../shared/accountApi'

const HEARTBEAT_INTERVAL_MS = 60 * 60 * 1000
/** 登录请求上限（AbortController 超时 + race 兜底，v2.5.3 T4） */
const LOGIN_TIMEOUT_MS = 15_000
/** 单次心跳请求上限（v2.5.3 T4） */
const HEARTBEAT_TIMEOUT_MS = 10_000
/**
 * 设备标识文件的内容判据（v2.6.7 车 0）：只认一枚 UUID。
 * 文件在人手里（`~/.qihe/device-id`，可 cat 可改），拿到什么都当成自己的设备身份往服务端报
 * 等于把脏数据喂进 `box_devices` 的唯一索引位——不合法就当没有，重新铸一枚。
 */
const DEVICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 登录超时专用错误（与网络异常区分文案） */
class LoginTimeoutError extends Error {
  constructor() {
    super('login timeout')
    this.name = 'LoginTimeoutError'
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

/**
 * 登录后置恢复的退避档（v2.6.7 车 0-c）。三档合计 80s 后放弃——再长就变成后台常驻轮询，
 * 而钥匙串解锁要么在启动后几秒内发生，要么用户已经自己去点登录了。
 */
const LOGIN_RESTORE_DELAYS_MS = [5_000, 15_000, 60_000]

export interface AccountDeps {
  /** account.json 绝对路径（userData 下） */
  accountFile: string
  /**
   * 本机设备标识文件绝对路径（v2.6.7 车 0）。**刻意不在 userData 里**：
   * 手动清配置目录式重装、deb↔AppImage 换形态（两套 userData 目录名）都会带走 userData，
   * 放里面就等于"重装一次换一枚 id、服务端多占一格"。装配层给 `~/.qihe/device-id`。
   */
  deviceIdFile: string
  /** 登录/心跳服务地址（不含末尾斜杠）；由宿主从本地私有配置注入，不进公开仓 */
  baseUrl: string
  /** token 加密（safeStorage.encryptString → base64，失败抛错由调用方降级） */
  encrypt: (plain: string) => string
  /** token 解密；解密失败返回空串表示不可用 */
  decrypt: (encoded: string) => string
  /** 应用版本（app.getVersion） */
  version: () => string
  /** 日志（可选） */
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
  /** 网络实现（默认全局 fetch） */
  fetchImpl?: typeof fetch
  /** 登录请求超时（ms）；测试可缩短（v2.5.3 T4） */
  loginTimeoutMs?: number
  /** 单次心跳请求超时（ms）；测试可缩短（v2.5.3 T4） */
  heartbeatTimeoutMs?: number
  /**
   * 心跳 401 会话过期回调（v2.5.3 P1-6）：首次置位 sessionExpired 时触发一次，
   * 携带当前完整登录态（照 status() 形状）；装配层注入广播到渲染层（beat 可能无窗口，由装配层处理）。
   */
  onSessionExpired?: (status: AccountStatus) => void
}

export interface AccountStatus {
  loggedIn: boolean
  email: string
  /** 服务端账号的用户名（erp 注册页让用户自己填的那个；顶栏胶囊与账号卡显示用）。
   *  老 account.json 没有此字段 ⇒ 空串，由展示层回落邮箱前缀，不视为损坏。 */
  username: string
  sessionExpired: boolean
}

interface StoredAccount {
  token: string
  userId: string
  email: string
  username: string
  deviceId: string
}

const log = (deps: AccountDeps, level: 'info' | 'warn' | 'error', msg: string): void => {
  try {
    deps.log?.(level, `[account] ${msg}`)
  } catch {
    // 日志失败不影响主流程
  }
}

export class AccountService {
  private sessionExpired = false
  private heartbeatTimer: NodeJS.Timeout | null = null
  /**
   * v2.5（PLAN §3.2 r2-测试P1-4/架构P1-1/性能P1-3）：token/登录态内存缓存。
   * 修正伪前提：master account.ts 无内存缓存，status()/beat() 每次 load() 读盘+解密；
   * host.account 是同步接口且被高频调用（AI 类插件每次请求取 token），须走缓存。
   * 生命周期：login/load 读盘成功后写入；logout 清空；解密异常 → null + log 警告（不抛）。
   */
  private tokenCache: string | null = null
  private loggedInCache = false
  /** 会话代数：login/logout 递增；旧会话迟到的 beat 结果只按代数丢弃（v2.5.3 T4） */
  private sessionGen = 0
  /** 心跳单飞：在途时新 tick 直接跳过（v2.5.3 T4） */
  private beatInFlight = false
  /** 当前在途心跳的 AbortController（logout 中止用；完成后清空） */
  private currentBeatController: AbortController | null = null
  /** 设备标识内存缓存（v2.6.7 车 0）：只缓存读到的正值；logout 不清——设备身份不随登出作废 */
  private deviceIdCache: string | null = null

  constructor(private deps: AccountDeps) {}

  // —— 本地落盘 ——

  /**
   * 读本机设备标识（v2.6.7 车 0）：`deviceIdFile` → 旧 `account.json.deviceId`（读到即迁移到新文件）→ 都缺则 null。
   *
   * 为什么要单列这一口——旧实现的触发链是：`load()` 在 token 解密失败时**整体** return null，
   * 于是明文躺在盘上的 deviceId 被连带丢弃 → `getDeviceId()` 返 null、`beat()` 整轮静默不发
   * → 用户手动重登时 `login()` 走 `randomUUID()` 铸一枚新的 → 服务端 `box_devices` 多占一格
   * （3 台上限 + 30 天惰性解绑 ⇒ 很快撞满，表现为"这台设备没绑上/又提示已满 3 台"）。
   * Linux 钥匙串开机后未解锁是常态触发点，重装/换安装形态是第二个。
   * 本方法**不碰 token、不解密**，所以钥匙串状态如何都不影响设备身份；调用方自己决定缺 id 时是新建还是放弃。
   */
  private readDeviceId(): string | null {
    if (this.deviceIdCache) return this.deviceIdCache
    const fromFile = this.readDeviceIdFile(this.deps.deviceIdFile)
    if (fromFile) {
      this.deviceIdCache = fromFile
      return fromFile
    }
    // 迁移：老版本只把 deviceId 写在 account.json 里（那份文件可能已因钥匙串问题读不出来，
    // 所以这里单独只取 deviceId 一个字段，不过 token 解密闸门）
    const legacy = this.readDeviceIdFile(this.deps.accountFile)
    if (!legacy) return null
    this.writeDeviceId(legacy)
    this.deviceIdCache = legacy
    return legacy
  }

  /** 从一个 JSON 文件里取 deviceId（值须是一枚 UUID，否则视为没有）；文件缺失/损坏一律返回 null */
  private readDeviceIdFile(file: string): string | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { deviceId?: unknown }
      const id = typeof parsed.deviceId === 'string' ? parsed.deviceId.trim() : ''
      return DEVICE_ID_RE.test(id) ? id : null
    } catch {
      return null
    }
  }

  /**
   * 设备标识落盘：mkdir -p + 临时文件 rename（与 `save()` 同一套原子写法，但它是同步口——
   * `getDeviceId()` 经 host.account 暴露成同步接口，不能在此 await）。
   * 写失败只 log 并返回 false：本次会话内存里仍持有 id，不阻断登录；下次启动重新铸一枚的代价
   * 等于回到修复前的行为，比"因为写不了小文件而登不上"轻。
   */
  private writeDeviceId(id: string): boolean {
    const file = this.deps.deviceIdFile
    const tmp = `${file}.${process.pid}.tmp`
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify({ deviceId: id }))
      fs.renameSync(tmp, file)
      return true
    } catch (err) {
      log(this.deps, 'warn', `设备标识落盘失败（本次会话仍用 ${id.slice(0, 8)}…）: ${String(err)}`)
      try {
        fs.rmSync(tmp, { force: true })
      } catch {
        // 临时文件都没清掉属极端环境（目录不可写），不再追加噪音
      }
      return false
    }
  }

  /** 取现成 id，没有就铸一枚并落盘（登录路径专用——未登录过不该凭空留下这枚文件） */
  private ensureDeviceId(): string {
    const cur = this.readDeviceId()
    if (cur) return cur
    const fresh = randomUUID()
    this.writeDeviceId(fresh)
    this.deviceIdCache = fresh
    return fresh
  }

  private load(): StoredAccount | null {
    try {
      const raw = fs.readFileSync(this.deps.accountFile, 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoredAccount>
      // v2.6.7 车 0：不再把 `parsed.deviceId` 当登录态判据——设备标识另有独立持久口（见 readDeviceId），
      // 老文件里缺这个字段的用户不该因此被判定成"没登录"。
      if (!parsed.token || !parsed.userId) return null
      const token = this.deps.decrypt(parsed.token)
      if (!token) {
        // v2.5：safeStorage 解密异常 → token 不可用，按未登录处理（log 警告，不抛）
        // v2.6.7 车 0：这里作废的只有登录态；deviceId 已不经过本闸门（改由 readDeviceId 独立取）
        log(this.deps, 'warn', 'token 解密失败（safeStorage 异常？），按未登录处理')
        this.tokenCache = null
        this.loggedInCache = false
        return null
      }
      const acc: StoredAccount = {
        token,
        userId: parsed.userId,
        email: parsed.email ?? '',
        // 老 account.json 没这个字段：按空串读（缺失 ≠ 损坏），展示层会回落邮箱前缀
        username: typeof parsed.username === 'string' ? parsed.username : '',
        deviceId: this.readDeviceId() ?? '',
      }
      // v2.5：读盘成功 → 写入缓存（getToken/isLoggedIn 直接返回，不重复读盘+解密）
      this.tokenCache = token
      this.loggedInCache = true
      return acc
    } catch {
      // 文件缺失/损坏 → 同步清缓存（登录态已不存在，host.account 不得返回旧 token）
      this.tokenCache = null
      this.loggedInCache = false
      return null
    }
  }

  /**
   * 原子落盘：mkdir -p + 临时文件 rename（durable fsync）；失败返回 false（v2.5.3 T4）。
   *
   * v2.6.8 S5.1：**这份文件带的是登录令牌**（`encrypt(acc.token)` 走 safeStorage，不可用时按
   * 「没钥匙环也要能登录」的产品承诺降级 `raw:` 明文），所以落盘权限收到 0o600。
   * 默认 0o644 在同机多用户 / CI runner / 共享 NAS 挂载那些形态下等于把凭据摊给同机账号读——
   * 与 `plugins/encryption.ts:237`（插件密钥缓存）同一口径，那边已经是 0o600。
   * 存量 644 的老文件不用迁移：临时文件按新权限创建、rename 覆盖 ⇒ 下次写入自动升级，
   * 内容格式一字未改，老用户不掉登录态。
   */
  private async save(acc: StoredAccount): Promise<boolean> {
    try {
      await fsp.mkdir(path.dirname(this.deps.accountFile), { recursive: true })
      const payload: StoredAccount = { ...acc, token: this.deps.encrypt(acc.token) }
      await writeJsonAtomic(this.deps.accountFile, payload, { durable: true, mode: 0o600 })
      return true
    } catch (err) {
      log(this.deps, 'error', `落盘失败: ${String(err)}`)
      return false
    }
  }

  private async remove(): Promise<void> {
    // v2.5.3（T4）A1：不再吞错——移除失败向上抛，由 logout() 外层 try/catch 记录日志
    // （此前内部 catch 吞掉一切，logout() 的「移除失败要 log」分支永不触发，属死代码）
    // v2.6.7 车 0：这里**只**删 account.json。设备标识文件刻意不删——主动登出后重新登录
    // 应该回到"还是这台机器"，而不是在服务端设备清单里占第二格。
    await fsp.rm(this.deps.accountFile, { force: true })
  }

  // —— 登录 / 登出 / 状态 ——

  async login(
    email: string,
    password: string,
    /**
     * v2.5.9 A8：图形码答案（可选）。**本版不切服务端**——现网 `hooks_captcha.go` 对
     * `X-Qihe-Client: box` 最优先豁免，不带码照样能登（旧包不受影响）；带上是给 2.6
     * 切换 `BOX_LOGIN_CAPTCHA=required` 预留客户端位，届时这条链路无需再改。
     */
    captcha?: { id: string; value: string },
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!this.deps.baseUrl) {
      return { ok: false, error: '未配置服务器地址，登录不可用' }
    }
    const fetchImpl = this.deps.fetchImpl ?? fetch
    const controller = new AbortController()
    const timeoutMs = this.deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS
    let timer: NodeJS.Timeout | undefined
    // 超时：AbortController 通知真实 fetch 取消；race 兜底（mock 忽略 signal 时仍能判超时）
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new LoginTimeoutError())
      }, timeoutMs)
    })
    let res: Response
    try {
      res = await Promise.race([
        fetchImpl(`${this.deps.baseUrl}/collections/users/auth-with-password`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // 桌面客户端标识：服务端据此豁免图形验证码（仍受邮箱认证+登录限流保护）
            'X-Qihe-Client': 'box',
            // A8：只在用户**真的填了**码时才带头——空值头会被服务端当"提交了空码"，反而更容易被判失败；
            // 判空前先 trim（粘贴带空格是常态，别把 "  " 当有效答案）
            ...(captcha?.id?.trim() && captcha.value?.trim()
              ? { 'X-Captcha-Id': captcha.id.trim(), 'X-Captcha-Value': captcha.value.trim() }
              : {}),
          },
          body: JSON.stringify({ identity: email, password }),
          signal: controller.signal,
        }),
        timeoutPromise,
      ])
    } catch (err) {
      if (err instanceof LoginTimeoutError) {
        return { ok: false, error: '登录超时，请检查网络后重试' }
      }
      if (isAbortError(err) && controller.signal.aborted) {
        // 超时 abort 引起的 AbortError（真实 fetch）→ 与超时同文案
        return { ok: false, error: '登录超时，请检查网络后重试' }
      }
      return { ok: false, error: '网络异常，请检查网络后重试' }
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      // v2.5.1 登录增强（D3/D9）：透传服务端 message（凭据错误等如实展示），
      // 429 限流给固定文案；message 限长 200 字符防撑破布局（P2-D）。隐私边界不变。
      let serverMsg = ''
      try {
        const b = (await res.json()) as { message?: string }
        serverMsg = typeof b?.message === 'string' ? b.message.trim() : ''
      } catch {
        // 响应体非 JSON → 走兜底
      }
      if (res.status === 429) {
        return { ok: false, error: '登录过于频繁，请稍后再试' }
      }
      if (serverMsg) {
        return { ok: false, error: serverMsg.slice(0, 200) }
      }
      return { ok: false, error: '登录失败，请稍后重试' }
    }
    let body: { token?: string; record?: { id?: string; email?: string; username?: string } }
    try {
      body = await res.json()
    } catch {
      return { ok: false, error: '登录响应异常，请稍后重试' }
    }
    const token = body?.token
    const userId = body?.record?.id
    if (!token || !userId) {
      return { ok: false, error: '登录响应异常，请稍后重试' }
    }
    // v2.6.7 车 0：`existing?.deviceId ?? randomUUID()` 是"重启/重装之后设备码掉了绑定"的第二半根因——
    // 旧写法依赖 load() 成功，而钥匙串未解锁时 load() 必失败，于是每次这样重登就铸一枚新 UUID、
    // 服务端多占一格。现在 id 与登录态无关：有就沿用，确实没有才铸。
    const deviceId = this.ensureDeviceId()
    // 只有落盘成功才写缓存、启动心跳并返回成功（v2.5.3 T4）
    // v2.6.8 重发：username 随登录响应一起落盘——顶栏胶囊与账号卡显示它（缺失服从展示层回落）
    const saved = await this.save({ token, userId, email: body.record?.email ?? email, username: body.record?.username ?? '', deviceId })
    if (!saved) {
      return { ok: false, error: '登录状态保存失败，请重试' }
    }
    this.sessionExpired = false
    this.sessionGen += 1 // 新会话代数：旧心跳迟到结果一律丢弃
    // v2.5：登录成功写入 token 缓存（host.account 同步读取）
    this.tokenCache = token
    this.loggedInCache = true
    log(this.deps, 'info', `登录成功 user=${userId}`)
    // 登录即启动心跳（统计活跃），并立即上报一次
    this.startHeartbeat()
    void this.beat(this.sessionGen)
    return { ok: true }
  }

  // —— v2.5.9 A8：图形码 / 注册 / 邮箱认证（纯加法，不动登录既有语义）——

  /** 一次账号类网络调用的通用外壳：超时 + JSON 解析 +「状态码/服务端 message → 人话」映射 */
  private async accountCall<T>(
    call: AccountApiCall,
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown },
    timeoutMs: number,
  ): Promise<{ ok: true; data: T } | { ok: false; error: string; rawMessage: string }> {
    if (!this.deps.baseUrl) {
      return { ok: false, error: '未配置服务器地址，该功能暂不可用', rawMessage: '' }
    }
    const fetchImpl = this.deps.fetchImpl ?? fetch
    const controller = new AbortController()
    let timer: NodeJS.Timeout | undefined
    try {
      const res = await Promise.race([
        fetchImpl(`${this.deps.baseUrl}${path}`, {
          method: init.method,
          ...(init.body === undefined
            ? { headers: { 'X-Qihe-Client': 'box' } }
            : {
                headers: { 'Content-Type': 'application/json', 'X-Qihe-Client': 'box' },
                body: JSON.stringify(init.body),
              }),
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort()
            reject(new LoginTimeoutError())
          }, timeoutMs)
        }),
      ])
      let message = ''
      let data: T | null = null
      try {
        const parsed = (await res.json()) as T & { message?: string }
        data = parsed
        message = typeof parsed?.message === 'string' ? parsed.message : ''
      } catch {
        // 非 JSON 响应体（网关 HTML 错误页等）→ 走兜底文案
      }
      // rawMessage = 服务端原话：调用方要按它判"用户名冲突"这类细节，
      // 拿映射后的中文文案去判等于自己把自己的输入改掉再比对（第一版就栽在这儿）
      if (!res.ok) return { ok: false, error: mapAccountApiError(call, res.status, message), rawMessage: message }
      if (data === null) return { ok: false, error: mapAccountApiError(call, res.status, ''), rawMessage: '' }
      return { ok: true, data }
    } catch (err) {
      if (err instanceof LoginTimeoutError) return { ok: false, error: '网络超时，请稍后重试', rawMessage: '' }
      return { ok: false, error: '网络异常，请检查网络后重试', rawMessage: '' }
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 取一张图形码（`GET {base}/captcha`，不带 query = 登录桶）。
   * 隐私口径：**不落盘、不进日志**——
   * 所以本方法一条 log 都不写（图码属凭据类内容，进日志等于多开一份泄漏面）。
   */
  async fetchCaptcha(): Promise<({ ok: true } & CaptchaChallenge) | { ok: false; error: string }> {
    const timeoutMs = this.deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS
    const r = await this.accountCall<{ captcha_id?: string; image?: string }>('captcha', '/captcha', { method: 'GET' }, timeoutMs)
    if (!r.ok) return { ok: false, error: r.error }
    const id = r.data?.captcha_id
    const image = r.data?.image
    if (!id || !image) return { ok: false, error: mapAccountApiError('captcha', 200, '') }
    return { ok: true, captchaId: id, image }
  }

  /**
   * 注册账号（**不发验证邮件**，那步留给 `requestEmailCode`——分开是因为"没收到、重发"要能单独调）。
   * username = 邮箱前缀；服务端报占用时**自动加随机后缀重试一次**：用户只填了邮箱，
   * 不该为一个他看不见的字段被打回。
   */
  async register(email: string, password: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
    const e = email.trim()
    if (!looksLikeEmail(e)) return { ok: false, error: '邮箱格式不正确' }
    if (password.length < MIN_PASSWORD_LEN) return { ok: false, error: `密码至少 ${MIN_PASSWORD_LEN} 位` }
    const timeoutMs = this.deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS
    const bodyFor = (username: string) => ({ email: e, username, password, passwordConfirm: password })
    const first = await this.accountCall<unknown>('register', '/collections/users/records', { method: 'POST', body: bodyFor(usernameFromEmail(e)) }, timeoutMs)
    if (first.ok) return { ok: true, email: e }
    // 只对"用户名冲突"重试——其它失败重试没有意义（同样的请求再发一遍而已）
    if (!isUsernameConflict(first.rawMessage)) return { ok: false, error: first.error }
    const retry = await this.accountCall<unknown>('register', '/collections/users/records', { method: 'POST', body: bodyFor(withRandomSuffix(usernameFromEmail(e))) }, timeoutMs)
    return retry.ok ? { ok: true, email: e } : { ok: false, error: retry.error }
  }

  /** 请服务端发 6 位邮箱验证码（5 分钟有效）。注册成功后与「没收到、重发」都走这里。 */
  async requestEmailCode(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const e = email.trim()
    if (!looksLikeEmail(e)) return { ok: false, error: '邮箱格式不正确' }
    const timeoutMs = this.deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS
    const r = await this.accountCall<unknown>('email-request', '/auth/email-verification/request', { method: 'POST', body: { email: e } }, timeoutMs)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }

  /** 提交邮箱验证码；通过后**不自动登录**（登录要密码，由渲染层用手里那份密码接着调 login） */
  async confirmEmailCode(email: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const e = email.trim()
    const c = code.trim()
    if (!/^[0-9]{6}$/.test(c)) return { ok: false, error: '请输入 6 位数字验证码' }
    const timeoutMs = this.deps.loginTimeoutMs ?? LOGIN_TIMEOUT_MS
    const r = await this.accountCall<unknown>('email-confirm', '/auth/email-verification/confirm', { method: 'POST', body: { email: e, code: c } }, timeoutMs)
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }

  async logout(): Promise<void> {
    this.stopHeartbeat()
    this.sessionGen += 1 // 登出即换代：在途心跳结果作废
    this.currentBeatController?.abort()
    this.currentBeatController = null
    try {
      await this.remove()
    } catch (err) {
      // 移除失败记录日志，但不阻塞内存登出（v2.5.3 T4）
      log(this.deps, 'error', `移除账号文件失败: ${String(err)}`)
    }
    this.sessionExpired = false
    // v2.5：登出清空 token 缓存
    this.tokenCache = null
    this.loggedInCache = false
  }

  /** v2.5（PLAN §3.2）：同步返回 token 内存缓存（登录态读盘时写入；未登录 → null） */
  getToken(): string | null {
    return this.tokenCache
  }

  /** v2.5（PLAN §3.2）：同步返回登录态缓存 */
  isLoggedIn(): boolean {
    return this.loggedInCache
  }

  /** v2.6（批 1 · 设备绑定 ③ 客户端半边）：同步返回本机设备标识——与心跳 `device_id` **同源**
   *  （v2.6.7 车 0 起：同源＝同一枚独立落盘的 UUID，见 `readDeviceId`；不再经登录态闸门，
   *  所以钥匙串没解锁时插件与心跳拿到的仍是**同一枚** id）；两份来源都读不到 → null。
   *  用途：插件经 `host.account.getDeviceId()` 取值，向 erp `/api/box/me` 传 `current_device_id`，
   *  服务端据此在设备清单里标出「本机」（`is_current`）。**不得自造 id**（自造即另一台设备）。 */
  getDeviceId(): string | null {
    return this.readDeviceId()
  }

  status(): AccountStatus {
    const acc = this.load()
    if (!acc) {
      return { loggedIn: false, email: '', username: '', sessionExpired: false }
    }
    return { loggedIn: true, email: acc.email, username: acc.username, sessionExpired: this.sessionExpired }
  }

  // —— 心跳（活跃统计，失败静默）——

  /**
   * 心跳上报（v2.5.3 T4 加固）：
   * - 单飞：在途时新 tick 直接跳过，不并发重复上报；
   * - 代数隔离：login/logout 递增 sessionGen，旧会话迟到结果不写入状态；
   * - 超时：heartbeatTimeoutMs 上限，AbortController + race 兜底；结束后清 controller。
   */
  async beat(gen?: number): Promise<void> {
    if (this.beatInFlight) return
    const acc = this.load()
    if (!acc || !this.deps.baseUrl) return
    // v2.6.7 车 0：deviceId 两处来源都拿不到（文件被手工删过/内容不合法）时**不发**空 device_id——
    // erp `box.go` 那边也拒空值，白跑一趟；留给下一次 login() 重新铸一枚并落盘
    if (!acc.deviceId) {
      log(this.deps, 'warn', '心跳跳过：本机设备标识不可读（device-id 文件缺失或不合法）')
      return
    }
    this.beatInFlight = true
    const controller = new AbortController()
    this.currentBeatController = controller
    const fetchImpl = this.deps.fetchImpl ?? fetch
    const timeoutMs = this.deps.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS
    let timer: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error('heartbeat timeout'))
      }, timeoutMs)
    })
    try {
      try {
        const res = await Promise.race([
          fetchImpl(`${this.deps.baseUrl}/box/heartbeat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${acc.token}` },
            body: JSON.stringify({
              device_id: acc.deviceId,
              platform: process.platform + (process.arch ? `-${process.arch}` : ''),
              version: this.deps.version(),
            }),
            signal: controller.signal,
          }),
          timeoutPromise,
        ])
        if (gen !== undefined && gen !== this.sessionGen) return // 旧会话迟到结果丢弃
        if (res.status === 401) {
          if (!this.sessionExpired) {
            this.sessionExpired = true
            // v2.5.3（P1-6）：会话过期 → 广播到渲染层（Profile 过期横幅即时刷新）；
            // 只在新置位时广播，避免每小时心跳对同一过期态重复推送
            this.deps.onSessionExpired?.(this.status())
          }
          log(this.deps, 'warn', '心跳 401，会话已失效')
        }
      } catch {
        if (gen !== undefined && gen !== this.sessionGen) return
        if (controller.signal.aborted) {
          if (this.currentBeatController === controller) {
            // 超时 abort（本 beat 自己的 controller 仍在职、未被清空）→ 心跳超时
            log(this.deps, 'warn', '心跳超时，已取消')
          } else {
            // controller 已被 logout 清空/被新 beat 替换 → abort 来自登出中止，
            // 不作「心跳超时」误报（v2.5.3 T4 C2）
            log(this.deps, 'info', '心跳被中止（登出）')
          }
        }
        // 其他网络异常静默（不影响使用）
      }
    } finally {
      clearTimeout(timer)
      if (this.currentBeatController === controller) this.currentBeatController = null
      this.beatInFlight = false
    }
  }

  startHeartbeat(): void {
    if (this.heartbeatTimer) return
    // v2.4.7（评审 P5）：.unref()——心跳定时器不阻止进程退出（与每日任务一致；托盘常驻本身已保活）
    this.heartbeatTimer = setInterval(() => void this.beat(this.sessionGen), HEARTBEAT_INTERVAL_MS)
    this.heartbeatTimer.unref()
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /**
   * 启动后恢复心跳（v2.6.7 车 0-c），返回最终是否恢复到已登录态。
   *
   * 存在的理由：Linux 钥匙串常在 app ready **之后**才解锁，此刻 account.json 里的 token 解不开 ⇒
   * `status().loggedIn` 为 false。旧实现在装配层是一次性 `if (loggedIn) startHeartbeat()`，
   * 判死之后再没有第二次机会，用户观感就是"重启电脑之后掉登录、设备也没绑上"。
   * 车 0-a/0-b 先保证这种时刻**不再铸新 deviceId**（不在服务端多占一格），本方法补的是另一半：
   * 解锁之后把心跳接回来，并广播一次状态变更让插件侧使用锁即时恢复。
   *
   * 第一条分支（启动时就已登录）与 v2.4.7 的既有行为逐字等价——只 startHeartbeat，不多发一跳心跳，
   * 免得把 PRIVACY.md 承诺的"每 1 小时"改成"每次启动多一发"。
   */
  async restoreHeartbeat(
    delaysMs: number[] = LOGIN_RESTORE_DELAYS_MS,
    onRestored?: () => void,
  ): Promise<boolean> {
    if (this.status().loggedIn) {
      this.startHeartbeat()
      return true
    }
    for (const delay of delaysMs) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, delay)
        // 与心跳定时器同一纪律（v2.4.7 评审 P5）：退避等待不阻止进程退出
        t.unref()
      })
      if (!this.status().loggedIn) continue
      this.startHeartbeat()
      // 迟到的这一次补一发心跳：本机在服务端设备清单里要回到"活跃"，顺带判出 sessionExpired
      void this.beat(this.sessionGen)
      onRestored?.()
      return true
    }
    return false
  }
}
