# 面向 Agent 的技能

这些技能使用通用 `SKILL.md` 目录结构，可复制到支持此格式的 Agent 中。它们指导 Agent 调用已安装的 `xmly`，不内置 CLI、凭据、音频或浏览器工具。

| 技能 | 用途 |
| --- | --- |
| [xmly-music](xmly-music/SKILL.md) | 配乐/音效获取、本地优先复用、素材包与云端完整音频 |
| [xmly-cv](xmly-cv/SKILL.md) | 主播搜索、声线参考、本地优先获取 CV 样音 |
| [xmly-studio](xmly-studio/SKILL.md) | 创作中心查询、专辑、上传发布、编辑和批量恢复 |

按需要安装一个或多个技能。三个目录相互独立，复制时须保留各自的 `references/`、`agents/` 等完整子目录。`agents/openai.yaml` 提供 Codex 的展示信息，通用操作指令在 `SKILL.md` 内。

## 先安装 CLI

从项目根目录安装整个 CLI：

```bash
sh install.sh --source .
xmly --help
```

需要 Node.js 22+。开发调试也可用 `npm link`。联网操作需先用 `xmly auth login` 在系统 Chrome 中扫码；已缓存素材的离线获取无需登录。GitHub一条命令安装、自定义前缀和登录方式见[项目说明](../README.md)。将技能复制到其他机器时，还需单独安装 CLI，不能仅复制技能就直接执行命令。

## 一条命令安装

CLI 安装后，在任何工作目录都可执行，无需登录或联网：

```bash
# 默认：三个技能全部安装到 Codex 用户技能目录
xmly skills install

# 安装到 Claude Code，或两个 Agent 都安装
xmly skills install --agent claude
xmly skills install --agent all

# 仅安装指定技能（多个用逗号分隔）
xmly skills install --agent codex --skill xmly-music,xmly-cv

# 查看内置技能，或先预览安装位置，不创建任何文件
xmly skills list
xmly skills install --agent all --dry-run

# 其他 Agent 或项目级目录：指定技能目录，直接在其中创建技能文件夹
xmly skills install --skill xmly-music --target-dir ./.claude/skills
```

`--agent` 支持 `codex`（默认）、`claude`、`all`。Codex 遵守 `CODEX_HOME`；Claude Code 使用 `~/.claude/skills/`。`--target-dir` 直接指定技能根目录，不能与 `--agent all` 同用。

相同内容重复安装返回 `unchanged`，不重写。目标内容有改动时返回 `conflict` 并停止本次安装；有意更新时使用 `--force`，CLI 先将原技能目录完整备份到技能根目录旁的 `.xmly-skill-backups/`，成功后输出 `backup` 路径。目标是符号链接或含特殊文件时，即使 `--force` 也不覆盖，需人工处理。

```bash
xmly skills install --skill xmly-music --force
```

安装内容来自当前 CLI 包的 `skills/`，保留引用与 UI 元数据；不复制用户凭据、音频或项目配置。

## 手动复制

也可以从仓库手动复制。以下以单个技能为例，其他两个同理；目标已存在时，先比较或备份再更新。

Codex 用户技能目录默认为 `~/.codex/skills/`，自定义 `CODEX_HOME` 时使用其 `skills/` 子目录：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R skills/xmly-music "${CODEX_HOME:-$HOME/.codex}/skills/"
```

Claude Code 可复制到用户技能目录，或目标项目的 `.claude/skills/`：

```bash
mkdir -p "$HOME/.claude/skills"
cp -R skills/xmly-music "$HOME/.claude/skills/"
```

复制后按所用 Agent 的技能发现机制重新加载或开启新会话。在 Codex 中可显式使用 `$xmly-music`、`$xmly-cv`、`$xmly-studio`；其他 Agent 使用其自己的调用方式。

使用示例：

- “用 $xmly-music 找一段10到20秒雨声，优先用已有素材。”
- “用 $xmly-cv 查找古言对白参考，已有样音优先。”
- “用 $xmly-studio 检查这份批量上传清单，先生成发布预览。”

## 其他 Agent 与 npm 分发

将完整技能目录放入对应 Agent 的技能路径；若不支持自动发现 `SKILL.md`，可在其项目指令中引用文件，并确保运行环境能读取同目录引用文件、执行 `xmly`。

`npm pack` 的发布文件白名单包含 `skills/`。用户从本地 tarball 安装 CLI 后，同样可直接运行 `xmly skills install`。安装 CLI 本身不会自动修改用户的 Agent 配置；项目当前未发布到 npm，勿假定可从公共注册表安装。

技能没有绑定开发者账号或示例资源 ID。实际账号通过 `--profile` 选择，所有大写 ID 占位符必须由当前账号的查询结果替换。技能安装不赋予额外的上传、公开发布或付费权限。
