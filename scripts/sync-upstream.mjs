// 用途：pi-subagents-lean 的上游（@tintinweb/pi-subagents）升版后，一条命令完成「同步 + 实测 + 改文档」。
//
// 同一份脚本在两处跑，行为按目录内容自动判断：
//   · 包仓库（只声明依赖，上游装进 node_modules）→ 直接 npm 安装新版，再改 package.json / README
//   · vendored 安装目录（本机 ~/.pi/agent/extensions/pi-subagents-lean，上游源码烤进 upstream/）
//     → 从临时目录拷 src/ dist/ 与运行时依赖，不动 pi 的 npm 树
//
// 口径：token = ceil(字符数/4)（工具定义 + 工具列表 snippet + promptGuidelines + before_agent_start 注入），
//       与 kunkun9527/pi-subagents-lean 的 benchmark 同尺子；不是真实 tokenizer 计费。
//
// 用法：
//   node scripts/sync-upstream.mjs                 # 只核对（不联网）：版本 / token / 工具数 / 差值
//   node scripts/sync-upstream.mjs --to 0.24.0     # 升到指定版本（--to latest 取 registry 最新）
//   node scripts/sync-upstream.mjs --repo <目录>    # vendored 安装时，额外把仓库文件一起改掉
//
// 不做的事：不执行 git commit/push/tag/release —— 命令会打印出来，由人决定。

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const run = promisify(execFile);
const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PI_GLOBAL = 'C:/Users/12990/AppData/Roaming/PiDeck/pi-runtime/pi-global/node_modules';
const PI_DIST = `${PI_GLOBAL}/@earendil-works/pi-coding-agent/dist`;
const PKG = '@tintinweb/pi-subagents';
const VENDORED = await fs.stat(`${EXT}/upstream/package.json`).catch(() => null);

const argv = process.argv.slice(2);
const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const TO = arg('--to');
const REPO = arg('--repo');

// Windows 上 npm 是 .cmd 垫片，execFile 直调会 ENOENT；改用 node 跑 npm-cli.js。
async function npmRun(args, options) {
  const cli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const [command, prefix] = process.platform === 'win32' ? [process.execPath, [cli]] : ['npm', []];
  return run(command, [...prefix, ...args], options);
}

const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const pct = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : 'n/a');
const num = (n) => n.toLocaleString('en-US');

function upstreamEntry() {
  return VENDORED ? `${EXT}/upstream/src/index.ts` : `${EXT}/node_modules/${PKG}/src/index.ts`;
}

async function currentUpstreamVersion() {
  try {
    return (await readJson(VENDORED ? `${EXT}/upstream/package.json` : `${EXT}/node_modules/${PKG}/package.json`)).version;
  } catch { return null; }
}

