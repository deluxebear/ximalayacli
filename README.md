# 喜马拉雅创作中心 CLI

`xmly` 将喜马拉雅创作中心的专辑、作品、文件上传和发布流程封装为命令。支持 JSON 批量清单、任务记录、失败恢复和修改前预览。

当前实现面向音频。查询、专辑创建和作品编辑使用 HTTP 接口；音频传输使用 Ego Lite 中官方网页的上传器，发布时实时调用网页 `_getDUH()` 生成签名。

## 安装与登录

需要 Node.js 22+。上传、发布和扫码登录还需要本机安装并运行 Ego Lite，且 `ego-browser` 在 PATH 中。无需额外 npm 依赖。

```bash
npm link
xmly --help
xmly auth login
# 使用喜马拉雅 APP 扫码，完成后：
xmly auth capture
xmly doctor
```

`auth login` 返回浏览器空间 ID 和登录页截图路径。看不到浏览器窗口时，可打开截图扫码；二维码过期则回到登录页刷新。已有登录凭据时直接运行 `xmly doctor` 检查。

凭据保存在 `~/.ximalaya-cli/profiles/default/auth.json`，文件权限为 `0600`。配置、任务记录也在 `~/.ximalaya-cli/`；可通过 `XMLY_HOME` 修改根目录，或用 `--profile NAME` 隔离账号记录。浏览器当前账号必须与所选 profile 一致。

本项目尚未发布到 npm。也可以打包后安装：

```bash
npm pack
npm install -g ./ximalaya-studio-cli-0.1.0.tgz
# 或从本地目录临时运行
npx --package . xmly --help
```

## 查询专辑和作品

```bash
xmly albums list --keyword 小兵传奇
xmly albums info --id 132429174
xmly albums tracks --id 132429174 --page 1 --page-size 20
xmly works list --page 1 --page-size 20
xmly works info --id 1031368436
xmly scheduled list
```

输出为 JSON。`--compact` 输出单行 JSON，`--quiet` 隐藏成功输出。失败以非零状态码退出，错误写入 stderr。

## 上传与发布

仅上传文件、取得 `uploadId`，不会创建公开作品：

```bash
xmly upload --file '/absolute/path/001.mp3'
```

上传并提交发布：

```bash
xmly upload --file '/absolute/path/001.mp3' \
  --publish --album-id 132429174 --title '第一章 骷髅教官' \
  --ai true --visibility public \
  --intro '本节目使用人工智能合成语音。'
```

使用已经上传的文件发布，无需再次传输：

```bash
xmly publish --upload-id UPLOAD_ID --file-ext mp3 \
  --album-id 132429174 --title '第一章 骷髅教官' --ai true
```

`--ai true|false` 是新作品发布的必填项。`--visibility` 支持 `public`、`private`、`friends`。`--intro-file` 可读取 UTF-8 简介；`--cover-id` 使用已经上传的图片 ID。未指定封面时沿用专辑封面。

`--publish-at '2027-01-01T20:00:00+08:00'` 设置新作品的定时发布时间，必须带时区且在未来；服务端还会校验账号权限和提前量。定时任务只支持公开作品。

在 `upload`、`publish` 或 `batch` 后加 `--dry-run`，只检查文件和参数、输出请求预览。提交成功代表服务端接收了发布请求，转码、审核和公开展示仍需以作品状态为准。

支持 AIFF、AIF、MP3、WMA、WAV、FLAC、OGG、MP2、AAC、AMR、M4A，普通音频最大 1 GiB。云盘占位文件需要等待系统下载，计算内容指纹也会触发实际文件读取。

## 批量上传

清单路径可用绝对路径；其中 `file` 的相对路径按清单所在目录解析。参见 `examples/batch.json`。

```json
{
  "defaults": {
    "albumId": 132429174,
    "isAiTrack": true,
    "visibility": "public"
  },
  "items": [
    { "file": "./audio/001.mp3", "title": "第一章 骷髅教官" },
    { "file": "./audio/002.mp3", "title": "第二章 天降大任" }
  ]
}
```

```bash
xmly batch --manifest ./batch.json --publish --dry-run
xmly batch --manifest ./batch.json --publish
xmly batch --manifest ./batch.json --publish --retry-failed
```

不加 `--publish` 时只上传文件。任务按清单顺序执行，完成项通过文件内容和参数指纹跳过。恢复粒度为整个文件，当前不实现 CLI 自有的分片断点保存。官方上传器负责传输中的分片、重试和合并。

## 修改作品

修改前先读取完整编辑信息和现有标签，保留简介、字幕、可见范围等原有字段。

```bash
xmly works update --id 1031368436 --title '新的标题' --dry-run
xmly works update --id 1031368436 --intro-file ./intro.html
xmly works update --id 1031368436 --visibility private
xmly works update --id 1031368436 --ai true
xmly works batch-update --manifest ./updates.json --dry-run
xmly works batch-update --manifest ./updates.json
```

批量修改清单见 `examples/update.json`。支持 `title`、`intro`、`visibility`、`isAiTrack`、`coverId`、`tags`。标签沿用网页原始结构：元数据 ID 映射到名称数组，例如 `{"-1":["自定义标签"]}`。标签结构、封面替换和定时发布字段已从网页代码确认，但这些组合尚未逐一执行真实写入测试。

## 新建免费专辑

```bash
xmly albums create --title '小兵传奇' --subtitle '银河征途，少年成长' \
  --category-id 3 --cover-path 'storages/.../cover.jpeg' \
  --cover-ai true --intro '专辑简介，至少十个字。' --dry-run
```

移除 `--dry-run` 即创建。`--cover-path` 需要使用已上传图片的存储路径，当前封面文件上传仍通过创作中心网页完成；它与作品 `--cover-id` 使用的数字上传 ID 不同。新建专辑默认公开、章节正序，`--visibility private` 可创建私密专辑。

## 任务恢复与配置

```bash
xmly jobs list
# 核对远端确认已成功后，标记任务完成：
xmly jobs resolve --id TASK_FINGERPRINT --resolution done --track-id TRACK_ID
# 核对远端确认没有提交成功后，允许显式重试：
xmly jobs resolve --id TASK_FINGERPRINT --resolution retry
xmly batch --manifest ./batch.json --publish --retry-failed

xmly config list
xmly config get timeout_ms
xmly config set timeout_ms 60000
xmly config set retry_count 3
xmly commands list --compact
xmly completion zsh
```

读取请求可对暂时故障退避重试。写入请求不自动重试；提交后断线会记为 `uncertain`，下次不会自动重传。需核对远端结果后再使用 `jobs resolve`。进程异常退出可能留下 `jobs.json.lock`；确认没有 `xmly` 批量任务运行后才可删除此锁文件。

## 验证范围

2026-11-09 已用真实账号完成：专辑及作品查询、上传权限检查、定时列表查询、音频分片上传、新建《小兵传奇》专辑、发布首章，以及向首章提交 AI 属性编辑请求。未改动账号中原有的两张专辑和四条作品。

首章上传约 34.9 MiB，时长约 32 分 34 秒。发布和编辑接口均返回成功，随后查询作品处于转码处理中。`isAiTrack` 已按 `true` 提交，但编辑信息接口当前返回 `null`，无法据此确认该标记的最终展示；简介中已明确写入 AI 合成说明。

```bash
npm run check
npm test
npm run pack:dry
```

接口研究证据、实现边界和待验证项见 `docs/research.md`。
