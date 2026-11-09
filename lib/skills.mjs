import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve, dirname } from "node:path";
import { mkdir, readdir, readFile, lstat, cp, rename, rm, mkdtemp, open } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";

const bundled = fileURLToPath(new URL("../skills/", import.meta.url));
const names = ["xmly-music", "xmly-cv", "xmly-studio"];
export async function listSkills({ sourceDir = bundled } = {}) {
  const items = [];
  for (const name of names) {
    const source = join(sourceDir, name);
    const content = await readFile(join(source, "SKILL.md"), "utf8");
    items.push({ name, description: content.match(/^description: (.+)$/m)?.[1] || name, source });
  }
  return { ok: true, items };
}
async function exists(path) {
  try { return await lstat(path); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
}
async function inventory(path) {
  const files = [];
  const walk = async (dir, prefix = "") => {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix + entry.name, file = join(dir, entry.name);
      if (entry.isDirectory()) { files.push([relative + "/", "directory"]); await walk(file, relative + "/"); }
      else if (entry.isFile()) files.push([relative, createHash("sha256").update(await readFile(file)).digest("hex")]);
      else throw new Error(`技能目录含符号链接或特殊文件，请人工处理：${file}`);
    }
  };
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`技能目标不是普通目录，请人工处理：${path}`);
  await walk(path);
  return JSON.stringify(files);
}

export async function installSkills({ agent = "codex", skill, targetDir, force = false, dryRun = false } = {},
  { home = homedir(), env = process.env, sourceDir = bundled } = {}) {
  if (!["codex", "claude", "all"].includes(agent)) throw new Error("agent 支持 codex/claude/all");
  if (targetDir !== undefined && (typeof targetDir !== "string" || !targetDir.trim())) throw new Error("target-dir 不能为空");
  if (targetDir !== undefined && agent === "all") throw new Error("--target-dir 不能与 --agent all 同用");
  const selected = skill === undefined ? names : [...new Set(skill.split(",").map((x) => x.trim()))];
  if (!selected.length || selected.some((x) => !names.includes(x))) throw new Error("skill 支持 xmly-music,xmly-cv,xmly-studio（逗号分隔）");
  const catalog = (await listSkills({ sourceDir })).items.filter((x) => selected.includes(x.name));
  const agents = agent === "all" ? ["codex", "claude"] : [agent];
  const targets = agents.map((name) => ({ agent: name, dir: targetDir !== undefined ? resolve(targetDir) :
    name === "codex" ? resolve(env.CODEX_HOME || join(home, ".codex"), "skills") : join(home, ".claude", "skills") }));
  const items = [];
  // 先检查所有源目录和目标，冲突时不开始复制其他技能。
  for (const target of targets) for (const entry of catalog) {
    const sourceHash = await inventory(entry.source), destination = join(target.dir, entry.name);
    const old = await exists(destination);
    let status = "install", error;
    if (old) {
      try { status = await inventory(destination) === sourceHash ? "unchanged" : force ? "update" : "conflict"; }
      catch (e) { status = "conflict"; error = e.message; }
    }
    items.push({ name: entry.name, agent: target.agent, source: entry.source, target: destination, status,
      ...(error ? { error } : {}) });
  }
  const conflicts = items.some((x) => x.status === "conflict");
  if (dryRun || conflicts) return { ok: !conflicts, dryRun, items,
    ...(conflicts ? { message: "目标技能与内置版本不同；请先比较，或用 --force 备份后更新。符号链接或特殊文件需人工处理。" } : {}) };

  const locks = [];
  try {
    for (const dir of [...new Set(items.filter((x) => ["install", "update"].includes(x.status)).map((x) => dirname(x.target)))].sort()) {
      await mkdir(dir, { recursive: true });
      const path = join(dir, ".xmly-skills.lock");
      let handle;
      try { handle = await open(path, "wx", 0o600); }
      catch (e) {
        if (e.code === "EEXIST") throw new Error(`另一技能安装任务正在运行，或存在未清理的锁：${path}`);
        throw e;
      }
      locks.push({ handle, path });
    }
    for (const item of items) {
      if (item.status === "unchanged") continue;
      // 加锁后再检查，避免预览检查与实际写入之间覆盖了新文件。
      const old = await exists(item.target);
      if (old) {
        const same = await inventory(item.target) === await inventory(item.source);
        if (same) { item.status = "unchanged"; continue; }
        if (!force) throw new Error(`安装期间目标发生变化，未覆盖：${item.target}`);
      }
      const stage = await mkdtemp(join(dirname(item.target), ".xmly-skills-install-"));
      const stagedSkill = join(stage, item.name);
      let backup;
      try {
        await cp(item.source, stagedSkill, { recursive: true, force: false, errorOnExist: true });
        if (old) {
          const backupDir = join(dirname(dirname(item.target)), ".xmly-skill-backups", randomUUID());
          await mkdir(backupDir, { recursive: true });
          backup = join(backupDir, item.name);
          await rename(item.target, backup);
        }
        try { await rename(stagedSkill, item.target); }
        catch (e) { if (backup) await rename(backup, item.target); throw e; }
        item.status = backup ? "updated" : "installed";
        if (backup) item.backup = backup;
      } finally { await rm(stage, { recursive: true, force: true }); }
    }
    return { ok: true, dryRun: false, items };
  } finally {
    for (const lock of locks.reverse()) {
      await lock.handle.close();
      await rm(lock.path, { force: true });
    }
  }
}

export async function runSkillsCommand(a, v) {
  if (a[1] === "list") return listSkills();
  if (a[1] !== "install") throw new Error("skills 支持 list/install");
  return installSkills({ agent: v.agent, skill: v.skill, targetDir: v["target-dir"], force: !!v.force, dryRun: !!v["dry-run"] });
}
