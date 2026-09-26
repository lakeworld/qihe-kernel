/**
 * 宿主对外出口静态门禁（networkEgress，2026-09-27）
 *
 * 为什么存在：README / PRIVACY.md 对用户承诺「文件内容永不出机器、软件唯一对外目的地只有
 * www.qihebook.cloud」。而本仓**刻意不做运行期拦截**（没有 webRequest 阻断器、没有
 * setPermissionRequestHandler）⇒ 这句公开承诺目前只由这份静态门禁把关：它是「一次随手改动」与
 * 「一句虚假的隐私声明」之间唯一的机器判据。红在改动发生的那一侧，而不是等用户发现。
 *
 * 四条断言（判据全部来自真实源码扫描，不采信任何文档口径）：
 *   1. **主机白名单**：`src/**\/*.{ts,tsx}` 里每个 `http(s)://host` 字面量的主机集合
 *      ⊆ 基线 `allowedHosts`（那句承诺本身）∪ `benignHosts`（惰性字面量：XML 命名空间等）
 *      ∪ 门禁内置的不可路由地址（localhost / 127.0.0.1 / *.test / RFC 2606 保留域）。
 *      命中注释里的 URL 也算命中（公开仓里的域名同样要被人看过），但会标注「注释内」便于分流。
 *   2. **域名字面量的文件级棘轮**：硬编码 `www.qihebook.cloud` 只准出现在基线登记的那几个文件里。
 *      其余模块一律经注入的 baseUrl（`build/server.json` → 装配层 → `cloudBaseUrl`）到达该域，
 *      所以它们不该含字面量；第三个文件直接写死域名 = 红（"集中出口"这个说法从此由机器把关）。
 *   3. **出口点位清单**：`src/main/**` 里网络出口形状（`fetch(` / `fetchImpl(` / `net.fetch(` /
 *      `net.request(` / XHR / WebSocket）逐条 `路径:行 | 类别` 与基线**完全一致**（增、删都红）。
 *      口径选择（实测后定的，不是照抄需求文案）：本仓取依赖注入写法，真出口是 `fetchImpl(` 而不是
 *      字面 `fetch(`，所以两条都收；`new URL(` 在 src/main 里只有个位数（多为本地路径拼接），
 *      不足以撑爆基线，就仍按逐条清单钉死、但**单列一段**不混进入口清单；再补一段「取用全局 fetch
 *      绑定」的引用点（`?? fetch` / `= fetch`）——换个别名再发请求是绕过出口清单的正路，那条缝也钉住。
 *   4. **零文件上传原语**：`src/main/**` 里 multipart / FormData / putObject / presign /
 *      appendChild / XMLHttpRequest.upload / upload 词元必须为 0 —— 这是「宿主不做文件上传」
 *      的代码级后盾。**本条不因扫描结果被削弱**：真的出现合法命中时报出来交人裁决，不降标准。
 *
 * 子集模式（同一份测试文件被导出到公开内核仓 lakeworld/qihe-kernel，那里只能少不能多）：
 *   仓根存在 `scripts/export-kernel.mjs` 写出的 `.kernel-provenance.json`（导出账本）⇒ 判为内核树。
 *   断言 1 / 2 / 4 语义不变（内核树扫出的主机/字面量文件更少，白名单照样成立）；
 *   断言 3 改判「内核点位 ⊆ 基线点位」（公开子集本就文件更少）。子集模式下**拒绝**重生成基线：
 *   基线由私有仓独占写入，否则一次在公开仓里的重生成就会把私有仓的出口点位静默抹掉。
 *
 * 重生成口径与本仓其它基线门禁一致（`UIINV_UPDATE` / `WIN_UPDATE` / `API_UPDATE`）：
 *   NETWORK_EGRESS_UPDATE=1 npx vitest run tests/unit/networkEgress.test.ts
 *   （等价别名 UPDATE_NETWORK_EGRESS=1 也可，两处文案与脚本按这一对来写。）
 *   Windows PowerShell 下内联 `VAR=1 cmd` 不生效，要写 `$env:NETWORK_EGRESS_UPDATE='1'`。
 *   逃生闸与 winBranchInventory 同构：门禁**不会**替谁登记新主机——UPDATE 只重算清单段，
 *   遇到未登记主机直接拒绝写回；确属新增对外出口才用 NETWORK_EGRESS_BREAK=1
 *   NETWORK_EGRESS_BREAK_REASON=<成因>（成因入基线 `_breakReason`，且必须同笔改公开文案）。
 *
 * 已知边界（诚实记账，别把它当成运行期防护）：
 *   - 只扫 `.ts/.tsx`：`src` 下各层的 `.md`、`src/renderer/src/logo.svg`、`build/server.json` 里的 URL
 *     不是被执行的网络出口，不进判据（域名的第三个载体是 `build/server.json`，换服务器地址要连它一起改）。
 *   - 字符串拼接出来的主机（`'https://' + host`）不落在断言 1 的"带主机的字面量"上，
 *     由断言 1 的「有协议无主机」子判据兜住：协议前缀写了而主机不在同一字面量里 = 一律红。
 *   - 注释剥离用的是状态机（含模板串 `${}` 嵌套），正则字面量里的引号理论上能骗过它；
 *     防的是"扫描器坏掉导致空清单假绿"，所以有第 5 条自检断言钉住最低命中数。
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC_DIR = path.join(ROOT, 'src')
const MAIN_DIR = path.join(ROOT, 'src', 'main')
const BASELINE_PATH = path.join(ROOT, 'tests', 'unit', '__baselines__', 'network-egress.json')

/** 唯一对外目的地（PRIVACY.md 的口径）。它出现在哪几个文件里由基线棘轮，而不是由本行假设。 */
const DOMAIN_LITERAL = 'www.qihebook.cloud'
const POLICY_SEED_HOSTS = [DOMAIN_LITERAL]

