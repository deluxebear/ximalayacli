import { readJson } from "./config.mjs";
import { rankAudioItems } from "./audio-library.mjs";
import { obtainAudio, durationFilter } from "./music.mjs";

const normalized = (s) => String(s || "").normalize("NFKC").toLowerCase().trim();
function available(pack, remote) {
  return ["free", "limited"].includes(pack.accessType) ||
    (remote.scope.roleType === 2 && (pack.accessType === "member" || (pack.accessType === "paid" && pack.purchased)));
}
function candidate(pack, item) {
  return { id: `${pack.packId}/${item.itemId}`, title: item.name, kind: pack.kind,
    tags: item.description ? [item.description] : [], duration: item.duration,
    packId: pack.packId, itemId: item.itemId };
}
async function findCloud(remote, groupId, choice, { kind, maxPages, minDuration, maxDuration }) {
  const matches = [];
  for (let page = 1; page <= maxPages; page++) {
    const found = await remote.libraryList({ kind, groupId, keyword: choice.title, page, pageSize: 100 });
    matches.push(...found.items.filter((x) => normalized(x.title) === normalized(choice.title)));
    if (!found.items.length || page >= found.totalPages) {
      const distinct = [...new Map(matches.map((x) => [x.id, x])).values()];
      if (distinct.length > 1) return { ok: false, status: "ambiguous-cloud-match", items: distinct };
      if (distinct.some((x) => x.kind !== kind || (choice.duration !== undefined &&
          (x.duration === undefined || Math.abs(x.duration - choice.duration) > 0.1))))
        return { ok: false, status: "cloud-metadata-mismatch", items: distinct };
      const item = durationFilter(distinct, { minDuration, maxDuration })[0];
      if (distinct.length && !item) return { ok: false, status: "cloud-duration-mismatch", items: distinct };
      return { ok: true, item };
    }
  }
  return { ok: false, status: "cloud-search-limit", items: matches };
}

export async function obtainMaterialAudio(library, remote, {
  keyword, kind = "music", minDuration, maxDuration, maxPages = 3, maxPacks = 10,
  materialLibrary, retryFailed = false,
} = {}) {
  const filters = { kind, minDuration, maxDuration };
  const packs = [];
  for (const source of materialLibrary ? [materialLibrary] : ["ai", "xmly"])
    packs.push(...(await remote.list({ library: source, kind })).items);
  const words = normalized(keyword).split(/\s+/u).filter(Boolean);
  const priority = (p) => words.filter((word) => normalized(`${p.name} ${p.description}`).includes(word)).length;
  const ordered = packs.filter((p) => p.kind === kind && p.itemCount > 0 && available(p, remote))
    .sort((a, b) => priority(b) - priority(a) || Number(b.imported) - Number(a.imported));
  const candidates = [];
  for (const brief of ordered.slice(0, maxPacks)) {
    const pack = await remote.detail(brief.packId);
    if (pack.kind !== kind || !available(pack, remote)) continue;
    const items = pack.items.map((item) => candidate(pack, item));
    candidates.push(...rankAudioItems(items, keyword, { kind, minScore: 0 }).slice(0, 5));
    const choices = rankAudioItems(items, keyword, filters);
    if (!choices.length) continue;
    const choice = choices[0];
    const state = await readJson(remote.journal, { jobs: {} });
    const previous = state.jobs[remote.importKey(pack.packId)];
    let groupId = previous?.status === "done" ? previous.result?.groupId : undefined;
    if (pack.imported && !previous) {
      const groups = (await remote.groups({ kind })).items.filter((x) => x.groupName === pack.name);
      if (groups.length !== 1) return { ok: false, status: "ambiguous-import-group", packId: pack.packId, items: groups };
      groupId = groups[0].groupId;
    }
    if (groupId) {
      const existing = await findCloud(remote, groupId, choice, { ...filters, maxPages });
      if (!existing.ok) return existing;
      if (existing.item) return finish(remote, library, existing.item, choice, pack);
      if (pack.imported && !previous) return { ok: false, status: "imported-item-not-found", packId: pack.packId, itemId: choice.itemId };
    }
    const imported = await remote.importPack(pack.packId, { itemIds: [choice.itemId], retryFailed });
    if (!imported.ok || !imported.groupId) return { ...imported, ok: false, packId: pack.packId };
    const found = await findCloud(remote, imported.groupId, choice, { ...filters, maxPages });
    if (!found.ok) return found;
    if (!found.item) return { ok: false, status: "imported-item-not-found", packId: pack.packId, itemId: choice.itemId, groupId: imported.groupId };
    return finish(remote, library, found.item, choice, pack);
  }
  return { ok: false, status: "no-confident-match", keyword, items: candidates,
    searchedPacks: Math.min(ordered.length, maxPacks), searchLimited: ordered.length > maxPacks };
}
async function finish(remote, library, cloud, choice, pack) {
  const result = await remote.getAudio(library, cloud.trackId);
  // 包内用途说明来自平台条目；不把包名当作每条音频的用途证据。
  if (result.ok && result.item && choice.tags.length) result.item = await library.tag(result.item.id, choice.tags);
  return { ...result, provider: "materials", packId: pack.packId, materialItemId: choice.itemId,
    match: { score: choice.score, reason: choice.reason } };
}

export async function obtainWithMaterials(library, loadStudio, loadMaterials, options) {
  const { source = "auto", maxPacks = 10, materialLibrary, ...base } = options;
  if (!["auto", "studio", "materials"].includes(source)) throw new Error("source 支持 auto/studio/materials");
  if (!Number.isSafeInteger(maxPacks) || maxPacks < 1 || maxPacks > 100) throw new Error("max-packs 必须是 1 到 100 的整数");
  if (materialLibrary !== undefined && !["ai", "xmly"].includes(materialLibrary)) throw new Error("library 支持 ai/xmly");
  const local = await obtainAudio(library, loadStudio, { ...base, offline: true });
  if (local.ok || base.offline) return local;
  const kind = base.kind || "music";
  const supported = ["music", "sfx"].includes(kind) && base.category === undefined;
  if (source === "materials" && !supported) throw new Error("素材包仅支持 music/sfx，且不支持创作中心 category-id");
  if (source !== "studio" && supported) {
    const result = await obtainMaterialAudio(library, await loadMaterials(), { ...base, maxPacks, materialLibrary });
    if (result.ok || result.status !== "no-confident-match" || source === "materials") return result;
    const studio = await obtainAudio(library, loadStudio, base);
    if (!studio.ok) return { ...studio, materials: result };
    return { ...studio, provider: "studio" };
  }
  return obtainAudio(library, loadStudio, base);
}
