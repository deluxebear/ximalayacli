---
name: xmly-cv
description: 使用喜马拉雅 xmly CLI 查找 CV 墙主播、查看声线参考并获取样音，优先复用本地下载。适用于主播名、古言对白、青年音等样音检索；不提供 AI 语音合成或声音克隆。
---

# 喜马拉雅主播样音

用 `xmly cv` 查找主播和声线参考。这里获取的是 CV 墙试听样音，不是可安装的音色模型或定制录制成品。

## 环境

先用 `xmly --help`、`xmly commands list --compact` 确认已安装且包含 `cv obtain`。没有 CLI 时按项目说明安装，不假设 npm 已发布。本地复用不需要登录；首次联网或会话失效时执行 `xmly auth login`，由用户在系统 Chrome 中扫码，不索取 Cookie。多账号统一使用用户指定的 `--profile NAME`。

## 优先本地获取

```bash
xmly cv obtain --keyword 古言
xmly cv obtain --keyword 古言 --cv-id CV_ID
xmly cv obtain --keyword 主播名 --offline
xmly cv obtain --keyword 古言 --cv-id CV_ID --min-duration 20 --max-duration 60
```

`CV_ID` 是占位符，替换成查询返回的主播数字 ID，也支持 `cv-数字`。`obtain` 先校验本地文件并匹配关键词，无合适样音才加载登录态并联网。关键词依据主播名、样音标题、标签及可选秒数筛选，不分析听感。

- `source:local,reused:true`：直接使用返回的 `item.path`，不要再查询登录或下载。
- `no-local-match`：离线没有合适缓存；尊重用户离线范围。
- `no-confident-match`：展示候选，改进关键词或指定主播；不要把主播描述当作样音听感证据。
- `ambiguous-match`：多个在线样音同等匹配，不自动挑选。请用户明确选择，或按已有明确偏好从候选中选择 ID。

在线未指定主播时按平台的主播名/描述搜索，不能保证找遍所有主播的样音标题。默认最多3页，`--max-pages 1..100` 可调整。

## 查看候选与明确选取

```bash
xmly cv search --keyword 主播名
xmly cv samples --id CV_ID
xmly cv search --keyword 古言 --refresh
xmly cv samples --id CV_ID --refresh
xmly cv get --cv-id CV_ID --id SAMPLE_ID
xmly cv get --cv-id CV_ID --id SAMPLE_ID --output ./voice-reference.mp3
```

`SAMPLE_ID` 使用 `samples` 返回的样音 ID，不能把主播 ID 当样音 ID。`get` 始终校验并优先复用本地；缓存损坏或不存在才获取当前在线地址。

`search/samples` 默认优先本地；结果 `cachedOnly:true` 仅表示已下载的部分，不是主播的完整在线目录。需要查看最新完整候选时显式用 `--refresh`。`--offline` 仅查本地，不能与 `--refresh` 同用。`search` 支持 `--page/--page-size`；指定主播在线查找的 `samples/get` 默认最多20页，可用 `--max-pages` 调整。

`get/obtain` 支持 `--output`，不会覆盖已有文件，也不转码；根据返回的 `ext` 选择输出后缀，不信任网站链接后缀。可用通用本地库增加确认过的参考标签：

```bash
xmly music library tag --id LOCAL_LIBRARY_ID --tags '["古言", "声线参考"]'
```

`LOCAL_LIBRARY_ID` 来自返回的 `item.id`，格式为 `cv:主播ID:样音ID`。凭据和音频默认在 `~/.ximalaya-cli/`，均不提交仓库。输出可加 `--compact` 供程序读取，非零退出或 `ok:false` 不代表获取成功。

区分平台文案、用户确认和实际听感；只有确实听取音频后才描述听感。获取样音不等于取得商用、克隆或合成授权，不能将这些用途视为样音下载的附带权限。
