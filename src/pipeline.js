import { readFileSync } from "node:fs";
import { Collector } from "./collector.js";
import { Reporter } from "./report.js";
import { Llm, modelSettings } from "./llm.js";
import { Feishu } from "./feishu.js";
import { Publisher } from "./publisher.js";
import { PaperLarkBridge } from "./paperlark.js";
import { assertTime, clockTime, yesterday } from "./time.js";
import { recipientFor } from "./subscription.js";

export class Pipeline {
  constructor({config,store,collector,reporter,publisher,logger=console}) {
    this.config=config;this.store=store;this.logger=logger;this.busy=null;
    this.collector=collector||new Collector({config,store,logger});
    this.reporter=reporter||new Reporter({config,store,llm:new Llm({config}),logger});
    this.publisher=publisher||new Publisher({config,store,client:new Feishu({config}),bridge:new PaperLarkBridge({config}),logger});
  }
  async exclusive(operation){if(this.busy)throw new Error("InfoLark 正在处理任务，请稍后重试");const work=Promise.resolve().then(operation);this.busy=work;try{return await work;}finally{this.busy=null;}}
  async preview(day,{collect=true,refresh=false}={}) {
    const run=this.store.run(day);
    if(run.document||run.createUncertain){if(refresh)throw new Error("日报已开始远程发布，不能覆盖其草稿；请先完成或核对现有任务");return{report:run.report,markdown:readFileSync(run.markdownPath,"utf8"),cached:true};}
    if(collect){run.phase="采集与核实";this.store.save();await this.collector.collect(day);await this.collector.enrich(day);}
    run.phase="生成日报";run.status="generating";this.store.save();
    try{const result=await this.reporter.generate(day,{refresh});run.status="draft_ready";run.phase="本地草稿已就绪";delete run.error;this.store.save();return result;}
    catch(error){run.status=run.report?"draft_ready":"generation_failed";run.error=error.message;this.store.save();throw error;}
  }
  async publish(day,{send=false,late=false,collect=true}={}){
    const run=this.store.run(day);
    if(run.deliveredAt&&send)return run.document;
    if(!run.report)await this.preview(day,{collect});
    run.phase="写入飞书";this.store.save();
    try{const document=await this.publisher.publish(day);if(send){run.phase="发送提醒";this.store.save();await this.publisher.notify(day,{late});}return document;}
    catch(error){run.error=error.message;this.store.save();throw error;}
  }
  async doctor(){
    const result={appConfigured:this.publisher.client.configured,parentConfigured:Boolean(this.config.parentUrl),recipientBound:Boolean(this.store.state.recipient?.appId===this.config.appId&&this.store.state.recipient.enabled),timezone:this.config.timezone,prepareTime:this.config.prepareTime,deliveryTime:this.config.deliveryTime};
    try{const model=modelSettings(this.config);result.model={name:model.llmModel,api:model.llmApi,configured:Boolean(model.llmApiKey&&model.llmModel)};}catch(error){result.modelError=error.message;}
    if(result.appConfigured){
      try{await this.publisher.client.token();result.authentication="ok";const parent=await this.publisher.client.resolve(this.config.parentUrl);await this.publisher.client.blocks(parent.documentId);result.parentReadable=true;}catch(error){result.feishuError=error.message;}
      try{const bot=await this.publisher.client.request("/open-apis/bot/v3/info");result.botReady=Boolean(bot.bot?.open_id||bot.open_id);}catch(error){result.botReady=false;result.botError=error.message;}
      try{const data=await this.publisher.client.request("/open-apis/application/v6/scopes");const granted=new Set((data.scopes||[]).filter(s=>s.scope_type==="tenant"&&s.grant_status===1).map(s=>s.scope_name));result.privateMessagePermission=granted.has("im:message.p2p_msg:readonly")||granted.has("im:message.p2p_msg");result.sendMessagePermission=granted.has("im:message:send_as_bot")||granted.has("im:message");if(!result.privateMessagePermission)result.messageHint="请开通应用身份 im:message.p2p_msg:readonly 并发布；群聊 @ 权限不会接收私聊指令";}catch(error){result.scopeCheckError=error.message;}
    }
    return result;
  }
}

export class Scheduler {
  constructor({config,store,pipeline,now=()=>new Date(),logger=console}){this.config=config;this.store=store;this.pipeline=pipeline;this.now=now;this.logger=logger;this.ticking=false;assertTime(config.prepareTime);assertTime(config.deliveryTime);if(config.prepareTime>=config.deliveryTime)throw new Error("准备时间必须早于通知时间");}
  async tick(){
    if(this.ticking||this.pipeline.busy)return;this.ticking=true;
    try{await this.pipeline.exclusive(async()=>{
      const now=this.now();const day=yesterday(now,this.config.timezone);const run=this.store.run(day);const time=clockTime(now,this.config.timezone);
      const active=Boolean(this.config.appId&&this.config.appSecret&&recipientFor(this.config,this.store.state));
      if(active&&time>=this.config.prepareTime&&!run.deliveredAt&&(!run.retryAt||Date.parse(run.retryAt)<=now.getTime())){
        try{
          if(!run.document||!run.indexed||run.pendingBatch)await this.pipeline.publish(day,{collect:true,send:false});
          if(clockTime(this.now(),this.config.timezone)>=this.config.deliveryTime)await this.pipeline.publisher.notify(day,{late:clockTime(this.now(),this.config.timezone)>this.config.deliveryTime});
          delete run.retryAt;delete run.error;
        }catch(error){run.error=error.message;run.retryAt=new Date(now.getTime()+10*60000).toISOString();this.logger.error(`日报任务：${error.message}`);}
        this.store.save();return;
      }
      const last=Date.parse(this.store.state.lastCollectedAt||0)||0;
      if(now.getTime()-last>=this.config.pollMinutes*60000){
        const lastDiscovery=Date.parse(this.store.state.lastDiscoveryAt||0)||0;
        const discovery=now.getTime()-lastDiscovery>=this.config.discoveryMinutes*60000;
        await this.pipeline.collector.collect(day,{discovery});
        if(discovery)this.store.state.lastDiscoveryAt=now.toISOString();this.store.save();
      }
    });}finally{this.ticking=false;}
  }
}
