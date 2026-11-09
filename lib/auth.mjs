import { paths, readJson, saveJson } from "./config.mjs";
import { ego } from "./browser.mjs";
import { BOOTSTRAP_PAGE } from "./signer-bootstrap.mjs";
import { Client } from "./client.mjs";
import { launchChrome, connectChrome, ChromeLoginPage } from "./chrome.mjs";

export async function login(profile, {
  chromePath, noWait = false, timeoutMs = 300000, onProgress = () => {},
  launch = launchChrome, connect = connectChrome,
  openPage = (connection, options) => ChromeLoginPage.open(connection, options),
  captureLogin = captureChrome,
} = {}) {
  const launched = await launch(profile, { chromePath });
  const connection = await connect(profile);
  try {
    await openPage(connection, { navigate: launched.reused });
  } finally { connection.close(); }
  onProgress(noWait ? "已打开本机 Chrome，请用喜马拉雅 APP 扫码，完成后运行 xmly auth capture。" :
    "已打开本机 Chrome，请用喜马拉雅 APP 扫码；登录完成后会自动保存凭据。");
  if (noWait) return { ok: true, browser: "chrome", status: "waiting-login",
    userDataDir: launched.userDataDir,
    message: "请在 Chrome 中完成扫码，然后运行 xmly auth capture 保存凭据" };
  return captureLogin(profile, { timeoutMs, onProgress });
}