// —— 实测：加载扩展，量工具定义 + prompt 注入 ——
async function measure(entryPath) {
  if (!(await fs.stat(PI_DIST).catch(() => null))) throw new Error(`找不到 pi 运行时：${PI_DIST}`);
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-cwd-'));
  const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-agent-'));
  try {
    const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } =
      await import(pathToFileURL(`${PI_DIST}/index.js`).href);
    const settingsManager = SettingsManager.create(cwd, agentDir);
    const loader = new DefaultResourceLoader({
      cwd, agentDir, settingsManager,
      additionalExtensionPaths: [entryPath],
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    if (loaded.errors?.length) throw new Error('扩展加载失败: ' + JSON.stringify(loaded.errors));

    const { session } = await createAgentSession({
      cwd, agentDir, settingsManager, resourceLoader: loader,
      sessionManager: SessionManager.inMemory(), noTools: 'builtin',
    });
    const errs = [];
    const off = session._extensionRunner.onError((e) => errs.push(e));
    await session.bindExtensions({ mode: 'print' });
    if (errs.length) throw new Error('扩展绑定失败: ' + JSON.stringify(errs));

    const active = new Set(session.getActiveToolNames());
    const snippets = session._baseSystemPromptOptions?.toolSnippets ?? {};
    const tools = session.getAllTools().filter((t) => active.has(t.name)).map((t) => {
      const g = Array.isArray(t.promptGuidelines) ? t.promptGuidelines : t.promptGuidelines ? [t.promptGuidelines] : [];
      const params = JSON.stringify(t.parameters ?? {});
      const chars = `${t.name}: ${t.description}\n${params}`.length
        + (snippets[t.name] ? `\n- ${t.name}: ${snippets[t.name]}`.length : 0)
        + g.reduce((s, x) => s + `\n- ${String(x).trim()}`.length, 0);
      return { name: t.name, tokens: Math.ceil(chars / 4) };
    });

    const initial = session.systemPrompt;
    const runner = session._extensionRunner;
    const ev = runner.emitBeforeAgentStart.length === 2
      ? await runner.emitBeforeAgentStart({ prompt: '', images: undefined }, session._baseSystemPromptOptions)
      : await runner.emitBeforeAgentStart('', undefined, session._baseSystemPromptOptions);
    const msgChars = ev?.messages?.length ? JSON.stringify(ev.messages).length : 0;
    const promptTokens = Math.ceil((session.systemPrompt.length - initial.length) / 4) + Math.ceil(msgChars / 4);
    const toolTokens = tools.reduce((s, t) => s + t.tokens, 0);
    off?.();
    return { tools, toolTokens, promptTokens, total: toolTokens + promptTokens };
  } finally {
    await fs.rm(cwd, { recursive: true, force: true }).catch(() => {});
    await fs.rm(agentDir, { recursive: true, force: true }).catch(() => {});
  }
}

// —— 升版：vendored 走临时目录拷贝，包仓库走 npm 安装 ——
async function syncTo(target) {
  const before = await currentUpstreamVersion();
  const spec = `${PKG}@${target}`;

  if (!VENDORED) {
    console.log(`→ npm install ${spec}（包仓库模式，装进 ${EXT}/node_modules）`);
    await npmRun(['install', '--prefix', EXT, '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', spec], { timeout: 600000 });
    return { from: before, to: await currentUpstreamVersion() };
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'sync-up-'));
  try {
    console.log(`→ 从 registry 拉取 ${spec}（临时目录，不动 pi 的 npm 树）`);
    await npmRun(['install', '--prefix', tmp, '--no-save', '--no-audit', '--no-fund', '--ignore-scripts', spec], { timeout: 600000 });
    const src = `${tmp}/node_modules/${PKG}`;
    const pkg = await readJson(`${src}/package.json`);

    for (const item of ['src', 'dist']) {
      await fs.rm(`${EXT}/upstream/${item}`, { recursive: true, force: true });
      await fs.cp(`${src}/${item}`, `${EXT}/upstream/${item}`, { recursive: true });
    }
    for (const f of ['package.json', 'CHANGELOG.md', 'LICENSE', 'README.md']) {
      await fs.cp(`${src}/${f}`, `${EXT}/upstream/${f}`).catch(() => {});
    }

    const deps = Object.keys(pkg.dependencies ?? {});
    for (const dep of deps) {
      const depSrc = `${tmp}/node_modules/${dep}`;
      if (!(await fs.stat(depSrc).catch(() => null))) { console.warn(`  ⚠ 依赖 ${dep} 不在临时目录，跳过`); continue; }
      await fs.rm(`${EXT}/node_modules/${dep}`, { recursive: true, force: true });
      await fs.cp(depSrc, `${EXT}/node_modules/${dep}`, { recursive: true });
    }
    console.log(`→ 已替换 upstream/ 与 node_modules/（运行时依赖: ${deps.join(', ') || '无'}）`);
    return { from: before, to: pkg.version };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

// —— 改文档：版本号、基准表格、节省量与百分比 ——
async function updateFiles(dir, ver, leanTok, upTools, upTok) {
  const changed = [];
  const review = [];
  const patch = async (p, fn) => {
    const before = await fs.readFile(p, 'utf8');
    const after = fn(before);
    if (after !== before) { await fs.writeFile(p, after, 'utf8'); changed.push(path.basename(p)); }
  };
  const saved = upTok - leanTok;
  const upstreamRow = upTools.map((t) => `\`${t.name}\` (${num(t.tokens)})`).join(' + ');

  await patch(`${dir}/package.json`, (s) => {
    const j = JSON.parse(s);
    j.version = ver;
    j.dependencies = { ...(j.dependencies ?? {}), [PKG]: ver };
    return JSON.stringify(j, null, 2) + '\n';
  });

  for (const name of ['README.md', 'README_zh-CN.md']) {
    const p = `${dir}/${name}`;
    if (!(await fs.stat(p).catch(() => null))) continue;
    await patch(p, (s) => {
      let out = s;
      out = out.replace(/@tintinweb\/pi-subagents@\d+\.\d+\.\d+/g, `${PKG}@${ver}`);
      out = out.replace(/(\| Lean `[^`]*@)\d+\.\d+\.\d+(` \| )`subagent` \(\d+\)( \| \*\*)\d+(\*\* \|)/g,
        `$1${ver}$2\`subagent\` (${leanTok})$3${leanTok}$4`);
      out = out.replace(/(\| (?:Upstream|上游) `[^`]*@)\d+\.\d+\.\d+(` \| )[^|]+?( \| \*\*)[\d,]+(\*\* \|)/g,
        `$1${ver}$2${upstreamRow}$3${num(upTok)}$4`);
      out = out.replace(/^(# .*?\(upstream )[\d.]+(\)\s*$)/m, `$1${ver}$2`);
      out = out.replace(/(re-pinned to upstream `[^`]*` )\*\*[\d.]+\*\*/g, `$1**${ver}**`);
      out = out.replace(/(Lean )\d+(, upstream|，上游)/, `$1${leanTok}$2`);
      out = out.replace(/(@\d+\.\d+\.\d+` )\d[\d,]*( —|，)/, `$1${num(upTok)}$2`);
      out = out.replace(/节[省约] \*\*[\d,]+ tokens（[\d.]+%）\*\*/, `节省 **${num(saved)} tokens（${pct(saved, upTok)}）**`);
      out = out.replace(/This saves \*\*[\d,]+ tokens \([\d.]+%\)\*\*/, `This saves **${num(saved)} tokens (${pct(saved, upTok)})**`);
      out = out.replace(/[（(]减少 [\d.]+%[）)]/g, `（减少 ${pct(saved, upTok)}）`);
      out = out.replace(/(\d+\.\d+% fewer)/g, `${pct(saved, upTok)} fewer`);
      return out;
    });
    const text = await fs.readFile(p, 'utf8');
    let inFence = false;
    text.split('\n').forEach((line, i) => {
      if (line.trim().startsWith('```')) { inFence = !inFence; return; }
      if (inFence) return; // 代码块里的版本号大多是示例（--to 0.24.0），不列入复核
      const stale = [...line.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((m) => m[0]).filter((v) => v !== ver);
      if (stale.length) review.push(`${name}:${i + 1} 出现 ${[...new Set(stale)].join(', ')}`);
    });
  }
  return { changed, review };
}

async function main() {
  const before = await currentUpstreamVersion();
  console.log(`\n=== pi-subagents-lean 上游同步（${VENDORED ? 'vendored 安装目录' : '包仓库'}）===`);
  console.log(`目录: ${EXT}`);
  console.log(`当前上游版本: ${before ?? '(缺失)'}`);

  const sync = TO ? await syncTo(TO) : null;
  const ver = sync?.to ?? before;

  const lean = await measure(`${EXT}/index.ts`);
  const upPath = upstreamEntry();
  if (!(await fs.stat(upPath).catch(() => null))) {
    throw new Error(`找不到上游入口 ${upPath}${VENDORED ? '' : '（先 npm ci）'}`);
  }
  const up = await measure(upPath);

  console.log(`\n上游 ${ver}: 工具 ${up.tools.length} 个，合计 ${up.toolTokens} tokens`);
  for (const t of up.tools) console.log(`  - ${t.name}: ${t.tokens}`);
  console.log(`Lean: 工具 ${lean.tools.length} 个（${lean.tools.map((t) => t.name).join(', ')}），合计 ${lean.total} tokens`);
  const saved = up.toolTokens - lean.total;
  console.log(`差值: 省 ${saved} tokens（${pct(saved, up.toolTokens)}）`);

  if (lean.tools.length !== 1 || lean.tools[0].name !== 'subagent') {
    console.error('\n✗ 校验失败：lean 应只注册一个 subagent 工具 —— 上游可能改了工具名，检查 index.ts 的取名字段');
    process.exitCode = 1;
    return;
  }

  // 包仓库模式：脚本就在要改的目录里；vendored 模式：只有 --repo 时才改外部目录
  const target = REPO ?? (VENDORED ? null : EXT);
  if (target) {
    const { changed, review } = await updateFiles(target, ver, lean.total, up.tools, up.toolTokens);
    console.log(`\n文件已更新: ${changed.length ? changed.join(', ') : '无变化'}（${target}）`);
    if (review.length) {
      console.log('需人工判断的旧版本提及（脚本不改事实陈述）：');
      for (const r of review) console.log('  ' + r);
    }
  }

  const steps = [
    '重启 PiDeck 让新代码生效',
    '真机冒烟：subagent op=help 能返回上游帮助，op=run 能真起一个 general-purpose',
  ];
  if (target) {
    steps.push(`在 ${target} 里提交并打 tag：
       git add -A && git commit -m "chore: bump upstream to ${ver}"
       git push origin main
       git tag -a v${ver} -m "pi-subagents-lean ${ver}" && git push origin v${ver}`);
  }
  steps.push('CHANGELOG.md 手写一条：上游这次改了什么、为什么值得跟');
  console.log('\n下一步（本次不做，命令供你决定后执行）：');
  steps.forEach((s, i) => console.log(`  ${i + 1}) ${s}`));
  console.log('');
}

main().catch((e) => { console.error('失败:', e?.message ?? e); process.exitCode = 1; });
