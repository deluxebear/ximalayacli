import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AudioLibrary } from "../lib/audio-library.mjs";
import { MusicClient, downloadAudio, mediaUrl, normalizeMusic, obtainAudio, audioDuration,
  exportAudio, durationFilter } from "../lib/music.mjs";
import { runMusicCommand } from "../lib/music-cli.mjs";

const m4a = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypM4A "), Buffer.alloc(20)]);
async function workspace(action) {
  const dir = await mkdtemp(join(tmpdir(), "xmly-music-test-"));
  try { await action(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
const rain = { id: "sfx:1", trackId: "1", kind: "sfx", title: "城市雨声", duration: 18, tags: [] };
const rawMusic = { trackId: 42, musicName: "雨声钢琴", duration: 30, millDuration: 30000,
  subCategoryName: ["舒缓"], playPath: "http://aod.cos.tx.xmcdn.com/a.m4a" };

test("从标准WAV与MP4容器头读取时长，截断或越界头不误报", async () => workspace(async (dir) => {
  const wav = Buffer.alloc(44 + 16000);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(16000, 40);
  const file = join(dir, "fixture.wav"); await writeFile(file, wav);
  assert.equal(await audioDuration(file, ".wav"), 1);
  const movie = Buffer.alloc(44);
  movie.writeUInt32BE(44, 0); movie.write("moov", 4);
  movie.writeUInt32BE(36, 8); movie.write("mvhd", 12);
  movie.writeUInt32BE(1000, 28); movie.writeUInt32BE(29634, 32);
  const mp4 = join(dir, "fixture.m4a"); await writeFile(mp4, movie);
  assert.equal(await audioDuration(mp4, ".m4a"), 29.634);
  await writeFile(mp4, Buffer.from([0, 0, 0, 255, 109, 111, 111, 118]));
  assert.equal(await audioDuration(mp4, ".m4a"), undefined);
}));

test("音乐/音效时长单位转为秒，旧音轨支持毫秒，命名空间隔离 ID", () => {
  assert.equal(normalizeMusic(rawMusic, "music").duration, 30);
  assert.equal(normalizeMusic({ ...rawMusic, millDuration: undefined, coverPath: "cover", duration: 30000 }, "intro").duration, 30);
  const item = normalizeMusic({ id: 42, nickname: "雨声", duration: 18000 }, "sfx");
  assert.equal(item.duration, 18);
  assert.equal(item.id, "sfx:42");
  assert.ok(!("playPath" in item));
  assert.throws(() => normalizeMusic({ id: "../../secret" }, "sfx"), /正整数/);
});

test("搜索使用官网参数，音效 GET/配乐 POST，只读搜索可重试且对输出隐藏 URL", async () => workspace(async (dir) => {
  const calls = [];
  const client = new MusicClient({ request: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("getWebCategories")) return { code: 200, data: [{ id: 286, name: "舒缓" }] };
    const acoustic = url.includes("acoustic");
    return { code: 200, data: { totalCount: 1, totalPage: 1,
      result: [acoustic ? { id: 7, nickname: "雨声", duration: 9000, playPath: rawMusic.playPath } : rawMusic] } };
  } }, dir);
  const music = await client.search({ keyword: "雨声", kind: "intro", category: "286" });
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.retry, true);
  assert.deepEqual(calls[0].options.body, { subCategoryIds: [286], fuzzyWord: "雨声", pageSize: 12, pageNo: 1, businessId: 3, relationType: 4 });
  assert.ok(!JSON.stringify(music).includes("xmcdn"));
  await client.search({ kind: "transition", keyword: "风", page: 2 });
  const url = new URL(calls[2].url);
  assert.equal(url.pathname, "/music-web/api/acoustic/searchTransition");
  assert.equal(url.searchParams.get("relationType"), "5");
  assert.equal(url.searchParams.get("pageNo"), "2");
  assert.equal(url.searchParams.get("keyword"), "风");
  assert.equal(calls[2].options, undefined);
}));

test("接口业务失败阻止下载，主播认证限制按平台要求处理", async () => workspace(async (dir) => {
  let downloads = 0;
  const remote = new MusicClient({ request: async () => ({ code: 6001, msg: "请认证" }) }, dir,
    { download: async () => { downloads++; } });
  await assert.rejects(remote.get(new AudioLibrary(join(dir, "library")), { id: 42 }), /身份认证/);
  assert.equal(downloads, 0);
}));

