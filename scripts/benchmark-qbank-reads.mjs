import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { unstable_splitSqlQuery } from 'wrangler';
const measureImport = process.argv.includes('--import');

const measurementModule = `import {env as bindings} from 'cloudflare:workers';
export * from 'cloudflare:workers';
let queries=[];
const originals=new WeakMap();
function note(sql,result){queries.push({sql,rowsRead:result.meta?.rows_read??0,rowsWritten:result.meta?.rows_written??0});return result;}
function wrap(statement,sql){
 const measured={
  bind(...values){return wrap(statement.bind(...values),sql);},
  async all(){return note(sql,await statement.all());},
  async run(){return note(sql,await statement.run());},
  async first(column){const result=note(sql,await statement.all()); const row=result.results[0]??null;return column&&row?row[column]:row;},
  async raw(options){const result=note(sql,await statement.all());const rows=result.results.map(row=>Object.values(row));return options?.columnNames?[Object.keys(result.results[0]??{}),...rows]:rows;}
 };
 originals.set(measured,{statement,sql});return measured;
}
const database={
 prepare(sql){return wrap(bindings.DB.prepare(sql),sql);},
 async batch(statements){const raw=statements.map(statement=>originals.get(statement)); const results=await bindings.DB.batch(raw.map(item=>item.statement));return results.map((result,index)=>note(raw[index].sql,result));}
};
export const env=new Proxy(bindings,{get(target,key){return key==='DB'?database:target[key];}});
export function resetMeasurement(){queries=[];}
export function measurement(){return {queries,rowsRead:queries.reduce((sum,item)=>sum+item.rowsRead,0),rowsWritten:queries.reduce((sum,item)=>sum+item.rowsWritten,0)};}`;

