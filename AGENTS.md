# 工作约定

- 始终用中文与用户沟通，编程开发时保持逻辑清晰。
- 为作品寻找配乐或音效时，优先使用 `xmly music obtain --kind 类型 --keyword 关键词`。该命令先查本地库，合适则复用，没有匹配才在线搜索和下载。
- 查看候选用 `xmly music library search`，查看在线资源用 `xmly music search`，明确选定后用 `xmly music get`；不要绕过库直接重复下载 CDN 文件。
- 用 `xmly music library tag --id 本地ID --tags '["用途", "情绪"]'` 记录确认过的用途，方便后续复用。匹配依据为标题、标签、少量同义词、类型和时长，不等同于听感判断；复杂用途先审阅候选。
- 凭据、素材文件、抓取记录及带签名链接保存在仓库外，不提交。
