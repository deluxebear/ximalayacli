import { createCipheriv, createDecipheriv, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { paths, readJson, saveJson } from "./config.mjs";
export const APP_KEY = "t6pfoml9679z52kqw93uqu75eflqdg1bykhl";
const REPORT_KEY = Buffer.from("m9ZtRrz:qujT8@da");
const ERROR_KEY = Buffer.from("y3hbnr8d4s2ztjbca1wgxk6mqktf9pxr").subarray(
  0,
  16,
);
export function createDeviceId(identity, apiKey = APP_KEY) {
  if (typeof identity !== "string" || !identity)
    throw new Error("缺少设备登记 identity");
  const key = Buffer.from(apiKey);
  const cipher = createCipheriv(
    "des-ede3-cbc",
    key.subarray(0, 24),
    key.subarray(0, 8),
  );
  let text = Buffer.concat([
    cipher.update(identity, "utf8"),
    cipher.final(),
  ]).toString("base64");
  text = text.slice(0, -1) + "X";
  const sum =
    [...text.replaceAll(":", "")].reduce((s, c) => s + c.charCodeAt(0), 0) %
    256;
  return "D2" + text + sum.toString(16).padStart(2, "0");
}
export function encodeReport(body) {
  const bytes = deflateSync(Buffer.from(JSON.stringify(body)), { level: 6 });
  const cipher = createCipheriv("aes-128-ecb", REPORT_KEY, null);
  return Buffer.concat([cipher.update(bytes), cipher.final()]);
}
export function decodeReport(text) {
  const cipher = createDecipheriv("aes-128-ecb", REPORT_KEY, null);
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(text.trim(), "base64")),
      cipher.final(),
    ]).toString("utf8"),
  );
}
export function crc32(text) {
  let crc = -1;
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i);
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return ((crc ^ -1) >>> 0).toString(16).padStart(8, "0");
}
export function createErrorSession(
  dna,
  code,
  { now = Date.now, random = Math.random } = {},
) {
  if (![201, 202].includes(code))
    throw new Error("仅支持 SDK 定义的网络错误码 201/202");
  const hex = "xxxxxxxx".replace(/x/g, () =>
    ((16 * random()) | 0).toString(16),
  );
  const randomPart = random().toString(36).substring(2, 6);
  let time = now(),
    timestamp = "";
  const alphabet =
    "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  do {
    timestamp = alphabet[time % 62] + timestamp;
    time = Math.floor(time / 62);
  } while (time > 0);
  timestamp = timestamp.padStart(8, "0");
  let bits = "00000".split("");
  if (dna.BG5 === true) bits[4] = "1";
  if (dna.CY8 != null && dna.CY8 !== "") bits[3] = "1";
  if (dna.Zn6?.oe2 != null && dna.Zn6.oe2 !== 0) bits[1] = "1";
  const flags = parseInt(bits.join(""), 2).toString(32);
  const prefix = hex + randomPart + timestamp + flags + code;
  const text = prefix + crc32(prefix),
    cipher = createCipheriv("aes-128-cbc", ERROR_KEY, ERROR_KEY);
  return (
    Buffer.concat([cipher.update(text, "utf8"), cipher.final()]).toString(
      "base64url",
    ) + "_2"
  );
}

export class NativeSigner {
  constructor(
    state,
    {
      fetchImpl = fetch,
      timeout = 450,
      now = Date.now,
      random = Math.random,
      uid,
    } = {},
  ) {
    if (!state?.dna || !state?.browserId || !state?.identity?.idd)
      throw new Error(
        "缺少设备登记状态，请先运行 xmly auth capture 完成一次登录初始化",
      );
    if (uid && state.accountUid && uid !== state.accountUid)
      throw new Error("签名设备登记与当前账号不一致，请重新捕获登录状态");
    this.state = state;
    this.deviceId =
      state.browserId === state.identity.dcd
        ? createDeviceId(state.identity.idd)
        : state.browserId;
    this.deviceIdSource =
      state.browserId === state.identity.dcd
        ? "local-3des"
        : "registered-device";
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.now = now;
    this.random = random;
  }
  static async fromProfile(profile, options) {
    const p = paths(profile);
    const signer = new NativeSigner(await readJson(p.signer), options);
    signer.statePath = p.signer;
    return signer;
  }
  status() {
    return {
      ok: true,
      runtime: "native",
      officialRuntimeLoaded: false,
      capturedAt: this.state.capturedAt,
      deviceIdLength: this.deviceId.length,
      deviceIdSource: this.deviceIdSource,
      deviceIdMatchesLocal:
        createDeviceId(this.state.identity.idd) === this.state.browserId,
    };
  }
  async sign() {
    const deviceId = this.deviceId,
      deviceIdSource = this.deviceIdSource;
    const dna = structuredClone(this.state.dna);
    // 设备登记沿用首次登录时的实测信息；只刷新 SDK 定义的请求标识。
    dna.GJ2 = randomUUID() + "-fcs011";
    let session,
      errorCode = 201,
      source,
      reason;
    try {
      const response = await this.fetch(
        "https://hdaa.shuzilm.cn/report?v=1.2.0&e=1&c=1&r=" + randomUUID(),
        {
          method: "POST",
          body: encodeReport(dna),
          redirect: "error",
          signal: AbortSignal.timeout(this.timeout),
        },
      );
      if (!response.ok) throw new Error("report-http-" + response.status);
      const text = await response.text();
      if (text.length > 65536) throw new Error("report-response-too-large");
      const parsed = decodeReport(text);
      session = parsed?.sid;
      if (typeof session !== "string" || !session || session.length > 4096)
        throw new Error("report-missing-session");
      source = "report-service";
      if (
        typeof parsed.cadd === "string" &&
        parsed.cadd &&
        parsed.cadd.length <= 4096
      ) {
        this.state.browserId = parsed.cadd;
        this.deviceId = parsed.cadd;
        this.deviceIdSource = "registered-device";
        Object.assign(this.state.dna, {
          pX4: parsed.aid,
          Ud2: parsed.cadd,
          Cb7: parsed.bid,
          Gp5: parsed.cbdd,
        });
        this.state.updatedAt = new Date(this.now()).toISOString();
        if (this.statePath)
          await saveJson(this.statePath, this.state).catch(() => {});
      }
    } catch (e) {
      errorCode =
        e.name === "TimeoutError" || e.name === "AbortError" ? 202 : 201;
      reason =
        e.name === "TimeoutError" ? "report-timeout" : "report-unavailable";
      session = createErrorSession(dna, errorCode, {
        now: this.now,
        random: this.random,
      });
      source = "sdk-network-error";
    }
    return {
      sign: deviceId + "&&" + session,
      meta: {
        runtime: "native",
        officialRuntimeLoaded: false,
        deviceIdLength: deviceId.length,
        deviceIdSource,
        sessionIdLength: session.length,
        sessionSource: source,
        ...(reason ? { reason, errorCode } : {}),
      },
    };
  }
  async publish(client, body) {
    const { sign, meta } = await this.sign();
    const result = await client.request(
      "https://www.ximalaya.com/reform-upload/upload/create",
      {
        method: "POST",
        body,
        headers: {
          "xm-sign": sign,
          origin: "https://www.ximalaya.com",
          referer:
            "https://www.ximalaya.com/reform-upload/page/webCenter/upload",
        },
      },
    );
    return { ok: true, ...result, signer: meta };
  }
}
