import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.js";
import { Publisher } from "../src/publisher.js";
import { Scheduler } from "../src/pipeline.js";

function fixture(t){
  const directory=mkdtempSync(join(tmpdir(),"infolark-test-"));t.after(()=>rmSync(directory,{recursive:true,force:true}));const store=new Store(directory);
  const config={appId:"new-info-app",appSecret:"test",parentUrl:"https://example.feishu.cn/wiki/parent",bridgeEnabled:true,timezone:"Asia/Shanghai",prepareTime:"10:30",deliveryTime:"11:00",pollMinutes:30,discoveryMinutes:180};
  const docs=new Map([["parent",[{block_id:"parent",children:[]}]]]);const seenTokens=new Map();const messages=[];let creates=0;
  const client={configured:true,async resolve(){return{documentId:"parent",node:{node_token:"parent"},url:config.parentUrl};},async blocks(id){return docs.get(id);},async append(id,children,{token,index=-1}){if(seenTokens.has(token))return seenTokens.get(token);const rows=docs.get(id);const blocks=children.map((b,i)=>({...b,block_id:`${id}-${rows.length+i}`}));rows.push(...blocks);const ids=blocks.map(b=>b.block_id);rows[0].children.splice(index<0?rows[0].children.length:index,0,...ids);seenTokens.set(token,blocks);return blocks;},async create(parent,title){creates++;docs.set("daily",[{block_id:"daily",children:[]}]);return{documentId:"daily",url:"https://example.feishu.cn/wiki/daily",title};},async sendText(user,text,uuid){messages.push({user,text,uuid});return"message-id";}};
  const bridge={async register(){return{ok:true};}};
  const run=store.run("2026-10-26");run.report={items:[{tier:"individual"}]};run.reportKey="digest-key";run.status="draft_ready";run.markdownPath=store.writeArtifact("2026-10-26.md","# Daily\n## One\n- Evidence [link](https://example.com/source)");
  store.state.recipient={appId:config.appId,openId:"ou_info_reader",enabled:true};store.save();
  return{store,config,client,bridge,docs,messages,getCreates:()=>creates,publisher:new Publisher({config,store,client,bridge,logger:{log(){}}})};
}
test("publish and notify resume without duplicate documents, indexes or messages",async t=>{
  const f=fixture(t);await f.publisher.publish("2026-10-26");await f.publisher.publish("2026-10-26");await f.publisher.notify("2026-10-26");await f.publisher.notify("2026-10-26");
  assert.equal(f.getCreates(),1);assert.equal(f.messages.length,1);assert.equal(f.messages[0].user,"ou_info_reader");assert.equal(f.store.run("2026-10-26").status,"delivered");
  assert.equal(f.docs.get("parent").filter(b=>b.bullet).length,1);
  const restored=new Store(f.store.directory);assert.equal(restored.run("2026-10-26").document.documentId,"daily");
});
test("a timed-out create is never blindly repeated",async t=>{
  const f=fixture(t);let calls=0;f.client.create=async()=>{calls++;throw Object.assign(new Error("response lost"),{ambiguous:true});};
  await assert.rejects(f.publisher.publish("2026-10-26"),/response lost/);await assert.rejects(f.publisher.publish("2026-10-26"),/不能自动重复创建/);assert.equal(calls,1);
});
test("partial body writes reuse the same client token on resume",async t=>{
  const f=fixture(t);const original=f.client.append;let dropped=false;
  f.client.append=async(id,blocks,options)=>{const result=await original(id,blocks,options);if(id==="daily"&&!dropped){dropped=true;throw Object.assign(new Error("reply lost after write"),{ambiguous:true});}return result;};
  await assert.rejects(f.publisher.publish("2026-10-26"));await f.publisher.publish("2026-10-26");assert.equal(f.docs.get("daily").length,3);assert.equal(f.getCreates(),1);
});
test("recipient IDs are scoped to the new app and expired ambiguous notifications need review",async t=>{
  const f=fixture(t);await f.publisher.publish("2026-10-26");f.store.state.recipient.appId="different-app";await assert.rejects(f.publisher.notify("2026-10-26"),/start/);assert.equal(f.messages.length,0);
  f.store.state.recipient.appId=f.config.appId;f.store.run("2026-10-26").notificationStartedAt=new Date(Date.now()-3600000).toISOString();await assert.rejects(f.publisher.notify("2026-10-26"),/去重重试窗口/);assert.equal(f.messages.length,0);
});
test("scheduler prepares before 11 and only notifies once the Beijing deadline arrives",async t=>{
  const f=fixture(t);f.store.state.lastCollectedAt="2026-10-27T02:29:00Z";let now=new Date("2026-10-27T02:30:00Z");const calls=[];
  const pipeline={busy:null,async exclusive(task){return task();},async publish(day){calls.push(["prepare",day]);const run=f.store.run(day);run.document={url:"daily"};run.indexed=true;},publisher:{async notify(day){calls.push(["notify",day]);f.store.run(day).deliveredAt=now.toISOString();}},collector:{async collect(){calls.push(["collect"]);f.store.state.lastCollectedAt=now.toISOString();}}};
  const s=new Scheduler({config:f.config,store:f.store,pipeline,now:()=>now});await s.tick();assert.deepEqual(calls,[["prepare","2026-10-26"]]);
  now=new Date("2026-10-27T03:00:00Z");await s.tick();assert.equal(calls.filter(x=>x[0]==="notify").length,1);await s.tick();assert.equal(calls.filter(x=>x[0]==="notify").length,1);
});
test("single instance lock prevents two writers",t=>{const f=fixture(t);const release=f.store.lock();assert.throws(()=>new Store(f.store.directory).lock(),/已在运行/);release();const next=f.store.lock();next();});

test("a stopped subscription cannot fall back to a configured recipient",async t=>{const f=fixture(t);f.config.recipient="ou_info_reader";await f.publisher.publish("2026-10-26");f.store.state.recipient.enabled=false;await assert.rejects(f.publisher.notify("2026-10-26"),/start/);assert.equal(f.messages.length,0);});
