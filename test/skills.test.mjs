import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { installSkills, listSkills } from "../lib/skills.mjs";

async function workspace(action) {
  const dir = await mkdtemp(join(tmpdir(), "xmly-skills-test-"));
  try { await action(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test("内置技能列表独立于当前目录，完整复制引用与UI信息，重复安装不重写", async () => workspace(async (dir) => {
  assert.deepEqual((await listSkills()).items.map(x => x.name), ['xmly-music', 'xmly-cv', 'xmly-studio']);
  const options = { home: dir, env: {} };
  const first = await installSkills({}, options);
  assert.equal(first.items.length, 3); assert.ok(first.items.every(x => x.status === 'installed'));
  const root = join(dir, '.codex', 'skills');
  assert.match(await readFile(join(root, 'xmly-music', 'references', 'materials.md'), 'utf8'), /素材包/);
  assert.match(await readFile(join(root, 'xmly-cv', 'agents', 'openai.yaml'), 'utf8'), /display_name/);
  const before = (await lstat(join(root, 'xmly-cv', 'SKILL.md'))).mtimeMs;
  const again = await installSkills({}, options);
  assert.ok(again.items.every(x => x.status === 'unchanged'));
  assert.equal((await lstat(join(root, 'xmly-cv', 'SKILL.md'))).mtimeMs, before);
}));

test("Codex自定义目录、Claude目录与选择技能有效；dry-run不创建目录", async () => workspace(async (dir) => {
  const options = { home: dir, env: { CODEX_HOME: join(dir, 'codex-data') } };
  const preview = await installSkills({ agent: 'all', skill: 'xmly-cv', dryRun: true }, options);
  assert.equal(preview.items.length, 2); assert.equal(preview.items[0].target, join(dir, 'codex-data', 'skills', 'xmly-cv'));
  await assert.rejects(lstat(join(dir, 'codex-data')), { code: 'ENOENT' });
  const actual = await installSkills({ agent: 'all', skill: 'xmly-cv' }, options);
  assert.equal(actual.items[1].target, join(dir, '.claude', 'skills', 'xmly-cv'));
  await assert.rejects(lstat(join(dir, '.claude', 'skills', 'xmly-music')), { code: 'ENOENT' });
  const custom = await installSkills({ targetDir: join(dir, 'custom'), skill: 'xmly-music' }, options);
  assert.equal(custom.items[0].target, join(dir, 'custom', 'xmly-music'));
}));

test("自定义技能冲突先检查全部目标；force备份完整目录后更新", async () => workspace(async (dir) => {
  const options = { home: dir, env: {} }, root = join(dir, '.codex', 'skills');
  await installSkills({ skill: 'xmly-cv' }, options);
  const target = join(root, 'xmly-cv', 'SKILL.md');
  await writeFile(target, '用户定制内容');
  await writeFile(join(root, 'xmly-cv', 'custom.txt'), '额外用户文件');
  const conflict = await installSkills({}, options);
  assert.equal(conflict.ok, false); assert.equal(conflict.items.find(x => x.name === 'xmly-cv').status, 'conflict');
  await assert.rejects(lstat(join(root, 'xmly-music')), { code: 'ENOENT' });
  assert.equal(await readFile(target, 'utf8'), '用户定制内容');
  const updated = await installSkills({ skill: 'xmly-cv', force: true }, options);
  assert.equal(updated.items[0].status, 'updated');
  const backup = updated.items[0].backup;
  assert.ok(!backup.startsWith(root));
  assert.equal(await readFile(join(backup, 'SKILL.md'), 'utf8'), '用户定制内容');
  assert.equal(await readFile(join(backup, 'custom.txt'), 'utf8'), '额外用户文件');
  assert.match(await readFile(target, 'utf8'), /name: xmly-cv/);
  await assert.rejects(lstat(join(root, 'xmly-cv', 'custom.txt')), { code: 'ENOENT' });
}));

test("目标符号链接或技能内符号链接即使force也不覆盖", async () => workspace(async (dir) => {
  const options = { home: dir, env: {} }, root = join(dir, '.codex', 'skills'), external = join(dir, 'external');
  await mkdir(root, { recursive: true }); await mkdir(external);
  await writeFile(join(external, 'SKILL.md'), '不能修改');
  await symlink(external, join(root, 'xmly-cv'), 'dir');
  assert.equal((await installSkills({ skill: 'xmly-cv', force: true }, options)).ok, false);
  assert.equal(await readFile(join(external, 'SKILL.md'), 'utf8'), '不能修改');
  await rm(join(root, 'xmly-cv'));
  await installSkills({ skill: 'xmly-cv' }, options);
  await symlink(join(external, 'SKILL.md'), join(root, 'xmly-cv', 'extra-link'));
  assert.equal((await installSkills({ skill: 'xmly-cv', force: true }, options)).ok, false);
}));

test("安装锁不会被抢占，锁持有者之外的任务不改写目标", async () => workspace(async (dir) => {
  const targetDir = join(dir, 'skills'); await mkdir(targetDir);
  const lock = join(targetDir, '.xmly-skills.lock'); await writeFile(lock, 'existing-owner');
  await assert.rejects(installSkills({ targetDir, skill: 'xmly-cv' }), /锁/);
  assert.equal(await readFile(lock, 'utf8'), 'existing-owner');
  await assert.rejects(lstat(join(targetDir, 'xmly-cv')), { code: 'ENOENT' });
}));

test("非法Agent、技能及混用目标参数拒绝写入；CLI在无凭据且不同cwd中可安装", async () => workspace(async (dir) => {
  await assert.rejects(installSkills({ agent: 'other' }), /agent/);
  await assert.rejects(installSkills({ skill: '../secret' }), /skill/);
  await assert.rejects(installSkills({ targetDir: dir, agent: 'all' }), /不能/);
  const cli = resolve('bin/xmly.mjs');
  const result = JSON.parse(execFileSync(process.execPath, [cli, 'skills', 'install', '--agent', 'claude', '--skill', 'xmly-music', '--target-dir', join(dir, 'installed'), '--compact'],
    { cwd: dir, env: { ...process.env, XMLY_HOME: join(dir, 'no-auth') }, encoding: 'utf8' }));
  assert.equal(result.ok, true); assert.equal(result.items[0].status, 'installed');
  assert.match(await readFile(join(dir, 'installed', 'xmly-music', 'SKILL.md'), 'utf8'), /name: xmly-music/);
  await assert.rejects(lstat(join(dir, 'no-auth')), { code: 'ENOENT' });
}));
