import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir, open, lstat, chmod, copyFile,
  rename, rm,
} from "node:fs/promises";
import { join, resolve, extname, basename } from "node:path";
import { readJson, saveJson } from "./config.mjs";

const extensions = new Set(["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "webm", "audio"]);
const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase().trim();
const strings = (value) => [...new Set((Array.isArray(value) ? value : value ? [value] : [])
  .map((x) => String(x).trim()).filter(Boolean))].slice(0, 200);
const validId = (id) => typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:_.-]{0,199}$/.test(id);
const aliases = [
  [/(?:下雨的声音|下雨声|降雨声|下雨)/gu, "雨声"],
  [/(?:刮风的声音|刮风声|刮风)/gu, "风声"],
  [/(?:鸟叫的声音|鸟鸣声|鸟叫声|鸟鸣|鸟叫)/gu, "鸟声"],
  [/(?:流水的声音|流水声|流水)/gu, "水流声"],
];
function canonical(value) {
  let result = normalize(value).replace(/<[^>]*>/gu, " ");
  for (const [pattern, replacement] of aliases) result = result.replace(pattern, replacement);
  return result;
}
function searchTokens(query) {
  const text = canonical(query)
    .replace(/(?:请帮我|帮我|我需要|需要|我想要|寻找|找一段|一段|一个|一些|适合|用于|背景音乐|背景音|音频素材|音效素材|音频|素材|音效|的声音)/gu, " ")
    .replace(/的/gu, " ");
  return [...new Set(text.split(/[^\p{L}\p{N}]+/u).filter((x) => x.length >= 2))];
}
function containsTerm(text, term) {
  if (/[\p{Script=Han}]/u.test(term)) return text.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(text);
}

async function fingerprint(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.size === 0) throw new Error("音频文件必须是非空普通文件");
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  if (!bytes) throw new Error("音频文件必须是非空普通文件");
  return { sha256: hash.digest("hex"), bytes };
}
function metadata(input) {
  const id = String(input.id ?? (input.trackId !== undefined ? `${input.kind || "music"}:${input.trackId}` : ""));
  if (!validId(id)) throw new Error("素材 ID 仅支持字母、数字、冒号、点、下划线和横线");
  const result = {
    id,
    title: String(input.title || id).slice(0, 1000),
    tags: strings(input.tags),
    searchTerms: strings(input.searchTerms),
  };
  for (const key of ["trackId", "category", "kind"])
    if (input[key] !== undefined) result[key] = String(input[key]).slice(0, 200);
  if (input.source !== undefined) {
    if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(String(input.source)))
      throw new Error("source 应为来源名称，不能保存下载链接");
    result.source = String(input.source);
  }
  if (input.duration !== undefined) {
    const n = Number(input.duration);
    if (!Number.isFinite(n) || n < 0) throw new Error("素材时长必须是非负秒数");
    result.duration = n;
  }
  return result;
}

