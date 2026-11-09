---
name: xmly-music
description: 使用喜马拉雅 xmly CLI 为作品寻找、获取和复用配乐或音效，搜索音剪素材包，管理本地音频标签。适用于 BGM、环境音、转场及素材包导入；主播样音和作品发布使用对应技能。
---

# 喜马拉雅配乐与音效

通过 `xmly` 获取可追溯的完整音频。优先本地复用，避免重复下载。所有命令在用户机器执行；不需要浏览器 MCP 或其他技能。

## 环境与账号

- 先运行 `xmly --help` 确认 CLI 已安装，用 `xmly commands list --compact` 核对当前版本支持的命令。找不到命令时，请用户按项目说明安装 CLI，不要猜测 npm 包已发布。
- 本地匹配与 `--offline` 不需要登录。首次联网或会话失效时运行 `xmly auth login`，由用户在打开的系统 Chrome 中扫码；不要要求用户粘贴 Cookie。
- 多账号使用 `--profile NAME`，本次操作的所有命令保持相同 profile；不要擅自切换账号。凭据、索引与任务默认在 `~/.ximalaya-cli/`，可通过 `XMLY_HOME` 更改。
- JSON 为命令结果，非零退出或 `ok:false` 表示未完成；脚本可加 `--compact`，需要读取结果时不要加 `--quiet`。

## 日常获取

用户找配乐或音效时，从 `obtain` 开始：

```bash
xmly music obtain --kind music --keyword '悬疑 鼓点'
xmly music obtain --kind sfx --keyword 雨声 --min-duration 10 --max-duration 20
xmly music obtain --kind music --keyword '古风' --output ./assets/gufeng.mp3
```

`kind` 支持 `music` 配乐、`sfx` 音效、`intro` 片头片尾、`transition` 转场。时长均为秒。输出文件后缀按实际 `ext` 选择；CLI 不转码，也不覆盖已有导出文件。

默认流程：本地有效完整音频 → 音剪素材包 → 原创作中心素材库。素材包命中时可能创建音剪云端分组，只导入选中的一条再下载完整音频。用户明确只要本地时使用 `--offline`，不要联网或导入。

```bash
xmly music obtain --kind sfx --keyword 下雨 --offline
xmly music obtain --kind music --keyword 古风 --source materials --library ai --max-packs 20
xmly music obtain --kind sfx --keyword 雨声 --source studio
```

- `--source auto|materials|studio` 限定在线来源，本地匹配仍优先；`--library ai|xmly` 只限定素材包来源。
- 素材包默认最多检查10包，`--max-packs 1..100` 调整。原库搜索默认最多3页，`--max-pages 1..20` 调整。
- 素材包只支持 `music/sfx`；`intro/transition` 或带 `--category-id` 的自动请求沿用原库。不要将分类 ID 跨来源套用。
- 有时长限制时，未知时长的素材包候选不会自动导入。

## 选择与复用

匹配依据为标题、标签、少量同义词、类型和时长，不代表听感、情绪或授权适用性。复杂用途先审阅候选，必要时试听；不要把“搜索匹配”报告成已听过或确定合适。

```bash
xmly music library search --keyword 雨声
xmly music search --kind sfx --keyword 雨声
xmly music get --kind sfx --id RESOURCE_ID
xmly music library tag --id LOCAL_LIBRARY_ID --tags '["用途", "情绪"]'
```

以上大写 ID 是占位符，必须替换成当前查询结果。`music search/get` 操作原库；音剪素材包与云端音频需使用 `materials` 命令。按返回的 `item.id` 标记确认过的用途；不要把用户的查询词自动当作素材用途事实。

遇到以下结果时：

- `source:local,reused:true`：直接使用返回的 `item.path`，无需验证登录或再次下载。
- `no-local-match`、`not-cached`：离线范围内没有文件，不算获取成功。
- `no-confident-match`：展示候选和搜索范围，调整关键词或让用户明确选择；不要盲取首条。
- `ambiguous-*`、`*-mismatch`、`needs-review`、`partial`：停止自动获取，报告具体状态，按素材包参考核对；不要改成下载试听文件或反复重试。

需要手动搜索包、整包导入、查看云端分组或恢复素材导入任务时，读取 [素材包与云端库](references/materials.md)。

不绕过库直接重复下载 CDN 文件，不自动购买付费包。不要将凭据、下载文件、任务记录或带签名链接写进代码仓库。
