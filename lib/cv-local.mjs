import { join } from "node:path";
import { readJson } from "./config.mjs";
import { rankAudioItems } from "./audio-library.mjs";
import { durationFilter } from "./music.mjs";
import { cvId } from "./cv.mjs";

export async function localCvItems(library, catalogDir, { cv } = {}) {
  const ownerId = cv === undefined ? undefined : cvId(cv);
  const owners = new Map();
  for (const item of await library.list()) {
    const match = /^cv:([1-9]\d*):([1-9]\d*)$/.exec(item.id);
    if (item.kind !== "voice" || !match || (ownerId !== undefined && ownerId !== match[1])) continue;
    const [, id, sampleId] = match;
    if (!owners.has(id)) {
      const saved = catalogDir ? await readJson(join(catalogDir, id + ".json"), null) : null;
      const record = saved?.item?.id === id ? saved.item : undefined;
      owners.set(id, { id, name: record?.name || item.title.split(" / ")[0],
        description: record?.description || "", skills: record?.skills || [], samples: [], record });
    }
    const owner = owners.get(id);
    owner.samples.push({ id: sampleId, libraryId: item.id,
      title: owner.record?.samples?.find((x) => x.id === sampleId)?.title || item.title.split(" / ").slice(1).join(" / ") || item.title,
      duration: item.duration, path: item.path, bytes: item.bytes, sha256: item.sha256 });
  }
  return [...owners.values()].map(({ record, ...owner }) => owner);
}

export function searchLocalCv(items, keyword = "") {
  const words = String(keyword).normalize("NFKC").toLowerCase().trim().split(/\s+/u).filter(Boolean);
  return items.filter((owner) => {
    const text = [owner.name, owner.description, ...owner.samples.map((s) => s.title)].join(" ").normalize("NFKC").toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

export async function obtainCvAudio(library, loadRemote, {
  keyword, cv, offline = false, minDuration, maxDuration, maxPages = 3,
} = {}) {
  if (typeof keyword !== "string" || !keyword.trim()) throw new Error("cv obtain 需要 --keyword 主播名或样音关键词");
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error("max-pages 必须是 1 到 100 的整数");
  const ownerId = cv === undefined ? undefined : cvId(cv);
  const filters = { kind: "voice", minDuration, maxDuration };
  durationFilter([], filters);
  const local = (await library.list()).filter((x) => x.kind === "voice" && /^cv:\d+:\d+$/.test(x.id) &&
    (ownerId === undefined || x.id.startsWith(`cv:${ownerId}:`)));
  const matches = rankAudioItems(local, keyword, filters);
  if (matches.length) return { ok: true, source: "local", reused: true, item: matches[0] };
  if (offline) return { ok: false, status: "no-local-match", keyword, items: [] };
  const remote = await loadRemote();
  const candidates = [];
  for (let page = 1; page <= (ownerId ? 1 : maxPages); page++) {
    const found = ownerId ? await remote.samples(ownerId, { maxPages }) : await remote.search({ keyword, page, pageSize: 50 });
    for (const owner of ownerId ? [found.item] : found.items)
      for (const sample of owner.samples) candidates.push({ id: sample.libraryId, trackId: sample.id, cvId: owner.id,
        kind: "voice", title: `${owner.name} / ${sample.title}`, tags: [owner.name, sample.title], duration: sample.duration });
    if (ownerId || !found.items.length || page >= found.totalPages) break;
  }
  const ranked = rankAudioItems([...new Map(candidates.map((x) => [x.id, x])).values()], keyword, filters);
  if (!ranked.length) return { ok: false, status: "no-confident-match", keyword, items: candidates };
  const best = ranked.filter((x) => x.score === ranked[0].score);
  if (best.length > 1) return { ok: false, status: "ambiguous-match", keyword,
    message: "多个样音同等匹配，请用 cv get --cv-id 主播ID --id 样音ID 明确选择", items: best };
  const choice = best[0];
  return { ...(await remote.get(library, { cv: choice.cvId, id: choice.trackId, maxPages })),
    match: { score: choice.score, reason: choice.reason } };
}