const REGEN = process.env.UPDATE_NETWORK_EGRESS === '1' || process.env.NETWORK_EGRESS_UPDATE === '1'
const BREAK = process.env.NETWORK_EGRESS_BREAK === '1'
const BREAK_REASON = process.env.NETWORK_EGRESS_BREAK_REASON || ''

/** 网络出口形状的调用点（断言 3 主清单）：真发请求的语句长这样。 */
const EXIT_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: 'net.fetch', re: /\bnet\.fetch\s*\(/g },
  { kind: 'net.request', re: /\bnet\.request\s*\(|\bnew\s+net\.Request\s*\(/g },
  { kind: 'fetch', re: /(?<![.\w$])fetch\s*\(/g },
  { kind: 'fetchImpl', re: /\bfetchImpl\s*\(/g },
  { kind: 'xhr', re: /\bXMLHttpRequest\b/g },
  { kind: 'websocket', re: /new\s+(?:globalThis\.)?WebSocket\b/g },
]
/** `new URL(` 单独一段：绝大多数是本地路径拼接与 URL 解析，不是出口，钉成清单只为「有人新增了构造点」可见。 */
const URL_PATTERN = { kind: 'newURL', re: /new\s+URL\s*\(/g }
/** 取用全局 fetch 绑定的引用点（`?? fetch` / `= fetch`）：绕过出口清单的路子从这里过。 */
const FETCH_REF_PATTERN = { kind: 'fetch-ref', re: /(?<![.\w$])fetch(?![.\w$(])/g }

/** 文件上传原语词表（断言 4）：出现即为「宿主不做文件上传」这句话的反例。全部大小写不敏感。 */
const UPLOAD_VOCAB: { name: string; re: RegExp }[] = [
  { name: 'multipart', re: /multipart/gi },
  { name: 'FormData', re: /\bFormData\b|form-data/gi },
  { name: 'putObject', re: /\bputObject\b|put_object/gi },
  { name: 'presigned', re: /presign/gi },
  { name: 's3', re: /\bS3Client\b|\bs3:\/\/|aws-sdk/gi },
  { name: 'appendChild', re: /appendChild/gi },
  { name: 'upload', re: /\bupload\w*\b|\.upload\b/gi },
]

/** matchAll 要求 g 档；统一从这里拿，省得某条正则漏写 g 就静默少扫一类 */
function globalOf(re: RegExp): RegExp {
  return new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
}

/** 不可路由 / 保留地址：结构上不可能是对外出口，写死在门禁里，省得每个测试夹具都来改基线。 */
const BUILTIN_BENIGN_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'example.com',
  'example.net',
  'example.org',
  'www.example.com',
])
const BUILTIN_BENIGN_SUFFIXES = ['.test', '.invalid', '.local']

interface EgressBaseline {
  _readme?: string[]
  _regen?: string
  _breakReason?: string
  schema?: number
  /** 生成时所在仓的形态：公开内核仓的导出账本存在 ⇒ 'subset'（该值必须来自私有仓，故恒为 'full'） */
  _generatedIn?: string
  allowedHosts?: string[]
  benignHosts?: Record<string, string>
  observedHosts?: string[]
  literalDomainFiles?: Record<string, number>
  inventory?: { networkExits?: string[]; urlConstructions?: string[]; fetchBindings?: string[] }
  uploadPrimitives?: { policy?: string; patterns?: string[]; hits?: string[] }
  stats?: Record<string, number>
}

const rel = (p: string): string => path.relative(ROOT, p).split(path.sep).join('/')

/** 递归列出 .ts/.tsx（排除构建产物目录），返回仓根相对路径 */
function listSourceFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (['node_modules', 'out', 'dist', 'release', '.git'].includes(ent.name)) continue
      listSourceFiles(path.join(dir, ent.name), out)
    } else if (/\.tsx?$/.test(ent.name)) {
      out.push(path.join(dir, ent.name))
    }
  }
  return out.sort((a, b) => rel(a).localeCompare(rel(b)))
}

/**
 * 把注释字符替换成空格（长度与换行位置不变，便于用下标反查行号并区分「注释内 / 代码里」）。
 * 覆盖：行注释、块注释、单双引号串、模板串（`${}` 可嵌套、可跨行）。模板文本段内的 `//` 是普通字符
 * （`https://…` 就常写成模板串），所以那里不开注释态；单双引号串遇到换行即收尾，把误判半径限在一行内。
 * 已知不精确处：正则字面量与 JSX 文本里的引号 / `//` 可能被当成开串或开注释——后果只是"同一行的
 * 后半段不算代码"，不会放行新主机（断言 1 扫的是原文，掩码只用来标注"注释内"）。
 */
