import { createHash } from 'node:crypto';
import { open, unlink, stat, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { readJson, saveJson } from './config.mjs';
export async function loadManifest(path) {
  const manifest = await readJson(path);
  if (!Array.isArray(manifest.items) || !manifest.items.length) throw new Error('清单需要非空 items 数组');
  const items = await Promise.all(manifest.items.map(async (item, index) => {
    if (!item.file || typeof item.file !== 'string') throw new Error(`第 ${index+1} 项缺少 file`);
    const file = resolve(dirname(resolve(path)), item.file);
    const info = await stat(file); if (!info.isFile() || !info.size) throw new Error(`无效文件：${file}`);
    const merged = { ...manifest.defaults, ...item, file };
    const hash = createHash('sha256');
    const { createReadStream } = await import('node:fs');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    merged.id = createHash('sha256').update(JSON.stringify(merged)).update(hash.digest('hex')).digest('hex');
    return merged;
  }));
  return items;
}
export async function runBatch(items, { journal, execute, dryRun = false, retryFailed = false }) {
  if (dryRun) return { dryRun: true, items };
  await saveJson(journal + '.init', {}); await unlink(journal + '.init');
  let lock; try { lock = await open(journal + '.lock', 'wx', 0o600); } catch(e) { if(e.code==='EEXIST') throw new Error('另一批量任务正在运行，或存在未清理的 .lock 文件'); throw e; }
  try {
    const state = await readJson(journal, { jobs: {} });
    const results = [];
    for (const item of items) {
      const previous = state.jobs[item.id];
      if (previous?.status === 'done') { results.push({ id:item.id, status:'skipped', result:previous.result }); continue; }
      if (previous && !(previous.status === 'failed' && retryFailed)) { results.push({ id:item.id, status:'needs-review', reason:'上次结果未确认；请核对远端，避免重复提交' }); continue; }
      state.jobs[item.id] = { status:'running', file:item.file, startedAt:new Date().toISOString() }; await saveJson(journal,state);
      try { const result=await execute(item); state.jobs[item.id]={ ...state.jobs[item.id], status:'done', result }; }
      catch(e) { state.jobs[item.id]={ ...state.jobs[item.id], status: e.safeToRetry ? 'failed' : 'uncertain', error:e.message }; }
      await saveJson(journal,state); results.push({ id:item.id,...state.jobs[item.id] });
    }
    return { items:results, ok:results.every(r=>['done','skipped'].includes(r.status)) };
  } finally { await lock.close(); await unlink(journal + '.lock'); }
}
