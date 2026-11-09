import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  canonicalUploadQuery,
  signUploadRequest,
} from "../lib/upload-sign.mjs";
import { NativeUploader, validateUploadOrigin } from "../lib/upload.mjs";

// These deterministic vectors were compared to the unmodified sign factory
// extracted from the distributed uploader SDK, with Date.now held constant.
test("本地上传签名与原厂 query/body oracle 样本一致", () => {
  const input = {
    fileName: "第一章.mp3",
    serverIp: "127.0.0.1",
    timestamp: 1700000000123,
  };
  assert.equal(
    signUploadRequest({
      ...input,
      query: { uid: 123, Name: "第一章.mp3", chunk: 0, multipartId: "" },
    })["x-xfm-signature"],
    "g7iAspY9UtNrK1qhC1JLWtmgsv3BztKoEJxr37dj6Zo=",
  );
  assert.equal(
    signUploadRequest({
      ...input,
      body: { uid: 123, ctxList: ["ctx-a", "ctx-b"], fileName: "%E7%AC%AC" },
    })["x-xfm-signature"],
    "U5dqurR4WlAwYMHD47UT7naID+Uh9olrUR4+o1SA1rY=",
  );
  assert.equal(
    canonicalUploadQuery({ Z: "空 格", A: 0, multipartId: "" }),
    "a=0&multipartid=&z=空 格",
  );
});

test("上传域名拒绝外部主机、降级、userinfo 及其他 URL 组件", () => {
  assert.equal(
    validateUploadOrigin("https://cupload.ximalaya.com"),
    "https://cupload.ximalaya.com",
  );
  assert.equal(
    validateUploadOrigin("https://cupload.tx.ximalaya.com/"),
    "https://cupload.tx.ximalaya.com",
  );
  for (const url of [
    "http://cupload.ximalaya.com",
    "https://cupload.ximalaya.com.evil.test",
    "https://evil.test",
    "https://name:password@cupload.ximalaya.com/",
    "https://cupload.ximalaya.com:444/",
    "https://cupload.ximalaya.com/path",
    "https://cupload.ximalaya.com/?redirect=x",
  ])
    assert.throws(() => validateUploadOrigin(url), /上传域名/);
});

