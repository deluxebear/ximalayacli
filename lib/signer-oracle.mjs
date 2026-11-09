import { createHash } from "node:crypto";
import { ego } from "./browser.mjs";
import { createDeviceId, encodeReport, createErrorSession } from "./signer.mjs";
export async function compareSigner(signer, spaceId) {
  if (!Number.isSafeInteger(Number(spaceId)) || Number(spaceId) <= 0)
    throw new Error("原厂只读对照需要 --space-id 指定正在研究的上传页");
  const oracle = await ego(`
const page=(await taskSpace(${Number(spaceId)})).page('p1');
const result=await page.evaluate(async()=>{
 const sdk=window.du_web_sdk;if(!sdk)throw new Error('当前页没有官网 SDK');
 const identity=await new Promise(r=>sdk._idStorage.getValue((source,value)=>r(value)));
 const report=Array.from(new Uint8Array(sdk._serverAccess._getProcessData({label:'中文测试',n:1},sdk._serverAccess.getEncryptKey(0))));
 const oldRandom=Math.random,oldTime=Date.prototype.getTime;let promise;
 try{Math.random=()=>.25;Date.prototype.getTime=()=>1794200000000;promise=sdk._serverAccess.generateRandomString({BG5:true,CY8:'present',Zn6:{oe2:1}},201);}finally{Math.random=oldRandom;Date.prototype.getTime=oldTime;}
 return {deviceId:identity.dcd,identity:identity.idd,report,session:await promise};
});console.log('__XMLY_RESULT__'+JSON.stringify(result));
`);
  const checks = {
    deviceId: createDeviceId(oracle.identity) === oracle.deviceId,
    report: encodeReport({ label: "中文测试", n: 1 }).equals(
      Buffer.from(oracle.report),
    ),
    networkErrorSession:
      createErrorSession({ BG5: true, CY8: "present", Zn6: { oe2: 1 } }, 201, {
        now: () => 1794200000000,
        random: () => 0.25,
      }) === oracle.session,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    submitted: false,
    algorithm: {
      runtime: "native",
      officialRuntimeRequired: false,
      comparison: "byte-for-byte",
    },
    checks,
    reportSha256: createHash("sha256")
      .update(Buffer.from(oracle.report))
      .digest("hex"),
    sessionFixtureSha256: createHash("sha256")
      .update(oracle.session)
      .digest("hex"),
  };
}
