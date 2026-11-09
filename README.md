# 喜马拉雅创作中心 CLI

`xmly` 将喜马拉雅创作中心的专辑、作品、文件上传、发布及素材库封装为命令。支持 JSON 批量清单、任务记录、失败恢复和修改前预览，以及配乐/音效和 CV 墙样音的搜索、下载和本地复用。

当前实现面向音频。日常查询、上传、发布及编辑均可使用纯 Node.js 运行，默认不启动浏览器，也不加载官网 SDK。文件上传实现了分片 HMAC 协议；发布使用本地设备 ID 算法和会话上报协议生成 `xm-sign`。

## 安装与登录

先安装 Node.js 22+（包含 npm）和 Git，macOS/Linux 可用一条命令安装整个 CLI：

```bash
curl -fsSL https://raw.githubusercontent.com/deluxebear/ximalayacli/main/install.sh | sh
```

该命令下载安装脚本，在临时目录克隆 GitHub 当前已推送的源码，将完整 CLI 打包后全局安装，包含 `xmly` 命令及该版本内置的 Skills 文件；安装完成后清理临时目录，不依赖源码目录。仓库已公开，无需 GitHub 登录。安装本身不会登录喜马拉雅账号，也不会自动把 Skills 写入 Agent 目录。

需要自定义前缀或固定版本时：

```bash
curl -fsSL https://raw.githubusercontent.com/deluxebear/ximalayacli/main/install.sh | sh -s -- --prefix "$HOME/.local"
# 将 REF 替换为实际分支、标签或提交
curl -fsSL https://raw.githubusercontent.com/deluxebear/ximalayacli/main/install.sh | sh -s -- --ref REF
```

也可先克隆并检查脚本，再从源码安装：

```bash
git clone https://github.com/deluxebear/ximalayacli.git && sh ximalayacli/install.sh --source ./ximalayacli
```

已取得本项目代码时，macOS/Linux 也可使用安装脚本：

```bash
sh install.sh
# 自定义安装目录，避免写入系统全局目录
sh install.sh --prefix "$HOME/.local"
```

自定义前缀时将其 `bin/` 目录加入 PATH。默认先通过 Git 克隆远端、打包再安装，避免 npm 直接安装 Git 来源可能产生的缺失文件问题。脚本支持 `--ref 分支/标签/提交` 固定来源、`--source /path/to/source` 安装本地源码、`--source /path/to/package.tgz` 安装本地包；不会自动安装 Node.js、修改 shell 配置或使用 sudo。

已克隆本仓库时，可执行 `sh install.sh` 安装远端已推送版本；安装当前尚未推送的本地代码使用 `sh install.sh --source .`。更新远端版本时重新执行 `sh install.sh`，或传 `--ref` 固定版本。开发调试仍可用 `npm link` 创建源码链接。Windows 可使用 Git Bash 执行脚本，或用下文的 `npm pack` 与本地 tarball 安装方式。

首次扫码登录需要本机安装 Google Chrome。首次登录和初始化设备登记直接使用系统 Chrome，不需要 Ego Lite、扩展或额外 npm 依赖。登录完成后，日常查询、上传、发布及素材获取不再要求浏览器运行。

```bash
xmly --help
xmly auth login
# 在弹出的 Chrome 窗口中使用喜马拉雅 APP 扫码。
# CLI 会自动保存登录 Cookie 和设备登记，并关闭专用登录窗口。
xmly doctor
```

Chrome 使用 `~/.ximalaya-cli/profiles/default/chrome/` 中的独立配置目录，不读取日常 Chrome 的账号、Cookie 或标签页。已保存的专用浏览器会话仍有效时，再次运行 `auth login` 可以直接验证并保存，无需再次扫码。每个 `--profile` 独立。

默认等待登录5分钟，可用 `--timeout-ms 600000` 调整。需要先打开窗口、稍后保存时：

```bash
xmly auth login --no-wait
# 在 Chrome 中完成登录后：
xmly auth capture
```

