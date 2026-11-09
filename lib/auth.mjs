import { paths, readJson } from "./config.mjs";
import { ego } from "./browser.mjs";
export async function login(profile) {
  const p = paths(profile);
  const result = await ego(`
const fs=await import('node:fs/promises'),path=await import('node:path');
const task=await taskSpace(${JSON.stringify("喜马拉雅 CLI 登录 " + profile)});
const page=task.page('p1');await page.goto('https://studio.ximalaya.com/upload');
await fs.mkdir(path.dirname(${JSON.stringify(p.auth)}),{recursive:true,mode:0o700});
await fs.writeFile(${JSON.stringify(p.auth + ".browser.json")},JSON.stringify({spaceId:task.spaceId}),{mode:0o600});
const screenshot=await page.screenshot({path:${JSON.stringify(p.auth + ".login.png")}});await fs.chmod(screenshot,0o600);
await task.handOff();
console.log('__XMLY_RESULT__'+JSON.stringify({spaceId:task.spaceId,screenshot}));
`);
  return {
    ok: true,
    message:
      "请在 Ego Lite 窗口扫码登录；看不到窗口时可打开 screenshot 图片。登录成功后运行 xmly auth capture",
    ...result,
  };
}
export async function capture(profile, spaceOverride) {
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
const {cookies}=await page.cdp('Network.getCookies',{urls:['https://studio.ximalaya.com/','https://www.ximalaya.com/','https://passport.ximalaya.com/']});
await fs.mkdir(path.dirname(${JSON.stringify(p.auth)}),{recursive:true,mode:0o700});
await fs.writeFile(${JSON.stringify(p.auth)},JSON.stringify({capturedAt:new Date().toISOString(),cookies}),{mode:0o600});await fs.chmod(${JSON.stringify(p.auth)},0o600);
await task.finish({keep:[]});
console.log('__XMLY_RESULT__'+JSON.stringify({ok:true}));
`);
  return status(profile);
}
export async function status(profile) {
  const p = paths(profile),
    auth = await readJson(p.auth, { cookies: [] });
  const active = auth.cookies.filter(
    (c) => !c.expires || c.expires < 0 || c.expires > Date.now() / 1000,
  );
  return {
    ok: active.length > 0,
    path: p.auth,
    capturedAt: auth.capturedAt,
    cookieCount: active.length,
    domains: [...new Set(active.map((c) => c.domain))],
  };
}
