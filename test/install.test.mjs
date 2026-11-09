import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const installer = resolve('install.sh');
const shellTest = (name, fn) => test(name, { skip: process.platform === 'win32' }, fn);
async function workspace(action) {
  const dir = await mkdtemp(join(tmpdir(), 'xmly-install-test-'));
  try {
    const bin = join(dir, 'bin'), log = join(dir, 'arguments'); await mkdir(bin);
    await writeFile(join(bin, 'npm'), `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2);
const value=(flag)=>args[args.indexOf(flag)+1];
const prefix=args.includes('--prefix')?value('--prefix'):process.env.XMLY_INSTALL_TEST_PREFIX;
if(args[0]==='pack') {const target=path.join(value('--pack-destination'),'fixture.tgz');fs.writeFileSync(target,'fixture');console.log(JSON.stringify([{filename:'fixture.tgz'}]));}
if(args[0]==='install') {fs.writeFileSync(process.env.XMLY_INSTALL_TEST_ARGS,JSON.stringify(args));fs.mkdirSync(path.join(prefix,'lib/node_modules/ximalaya-studio-cli/bin'),{recursive:true});fs.writeFileSync(path.join(prefix,'lib/node_modules/ximalaya-studio-cli/bin/xmly.mjs'),'fixture');fs.mkdirSync(path.join(prefix,'bin'),{recursive:true});fs.writeFileSync(path.join(prefix,'bin/xmly'),'#!/bin/sh\\nexit 0\\n',{mode:0o755});}
if(args[0]==='prefix')console.log(prefix);
`, { mode: 0o755 });
    await writeFile(join(bin, 'git'), `#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);fs.appendFileSync(process.env.XMLY_INSTALL_TEST_GIT,JSON.stringify(args)+'\\n');if(args[0]==='clone')fs.mkdirSync(args.at(-1),{recursive:true});
`, { mode: 0o755 });
    const env = { ...process.env, PATH: bin + ':' + dirname(process.execPath) + ':' + process.env.PATH,
      XMLY_INSTALL_TEST_ARGS: log, XMLY_INSTALL_TEST_PREFIX: join(dir, 'global'), XMLY_INSTALL_TEST_GIT: join(dir, 'git-args') };
    await action({ dir, bin, log, env, run: (args, overrides = {}) => spawnSync('/bin/sh', [installer, ...args], { encoding: 'utf8', cwd: dir, env: { ...env, ...overrides } }) });
  } finally { await rm(dir, { recursive: true, force: true }); }
}

shellTest('整体安装先克隆打包，包来源和前缀均作为独立参数', async () => workspace(async ({ dir, log, run }) => {
  assert.equal(run([]).status, 0);
  const defaults = JSON.parse(await readFile(log, 'utf8'));
  assert.deepEqual(defaults.slice(0,5), ['install', '--global', '--no-audit', '--no-fund', '--']);
  assert.match(defaults.at(-1), /fixture.tgz$/);
  assert.match(await readFile(join(dir,'git-args'),'utf8'), /https:\/\/github.com\/deluxebear\/ximalayacli.git/);
  const prefix = join(dir, 'custom prefix'), source = join(dir, 'package with spaces.tgz');
  await writeFile(source, 'package');
  assert.equal(run(['--prefix', prefix, '--source', source]).status, 0);
  assert.deepEqual(JSON.parse(await readFile(log, 'utf8')), ['install', '--global', '--no-audit', '--no-fund', '--prefix', prefix, '--', source]);
}));

shellTest('固定Git ref且拒绝冲突参数，不执行npm安装', async () => workspace(async ({ dir, log, run }) => {
  assert.equal(run(['--ref', 'feature/cli-tools']).status, 0);
  assert.match(await readFile(join(dir,'git-args'), 'utf8'), /checkout","--quiet","feature\/cli-tools/);
  await rm(log);
  for (const args of [['--ref', 'main', '--source', 'local.tgz'], ['--ref', 'bad ref'], ['--prefix'], ['--source', ''], ['--invalid']]) {
    assert.notEqual(run(args).status, 0);
    await assert.rejects(access(log), { code: 'ENOENT' });
  }
}));

shellTest('缺少Node或Node版本过低时停止，避免运行npm', async () => workspace(async ({ bin, log, run }) => {
  assert.match(run([], { PATH: bin }).stderr, /Node.js 22/);
  await writeFile(join(bin, 'node'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const old = run([], { PATH: bin });
  assert.notEqual(old.status, 0); assert.match(old.stderr, /升级/);
  await assert.rejects(access(log), { code: 'ENOENT' });
}));

shellTest('npm安装失败时保留失败状态，不报告成功', async () => workspace(async ({ bin, run }) => {
  await writeFile(join(bin, 'npm'), '#!/bin/sh\nexit 23\n', { mode: 0o755 });
  const result = run([]);
  assert.equal(result.status, 23); assert.doesNotMatch(result.stdout, /安装完成/);
}));