function maskComments(text: string): string {
  const chars = text.split('')
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < chars.length; k++) if (chars[k] !== '\n') chars[k] = ' '
  }
  /** 帧：tpl = 反引号模板的文本段；expr = 模板里 `${...}` 的代码段（brace 记嵌套层数） */
  type Frame = { kind: 'tpl' } | { kind: 'expr'; brace: number }
  const stack: Frame[] = []
  let i = 0
  let state: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code'
  let start = 0
  const esc = (back: number) => {
    let slashes = 0
    for (let k = back - 1; k >= 0 && text[k] === '\\'; k--) slashes++
    return slashes % 2 === 1
  }
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (state === 'line') {
      if (c === '\n') {
        blank(start, i)
        state = 'code'
      }
      i++
      continue
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        blank(start, i + 2)
        state = 'code'
        i += 2
        continue
      }
      i++
      continue
    }
    if (state === 'sq' || state === 'dq') {
      // 串内不判注释、也不抹掉内容（串里的 URL 正是要判的东西）；遇到换行即收尾，误判半径限在一行内
      const closes = (c === `'` && state === 'sq') || (c === `"` && state === 'dq')
      if ((closes && !esc(i)) || c === '\n') state = 'code'
      i++
      continue
    }
    if (state === 'tpl') {
      // 模板文本段里没有注释、也没有嵌套字符串：`//` 与 `/*` 都是普通字符（`https://…` 常出现在这里）
      if (c === '`' && !esc(i)) {
        stack.pop()
        state = 'code'
        i++
        continue
      }
      if (c === '$' && next === '{' && !esc(i)) {
        stack.push({ kind: 'expr', brace: 1 })
        state = 'code'
        i += 2
        continue
      }
      i++
      continue
    }
    // state === 'code'
    if (c === '/' && next === '/') {
      start = i
      state = 'line'
      i += 2
      continue
    }
    if (c === '/' && next === '*') {
      start = i
      state = 'block'
      i += 2
      continue
    }
    if (c === '`') {
      stack.push({ kind: 'tpl' })
      state = 'tpl'
      i++
      continue
    }
    if (c === '{') {
      const top = stack[stack.length - 1]
      if (top && top.kind === 'expr') top.brace++
      i++
      continue
    }
    if (c === '}') {
      const top = stack[stack.length - 1]
      if (top && top.kind === 'expr') {
        top.brace--
        if (top.brace === 0) {
          stack.pop()
          state = 'tpl'
        }
      }
      i++
      continue
    }
    if (c === `'` || c === `"`) {
      start = i
      state = c === `'` ? 'sq' : 'dq'
      i++
      continue
    }
    i++
  }
  if (state === 'line' || state === 'block') blank(start, text.length)
  return chars.join('')
}

/** 行号（1 基）：下标 → 该行起始之前有多少换行 */
function lineAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++
  return line
}