test("宽泛分类召回不会给无关素材写入所请求的分类", async () => workspace(async (dir) => {
  const remote = new MusicClient({ request: async (url) => ({ code: 200, data:
    url.endsWith("getWebCategories") ? [{ id: 286, name: "悬疑" }] :
    { result: [rawMusic], totalPage: 1, totalCount: 1 } }) }, dir);
  const result = await remote.search({ category: "286", kind: "music" });
  assert.deepEqual(result.items, []);
  const record = JSON.parse(await readFile(remote.catalogPath("music", 42), "utf8"));
  assert.equal(record.item.category, undefined);
}));

test("按ID获取使用正式下载地址，音效先鉴权；重复获取不再请求接口", async () => workspace(async (dir) => {
  const calls = [];
  const remote = new MusicClient({ request: async (url) => {
    calls.push(url);
    return { code: 200, data: url.includes("getDownloadInfo") ?
      { fileName: "正式雨声.m4a", downloadPath: "http://aod.cos.tx.xmcdn.com/full.m4a" } :
      url.includes("checkCanDownload") ? null :
      { result: [{ id: 1, nickname: "城市雨声", duration: 18000, playPath: rawMusic.playPath }], totalPage: 1 } };
  } }, join(dir, "catalog"), { download: async (url, destination) => {
    calls.push(url); await writeFile(destination, m4a); return { extension: ".m4a" };
  } });
  const library = new AudioLibrary(join(dir, "library"));
  const first = await remote.get(library, { id: 42 });
  assert.equal(first.item.title, "正式雨声");
  assert.ok(calls[1].endsWith("full.m4a"));
  assert.equal(calls.length, 2);
  assert.equal((await remote.get(library, { id: 42 })).reused, true);
  assert.equal(calls.length, 2);
  await remote.search({ kind: "sfx", keyword: "雨声" });
  const sfx = await remote.get(library, { id: 1, kind: "sfx" });
  assert.equal(sfx.item.duration, 18);
  assert.ok(calls.at(-2).endsWith("checkCanDownload"));
  assert.ok(!JSON.stringify(await library.list()).includes("xmcdn"));
}));

test("音效无搜索记录时不猜测其它接口或绕过下载权限", async () => workspace(async (dir) => {
  const remote = new MusicClient({ request: async () => { throw new Error("不应请求"); } }, join(dir, "catalog"));
  await assert.rejects(remote.get(new AudioLibrary(join(dir, "library")), { id: 1, kind: "sfx" }), /先运行 music search/);
}));

test("本地命中或离线无匹配时完全不加载远端及登录状态", async () => workspace(async (dir) => {
  const library = new AudioLibrary(dir);
  await library.acquire(rain, async ({ destination }) => { await writeFile(destination, m4a); });
  let remoteCalls = 0;
  const load = async () => { remoteCalls++; throw new Error("离线"); };
  const got = await obtainAudio(library, load, { keyword: "下雨", kind: "sfx", maxDuration: 20 });
  assert.equal(got.source, "local"); assert.equal(got.reused, true);
  assert.equal(got.item.id, rain.id);
  const missing = await obtainAudio(library, load, { keyword: "海浪", kind: "sfx", offline: true });
  assert.equal(missing.status, "no-local-match");
  assert.equal(remoteCalls, 0);
}));

test("本地未命中才联网，远端首条不相关则继续匹配；重复请求改用本地", async () => workspace(async (dir) => {
  const library = new AudioLibrary(dir);
  let loads = 0, searches = 0, gets = 0;
  const remote = {
    search: async () => { searches++; return { totalPages: 1, items: [{ ...rain, id: "sfx:2", title: "狗叫" }, rain] }; },
    get: async (_, { id }) => {
      gets++; assert.equal(id, "1");
      return { ok: true, source: "remote", ...(await library.acquire(rain, async ({ destination }) => writeFile(destination, m4a))) };
    },
  };
  const load = async () => { loads++; return remote; };
  const first = await obtainAudio(library, load, { keyword: "雨声", kind: "sfx" });
  const second = await obtainAudio(library, load, { keyword: "下雨", kind: "sfx" });
  assert.equal(first.source, "remote"); assert.equal(second.source, "local");
  assert.deepEqual([loads, searches, gets], [1, 1, 1]);
}));

