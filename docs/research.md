# 创作中心接口研究记录

研究日期：2026-11-09。入口：<https://studio.ximalaya.com/upload>。

## 证据与范围

- 登录后页面观察：创作中心以 iframe 加载 `https://www.ximalaya.com/reform-upload/page/webCenter/upload`。
- 下载并静态检查官网分发的 `www-sound-manage-static/last/build/static/js/main.b3fb7e87.chunk.js`、`8.13d7e506.chunk.js`、`7.59cfab62.chunk.js`，以及作品编辑页的 `12.f6e34ce3.chunk.js`。
- 专辑页加载 `my-program/last/dist/js/app.js?v=2026071017`。通过其源代码及表单运行时状态确认创建字段。
- REA 静态分析父 Evidence：`ev_aa9c0ba7736d978fe5252835a7f726f5f0f5ebcc41dab69168bcc111de530f3a`。该轮只选择前两个主业务 bundle。分析未执行代码，达到部分语义节点和 unknown 保留上限；其余源文件的关联、动态分支和完整控制流未得到证明。
- 实时证据来自 Ego Lite 中的官方网页上传器、返回的上传结果，以及 CLI 对真实服务的响应。没有把静态发现当作已执行的流程。
- 原始 HTML、音频测试文件、页面状态和私有响应未进入仓库。临时研究目录位于系统临时目录，凭据和任务记录位于用户目录。

## 已确认接口

下表域名均为 `https://www.ximalaya.com`，文件传输另外使用官网上传器返回的上传域名。

| 行为 | 方法与路径 | 验证 |
| --- | --- | --- |
| 上传权限/账号摘要 | GET `/reform-upload/upload/permission` | 真实只读请求 |
| 专辑选择 | GET `/reform-upload/album/choose?page=1&pageSize=20&kw=` | 真实只读请求 |
| 专辑信息 | GET `/reform-upload/manage/album/info?albumId=` | 真实只读请求 |
| 专辑内作品 | GET `/reform-upload/manage/album/tracks?albumId=&page=&pageSize=` | 真实只读请求 |
| 全部作品 | GET `/reform-upload/anchorTrack/list?page=&pageSize=` | 真实只读请求 |
| 编辑信息 | GET `/reform-upload/anchorTrack/edit?trackId=` | 真实只读请求 |
| 现有标签/推荐标签 | POST `/reform-upload/upload/tags` | 真实读取请求，带 trackId 等上下文 |
| 修改作品 | POST `/reform-upload/anchorTrack/update` | 首章 AI 属性编辑请求返回成功 |
| 新作品发布 | POST `/reform-upload/upload/create` | 首章创建成功，返回 trackId/albumId/uploadId |
| 定时列表 | GET `/reform-upload/scheduledPublish/list?page=&pageSize=` | 真实只读请求 |
| 新建免费专辑 | POST `/anchor-activity-web/album/createFree` | 成功新建专辑 |

## 文件上传与签名

官网 SDK 的实测路径为：

1. POST `/clamper-token/token`，请求包含 `fileName`、`fileSize`、`uploadType`、`callerType`。
2. POST `/upload/file/blk`，按官方配置分片，携带文件 MD5、分片编号、multipartId 等参数。
3. POST `/upload/merge/mkfile`；必要时由官网 SDK 查询 `/upload/merge/status`。
4. 成功响应 `code: "000000"`，`data.uploadId` 是随后发布使用的文件 ID。

SDK 的文件签名为 `x-xfm-*` 请求头；发布签名为独立的 `xm-sign`，前端在每次发布前调用 `_getDUH()`。本项目复用真实浏览器中的官方上传器与签名函数，没有将运行时签名或上传 token 固化到代码中。

Ego Lite 未提供一个供本次 REA 直接附加的常规 HTTP CDP 端点，因此本次 REA 用于静态分析；实时上传验证由 Ego Lite API 和官网 SDK 完成。

## 作品字段

- 新建：`albumId`、`soundTitle`、`soundIntro`、`soundRichIntro`、`soundTags`、`soundCoverPath`、`soundFile`、`time`、`isAiTrack`、`visibleCrowdType` 等。
- `soundFile.fileId` 对应上传返回的 `uploadId`，不是作品 `trackId`。
- 编辑字段与新建不同：`title`、`richIntro`、`coverId` 等；编辑前读取完整详情及标签，避免只发一个字段导致其他设置丢失。
- 可见范围枚举由前端代码确认：公开 `2`、私密 `1`、仅好友 `3`。
- `time` 为毫秒时间戳；定时列表/权限已实测，真实定时发布没有执行。
- `isAiTrack` 在前端是布尔值。本次创建及编辑均发送 `true` 且接口返回成功，但详情接口继续返回 `null`，其落库/前台呈现尚未确认。简介中的 AI 说明已通过详情读取验证。

## 专辑字段

新建免费专辑使用 `title`、`image`（存储路径）、`isAiCover`、`categoryId`、`customTitle`、`richIntro`、`isPublic`、`isRecordsDesc`、`tags` 等。普通有声书分类 ID 为 `3`；新专辑使用章节正序 `isRecordsDesc: "0"`。

此处 `isPublic` 使用字符串 `"1"`/`"0"`，与作品可见范围枚举不同。网页封面上传后返回存储路径；当前 CLI 创建专辑接受该路径，没有提供独立的本地封面上传命令。

## 实现决策与未覆盖部分

已实现：扫码凭据捕获、HTTP 查询、创建专辑、单文件及批量上传、从上传 ID 发布、批量发布、作品设置修改、参数预览、失败任务恢复、输出脱敏、npm CLI 包装。

尚未逐项实测：真实定时发布、好友/私密可见范围切换、标签及封面替换、批量多作品实际发布、付费专辑与视频/配图/文本音频。未实现付费、作品删除、迁移专辑或平台 AI 音频生成。

任务去重和恢复记录由本地维护，不等同于服务器幂等保证；不确定的写入结果必须先核对，不能直接重试。文件传输仍依赖有效的 Ego Lite 登录状态和官网 SDK；网站版本变化可能需要适配。
