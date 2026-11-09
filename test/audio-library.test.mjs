import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioLibrary, rankAudioItems } from "../lib/audio-library.mjs";

async function libraryTest(action) {
  const dir = await mkdtemp(join(tmpdir(), "xmly-audio-library-"));
  try { await action(new AudioLibrary(dir), dir); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
const audio = (content) => async ({ destination }) => writeFile(destination, content);
const rain = { id: "sfx:123", trackId: 123, kind: "sfx", title: "森林里的雨声", tags: ["雨声", "自然"], category: "6", duration: 30, ext: "mp3", source: "ximalaya-music" };

test("相同 ID 重复获取校验后直接复用，不调用网络", async () => libraryTest(async (library) => {
  let calls = 0;
  const download = async ({ destination }) => { calls++; await writeFile(destination, "rain-audio"); };
  const first = await library.acquire(rain, download);
  const second = await library.acquire({ id: rain.id, searchTerms: ["下雨"] }, download);
  assert.equal(calls, 1);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.item.title, rain.title);
  assert.equal(second.item.path, first.item.path);
  assert.deepEqual(second.item.searchTerms, ["下雨"]);
  assert.equal(second.item.useCount, 2);
  assert.equal((await stat(second.item.path)).mode & 0o777, 0o600);
}));

test("校验 SHA256，内容被同长度篡改后不复用损坏文件", async () => libraryTest(async (library) => {
  const first = await library.acquire(rain, audio("original"));
  await writeFile(first.item.path, "modified");
  assert.equal(await library.get(rain.id), null);
  assert.deepEqual(await library.search("雨声"), []);
  const next = await library.acquire(rain, audio("original"));
  assert.equal(next.reused, false);
  assert.equal(await readFile(next.item.path, "utf8"), "original");
  assert.equal((await library.list()).length, 1);
}));

test("损坏后按 ID 重获取保留用户用途和已知元数据，仅明确的新字段覆盖", async () => libraryTest(async (library) => {
  const first = await library.acquire({ ...rain, searchTerms: ["自然环境"] }, audio("original"));
  await library.tag(rain.id, ["睡前环境"]);
  await writeFile(first.item.path, "modified");
  const repaired = await library.acquire({ id: rain.id, duration: undefined, category: undefined }, audio("original"));
  assert.equal(repaired.reused, false);
  assert.equal(repaired.item.title, rain.title);
  assert.equal(repaired.item.duration, rain.duration);
  assert.equal(repaired.item.category, rain.category);
  assert.equal(repaired.item.kind, rain.kind);
  assert.equal(repaired.item.trackId, String(rain.trackId));
  assert.ok(repaired.item.tags.includes("睡前环境"));
  assert.deepEqual(repaired.item.searchTerms, ["自然环境"]);
  assert.equal((await library.search("睡前环境"))[0].id, rain.id);
  await writeFile(repaired.item.path, "modified");
  const refreshed = await library.acquire({ id: rain.id, category: "7", duration: 40, tags: ["新分类"] }, async ({ destination }) => {
    await writeFile(destination, "original");
    return { metadata: { duration: 42, title: "森林雨声（更新）", searchTerms: ["森林"] } };
  });
  assert.equal(refreshed.item.duration, 42);
  assert.equal(refreshed.item.category, "7");
  assert.equal(refreshed.item.title, "森林雨声（更新）");
  assert.ok(refreshed.item.tags.includes("睡前环境"));
  assert.ok(refreshed.item.tags.includes("新分类"));
  assert.deepEqual(refreshed.item.searchTerms, ["自然环境", "森林"]);
  assert.equal(refreshed.item.createdAt, first.item.createdAt);
  assert.equal(refreshed.item.useCount, 3);
}));

test("并发获取同一素材仅下载一次，独立实例也共享锁", async () => libraryTest(async (library, dir) => {
  let calls = 0;
  const download = async ({ destination }) => {
    calls++;
    await new Promise((r) => setTimeout(r, 90));
    await writeFile(destination, "concurrent-audio");
  };
  const result = await Promise.all([
    library.acquire(rain, download),
    new AudioLibrary(dir).acquire(rain, download),
  ]);
  assert.equal(calls, 1);
  assert.equal(result.filter((x) => x.reused).length, 1);
  assert.equal((await library.list()).length, 1);
}));

test("同名不同内容独立保存，相同内容不同 ID 只保存一份", async () => libraryTest(async (library) => {
  const first = await library.acquire(rain, audio("one"));
  const second = await library.acquire({ ...rain, id: "sfx:456" }, audio("two"));
  const third = await library.acquire({ ...rain, id: "sfx:789", ext: "wav" }, audio("one"));
  assert.notEqual(first.item.path, second.item.path);
  assert.equal(first.item.path, third.item.path);
  assert.equal(await readFile(first.item.path, "utf8"), "one");
  assert.equal(await readFile(second.item.path, "utf8"), "two");
  assert.equal((await library.list()).length, 3);
}));

test("下载失败或空文件不入库，锁释放后可重新获取", async () => libraryTest(async (library) => {
  await assert.rejects(library.acquire(rain, async ({ destination }) => {
    await writeFile(destination, "partial");
    throw new Error("断网");
  }), /断网/);
  assert.deepEqual(await library.list(), []);
  await assert.rejects(library.acquire(rain, audio("")), /非空/);
  assert.deepEqual(await library.list(), []);
  assert.equal((await library.acquire(rain, audio("complete"))).reused, false);
}));

test("中文同义词、全部有效词、类型分类时长过滤，拒绝笼统单字和历史误匹配", () => {
  const items = [rain,
    { ...rain, id: "sfx:456", title: "城市环境", tags: ["城市"], searchTerms: ["雨声"] },
    { ...rain, id: "music:789", title: "雨声", kind: "music" },
    { ...rain, id: "sfx:900", title: "下雨声", category: "7", duration: 5 },
  ];
  assert.equal(rankAudioItems(items, "森林 下雨")[0].id, rain.id);
  assert.equal(rankAudioItems(items, "下雨", { kind: "sfx", category: "6", minDuration: 10, maxDuration: 40 }).length, 1);
  assert.equal(rankAudioItems(items, "海浪").length, 0);
  assert.equal(rankAudioItems(items, "雨").length, 0);
  assert.equal(rankAudioItems(items, "安静的雨声").length, 0);
  assert.ok(!rankAudioItems(items, "雨声").some((x) => x.id === "sfx:456"));
  assert.ok(rankAudioItems(items, "雨声")[0].reason.every((x) => /匹配/.test(x)));
  assert.throws(() => rankAudioItems(items, "雨声", { minDuration: 50, maxDuration: 40 }), /最短/);
});

test("Unicode 归一化并保留英文词边界，避免 rain 匹配 train", () => {
  const items = [{ id: "a", title: "ＲＡＩＮ Sound", tags: [] }, { id: "b", title: "train station", tags: [] }];
  assert.deepEqual(rankAudioItems(items, "rain").map((x) => x.id), ["a"]);
});

test("导入本地音频并补标签可供后续检索，索引不接受下载URL或路径注入", async () => libraryTest(async (library, dir) => {
  const file = join(dir, "user.mp3");
  await writeFile(file, "user-audio");
  const imported = await library.importFile(file, { title: "配乐", kind: "music", tags: ["舒缓"] });
  assert.match(imported.item.id, /^local:[a-f0-9]{64}$/);
  await library.tag(imported.item.id, ["睡前", "舒缓"]);
  const found = await library.search("睡前 舒缓", { kind: "music" });
  assert.equal(found.length, 1);
  assert.equal(found[0].path, imported.item.path);
  await assert.rejects(library.acquire({ id: "../../escape", title: "bad" }, audio("a")), /ID/);
  await assert.rejects(library.acquire({ id: "safe", source: "https://example.com/?token=secret" }, audio("a")), /来源名称/);
  await library.acquire({ id: "safe", title: "风声", downloadUrl: "https://example.com/?token=secret" }, audio("wind"));
  assert.ok(!(await readFile(library.indexPath, "utf8")).includes("secret"));
  assert.equal((await library.acquire({ id: "intro:1", title: "片头", trackId: 1, kind: "intro" }, audio("intro"))).item.kind, "intro");
}));

test("下载回调可以补真实标题与扩展名，但不能更改素材身份", async () => libraryTest(async (library) => {
  const result = await library.acquire({ id: "music:3", trackId: 3, kind: "music" }, async ({ destination }) => {
    await writeFile(destination, "downloaded-m4a");
    return { extension: ".m4a", metadata: { title: "舒缓钢琴", tags: ["钢琴"], duration: 45, downloadUrl: "https://example.com/private" } };
  });
  assert.equal(result.item.title, "舒缓钢琴");
  assert.match(result.item.path, /\.m4a$/);
  assert.equal(result.item.downloadUrl, undefined);
  assert.equal(result.item.duration, 45);
  await assert.rejects(library.acquire({ id: "music:4", kind: "music", trackId: 4 }, async ({ destination }) => {
    await writeFile(destination, "evil");
    return { metadata: { id: "music:5" } };
  }), /不能修改/);
  assert.equal((await library.list()).length, 1);
}));

test("多个等待者不会自动移除旧锁，超时给出人工恢复所需信息", async () => libraryTest(async (library, dir) => {
  const lock = JSON.stringify({ pid: 2147483647, nonce: "orphan" });
  await writeFile(library.lockPath, lock);
  const waiters = [new AudioLibrary(dir, { lockTimeoutMs: 5 }), new AudioLibrary(dir, { lockTimeoutMs: 5 })];
  let calls = 0;
  const result = await Promise.allSettled(waiters.map((x) => x.acquire(rain, async () => { calls++; })));
  assert.ok(result.every((x) => x.status === "rejected" && /2147483647.*手动移除/.test(x.reason.message)));
  assert.equal(calls, 0);
  assert.equal(await readFile(library.lockPath, "utf8"), lock);
}));
