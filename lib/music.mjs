import { createWriteStream } from "node:fs";
import { copyFile, mkdir, open } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { readJson, saveJson } from "./config.mjs";
import { rankAudioItems } from "./audio-library.mjs";

const ORIGIN = "https://studio.ximalaya.com";
const BASE = ORIGIN + "/music-web";
export const MUSIC_KINDS = ["music", "intro", "sfx", "transition"];
export function validateKind(kind = "music") {
  if (!MUSIC_KINDS.includes(kind))
    throw new Error("kind 支持 music（配乐）/intro（片头片尾）/sfx（音效）/transition（转场音效）");
  return kind;
}
function numericId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw new Error("素材 id 必须是正整数");
  return String(value);
}
function pageNumber(value, name, max = 10000) {
  if (!Number.isInteger(value) || value < 1 || value > max)
    throw new Error(`${name} 必须是 1 到 ${max} 的整数`);
  return value;
}
export function durationFilter(items, { minDuration, maxDuration } = {}) {
  for (const value of [minDuration, maxDuration])
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      throw new Error("时长必须是非负秒数");
  if (minDuration !== undefined && maxDuration !== undefined && minDuration > maxDuration)
    throw new Error("最短时长不能大于最长时长");
  return items.filter((x) =>
    (minDuration === undefined || (x.duration != null && x.duration >= minDuration)) &&
    (maxDuration === undefined || (x.duration != null && x.duration <= maxDuration)));
}
export function normalizeMusic(raw, kind, category) {
  const acoustic = kind === "sfx" || kind === "transition";
  const trackId = numericId(acoustic ? raw.id : raw.trackId);
  const duration = acoustic ? raw.duration / 1000 :
    raw.millDuration != null ? raw.millDuration / 1000 : raw.coverPath ? raw.duration / 1000 : raw.duration;
  return {
    id: `${kind}:${trackId}`, trackId, kind,
    title: (acoustic ? raw.nickname : raw.musicName) || `素材 ${trackId}`,
    tags: Array.isArray(raw.subCategoryName) ? raw.subCategoryName : [],
    ...(category ? { category: String(category) } : {}),
    ...(Number.isFinite(duration) && duration >= 0 ? { duration } : {}),
    source: "ximalaya-music-library",
  };
}
export function mediaUrl(value) {
  const u = new URL(value);
  if (!(u.hostname === "xmcdn.com" || u.hostname.endsWith(".xmcdn.com") ||
      u.hostname === "ximalaya.com" || u.hostname.endsWith(".ximalaya.com")) ||
      u.username || u.password || (u.port && u.port !== "443"))
    throw new Error("音频下载地址必须属于喜马拉雅官方 CDN");
  if (u.protocol === "http:") u.protocol = "https:";
  if (u.protocol !== "https:") throw new Error("音频下载只允许 HTTPS");
  return u.href;
}
export function audioExtension(bytes) {
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WAVE") return ".wav";
  if (bytes.subarray(4, 8).toString() === "ftyp") return ".m4a";
  if (bytes.subarray(0, 4).toString() === "OggS") return ".ogg";
  if (bytes.subarray(0, 4).toString() === "fLaC") return ".flac";
  if (bytes.subarray(0, 3).toString() === "ID3") return ".mp3";
  if (bytes.length >= 2 && bytes[0] === 255 && (bytes[1] & 0xe0) === 0xe0)
    return (bytes[1] & 0xf6) === 0xf0 ? ".aac" : ".mp3";
  throw new Error("文件不是支持的音频格式（拒绝 HTML、JSON 或未知文件）");
}
export async function checkAudioFile(path) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return audioExtension(buffer.subarray(0, bytesRead));
  } finally { await handle.close(); }
}
// 读取容器头，不依赖 ffprobe；其余格式的时长沿用平台搜索元数据。
export async function audioDuration(path, extension) {
  if (![".m4a", ".wav"].includes(extension)) return undefined;
  const file = await open(path, "r");
  try {
    const { size } = await file.stat();
    const read = async (position, length) => {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, position);
      return buffer.subarray(0, bytesRead);
    };
    if (extension === ".m4a") {
      let boxes = 0;
      const find = async (start, end, depth = 0) => {
        for (let pos = start; pos + 8 <= end && boxes++ < 10000;) {
          const header = await read(pos, 16);
          if (header.length < 8) break;
          let length = header.readUInt32BE(0), head = 8;
          if (length === 1) {
            if (header.length < 16) break;
            const big = header.readBigUInt64BE(8);
            if (big > BigInt(Number.MAX_SAFE_INTEGER)) break;
            length = Number(big); head = 16;
          } else if (length === 0) length = end - pos;
          if (length < head || pos + length > end) break;
          const type = header.subarray(4, 8).toString();
          if (type === "moov" && depth === 0) {
            const duration = await find(pos + head, pos + length, 1);
            if (duration !== undefined) return duration;
          } else if (type === "mvhd" && depth === 1) {
            const body = await read(pos + head, Math.min(32, length - head));
            if (body.length < 20) return undefined;
            const version = body[0];
            const offset = version === 1 ? 20 : version === 0 ? 12 : -1;
            if (offset < 0 || body.length < offset + (version === 1 ? 12 : 8)) return undefined;
            const timescale = body.readUInt32BE(offset);
            const ticks = version === 1 ? Number(body.readBigUInt64BE(offset + 4)) : body.readUInt32BE(offset + 4);
            return timescale > 0 && ticks > 0 ? ticks / timescale : undefined;
          }
          pos += length;
        }
      };
      return await find(0, size);
    }
    let byteRate, dataLength, chunks = 0;
    for (let pos = 12; pos + 8 <= size && chunks++ < 10000;) {
      const header = await read(pos, 8);
      if (header.length < 8) break;
      const type = header.subarray(0, 4).toString(), length = header.readUInt32LE(4);
      if (pos + 8 + length > size) break;
      if (type === "fmt " && length >= 12) {
        const fmt = await read(pos + 8, 12);
        if (fmt.length === 12) byteRate = fmt.readUInt32LE(8);
      } else if (type === "data") dataLength = length;
      pos += 8 + length + length % 2;
    }
    return byteRate > 0 && dataLength > 0 ? dataLength / byteRate : undefined;
  } finally { await file.close(); }
}
// CDN 请求不携带 Cookie；每次重定向均重新检查域名。
export async function downloadAudio(url, destination, {
  fetchImpl = fetch, timeoutMs = 120000, maxBytes = 300 * 1024 * 1024,
} = {}) {
  let current = mediaUrl(url), response;
  const signal = AbortSignal.timeout(timeoutMs);
  for (let redirect = 0; redirect <= 5; redirect++) {
    response = await fetchImpl(current, { redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirect === 5) throw new Error("音频下载重定向异常");
    current = mediaUrl(new URL(location, current).href);
  }
  if (!response.ok || !response.body) throw new Error(`音频下载失败 HTTP ${response.status}`);
  if (/text\/|json|html/i.test(response.headers.get("content-type") || "")) {
    await response.body.cancel(); throw new Error("下载返回了文本或登录页面，而非音频");
  }
  const expected = Number(response.headers.get("content-length")) || undefined;
  if (expected > maxBytes) { await response.body.cancel(); throw new Error("音频文件超过下载大小限制"); }
  let size = 0;
  const limiter = new Transform({ transform(chunk, _, callback) {
    size += chunk.length;
    callback(size > maxBytes ? new Error("音频文件超过下载大小限制") : null, chunk);
  }});
  await pipeline(Readable.fromWeb(response.body), limiter,
    createWriteStream(destination, { flags: "wx", mode: 0o600 }), { signal });
  if (!size || (expected && !response.headers.get("content-encoding") && size !== expected))
    throw new Error("下载不完整，文件长度不一致");
  const extension = await checkAudioFile(destination);
  const duration = await audioDuration(destination, extension);
  return { bytes: size, extension, ...(duration !== undefined ? { duration } : {}) };
}
export async function exportAudio(item, output) {
  if (!output) return item;
  const extension = await checkAudioFile(item.path);
  const target = resolve(output);
  if (target === item.path) return { ...item, output: target };
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  try { await copyFile(item.path, target, constants.COPYFILE_EXCL); }
  catch (e) { if (e.code === "EEXIST") throw new Error(`输出文件已存在，不覆盖：${target}`); throw e; }
  return { ...item, output: target, extension };
}

export class MusicClient {
  constructor(client, catalogDir, { download = downloadAudio } = {}) {
    this.client = client; this.catalogDir = catalogDir; this.download = download;
  }
  async request(path, options) {
    const result = await this.client.request(BASE + path, options);
    if (result.code !== 200)
      throw new Error(result.code === 6001 ? "当前账号尚未完成主播身份认证，平台不允许下载素材" :
        `素材库接口错误 ${result.code}：${result.msg || "未知错误"}`);
    return result.data;
  }
  async categories(kind = "music") {
    validateKind(kind);
    return this.request(kind === "sfx" || kind === "transition" ?
      "/api/acoustic/listAcousticCategory" : "/web/getWebCategories");
  }
  catalogPath(kind, id) {
    return join(this.catalogDir, validateKind(kind), numericId(id) + ".json");
  }
  async search({ keyword = "", kind = "music", category, page = 1, pageSize,
    minDuration, maxDuration } = {}) {
    validateKind(kind);
    pageNumber(page, "page");
    pageSize ??= kind === "music" || kind === "intro" ? 12 : 24;
    pageNumber(pageSize, "page-size", 100);
    durationFilter([], { minDuration, maxDuration });
    if (category !== undefined) numericId(category);
    let data;
    if (kind === "music" || kind === "intro") {
      data = await this.request("/web/fuzzySearchMusics", { method: "POST", body: {
        subCategoryIds: category ? [Number(category)] : [], fuzzyWord: keyword,
        pageSize, pageNo: page, businessId: 3, relationType: kind === "music" ? 2 : 4,
      }, retry: true }); // 官网的 POST 搜索是只读操作。
    } else {
      const params = new URLSearchParams({ keyword, pageSize, pageNo: page,
        musicType: 3, businessId: 3, relationType: kind === "sfx" ? 3 : 5 });
      if (category) params.set("categoryId", category);
      data = await this.request(`/api/acoustic/${kind === "sfx" ? "searchCategory" : "searchTransition"}?${params}`);
    }
    if (!Array.isArray(data?.result)) throw new Error("素材库返回了无法识别的搜索结果");
    // 某些音乐搜索结果含宽泛召回，不能把请求中的分类当成每个结果的事实。
    let categoryName;
    if (category && (kind === "music" || kind === "intro")) {
      const categories = await this.categories(kind);
      categoryName = categories.find((x) => String(x.id) === String(category))?.name;
      if (!categoryName) throw new Error("未找到该配乐分类，请先运行 music categories");
    }
    const items = [];
    for (const raw of data.result) {
      const item = normalizeMusic(raw, kind,
        categoryName ? raw.subCategoryName?.includes(categoryName) ? category : undefined : category);
      // 保存搜索记录以支持音效按 ID 下载；二进制缓存索引不保存播放/下载 URL。
      await saveJson(this.catalogPath(kind, item.trackId), { item,
        playPath: raw.playPath || null, searchedAt: new Date().toISOString() });
      if (!category || item.category === String(category)) items.push(item);
    }
    return { ok: true, source: "remote", kind, keyword, page, pageSize,
      totalCount: data.totalCount, totalPages: data.totalPage,
      items: durationFilter(items, { minDuration, maxDuration }) };
  }
  async get(library, { id, kind = "music", offline = false } = {}) {
    validateKind(kind); id = numericId(id);
    const key = `${kind}:${id}`;
    const cached = await library.get(key);
    if (cached) return { ok: true, source: "local", reused: true, item: cached };
    if (offline) return { ok: false, status: "not-cached", id: key };
    const record = await readJson(this.catalogPath(kind, id), null);
    let metadata = record?.item || { id: key, trackId: id, kind, source: "ximalaya-music-library" };
    const result = await library.acquire(metadata, async ({ destination }) => {
      let url;
      if (kind === "music" || kind === "intro") {
        const info = await this.request(`/web/getDownloadInfo?trackId=${id}`);
        if (!info?.downloadPath) throw new Error("素材库未返回下载地址");
        url = info.downloadPath;
        if (!metadata.title) metadata.title = String(info.fileName || `素材 ${id}`).replace(/\.[^.]+$/, "");
      } else {
        if (!record?.playPath) throw new Error("此音效尚无搜索记录，请先运行 music search --kind " + kind + " --keyword 关键词");
        await this.request("/api/acoustic/checkCanDownload");
        url = record.playPath;
      }
      const downloaded = await this.download(url, destination);
      return { ...downloaded, metadata: {
        ...(metadata.title ? { title: metadata.title } : {}),
        ...(metadata.duration === undefined && downloaded?.duration !== undefined ? { duration: downloaded.duration } : {}),
      } };
    });
    return { ok: true, source: result.reused ? "local" : "remote", ...result };
  }
}

// 先检查本地完整文件，命中后无需读取 auth.json 或请求任何网络接口。
export async function obtainAudio(library, loadRemote, {
  keyword, kind = "music", category, minDuration, maxDuration,
  offline = false, maxPages = 3, pageSize,
} = {}) {
  if (typeof keyword !== "string" || !keyword.trim()) throw new Error("obtain 需要 --keyword 描述所需音频");
  validateKind(kind);
  pageNumber(maxPages, "max-pages", 20);
  const filters = { kind, category, minDuration, maxDuration };
  durationFilter([], filters);
  const matches = await library.search(keyword, filters);
  if (matches.length) return { ok: true, source: "local", reused: true, item: matches[0] };
  if (offline) return { ok: false, status: "no-local-match", keyword, items: [] };
  const remote = await loadRemote();
  const candidates = [];
  for (let page = 1; page <= maxPages; page++) {
    const found = await remote.search({ keyword, ...filters, page, pageSize });
    candidates.push(...found.items);
    const ranked = rankAudioItems(found.items, keyword, filters);
    if (ranked.length) {
      const choice = ranked[0];
      const got = await remote.get(library, { id: choice.trackId, kind });
      return { ...got, match: { score: choice.score, reason: choice.reason }, searchedPages: page };
    }
    if (page >= found.totalPages || found.totalCount === 0) break;
  }
  return { ok: false, status: "no-confident-match", keyword,
    message: "没有足够匹配的素材；请调整关键词，或从 search 结果按 ID 明确选择。",
    items: candidates };
}
