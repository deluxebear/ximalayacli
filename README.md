# 喜马拉雅创作中心 CLI

`xmly` 将喜马拉雅创作中心的专辑、作品、文件上传、发布及素材库封装为命令。支持 JSON 批量清单、任务记录、失败恢复和修改前预览，以及配乐/音效搜索、下载和本地复用。

当前实现面向音频。日常查询、上传、发布及编辑均可使用纯 Node.js 运行，默认不启动浏览器，也不加载官网 SDK。文件上传实现了分片 HMAC 协议；发布使用本地设备 ID 算法和会话上报协议生成 `xm-sign`。

## 安装与登录

需要 Node.js 22+。首次扫码登录和初始化设备登记需要本机安装并运行 Ego Lite，且 `ego-browser` 在 PATH 中。完成 `auth capture` 后，日常上传和发布不再要求浏览器运行。无需额外 npm 依赖。

```bash
npm link
xmly --help
xmly auth login
# 使用喜马拉雅 APP 扫码，完成后：
xmly auth capture
xmly doctor
```

`auth capture` 会同时保存 Cookies、真实设备登记及环境快照。此前版本已有 Cookies 的账号可运行 `auth capture-signer --space-id N`，在已登录的上传页初始化设备登记。

`auth login` 返回浏览器空间 ID 和登录页截图路径。看不到浏览器窗口时，可打开截图扫码；二维码过期则回到登录页刷新。已有登录凭据时直接运行 `xmly doctor` 检查。

凭据保存在 `~/.ximalaya-cli/profiles/default/auth.json`，文件权限为 `0600`。配置、任务记录也在 `~/.ximalaya-cli/`；可通过 `XMLY_HOME` 修改根目录，或用 `--profile NAME` 隔离账号记录。设备登记保存在同目录的 `signer.json`，权限同样为 `0600`。这些状态需要来自同一个账号；不会保存或重放旧的会话签名。

本项目尚未发布到 npm。也可以打包后安装：

```bash
npm pack
npm install -g ./ximalaya-studio-cli-0.3.0.tgz
# 或从本地目录临时运行
npx --package . xmly --help
```

## 配乐与音效：先复用，再获取

素材库的搜索、权限检查和下载均为纯 Node HTTP，不需要浏览器或 `xm-sign`；首次在线获取需要现有登录 Cookie。本地命中后，即使登录过期或断网也可继续使用。

日常优先使用 `obtain`，先匹配完整的本地音频，没有合适的才联网搜索并下载：

```bash
# 搜索/获取10到20秒的雨声音效；以后“下雨”也能命中已有的雨声
xmly music obtain --kind sfx --keyword 雨声 --min-duration 10 --max-duration 20
xmly music obtain --kind sfx --keyword 下雨 --min-duration 10 --max-duration 20

# 配乐，输出到指定位置。音频同时入库供以后复用；不覆盖已有输出文件
xmly music obtain --kind music --keyword '悬疑' --output ./assets/suspense.m4a

# 完全离线：没有匹配则返回 no-local-match，不会联网
xmly music obtain --kind sfx --keyword 雨声 --offline
```

`--kind` 支持 `music` 配乐（默认）、`intro` 片头片尾、`sfx` 音效、`transition` 转场音效。返回 JSON 包括 `source: local|remote`、`reused`、素材 ID、标题、秒数、SHA256、字节数及文件绝对路径。

匹配依据为标题、标签、明确同义词、类型和可选时长，适合关键词输入；多个关键词用空格分开。它不分析听感或做通用语义判断。自动搜索最多3页，可用 `--max-pages 1..20` 调整；没有足够匹配时返回 `no-confident-match` 和候选，不擅自下载无关结果。`--min-duration/--max-duration` 是本地秒数筛选，在线搜索的 `totalCount` 仍是平台原始总数。

查看在线候选并手动选择：

```bash
xmly music categories --kind music
xmly music categories --kind sfx
xmly music search --kind music --keyword 悬疑 --page 1 --page-size 12
xmly music search --kind sfx --keyword 雨声
xmly music search --kind intro --keyword 悬疑
xmly music search --kind transition --keyword 风
xmly music get --kind sfx --id 8669
xmly music get --kind music --id 1001316930 --output ./assets/drums.m4a
```