const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
async function withFile(run, content = Buffer.from("abcdefghij")) {
  const dir = await mkdtemp(join(tmpdir(), "xmly-upload-"));
  try {
    const file = join(dir, "第一章.wav");
    await writeFile(file, content);
    await run(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("本地分片维持 multipartId 和 ctx 顺序，首块携带全文件 MD5", async () => {
  const content = Buffer.concat([
    Buffer.alloc(1048576, 1),
    Buffer.alloc(1048576, 2),
    Buffer.alloc(10, 3),
  ]);
  await withFile(async (file) => {
    const chunks = [],
      calls = [];
    let merged;
    const uploader = new NativeUploader({
      client: { cookie: () => "session=fixture" },
      uid: 123,
      chunkSize: 1048576,
      retries: 0,
      fetchImpl: async (raw, options) => {
        const u = new URL(raw);
        calls.push(u.pathname);
        assert.equal(options.redirect, "manual");
        if (u.pathname === "/clamper-token/token") {
          const form = new URLSearchParams(options.body);
          assert.equal(form.get("fileName"), "第一章.wav");
          assert.equal(form.get("fileSize"), String(content.length));
          assert.equal(form.get("callerType"), "tingWeb");
          return json({
            ret: 0,
            token: "fixture-token",
            newTx: true,
            uploadDomain: "http://cupload.ximalaya.com",
          });
        }
        assert.equal(options.headers.Authorization, "fixture-token");
        if (u.pathname === "/upload/file/blk") {
          const n = chunks.length;
          assert.equal(u.searchParams.get("chunk"), String(n));
          assert.equal(u.searchParams.get("chunks"), "3");
          assert.equal(
            u.searchParams.get("multipartId"),
            n === 0 ? "" : "multipart",
          );
          assert.equal(
            u.searchParams.get("md5"),
            n === 0 ? createHash("md5").update(content).digest("hex") : "",
          );
          const expected = signUploadRequest({
            fileName: "第一章.wav",
            query: Object.fromEntries(u.searchParams),
            serverIp: n === 0 ? "" : "127.0.0.2",
            timestamp: Number(options.headers["x-xfm-timestamp"]),
          });
          assert.equal(
            options.headers["x-xfm-signature"],
            expected["x-xfm-signature"],
          );
          chunks.push(Buffer.from(options.body));
          return json({
            code: "000000",
            data: {
              ctx: "ctx-" + n,
              multipartId: "multipart",
              serverIp: "127.0.0.2",
            },
          });
        }
        if (u.pathname === "/upload/merge/mkfile") {
          merged = JSON.parse(options.body);
          assert.deepEqual(merged.ctxList, ["ctx-0", "ctx-1", "ctx-2"]);
          assert.equal(merged.multipartId, "multipart");
          assert.equal(merged.fileName, encodeURIComponent("第一章.wav"));
          const expected = signUploadRequest({
            fileName: "第一章.wav",
            body: merged,
            serverIp: "127.0.0.2",
            timestamp: Number(options.headers["x-xfm-timestamp"]),
          });
          assert.equal(
            options.headers["x-xfm-signature"],
            expected["x-xfm-signature"],
          );
          return json({
            code: "000000",
            data: {
              uploadId: 9,
              storageId: "storage/file.wav",
              fileExtName: "wav",
              metaInfo: { duration: 3, size: 10 },
            },
          });
        }
        throw new Error("unexpected path");
      },
    });
    const result = await uploader.upload(file);
    assert.equal(result.uploadId, 9);
    assert.equal(result.transport, "native");
    assert.deepEqual(
      chunks.map((c) => c.length),
      [1048576, 1048576, 10],
    );
    assert.deepEqual(
      chunks.map((c) => c[0]),
      [1, 2, 3],
    );
    assert.equal(calls.length, 5);
  }, content);
});

test("合并响应丢失时查询原签名，不重复提交合并", async () => {
  await withFile(async (file) => {
    let merges = 0,
      polls = 0,
      signature;
    const uploader = new NativeUploader({
      client: { cookie: () => "" },
      uid: 1,
      pollInterval: 0,
      retries: 0,
      fetchImpl: async (raw, options) => {
        const u = new URL(raw);
        if (u.pathname === "/clamper-token/token")
          return json({ ret: 0, token: "fixture-token", newTx: false });
        if (u.pathname === "/upload/file/blk")
          return json({
            code: "000000",
            data: { ctx: "ctx", multipartId: "m" },
          });
        if (u.pathname === "/upload/merge/mkfile") {
          merges++;
          signature = options.headers["x-xfm-signature"];
          throw new Error("response lost");
        }
        if (u.pathname === "/upload/merge/status") {
          polls++;
          assert.equal(options.method, "GET");
          assert.equal(u.searchParams.get("statusKey"), signature);
          return polls === 1
            ? json({ code: "100016" })
            : json({
                code: "000000",
                data: {
                  uploadId: 3,
                  fileExtName: "wav",
                  metaInfo: { size: 10 },
                },
              });
        }
      },
    });
    assert.equal((await uploader.upload(file)).uploadId, 3);
    assert.equal(merges, 1);
    assert.equal(polls, 2);
  });
});

test("令牌响应不能将认证材料重定向到外部域", async () => {
  await withFile(async (file) => {
    let calls = 0;
    const uploader = new NativeUploader({
      client: { cookie: () => "" },
      uid: 1,
      fetchImpl: async () => {
        calls++;
        return json({
          ret: 0,
          token: "do-not-leak",
          newTx: true,
          uploadDomain: "https://evil.test",
        });
      },
    });
    await assert.rejects(uploader.upload(file), /不受信任/);
    assert.equal(calls, 1);
  });
});

test("将分片配置限制在官网采用的至少 1 MiB 范围", () => {
  assert.throws(
    () =>
      new NativeUploader({
        client: { cookie: () => "" },
        uid: 1,
        chunkSize: 128 * 1024,
      }),
    /1 MiB/,
  );
});
