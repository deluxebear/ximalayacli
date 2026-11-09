import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CvClient } from "../lib/cv.mjs";
import { obtainCvAudio } from "../lib/cv-local.mjs";
import { runCvCommand } from "../lib/cv-cli.mjs";
import { AudioLibrary } from "../lib/audio-library.mjs";

const raw = { id: "cv-490", cvInfoId: 490, name: "测试主播", description: "古言旁白",
  contact: "不输出", skills: ["recording_dialogue"],
  voiceSamples: [{ id: "1295", title: "古言对白", duration: 37.536, url: "http://aod.cos.tx.xmcdn.com/sample.m4a" }] };
const response = (list = [raw], pageCount = 1) => ({ code: 200000, data: { list, totalCount: list.length, pageCount } });
async function workspace(action) {
  const dir = await mkdtemp(join(tmpdir(), "xmly-cv-test-"));
  try { await action(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("CV搜索使用官网POST参数和来源；输出与磁盘记录不含地址或联系方式", async () => workspace(async (dir) => {
  const remote = new CvClient({ request: async (url, options) => {
    assert.equal(new URL(url).pathname, "/voice-studio-account/account/cv-market-store/wall/list");
    assert.equal(options.method, "POST"); assert.equal(options.retry, true);
    assert.equal(options.headers.origin, "https://aigc.ximalaya.com");
    assert.deepEqual(options.body, { keyword: "古言", pageNum: 2, pageSize: 10 });
    return response();
  } }, dir);
  const result = await remote.search({ keyword: "古言", page: 2, pageSize: 10 });
  assert.equal(result.items[0].samples[0].libraryId, "cv:490:1295");
  assert.equal(result.items[0].samples[0].duration, 37.536);
  assert.doesNotMatch(JSON.stringify(result), /xmcdn|不输出/);
  assert.doesNotMatch(await readFile(remote.catalogPath(490), "utf8"), /xmcdn|不输出/);
  for (const options of [{ page: 0 }, { page: 1.5 }, { pageSize: 101 }])
    await assert.rejects(remote.search(options), /整数/);
}));

test("按主播ID查找支持分页和重名，改名后回退扫描且有页数上限", async () => workspace(async (dir) => {
  const calls = [];
  const remote = new CvClient({ request: async (_, { body }) => {
    calls.push(body);
    if (body.keyword) return response([{ ...raw, id: "cv-491", cvInfoId: 491 }]);
    return response(body.pageNum === 2 ? [raw] : [], 2);
  } }, dir);
  await assert.rejects(remote.samples(490), /未找到/); // 空页结束，避免遍历错误响应。
  remote.client.request = async (_, { body }) => {
    calls.push(body);
    return response(body.keyword || body.pageNum === 1 ? [{ ...raw, cvInfoId: 491 }] : [raw], 2);
  };
  assert.equal((await remote.samples("cv-490")).item.id, "490");
  assert.equal((await remote.samples(490)).item.id, "490");
  assert.ok(calls.some((x) => x.keyword === "测试主播"));
  await assert.rejects(remote.samples(999, { maxPages: 1 }), /1 页内/);
  await assert.rejects(remote.samples("../../auth"), /正整数/);
}));

test("下载核对样音归属、刷新地址并入库；重复及离线获取不读取凭据", async () => workspace(async (dir) => {
  let calls = 0, downloads = 0;
  const remote = new CvClient({ request: async () => { calls++; return response(); } }, join(dir, "catalog"), {
    download: async (url, destination) => {
      downloads++; assert.equal(url, raw.voiceSamples[0].url);
      await writeFile(destination, Buffer.from("ID3-test-audio")); return { extension: ".mp3" };
    },
  });
  const library = new AudioLibrary(join(dir, "library"));
  const first = await remote.get(library, { cv: 490, id: 1295 });
  assert.equal(first.reused, false); assert.equal(first.item.kind, "voice");
  assert.equal(first.item.ext, "mp3"); assert.equal(first.item.title, "测试主播 / 古言对白");
  const again = await remote.get(library, { cv: 490, id: 1295 });
  assert.equal(again.reused, true); assert.deepEqual([calls, downloads], [1, 1]);
  assert.doesNotMatch(JSON.stringify(await library.index()), /xmcdn/);
  await assert.rejects(remote.get(library, { cv: 490, id: 999 }), /没有可下载/);
  assert.equal(downloads, 1);
  const p = { audioLibrary: library.dir, auth: join(dir, "missing-auth.json") };
  const result = await runCvCommand(["cv", "get"], { "cv-id": "490", id: "1295", offline: true,
    output: join(dir, "export.mp3") }, p, {});
  assert.equal(result.source, "local"); assert.ok(result.item.output.endsWith("export.mp3"));
  await assert.rejects(runCvCommand(["cv", "get"], { "cv-id": "490", id: "1295", output: result.item.output }, p, {}), /不覆盖/);
  const missing = await runCvCommand(["cv", "get"], { "cv-id": "491", id: "1295", offline: true }, p, {});
  assert.equal(missing.status, "not-cached");
  assert.equal((await runCvCommand(["cv", "search"], { offline: true }, p, {})).source, "local");
  const samples = await runCvCommand(["cv", "samples"], { id: '490' }, p, {});
  assert.equal(samples.source, 'local'); assert.equal(samples.cachedOnly, true); assert.ok(samples.item.samples[0].path);
  const obtained = await runCvCommand(['cv', 'obtain'], { keyword: '古言', 'cv-id': '490' }, p, {});
  assert.equal(obtained.source, 'local'); assert.equal(obtained.reused, true);
  const wrongOwner = await runCvCommand(['cv', 'obtain'], { keyword: '古言', 'cv-id': '491', offline: true }, p, {});
  assert.equal(wrongOwner.status, 'no-local-match');
  await assert.rejects(runCvCommand(['cv', 'search'], { refresh: true, offline: true }, p, {}), /不能同时/);
  await assert.rejects(runCvCommand(['cv', 'search'], { page: '0' }, p, {}), /整数/);
  await assert.rejects(runCvCommand(['cv', 'samples'], { id: '490', refresh: true }, p, {}), /ENOENT/);
}));

test("CV obtain本地无匹配才搜索下载；远端同等匹配返回候选，不擅自选声音", async () => workspace(async (dir) => {
  const library = new AudioLibrary(join(dir, 'library'));
  let searches = 0, downloads = 0, loads = 0;
  const owner = { id: '490', name: '测试主播', samples: [{ id: '1295', libraryId: 'cv:490:1295', title: '古言对白', duration: 37.536 }] };
  const remote = {
    search: async () => { searches++; return { items: [owner], totalPages: 1 }; },
    get: async (_, { cv, id }) => {
      downloads++; assert.equal(cv, '490'); assert.equal(id, '1295');
      return { ok: true, source: 'remote', ...(await library.acquire({ id: 'cv:490:1295', kind: 'voice', title: '测试主播 / 古言对白', duration: 37.536 },
        async ({ destination }) => writeFile(destination, 'ID3-sample'))) };
    },
  };
  const load = async () => { loads++; return remote; };
  const first = await obtainCvAudio(library, load, { keyword: '古言', minDuration: 30 });
  assert.equal(first.source, 'remote');
  assert.equal((await obtainCvAudio(library, load, { keyword: '古言' })).source, 'local');
  assert.deepEqual([loads, searches, downloads], [1, 1, 1]);
  remote.search = async () => ({ items: [owner, { ...owner, id: '491', name: '另一主播', samples: [{ ...owner.samples[0], libraryId: 'cv:491:1295' }] }], totalPages: 1 });
  const ambiguous = await obtainCvAudio(new AudioLibrary(join(dir, 'empty')), load, { keyword: '古言' });
  assert.equal(ambiguous.status, 'ambiguous-match'); assert.equal(downloads, 1);
  const irrelevant = await obtainCvAudio(new AudioLibrary(join(dir, 'empty')), load, { keyword: '科幻' });
  assert.equal(irrelevant.status, 'no-confident-match'); assert.equal(downloads, 1);
  const offline = await obtainCvAudio(library, async () => { throw new Error('不能读取登录态'); }, { keyword: '科幻', offline: true });
  assert.equal(offline.status, 'no-local-match');
}));

test("损坏样音不作为本地命中，指定主播及远端时长过滤有效", async () => workspace(async (dir) => {
  const library = new AudioLibrary(dir);
  const stored = await library.acquire({ id: 'cv:490:1295', kind: 'voice', title: '古言对白' },
    async ({ destination }) => writeFile(destination, 'original'));
  await writeFile(stored.item.path, 'modified');
  const remote = {
    samples: async (id) => { assert.equal(id, '490'); return { item: { id, name: '主播', samples: [{ id: '1295', libraryId: 'cv:490:1295', title: '古言对白', duration: 37 }] } }; },
    get: async () => { throw new Error('时长不匹配不应下载'); },
  };
  const result = await obtainCvAudio(library, async () => remote, { keyword: '古言', cv: '490', maxDuration: 20 });
  assert.equal(result.status, 'no-confident-match');
}));

test("业务错误、格式错误和无下载地址不会下载样音", async () => workspace(async (dir) => {
  let downloads = 0;
  for (const reply of [{ code: 401, message: "请登录" }, { code: 200000, data: {} },
    response([{ ...raw, voiceSamples: [{ id: "1295", title: "已下架" }] }])]) {
    const remote = new CvClient({ request: async () => reply }, join(dir, "catalog"), {
      download: async () => { downloads++; },
    });
    await assert.rejects(remote.get(new AudioLibrary(join(dir, "library")), { cv: 490, id: 1295 }), /接口错误|搜索结果|没有可下载/);
  }
  assert.equal(downloads, 0);
}));
