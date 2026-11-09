#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { paths, readJson, saveJson, redact } from "../lib/config.mjs";
import { Client } from "../lib/client.mjs";
import * as auth from "../lib/auth.mjs";
import * as works from "../lib/works.mjs";
import { createSession } from "../lib/transport.mjs";
import { NativeSigner } from "../lib/signer.mjs";
import { loadManifest, runBatch, resolveJob } from "../lib/batch.mjs";
const commands = [
  "auth login",
  "auth capture",
  "auth status",
  "auth capture-signer",
  "signer status",
  "signer check",
  "signer compare",
  "music categories",
  "music search",
  "music get",
  "music obtain",
  "music library list",
  "music library search",
  "music library import",
  "music library tag",
  "cv search",
  "cv samples",
  "cv get",
  "cv obtain",
  "materials list",
  "materials info",
  "materials items",
  "materials preview",
  "materials import",
  "materials library groups",
  "materials library list",
  "materials library get",
  "doctor",
  "albums list",
  "albums create",
  "albums info",
  "albums tracks",
  "works list",
  "works info",
  "works update",
  "works batch-update",
  "scheduled list",
  "upload",
  "publish",
  "batch",
  "jobs list",
  "jobs resolve",
  "config list",
  "config get",
  "config set",
  "commands list",
  "completion",
];
const strings = [
  "profile",
  "id",
  "album-id",
  "page",
  "page-size",
  "keyword",
  "file",
  "manifest",
  "title",
  "intro",
  "intro-file",
  "tags",
  "visibility",
  "ai",
  "publish-at",
  "cover-id",
  "timeout-ms",
  "space-id",
  "upload-id",
  "file-ext",
  "category-id",
  "cover-path",
  "cover-ai",
  "subtitle",
  "resolution",
  "track-id",
  "transport",
  "kind",
  "min-duration",
  "max-duration",
  "max-pages",
  "duration",
  "output",
  "chrome-path",
  "cv-id",
  "pack-id",
  "group-id",
  "team-id",
  "library",
  "access",
  "source",
  "max-packs",
];
const bools = [
  "help",
  "dry-run",
  "publish",
  "retry-failed",
  "compact",
  "quiet",
  "offline",
  "no-wait",
  "refresh",
];
const options = Object.fromEntries([
  ...strings.map((x) => [x, { type: "string" }]),
  ...bools.map((x) => [x, { type: "boolean" }]),
]);
options.help.short = "h";
function help() {
  return `喜马拉雅创作中心 CLI（Node.js 22+）

用法：xmly <命令> [选项]

  auth login [--chrome-path 路径]     打开系统 Chrome，扫码后自动保存凭据
  auth login --no-wait                打开 Chrome 后返回，稍后手动捕获
  auth capture                       从 CLI 专用 Chrome 保存登录状态
  auth status                        查看本地凭据摘要
  auth capture-signer                 从 CLI 专用 Chrome 刷新签名设备登记
  signer status|check|compare         签名状态、无浏览器检查、原厂对照
  doctor                             只读检查登录与上传权限
  albums list [--keyword 文本]        专辑列表
  albums create --title 名称 --subtitle 卖点 --category-id 分类ID
                --cover-path 上传后路径 --cover-ai true|false [--dry-run]
  albums info --id ID                 专辑信息
  albums tracks --id ID               专辑内作品
  works list                         作品列表
  works info --id ID                  作品完整编辑信息
  works update --id ID [设置]         修改作品，支持 --dry-run
  works batch-update --manifest 文件  批量修改作品，支持 --dry-run
  scheduled list                     定时发布列表
  music categories --kind 类型       配乐/音效分类
  music search --keyword 关键词 [--kind 类型]   在线搜索音频素材
  music get --id ID [--kind 类型] [--output 文件]   获取素材，优先复用已有文件
  music obtain --keyword 描述 [--kind 类型]      本地匹配优先，无匹配再搜索下载
  music library list|search|import|tag            管理本地可复用音频库
  cv search [--keyword 主播名称或描述]           搜索 CV 墙主播及样音
  cv samples --id 主播ID                         查看指定主播的样音
  cv get --cv-id 主播ID --id 样音ID [--output 文件]  下载样音，优先复用本地
  cv obtain --keyword 关键词 [--cv-id 主播ID]     本地样音优先，无匹配再联网获取
  cv search/samples --refresh                    联网查询最新列表（默认本地优先）
  materials list [--library ai|xmly] [--kind music|sfx]  音剪素材包列表
  materials info --pack-id 包ID                       素材包信息与访问类型
  materials items --pack-id 包ID [--keyword 文本]      包内素材搜索与分页
  materials preview --pack-id 包ID --id 素材ID [--output 文件]  缓存试听音频
  materials import --pack-id 包ID [--dry-run]          导入音剪云端库，每批5条
  materials library groups [--kind music|sfx]          查看音剪云端分组
  materials library list [--group-id 分组ID]           搜索云端素材
  materials library get --id 云端音频ID [--output 文件]  获取完整音频，优先复用本地
  upload --file 音频                  仅传输文件，返回 uploadId
  upload --file 音频 --publish --album-id ID --ai false [设置]
  publish --upload-id ID --file-ext mp3 --title 标题 --album-id ID --ai true|false
  batch --manifest 文件 [--publish]   按清单依次上传，支持 --dry-run
  jobs list                          查看批量任务记录
  jobs resolve --id 指纹 --resolution done|retry  人工核对后处理结果不确定项
  config list|get|set [键] [值]       用户配置
  commands list                      命令注册表
  completion bash|zsh|fish            生成补全脚本

设置：--title 标题 --intro 简介 --intro-file 文件 --tags JSON
      --visibility public|private|friends --ai true|false
      --publish-at ISO时间 --cover-id 上传后的封面ID
通用：--profile default --page 1 --page-size 20 --compact --quiet
素材：--kind music|intro|sfx|transition --min-duration 秒 --max-duration 秒
      --offline（仅复用本地）--output 文件（导出且不覆盖已有文件）
素材包：--library ai|xmly --kind music|sfx --access all|free|limited|member|paid
        --team-id 制作组ID（省略则个人库）；import 写入云端，支持 --dry-run
自动获取：music obtain --source auto|materials|studio --max-packs 10
          默认先本地，再音剪素材包，再原素材库；命中包时只导入选中条目
批量任务通过文件内容指纹跳过已完成项。结果不确定时停止自动重传。
上传与发布默认使用纯 Node 协议；--transport browser 显式使用旧浏览器实现。
`;
}
function integer(v, name) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error(`${name} 必须是正整数`);
  return n;
}
function boolean(v) {
  if (v === undefined) return undefined;
  if (!["true", "false"].includes(v))
    throw new Error("--ai 必须是 true 或 false");
  return v === "true";
}
async function settings(v) {
  return {
    ...(v.title !== undefined ? { title: v.title } : {}),
    ...(v.intro !== undefined ? { intro: v.intro } : {}),
    ...(v["intro-file"]
      ? { intro: await readFile(resolve(v["intro-file"]), "utf8") }
      : {}),
    ...(v.tags ? { tags: JSON.parse(v.tags) } : {}),
    ...(v.visibility ? { visibility: v.visibility } : {}),
    ...(v.ai !== undefined ? { isAiTrack: boolean(v.ai) } : {}),
    ...(v["publish-at"] ? { publishAt: v["publish-at"] } : {}),
    ...(v["cover-id"]
      ? {
          coverId: integer(v["cover-id"], "cover-id"),
          cover: { fileId: integer(v["cover-id"], "cover-id") },
        }
      : {}),
  };
}
const query = (v) => ({
  ...(v.page ? { page: integer(v.page, "page") } : {}),
  ...(v["page-size"] ? { pageSize: integer(v["page-size"], "page-size") } : {}),
  ...(v.keyword ? { kw: v.keyword } : {}),
  ...(v["album-id"] ? { albumId: integer(v["album-id"], "album-id") } : {}),
});
async function main() {
  const { values: v, positionals: a } = parseArgs({
    allowPositionals: true,
    options,
  });
  if (v.help || !a.length) {
    process.stdout.write(help());
    return;
  }
  const profile = v.profile || "default",
    p = paths(profile);
  let result;
  const config = await readJson(p.config, {
    retry_count: 3,
    timeout_ms: 30000,
  });
  const print = (r) => {
    if (!v.quiet)
      console.log(JSON.stringify(redact(r), null, v.compact ? 0 : 2));
  };
  if (a[0] === "music") {
    const { runMusicCommand } = await import("../lib/music-cli.mjs");
    result = await runMusicCommand(a, v, p, config);
  } else if (a[0] === "materials") {
    const { runMaterialsCommand } = await import("../lib/materials-cli.mjs");
    result = await runMaterialsCommand(a, v, p, config);
  } else if (a[0] === "cv") {
    const { runCvCommand } = await import("../lib/cv-cli.mjs");
    result = await runCvCommand(a, v, p, config);
  } else if (a[0] === "auth") {
    const authOptions = {
      ...(v["timeout-ms"] ? { timeoutMs: integer(v["timeout-ms"], "timeout-ms") } : {}),
      onProgress: (message) => { if (!v.quiet) console.error(message); },
    };
    if (a[1] === "login") result = await auth.login(profile, {
      ...authOptions, chromePath: v["chrome-path"], noWait: !!v["no-wait"],
    });
    else if (a[1] === "capture")
      result = await auth.capture(profile, v["space-id"], authOptions);
    else if (a[1] === "capture-signer")
      result = await auth.captureSigner(profile, v["space-id"], authOptions);
    else if (a[1] === "status") result = await auth.status(profile);
    else throw new Error("auth 支持 login/capture/status/capture-signer");
  } else if (a[0] === "signer") {
    const signer = await NativeSigner.fromProfile(profile);
    if (a[1] === "status") result = signer.status();
    else if (a[1] === "check") {
      const signed = await signer.sign();
      result = { ok: true, submitted: false, ...signed.meta };
    } else if (a[1] === "compare") {
      const { compareSigner } = await import("../lib/signer-oracle.mjs");
      result = await compareSigner(signer, v["space-id"]);
    } else throw new Error("signer 支持 status/check/compare");
  } else if (a[0] === "commands" && a[1] === "list") result = { commands };
  else if (a[0] === "completion") {
    const names = [
      "auth",
      "doctor",
      "albums",
      "works",
      "scheduled",
      "upload",
      "publish",
      "batch",
      "jobs",
      "config",
      "commands",
      "completion",
      "signer",
      "music",
      "cv",
      "materials",
    ];
    const shell = a[1];
    if (shell === "bash")
      process.stdout.write(`complete -W '${names.join(" ")}' xmly\n`);
    else if (shell === "zsh")
      process.stdout.write(
        `#compdef xmly\ncompdef '_arguments "1:command:(${names.join(" ")})"' xmly\n`,
      );
    else if (shell === "fish")
      process.stdout.write(`complete -c xmly -f -a '${names.join(" ")}'\n`);
    else throw new Error("completion 支持 bash/zsh/fish");
    return;
  } else if (a[0] === "config") {
    if (a[1] === "list") result = config;
    else if (a[1] === "get") result = { key: a[2], value: config[a[2]] };
    else if (a[1] === "set") {
      if (!["retry_count", "timeout_ms"].includes(a[2]))
        throw new Error("配置键支持 retry_count/timeout_ms");
      const value = Number(a[3]);
      if (
        !Number.isSafeInteger(value) ||
        value < (a[2] === "retry_count" ? 0 : 1000) ||
        value > (a[2] === "retry_count" ? 10 : 600000)
      )
        throw new Error("配置值不在允许范围");
      config[a[2]] = value;
      await saveJson(p.config, config);
      result = config;
    } else throw new Error("config 支持 list/get/set");
  } else if (a[0] === "jobs" && a[1] === "list")
    result = await readJson(p.jobs, { jobs: {} });
  else if (a[0] === "publish") {
    const item = {
      file: "audio." + (v["file-ext"] || "mp3"),
      albumId: integer(v["album-id"], "album-id"),
      ...(await settings(v)),
    };
    if (!item.title) throw new Error("发布已上传文件需要 --title");
    const uploaded = {
      uploadId: integer(v["upload-id"], "upload-id"),
      fileExtName: v["file-ext"] || "mp3",
    };
    const body = works.publishBody(item, uploaded);
    if (v["dry-run"]) result = { ok: true, dryRun: true, body };
    else {
      const client = await Client.from(p.auth);
      const perm = await works.permission(client);
      const session = await createSession({
        client,
        transport: v.transport || "native",
        publish: a[0] === "publish" || !!v.publish,
        profile,
        uid: perm.data.currentUid,
        ...(v["space-id"]
          ? { spaceId: integer(v["space-id"], "space-id") }
          : {}),
      });
      try {
        const id = createHash("sha256")
          .update(JSON.stringify({ operation: "publish", body }))
          .digest("hex");
        result = await runBatch([{ id, body }], {
          journal: p.jobs,
          retryFailed: !!v["retry-failed"],
          execute: () => session.publish(body),
        });
      } finally {
        await session.close();
      }
    }
  } else if (a[0] === "batch" || a[0] === "upload") {
    let items;
    if (a[0] === "batch") {
      if (!v.manifest) throw new Error("需要 --manifest");
      items = await loadManifest(resolve(v.manifest));
    } else {
      if (!v.file) throw new Error("需要 --file");
      const file = resolve(v.file);
      const { stat } = await import("node:fs/promises");
      const info = await stat(file);
      if (!info.isFile() || !info.size) throw new Error("无效音频文件");
      items = [
        {
          file,
          ...(v["album-id"]
            ? { albumId: integer(v["album-id"], "album-id") }
            : {}),
          ...(await settings(v)),
        },
      ];
    }
    for (const item of items) {
      if (
        !/\.(aiff|aif|mp3|wma|wav|flac|ogg|mp2|aac|amr|m4a)$/i.test(item.file)
      )
        throw new Error("不支持的音频格式：" + item.file);
      const { stat } = await import("node:fs/promises");
      if ((await stat(item.file)).size > 1073741824)
        throw new Error("音频不能超过 1 GiB");
      if (v.publish) works.publishBody(item);
      // 发布和仅上传是不同任务；避免一次仅上传记录误跳过之后的发布。
      const { createReadStream } = await import("node:fs");
      const hash = createHash("sha256").update(
        JSON.stringify({ item, mode: v.publish ? "publish" : "upload" }),
      );
      for await (const chunk of createReadStream(item.file)) hash.update(chunk);
      item.id = hash.digest("hex");
    }
    if (v["dry-run"]) {
      result = {
        ok: true,
        dryRun: true,
        mode: v.publish ? "publish" : "upload",
        items: items.map((item) => ({
          ...item,
          ...(v.publish ? { body: works.publishBody(item) } : {}),
        })),
      };
    } else {
      const client = await Client.from(p.auth);
      const perm = await works.permission(client);
      if (!perm.data?.uploadSoundPermission)
        throw new Error("当前账号没有音频上传权限");
      const session = await createSession({
        client,
        transport: v.transport || "native",
        publish: a[0] === "publish" || !!v.publish,
        profile,
        uid: perm.data.currentUid,
        ...(v["space-id"]
          ? { spaceId: integer(v["space-id"], "space-id") }
          : {}),
      });
      try {
        result = await runBatch(items, {
          journal: p.jobs,
          retryFailed: !!v["retry-failed"],
          execute: async (item) => {
            const uploaded = await session.upload(item.file, {
              timeout: v["timeout-ms"]
                ? integer(v["timeout-ms"], "timeout-ms")
                : 600000,
            });
            if (!v.publish) return uploaded;
            const body = works.publishBody(item, uploaded);
            return { ...(await session.publish(body)), uploaded };
          },
        });
      } finally {
        await session.close();
      }
    }
  } else {
    const client = await Client.from(p.auth, {
      retries: config.retry_count,
      timeout: config.timeout_ms,
    });
    const id = () => integer(v.id, "--id");
    if (a[0] === "doctor") {
      const status = await auth.status(profile),
        perm = await works.permission(client);
      result = {
        ok: true,
        auth: status,
        account: { uid: perm.data.currentUid, nickname: perm.data.nickName },
        nativeSigning: status.signerReady
          ? (
              await NativeSigner.fromProfile(profile, {
                uid: perm.data.currentUid,
              })
            ).status()
          : { ok: false, reason: "需要初始化设备登记" },
        permissions: {
          audio: perm.data.uploadSoundPermission,
          video: perm.data.uploadVideoPermission,
          scheduled: perm.data.allowDelayPublish,
          needUploadCaptcha: perm.data.needUploadCaptcha,
        },
      };
    } else if (a[0] === "albums" && a[1] === "list")
      result = await works.albums(client, query(v));
    else if (a[0] === "albums" && a[1] === "create")
      result = await works.createAlbum(
        client,
        {
          title: v.title,
          subtitle: v.subtitle,
          categoryId: integer(v["category-id"], "category-id"),
          coverPath: v["cover-path"],
          isAiCover: boolean(v["cover-ai"]),
          ...(v.visibility ? { visibility: v.visibility } : {}),
          ...(await settings(v)),
        },
        { dryRun: !!v["dry-run"] },
      );
    else if (a[0] === "albums" && a[1] === "info")
      result = await works.albumInfo(client, id());
    else if (a[0] === "albums" && a[1] === "tracks")
      result = await works.albumTracks(client, id(), query(v));
    else if (a[0] === "works" && a[1] === "list")
      result = await works.tracks(client, query(v));
    else if (a[0] === "works" && a[1] === "info")
      result = await works.trackInfo(client, id());
    else if (a[0] === "scheduled" && a[1] === "list")
      result = await works.scheduled(client, query(v));
    else if (a[0] === "works" && a[1] === "update") {
      const changes = await settings(v);
      if (changes.publishAt) throw new Error("--publish-at 仅用于新作品发布");
      if (!Object.keys(changes).length) throw new Error("请提供至少一个设置项");
      result = await works.updateTrack(client, id(), changes, {
        dryRun: !!v["dry-run"],
      });
    } else if (a[0] === "works" && a[1] === "batch-update") {
      const manifest = await readJson(resolve(v.manifest || ""));
      if (!Array.isArray(manifest.items) || !manifest.items.length)
        throw new Error("需要非空 items 数组");
      const items = manifest.items.map((x) => {
        const item = { ...manifest.defaults, ...x };
        integer(item.trackId, "trackId");
        item.id = createHash("sha256")
          .update(JSON.stringify(item))
          .digest("hex");
        return item;
      });
      // 在任何写入之前读取并组装全部编辑请求。
      const prepared = await Promise.all(
        items.map(async (item) => ({
          ...item,
          body: await works.prepareUpdate(client, item.trackId, item),
        })),
      );
      if (v["dry-run"]) result = { ok: true, dryRun: true, items: prepared };
      else
        result = await runBatch(prepared, {
          journal: p.jobs,
          retryFailed: !!v["retry-failed"],
          execute: (item) =>
            client.request(works.API + "/reform-upload/anchorTrack/update", {
              method: "POST",
              body: item.body,
            }),
        });
    } else throw new Error("未知命令，使用 xmly --help 查看");
  }
  print(result);
  if (result?.ok === false) process.exitCode = 1;
}
main().catch((e) => {
  console.error(
    JSON.stringify({
      ok: false,
      error:
        e.code === "ENOENT"
          ? `文件不存在：${e.path || "指定路径"}${e.path?.endsWith("auth.json") ? "；请运行 xmly auth login 后捕获凭据" : e.path?.endsWith("signer.json") ? "；请运行 xmly auth capture 初始化设备登记" : ""}`
          : e.message,
    }),
  );
  process.exitCode = 1;
});
