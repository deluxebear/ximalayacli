import { basename } from "node:path";
import { Client } from "./client.mjs";
import { AudioLibrary } from "./audio-library.mjs";
import { MusicClient, validateKind, checkAudioFile, audioDuration, exportAudio, obtainAudio,
  durationFilter } from "./music.mjs";

function number(value, name) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!String(value).trim() || !Number.isFinite(n) || n < 0)
    throw new Error(`${name} 必须是非负数`);
  return n;
}
function tags(value) {
  if (value === undefined) return [];
  const result = JSON.parse(value);
  if (!Array.isArray(result) || !result.every((x) => typeof x === "string"))
    throw new Error("tags 必须是字符串数组 JSON");
  return result;
}
export async function runMusicCommand(a, v, p, config) {
  const library = new AudioLibrary(p.audioLibrary);
  const kind = validateKind(v.kind || "music");
  const filters = { kind, category: v["category-id"],
    minDuration: number(v["min-duration"], "min-duration"),
    maxDuration: number(v["max-duration"], "max-duration") };
  durationFilter([], filters);
  const loadRemote = async () => new MusicClient(await Client.from(p.auth, {
    retries: config.retry_count, timeout: config.timeout_ms,
  }), p.musicCatalog);
  let result;
  if (a[1] === "categories") {
    if (v.offline) throw new Error("离线模式无法查询平台分类，请使用 music library list/search");
    result = { ok: true, kind, items: await (await loadRemote()).categories(kind) };
  } else if (a[1] === "search") {
    if (v.offline) {
      if (!v.keyword?.trim()) throw new Error("离线搜索需要 --keyword");
      result = { ok: true, source: "local", items: await library.search(v.keyword, filters) };
    } else result = await (await loadRemote()).search({ keyword: v.keyword, ...filters,
        page: number(v.page, "page"), pageSize: number(v["page-size"], "page-size") });
  } else if (a[1] === "get") {
    if (!/^[1-9]\d*$/.test(v.id || "") || !Number.isSafeInteger(Number(v.id)))
      throw new Error("music get 需要 --id 素材数字ID");
    const item = await library.get(`${kind}:${v.id}`);
    if (item) result = { ok: true, source: "local", reused: true, item };
    else if (v.offline) result = { ok: false, status: "not-cached", id: `${kind}:${v.id}` };
    else result = await (await loadRemote()).get(library, { id: v.id, kind });
  } else if (a[1] === "obtain") {
    result = await obtainAudio(library, loadRemote, { keyword: v.keyword, ...filters,
      offline: !!v.offline, maxPages: number(v["max-pages"], "max-pages"),
      pageSize: number(v["page-size"], "page-size") });
  } else if (a[1] === "library") {
    if (a[2] === "list") {
      let items = await library.list();
      if (v.kind) items = items.filter((x) => x.kind === kind);
      if (filters.category) items = items.filter((x) => x.category === filters.category);
      result = { ok: true, library: p.audioLibrary, items: durationFilter(items, filters) };
    } else if (a[2] === "search") {
      if (!v.keyword?.trim()) throw new Error("library search 需要 --keyword");
      result = { ok: true, source: "local", items: await library.search(v.keyword,
        { ...filters, kind: v.kind ? kind : undefined }) };
    } else if (a[2] === "import") {
      if (!v.file) throw new Error("library import 需要 --file");
      const extension = await checkAudioFile(v.file);
      result = { ok: true, ...(await library.importFile(v.file, {
        ...(v.id ? { id: v.id } : {}), kind, title: v.title || basename(v.file),
        tags: tags(v.tags), ...(filters.category ? { category: filters.category } : {}),
        duration: number(v.duration, "duration") ?? await audioDuration(v.file, extension), ext: extension,
      })) };
    } else if (a[2] === "tag") {
      if (!v.id || !v.tags) throw new Error("library tag 需要 --id 本地素材ID --tags JSON");
      result = { ok: true, item: await library.tag(v.id, tags(v.tags)) };
    } else throw new Error("music library 支持 list/search/import/tag");
  } else throw new Error("music 支持 categories/search/get/obtain/library");
  if (result.item && v.output) result.item = await exportAudio(result.item, v.output);
  return result;
}
