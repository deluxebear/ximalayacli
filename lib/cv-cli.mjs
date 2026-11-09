import { Client } from "./client.mjs";
import { AudioLibrary } from "./audio-library.mjs";
import { CvClient, cvId } from "./cv.mjs";
import { exportAudio } from "./music.mjs";
import { localCvItems, searchLocalCv, obtainCvAudio } from "./cv-local.mjs";

export async function runCvCommand(a, v, p, config) {
  if (!["search", "samples", "get", "obtain"].includes(a[1])) throw new Error("cv 支持 search/samples/get/obtain");
  const library = new AudioLibrary(p.audioLibrary);
  if (v.refresh && v.offline) throw new Error("--refresh 与 --offline 不能同时使用");
  const loadRemote = async () => new CvClient(await Client.from(p.auth, {
    retries: config.retry_count, timeout: config.timeout_ms,
  }), p.cvCatalog);
  let result;
  const maxPages = v["max-pages"] === undefined ? undefined : Number(v["max-pages"]);
  const pagination = {};
  if (a[1] === "search") for (const [flag, key, fallback, max] of [["page", "page", 1, 10000], ["page-size", "pageSize", 20, 100]]) {
    const n = v[flag] === undefined ? fallback : Number(v[flag]);
    if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`${flag} 必须是 1 到 ${max} 的整数`);
    pagination[key] = n;
  }
  if (a[1] === "get") {
    const key = `cv:${cvId(v["cv-id"])}:${cvId(v.id)}`;
    const cached = await library.get(key);
    if (cached) result = { ok: true, source: "local", reused: true, item: cached };
    else if (v.offline) result = { ok: false, status: "not-cached", id: key };
  } else if (a[1] === "obtain") {
    const seconds = (key) => {
      if (v[key] === undefined) return undefined;
      if (!String(v[key]).trim() || !Number.isFinite(Number(v[key])) || Number(v[key]) < 0) throw new Error(`${key} 必须是非负秒数`);
      return Number(v[key]);
    };
    result = await obtainCvAudio(library, loadRemote, { keyword: v.keyword, cv: v["cv-id"], offline: !!v.offline,
      minDuration: seconds("min-duration"), maxDuration: seconds("max-duration"), maxPages });
  } else if (!v.refresh) {
    const items = searchLocalCv(await localCvItems(library, p.cvCatalog, { cv: a[1] === "samples" ? cvId(v.id) : undefined }),
      a[1] === "search" ? v.keyword : "");
    if (items.length || v.offline) result = a[1] === "samples" ?
      { ok: items.length > 0, source: "local", cachedOnly: true, ...(items.length ? { item: items[0] } : { status: "no-local-match", items: [] }) } :
      { ok: true, source: "local", cachedOnly: true, totalCount: items.length, ...pagination,
        totalPages: Math.ceil(items.length / pagination.pageSize),
        items: items.slice((pagination.page - 1) * pagination.pageSize, pagination.page * pagination.pageSize) };
  }
  if (!result) {
    if (a[1] === "samples") cvId(v.id);
    const remote = await loadRemote();
    if (a[1] === "search") result = await remote.search({ keyword: v.keyword, ...pagination });
    else if (a[1] === "samples") result = await remote.samples(v.id, { maxPages });
    else result = await remote.get(library, { id: v.id, cv: v["cv-id"], maxPages });
  }
  if (["get", "obtain"].includes(a[1]) && result.item && v.output) result.item = await exportAudio(result.item, v.output);
  return result;
}
