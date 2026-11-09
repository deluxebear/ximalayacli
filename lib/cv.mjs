import { join } from "node:path";
import { readJson, saveJson } from "./config.mjs";
import { downloadAudio } from "./music.mjs";

const ORIGIN = "https://aigc.ximalaya.com";
const BASE = ORIGIN + "/voice-studio-account/account/cv-market-store";
export function cvId(value) {
  const id = String(value ?? "").replace(/^cv-/, "");
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
    throw new Error("主播/样音 ID 必须是正整数，主播 ID 也支持 cv- 前缀");
  return id;
}
function pageNumber(value, name, max = 10000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error(`${name} 必须是 1 到 ${max} 的整数`);
  return value;
}
function normalize(raw) {
  const id = cvId(raw.cvInfoId ?? raw.id);
  if (!Array.isArray(raw.voiceSamples)) throw new Error("CV 墙样音列表格式无效");
  return {
    id, name: String(raw.name || `主播 ${id}`), description: String(raw.description || ""),
    skills: Array.isArray(raw.skills) ? raw.skills : [],
    samples: raw.voiceSamples.map((s) => {
      const sampleId = cvId(s.id);
      const duration = s.duration ?? s.durationSeconds ?? s.duration_seconds ??
        (typeof s.durationMs === "number" ? s.durationMs / 1000 : undefined);
      return { id: sampleId, libraryId: `cv:${id}:${sampleId}`, title: String(s.title || `样音 ${sampleId}`),
        ...(typeof duration === "number" && Number.isFinite(duration) && duration >= 0 ? { duration } : {}) };
    }),
  };
}

export class CvClient {
  constructor(client, catalogDir, { download = downloadAudio } = {}) {
    this.client = client;
    this.catalogDir = catalogDir;
    this.download = download;
  }
  catalogPath(id) { return join(this.catalogDir, cvId(id) + ".json"); }
  async page({ keyword = "", page = 1, pageSize = 20 } = {}) {
    pageNumber(page, "page"); pageNumber(pageSize, "page-size", 100);
    const response = await this.client.request(BASE + "/wall/list", {
      method: "POST", body: { keyword, pageNum: page, pageSize }, retry: true,
      headers: { origin: ORIGIN, referer: ORIGIN + "/cv-market-store" },
    });
    if (response.code !== 200000)
      throw new Error(`CV 墙接口错误 ${response.code}：${response.message || response.msg || "请检查登录状态"}`);
    if (!Array.isArray(response.data?.list)) throw new Error("CV 墙返回了无法识别的搜索结果");
    const data = response.data;
    const items = data.list.map(normalize);
    for (const item of items) await saveJson(this.catalogPath(item.id), { item });
    return { result: { ok: true, source: "remote", keyword, page, pageSize,
      totalCount: data.totalCount, totalPages: data.pageCount, items }, raw: data.list };
  }
  async search(options) { return (await this.page(options)).result; }
  async find(id, { maxPages = 20 } = {}) {
    id = cvId(id); pageNumber(maxPages, "max-pages", 100);
    const record = await readJson(this.catalogPath(id), null);
    // 名称只用于缩小候选；最终始终核对主播数字 ID。重名或改名则扫描列表。
    if (record?.item?.name) {
      const { raw } = await this.page({ keyword: record.item.name, pageSize: 100 });
      const match = raw.find((x) => cvId(x.cvInfoId ?? x.id) === id);
      if (match) return match;
    }
    for (let page = 1; page <= maxPages; page++) {
      const { result, raw } = await this.page({ page, pageSize: 50 });
      const match = raw.find((x) => cvId(x.cvInfoId ?? x.id) === id);
      if (match) return match;
      if (!raw.length || page >= result.totalPages) throw new Error(`未找到主播 ${id}`);
    }
    throw new Error(`在 ${maxPages} 页内未找到主播 ${id}；请先 cv search --keyword 主播名，或增大 --max-pages`);
  }
  async samples(id, options) {
    return { ok: true, source: "remote", item: normalize(await this.find(id, options)) };
  }
  async get(library, { id, cv, maxPages } = {}) {
    id = cvId(id); cv = cvId(cv);
    const key = `cv:${cv}:${id}`;
    const cached = await library.get(key);
    if (cached) return { ok: true, source: "local", reused: true, item: cached };
    const raw = await this.find(cv, { maxPages });
    const owner = normalize(raw), sample = owner.samples.find((x) => x.id === id);
    const url = raw.voiceSamples.find((x) => String(x.id) === id)?.url;
    if (!sample || !url) throw new Error(`主播 ${cv} 没有可下载的样音 ${id}`);
    const result = await library.acquire({ id: key, trackId: id, kind: "voice",
      title: `${owner.name} / ${sample.title}`, duration: sample.duration,
      tags: [owner.name, sample.title], source: "ximalaya-cv-wall" },
    ({ destination }) => this.download(url, destination));
    return { ok: true, source: result.reused ? "local" : "remote", ...result };
  }
}
