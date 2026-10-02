import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('.ui-review', { recursive: true });
await build({ stdin: { contents: `import {env} from 'cloudflare:workers'; import {bankDeletionStatements} from './features/qbanks/server/bank-deletion.ts'; export default {async fetch(){const results=await env.DB.batch(bankDeletionStatements({uid:'probe-owner',role:'super_admin',displayName:'Probe'},{id:'probe-bank',ownerId:'probe-owner'},'2026-10-02T00:00:00Z'));return Response.json(results.map(r=>r.meta));}}`, resolveDir: process.cwd(), sourcefile: 'probe.ts' }, bundle:true, format:'esm', platform:'neutral', external:['cloudflare:workers'], outfile:'.ui-review/qbank-cost-worker.mjs' });
const statements=JSON.parse(execFileSync('python',['-c',`import sqlite3,json,pathlib
out=[]
for f in sorted(pathlib.Path('drizzle').glob('*.sql')):
 s=''
 for ch in f.read_text(encoding='utf-8'):
  s+=ch
  if ch==';' and sqlite3.complete_statement(s):
   out.append(s);s=''
print(json.dumps(out))`],{encoding:'utf8'}));
const results=[];
for (const count of [1, 100, 600]) {
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.ui-review/qbank-cost-worker.mjs',compatibilityDate:'2026-09-07',d1Databases:{DB:'cost-probe'}}));
 try {
  const db=await mf.getD1Database('DB');
  for(const sql of statements) await db.prepare(sql).run();
  const records=Array.from({length:6000},(_,i)=>({id:`unrelated-${i}`,type:i%2?'answerStats':'auditLog',qbankId:'unrelated-bank',questionId:`unrelated-question-${i}`,entityId:`unrelated-question-${i}`}));
  records.push({id:'probe-bank',type:'qbanks',ownerId:'probe-owner'});
  for(let i=0;i<count;i++) records.push({id:`probe-question-${i}`,type:'sharedQuestions',qbankId:'probe-bank',questionId:String(50000+i)});
  await db.prepare(`INSERT INTO records(type,id,qbank_id,owner_id,payload,updated_at) SELECT json_extract(value,'$.type'),json_extract(value,'$.id'),json_extract(value,'$.qbankId'),json_extract(value,'$.ownerId'),value,'2026-10-02T00:00:00Z' FROM json_each(?)`).bind(JSON.stringify(records)).run();
  const response=await mf.dispatchFetch('http://probe/delete');
  const metadata=await response.json();
  const result={questions:count,otherRecords:6000,status:response.status,metadata,rowsRead:metadata.reduce((sum,m)=>sum+(m.rows_read??0),0),rowsWritten:metadata.reduce((sum,m)=>sum+(m.rows_written??0),0)};
  results.push(result); console.log(JSON.stringify({...result,metadata:undefined}));
 } finally {await mf.dispose();}
}
await writeFile('outputs/qbank-deletion-after.json',JSON.stringify(results,null,2));
