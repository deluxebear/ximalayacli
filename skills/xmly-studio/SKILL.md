---
name: xmly-studio
description: 使用喜马拉雅 xmly CLI 查询和管理创作中心专辑、作品、音频上传发布、定时任务与批量任务恢复。适用于有声书上传、章节发布或作品编辑；配乐和主播样音检索使用对应技能。
---

# 喜马拉雅创作中心

通过 `xmly` 管理用户账号内的专辑与作品。执行用户已授权的操作，不把“检查音频”扩展成上传或发布。

## 准备与账号

```bash
xmly --help
xmly commands list --compact
xmly auth status
xmly doctor
```

找不到 CLI 时按项目说明安装；本项目未承诺发布到 npm。需要登录时执行 `xmly auth login`，让用户在系统 Chrome 中扫码。所有后续命令沿用同一 `--profile NAME`；默认纯 Node 传输，日常操作不需要浏览器持续运行。不要为处理普通错误擅自切换 `--transport browser`。

凭据、设备登记与任务记录默认存放在 `~/.ximalaya-cli/`，不提交仓库，不索取或输出 Cookie 和签名。更换账号时重新登录；设备登记问题按 CLI 提示捕获，不复用其他账号状态。

## 确认对象

```bash
xmly albums list --keyword 专辑名
xmly albums info --id ALBUM_ID
xmly albums tracks --id ALBUM_ID --page 1 --page-size 20
xmly works list
xmly works info --id TRACK_ID
xmly scheduled list
```

所有大写 ID 是占位符，替换为当前账号查询结果；不能沿用示例中的历史 ID。`albumId`、作品 `trackId`、上传 `uploadId` 不可混用。

## 上传、发布与修改

按用户请求区分“仅上传”和“提交发布”。AI属性和可见范围从用户意图或已知作品信息确定，不编造：

```bash
# 只上传，不创建公开作品
xmly upload --file /absolute/path/episode.mp3

# 用户已要求发布并确定参数时，先构造预览
xmly upload --file /absolute/path/episode.mp3 --publish --album-id ALBUM_ID --title '第一章' --ai true --visibility private --dry-run
# 核对预览与用户授权一致后，移除 --dry-run 执行
```

`--ai true|false` 是新发布必填项；`--visibility` 支持 `public/private/friends`。不要把示例的 AI 或私密设置当成用户偏好。任务已获明确授权且参数完整时，核对预览后继续执行，不必重复确认；缺少关键意图或对外发布授权时，先准备可审阅的预览再澄清。

已有上传结果可使用 `publish --upload-id`，避免重复传输。需要批量清单、定时、编辑或新建专辑时，读取 [发布与编辑流程](references/workflows.md)。

修改前读取 `works info`，只设置用户要求的字段，使用 `works update ... --dry-run` 核对；CLI 保留未变字段。定时必须使用未来且带时区的时间，只支持公开新作品，不把它当成编辑现有作品的参数。

## 判断完成与恢复

- 命令输出 JSON；用 `--compact` 便于解析，不要用 `--quiet` 隐藏需要检查的结果。
- 非零退出或 `ok:false` 是失败/待处理。提交接口成功只表示请求被接收；通过作品查询确认转码、审核和可见状态，不宣称已经公开可播放。
- 任务为 `uncertain` 或 `needs-review` 时，先读取 `xmly jobs list` 并核对远端，不能直接重跑发布。确认未执行后才解锁并显式重试。
- 不自动删除锁文件，不因超时重新上传整个文件或再次创建作品。任务恢复细节见工作流参考。
