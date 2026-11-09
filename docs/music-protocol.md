# 素材库协议与验证

2026-11-09 研究入口：<https://studio.ximalaya.com/music-web/index/>。

## 证据与边界

已使用现有登录 Cookie，直接通过 Node fetch 获取 HTML，解析出的官方业务脚本为：

`https://s1.xmcdn.com/yx/sudio-music-library/last/build/static/js/main.chunk.js?v=2026073001`

业务脚本约 49 KB，以静态文本分析，未执行脚本。REA 父证据：`ev_db4a57e9e0607fa2b24650b2a398baba93826e474040518c952fa57bafa8a552`。只分析 `main.chunk.js`；静态路由枚举未提取到路由，不能据此推断没有接口。下表来自业务脚本中的 API 常量和调用点，并由真实 Node 请求验证。未启动或依赖浏览器，未用 `xm-sign`。

## 接口

基域 `https://studio.ximalaya.com`，接口前缀 `/music-web`。第一方 JSON 请求携带原有 Cookie，CDN 文件下载不携带 Cookie。

| 功能 | 方法与路径 | 参数/返回 |
| --- | --- | --- |
| 配乐分类 | GET `/web/getWebCategories` | `data:[{id,name}]` |
| 音效分类 | GET `/api/acoustic/listAcousticCategory` | `data:[{categoryId,categoryName,items}]` |
| 配乐和片头片尾搜索 | POST `/web/fuzzySearchMusics` | JSON `{subCategoryIds:[],fuzzyWord,pageSize:12,pageNo:1,businessId:3,relationType:2}`；片头片尾 relationType=4 |
| 音效搜索 | GET `/api/acoustic/searchCategory` | `keyword,pageSize:24,pageNo,musicType:3,businessId:3,relationType:3`，可加 categoryId |
| 转场音效搜索 | GET `/api/acoustic/searchTransition` | 同音效，relationType=5 |
| 配乐/片头正式下载地址 | GET `/web/getDownloadInfo?trackId=ID` | `data.fileName,downloadPath`；不拿预览地址代替正式下载 |
| 音效下载许可 | GET `/api/acoustic/checkCanDownload` | code200允许，code6001要求主播身份认证；通过后下载搜索结果 playPath，与网页行为一致 |

搜索结果位于 `data.result`，包含 `totalPage/totalCount`。音乐 ID 是 trackId，音效 ID 是 id。音乐优先使用 millDuration/1000，否则 duration 秒（旧 coverPath 轨道为毫秒）；音效 duration 毫秒。CLI 统一输出秒。

音乐模糊搜索可能返回宽泛候选，例如搜索“悬疑”时首条标题可能不包含该词；自动获取必须检查标题/标签，不能盲选首条。音乐分类同样以返回的标签与分类名交叉核对，不能把传入的分类直接当成所有结果的事实。时长筛选在当前页执行，totalCount 保留平台原始总数。

`music obtain` 现默认先本地匹配完整文件，再查音剪素材包，最后回退本节的原素材库；`music search/get` 保持原接口。素材包的单条导入、完整音频映射及验证见 [音剪素材包协议](materials-protocol.md)。可通过 `--source studio` 使用原在线获取流程。

## 本地复用

每个 profile 独立保存：

- `audio-library/index.json`：元数据、文件 SHA256、字节数、类型、时长、标签。
- `audio-library/objects/<sha256>.<ext>`：音频本体，相同内容只存一份，不按标题覆盖。
- `music-catalog/<kind>/<id>.json`：搜索记录，含平台播放地址，用于音效按 ID 获取。该目录属于私有用户状态，不进入 npm 包或 git；正式配乐下载地址每次从接口重新获取。

本地命中会验证完整文件的 SHA256 和大小，不读取登录文件，不调用网络；损坏或丢失的文件不会用于匹配。临时下载成功后再入库，失败不写完成记录。索引使用进程锁和原子替换；异常退出留锁时超时提示 PID，需先确认进程结束，再手动移除指定锁文件，避免自动抢锁引发并发损坏。

匹配为保守关键词规则：Unicode归一化、标题/标签、明确同义词（例如“下雨”与“雨声”）、类型、分类、时长。全部有效词都需匹配；一字查询或复杂自由描述可能没有足够匹配。不会分析音频听感、音乐情绪、循环接缝或自动判断授权适用范围；用户可增加经确认的用途标签。搜索词历史不作为适用证据。

WAV/M4A 可从容器头读取时长，不依赖 ffprobe；其他格式优先用搜索结果中的时长，导入时也可提供 `--duration`。下载检查 HTTPS、官方 CDN 域、重定向域、大小、长度与音频文件头，拒绝登录页或未知格式。

## 真实验证

以下资源通过 CLI 真实下载并保存，仅获取素材，没有上传或发布作品：

| 素材 | ID | 字节 | ffprobe 确认 |
| --- | --- | --- | --- |
| 城市落雨声响 | sfx:8669 | 57,708 | AAC，44.1kHz，双声道，18秒 |
| 悬疑电影低沉鼓点 | music:1001316930 | 481,342 | AAC，44.1kHz，双声道，约29.634秒 |

将仅含音频库的目录复制到临时 XMLY_HOME，未放入 auth.json；CLI 子进程 PATH 指向不存在的目录，并用 Node preload 禁止 fetch。以下调用仍返回 `source:local,reused:true`：

```sh
xmly music obtain --kind sfx --keyword 下雨 --min-duration 10 --max-duration 20
xmly music get --kind music --id 1001316930
```

这验证了重复获取及相似关键词复用不会读取登录态、启动浏览器或访问网络。私有验证报告保存在 `~/.ximalaya-cli/outputs/music-validation.json`。已验证四类搜索与两类真实下载；未覆盖所有分类、所有文件格式和所有账号权限状态。