const URL_RE = /\b(?:https?|ftp|wss?):\/\/([^\s'"`\\<>(){}[\];,/?:#&=+]*)/gi
/** 主机名形状：点分域 / IPv4（IPv6 字面量与 `${expr}` 都进不了这个形状 ⇒ 记为动态主机） */
const HOST_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?$/

interface UrlHit {
  file: string
  line: number
  host: string
  /** 协议写了、主机不在同一处字面量里（`'https://' + host`、`` `https://${h}/x` ``）：白名单管不到它 */
  dynamic: boolean
  inComment: boolean
}

/** 一个文件里的全部 URL 字面量命中（注释内的也收，另行标注） */
function urlHits(abs: string, raw: string): UrlHit[] {
  const masked = maskComments(raw)
  const hits: UrlHit[] = []
  for (const m of raw.matchAll(URL_RE)) {
    const idx = m.index ?? 0
    const inComment = masked[idx] === ' ' || masked[idx] === '\n' || masked[idx] === '\t'
    const at = (host: string): UrlHit => ({
      file: rel(abs),
      line: lineAt(raw, idx),
      host,
      dynamic: false,
      inComment,
    })
    const dyn = (): UrlHit => ({
      file: rel(abs),
      line: lineAt(raw, idx),
      host: '',
      dynamic: true,
      inComment,
    })
    const authority = m[1] ?? ''
    if (!authority) {
      hits.push(dyn())
      continue
    }
    if (authority.includes('$')) {
      hits.push(dyn()) // 模板插值出来的主机
      continue
    }
    // 去 userinfo（user@host）、去端口（host:port）、去尾部标点
    const cut = authority.lastIndexOf('@')
    let host = (cut >= 0 ? authority.slice(cut + 1) : authority).replace(/:\d+$/, '').replace(/[.!?,"']+$/, '')
    host = host.toLowerCase()
    if (!HOST_RE.test(host)) {
      hits.push(dyn()) // 主机形状不对（IPv6 字面量、以 -/_ 结尾等）：一律当动态主机交人看
      continue
    }
    hits.push(at(host))
  }
  return hits
}

/** 一段源码文本 → `路径:行 | 类别` 清单条目（纯函数，供自检用夹具文本直接喂） */
function sitesOfText(
  relPath: string,
  raw: string,
  patterns: { kind: string; re: RegExp }[],
): string[] {
  const out: string[] = []
  const code = maskComments(raw)
  for (const { kind, re } of patterns) {
    for (const m of code.matchAll(globalOf(re))) {
      const idx = m.index ?? 0
      if (kind === 'fetch-ref') {
        // `typeof fetch`（类型标注）与注释都不算取用绑定；只看真把它当值用的位置
        const before = code.slice(Math.max(0, idx - 12), idx)
        if (/\btypeof\s+$/.test(before)) continue
      }
      out.push(`${relPath}:${lineAt(code, idx)} | ${kind}`)
    }
  }
  return out
}

/** 匹配点 → `路径:行 | 类别` 清单条目 */
function patternSites(files: string[], patterns: { kind: string; re: RegExp }[]): string[] {
  const out: string[] = []
  for (const abs of files) out.push(...sitesOfText(rel(abs), fs.readFileSync(abs, 'utf8'), patterns))
  return sortSites(out)
}

/** 清单排序：路径字典序 → 行号数值序 → 类别（保证基线可读且 diff 稳定） */
function sortSites(entries: string[]): string[] {
  const split = (e: string) => {
    const [loc, kind] = e.split(' | ')
    const i = loc.lastIndexOf(':')
    return { file: loc.slice(0, i), line: Number(loc.slice(i + 1)), kind: kind ?? '' }
  }
  return [...new Set(entries)].sort((a, b) => {
    const x = split(a)
    const y = split(b)
    return x.file.localeCompare(y.file) || x.line - y.line || x.kind.localeCompare(y.kind)
  })
}

interface Reading {
  hosts: { host: string; entries: string[] }[]
  dynamicHosts: string[]
  literalDomainFiles: Record<string, number>
  networkExits: string[]
  urlConstructions: string[]
  fetchBindings: string[]
  uploadHits: string[]
  scannedTsFiles: number
  scannedMainFiles: number
}

/** 全树读数：一次扫完，四条断言共用（同一判据不写第二套扫描器） */
function readTree(): Reading {
  const tsFiles = listSourceFiles(SRC_DIR)
  const mainFiles = tsFiles.filter((f) => f.startsWith(MAIN_DIR + path.sep))

  const hostMap = new Map<string, string[]>()
  const dynamicHosts: string[] = []
  for (const abs of tsFiles) {
    for (const h of urlHits(abs, fs.readFileSync(abs, 'utf8'))) {
      if (h.dynamic) {
        dynamicHosts.push(`${h.file}:${h.line}${h.inComment ? ' | 注释内' : ''}`)
        continue
      }
      const arr = hostMap.get(h.host) ?? []
      arr.push(`${h.file}:${h.line}${h.inComment ? ' | 注释内' : ''}`)
      hostMap.set(h.host, arr)
    }
  }

  const literalDomainFiles: Record<string, number> = {}
  for (const abs of tsFiles) {
    const n = fs.readFileSync(abs, 'utf8').split(DOMAIN_LITERAL).length - 1
    if (n > 0) literalDomainFiles[rel(abs)] = n
  }

  return {
    hosts: [...hostMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([host, entries]) => ({ host, entries: sortSites(entries) })),
    dynamicHosts: sortSites(dynamicHosts),
    literalDomainFiles,
    networkExits: patternSites(mainFiles, EXIT_PATTERNS),
    urlConstructions: patternSites(mainFiles, [URL_PATTERN]),
    fetchBindings: patternSites(mainFiles, [FETCH_REF_PATTERN]),
    uploadHits: uploadPrimitiveHits(mainFiles),
    scannedTsFiles: tsFiles.length,
    scannedMainFiles: mainFiles.length,
  }
}

/** 断言 4 的扫描：src/main/** 代码（去注释）里的上传原语词元 */
function uploadPrimitiveHits(mainFiles: string[]): string[] {
  const out: string[] = []
  for (const abs of mainFiles) {
    const raw = fs.readFileSync(abs, 'utf8')
    const code = maskComments(raw)
    for (const { name, re } of UPLOAD_VOCAB) {
      for (const m of code.matchAll(globalOf(re))) {
        out.push(`${rel(abs)}:${lineAt(code, m.index ?? 0)} | ${name}`)
      }
    }
  }
  return sortSites(out)
}

/* ---------------- 子集模式判定（公开内核仓） ---------------- */

const PROVENANCE = '.kernel-provenance.json'

/**
 * 内核树判据：仓根有 export-kernel.mjs 写出的导出账本。
 * 认账本不认文件名——字段口径随导出脚本演进（现为 sourceRepo / upstream / manifest / files，
 * 早先版本叫 publicRepo），所以只要求"像一份导出账本"，缺一律按私有整仓判（宁严勿松：
 * 误判成整仓会把公开子集少文件当成红，方向是暴露而不是放行）。
 */
function detectMode(): { subset: boolean; why: string } {
  const p = path.join(ROOT, PROVENANCE)
  if (!fs.existsSync(p)) return { subset: false, why: `无 ${PROVENANCE} ⇒ 私有整仓，断言 3 走完全一致` }
  const ledgerKeys = ['files', 'sourceRepo', 'sourceCommit', 'upstream', 'publicRepo', 'manifest', 'tool']
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8')) as Record<string, unknown>
    const looksLedger = !!j && typeof j === 'object' && ledgerKeys.some((k) => k in j)
    if (looksLedger) return { subset: true, why: `检出 ${PROVENANCE} ⇒ 公开内核子集，断言 3 改判子集` }
    return { subset: false, why: `${PROVENANCE} 存在但不像导出账本（无 ${ledgerKeys.slice(0, 4).join(' / ')} 等字段），按整仓判` }
  } catch {
    return { subset: false, why: `${PROVENANCE} 解析失败，按整仓判（导出脚本会先红，不会两全）` }
  }
}

/* ---------------- 基线读写 ---------------- */

function readBaseline(): EgressBaseline | null {
  if (!fs.existsSync(BASELINE_PATH)) return null
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')) as EgressBaseline
}

function serialize(b: EgressBaseline): string {
  const ordered: EgressBaseline = {
    _readme: b._readme,
    _regen: b._regen,
    _breakReason: b._breakReason,
    schema: b.schema,
    _generatedIn: b._generatedIn,
    allowedHosts: b.allowedHosts,
    benignHosts: b.benignHosts,
    observedHosts: b.observedHosts,
    literalDomainFiles: b.literalDomainFiles,
    inventory: b.inventory,
    uploadPrimitives: b.uploadPrimitives,
    stats: b.stats,
  }
  const trimmed = JSON.parse(JSON.stringify(ordered)) as EgressBaseline
  return JSON.stringify(trimmed, null, 2) + '\n'
}

function policySeeds(): { allowed: string[]; benign: Record<string, string> } {
  return {
    allowed: [...POLICY_SEED_HOSTS],
    benign: {
      'www.w3.org': 'SVG/MathML 命名空间字面量（xmlns="http://www.w3.org/2000/svg"），浏览器不回取',
    },
  }
}

/** 只有清单段随实扫刷新；policy 段（allowedHosts / benignHosts）恒为人工权威，逃不出这里。 */
function regenerate(prev: EgressBaseline | null, r: Reading, unknownHosts: string[]): EgressBaseline {
  const seed = policySeeds()
  const allowed = new Set([...(prev?.allowedHosts ?? seed.allowed), ...(BREAK ? unknownHosts : [])])
  const benign = { ...(prev?.benignHosts ?? seed.benign) }
  return {
    _readme:
      prev?._readme ??
      [
        '宿主对外出口门禁的基线（tests/unit/networkEgress.test.ts 读取；同一份文件随白名单导出到公开内核仓 lakeworld/qihe-kernel）。',
        'allowedHosts / benignHosts 是人工权威：重生成只会刷新清单段，遇到未登记主机直接拒绝写回。',
        '新增对外出口 = 先改 PRIVACY.md / README 的「唯一目的地」口径并由用户拍板，再 BREAK 登记；顺序反过来说明在想绕门禁。',
      ],
    _regen: prev?._regen ?? 'NETWORK_EGRESS_UPDATE=1（别名 UPDATE_NETWORK_EGRESS=1）npx vitest run tests/unit/networkEgress.test.ts',
    _breakReason: BREAK ? BREAK_REASON || '（未填写）' : prev?._breakReason,
    schema: 1,
    _generatedIn: 'full',
    allowedHosts: [...allowed].sort(),
    benignHosts: Object.fromEntries(Object.entries(benign).sort((a, b) => a[0].localeCompare(b[0]))),
    observedHosts: r.hosts.map((h) => h.host),
    literalDomainFiles: Object.fromEntries(
      Object.entries(r.literalDomainFiles).sort((a, b) => a[0].localeCompare(b[0])),
    ),
    inventory: {
      networkExits: r.networkExits,
      urlConstructions: r.urlConstructions,
      fetchBindings: r.fetchBindings,
    },
    uploadPrimitives: { policy: 'zero', patterns: UPLOAD_VOCAB.map((v) => v.name), hits: r.uploadHits },
    stats: {
      scannedTsFiles: r.scannedTsFiles,
      scannedMainFiles: r.scannedMainFiles,
      hosts: r.hosts.length,
      networkExits: r.networkExits.length,
      urlConstructions: r.urlConstructions.length,
      fetchBindings: r.fetchBindings.length,
      uploadHits: r.uploadHits.length,
    },
  }
}

/* ---------------- 断言辅助 ---------------- */

function isBuiltinBenign(host: string): boolean {
  if (BUILTIN_BENIGN_HOSTS.has(host)) return true
  return BUILTIN_BENIGN_SUFFIXES.some((s) => host.endsWith(s))
}

function diffEntries(baseline: string[], actual: string[]): string {
  const b = new Set(baseline)
  const a = new Set(actual)
  const added = actual.filter((e) => !b.has(e))
  const removed = baseline.filter((e) => !a.has(e))
  const sec = (title: string, lines: string[]) =>
    lines.length ? `${title}（${lines.length}）\n${lines.map((l) => '      ' + l).join('\n')}` : `${title}（0）`
  return `  ${sec('新增', added)}\n  ${sec('消失', removed)}`
}

const REGEN_CMD = 'NETWORK_EGRESS_UPDATE=1 npx vitest run tests/unit/networkEgress.test.ts'
/** 清单段（域名载体 / 出口点位）：重生成即可刷新——这条红的作用是「逼你确认这次变化是有意为之」 */
const RATCHET_HINT = (what: string) =>
  `  确属有意的变化就重生成：${REGEN_CMD}（别名 UPDATE_NETWORK_EGRESS=1；PowerShell 要先 $env:NETWORK_EGRESS_UPDATE='1'）——${what}随实扫刷新，写回前请先确认这次变化正是你要的。`
/** policy 段（主机白名单）：重生成救不了你，这正是设计点 */
const POLICY_HINT = `  注意：重生成（${REGEN_CMD}）只刷新清单段，**不会**替你登记新主机——allowedHosts / benignHosts 是人工权威，新增条目要连成因一起手写进基线，好让它在 diff 里被看见。`

const reading = readTree()
const mode = detectMode()
const baseline = readBaseline()
// 首次生成（基线还不存在）时，policy 段回落到门禁里的人工种子；正常判定下缺基线就是红（见「模式自证」）。
const seed = policySeeds()
const allowedSet = new Set((baseline?.allowedHosts ?? (REGEN ? seed.allowed : [])).map((h) => h.toLowerCase()))
const benignSet = new Set(Object.keys(baseline?.benignHosts ?? (REGEN ? seed.benign : {})).map((h) => h.toLowerCase()))

describe('宿主对外出口门禁（networkEgress）', () => {
  it('模式自证：仓根有导出账本 = 公开内核子集，没有 = 私有整仓', () => {
    // 模式判错方向的后果是"该严的地方放软"，所以这里把两侧各自的前提钉住。
    // 注意：本文件里不要写出其它模块的完整路径字面量——winBranchInventory 的覆盖列按
    // 「测试文本里出现过该模块路径」判定，写了就等于替那个模块认领了一份平台分支覆盖（会改到它的基线）。
    if (mode.subset) {
      expect(
        Object.keys(reading.literalDomainFiles).length > 0,
        `子集树里一个域名字面量载体都没有（${mode.why}）⇒ 公开面已不能独立审到升级出口，白名单把 updater / updatePlan 漏掉了`,
      ).toBe(true)
      expect(
        reading.networkExits.some((e) => e.includes('updater.ts')),
        '子集树里升级检查的出口点位不见了 ⇒ 模式判错或白名单收缩，公开审计面塌了一块',
      ).toBe(true)
      return
    }
    expect(
      fs.existsSync(path.join(ROOT, PROVENANCE)),
      `判定为私有整仓，但 ${PROVENANCE} 存在——模式自相矛盾，看 detectMode 的成因：${mode.why}`,
    ).toBe(false)
    if (REGEN) return
    expect(
      baseline,
      `基线缺失——先跑 ${REGEN_CMD} 生成 ${rel(BASELINE_PATH)}`,
    ).not.toBeNull()
    expect(
      baseline?._generatedIn ?? 'full',
      `基线由 ${baseline?._generatedIn ?? '未知形态'} 生成——基线只能由私有整仓写出（公开子集写它会抹掉私有仓的出口点位）`,
    ).toBe('full')
  })

  /* ---------- 断言 1：主机白名单 ---------- */
  const offenders = () =>
    reading.hosts
      .filter((h) => !allowedSet.has(h.host) && !benignSet.has(h.host) && !isBuiltinBenign(h.host))
      .map((h) => `    ${h.host}\n${h.entries.map((e) => `        ${e}`).join('\n')}`)

  it('源码里出现的每个 http(s):// 主机都必须在基线白名单或惰性豁免表内（唯一对外目的地承诺的机器面）', () => {
    if (REGEN) return // 写回路径自己会拒绝未登记主机，见下面的「基线刷新」
    const bad = offenders()
    expect(
      bad,
      `发现 ${bad.length} 个未登记的对外主机（本仓承诺：宿主不上传任何文件内容，软件唯一对外目的地只有 ${DOMAIN_LITERAL}；运行期没有 webRequest 拦截，本门禁是这句话的唯一判据）：\n${bad.join('\n')}\n  成因与出路：这是新增出口 ⇒ PRIVACY.md / README 的公开声明当场失效，先改文案并由用户拍板，再 NETWORK_EGRESS_BREAK=1 NETWORK_EGRESS_BREAK_REASON=<成因> 重生成；确属惰性字面量（XML 命名空间 / 文档链接）⇒ 写进基线 benignHosts 并附成因（不在此列的 localhost、*.test 等不可路由地址门禁已内置）。\n${POLICY_HINT}`,
    ).toEqual([])
  })

  it('协议前缀写了而主机不在同一字面量内（拼接 URL）也必须红——那是白名单唯一的绕行缝', () => {
    if (REGEN) return
    expect(
      reading.dynamicHosts,
      `发现 ${reading.dynamicHosts.length} 处「有协议无主机」的 URL 字面量（形如 'https://' + host），主机来自变量 ⇒ 白名单管不到它：\n${reading.dynamicHosts.map((s) => `    ${s}`).join('\n')}\n  处置：把主机写成同一处字面量交给本门禁判，或让该请求走集中注入的 baseUrl；确属非出口（如文档片段）⇒ 改写措辞避开 scheme 前缀。`,
    ).toEqual([])
  })

  /* ---------- 断言 2：域名字面量的文件级棘轮 ---------- */
  it(`硬编码 ${DOMAIN_LITERAL} 字面量的文件集合与基线一致（其余模块必须走注入的 baseUrl）`, () => {
    if (REGEN) return // 重生成时基线尚是旧值，比对留给写回后的下一次普通运行
    const base = baseline?.literalDomainFiles ?? {}
    const cur = reading.literalDomainFiles
    if (mode.subset) {
      const extra = Object.keys(cur).filter((f) => !(f in base))
      const mismatch = extra.length ? [] : Object.keys(cur).filter((f) => cur[f] !== base[f])
      expect(
        extra,
        `公开内核子集里出现了基线未登记的域名字面量载体：\n${extra.map((f) => `    ${f}（${cur[f]} 处）`).join('\n')}\n  内核仓只能有私有仓的子集；多出来说明导出通道被绕过（走 scripts/export-kernel.mjs）。\n  基线归私有仓所有：回到 qihe-box 改实现或改白名单，再 npm run kernel:export；子集树里不重生成基线。`,
      ).toEqual([])
      expect(mismatch, `子集里同名文件的字面量次数与基线不符（导出是逐字拷贝，不该差）：\n${diffEntries(Object.entries(base).filter(([f]) => f in cur).map(([f]) => `${f}:${base[f]}`), Object.entries(cur).map(([f]) => `${f}:${cur[f]}`))}`).toEqual([])
      return
    }
    const keys = (m: Record<string, number>) => Object.keys(m).sort()
    expect(
      keys(cur),
      `持有 ${DOMAIN_LITERAL} 字面量的文件集合与基线不符：\n${diffEntries(keys(base).map((f) => f), keys(cur))}\n  新文件写死域名 ⇒ 「一切出口经集中 baseUrl」的说法失效，先接到注入上；确要新增直连点 ⇒ 公开文案同笔改。\n${RATCHET_HINT('域名载体')}`,
    ).toEqual(keys(base))
    const counts = (m: Record<string, number>) => keys(m).map((f) => `${f}:${m[f]}`)
    expect(
      counts(cur),
      `文件集合没变但逐文件命中次数变了：\n${diffEntries(counts(base), counts(cur))}\n${RATCHET_HINT('域名载体')}`,
    ).toEqual(counts(base))
  })

  /* ---------- 断言 3：出口点位清单 ---------- */
  const inventoryCases: { name: string; key: 'networkExits' | 'urlConstructions' | 'fetchBindings'; label: string }[] = [
    { name: '网络出口调用点（fetch / fetchImpl / net.fetch / net.request / XHR / WebSocket）', key: 'networkExits', label: '出口' },
    { name: 'URL 构造点（new URL）', key: 'urlConstructions', label: '构造' },
    { name: '全局 fetch 绑定的取用点（?? fetch / = fetch）', key: 'fetchBindings', label: '绑定' },
  ]
  for (const c of inventoryCases) {
    it(`清单一致：src/main/** 的${c.name}与基线逐条对齐`, () => {
      if (REGEN) return // 同上：重生成轮次不比旧基线
      const base = baseline?.inventory?.[c.key] ?? []
      const cur = reading[c.key]
      if (mode.subset) {
        const missing = cur.filter((e) => !base.includes(e))
        expect(
          missing,
          `公开内核子集的${c.label}点位不在基线里：\n${missing.map((e) => `    ${e}`).join('\n')}\n  内核树是白名单子集 ⇒ 只准少不准多；多出来说明导出通道的 overlay 替身（manifest 的 overlayDir / stubbed 条目）往里塞了新出口——这些文件不在私有仓 src/ 下，基线照不到它们 ⇒ 把该点位连同成因补进基线，或撤掉替身里的出口（替身应当零网络出口，这是它敢公开的前提）。`,
        ).toEqual([])
        return
      }
      expect(
        cur,
        `${c.name}与基线不符（增删都红：这条把「出口已被穷举」从 markdown 里的说法变成机器判据）：\n${diffEntries(base, cur)}\n${RATCHET_HINT('出口清单')}`,
      ).toEqual(base)
    })
  }

  /* ---------- 断言 4：零文件上传原语 ---------- */
  it('src/main/** 里零文件上传原语（multipart / FormData / putObject / presign / S3 / appendChild / upload）', () => {
    expect(
      reading.uploadHits,
      `「宿主不做文件上传」这句话在代码里出现了反例（本条不因既成事实削弱，交人裁决：要么改公开文案加限定，要么撤掉该实现）：\n${reading.uploadHits.map((h) => `    ${h}`).join('\n')}`,
    ).toEqual([])
    if (REGEN) return // 词表与口径快照随本轮写回刷新，不比旧值
    expect(
      baseline?.uploadPrimitives?.policy,
      `基线未登记上传词表口径（应为 'zero'）——有人改过基线文件：${baseline?.uploadPrimitives?.policy ?? '（缺失）'}`,
    ).toBe('zero')
    const names = UPLOAD_VOCAB.map((v) => v.name)
    expect(
      baseline?.uploadPrimitives?.patterns ?? [],
      `基线里的上传词表与门禁代码不一致（词表在测试文件里，基线只是快照）：\n${diffEntries(baseline?.uploadPrimitives?.patterns ?? [], names)}`,
    ).toEqual(names)
  })

  /* ---------- 防假绿自检 ---------- */
  it('扫描器自检：确实扫到了出口与主机（扫描规则被改坏时空清单也会"绿"）', () => {
    // 下限按模式分档：公开内核子集只有白名单那几十个文件，用整仓的下限会把它逼成假红
    const tsFloor = mode.subset ? 15 : 100
    const mainFloor = mode.subset ? 8 : 10
    expect(reading.scannedTsFiles, `扫到的 .ts/.tsx 少于 ${tsFloor} 个——扫描根或后缀规则被改坏了`).toBeGreaterThanOrEqual(tsFloor)
    expect(reading.scannedMainFiles, `src/main 下扫到的文件少于 ${mainFloor} 个——出口判据的根目录被改坏了`).toBeGreaterThanOrEqual(mainFloor)
    expect(reading.hosts.length, '一处 URL 字面量都没扫到——URL 正则被改坏了').toBeGreaterThan(0)
    expect(
      reading.hosts.some((h) => h.host === DOMAIN_LITERAL),
      `没扫到 ${DOMAIN_LITERAL}——本门禁的核心主机都不认识了，红`,
    ).toBe(true)
    expect(reading.networkExits.length, 'src/main 里没有任何出口形状点位——正则被改坏了').toBeGreaterThan(0)
    expect(
      reading.networkExits.some((e) => e.includes('updater.ts')),
      '升级检查的出口点位（src/main/updater.ts）不在清单里 = 扫描面漏了最要害的一处',
    ).toBe(true)
    // 注释剥离用内联夹具自证（protocol.ts 的历史注释里就有 net.fetch 字样，混进来会污染清单）：
    // 判据不依赖仓内现状，所以它不会与断言 3 抢同一份棘轮
    const fixture = [
      '// 旧实现 net.fetch(file://) 只是注释，不算点位',
      'const resp = await net.fetch(pathToFileURL(p).toString())',
      'const t = typeof fetch',
      'const impl = deps.fetchImpl ?? fetch',
      '/* 块注释里的 fetch(x) 也不算 */',
    ].join('\n')
    expect(
      sitesOfText('fixture.ts', fixture, [{ kind: 'net.fetch', re: /\bnet\.fetch\s*\(/g }]),
      '注释剥离失效：注释里的 net.fetch 被当成了出口点位',
    ).toEqual(['fixture.ts:2 | net.fetch'])
    expect(
      sitesOfText('fixture.ts', fixture, [FETCH_REF_PATTERN]),
      '全局 fetch 绑定的引用点判据失效：typeof 的类型标注或注释被当成了取用',
    ).toEqual(['fixture.ts:4 | fetch-ref'])
    expect(reading.urlConstructions.length, 'src/main 里一处 new URL( 都没扫到——构造点正则被改坏了').toBeGreaterThan(0)
  })

  /* ---------- 基线刷新（NETWORK_EGRESS_UPDATE=1 / UPDATE_NETWORK_EGRESS=1）---------- */
  it('基线刷新：只在私有整仓、且未登记主机一律拒绝写回', () => {
    if (!REGEN) return
    if (mode.subset) {
      throw new Error(
        `[networkEgress] 拒绝写入：当前是公开内核子集树（检出 ${PROVENANCE}）。基线归私有仓所有，` +
          '在子集里重生成会把私有仓的出口点位静默抹掉。请回到 qihe-box 跑 ' +
          'NETWORK_EGRESS_UPDATE=1 npx vitest run tests/unit/networkEgress.test.ts，再 npm run kernel:export。',
      )
    }
    const unknown = offenders().map((s) => s.split('\n')[0].trim())
    if (unknown.length && !BREAK) {
      throw new Error(
        `[networkEgress] 拒绝写入：${unknown.length} 个未登记主机\n${unknown.map((u) => `    ${u}`).join('\n')}\n` +
          '  门禁不替谁登记新目的地。处置二选一：' +
          '\n    a) 确属新增对外出口 ⇒ 先改 PRIVACY.md / README 的公开口径并请用户拍板，再 ' +
          'NETWORK_EGRESS_BREAK=1 NETWORK_EGRESS_BREAK_REASON=<成因> NETWORK_EGRESS_UPDATE=1 npx vitest run …（成因入基线 _breakReason）；' +
          '\n    b) 确属惰性字面量 ⇒ 手工把它连同成因写进基线 benignHosts，然后普通重生成。',
      )
    }
    fs.writeFileSync(BASELINE_PATH, serialize(regenerate(baseline, reading, unknown)))
    console.log(
      `[networkEgress] 已重生成基线（${mode.why}）：主机 ${reading.hosts.length} 个 / 出口 ${reading.networkExits.length} 处 / ` +
        `new URL ${reading.urlConstructions.length} 处 / fetch 绑定 ${reading.fetchBindings.length} 处 / 上传原语 ${reading.uploadHits.length} 处` +
        (BREAK ? `（BREAK 登记新主机 ${unknown.join(', ')}；成因：${BREAK_REASON || '未填写'}）` : ''),
    )
  })
})
