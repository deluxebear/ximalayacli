import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createCipheriv } from "node:crypto";
import {
  createDeviceId,
  encodeReport,
  decodeReport,
  createErrorSession,
  crc32,
  NativeSigner,
} from "../lib/signer.mjs";
const sha = (b) => createHash("sha256").update(b).digest("hex");
test("UTF-8压缩与AES-ECB匹配官网合成输入的实测摘要", () => {
  const body = encodeReport({ label: "中文测试", n: 1 });
  assert.equal(
    sha(body),
    "6e5c8a71bbcb19b004bc585b3547a47afaed3edb610cf7d4f7708140aa4f5010",
  );
});
test("网络错误会话的随机数、时间、CRC与AES-CBC匹配官网实测摘要", () => {
  const token = createErrorSession(
    { BG5: true, CY8: "present", Zn6: { oe2: 1 } },
    201,
    { now: () => 1794200000000, random: () => 0.25 },
  );
  assert.equal(
    sha(token),
    "d56bc89eebb6014f9fa0bf27c880c6ab5bccd4e850c3d63b55d4da8b406f0c73",
  );
  assert.ok(token.endsWith("_2"));
  assert.equal(crc32("123456789"), "cbf43926");
});
const state = {
  identity: { idd: "ABCDEF:123456:ABCDEF:0000" },
  browserId: "fixture-device-secret",
  accountUid: 1,
  dna: { HW5: "test" },
};
function encryptResponse(body) {
  const c = createCipheriv(
    "aes-128-ecb",
    Buffer.from("m9ZtRrz:qujT8@da"),
    null,
  );
  return Buffer.concat([c.update(JSON.stringify(body)), c.final()]).toString(
    "base64",
  );
}
test("真实会话服务正常响应时使用新sid，不重放已捕获会话", async () => {
  let calls = 0;
  const signer = new NativeSigner(state, {
    fetchImpl: async (url, opts) => {
      calls++;
      assert.match(url, /^https:\/\/hdaa.shuzilm.cn\/report\?/);
      assert.equal(opts.method, "POST");
      assert.ok(Buffer.isBuffer(opts.body));
      return new Response(encryptResponse({ sid: "fresh-service-session" }));
    },
  });
  const result = await signer.sign();
  assert.equal(calls, 1);
  assert.equal(result.sign, "fixture-device-secret&&fresh-service-session");
  assert.equal(result.meta.sessionSource, "report-service");
  assert.equal(result.meta.officialRuntimeLoaded, false);
});
test("只有服务不可用时才使用SDK网络错误协议，输出明确区分来源", async () => {
  const signer = new NativeSigner(state, {
    fetchImpl: async () => new Response("", { status: 503 }),
    now: () => 1794200000000,
    random: () => 0.25,
  });
  const result = await signer.sign();
  assert.equal(result.meta.sessionSource, "sdk-network-error");
  assert.equal(result.meta.errorCode, 201);
  assert.ok(result.sign.endsWith("_2"));
});
test("签名状态强制匹配登录账号", () =>
  assert.throws(() => new NativeSigner(state, { uid: 2 }), /账号不一致/));
test("发布只发送一次签名请求，返回内容不包含xm-sign值", async () => {
  let writes = 0;
  const signer = new NativeSigner(state, {
    fetchImpl: async () => new Response(encryptResponse({ sid: "session" })),
  });
  const body = { albumId: 1 };
  const client = {
    request: async (url, options) => {
      writes++;
      assert.equal(options.headers["xm-sign"], "fixture-device-secret&&session");
      assert.equal(options.body, body);
      return { ret: 0, data: { trackId: 2 } };
    },
  };
  const result = await signer.publish(client, body);
  assert.equal(writes, 1);
  assert.equal(result.data.trackId, 2);
  assert.ok(!JSON.stringify(result).includes("fixture-device-secret"));
});
test("会话服务更新设备登记时，本次沿用调用时ID，下次使用新ID", async () => {
  const localState = structuredClone(state);
  const signer = new NativeSigner(localState, {
    fetchImpl: async () =>
      new Response(
        encryptResponse({ sid: "fresh", cadd: "rotated-device", aid: "aid" }),
      ),
  });
  const a = await signer.sign(),
    b = await signer.sign();
  assert.equal(a.sign, "fixture-device-secret&&fresh");
  assert.equal(b.sign, "rotated-device&&fresh");
  assert.equal(localState.dna.Ud2, "rotated-device");
});
