# 音剪素材库协议与验证

研究日期：2026-11-09。入口：<https://aigc.ximalaya.com/ai-materials>。对照页面交互及前端 `materialPack`、素材库页面、`music` 和 `chapterList` 业务模块，再用当前 profile 凭据逐步验证。私有记录、素材及任务状态均在 `~/.ximalaya-cli/` 下，不进入仓库。

## 页面工作流

选择来源 `ai` 或 `xmly`，选择音乐或音效，按访问类型筛选并搜索包名/描述；查看包内条目；试听单条；导入整包到个人或制作组云端库。在云端音乐/音效库中可查看分组、搜索和读取完整音频。网页包列表与包内详情均一次返回全部内容，页面上的关键词过滤在本地完成，CLI 同样处理；包内分页由 CLI 执行。

实测当日：AI音乐67包，AI音效2包（示例空包）；创作中心音乐24包、音效7包。数量和限免访问状态可能变化，命令实时查询。访问类型包含 `free`、`limited`、`member`、`paid`；不把未知值当作限免。会员/付费包需制作组，付费包先在网页购买，服务端仍执行最终权限检查。

## 品类包接口

主机 `https://aigc.ximalaya.com`，前缀 `/voice-studio-music/material-pack`。GET 携带 `roleType:1`（个人）或 `roleType:2,teamId`（制作组）。JSON POST 同时包含作用域和 `clientVersion:"2"`。Cookie 按域名匹配，Origin/Referer 对应音剪网页；无需 `xm-sign`。业务成功码为 `200000`。

| 操作 | 方法/路径 | 参数或响应 |
| --- | --- | --- |
| 包列表 | GET `/list` | `library:ai或xmly,musicType:2音乐或1音效`；data 数组 |
| 包详情 | GET `/detail` | `packId`；data 含 items 数组 |
| 试听 | GET `/preview` | `packId,itemId`；返回音频二进制，非 JSON 地址 |
| 准备导入 | POST `/import/prepare` | `packId`；返回 `groupId,groupName,itemIds`，会新建分组 |
| 分批导入 | POST `/import/chunk` | `packId,groupId,itemIds`，每批最多5条；返回 `success,failed,failItems` |

包字段包括 `packId,name,description,musicType,library,accessType,purchased,imported,itemCount,downloadCount,smartPostUseCount`，付费包可能包含 `priceStarPoints`。条目字段包括 `itemId,name,description,previewable,durationMs`，CLI 将可用时长转为秒。素材包 ID、条目 ID 可能含中文，不能强制当作数字。

未登录页面另有 `/public/list`、`/public/detail`；CLI 使用已登录接口，不用公开元数据猜测文件地址。购买接口 `/purchase` 已从前端调用点确认，但本次未实现或调用。

## 云端库接口

前缀 `/voice-studio-music`。注意列表作用域参数为 `type`，详情和音频参数为 `roleType`，不能混用。

| 操作 | GET 路径 | 参数 |
| --- | --- | --- |
| 分组 | `/group/list` | `groupType:2音乐或1音效,type:1或2,teamId可选` |
| 音频搜索 | `/music/list` | `musicType,type,teamId可选,pageNum,pageSize,queryText,groupId可选,subGroup:0` |
| 音频详情 | `/music/detail` | `musicId,roleType,teamId可选` |
| 完整音频 | `/music/audio` | 同详情；返回二进制 |

音频列表包含 `list,totalCount,pageNum,pageSize,pageCount`。`musicId` 是账号云端音频数字 ID，与品类包中的 `itemId` 不同；列表 `duration` 为毫秒，CLI 转成秒。

## 本地存储与恢复

试听 ID 为 `preview:<包ID与条目ID的SHA256>`，类型为 `preview`；不把试听音频当作完整配乐。完整音频 ID 为 `aigc:personal:<musicId>` 或 `aigc:team-<teamId>:<musicId>`，类型为 `music`/`sfx`，可供已有 `music obtain` 复用。均复用现有音频库的文件哈希校验、去重、锁和原子写入；只缓存有效完整响应，不保存音频 URL。第一方二进制端点携带域匹配 Cookie，重定向到 CDN 不携带认证；检查域名、响应类型、大小、完整性和文件头。导出不覆盖已有文件。

