# 素材包与云端库

## 搜索、试听与完整下载

```bash
xmly materials list --library ai --kind music --keyword 古风
xmly materials list --library xmly --kind sfx --access free
xmly materials info --pack-id PACK_ID
xmly materials items --pack-id PACK_ID --keyword 钢琴 --page 1 --page-size 20
xmly materials preview --pack-id PACK_ID --id ITEM_ID
```

占位符来自实时结果。`packId`、包内 `itemId` 可含中文，不等于云端音频数字 ID。`preview` 只保存试听，类型为 `preview`；它不参与正式配乐的 `obtain`。不要向用户承诺试听就是完整文件。

`obtain` 适合自动获取一条；用户明确要求整包写入云端时使用：

```bash
xmly materials import --pack-id PACK_ID --dry-run
xmly materials import --pack-id PACK_ID
xmly materials library groups --kind music
xmly materials library list --kind music --group-id GROUP_ID --keyword 钢琴
xmly materials library get --id MUSIC_ID --output ./chosen.mp3
```

`--dry-run` 只读详情并预览导入请求。整包导入在云端新建同名分组，每批最多5条，不会整包下载到本机。已有本地任务记录时跳过完成项；云端已导入但无本地记录时返回 `already-imported`，不重复建组。

`materials library list` 返回的 `trackId` 才是 `library get --id` 使用的数字 ID。下载后的 `item.id` 是本地带命名空间的 ID，用于标签管理。完整音频可被 `music obtain` 复用，重复 `library get` 也优先本地，可加 `--offline`。

所有命令默认个人库。用户已指定制作组时统一加 `--team-id TEAM_ID`。会员与付费包需制作组权限；未购买付费包需用户在网页明确购买，CLI 不自动扣星点购买。

## 导入异常

`music obtain` 自动导入单条与 `materials import` 整包导入共用当前 profile 的任务记录：

```bash
xmly jobs list
```

`uncertain` 表示提交后结果不确定。先查询分组和素材核对，不能因网络报错就认定服务端未执行。确认请求没有成功后才可：

```bash
xmly jobs resolve --id JOB_FINGERPRINT --resolution retry
# 然后重跑原 music obtain 或 materials import 命令，并加 --retry-failed
```

准备请求会创建分组，重复提交可能建出额外分组。不要用 `jobs resolve --resolution done` 完成素材导入任务：这个通用命令不能补回所需分组和导入计数。`partial` 保留失败项，不自动重导整个批次；报告失败原因并核对云端。

出现锁超时，先确认是否有任务仍运行；不要自动删除锁来强行继续。