`auth capture` 会同时保存 Cookies、真实设备登记及环境快照，并通过只读接口核对账号一致性。超时或核对失败不会覆盖已有凭据，Chrome 窗口会保留，完成登录后可再次捕获。登录过期时重新运行 `xmly auth login`；只需刷新设备登记时，在专用窗口仍打开的情况下使用 `xmly auth capture-signer`。

macOS 自动查找 `/Applications/Google Chrome.app`，Windows/Linux 也支持标准安装路径。可用 `xmly auth login --chrome-path '/可执行文件路径'` 或环境变量 `XMLY_CHROME_PATH` 指定 Chrome。二维码过期时在浏览器中刷新；已有凭据时直接运行 `xmly doctor` 检查。

凭据保存在 `~/.ximalaya-cli/profiles/default/auth.json`，文件权限为 `0600`。配置、任务记录也在 `~/.ximalaya-cli/`；可通过 `XMLY_HOME` 修改根目录，或用 `--profile NAME` 隔离账号记录。设备登记保存在同目录的 `signer.json`，权限同样为 `0600`。这些状态需要来自同一个账号；不会保存或重放旧的会话签名。

本项目尚未发布到 npm 注册表。无需公共包名，除了上述 GitHub 安装方式，也可在仓库内打包后安装：

```bash
npm pack
npm install -g ./ximalaya-studio-cli-0.4.0.tgz
# 或让安装脚本安装本地包
sh install.sh --source ./ximalaya-studio-cli-0.4.0.tgz
# 或从本地目录临时运行
npx --package . xmly --help
```

## 给 Agent 使用的 Skills

项目提供三个可独立复制的技能，使用通用 `SKILL.md` 结构并随 npm 包分发：

- [xmly-music](skills/xmly-music/SKILL.md)：配乐、音效、本地优先获取和素材包。
- [xmly-cv](skills/xmly-cv/SKILL.md)：主播与样音检索、本地优先复用。
- [xmly-studio](skills/xmly-studio/SKILL.md)：专辑、上传发布、作品编辑和批量恢复。

安装 `xmly` 后，一条命令即可安装技能，无需登录或联网：

```bash
xmly skills install                 # 默认 Codex，安装三个技能
xmly skills install --agent claude  # Claude Code
xmly skills install --agent all --dry-run  # 预览两个 Agent 的安装位置
```

支持 `--skill xmly-music,xmly-cv` 选择技能、`--target-dir` 自定义目录。相同内容跳过，修改过的目标默认不覆盖；`--force` 先备份再更新。安装和调用方式见 [Skills 安装说明](skills/README.md)。技能不包含凭据，安装后按 Agent 的发现机制重新加载或开启新会话。

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

匹配依据为标题、标签、明确同义词、类型和可选时长，适合关键词输入；多个关键词用空格分开。它不分析听感或做通用语义判断。没有足够匹配时返回 `no-confident-match` 和候选，不擅自下载无关结果。`--min-duration/--max-duration` 是本地秒数筛选，在线搜索的 `totalCount` 仍是平台原始总数。

`obtain` 默认按以下顺序获取完整音频：本地完整文件 → 音剪素材包（AI及创作中心两个来源）→ 原创作中心素材库。素材包搜索优先检查包名/描述相关及已导入的包，最终必须由包内条目的标题或描述匹配关键词；包名本身不足以触发导入。命中后先复用已有云端分组，必要时只导入选中的一条，再获取完整音频。它可能在音剪云端新建分组并写入该条素材；不会整包导入或自动购买。

```bash
# 同一命令自动搜索素材包并下载完整音频，之后相同/相近关键词直接复用本地
xmly music obtain --kind music --keyword 尬趣松弛鲜活
xmly music obtain --kind music --keyword 尬趣松弛鲜活 --offline

# 限定在线来源；本地匹配始终优先
xmly music obtain --kind music --keyword 古风 --source materials --library ai --max-packs 20
xmly music obtain --kind sfx --keyword 雨声 --source studio
```

