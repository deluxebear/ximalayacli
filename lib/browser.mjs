import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { paths } from "./config.mjs";
const MARKER = "__XMLY_RESULT__";
export async function ego(script) {
  return new Promise((resolve, reject) => {
    const child = spawn("ego-browser", ["nodejs"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "",
      err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.on("error", () =>
      reject(
        new Error(
          "未找到 ego-browser；浏览器上传和签名需要安装并运行 Ego Lite",
        ),
      ),
    );
    child.on("close", (code) => {
      const line = (out + "\n" + err)
        .split("\n")
        .map((l) => l.slice(l.indexOf(MARKER)))
        .findLast((l) => l.startsWith(MARKER));
      if (line) {
        try {
          const result = JSON.parse(line.slice(MARKER.length));
          if (result.error) {
            const e = new Error(result.error);
            e.safeToRetry = result.safeToRetry;
            reject(e);
          } else resolve(result);
        } catch (e) {
          reject(e);
        }
        return;
      }
      reject(
        new Error(`浏览器任务失败（${code}）：${(err || out).slice(0, 600)}`),
      );
    });
    child.stdin.end(
      `try {\n${script}\n} catch(e) {console.log(${JSON.stringify(MARKER)}+JSON.stringify({error:e.message,safeToRetry:e.safeToRetry===true}));process.exitCode=1;}`,
    );
  });
}
const report = (expression) =>
  `console.log(${JSON.stringify(MARKER)}+JSON.stringify(${expression}));`;
export class BrowserSession {
  constructor({ profile = "default", spaceId, uid } = {}) {
    this.profile = profile;
    this.spaceId = spaceId;
    this.external = !!spaceId;
    this.uid = uid;
  }
  async open() {
    const auth = paths(this.profile).auth;
    const result = await ego(`
const task=await ${this.spaceId ? `taskSpace(${Number(this.spaceId)})` : `taskSpace(${JSON.stringify("喜马拉雅 CLI " + randomUUID())})`};
const page=task.page('p1');
try {
await page.goto('https://www.ximalaya.com/reform-upload/page/webCenter/upload');
if(new URL(await page.url()).hostname==='passport.ximalaya.com') throw new Error('浏览器会话未登录，请运行 xmly auth login');
await page.waitForFunction(()=>!!window.$webUploader,undefined,{timeout:30000});
const permission=await page.fetch('/reform-upload/upload/permission');
const info=JSON.parse(permission.body);
if(info.ret!==0 || !info.data?.currentUid) throw new Error('浏览器登录状态无效');
if(${JSON.stringify(this.uid || null)} && info.data.currentUid!==${JSON.stringify(this.uid || null)}) throw new Error('浏览器当前账号与所选 CLI profile 不一致，请重新捕获该账号登录凭据');
const {cookies}=await page.cdp('Network.getCookies',{urls:['https://studio.ximalaya.com/','https://www.ximalaya.com/','https://passport.ximalaya.com/']});
const fs=await import('node:fs/promises'),path=await import('node:path');await fs.mkdir(path.dirname(${JSON.stringify(auth)}),{recursive:true,mode:0o700});await fs.writeFile(${JSON.stringify(auth)},JSON.stringify({capturedAt:new Date().toISOString(),cookies}),{mode:0o600});await fs.chmod(${JSON.stringify(auth)},0o600);
${report("{spaceId:task.spaceId,uid:info.data.currentUid}")}
} catch(e) {${this.external ? "" : "await task.finish({keep:[]});"}throw e;}
`);
    this.spaceId = result.spaceId;
    return result;
  }
  async upload(file, { type = "audio", timeout = 600000 } = {}) {
    return ego(`
const task=await taskSpace(${Number(this.spaceId)}),page=task.page('p1');
await page.evaluate(()=>{window.$webUploader.reset();});
${type === "image" ? `await page.evaluate(()=>{window.$webUploader.option('uploadType','tingWebImage');window.$webUploader.option('accept',{title:'image',extensions:'jpg,jpeg,png,gif',mimeTypes:'.jpg,.jpeg,.png,.gif'});});` : ""}
try {await page.setInputFiles('input[type=file][accept*=".AIFF"]',[${JSON.stringify(file)}]);
await page.waitForFunction(()=>{const fs=window.$webUploader.getFiles();return fs.length && ['complete','error','invalid','cancelled'].includes(fs[0].getStatus());},undefined,{timeout:${Number(timeout)}});
const result=await page.evaluate(()=>{const f=window.$webUploader.getFiles()[0];if(!f||f.getStatus()!=='complete')return {error:'文件上传失败：'+(f?.statusText||f?.getStatus()||'文件未加入队列')};return f.mkfileResult;});
if(result.error||result.code!=='000000'||!result.data?.uploadId)throw new Error(result.error||result.message||'上传未返回 uploadId');
${report("({ok:true,uploadId:result.data.uploadId,fileExtName:result.data.fileExtName,storageId:result.data.storageId,duration:result.data.metaInfo?.duration,size:result.data.metaInfo?.size})")}
}catch(e){e.safeToRetry=true;throw e;}
`);
  }
  async publish(body) {
    return ego(`
const page=(await taskSpace(${Number(this.spaceId)})).page('p1');
const result=await page.evaluate(async body=>{
 const sign=await window._getDUH();
 if(!sign) return {error:'浏览器未生成发布签名',safeToRetry:true};
 const response=await fetch('/reform-upload/upload/create',{method:'POST',credentials:'include',headers:{'content-type':'application/json','xm-sign':sign},body:JSON.stringify(body)});
 if(!response.ok) return {error:'发布请求失败 HTTP '+response.status};
 const data=await response.json();
 if(data.ret!==0) return {error:'发布失败 '+data.ret+'：'+(data.msg||'未知错误'),safeToRetry:true};
 return {ok:true,...data};
},${JSON.stringify(body)});
${report("result")}
`);
  }
  async close() {
    if (this.spaceId && !this.external)
      await ego(
        `const task=await taskSpace(${Number(this.spaceId)});await task.finish({keep:[]});${report("{ok:true}")}`,
      );
  }
}