await mkdir('.ui-review', {recursive:true});
await build({
 stdin:{contents:`export {RealtimeChannel} from './workers/realtime.ts';
 import {GET,POST,PUT,DELETE} from './app/api/cloudflare/[...path]/route.ts';
 import {resetMeasurement,measurement} from 'probe:measurement';
 import {connectRealtime} from './lib/realtime-server.ts';
 export default {async fetch(request){if(new URL(request.url).pathname.endsWith('/realtime'))return connectRealtime(request);resetMeasurement();const response=await ({GET,POST,PUT,DELETE})[request.method](request);return Response.json({status:response.status,data:await response.json(),cost:measurement()});}};`,resolveDir:process.cwd(),sourcefile:'creation-cost-probe.ts'},
 bundle:true,format:'esm',platform:'neutral',outfile:'.ui-review/qbank-creation-cost-probe.mjs',
 plugins:[{name:'measured-d1',setup(build){
  build.onResolve({filter:/^(cloudflare:workers|probe:measurement)$/},args=>args.namespace==='measurement'?{path:'cloudflare:workers',external:true}:{path:'measured-workers',namespace:'measurement'});
  build.onLoad({filter:/.*/,namespace:'measurement'},()=>({contents:measurementModule,loader:'js'}));
 }}],
});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,scriptPath:'.ui-review/qbank-creation-cost-probe.mjs',compatibilityDate:'2026-09-07',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'creation-probe'},durableObjects:{REALTIME:{className:'RealtimeChannel',useSQLite:true}},bindings:{ROOT_ADMIN_EMAIL:'admin@example.test'}}));
try {
 const db=await mf.getD1Database('DB');
 for(const name of readdirSync('drizzle').filter(name=>name.endsWith('.sql')).sort())
  for(const sql of unstable_splitSqlQuery(readFileSync('drizzle/'+name,'utf8'))) await db.prepare(sql).run();
 const now=new Date().toISOString();
 const profiles=Array.from({length:500},(_,i)=>({uid:i===0?'admin':`fixture-${i}`,email:i===0?'admin@example.test':`fixture-${i}@example.test`,displayName:'Fixture',role:i===0?'super_admin':'student',tier:'free',status:'approved',platformRoles:i>0&&i<=25?['reviewer']:[],createdAt:now}));
 await db.prepare(`INSERT INTO profiles(uid,email,password_hash,password_salt,profile_json,totp_secret,created_at,updated_at) SELECT json_extract(value,'$.uid'),json_extract(value,'$.email'),'unused','unused',value,CASE WHEN json_extract(value,'$.uid')='admin' THEN 'fixture-mfa' ELSE NULL END,?,? FROM json_each(?)`).bind(now,now,JSON.stringify(profiles)).run();
 await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,1,?)').bind(createHash('sha256').update('fixture-admin').digest('hex'),'admin',Math.floor(Date.now()/1000)+3600,now).run();
 for(let i=1;i<=25;i++)await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,verified,created_at) VALUES(?,?,?,1,?)').bind(createHash('sha256').update(`session-fixture-${i}`).digest('hex'),`fixture-${i}`,Math.floor(Date.now()/1000)+3600,now).run();
 const bank={id:'fixture-existing-bank',name:'Existing bank',shortName:'EXIST',description:'',ownerId:'admin',ownerName:'Fixture',createdById:'admin',createdByName:'Fixture',createdAt:now,visibility:'public',essential:false,shareEnabled:false,reviewerIds:[],viewerIds:[],archived:false};
 const records=Array.from({length:6000},(_,i)=>({type:i%2?'answerStats':'auditLog',id:`history-${i}`,qbankId:bank.id,questionId:`history-question-${i}`,entityId:`history-question-${i}`}));
 records.push({...bank,type:'qbanks'});
 for(let i=0;i<2000;i++) records.push({type:'sharedQuestions',id:`fixture-question-${i}`,qbankId:bank.id,questionId:String(50000+i),stem:measureImport?`An adult patient presents with clinical symptoms existing case ${i}. What is the most appropriate next step?`:'Synthetic fixture question',options:['One','Two'],answer:0,revision:1,images:[]});
 await db.prepare(`INSERT INTO records(type,id,qbank_id,payload,updated_at) SELECT json_extract(value,'$.type'),json_extract(value,'$.id'),CASE WHEN json_extract(value,'$.type')='qbanks' THEN NULL ELSE json_extract(value,'$.qbankId') END,value,? FROM json_each(?)`).bind(now,JSON.stringify(records)).run();
 async function call(path,body,uid='admin'){const started=performance.now();const response=await mf.dispatchFetch('https://fixture.test/api/cloudflare'+path,{method:body?'POST':'GET',headers:{origin:'https://fixture.test',cookie:`__Host-qraft_session=${uid==='admin'?'fixture-admin':'session-'+uid}`,'content-type':'application/json','x-qraft-account':uid},...(body?{body:JSON.stringify(body)}:{})});const result=await response.json();if(result.status!==200)throw new Error(JSON.stringify(result));result.elapsedMs=performance.now()-started;return result;}
 const created={...bank,id:'fixture-created-bank',name:'Created bank'};
 if (measureImport) {
  await call('/qbanks',{bank:created});
  const results=[];
  for (const [scenario,targetBank] of [['empty-bank',created.id],['dense-similar-bank',bank.id]]) {
   const questions=Array.from({length:500},(_,i)=>({stem:`An adult patient presents with clinical symptoms imported case ${i}. What is the most appropriate next step?`,options:['First medication','Second medication'],answer:1,specialty:'Medicine',topic:'Treatment',explanation:'Synthetic explanation.',sourceFile:'Fixture.pdf',sourcePage:i+1,images:[]}));
   const phases=[];
   const sessions=[];
   for(let i=1;i<=25;i++){
    const uid=`fixture-${i}`,snapshot=await call('/collaboration',undefined,uid);
    const response=await mf.dispatchFetch(`https://fixture.test/api/cloudflare/realtime?channel=review:bank:${targetBank}&v=2`,{headers:{Upgrade:'websocket',origin:'https://fixture.test',cookie:`__Host-qraft_session=session-${uid}`}});
    if(response.status!==101)throw new Error('Reviewer socket failed '+response.status);
    const socket=response.webSocket;socket.accept();
    const session={uid,cursor:snapshot.data.cursor,reads:0,writes:0,events:0,latencies:[],socket};
    socket.addEventListener('message',event=>{const packet=JSON.parse(event.data);if(packet.resources?.includes('review-queue'))session.events++;});
    sessions.push(session);
   }
   for(let offset=0;offset<500;offset+=50) {
    const result=await call('/platform/import-preview',{qbankId:targetBank,sourceFile:'Fixture.pdf',questions:questions.slice(offset,offset+50)});
    phases.push({phase:'preview',offset,cost:result.cost});
   }
   const uploadSessionId=randomUUID(),originalFileHash=createHash('sha256').update(uploadSessionId).digest('hex');
   for(let offset=0;offset<500;offset+=25) {
    const requestId=randomUUID(),chunkIndex=offset/25;
    const body={qbankId:targetBank,requestId,fileName:`fixture-${uploadSessionId}-part-${chunkIndex}.json`,fileHash:createHash('sha256').update(requestId).digest('hex'),originalFileName:`fixture-${uploadSessionId}.json`,originalFileHash,uploadSessionId,chunkIndex,chunkCount:20,sourceFile:'Fixture.pdf',questions:questions.slice(offset,offset+25),rightsConfirmed:true};
    const result=await call('/platform/import',body);
    phases.push({phase:'save',offset,successful:result.data.successful,flagged:result.data.flaggedDuplicates,cost:result.cost});
    const retry=await call('/platform/import',body);
    phases.push({phase:'retry',offset,cost:retry.cost});
    for(const session of sessions){
     const cursor=session.cursor;
     const delta=await call(`/collaboration?since=${cursor.sequence}&syncUid=${session.uid}&syncScope=${cursor.scope}`,undefined,session.uid);
     if(!delta.data.delta)throw new Error('Expected incremental update');
     if(delta.data.delta.changes.proposals.length!==25)throw new Error('Lost imported proposals');
     session.cursor=delta.data.delta.cursor;session.reads+=delta.cost.rowsRead;session.writes+=delta.cost.rowsWritten;session.latencies.push(delta.elapsedMs);
    }
   }
   const summary={scenario,questions:500,phases,previewReads:phases.filter(p=>p.phase==='preview').reduce((sum,p)=>sum+p.cost.rowsRead,0),saveReads:phases.filter(p=>p.phase==='save').reduce((sum,p)=>sum+p.cost.rowsRead,0),saveWrites:phases.filter(p=>p.phase==='save').reduce((sum,p)=>sum+p.cost.rowsWritten,0),retryReads:phases.filter(p=>p.phase==='retry').reduce((sum,p)=>sum+p.cost.rowsRead,0)};
   summary.sessions=sessions.map(({socket:_socket,...session})=>session);
   if(sessions.some(session=>session.events!==20))throw new Error('Missing or replayed realtime events '+JSON.stringify(sessions.map(s=>s.events)));
   for(const session of sessions)session.socket.close();
   results.push(summary);
   console.log(JSON.stringify({...summary,phases:undefined,sessions:undefined,successful:phases.filter(p=>p.phase==='save').reduce((sum,p)=>sum+p.successful,0),flagged:phases.filter(p=>p.phase==='save').reduce((sum,p)=>sum+p.flagged,0),maxBatchReads:Math.max(...phases.filter(p=>p.phase==='save').map(p=>p.cost.rowsRead)),sessionReads:[Math.min(...sessions.map(s=>s.reads)),Math.max(...sessions.map(s=>s.reads))],realtimeEvents:sessions.map(s=>s.events)}));
  }
  await writeFile('outputs/qbank-performance-after.json',JSON.stringify({fixture:{profiles:500,targetExistingQuestions:2000,historyRecords:6000,reviewerSessions:25},results},null,2));
  process.exitCode=0;
 } else {
 const before=await call('/collaboration');
 const create=await call('/qbanks',{bank:created});
 const cursor=before.data.cursor;
 const delta=await call(`/collaboration?since=${cursor.sequence}&syncUid=admin&syncScope=${cursor.scope}`);
 if(!delta.data.delta || delta.data.delta.changes.approvedQuestions.length || !delta.data.delta.catalog.qbanks.some(item=>item.id===created.id))throw new Error('Catalog delta did not isolate the new empty bank');
 const result={fixture:{profiles:500,existingQuestions:2217,historyRecords:6000},create,retry:await call('/qbanks',{bank:created}),delta,refresh:await call('/collaboration')};
 await writeFile('outputs/qbank-creation-after.json',JSON.stringify(result,null,2));
 for(const phase of ['create','retry','delta','refresh'])console.log(JSON.stringify({phase,status:result[phase].status,queries:result[phase].cost.queries.length,rowsRead:result[phase].cost.rowsRead,rowsWritten:result[phase].cost.rowsWritten}));
 }
} finally {await mf.dispose();}