`--source auto|materials|studio` 默认为 `auto`。`materials` 仅查音剪素材包；`studio` 沿用原在线素材库。`--library ai|xmly` 限定素材包来源，不传则都查；制作组素材包可加 `--team-id`。默认最多检查10个可访问的非空包，可用 `--max-packs 1..100` 调整；到达上限而未命中时，结果标注 `searchLimited`。原创作中心搜索及云端同名音频核对最多3页，可用 `--max-pages 1..20` 调整。素材包仅支持 `music/sfx`，`intro/transition` 或带 `--category-id` 的自动请求沿用原素材库；显式 `--source materials` 不支持这些条件。

试听缓存不参与 `obtain`。带时长限制时，素材包条目必须有已知时长且符合条件；未知时长不会为验证用途而自动导入。云端同名条目或分组有歧义、导入结果不确定、类型/时长不一致时停止并返回具体状态，不猜测映射、不继续自动获取。已购买的付费包及有权限的制作组会员包可由平台验证后导入，未购买的包会跳过。导入任务沿用 `materials import` 的任务记录与恢复方式。

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

## 音剪素材库：品类包、试听、云端导入与完整音频

[音剪素材库](https://aigc.ximalaya.com/ai-materials) 以品类包组织音乐和音效，与前面的创作中心 `music` 搜索入口不同。新增 `materials` 命令组，沿用当前 profile 的登录凭据，全程使用纯 Node HTTP。

```bash
# 查找 AI 音乐包；library 可选 ai/xmly，kind 可选 music/sfx
xmly materials list --library ai --kind music --keyword 古风
xmly materials list --library xmly --kind sfx --access free
# access 可选 all/free/limited/member/paid；筛选包名和描述
xmly materials info --pack-id music-0819-43
xmly materials items --pack-id music-0819-43 --keyword 钢琴 --page 1 --page-size 20

# 保存网页试听音频，可用 --offline 复用缓存
xmly materials preview --pack-id music-0819-43 --id xmly-656290 --output ./preview.mp3

# 查看导入请求，再将整包导入音剪云端库
xmly materials import --pack-id xmly-music-儿童 --dry-run
xmly materials import --pack-id xmly-music-儿童

# 查找导入后的云端素材，按 trackId 下载完整音频
xmly materials library groups --kind music
xmly materials library list --group-id 446024 --keyword 吉他
xmly materials library get --id 19687692 --output ./guitar.mp3
xmly materials library get --id 19687692 --offline
```

`import` 会在音剪云端创建同名分组，并按官网协议每批导入5条；它不将整包下载到本机。默认使用个人库，制作组库在查询、导入或下载时加 `--team-id 制作组ID`。会员/付费包要求制作组账号及平台权限；尚未购买的付费包需先在网页完成购买，CLI 不自动购买。

任务记录复用 `jobs.json`：重复执行同一包会跳过已完成批次；云端已导入但没有本地任务记录时返回 `already-imported`，避免重建分组。网络中断或响应异常记为 `uncertain` 并停止，不自动重发。先通过云端分组和 `xmly jobs list` 核对，确认该请求未成功后，用 `xmly jobs resolve --id 任务指纹 --resolution retry`，再执行原导入命令并加 `--retry-failed`。准备请求会创建分组，请核对后再允许重试；不要把素材导入任务通过 `jobs resolve --resolution done` 标记完成，该命令不能补回导入计数。部分条目失败会返回 `partial` 和失败原因，不自动重导整个批次。

`preview` 明确标记为试听，缓存类型为 `preview`，不作为正式配乐自动匹配。`materials library get` 获取账号云端库里的完整音频，按个人/制作组命名空间入库；返回的 `trackId` 是下一次下载使用的数字 ID。完整音频类型为 `music` 或 `sfx`，后续可用现有 `xmly music obtain`、`music library search/tag` 复用。`--output` 不覆盖已有文件。

已实际验证两种来源及音乐/音效列表、包内搜索、试听下载，以及免费「[XM]儿童」包16/16首云端导入；重复导入未新建分组。验证产生的个人分组为446024，「吉他童趣小曲」云端音频 ID 为19687692，完整下载2,348,614字节、时长107.781秒。其他账号需使用自己的分组和音频 ID。详见 [音剪素材包协议](docs/materials-protocol.md)。

## CV 墙：搜索主播与下载样音

复用 `xmly auth login` 保存的登录凭据，使用纯 Node HTTP 查询 [CV 墙](https://aigc.ximalaya.com/cv-market-store)，无需浏览器或额外签名。

```bash
xmly cv search --keyword 古言 --page 1 --page-size 20
xmly cv search --keyword 寒酥酥hs
xmly cv samples --id 490
# 主播 ID 也可以写为 cv-490；样音 ID 来自搜索或 samples 输出
xmly cv get --cv-id 490 --id 1295
xmly cv get --cv-id 490 --id 1295 --output ./samples/guyan.mp3
xmly cv get --cv-id 490 --id 1295 --offline
# 按关键词获取：先查本地样音，无匹配再联网；可限定主播
xmly cv obtain --keyword 古言 --cv-id 490
xmly cv obtain --keyword 寒酥酥hs --offline
# 默认搜索/查看样音也优先本地，显式刷新可查看完整在线列表
xmly cv search --keyword 古言 --refresh
xmly cv samples --id 490 --refresh
```

`search` 默认先查本地已下载且哈希校验通过的样音及已保存的主播元数据，支持主播名、描述和样音标题关键词；本地无匹配才联网。`samples` 同样先返回该主播已有的完整本地样音。本地结果标记 `source:local,cachedOnly:true`，只代表已下载部分。`--refresh` 跳过本地列表查询，查看最新在线完整候选；`--offline` 只查本地，不能与 `--refresh` 同用。在线搜索按平台支持的主播名称/描述进行，不检索音频正文。输出包含主播 ID、名称、描述、技能及样音 ID、标题、秒数。

`obtain` 按标题、标签、主播名和可选时长条件匹配本地样音，未命中才联网搜索并下载，支持 `--cv-id` 限定主播、`--min-duration/--max-duration`、`--output` 和 `--offline`。网络候选中有多个同等匹配项时返回 `ambiguous-match`，请用 `cv get` 明确选择；不会把描述匹配当作听感判断。默认最多搜索3页；指定主播后按 ID 查找也受 `--max-pages 1..100` 限制。

首次按 ID 在线查询主播会分页查找，`samples/get` 默认最多20页、每页50位主播，可用 `--max-pages 1..100` 调整；先按名字搜索可以缩小后续查找范围。`search --page-size` 支持1到100，本地搜索也遵守分页参数。

`get` 先校验本地文件，未命中时重新查询样音地址，并核对主播和样音 ID。音频以 `cv:主播ID:样音ID` 入库，类型为 `voice`，不与配乐/音效混用；下载地址不写入索引或搜索记录。`--offline` 获取仅查本地，未缓存时返回 `not-cached`。`--output` 导出时不覆盖已有文件；扩展名按文件内容识别，可能与网站链接后缀不同，请参考返回的 `ext` 和 `path`。

```bash
xmly music library search --keyword 寒酥酥hs
xmly music library tag --id cv:490:1295 --tags '["古言", "声线参考"]'
```

样音与搜索记录分别保存在当前 profile 的 `audio-library/` 和 `cv-catalog/`，均在仓库外。2026-11-09 已实际验证搜索、指定主播样音查询、下载及离线复用；抽查文件为37.536秒、1,221,125字节，内容格式为 MP3。获取范围为网页提供的试听样音，使用授权需与主播另行确认。接口与验证边界见 [CV 墙接口说明](docs/cv-protocol.md)。

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

设备指纹采集仍由首次登录的真实 Chrome 网页完成；本项目复用这份登记，而没有实现从零模拟浏览器环境。会话服务返回更新后的设备标识时，会保存在 `signer.json`。更换账号或设备、登录状态过期时需重新运行 `xmly auth login`。

`--transport browser`、`signer compare --space-id N` 和显式传入 `--space-id` 的旧凭据捕获仍是 Ego Lite 兼容模式，仅使用这些旧命令才需要 Ego Lite 及其已登录会话；默认 Chrome 登录及纯 Node 功能均不依赖它。

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
