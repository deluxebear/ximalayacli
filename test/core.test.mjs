import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "../lib/client.mjs";
import { runBatch, loadManifest } from "../lib/batch.mjs";
import { redact } from "../lib/config.mjs";
test("cookie 限定域、路径、有效期和 HTTPS", () => {
  const c = new Client({
    cookies: [
      {
        name: "a",
        value: "1",
        domain: ".ximalaya.com",
        path: "/",
        secure: true,
      },
      { name: "b", value: "2", domain: "studio.ximalaya.com", path: "/upload" },
      { name: "c", value: "3", domain: ".ximalaya.com", expires: 1 },
    ],
  });
  assert.equal(c.cookie("https://studio.ximalaya.com/uploading"), "a=1");
  assert.equal(c.cookie("https://evilximalaya.com/"), "");
  assert.equal(c.cookie("http://www.ximalaya.com/"), "");
});
test("有副作用的请求不自动重试", async () => {
  let count = 0;
  const c = new Client(
    {},
    {
      fetchImpl: async () => {
        count++;
        return new Response("", { status: 503 });
      },
    },
  );
  await assert.rejects(c.request("/test", { method: "POST", body: {} }));
  assert.equal(count, 1);
});
test("不跟随登录重定向且不向其他域发送认证", async () => {
  const c = new Client(
    {},
    { fetchImpl: async () => new Response("", { status: 302 }) },
  );
  await assert.rejects(c.request("/test"), /会话失效/);
  await assert.rejects(c.request("https://example.com/"), /仅允许/);
});
test("批量断点续传跳过已完成项，结果不确定时阻止重传", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xmly-test-"));
  try {
    let count = 0;
    const execute = async (x) => {
      count++;
      if (x.id === "b") throw new Error("connection lost");
      return { id: 1 };
    };
    const args = { journal: join(dir, "jobs.json"), execute };
    const items = [
      { id: "a", file: "a" },
      { id: "b", file: "b" },
    ];
    await runBatch(items, args);
    const result = await runBatch(items, { ...args, retryFailed: true });
    assert.equal(count, 2);
    assert.deepEqual(
      result.items.map((x) => x.status),
      ["skipped", "needs-review"],
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("清单相对路径按清单目录解析，内容改变会改变任务指纹", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xmly-manifest-"));
  try {
    await writeFile(join(dir, "a.mp3"), "abc");
    await writeFile(
      join(dir, "batch.json"),
      JSON.stringify({
        defaults: { title: "第一集" },
        items: [{ file: "a.mp3" }],
      }),
    );
    const [a] = await loadManifest(join(dir, "batch.json"));
    await writeFile(join(dir, "a.mp3"), "def");
    const [b] = await loadManifest(join(dir, "batch.json"));
    assert.equal(a.file, join(dir, "a.mp3"));
    assert.notEqual(a.id, b.id);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("敏感字段递归脱敏", () =>
  assert.deepEqual(redact({ nested: { access_token: "secret" } }), {
    nested: { access_token: "[REDACTED]" },
  }));
test("签名链接脱敏且 Cookie 数量仍可显示", () => {
  const r = redact({
    cookieCount: 14,
    url: "https://example.com/a?token=secret&name=file",
  });
  assert.equal(r.cookieCount, 14);
  assert.ok(!r.url.includes("secret"));
  assert.ok(r.url.includes("name=file"));
});
test("人工核对后可以解锁结果不确定项", async () => {
  const { resolveJob } = await import("../lib/batch.mjs");
  const dir = await mkdtemp(join(tmpdir(), "xmly-resolve-"));
  try {
    const id = "a".repeat(64),
      journal = join(dir, "jobs.json");
    await runBatch([{ id }], {
      journal,
      execute: async () => {
        throw new Error("lost");
      },
    });
    await resolveJob(journal, id, { retry: true });
    let calls = 0;
    const result = await runBatch([{ id }], {
      journal,
      retryFailed: true,
      execute: async () => {
        calls++;
        return { trackId: 9 };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.items[0].status, "done");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
