import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromeConnection, ChromeLoginPage, debugAddress, findChrome, UPLOAD_PAGE } from "../lib/chrome.mjs";
import { captureChrome, login } from "../lib/auth.mjs";
import { saveJson } from "../lib/config.mjs";

test("Chrome发现使用系统安装或显式路径，不下载浏览器、不启动Ego", async () => {
  const checked = [];
  const path = await findChrome(undefined, { platform: "darwin", env: {}, exists: async (candidate) => {
    checked.push(candidate); return candidate.startsWith("/Applications/");
  } });
  assert.equal(path, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  assert.equal(checked.length, 1);
  assert.equal(await findChrome(undefined, { env: { XMLY_CHROME_PATH: "/custom/chrome" }, exists: async (x) => x === "/custom/chrome" }), "/custom/chrome");
  await assert.rejects(findChrome("/missing", { exists: async () => false }), /不存在/);
});

test("默认login自动等待保存，no-wait只打开窗口且提示手动捕获", async () => {
  let captures = 0, disconnects = 0;
  const messages = [];
  const options = { launch: async () => ({ reused: true, userDataDir: "/synthetic/profile" }),
    connect: async () => ({ close: () => disconnects++ }),
    openPage: async (_, { navigate }) => assert.equal(navigate, true),
    captureLogin: async () => { captures++; return { ok: true, captured: true }; },
    onProgress: (message) => messages.push(message) };
  assert.equal((await login("fixture", options)).captured, true);
  assert.equal(captures, 1);
  assert.equal((await login("fixture", { ...options, noWait: true })).status, "waiting-login");
  assert.equal(captures, 1);
  assert.equal(disconnects, 2);
  assert.match(messages[1], /auth capture/);
  assert.ok(!messages[1].includes("自动保存"));
});

test("调试地址只接受本机Chrome浏览器端点，拒绝外部地址和任意路径", async () => {
  assert.equal(debugAddress("12345\n/devtools/browser/fixture-uuid\n").url, "ws://127.0.0.1:12345/devtools/browser/fixture-uuid");
  for (const value of ["0\n/devtools/browser/a", "65536\n/devtools/browser/a", "2000\n/anything", "not-a-port\n/devtools/browser/a"])
    assert.throws(() => debugAddress(value), /端点无效/);
  for (const url of ["wss://example.com/devtools/browser/a", "ws://127.0.0.1:2000/devtools/page/a", "ws://user:pass@127.0.0.1/devtools/browser/a", "ws://127.0.0.1/devtools/browser/a?token=secret"])
    await assert.rejects(ChromeConnection.connect(url), /仅允许/);
});

class Socket extends EventTarget {
  readyState = 1;
  sent = [];
  send(data) { this.sent.push(JSON.parse(data)); }
  receive(message) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(message) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event("close")); }
}
test("CDP请求按ID对应乱序响应、保留session且异常不泄漏响应内容", async () => {
  const socket = new Socket(), connection = new ChromeConnection(socket, 1000);
  const first = connection.command("Target.getTargets"), second = connection.command("Network.getCookies", {}, "session-1");
  socket.receive({ id: 2, result: { cookies: [] } });
  socket.receive({ id: 1, result: { targetInfos: [] } });
  assert.deepEqual(await first, { targetInfos: [] });
  assert.deepEqual(await second, { cookies: [] });
  assert.equal(socket.sent[1].sessionId, "session-1");
  const bad = connection.command("Runtime.evaluate");
  socket.receive({ id: 3, error: { code: -32000, message: "secret-fixture-cookie" } });
  await assert.rejects(bad, (e) => /Runtime.evaluate/.test(e.message) && !e.message.includes("secret-fixture-cookie"));
  connection.close();
});

test("CDP超时和断连清理待处理命令，不会永远挂起", async () => {
  const socket = new Socket(), connection = new ChromeConnection(socket, 5);
  await assert.rejects(connection.command("Target.getTargets"), /超时/);
  assert.equal(connection.pending.size, 0);
  const pending = connection.command("Runtime.evaluate");
  socket.close();
  await assert.rejects(pending, /断开/);
  assert.equal(connection.pending.size, 0);
});

test("只选择喜马拉雅HTTPS标签，没有合法标签则新建官方上传页", async () => {
  const calls = [], connection = { command: async (method, params, session) => {
    calls.push({ method, params, session });
    if (method === "Target.getTargets") return { targetInfos: [
      { type: "page", url: "https://www.ximalaya.com.evil.example/", targetId: "bad" },
      { type: "page", url: "http://www.ximalaya.com/", targetId: "insecure" },
    ] };
    if (method === "Target.createTarget") return { targetId: "new-official" };
    if (method === "Target.attachToTarget") return { sessionId: "s1" };
    return {};
  } };
  const page = await ChromeLoginPage.open(connection);
  assert.equal(page.targetId, "new-official");
  assert.equal(calls[1].params.url, UPLOAD_PAGE);
  assert.equal(calls[2].params.targetId, "new-official");
  await page.cookies();
  assert.equal(calls.at(-1).method, "Network.getCookies");
  assert.equal(calls.at(-1).session, "s1");
  assert.ok(calls.at(-1).params.urls.every((x) => new URL(x).hostname.endsWith("ximalaya.com")));
});

