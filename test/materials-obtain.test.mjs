import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AudioLibrary } from "../lib/audio-library.mjs";
import { obtainWithMaterials } from "../lib/materials-obtain.mjs";

async function workspace(action) {
  const dir = await mkdtemp(join(tmpdir(), "xmly-obtain-materials-"));
  try { await action(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
function remote(dir, changes = {}) {
  const calls = [];
  const pack = { packId: "rain", name: "环境音效", description: "雨声", kind: "sfx", accessType: "free", itemCount: 2,
    items: [{ itemId: "dog", name: "狗叫", duration: 5 }, { itemId: "rain-1", name: "城市雨声", description: "夜间雨声", duration: 18 }] };
  const cloud = { id: "aigc:personal:42", trackId: "42", title: "城市雨声", kind: "sfx", duration: 18 };
  let imported = false;
  const value = {
    scope: { roleType: 1 }, journal: join(dir, "jobs.json"), importKey: () => "prep",
    list: async ({ library }) => { calls.push(`list:${library}`); return { items: library === "ai" ? [pack] : [] }; },
    detail: async () => { calls.push("detail"); return pack; },
    importPack: async (_, options) => { calls.push({ import: options.itemIds }); imported = true; return { ok: true, groupId: 7 }; },
    libraryList: async () => { calls.push("cloud"); assert.ok(imported); return { items: [cloud], totalPages: 1 }; },
    getAudio: async (library, id) => {
      calls.push(`get:${id}`);
      return { ok: true, source: "remote", ...(await library.acquire({ ...cloud, source: "ximalaya-aigc-library" },
        async ({ destination }) => { await writeFile(destination, "ID3-full-audio"); return { extension: ".mp3" }; })) };
    },
    ...changes,
  };
  return { value, calls, pack, cloud };
}
const forbidden = async () => { throw new Error("不应联网或读取凭据"); };

test("本地完整文件优先，离线无匹配不加载任何远端；试听不参与匹配", async () => workspace(async (dir) => {
  const library = new AudioLibrary(dir);
  await library.acquire({ id: "preview:rain", kind: "preview", title: "城市雨声" }, async ({ destination }) => writeFile(destination, "preview"));
  const absent = await obtainWithMaterials(library, forbidden, forbidden, { keyword: "雨声", kind: "sfx", offline: true });
  assert.equal(absent.status, "no-local-match");
  await library.acquire({ id: "sfx:rain", kind: "sfx", title: "城市雨声" }, async ({ destination }) => writeFile(destination, "full"));
  assert.equal((await obtainWithMaterials(library, forbidden, forbidden, { keyword: "下雨", kind: "sfx" })).source, "local");
}));

test("本地未命中搜索两种素材包，只导入命中条目，获取完整文件并保留用途供重复离线复用", async () => workspace(async (dir) => {
  const library = new AudioLibrary(join(dir, "library")), { value, calls } = remote(dir);
  const options = { keyword: "下雨", kind: "sfx", minDuration: 10, maxDuration: 20 };
  const result = await obtainWithMaterials(library, forbidden, async () => value, options);
  assert.equal(result.provider, "materials"); assert.equal(result.item.id, "aigc:personal:42");
  assert.ok(result.item.tags.includes("夜间雨声"));
  assert.deepEqual(calls.filter(x => typeof x === "object"), [{ import: ["rain-1"] }]);
  assert.ok(calls.includes("list:ai") && calls.includes("list:xmly") && calls.includes("get:42"));
  assert.equal((await obtainWithMaterials(library, forbidden, forbidden, options)).source, "local");
}));

test("仅包名匹配、未知时长、权限受限和不相关候选均不导入，扫描包数有上限", async () => workspace(async (dir) => {
  const { value, calls, pack } = remote(dir);
  pack.items = [{ itemId: "other", name: "狗叫" }];
  value.list = async () => ({ items: Array.from({ length: 5 }, (_, i) => ({ ...pack, packId: `p${i}` })) });
  const result = await obtainWithMaterials(new AudioLibrary(join(dir, "library")), forbidden, async () => value,
    { keyword: "雨声", kind: "sfx", source: "materials", maxPacks: 2 });
  assert.equal(result.status, "no-confident-match"); assert.equal(result.searchedPacks, 2); assert.equal(result.searchLimited, true);
  assert.equal(calls.filter(x => x === "detail").length, 2); assert.ok(!calls.includes("cloud"));
  pack.items = [{ itemId: "rain", name: "雨声" }];
  assert.equal((await obtainWithMaterials(new AudioLibrary(join(dir, "library")), forbidden, async () => value,
    { keyword: "雨声", kind: "sfx", source: "materials", maxDuration: 20 })).ok, false);
  pack.accessType = "paid";
  assert.equal((await obtainWithMaterials(new AudioLibrary(join(dir, "library")), forbidden, async () => value,
    { keyword: "雨声", kind: "sfx", source: "materials" })).searchedPacks, 0);
  assert.equal(calls.filter(x => typeof x === "object").length, 0);
}));

test("云端已导入时复用分组；同名条目/分组歧义不擅自下载或重导", async () => workspace(async (dir) => {
  const { value, calls, pack, cloud } = remote(dir);
  pack.imported = true;
  value.groups = async () => ({ items: [{ groupId: 7, groupName: pack.name }] });
  value.libraryList = async () => ({ items: [cloud], totalPages: 1 });
  const result = await obtainWithMaterials(new AudioLibrary(join(dir, "library")), forbidden, async () => value,
    { keyword: "雨声", kind: "sfx" });
  assert.equal(result.ok, true); assert.equal(calls.filter(x => typeof x === "object").length, 0);
  value.libraryList = async () => ({ items: [cloud, { ...cloud, id: "different", trackId: "43" }], totalPages: 1 });
  const ambiguous = await obtainWithMaterials(new AudioLibrary(join(dir, "empty")), forbidden, async () => value,
    { keyword: "雨声", kind: "sfx" });
  assert.equal(ambiguous.status, "ambiguous-cloud-match");
  value.groups = async () => ({ items: [{ groupId: 7, groupName: pack.name }, { groupId: 8, groupName: pack.name }] });
  assert.equal((await obtainWithMaterials(new AudioLibrary(join(dir, "empty")), forbidden, async () => value,
    { keyword: "雨声", kind: "sfx" })).status, "ambiguous-import-group");
}));

test("导入不确定时停止，不降级或下载试听；素材包无匹配才回退原素材库", async () => workspace(async (dir) => {
  const { value, pack } = remote(dir);
  value.importPack = async () => ({ ok: false, status: "needs-review" });
  const library = new AudioLibrary(join(dir, "library"));
  assert.equal((await obtainWithMaterials(library, forbidden, async () => value, { keyword: "雨声", kind: "sfx" })).status, "needs-review");
  pack.items = [];
  let searched = 0;
  const studio = { search: async () => { searched++; return { items: [], totalCount: 0 }; } };
  const result = await obtainWithMaterials(library, async () => studio, async () => value, { keyword: "雨声", kind: "sfx" });
  assert.equal(result.status, "no-confident-match"); assert.equal(searched, 1); assert.ok(result.materials);
  await assert.rejects(obtainWithMaterials(library, forbidden, forbidden, { keyword: "雨声", source: "invalid" }), /source/);
}));
