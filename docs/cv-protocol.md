# CV 墙样音协议

2026-11-09 对照页面 `https://aigc.ximalaya.com/cv-market-store` 及其前端脚本，并用现有 profile 凭据验证。

## 查询接口

登录后接口：`POST https://aigc.ximalaya.com/voice-studio-account/account/cv-market-store/wall/list`。

```json
{"keyword":"主播名称或描述","pageNum":1,"pageSize":20}
```

该 POST 是只读搜索，可重试。沿用域名匹配后的登录 Cookie，Origin 为 `https://aigc.ximalaya.com`，Referer 为 CV 墙页面；无需 `xm-sign`。业务成功码为 `200000`，不能套用素材库的 `200`。失败或无效响应直接报错，不降级为匿名接口。

响应 `data` 包含 `list`、`totalCount`、`pageNum`、`pageSize`、`pageCount`。主播具有 `id`（如 `cv-490`）、`cvInfoId`、`name`、`description`、`skills`、`voiceSamples`。每条样音包含 `id`、`title`、`url`、`duration`（秒）。前端也兼容 `durationSeconds`、`duration_seconds` 和 `durationMs`，CLI 使用相同换算。

未登录页面另有 `GET /voice-studio-account/account/cv-market-store/public/wall/list?keyword=&pageNum=1&pageSize=20`，实际返回的公开样音不含 URL。本实现使用已登录接口获取样音，不以公开结果推测下载地址。

## 命令与缓存

- `cv search`：优先从已校验的本地CV样音与已保存的主播元数据搜索；无本地匹配才联网。在线按官网条件搜索，保存精简元数据到 profile 的 `cv-catalog/<主播ID>.json`。不保存地址或联系方式。
- `cv samples --id 主播ID`：优先返回指定主播的有效本地样音；需要联网时，若有历史名称先缩小搜索范围，并严格核对主播 ID；无匹配则有界分页扫描完整列表。不存在或超过页数上限时明确报错。`search/samples --refresh` 显式强制查询完整在线列表，本地结果均标记 `cachedOnly:true`。
- `cv get --cv-id 主播ID --id 样音ID`：先校验本地 SHA256 和字节数；未命中时查询当前主播与样音地址，再通过已有下载器获取。
- `cv obtain --keyword 关键词 [--cv-id 主播ID]`：先对本地 `voice` 类型且ID属于 `cv:` 命名空间的有效文件做关键词及时长匹配；无匹配才加载登录态，查询在线主播与样音。在线使用标题及主播名做保守匹配，多个同等匹配项返回 `ambiguous-match` 候选。支持离线、指定主播、时长筛选和不覆盖导出。在线搜索默认最多3页，可用 `--max-pages 1..100` 调整。它不分析听感或执行声音克隆。

下载器升级 HTTP 链接为 HTTPS，对每次重定向检查官方域名，不向 CDN 发送 Cookie，限制大小、校验响应完整性并按文件头识别格式。复用 `AudioLibrary` 的锁、临时文件清理和内容去重。库 ID 为 `cv:<主播ID>:<样音ID>`，类型为 `voice`，来源为 `ximalaya-cv-wall`。索引、抓取记录与凭据均在仓库外。

## 已验证与边界

使用真实 CLI 完成 `cv search --keyword 寒酥酥hs`、`cv samples --id 490`、`cv get --cv-id 490 --id 1295` 和重复离线获取。样音时长37.536秒，完整文件1,221,125字节；网站 URL 后缀及 Content-Type 指向 M4A/MP4，但文件头为 ID3，下载器实际识别为 MP3。无转码。

自动化测试覆盖请求字段、响应成功码、分页上限、重名与改名后的 ID 核对、归属不符及无地址拒绝下载、无凭据离线复用和导出不覆盖。CDN 格式、长度、重定向与域名检查沿用素材库测试。

未执行全站批量下载，未验证所有样音格式或所有账号的访问权限。命令获取网页提供的试听文件，不包含主播原始工程、定制录制、AI 合成或使用授权。