/** Conservative keyword ranking shared by remote selection and local reuse. */
export function rankAudioItems(items, query, {
  kind, category, minDuration, maxDuration, limit = 20, minScore = 0.75,
} = {}) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("limit 必须为正整数");
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1)
    throw new Error("minScore 必须在 0 到 1 之间");
  for (const n of [minDuration, maxDuration])
    if (n !== undefined && (!Number.isFinite(Number(n)) || Number(n) < 0))
      throw new Error("时长过滤必须为非负秒数");
  if (minDuration !== undefined && maxDuration !== undefined && Number(minDuration) > Number(maxDuration))
    throw new Error("最短时长不能超过最长时长");
  const tokens = searchTokens(query);
  if (!tokens.length) return [];
  const results = [];
  for (const item of items) {
    if (kind !== undefined && normalize(item.kind) !== normalize(kind)) continue;
    if (category !== undefined && normalize(item.category) !== normalize(category)) continue;
    if (minDuration !== undefined && !(item.duration >= Number(minDuration))) continue;
    if (maxDuration !== undefined && !(item.duration <= Number(maxDuration))) continue;
    const fields = [
      ...strings(item.tags).map((x) => ({ type: "标签", value: canonical(x) })),
      { type: "标题", value: canonical(item.title) },
    ];
    // Saved query history is provenance, not proof of suitability. User-added tags
    // are the explicit mechanism for teaching the library additional uses.
    const matches = tokens.map((token) => {
      const exact = fields.find((field) => field.value === token);
      const field = exact || fields.find((f) => containsTerm(f.value, token));
      return field ? { token, type: field.type, score: exact ? 1 : 0.9 } : null;
    });
    if (matches.some((x) => !x)) continue;
    const score = Math.round(matches.reduce((n, x) => n + x.score, 0) / matches.length * 100) / 100;
    if (score >= minScore) results.push({ ...item, score, reason: matches.map((x) => `${x.type}匹配：${x.token}`) });
  }
  return results.sort((a, b) => b.score - a.score || (b.lastUsedAt || "").localeCompare(a.lastUsedAt || ""))
    .slice(0, limit);
}