async function captureFixture(action) {
  const dir = await mkdtemp(join(tmpdir(), "xmly-chrome-auth-"));
  const storePaths = { auth: join(dir, "auth.json"), signer: join(dir, "signer.json") };
  const state = { schemaVersion: 1, accountUid: 12345, capturedAt: "fixture", identity: { idd: "synthetic-identity" }, browserId: "synthetic-device-id", dna: { BG5: true } };
  const cookie = { name: "1&_token", value: "synthetic-test-cookie", domain: ".ximalaya.com", path: "/", secure: true };
  const calls = [], connection = { command: async (method) => { calls.push(method); }, close: () => calls.push("disconnect") };
  let readyChecks = 0;
  const page = { ready: async () => ++readyChecks >= 2, evaluate: async () => state, cookies: async () => [cookie] };
  const options = { storePaths, connect: async () => connection, openPage: async () => page,
    sleep: async () => {}, verify: async () => 12345, timeoutMs: 1000 };
  try { await action({ dir, storePaths, state, cookie, calls, page, options }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}

test("扫码后自动捕获并只读验证，保存600权限，完成后关闭专用Chrome且结果无凭据", async () => captureFixture(async ({ storePaths, cookie, calls, options }) => {
  let checks = 0;
  const result = await captureChrome("fixture", { ...options, verify: async (auth) => {
    checks++; assert.equal(auth.cookies[0].value, cookie.value); return 12345;
  } });
  assert.equal(checks, 1);
  assert.equal(result.captured, true);
  assert.equal(result.browser, "chrome");
  assert.equal(result.signerReady, true);
  assert.ok(!JSON.stringify(result).includes(cookie.value));
  assert.equal(JSON.parse(await readFile(storePaths.auth, "utf8")).source, "chrome");
  for (const path of [storePaths.auth, storePaths.signer]) assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(calls, ["Browser.close", "disconnect"]);
}));

test("登录超时不覆盖原凭据，留下窗口以支持稍后auth capture", async () => captureFixture(async ({ storePaths, calls, page, options }) => {
  await saveJson(storePaths.auth, { cookies: [], previous: true });
  await saveJson(storePaths.signer, { previous: true });
  page.ready = async () => false;
  let now = 0;
  await assert.rejects(captureChrome("fixture", { ...options, timeoutMs: 2, now: () => now++ }), /登录超时/);
  assert.equal(JSON.parse(await readFile(storePaths.auth, "utf8")).previous, true);
  assert.equal(JSON.parse(await readFile(storePaths.signer, "utf8")).previous, true);
  assert.deepEqual(calls, ["disconnect"]);
}));

test("捕获信息不完整或账号校验失败时不覆盖旧状态", async () => captureFixture(async ({ storePaths, state, calls, options }) => {
  await saveJson(storePaths.auth, { cookies: [], previous: true });
  await saveJson(storePaths.signer, { previous: true });
  await assert.rejects(captureChrome("fixture", { ...options, verify: async () => 99999 }), /账号不一致/);
  state.browserId = "";
  await assert.rejects(captureChrome("fixture", options), /登录状态不完整/);
  assert.equal(JSON.parse(await readFile(storePaths.auth, "utf8")).previous, true);
  assert.equal(JSON.parse(await readFile(storePaths.signer, "utf8")).previous, true);
  assert.ok(!calls.includes("Browser.close"));
}));

test("单独刷新设备登记须匹配现有账号，且不改动Cookie文件", async () => captureFixture(async ({ storePaths, options, cookie }) => {
  await saveJson(storePaths.auth, { cookies: [{ ...cookie, value: "existing-synthetic-cookie" }], previous: true });
  const before = await readFile(storePaths.auth, "utf8");
  await assert.rejects(captureChrome("fixture", { ...options, signerOnly: true, verify: async (auth) =>
    auth.previous ? 54321 : 12345 }), /本地登录账号不一致/);
  assert.equal(await readFile(storePaths.auth, "utf8"), before);
  const result = await captureChrome("fixture", { ...options, signerOnly: true });
  assert.equal(result.captured, true);
  assert.equal(await readFile(storePaths.auth, "utf8"), before);
}));