test("搜索只有无关素材时不擅自下载，有界分页并给出候选", async () => workspace(async (dir) => {
  let searches = 0;
  const result = await obtainAudio(new AudioLibrary(dir), async () => ({
    search: async () => { searches++; return { totalPages: 10, items: [{ ...rain, title: "火车" }] }; },
    get: async () => { throw new Error("不能下载不匹配素材"); },
  }), { keyword: "海浪", kind: "sfx", maxPages: 2 });
  assert.equal(searches, 2); assert.equal(result.status, "no-confident-match");
  assert.equal(result.ok, false);
}));

test("CDN下载升级HTTPS，不带认证，检查长度和格式", async () => workspace(async (dir) => {
  const destination = join(dir, "a");
  const result = await downloadAudio("http://aod.cos.tx.xmcdn.com/a", destination, {
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://aod.cos.tx.xmcdn.com/a");
      assert.equal(options.headers, undefined);
      return new Response(m4a, { headers: { "content-length": String(m4a.length), "content-type": "audio/mp4" } });
    },
  });
  assert.equal(result.extension, ".m4a"); assert.equal(result.bytes, m4a.length);
}));

test("拒绝CDN外地址、危险重定向、假音频、过大及截断响应", async () => workspace(async (dir) => {
  for (const url of ["http://127.0.0.1/", "https://evilxmcdn.com/a", "https://xmcdn.com.evil/a", "ftp://xmcdn.com/a", "https://user:pass@xmcdn.com/a"])
    assert.throws(() => mediaUrl(url), /官方|HTTPS/);
  for (const [name, response, options, pattern] of [
    ["redirect", () => new Response(null, { status: 302, headers: { location: "http://localhost/" } }), {}, /官方/],
    ["html", () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } }), {}, /文本/],
    ["unknown", () => new Response(Buffer.from("not audio")), {}, /音频格式/],
    ["length", () => new Response(m4a, { headers: { "content-length": "200" } }), {}, /不完整/],
    ["limit", () => new Response(m4a), { maxBytes: 2 }, /大小限制/],
  ]) await assert.rejects(downloadAudio("https://aod.cos.tx.xmcdn.com/a", join(dir, name),
    { fetchImpl: async () => response(), ...options }), pattern);
}));

test("导出明确路径且不覆盖既有文件", async () => workspace(async (dir) => {
  const source = join(dir, "source.m4a"), output = join(dir, "output.m4a");
  await writeFile(source, m4a);
  const result = await exportAudio({ path: source }, output);
  assert.equal(result.output, output);
  await assert.rejects(exportAudio({ path: source }, output), /不覆盖/);
  assert.deepEqual(await readFile(output), m4a);
}));

test("CLI本地 get、obtain、library 无auth仍可运行；导入拒绝假音频", async () => workspace(async (dir) => {
  const p = { audioLibrary: join(dir, "library"), auth: join(dir, "missing-auth.json") };
  const library = new AudioLibrary(p.audioLibrary);
  await library.acquire(rain, async ({ destination }) => writeFile(destination, m4a));
  const get = await runMusicCommand(["music", "get"], { id: "1", kind: "sfx" }, p, {});
  assert.equal(get.reused, true);
  const obtain = await runMusicCommand(["music", "obtain"], { keyword: "下雨", kind: "sfx" }, p, {});
  assert.equal(obtain.source, "local");
  const search = await runMusicCommand(["music", "search"], { keyword: "雨声", kind: "sfx", offline: true }, p, {});
  assert.equal(search.items.length, 1);
  await assert.rejects(runMusicCommand(["music", "categories"], { offline: true }, p, {}), /离线/);
  const missing = await runMusicCommand(["music", "get"], { id: "2", kind: "sfx", offline: true }, p, {});
  assert.equal(missing.ok, false);
  const list = await runMusicCommand(["music", "library", "list"], {}, p, {});
  assert.equal(list.items.length, 1);
  const fake = join(dir, "fake.mp3"); await writeFile(fake, "<html>login</html>");
  await assert.rejects(runMusicCommand(["music", "library", "import"], { file: fake }, p, {}), /音频格式/);
  await assert.rejects(access(p.auth));
  assert.throws(() => durationFilter([], { minDuration: 3, maxDuration: 2 }), /最短/);
}));