/** A private, content-addressed library. Download URLs and credentials are never indexed. */
export class AudioLibrary {
  constructor(libraryDir, { lockTimeoutMs = 30000 } = {}) {
    this.dir = resolve(libraryDir);
    this.indexPath = join(this.dir, "index.json");
    this.lockPath = join(this.dir, ".library.lock");
    this.lockTimeoutMs = lockTimeoutMs;
  }
  async index() {
    const index = await readJson(this.indexPath, { version: 1, items: [] });
    if (index.version !== 1 || !Array.isArray(index.items))
      throw new Error("本地音频库索引格式无效，请保留文件并检查 index.json");
    return index;
  }
  path(item) {
    if (!/^[a-f0-9]{64}$/.test(item.sha256) || !extensions.has(item.ext))
      throw new Error("本地音频库文件索引无效");
    return join(this.dir, "objects", `${item.sha256}.${item.ext}`);
  }
  async valid(item) {
    try {
      const actual = await fingerprint(this.path(item));
      return actual.sha256 === item.sha256 && actual.bytes === item.bytes;
    } catch (error) {
      if (["ENOENT", "EISDIR"].includes(error.code) || /音频文件必须/.test(error.message)) return false;
      throw error;
    }
  }
  exposed(item) { return { ...item, path: this.path(item) }; }
  async get(id) {
    const item = (await this.index()).items.find((x) => x.id === String(id));
    return item && await this.valid(item) ? this.exposed(item) : null;
  }
  async list({ verify = true } = {}) {
    const items = [];
    for (const item of (await this.index()).items)
      if (!verify || await this.valid(item)) items.push(this.exposed(item));
    return items;
  }
  async search(query, { verify = true, ...options } = {}) {
    return rankAudioItems(await this.list({ verify }), query, options);
  }
  async locked(action) {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const started = Date.now(), nonce = randomUUID();
    while (true) {
      try {
        const handle = await open(this.lockPath, "wx", 0o600);
        try { await handle.writeFile(JSON.stringify({ pid: process.pid, nonce })); }
        catch (error) { await rm(this.lockPath, { force: true }); throw error; }
        finally { await handle.close(); }
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        // Never delete a lock based on an earlier owner read: multiple waiters
        // could otherwise remove a new owner's lock after the old one exits.
        if (Date.now() - started >= this.lockTimeoutMs) {
          let owner;
          try { owner = await readJson(this.lockPath, null); } catch {}
          throw new Error(`本地音频库锁等待超时（持有者 PID ${owner?.pid || "未知"}）。请确认进程已结束后再手动移除 ${this.lockPath}`);
        }
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    try { return await action(); }
    finally {
      const owner = await readJson(this.lockPath, null);
      if (owner?.nonce === nonce) await rm(this.lockPath, { force: true });
    }
  }
  async acquire(input, download) {
    const meta = metadata(input);
    if (typeof download !== "function") throw new Error("需要 download 下载回调");
    return this.locked(async () => {
      const index = await this.index();
      const previous = index.items.find((x) => x.id === meta.id);
      const now = new Date().toISOString();
      if (previous && await this.valid(previous)) {
        Object.assign(previous, meta, {
          title: input.title === undefined ? previous.title : meta.title,
          tags: strings([...previous.tags, ...meta.tags]),
          searchTerms: strings([...previous.searchTerms, ...meta.searchTerms]),
          lastUsedAt: now, useCount: (previous.useCount || 0) + 1,
        });
        await saveJson(this.indexPath, index);
        return { reused: true, item: this.exposed(previous) };
      }
      const tempDir = join(this.dir, "tmp");
      await mkdir(tempDir, { recursive: true, mode: 0o700 });
      const ext = String(input.ext || previous?.ext || "audio").replace(/^\./, "").toLowerCase();
      const destination = join(tempDir, `${randomUUID()}.${extensions.has(ext) ? ext : "audio"}`);
      try {
        const downloaded = await download({ destination });
        const extra = downloaded?.metadata || {};
        if (typeof extra !== "object" || Array.isArray(extra)) throw new Error("下载回调 metadata 必须为对象");
        const identity = { id: meta.id, kind: meta.kind ?? previous?.kind, trackId: meta.trackId ?? previous?.trackId };
        for (const key of ["id", "kind", "trackId"])
          if (extra[key] !== undefined && String(extra[key]) !== String(identity[key]))
            throw new Error(`下载回调不能修改素材 ${key}`);
        // Repairs must retain user annotations and known fields when a fresh
        // by-ID response provides only partial metadata. Undefined is not an
        // instruction to discard existing values.
        const defined = (value) => Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
        const finalMeta = metadata({ ...previous, ...defined(input), ...defined(extra), ...identity,
          tags: strings([...(previous?.tags || []), ...strings(input.tags), ...strings(extra.tags)]),
          searchTerms: strings([...(previous?.searchTerms || []), ...strings(input.searchTerms), ...strings(extra.searchTerms)]),
        });
        const finalExt = String(downloaded?.extension || ext).replace(/^\./, "").toLowerCase();
        const fp = await fingerprint(destination);
        await chmod(destination, 0o600);
        const same = index.items.find((x) => x.sha256 === fp.sha256 && x.bytes === fp.bytes);
        const item = { ...finalMeta, ...fp, ext: same?.ext || (extensions.has(finalExt) ? finalExt : "audio"),
          createdAt: previous?.createdAt || now, lastUsedAt: now, useCount: (previous?.useCount || 0) + 1 };
        await mkdir(join(this.dir, "objects"), { recursive: true, mode: 0o700 });
        const target = this.path(item);
        if (!await this.valid(item)) await rename(destination, target);
        index.items = index.items.filter((x) => x.id !== meta.id);
        index.items.push(item);
        await saveJson(this.indexPath, index);
        return { reused: false, item: this.exposed(item) };
      } finally { await rm(destination, { force: true }); }
    });
  }
  async importFile(file, input = {}) {
    const source = resolve(file), fp = await fingerprint(source);
    return this.acquire({ source: "local", title: basename(source, extname(source)), ...input, id: input.id || `local:${fp.sha256}`,
      ext: input.ext || extname(source).slice(1) }, async ({ destination }) => {
      await copyFile(source, destination);
      const copied = await fingerprint(destination);
      if (copied.sha256 !== fp.sha256) throw new Error("导入期间源文件发生变化，请重试");
    });
  }
  async tag(id, tags) {
    return this.locked(async () => {
      const index = await this.index(), item = index.items.find((x) => x.id === String(id));
      if (!item) throw new Error("本地音频库中没有该素材");
      item.tags = strings([...item.tags, ...strings(tags)]);
      await saveJson(this.indexPath, index);
      return this.exposed(item);
    });
  }
}