`music search` 明确在线搜索；加 `--offline` 则只查本地。`music get` 先按 ID 校验本地缓存，有则直接复用；音效首次按 ID 获取需要先有一条搜索记录。新下载仍遵守平台的主播认证权限检查。可用 `--category-id` 指定分类；音乐分类会交叉核对返回标签，避免宽泛搜索结果污染本地分类。

管理本地素材及用途标签：

```bash
xmly music library list
xmly music library search --keyword 雨声
xmly music library tag --id sfx:8669 --tags '["雨声", "城市", "夜晚"]'
xmly music library import --file ./my-rain.wav --kind sfx --title 雨夜环境 --tags '["雨声", "夜晚"]'
```

导入会复制文件入库，WAV/M4A 自动读取容器时长，其他格式可以 `--duration 秒` 补充。元数据和文件保存在 `~/.ximalaya-cli/profiles/default/audio-library/`，按 SHA256 去重，复用前校验完整性。每个 profile 独立，支持 `XMLY_HOME`；不将素材和凭据存入项目或 npm 包。

已实际下载18秒雨声音效及约29.6秒悬疑配乐，并在无登录文件、禁用网络和浏览器的子进程中验证复用。协议、接口及验证边界见 [素材库研究](docs/music-protocol.md)。

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

不加 `--publish` 时只上传文件。任务按清单顺序执行，完成项通过文件内容和参数指纹跳过。恢复粒度为整个文件，当前不实现 CLI 自有的分片断点保存。默认由本地上传器负责分片、重试和合并；文件合并响应丢失时先查询合并结果，不直接重复提交。

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

## 纯 Node 签名与浏览器兼容模式

```bash
xmly signer status       # 检查本地设备登记
xmly signer check        # 生成新签名，仅输出来源和长度，不发布作品
xmly signer compare --space-id N   # 显式使用已打开网页做只读原厂对照
xmly upload --file ./episode.mp3 --transport native
# 如需显式采用旧实现：
xmly upload --file ./episode.mp3 --transport browser
```

默认 `--transport native`，不会在失败时偷偷切换到浏览器。`signer check` 会向官网使用的会话服务发起一次加密上报，取得新会话 ID；`sessionSource: report-service` 表示正常服务响应。只有实际网络失败时，才按 SDK 定义生成网络错误会话，并明确输出 `sessionSource: sdk-network-error`。

设备指纹采集仍由首次登录的真实网页完成；本项目复用这份登记，而没有实现从零模拟浏览器环境。会话服务返回更新后的设备标识时，会保存在 `signer.json`。更换账号或设备、登录状态过期时需重新捕获状态。`--transport browser` 是可选的显式兼容模式，不是默认依赖。

## 验证范围

2026-11-09 已用真实账号完成：专辑及作品查询、上传权限检查、定时列表查询、音频分片上传、新建《小兵传奇》专辑、发布首章，以及向首章提交 AI 属性编辑请求。未改动账号中原有的两张专辑和四条作品。

首章上传约 34.9 MiB，时长约 32 分 34 秒。发布和编辑接口均返回成功，初次查询作品处于转码处理中；随后复查首章被平台标记为“收录-平台暂不收录”，该专辑也已不在可上传列表中。`isAiTrack` 已按 `true` 提交，但编辑信息接口当前返回 `null`，无法据此确认该标记的最终展示；简介中已明确写入 AI 合成说明。

```bash
npm run check
npm test
npm run pack:dry
```

新增纯 Node 验证：原厂设备 ID、压缩加密及网络错误会话三个只读对照全部匹配；小文件和 3 个分片的真实上传成功；清空子进程 PATH 后，双文件批量上传成功，证明该路径不调用 `ego-browser`。纯 Node 真实发布验证已通过：在新建的“CLI协议测试”私密专辑（132430147）中提交 3 秒私密作品（1031374615）。整个 CLI 子进程的 PATH 被设为空目录，签名使用正常会话服务响应，没有加载官方 SDK。复查专辑与作品均非公开，音频转码已完成。

接口研究证据、实现边界和待验证项见 `docs/research.md`。
