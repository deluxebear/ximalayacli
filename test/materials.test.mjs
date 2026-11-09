import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MaterialsClient, previewId, cloudAudioId } from "../lib/materials.mjs";
import { runMaterialsCommand } from "../lib/materials-cli.mjs";
import { AudioLibrary } from "../lib/audio-library.mjs";
import { readJson } from "../lib/config.mjs";
import { resolveJob } from "../lib/batch.mjs";

const pack = { packId: "xmly-music-儿童", name: "儿童音乐", description: "轻松日常", musicType: 2,
  library: "xmly", accessType: "free", imported: false, itemCount: 12,
  items: Array.from({ length: 12 }, (_, n) => ({ itemId: `儿童-${n}`, name: `吉他 ${n}`, durationMs: 10000,
    description: "日常", previewable: true, url: "https://example.com/private" })) };
const reply = (data) => ({ code: 200000, data });
async function workspace(action) {
  const dir = await mkdtemp(join(tmpdir(), "xmly-materials-test-"));
  try { await action(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("素材包按官方来源和角色查询，名称/描述过滤及包内本地分页，响应不暴露URL", async () => {
  const calls = [];
  const remote = new MaterialsClient({ request: async (url, options) => {
    calls.push({ url, options }); return reply(url.includes('/list?') ? [pack, { ...pack, packId: 'other', accessType: 'member' }] : pack);
  } }, { teamId: '123' });
  const found = await remote.list({ library: 'xmly', kind: 'sfx', keyword: '儿童 日常', access: 'free' });
  assert.equal(found.items.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.searchParams.get('musicType'), '1');
  assert.equal(url.searchParams.get('roleType'), '2'); assert.equal(url.searchParams.get('teamId'), '123');
  assert.equal(calls[0].options.headers.origin, 'https://aigc.ximalaya.com');
  const items = await remote.items(pack.packId, { keyword: '吉他 日常', page: 2, pageSize: 5 });
  assert.equal(items.items[0].itemId, '儿童-5'); assert.equal(items.items[0].duration, 10);
  assert.equal(items.totalCount, 12); assert.equal(items.totalPages, 3);
  assert.doesNotMatch(JSON.stringify(items), /https:/);
  await assert.rejects(remote.list({ library: 'studio' }), /ai\/xmly/);
  await assert.rejects(remote.list({ kind: 'voice' }), /music\/sfx/);
  await assert.rejects(remote.items(pack.packId, { pageSize: 101 }), /整数/);
  await assert.rejects(remote.detail('../secret'), /仅支持/);
  assert.throws(() => new MaterialsClient({}, { teamId: 0 }), /整数/);
});

test("试听端点带Cookie，CDN跳转不带Cookie；文件标记试听并支持中文ID和无凭据离线复用", async () => workspace(async (dir) => {
  let fetches = 0, apiCalls = 0;
  const client = {
    request: async () => { apiCalls++; return reply(pack); },
    cookie: () => 'session=private',
    fetch: async (url, options) => {
      fetches++;
      if (url.includes('/material-pack/preview?')) {
        assert.equal(options.headers.cookie, 'session=private');
        return new Response(null, { status: 302, headers: { location: 'https://aod.cos.tx.xmcdn.com/test.mp3' } });
      }
      assert.equal(options.headers, undefined);
      return new Response(Buffer.from('ID3-sample-audio'), { headers: { 'content-type': 'audio/mpeg' } });
    },
  };
  const library = new AudioLibrary(join(dir, 'library'));
  const remote = new MaterialsClient(client);
  const first = await remote.preview(library, pack.packId, '儿童-0');
  assert.equal(first.preview, true); assert.equal(first.item.kind, 'preview');
  assert.equal(first.item.id, previewId(pack.packId, '儿童-0'));
  assert.doesNotMatch(await readFile(library.indexPath, 'utf8'), /https:|private/);
  const p = { audioLibrary: library.dir, auth: join(dir, 'missing-auth.json') };
  const again = await runMaterialsCommand(['materials', 'preview'], {
    'pack-id': pack.packId, id: '儿童-0', offline: true, output: join(dir, 'out.mp3'),
  }, p, {});
  assert.equal(again.source, 'local'); assert.deepEqual([fetches, apiCalls], [2, 1]);
  assert.equal((await runMaterialsCommand(['materials', 'preview'], {
    'pack-id': pack.packId, id: 'unknown', offline: true,
  }, p, {})).status, 'not-cached');
  await assert.rejects(runMaterialsCommand(['materials', 'list'], { offline: true }, p, {}), /仅 preview/);
}));

test("拒绝包外试听、业务错误和无效列表", async () => workspace(async (dir) => {
  const remote = new MaterialsClient({ request: async () => reply(pack) }, { download: () => { throw new Error('不应下载'); } });
  await assert.rejects(remote.preview(new AudioLibrary(dir), pack.packId, 'other'), /不在包内/);
  remote.client.request = async () => ({ code: 401, message: '请登录' });
  await assert.rejects(remote.list(), /请登录/);
  remote.client.request = async () => reply({});
  await assert.rejects(remote.list(), /格式无效/);
}));

function importer(dir, hook = () => {}) {
  const calls = [];
  const client = { request: async (url, options) => {
    calls.push({ url, options });
    const custom = await hook(url, options, calls);
    if (custom !== undefined) return custom;
    if (url.includes('/detail?')) return reply(pack);
    assert.equal(options.retry, false);
    assert.equal(options.body.clientVersion, '2'); assert.equal(options.body.roleType, 1);
    if (url.endsWith('/prepare')) return reply({ groupId: 42, groupName: pack.name, itemIds: pack.items.map(x => x.itemId) });
    assert.ok(options.body.itemIds.length <= 5);
    assert.equal(options.body.groupId, 42);
    return reply({ success: options.body.itemIds.length, failed: 0, failItems: [] });
  } };
  return { remote: new MaterialsClient(client, { journal: join(dir, 'jobs.json') }), calls };
}

test("云端导入dry-run不写入；每批5条，重复执行跳过全部写请求", async () => workspace(async (dir) => {
  const { remote, calls } = importer(dir);
  assert.equal((await remote.importPack(pack.packId, { dryRun: true })).requests.chunkSize, 5);
  assert.equal(calls.length, 1);
  const first = await remote.importPack(pack.packId);
  assert.equal(first.success, 12); assert.equal(first.status, 'done');
  assert.deepEqual(calls.filter(x => x.url.endsWith('/chunk')).map(x => x.options.body.itemIds.length), [5, 5, 2]);
  const posts = calls.filter(x => x.options.method === 'POST').length;
  const again = await remote.importPack(pack.packId);
  assert.equal(again.success, 12); assert.ok(again.chunks.every(x => x.status === 'skipped'));
  assert.equal(calls.filter(x => x.options.method === 'POST').length, posts);
}));

test("自动获取只导入指定条目，不重复准备分组，其余包内条目后续可单独导入", async () => workspace(async (dir) => {
  const { remote, calls } = importer(dir);
  assert.equal((await remote.importPack(pack.packId, { itemIds: ['儿童-1'] })).total, 1);
  assert.equal((await remote.importPack(pack.packId, { itemIds: ['儿童-2'] })).total, 1);
  assert.equal(calls.filter(x => x.url.endsWith('/prepare')).length, 1);
  assert.deepEqual(calls.filter(x => x.url.endsWith('/chunk')).map(x => x.options.body.itemIds), [['儿童-1'], ['儿童-2']]);
  await remote.importPack(pack.packId, { itemIds: ['儿童-1'] });
  assert.equal(calls.filter(x => x.url.endsWith('/chunk')).length, 2);
  await assert.rejects(remote.importPack(pack.packId, { itemIds: ['unknown'] }), /不在包内/);
}));

test("导入中断记录uncertain并停止，人工核对后可从未完成批次继续", async () => workspace(async (dir) => {
  let broken = true;
  const { remote, calls } = importer(dir, async (url, options) => {
    if (url.endsWith('/chunk') && options.body.itemIds[0] === '儿童-5' && broken) throw new Error('连接断开');
  });
  const first = await remote.importPack(pack.packId);
  assert.equal(first.status, 'needs-review'); assert.equal(first.chunks.length, 2);
  assert.equal(first.chunks[1].status, 'uncertain');
  const posts = calls.filter(x => x.options.method === 'POST').length;
  await remote.importPack(pack.packId, { retryFailed: true });
  assert.equal(calls.filter(x => x.options.method === 'POST').length, posts);
  broken = false;
  await resolveJob(remote.journal, first.chunks[1].id, { retry: true });
  const resumed = await remote.importPack(pack.packId, { retryFailed: true });
  assert.equal(resumed.success, 12);
  assert.equal(calls.filter(x => x.url.endsWith('/prepare')).length, 1);
  assert.equal(calls.filter(x => x.url.endsWith('/chunk') && x.options.body.itemIds[0] === '儿童-0').length, 1);
}));

test("已导入、空包、未购买付费包和个人会员包不新建分组", async () => workspace(async (dir) => {
  for (const extra of [{ imported: true }, { items: [] }, { accessType: 'paid', purchased: false }, { accessType: 'member' }]) {
    let writes = 0;
    const remote = new MaterialsClient({ request: async (_, options) => {
      if (options.method === 'POST') writes++;
      return reply({ ...pack, ...extra });
    } }, { journal: join(dir, 'jobs.json') });
    if (extra.imported) assert.equal((await remote.importPack(pack.packId)).status, 'already-imported');
    else await assert.rejects(remote.importPack(pack.packId), /为空|制作组/);
    assert.equal(writes, 0);
  }
  const remote = new MaterialsClient({ request: async () => reply({ ...pack, accessType: 'paid', purchased: false }) },
    { teamId: 123, journal: join(dir, 'jobs.json') });
  await assert.rejects(remote.importPack(pack.packId), /尚未购买/);
}));

test("准备响应异常不重复新建；部分失败计数保留且不自动重导成功项", async () => workspace(async (dir) => {
  const partial = importer(dir, async (url, options) => url.endsWith('/chunk') ?
    reply({ success: options.body.itemIds.length - 1, failed: 1, failItems: [{ name: '失败条目', reason: '拒绝', url: 'secret' }] }) : undefined);
  const result = await partial.remote.importPack(pack.packId);
  assert.equal(result.status, 'partial'); assert.equal(result.failed, 3); assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /secret/);
  const state = await readJson(partial.remote.journal);
  assert.equal(Object.keys(state.jobs).length, 4);
  const malformedDir = join(dir, 'invalid');
  const invalid = importer(malformedDir, async (url) => url.endsWith('/prepare') ? reply({ groupId: 1, itemIds: ['unknown'] }) : undefined);
  assert.equal((await invalid.remote.importPack(pack.packId)).status, 'needs-review');
  await invalid.remote.importPack(pack.packId);
  assert.equal(invalid.calls.filter(x => x.url.endsWith('/prepare')).length, 1);
}));

test("云端分组/音频列表使用type，详情使用roleType，完整音频按作用域缓存并可供music复用", async () => workspace(async (dir) => {
  const calls = [];
  const audio = { musicId: 123, musicName: '吉他童趣小曲', musicType: 2, duration: 107781, url: 'private' };
  const remote = new MaterialsClient({
    request: async (url) => {
      calls.push(url);
      const params = new URL(url).searchParams;
      assert.equal(params.get('teamId'), '88');
      if (url.includes('/group/list?')) {
        assert.equal(params.get('type'), '2'); assert.equal(params.get('groupType'), '2');
        return reply([{ groupId: 42, groupName: '儿童', musicCount: 16 }]);
      }
      if (url.includes('/music/list?')) {
        assert.equal(params.get('type'), '2'); assert.equal(params.get('roleType'), null);
        assert.equal(params.get('groupId'), '42'); assert.equal(params.get('queryText'), '吉他');
        return reply({ list: [audio], totalCount: 1, pageCount: 1 });
      }
      assert.equal(params.get('roleType'), '2'); return reply(audio);
    },
  }, { teamId: 88, download: async (url, destination) => {
    assert.equal(new URL(url).pathname, '/voice-studio-music/music/audio');
    await writeFile(destination, 'ID3-full-audio'); return { extension: '.mp3' };
  } });
  assert.equal((await remote.groups()).items[0].groupId, 42);
  const list = await remote.libraryList({ groupId: 42, keyword: '吉他' });
  assert.equal(list.items[0].duration, 107.781); assert.doesNotMatch(JSON.stringify(list), /private/);
  const library = new AudioLibrary(join(dir, 'library'));
  const first = await remote.getAudio(library, 123);
  assert.equal(first.item.id, cloudAudioId(123, 88)); assert.equal(first.item.kind, 'music');
  assert.equal((await library.search('吉他', { kind: 'music' })).length, 1);
  const cached = await runMaterialsCommand(['materials', 'library', 'get'], { id: '123', 'team-id': '88', offline: true },
    { audioLibrary: library.dir, auth: join(dir, 'missing-auth') }, {});
  assert.equal(cached.source, 'local'); assert.equal(calls.length, 3);
  assert.equal((await runMaterialsCommand(['materials', 'library', 'get'], { id: '123', offline: true },
    { audioLibrary: library.dir }, {})).status, 'not-cached');
  await assert.rejects(remote.getAudio(library, '../secret'), /整数/);
}));
