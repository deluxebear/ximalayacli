import test from "node:test";
import assert from "node:assert/strict";
import {
  publishBody,
  updateBody,
  prepareUpdate,
  VISIBILITY,
} from "../lib/works.mjs";
const item = {
  file: "/tmp/第一集.wav",
  albumId: 123,
  title: "第一集",
  isAiTrack: false,
};
test("发布参数区分文件上传 ID 与作品 ID，保留 AI 显式 false", () => {
  const body = publishBody(
    { ...item, visibility: "private", tags: { "-1": ["朗读"] } },
    { uploadId: 456, fileExtName: "wav" },
  );
  assert.deepEqual(body.soundFile, { fileId: 456, fileName: "第一集.wav" });
  assert.equal(body.isAiTrack, false);
  assert.equal(body.visibleCrowdType, 1);
  assert.equal(body.soundTags, '{"-1":["朗读"]}');
  assert.equal(body.time, null);
  assert.deepEqual(VISIBILITY, { public: 2, private: 1, friends: 3 });
});
test("发布前拒绝缺少专辑、AI 声明、无时区或非公开定时任务", () => {
  assert.throws(() => publishBody({ ...item, albumId: undefined }), /albumId/);
  assert.throws(
    () => publishBody({ ...item, isAiTrack: undefined }),
    /isAiTrack/,
  );
  assert.throws(
    () => publishBody({ ...item, publishAt: "2099-01-01T12:00:00" }),
    /时区/,
  );
  assert.throws(
    () =>
      publishBody({
        ...item,
        publishAt: "2099-01-01T12:00:00+08:00",
        visibility: "private",
      }),
    /仅支持公开/,
  );
});
const detail = {
  data: {
    trackInfo: {
      trackId: 1,
      albumId: 2,
      title: "原标题",
      categoryId: 3,
      visibleCrowdType: 2,
      isAiTrack: false,
      trackStatusInfo: { isFree: true, paidStatus: 0 },
      additionalInfo: {},
    },
    richIntro: "保留简介",
    lrcPath: "subtitle",
    timeDraftList: [{ time: 1, text: "字幕" }],
    timedTrack: true,
    saleVipConfig: { setting: 1 },
  },
};
test("修改标题时保留简介、字幕、可见范围、定时和付费配置", () => {
  const before = structuredClone(detail);
  const body = updateBody(detail, { title: "新标题" });
  assert.equal(body.title, "新标题");
  assert.equal(body.richIntro, "保留简介");
  assert.equal(body.lrcPath, "subtitle");
  assert.equal(body.visibleCrowdType, 2);
  assert.equal(body.timeTrack, 1);
  assert.deepEqual(body.saleVipConfig, { setting: 1 });
  assert.deepEqual(detail, before);
});
test("修改前从标签接口恢复已选择标签，排除未选择的推荐项", async () => {
  const client = {
    request: async () => ({
      data: {
        recommendTags: [
          { metadataId: 4, name: "保留", isSelect: true },
          { metadataId: 5, name: "推荐", isSelect: false },
        ],
        crowdTags: [],
        customTags: [{ metadataId: -1, name: "自定义" }],
      },
    }),
  };
  // trackInfo 也经由同一传输对象读取。
  let count = 0;
  client.request = async () =>
    ++count === 1
      ? detail
      : {
          data: {
            recommendTags: [
              { metadataId: 4, name: "保留", isSelect: true },
              { metadataId: 5, name: "推荐", isSelect: false },
            ],
            customTags: [{ metadataId: -1, name: "自定义" }],
          },
        };
  const body = await prepareUpdate(client, 1, { title: "新标题" });
  assert.deepEqual(JSON.parse(body.soundTags), {
    4: ["保留"],
    "-1": ["自定义"],
  });
});
test("创建专辑采用网页字段和正序设置，图片 URL 转存储路径", async () => {
  const { createAlbumBody } = await import("../lib/works.mjs");
  const body = createAlbumBody({
    title: "测试专辑",
    subtitle: "科幻故事",
    categoryId: 3,
    coverPath: "https://imagev2.xmcdn.com/storages/test.png",
    isAiCover: true,
  });
  assert.equal(body.image, "storages/test.png");
  assert.equal(body.isRecordsDesc, "0");
  assert.equal(body.isPublic, "1");
  assert.equal(body.categoryId, "3");
  assert.equal(body.isAiCover, true);
});