export async function captureChrome(profile, {
  timeoutMs = 30000, pollMs = 1000, onProgress = () => {},
  connect = connectChrome, openPage = (connection) => ChromeLoginPage.open(connection),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now,
  verify = async (auth) => (await new Client(auth).request(
    "https://www.ximalaya.com/reform-upload/upload/permission")).data?.currentUid,
  signerOnly = false, storePaths,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error("登录等待超时必须是正整数毫秒数");
  const p = storePaths || paths(profile), connection = await connect(profile);
  try {
    const page = await openPage(connection), until = now() + timeoutMs;
    while (now() < until) {
      let ready = false;
      try { ready = await page.ready(); }
      catch { if (connection.socket?.readyState !== undefined && connection.socket.readyState !== 1)
        throw new Error("Chrome 登录窗口已关闭，请重新运行 xmly auth login"); }
      if (ready) {
        onProgress("已检测到登录页面就绪，正在验证并保存凭据。");
        const state = await page.evaluate(`(${BOOTSTRAP_PAGE})()`);
        const cookies = await page.cookies();
        if (!state?.identity?.idd || !state?.browserId || !state?.dna || !state?.accountUid ||
            !Array.isArray(cookies) || !cookies.some((x) => x.name === "1&_token" && x.value))
          throw new Error("Chrome 登录状态不完整，未覆盖原凭据，请重新登录后再捕获");
        const auth = { capturedAt: new Date().toISOString(), source: "chrome", cookies };
        const uid = await verify(auth);
        if (!uid || String(uid) !== String(state.accountUid))
          throw new Error("Cookie 与设备登记账号不一致，未覆盖原凭据，请重新登录");
        if (signerOnly) {
          const existing = await readJson(p.auth);
          if (String(await verify(existing)) !== String(uid))
            throw new Error("Chrome 当前账号与本地登录账号不一致，请运行 xmly auth login 重新保存完整登录状态");
        }
        await saveJson(p.signer, state);
        if (!signerOnly) await saveJson(p.auth, auth);
        // 专用配置目录下仅用于 CLI 登录的 Chrome；不触碰日常浏览器进程。
        try { await connection.command("Browser.close"); } catch {}
        return { ...(await statusAt(p)), browser: "chrome", captured: true };
      }
      await sleep(Math.min(pollMs, Math.max(1, until - now())));
    }
    throw new Error("等待 Chrome 登录超时，原凭据未变。请在仍打开的 Chrome 窗口中完成登录，再运行 xmly auth capture");
  } finally { connection.close(); }
}

// 兼容显式传入 Ego space-id 的旧用法；默认登录/捕获均使用系统 Chrome。
export async function capture(profile, spaceOverride, options) {
  return spaceOverride ? captureEgo(profile, spaceOverride) : captureChrome(profile, options);
}

async function captureEgo(profile, spaceOverride) {
  const p = paths(profile);
  const state = spaceOverride
    ? { spaceId: Number(spaceOverride) }
    : await readJson(p.auth + ".browser.json");
  if (!Number.isSafeInteger(state.spaceId) || state.spaceId <= 0)
    throw new Error("无效浏览器空间 ID");
  await ego(`
const fs=await import('node:fs/promises'),path=await import('node:path');
const task=await takeOverTaskSpace(${JSON.stringify(state.spaceId)});const page=task.page('p1');
const host=new URL(await page.url()).hostname;
if (!(host==='ximalaya.com'||host.endsWith('.ximalaya.com'))||host==='passport.ximalaya.com') {await task.handOff();throw new Error('请先完成登录');}
await page.goto('https://www.ximalaya.com/reform-upload/page/webCenter/upload');
await page.waitForFunction(()=>typeof window._getDUH==='function',undefined,{timeout:30000});
const deviceState=await page.evaluate(${BOOTSTRAP_PAGE});
const {cookies}=await page.cdp('Network.getCookies',{urls:['https://studio.ximalaya.com/','https://www.ximalaya.com/','https://passport.ximalaya.com/']});
await fs.mkdir(path.dirname(${JSON.stringify(p.auth)}),{recursive:true,mode:0o700});
await fs.writeFile(${JSON.stringify(p.auth)},JSON.stringify({capturedAt:new Date().toISOString(),cookies}),{mode:0o600});await fs.chmod(${JSON.stringify(p.auth)},0o600);
await fs.writeFile(${JSON.stringify(p.signer)},JSON.stringify(deviceState),{mode:0o600});await fs.chmod(${JSON.stringify(p.signer)},0o600);
await task.finish({keep:[]});
console.log('__XMLY_RESULT__'+JSON.stringify({ok:true}));
`);
  return status(profile);
}
export async function status(profile) {
  return statusAt(paths(profile));
}
async function statusAt(p) {
  const auth = await readJson(p.auth, { cookies: [] });
  const active = auth.cookies.filter(
    (c) => !c.expires || c.expires < 0 || c.expires > Date.now() / 1000,
  );
  return {
    ok: active.length > 0,
    path: p.auth,
    capturedAt: auth.capturedAt,
    cookieCount: active.length,
    signerReady: !!(await readJson(p.signer, null)),
    domains: [...new Set(active.map((c) => c.domain))],
  };
}

export async function captureSigner(profile, spaceId, options) {
  if (!spaceId) return captureChrome(profile, { ...options, signerOnly: true });
  if (!Number.isSafeInteger(Number(spaceId)) || Number(spaceId) <= 0)
    throw new Error("需要 --space-id 指定已登录的浏览器空间");
  const p = paths(profile);
  return ego(`
const task=await takeOverTaskSpace(${Number(spaceId)}),page=task.page('p1');
await page.goto('https://www.ximalaya.com/reform-upload/page/webCenter/upload');
await page.waitForFunction(()=>typeof window._getDUH==='function',undefined,{timeout:30000});
const state=await page.evaluate(${BOOTSTRAP_PAGE});
const fs=await import('node:fs/promises'),path=await import('node:path');await fs.mkdir(path.dirname(${JSON.stringify(p.signer)}),{recursive:true,mode:0o700});await fs.writeFile(${JSON.stringify(p.signer)},JSON.stringify(state),{mode:0o600});await fs.chmod(${JSON.stringify(p.signer)},0o600);
await task.handOff();
console.log('__XMLY_RESULT__'+JSON.stringify({ok:true,capturedAt:state.capturedAt,deviceIdLength:state.browserId.length}));
`);
}
