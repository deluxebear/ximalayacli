// 仅首次登录/显式刷新设备登记时在用户的已登录网页中执行。
// 普通上传和发布不导入或执行官方 SDK。
export const BOOTSTRAP_PAGE = `async()=>{
 const sdk=window.du_web_sdk;
 if(!sdk||typeof window._getDUH!=='function')throw new Error('当前页没有签名 SDK');
 const original=sdk._serverAccess.uploadUPDATASession;let dna;
 sdk._serverAccess.uploadUPDATASession=function(type,body,cb){dna=JSON.parse(JSON.stringify(body));return original.call(this,type,body,cb);};
 let sign;try{sign=await window._getDUH();}finally{sdk._serverAccess.uploadUPDATASession=original;}
 const identity=await new Promise(resolve=>sdk._idStorage.getValue((source,value)=>resolve(value)));
 const permission=await fetch('/reform-upload/upload/permission',{credentials:'include'}).then(r=>r.json());
 const browserId=sign?.split('&&')[0];
 if(!dna||!identity?.idd||!browserId||browserId==='null'||!permission.data?.currentUid)throw new Error('设备登记初始化不完整');
 return {schemaVersion:1,accountUid:permission.data.currentUid,capturedAt:new Date().toISOString(),identity,browserId,dna};
}`;
