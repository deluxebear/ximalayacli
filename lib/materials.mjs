import { createHash } from "node:crypto";
import { runBatch } from "./batch.mjs";
import { readJson } from "./config.mjs";
import { downloadAudio } from "./music.mjs";

const ORIGIN = "https://aigc.ximalaya.com";
const BASE = ORIGIN + "/voice-studio-music/material-pack";
const HEADERS = { origin: ORIGIN, referer: ORIGIN + "/ai-materials" };
export function materialId(value, name = "ID") {
  if (typeof value !== "string" || !value.trim() || value.length > 150 ||
      !/^[\p{L}\p{N}_.-]+$/u.test(value)) throw new Error(`${name} 仅支持文字、数字、点、下划线和横线`);
  return value;
}
function positive(value, name, max = 10000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} 必须是 1 到 ${max} 的整数`);
  return value;
}
function matching(item, keyword) {
  const text = `${item.name || ""} ${item.description || ""}`.normalize("NFKC").toLowerCase();
  return String(keyword || "").normalize("NFKC").toLowerCase().split(/\s+/u).filter(Boolean).every((word) => text.includes(word));
}
function pick(raw, fields) {
  return Object.fromEntries(fields.filter((k) => raw[k] !== undefined).map((k) => [k, raw[k]]));
}
function itemInfo(raw) {
  materialId(raw.itemId, "素材 ID");
  return { ...pick(raw, ["itemId", "name", "description", "previewable"]),
    ...(typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) && raw.durationMs >= 0 ? { duration: raw.durationMs / 1000 } : {}) };
}
function packInfo(raw) {
  materialId(raw.packId, "素材包 ID");
  return { ...pick(raw, ["packId", "name", "description", "musicType", "library", "accessType",
    "priceStarPoints", "purchased", "imported", "itemCount", "downloadCount", "smartPostUseCount"]),
    kind: raw.musicType === 1 ? "sfx" : "music" };
}
const fingerprint = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const previewId = (packId, itemId) => `preview:${fingerprint({ packId, itemId })}`;
export function cloudAudioId(id, teamId) {
  positive(Number(id), "id", Number.MAX_SAFE_INTEGER);
  if (teamId !== undefined) positive(Number(teamId), "team-id", Number.MAX_SAFE_INTEGER);
  return `aigc:${teamId === undefined ? "personal" : `team-${Number(teamId)}`}:${Number(id)}`;
}

export class MaterialsClient {
  constructor(client, { teamId, journal, download = downloadAudio } = {}) {
    if (teamId !== undefined) positive(Number(teamId), "team-id", Number.MAX_SAFE_INTEGER);
    this.client = client;
    this.scope = teamId === undefined ? { roleType: 1 } : { roleType: 2, teamId: Number(teamId) };
    this.journal = journal;
    this.download = download;
  }
  url(path, params = {}) { return BASE + path + "?" + new URLSearchParams({ ...params, ...this.scope }); }
  async request(path, body) {
    const reply = await this.client.request(body === undefined ? this.url(path.path || path, path.params) : BASE + path, {
      headers: HEADERS,
      ...(body === undefined ? {} : { method: "POST", body: { ...body, ...this.scope, clientVersion: "2" }, retry: false }),
    });
    if (reply.code !== 200000) {
      const error = new Error(`素材包接口错误 ${reply.code}：${reply.message || reply.msg || "请检查账号权限"}`);
      // 业务拒绝是已知失败；网络/格式错误仍由任务记录为 uncertain。
      error.safeToRetry = true;
      throw error;
    }
    return reply.data;
  }
  async list({ library = "ai", kind = "music", access = "all", keyword = "" } = {}) {
    if (!["ai", "xmly"].includes(library)) throw new Error("library 支持 ai/xmly");
    if (!["music", "sfx"].includes(kind)) throw new Error("素材包 kind 支持 music/sfx");
    if (!["all", "free", "limited", "member", "paid"].includes(access)) throw new Error("access 支持 all/free/limited/member/paid");
    const data = await this.request({ path: "/list", params: { library, musicType: kind === "music" ? 2 : 1 } });
    if (!Array.isArray(data)) throw new Error("素材包列表格式无效");
    const items = data.map(packInfo).filter((x) => (access === "all" || x.accessType === access) && matching(x, keyword));
    return { ok: true, library, kind, access, keyword, totalCount: items.length, items };
  }
  async detail(packId) {
    materialId(packId, "pack-id");
    const data = await this.request({ path: "/detail", params: { packId } });
    if (!data || data.packId !== packId || !Array.isArray(data.items)) throw new Error("素材包详情格式或 ID 无效");
    return { ...packInfo(data), items: data.items.map(itemInfo) };
  }
  async items(packId, { keyword = "", page = 1, pageSize = 20 } = {}) {
    positive(page, "page"); positive(pageSize, "page-size", 100);
    const pack = await this.detail(packId);
    const items = pack.items.filter((x) => matching(x, keyword));
    const { items: _, ...info } = pack;
    return { ok: true, pack: info, keyword, page, pageSize, totalCount: items.length,
      totalPages: Math.ceil(items.length / pageSize), items: items.slice((page - 1) * pageSize, page * pageSize)
        .map((x) => ({ ...x, previewLibraryId: previewId(packId, x.itemId) })) };
  }
  async preview(library, packId, itemId) {
    materialId(packId, "pack-id"); materialId(itemId, "id");
    const id = previewId(packId, itemId);
    const cached = await library.get(id);
    if (cached) return { ok: true, preview: true, source: "local", reused: true, item: cached };
    const pack = await this.detail(packId), item = pack.items.find((x) => x.itemId === itemId);
    if (!item || item.previewable === false) throw new Error("该素材不在包内或不允许试听");
    const url = this.url("/preview", { packId, itemId });
    const result = await library.acquire({ id, kind: "preview", source: "ximalaya-material-preview",
      title: `${pack.name} / ${item.name}`, tags: [pack.name, "试听片段"],
    }, ({ destination }) => this.downloadAuthenticated(url, destination));
    return { ok: true, preview: true, source: result.reused ? "local" : "remote", ...result };
  }
  downloadAuthenticated(url, destination) {
    return this.download(url, destination, {
      fetchImpl: (target, options) => this.client.fetch(target, { ...options,
        // 只向已观察到的第一方音频端点携带凭据，跳转后的 CDN 不带认证。
        ...(target === url ? { headers: { ...HEADERS, cookie: this.client.cookie(target) } } : {}),
      }),
    });
  }
  async cloud(path, params) {
    const reply = await this.client.request(ORIGIN + "/voice-studio-music" + path + "?" + new URLSearchParams(params), { headers: HEADERS });
    if (reply.code !== 200000) throw new Error(`云端素材库错误 ${reply.code}：${reply.message || reply.msg || "请检查账号权限"}`);
    return reply.data;
  }
  musicType(kind = "music") {
    if (!["music", "sfx"].includes(kind)) throw new Error("云端素材 kind 支持 music/sfx");
    return kind === "music" ? 2 : 1;
  }
  listScope() {
    const { roleType, ...rest } = this.scope;
    return { type: roleType, ...rest };
  }
  async groups({ kind = "music" } = {}) {
    const data = await this.cloud("/group/list", { groupType: this.musicType(kind), ...this.listScope() });
    if (!Array.isArray(data)) throw new Error("云端分组列表格式无效");
    return { ok: true, kind, items: data.map((x) => pick(x, ["groupId", "groupName", "groupType", "musicCount", "path", "sequence"])) };
  }
  audioInfo(raw) {
    positive(raw.musicId, "musicId", Number.MAX_SAFE_INTEGER);
    if (![1, 2].includes(raw.musicType)) throw new Error("云端音频类型无效");
    return { id: cloudAudioId(raw.musicId, this.scope.teamId), trackId: String(raw.musicId),
      title: String(raw.musicName || raw.musicId), kind: raw.musicType === 1 ? "sfx" : "music",
      source: "ximalaya-aigc-library", tags: raw.musicDesc ? [String(raw.musicDesc)] : [],
      ...(typeof raw.duration === "number" && Number.isFinite(raw.duration) && raw.duration >= 0 ? { duration: raw.duration / 1000 } : {}) };
  }
  async libraryList({ kind = "music", groupId, keyword = "", page = 1, pageSize = 20 } = {}) {
    positive(page, "page"); positive(pageSize, "page-size", 100);
    if (groupId !== undefined) positive(Number(groupId), "group-id", Number.MAX_SAFE_INTEGER);
    const data = await this.cloud("/music/list", { musicType: this.musicType(kind), ...this.listScope(),
      pageNum: page, pageSize, queryText: keyword, subGroup: 0,
      ...(groupId === undefined ? {} : { groupId }) });
    if (!Array.isArray(data?.list)) throw new Error("云端音频列表格式无效");
    return { ok: true, kind, page, pageSize, totalCount: data.totalCount, totalPages: data.pageCount,
      items: data.list.map((x) => this.audioInfo(x)) };
  }
  async getAudio(library, id) {
    const key = cloudAudioId(id, this.scope.teamId);
    const cached = await library.get(key);
    if (cached) return { ok: true, source: "local", reused: true, item: cached };
    const raw = await this.cloud("/music/detail", { musicId: Number(id), ...this.scope });
    if (raw?.musicId !== Number(id)) throw new Error("云端音频详情 ID 不匹配");
    const info = this.audioInfo(raw);
    const url = ORIGIN + "/voice-studio-music/music/audio?" + new URLSearchParams({ musicId: Number(id), ...this.scope });
    const result = await library.acquire(info, ({ destination }) => this.downloadAuthenticated(url, destination));
    return { ok: true, source: result.reused ? "local" : "remote", ...result };
  }
  importKey(packId) { return fingerprint({ operation: "materials-import-prepare", packId, scope: this.scope }); }
  async importPack(packId, { dryRun = false, retryFailed = false, itemIds: selectedIds } = {}) {
    const pack = await this.detail(packId), prepareId = this.importKey(packId);
    if (selectedIds !== undefined && (!Array.isArray(selectedIds) || !selectedIds.length ||
        new Set(selectedIds).size !== selectedIds.length || selectedIds.some((id) => !pack.items.some((x) => x.itemId === id))))
      throw new Error("选中的素材 ID 不在包内或重复");
    const { items: _, ...info } = pack;
    const plan = { ok: true, dryRun, pack: info, scope: this.scope,
      effect: "在音剪云端创建同名分组，每批导入5条素材", prepareId,
      requests: { prepare: { packId, ...this.scope, clientVersion: "2" }, chunkSize: 5 } };
    if (dryRun) return plan;
    if (!pack.items.length) throw new Error("素材包为空，无法导入");
    if (!["free", "limited", "member", "paid"].includes(pack.accessType)) throw new Error("未知素材访问类型，无法导入");
    if (["member", "paid"].includes(pack.accessType) && this.scope.roleType !== 2) throw new Error("会员/付费素材包需要 --team-id 制作组ID");
    if (pack.accessType === "paid" && !pack.purchased) throw new Error("该素材包尚未购买，请先在网页明确购买后再导入");
    const state = await readJson(this.journal, { jobs: {} });
    if (pack.imported && !state.jobs[prepareId])
      return { ok: true, status: "already-imported", pack: info, message: "云端已有该素材包；未重复新建分组" };
    const run = (id, execute) => runBatch([{ id }], { journal: this.journal, retryFailed, execute });
    const prepared = await run(prepareId, async () => {
      const result = await this.request("/import/prepare", { packId });
      if (!result?.groupId || !Array.isArray(result.itemIds) || !result.itemIds.length ||
          result.itemIds.some((id) => !pack.items.some((x) => x.itemId === id)) ||
          new Set(result.itemIds).size !== result.itemIds.length)
        throw new Error("导入准备响应格式无效；请核对云端新分组，避免重复创建");
      return { groupId: result.groupId, groupName: result.groupName || pack.name, itemIds: result.itemIds };
    });
    if (!prepared.ok) return { ...prepared, status: "needs-review", pack: info, prepareId };
    const preparation = prepared.items[0].result;
    if (!preparation?.groupId || !Array.isArray(preparation.itemIds)) throw new Error("任务记录缺少导入分组信息，请核对 jobs list");
    const { groupId, groupName } = preparation;
    const itemIds = selectedIds || preparation.itemIds;
    if (itemIds.some((id) => !preparation.itemIds.includes(id))) throw new Error("所选素材不在已保存的导入准备记录中，请先核对云端分组");
    const chunks = [];
    for (let offset = 0; offset < itemIds.length; offset += 5) {
      const ids = itemIds.slice(offset, offset + 5);
      const id = fingerprint({ operation: "materials-import-chunk", prepareId, groupId, itemIds: ids });
      const batch = await run(id, async () => {
        const result = await this.request("/import/chunk", { packId, groupId, itemIds: ids });
        if (!Number.isSafeInteger(result?.success) || !Number.isSafeInteger(result?.failed) ||
            result.success < 0 || result.failed < 0 || result.success + result.failed !== ids.length)
          throw new Error("导入分批响应计数无效；请核对云端分组后处理任务记录");
        return { success: result.success, failed: result.failed,
          failItems: (result.failItems || []).map((x) => pick(x, ["itemId", "name", "reason"])) };
      });
      chunks.push(...batch.items);
      if (!batch.ok) return { ok: false, status: "needs-review", prepareId, groupId, groupName, chunks };
      const saved = batch.items[0].result;
      if (!Number.isSafeInteger(saved?.success) || !Number.isSafeInteger(saved?.failed) ||
          saved.success < 0 || saved.failed < 0 || saved.success + saved.failed !== ids.length)
        throw new Error("任务记录缺少有效导入计数；请核对云端分组和 jobs list，勿直接标记 done");
    }
    const success = chunks.reduce((n, x) => n + x.result.success, 0), failed = chunks.reduce((n, x) => n + x.result.failed, 0);
    return { ok: failed === 0, status: failed ? "partial" : "done", prepareId, groupId, groupName,
      total: itemIds.length, success, failed, chunks };
  }
}