准备任务以包 ID 和作用域计算指纹，分批任务以准备指纹、分组和条目 ID 计算指纹，记录在当前 profile 的 `jobs.json`。写请求明确关闭自动重试。已完成任务跳过；准备或分批请求断线后记为 `uncertain` 并停止；业务明确拒绝记为 `failed`。只有人工核对未成功、解锁并显式 `--retry-failed` 才能重试不确定任务。已导入但无本地记录时不重复创建。分批部分失败返回 `partial` 并保留失败原因，不自动重复整批。

`--dry-run` 只读取详情，输出请求计划，不创建分组或任务记录。通用 `jobs resolve --resolution done` 无法补入导入所需的分组及计数，所以不应以此完成导入任务；核对确认请求未成功时使用 `--resolution retry`。

## 实际验证

- 四种来源/类型组合的列表、详情与包内筛选均通过纯 Node 请求验证。
- AI搞笑包 `music-0819-43` 中 `xmly-656290` 试听成功，文件2,084,712字节，MP3；仅按试听保存。
- 免费「[XM]儿童」包 `xmly-music-儿童` 创建个人分组446024，按5、5、5、1导入，成功16、失败0；重复执行所有批次为 skipped。
- 云端分组列表确认16条；云端音频19687692「吉他童趣小曲」详情与完整下载成功，107.781秒，2,348,614字节，MP3。
- 单元测试覆盖参数与作用域差异、中文ID、分页、授权边界、试听与完整缓存隔离、离线复用、重复导入跳过、断线暂停和人工核对后续传、异常计数与部分失败。

会员和付费包未实际购买/导入；制作组作用域完成请求构造测试，未向制作组做真实写入。自动批量下载整个包暂未提供；可通过云端分页列表逐条明确下载。

## 接入 music obtain

默认顺序为本地完整音频、音剪素材包、原创作中心素材库。`--source materials|studio` 可限定在线来源，离线模式和本地命中不加载凭据或远端。素材包支持 `music/sfx`；原创作中心的分类ID、片头和转场继续走原实现。

两种来源的包列表按关键词覆盖及是否已导入排序，默认检查最多10包（`--max-packs 1..100`）。包内匹配复用现有关键词、同义词、类型及时长规则；包名与包描述只用于排序，不能单独作为条目匹配证据。若有时长条件但条目缺少时长，不触发导入。未购买付费包和个人账号的会员包跳过，不调用购买接口。

命中条目后，先从导入准备记录取得分组ID，或在已导入包没有本地记录时查找唯一同名分组；核对云端条目的精确标题、类型、已知时长。不能唯一对应则停止。已有音频直接下载；尚未导入时仍调用官网准备接口取得分组与所有允许导入的条目ID，但分批请求只提交选中的单个ID。准备任务按包及作用域复用；单条分批任务按选中的ID计算指纹，后续取另一条也不会重建分组。`materials import` 仍可显式导入整包。

完整音频仅从 `/music/audio` 获取，不调用 `/material-pack/preview`。本地索引保留条目用途描述，便于后续匹配；不将宽泛包名写为每一条音频的用途标签。结果返回 `provider:materials,packId,materialItemId,match`，便于追溯匹配依据；文件仍按哈希去重。

真实验证：通过 `music obtain --keyword 尤克里里轻音乐 --source materials --library xmly` 从已有儿童分组获得完整音频19687693，139.598秒、3,179,193字节；随后离线复用成功。通过 `music obtain --keyword 尬趣松弛鲜活 --source materials --library ai` 在尚未导入的AI搞笑包中只导入 `xmly-656290` 一条，获取完整云端音频19691071，85.608秒、2,084,712字节；与此前试听文件内容相同，但实际请求使用正式云端音频接口并以正式配乐元数据入库。
