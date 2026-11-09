import { spawn } from "node:child_process";
import { access, chmod, mkdir, open, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { paths, saveJson } from "./config.mjs";

export const UPLOAD_PAGE = "https://www.ximalaya.com/reform-upload/page/webCenter/upload";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const officialPage = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && ["www.ximalaya.com", "studio.ximalaya.com", "passport.ximalaya.com"].includes(u.hostname);
  } catch { return false; }
};

export async function findChrome(override, {
  platform = process.platform, env = process.env, exists = async (file) => {
    try { await access(file, platform === "win32" ? constants.F_OK : constants.X_OK); return true; }
    catch { return false; }
  },
} = {}) {
  const explicit = override || env.XMLY_CHROME_PATH;
  const candidates = explicit ? [explicit] : platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
  ] : platform === "win32" ? [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"]]
    .filter(Boolean).map((dir) => join(dir, "Google", "Chrome", "Application", "chrome.exe")) :
    (env.PATH || "").split(delimiter).filter(Boolean).flatMap((dir) =>
      ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"].map((name) => join(dir, name)));
  for (const candidate of candidates) if (await exists(candidate)) return candidate;
  throw new Error(explicit ? "指定的 Chrome 可执行文件不存在或不可执行" :
    "未找到系统 Chrome，请安装 Google Chrome，或用 --chrome-path /可执行文件路径 指定");
}

export function debugAddress(text) {
  const [rawPort, path] = text.trim().split(/\r?\n/);
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(path || ""))
    throw new Error("Chrome 调试端点无效，请重新运行 xmly auth login");
  return { port, path, url: `ws://127.0.0.1:${port}${path}` };
}

export class ChromeConnection {
  constructor(socket, timeoutMs = 30000) {
    this.socket = socket; this.timeoutMs = timeoutMs; this.sequence = 0; this.pending = new Map();
    socket.addEventListener("message", (event) => {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id); clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`Chrome 协议调用失败：${pending.method}（${message.error.code}）`));
      else pending.resolve(message.result || {});
    });
    const disconnected = () => this.rejectAll(new Error("Chrome 连接已断开，请保持 CLI 登录窗口打开后重试"));
    socket.addEventListener("close", disconnected);
    socket.addEventListener("error", disconnected);
  }
  static async connect(url, { timeoutMs = 10000, WebSocketImpl = WebSocket } = {}) {
    const u = new URL(url);
    if (u.protocol !== "ws:" || u.hostname !== "127.0.0.1" || u.username || u.password ||
        u.search || u.hash || !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(u.pathname))
      throw new Error("仅允许连接本机 CLI 专用 Chrome 调试端点");
    const socket = new WebSocketImpl(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error("连接 Chrome 超时")); }, timeoutMs);
      socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("无法连接 CLI 登录 Chrome，请重新运行 xmly auth login")); }, { once: true });
    });
    return new ChromeConnection(socket);
  }
  command(method, params = {}, sessionId) {
    if (this.socket.readyState !== 1) return Promise.reject(new Error("Chrome 连接已关闭"));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Chrome 调用超时：${method}`)); }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error("Chrome 连接写入失败")); }
    });
  }
  rejectAll(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  close() { this.rejectAll(new Error("Chrome 连接已关闭")); this.socket.close(); }
}

export async function connectChrome(profile, options) {
  const p = paths(profile);
  let address;
  try { address = debugAddress(await readFile(join(p.chromeProfile, "DevToolsActivePort"), "utf8")); }
  catch { throw new Error("CLI 专用 Chrome 未运行，请先执行 xmly auth login"); }
  return ChromeConnection.connect(address.url, options);
}

export async function launchChrome(profile, { chromePath, timeoutMs = 15000 } = {}) {
  const p = paths(profile);
  await mkdir(p.chromeProfile, { recursive: true, mode: 0o700 });
  await chmod(p.chromeProfile, 0o700);
  const lockPath = join(p.chromeProfile, ".xmly-launch.lock");
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); }
  catch (e) { if (e.code === "EEXIST") throw new Error("该 profile 的 Chrome 正在启动，请稍后重试"); throw e; }
  try {
    try {
      const existing = await connectChrome(profile, { timeoutMs: 1500 });
      existing.close(); return { reused: true, userDataDir: p.chromeProfile };
    } catch {}
    const executable = await findChrome(chromePath);
    await rm(join(p.chromeProfile, "DevToolsActivePort"), { force: true });
    const child = spawn(executable, [
      `--user-data-dir=${p.chromeProfile}`, "--remote-debugging-port=0",
      "--remote-debugging-address=127.0.0.1", "--no-first-run", "--no-default-browser-check",
      "--new-window", UPLOAD_PAGE,
    ], { detached: true, stdio: "ignore" });
    let failed = false;
    child.once("error", () => { failed = true; });
    child.unref();
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (failed || child.exitCode !== null) throw new Error("Chrome 启动失败，请检查 --chrome-path 或关闭残留的 CLI 登录窗口后重试");
      try {
        const connection = await connectChrome(profile, { timeoutMs: 1000 });
        connection.close();
        await saveJson(p.chromeState, { transport: "chrome", executable,
          userDataDir: p.chromeProfile, pid: child.pid, openedAt: new Date().toISOString() });
        return { reused: false, userDataDir: p.chromeProfile };
      } catch {}
      await pause(150);
    }
    throw new Error("Chrome 启动超时，请关闭 CLI 专用窗口后重试；日常 Chrome 无需关闭");
  } finally { await lock.close(); await rm(lockPath, { force: true }); }
}

export class ChromeLoginPage {
  constructor(connection, sessionId, targetId) {
    this.connection = connection; this.sessionId = sessionId; this.targetId = targetId;
  }
  static async open(connection, { navigate = false } = {}) {
    const { targetInfos } = await connection.command("Target.getTargets");
    const candidates = targetInfos.filter((x) => x.type === "page" && officialPage(x.url));
    // 若登录重定向打开了新标签，优先已进入上传页的目标，避免停留在旧二维码页。
    let target = candidates.find((x) => x.url.startsWith(UPLOAD_PAGE)) || candidates[0];
    if (!target) {
      const created = await connection.command("Target.createTarget", { url: UPLOAD_PAGE });
      target = { targetId: created.targetId };
    }
    const { sessionId } = await connection.command("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    const page = new ChromeLoginPage(connection, sessionId, target.targetId);
    if (navigate) await connection.command("Page.navigate", { url: UPLOAD_PAGE }, sessionId);
    await connection.command("Target.activateTarget", { targetId: target.targetId });
    return page;
  }
  async evaluate(expression, { timeoutMs = 30000 } = {}) {
    const result = await this.connection.command("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, timeout: timeoutMs,
    }, this.sessionId);
    if (result.exceptionDetails) throw new Error("Chrome 登录页初始化失败，请确认已登录并等待上传页加载完成后运行 xmly auth capture");
    return result.result?.value;
  }
  async ready() {
    return this.evaluate(`location.origin==='https://www.ximalaya.com'&&location.pathname.startsWith('/reform-upload/page/')&&typeof window._getDUH==='function'`);
  }
  async cookies() {
    const result = await this.connection.command("Network.getCookies", { urls: [
      "https://studio.ximalaya.com/", "https://www.ximalaya.com/", "https://passport.ximalaya.com/",
    ] }, this.sessionId);
    return result.cookies;
  }
}
