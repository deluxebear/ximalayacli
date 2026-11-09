import { Client } from "./client.mjs";
import { AudioLibrary } from "./audio-library.mjs";
import { MaterialsClient, materialId, previewId, cloudAudioId } from "./materials.mjs";
import { exportAudio } from "./music.mjs";

export async function runMaterialsCommand(a, v, p, config) {
  if (!["list", "info", "items", "preview", "import", "library"].includes(a[1]))
    throw new Error("materials 支持 list/info/items/preview/import/library");
  if (a[1] === "library" && !["groups", "list", "get"].includes(a[2])) throw new Error("materials library 支持 groups/list/get");
  let result;
  const library = new AudioLibrary(p.audioLibrary);
  const get = a[1] === "library" && a[2] === "get";
  if (a[1] === "preview" || get) {
    const id = get ? cloudAudioId(v.id, v["team-id"]) : previewId(materialId(v["pack-id"], "pack-id"), materialId(v.id, "id"));
    const item = await library.get(id);
    if (item) result = { ok: true, ...(get ? {} : { preview: true }), source: "local", reused: true, item };
    else if (v.offline) result = { ok: false, status: "not-cached", id };
  } else if (v.offline) throw new Error("materials 仅 preview/library get 支持 --offline；本地素材可用 music library 查询");
  if (!result) {
    const client = await Client.from(p.auth, { retries: config.retry_count, timeout: config.timeout_ms });
    const remote = new MaterialsClient(client, { teamId: v["team-id"], journal: p.jobs });
    const packId = v["pack-id"];
    const pagination = { ...(v.page !== undefined ? { page: Number(v.page) } : {}),
      ...(v["page-size"] !== undefined ? { pageSize: Number(v["page-size"]) } : {}) };
    if (a[1] === "library") {
      if (a[2] === "groups") result = await remote.groups({ kind: v.kind });
      else if (get) result = await remote.getAudio(library, v.id);
      else result = await remote.libraryList({ kind: v.kind, groupId: v["group-id"], keyword: v.keyword, ...pagination });
    } else if (a[1] === "list") result = await remote.list({ library: v.library, kind: v.kind, access: v.access, keyword: v.keyword });
    else if (a[1] === "info") {
      const { items, ...pack } = await remote.detail(packId);
      result = { ok: true, pack, listedItemCount: items.length };
    } else if (a[1] === "items") result = await remote.items(packId, { keyword: v.keyword, ...pagination });
    else if (a[1] === "preview") result = await remote.preview(library, packId, v.id);
    else result = await remote.importPack(packId, { dryRun: !!v["dry-run"], retryFailed: !!v["retry-failed"] });
  }
  if ((a[1] === "preview" || get) && result.item && v.output) result.item = await exportAudio(result.item, v.output);
  return result;
}
