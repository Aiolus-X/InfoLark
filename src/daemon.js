import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as lark from "@larksuiteoapi/node-sdk";
import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { Pipeline, Scheduler } from "./pipeline.js";
import { stableToken } from "./feishu.js";
import { yesterday, assertDay } from "./time.js";
import { parseBotCommand } from "./bot-commands.js";

export function createService({config,store,pipeline=new Pipeline({config,store}),logger=console}) {
  const scheduler=new Scheduler({config,store,pipeline,logger});const control=randomBytes(24).toString("hex");let ws;let connection="not_configured";let timer;
  const status=()=>({ok:true,service:"InfoLark",connection:ws?.getConnectionStatus().state||connection,busy:Boolean(pipeline.busy),targetDay:yesterday(new Date(),config.timezone),schedule:{timezone:config.timezone,prepare:config.prepareTime,delivery:config.deliveryTime},appConfigured:Boolean(config.appId&&config.appSecret),subscribed:Boolean(store.state.recipient?.enabled&&store.state.recipient.appId===config.appId),messageEvents:store.state.messageEvents||0,lastMessageEvent:store.state.lastMessageEvent||null,articles:Object.keys(store.state.articles).length,lastCollectedAt:store.state.lastCollectedAt||null,sources:Object.values(store.state.sources),runs:Object.values(store.state.runs).slice(-7).map(({day,status,phase,error,markdownPath,document,deliveredAt,paperlarkError,outputCharacters})=>({day,status,phase,error,markdownPath,document,deliveredAt,paperlarkError,outputCharacters}))});
  async function onMessage(event){
    event=event.event||event;
    const message=event.message;const user=event.sender?.sender_id?.open_id;
    store.state.messageEvents=(store.state.messageEvents||0)+1;
    const diagnostic={at:new Date().toISOString(),messageType:message?.message_type,chatType:message?.chat_type,senderType:event.sender?.sender_type,result:"received"};
    store.state.lastMessageEvent=diagnostic;store.save();
    const ignore=reason=>{diagnostic.result=reason;store.save();};
    if(!message?.message_id||message.chat_type!=="p2p"||event.sender?.sender_type!=="user"||!user){ignore("not-private-user-message");return;}
    if(store.state.messages[message.message_id])return;
    const command=parseBotCommand(message);if(!command){ignore("not-a-supported-command");return;}
    diagnostic.command=command;
    const bound=store.state.recipient;
    if(bound?.appId===config.appId&&bound.openId!==user){ignore("different-subscriber");return;}
    if((!bound||bound.appId!==config.appId)&&command!=="/start"){ignore("start-required");return;}
    diagnostic.result="accepted";
    store.state.messages[message.message_id]={at:new Date().toISOString(),command};store.save();
    let answer;
    if(command==="/start") {store.state.recipient={appId:config.appId,openId:user,enabled:true};store.save();answer=`已订阅 InfoLark：每天 ${config.deliveryTime}（${config.timezone}）发送前一天的创业融资日报。三层各不超过 5 条；/stop 暂停，/status 查看状态，/now 立即生成并发送昨日一期。`;}
    else if(command==="/stop"){store.state.recipient.enabled=false;store.save();answer="已暂停后续自动提醒。已有日报和阅读记录保留。";}
    else if(command==="/status"){const s=status();answer=`InfoLark：${s.subscribed?"已订阅":"未订阅"}\n准备 ${config.prepareTime}，提醒 ${config.deliveryTime}（${config.timezone}）\n候选库 ${s.articles} 条；${s.busy?"任务处理中":"空闲"}\n父文档：${config.parentUrl}`;}
    else {answer="开始生成昨日一期，完成后会发送日报链接。";setImmediate(()=>pipeline.exclusive(()=>pipeline.publish(yesterday(new Date(),config.timezone),{send:true,late:true})).catch(error=>logger.error(error.message)));}
    await pipeline.publisher.client.sendText(user,answer,stableToken(`${config.appId}:${message.message_id}:reply`));
  }
  const dispatcher=new lark.EventDispatcher({}).register({"im.message.receive_v1":event=>{setImmediate(()=>onMessage(event).catch(error=>logger.error(`机器人指令：${error.message}`)));return{};}});
  const server=createServer(async(request,response)=>{
    const json=(code,body)=>{response.writeHead(code,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});response.end(JSON.stringify(body));};
    try{
      const host=new URL(`http://${request.headers.host||"invalid"}`);
      if(!["127.0.0.1","localhost","[::1]"].includes(host.hostname)||!["127.0.0.1","::1","::ffff:127.0.0.1"].includes(request.socket.remoteAddress)){json(403,{error:"仅允许本机访问"});return;}
      const url=new URL(request.url,host.origin);
      if(request.headers.origin&&request.headers.origin!==host.origin){json(403,{error:"请求来源不允许"});return;}
      if(request.method==="GET"&&url.pathname==="/health"){json(200,status());return;}
      if(request.method==="GET"&&url.pathname==="/api/status"){json(200,{...status(),control});return;}
      if(request.method==="GET"&&/^\/reports\/\d{4}-\d{2}-\d{2}\.md$/.test(url.pathname)){const name=url.pathname.split("/").at(-1);const content=await readFile(join(config.dataDir,name),"utf8");response.writeHead(200,{"Content-Type":"text/plain; charset=utf-8","X-Content-Type-Options":"nosniff"});response.end(content);return;}
      if(request.method==="GET"&&url.pathname==="/"){response.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});response.end(await readFile(new URL("../public/index.html",import.meta.url)));return;}
      if(request.method==="POST"&&url.pathname==="/api/run"){
        if(request.headers["x-infolark-control"]!==control||!request.headers["content-type"]?.startsWith("application/json")){json(403,{error:"请刷新本机状态页后重试"});return;}
        let body="";for await(const chunk of request){body+=chunk;if(body.length>4000)throw new Error("请求过大");}
        const input=JSON.parse(body);const day=input.day||yesterday(new Date(),config.timezone);
        assertDay(day);if(!["collect","preview","publish","deliver"].includes(input.action))throw new Error("任务参数无效");
        if(pipeline.busy){json(409,{error:"已有任务处理中"});return;}
        pipeline.exclusive(async()=>{if(input.action==="collect")return pipeline.collector.collect(day);if(input.action==="preview")return pipeline.preview(day,{collect:input.collect!==false,refresh:Boolean(input.refresh)});return pipeline.publish(day,{send:input.action==="deliver",late:true});}).catch(error=>{store.run(day).error=error.message;store.save();logger.error(error.message);});
        json(202,{ok:true,day,message:"任务已开始，可在状态页查看结果"});return;
      }
      json(404,{error:"接口不存在"});
    }catch(error){json(400,{error:error.code==="ENOENT"?"日报尚未生成":error.message});}
  });
  return {server,status,pipeline,onMessage,async start(){
    timer=setInterval(()=>scheduler.tick().catch(error=>logger.error(error.message)),15000);timer.unref();setImmediate(()=>scheduler.tick().catch(error=>logger.error(error.message)));
    if(config.appId&&config.appSecret){ws=new lark.WSClient({appId:config.appId,appSecret:config.appSecret,loggerLevel:lark.LoggerLevel.warn});await ws.start({eventDispatcher:dispatcher});connection=ws.getConnectionStatus().state;}
  },close(){clearInterval(timer);ws?.close();server.close();}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const config=loadConfig();const store=new Store(config.dataDir);const release=store.lock();const app=createService({config,store});
  app.server.listen(config.port,"127.0.0.1",()=>{console.log(`InfoLark 状态页：http://127.0.0.1:${config.port}`);app.start().catch(error=>console.error(error.message));});
  let stopping=false;
  const stop=()=>{if(stopping)return;stopping=true;app.close();Promise.resolve(app.pipeline.busy).catch(()=>{}).finally(release);};process.on("SIGINT",stop);process.on("SIGTERM",stop);
}
