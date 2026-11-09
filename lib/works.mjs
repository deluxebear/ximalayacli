import { basename, extname } from "node:path";
export const API = "https://www.ximalaya.com";
export function get(client, path, query = {}) {
  const u = new URL("/reform-upload/" + path, API);
  for (const [k, v] of Object.entries(query))
    if (v !== undefined) u.searchParams.set(k, v);
  return client.request(u.href);
}
export const permission = (client) => get(client, "upload/permission");
export const albums = (client, opts = {}) =>
  get(client, "album/choose", { page: 1, pageSize: 20, kw: "", ...opts });
export const tracks = (client, opts = {}) =>
  get(client, "anchorTrack/list", { page: 1, pageSize: 20, ...opts });
export const trackInfo = (client, trackId) =>
  get(client, "anchorTrack/edit", { trackId });
export const albumInfo = (client, albumId) =>
  get(client, "manage/album/info", { albumId });
export const albumTracks = (client, albumId, opts = {}) =>
  get(client, "manage/album/tracks", {
    albumId,
    page: 1,
    pageSize: 20,
    ...opts,
  });
export const scheduled = (client, opts = {}) =>
  get(client, "scheduledPublish/list", { page: 1, pageSize: 20, ...opts });
export const VISIBILITY = { public: 2, private: 1, friends: 3 };
export function publishBody(item, uploaded) {
  const title = item.title || basename(item.file, extname(item.file));
  if (
    !title ||
    [...title].reduce((s, c) => s + (c.charCodeAt(0) > 255 ? 2 : 1), 0) > 80
  )
    throw new Error("标题不能为空，且最多 40 个汉字或 80 个英文字母");
  if (!Number.isSafeInteger(Number(item.albumId)) || Number(item.albumId) <= 0)
    throw new Error("发布需要有效的 albumId");
  if (typeof item.isAiTrack !== "boolean")
    throw new Error("请明确设置 isAiTrack 为 true 或 false");
  const visible =
    typeof item.visibility === "string"
      ? VISIBILITY[item.visibility]
      : item.visibility;
  if (item.visibility !== undefined && visible === undefined)
    throw new Error("visibility 支持 public/private/friends");
  if (item.publishAt && !/(Z|[+-]\d{2}:\d{2})$/i.test(item.publishAt))
    throw new Error("publishAt 必须包含时区，例如 +08:00");
  const time = item.publishAt ? Date.parse(item.publishAt) : null;
  if (item.publishAt && (!Number.isFinite(time) || time <= Date.now()))
    throw new Error("publishAt 需要带时区的未来日期");
  if (time && visible !== undefined && visible !== 2)
    throw new Error("定时发布仅支持公开作品");
  return {
    isVideo: false,
    albumId: Number(item.albumId),
    soundTitle: title,
    soundIntro: item.intro || "",
    soundRichIntro: item.richIntro || item.intro || "",
    soundTags: JSON.stringify(item.tags || {}),
    soundCoverPath: item.cover || null,
    videoCoverPath: null,
    activityId: time ? "" : item.activityId || null,
    time,
    soundFile: uploaded
      ? {
          fileId: uploaded.uploadId,
          fileName: `${title}.${uploaded.fileExtName || extname(item.file).slice(1)}`,
        }
      : null,
    isFree: false,
    isTrailer: false,
    trackVipFirst: false,
    isAiTrack: item.isAiTrack,
    ...(visible !== undefined ? { visibleCrowdType: visible } : {}),
    ...(item.categoryId ? { categoryId: Number(item.categoryId) } : {}),
  };
}
export function updateBody(detail, changes) {
  const d = detail.data,
    t = d?.trackInfo;
  if (!t) throw new Error("没有取得作品的完整编辑信息");
  const s = t.trackStatusInfo || {},
    extra = t.additionalInfo || {};
  const body = {
    trackId: t.trackId,
    albumId: t.albumId,
    title: t.title,
    richIntro: d.richIntro || "",
    activityId: d.activityId,
    coverId: 0,
    isFree: s.isFree,
    isTrailer: s.paidStatus === 4,
    videoCoverPath: s.isVideo ? t.videoCoverPath : "",
    lrcPath: d.lrcPath || "",
    templateVoice: extra.templateVoice,
    draftPlayPath: d.draftPlayPath,
    timeDraftList: d.timeDraftList,
    paidAlbumTrackType: s.paidAlbumTrackType,
    categoryId: t.categoryId,
    visibleCrowdType: t.visibleCrowdType,
    communityWidget: d.communityWidget,
    isAiTrack: t.isAiTrack,
  };
  if (changes.title !== undefined) body.title = changes.title;
  if (changes.intro !== undefined) body.richIntro = changes.intro;
  if (changes.visibility !== undefined) {
    if (VISIBILITY[changes.visibility] === undefined)
      throw new Error("visibility 支持 public/private/friends");
    body.visibleCrowdType = VISIBILITY[changes.visibility];
  }
  if (changes.isAiTrack !== undefined) body.isAiTrack = changes.isAiTrack;
  if (changes.coverId !== undefined) body.coverId = Number(changes.coverId);
  body.timeTrack = d.timedTrack ? 1 : 0;
  body.saleVipConfig = d.saleVipConfig || null;
  if (t.statementId !== undefined) body.statementId = t.statementId;
  if (changes.tags !== undefined) body.soundTags = JSON.stringify(changes.tags);
  return body;
}
export async function prepareUpdate(client, trackId, changes) {
  const detail = await trackInfo(client, trackId);
  if (changes.tags === undefined) {
    const t = detail.data.trackInfo;
    const result = await client.request(API + "/reform-upload/upload/tags", {
      method: "POST",
      body: {
        trackId,
        albumId: t.albumId,
        categoryId: t.categoryId,
        title: t.title,
        intro: detail.data.richIntro || "",
      },
    });
    const d = result.data;
    if (!d) throw new Error("无法获取现有标签，已停止编辑");
    const selected = [
      ...(d.recommendTags || []).filter((t) => t.isSelect),
      ...(d.crowdTags || []).filter((t) => t.isSelect),
      ...(d.customTags || []),
    ];
    const tags = {};
    for (const t of selected) {
      const id = t.metadataId ?? t.id ?? -1;
      (tags[id] ||= []).push(t.name);
    }
    changes = { ...changes, tags };
  }
  return updateBody(detail, changes);
}
export async function updateTrack(
  client,
  trackId,
  changes,
  { dryRun = false } = {},
) {
  const body = await prepareUpdate(client, trackId, changes);
  return dryRun
    ? { dryRun: true, endpoint: "/reform-upload/anchorTrack/update", body }
    : client.request(API + "/reform-upload/anchorTrack/update", {
        method: "POST",
        body,
      });
}
export function createAlbumBody(options) {
  if (!options.title || [...options.title].length > 25)
    throw new Error("专辑名称需要 1–25 个字");
  if (!options.subtitle || [...options.subtitle].length > 20)
    throw new Error("专辑卖点需要 1–20 个字");
  if (
    !Number.isSafeInteger(Number(options.categoryId)) ||
    Number(options.categoryId) <= 0
  )
    throw new Error("需要有效的 categoryId");
  if (!options.coverPath) throw new Error("需要上传后的封面路径 coverPath");
  if (typeof options.isAiCover !== "boolean")
    throw new Error("请明确设置 isAiCover");
  if (options.visibility && !["public", "private"].includes(options.visibility))
    throw new Error("专辑可见范围仅支持 public/private");
  const image = options.coverPath.startsWith("http")
    ? new URL(options.coverPath).pathname.slice(1)
    : options.coverPath;
  return {
    title: options.title,
    image,
    isAiCover: options.isAiCover,
    categoryId: String(options.categoryId),
    musicCategory: "",
    isRecordsDesc: options.desc ? "1" : "0",
    isPublic: options.visibility === "private" ? "0" : "1",
    creativeTeam: [],
    customTitle: options.subtitle,
    richIntro: options.intro || "",
    openAiDoc: false,
    tags: JSON.stringify(options.tags || {}),
  };
}
export async function createAlbum(client, options, { dryRun = false } = {}) {
  const body = createAlbumBody(options);
  if (dryRun) return { ok: true, dryRun: true, body };
  return client.request(API + "/anchor-activity-web/album/createFree", {
    method: "POST",
    body,
  });
}
