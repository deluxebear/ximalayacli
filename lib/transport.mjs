import { NativeUploader } from "./upload.mjs";
import { NativeSigner } from "./signer.mjs";
export async function createSession({
  client,
  uid,
  profile = "default",
  transport = "native",
  publish = false,
  spaceId,
  retries = 3,
} = {}) {
  if (!["native", "browser"].includes(transport))
    throw new Error("--transport 支持 native/browser");
  if (transport === "browser") {
    const { BrowserSession } = await import("./browser.mjs");
    const browser = new BrowserSession({ profile, uid, spaceId });
    await browser.open();
    return browser;
  }
  if (spaceId) throw new Error("--space-id 仅用于 --transport browser");
  // 在开始传输之前检查发布所需的设备状态，避免缺少状态时先上传大文件。
  const signer = publish
    ? await NativeSigner.fromProfile(profile, { uid })
    : null;
  const uploader = new NativeUploader({ client, uid, retries });
  return {
    upload: (file, options) => uploader.upload(file, options),
    publish: (body) => {
      if (!signer) throw new Error("当前会话未初始化发布签名");
      return signer.publish(client, body);
    },
    close: async () => {},
  };
}
