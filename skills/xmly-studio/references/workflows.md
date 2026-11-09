# 发布与编辑流程

所有大写占位符替换成用户账号里的真实 ID 或文件；示例默认不触发写入。账号选择沿用主技能的 profile。

## 发布已上传文件与定时

```bash
xmly publish --upload-id UPLOAD_ID --file-ext mp3 --album-id ALBUM_ID --title '第一章' --ai true --visibility private --dry-run
```

仅在已有上传 ID、明确发布意图及元数据后移除 `--dry-run`。`--intro-file` 可读取 UTF-8 简介；`--cover-id` 为作品封面数字上传 ID。定时新作品使用 `--visibility public --publish-at '带时区的未来ISO时间'`，平台另行检查权限与提前量。

## 批量上传

清单结构如下，示例 `123456` 需要替换，`isAiTrack`、可见范围按用户实际需求修改：

```json
{
  "defaults": { "albumId": 123456, "isAiTrack": true, "visibility": "private" },
  "items": [
    { "file": "./audio/001.mp3", "title": "第一章" },
    { "file": "./audio/002.mp3", "title": "第二章" }
  ]
}
```

相对音频路径按清单所在目录解析。

```bash
xmly batch --manifest ./batch.json --publish --dry-run
```

用户授权发布且预览核对正确后移除 `--dry-run`。不加 `--publish` 时仅上传。恢复按文件内容与参数指纹跳过完成项；不是CLI自有的分片断点续传。普通音频最大1 GiB；格式以安装版本 `--help` 及错误输出为准。

## 修改与专辑

```bash
xmly works info --id TRACK_ID
xmly works update --id TRACK_ID --title '新标题' --dry-run
xmly works update --id TRACK_ID --intro-file ./intro.html --dry-run
xmly works batch-update --manifest ./updates.json --dry-run
```

更新清单使用 `items:[{"trackId":123456,"title":"新标题"}]`，可包含 `defaults`。不要给无关作品批量加 AI 标记或改变可见范围。修改标签时先查看现有结构；标签格式为元数据 ID 到名称数组的映射，例如 `{"-1":["自定义标签"]}`，不是普通字符串数组。

```bash
xmly albums create --title '专辑名' --subtitle '卖点' --category-id CATEGORY_ID --cover-path 'storages/.../cover.jpeg' --cover-ai true --intro '符合平台长度要求的专辑简介' --visibility private --dry-run
```

专辑封面 `--cover-path` 是已上传的图片存储路径，与作品 `--cover-id` 不同。当前封面上传仍需网页，不编造存储路径。专辑默认公开；按用户意图明确传可见范围。CLI只提供新建免费专辑流程。

## 不确定任务

```bash
xmly jobs list
```

核对远端已成功的上传/发布任务后，可以人工标记完成：

```bash
xmly jobs resolve --id JOB_FINGERPRINT --resolution done --track-id TRACK_ID
```

确认没有执行成功时，允许重试：

```bash
xmly jobs resolve --id JOB_FINGERPRINT --resolution retry
xmly batch --manifest ./batch.json --publish --retry-failed
```

重跑与原任务一致的命令与参数。`--retry-failed` 不会自行解锁 `uncertain`。素材包导入共用任务表但需要分组及计数，不能套用 `--resolution done`；该场景使用素材包技能的恢复规则。锁文件异常需先确认没有任务运行再处理，不自动抢锁。
