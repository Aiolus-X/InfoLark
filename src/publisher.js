import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { blockText, markdownBlocks, stableToken } from "./feishu.js";
import { recipientFor } from "./subscription.js";

export class Publisher {
  constructor({config,store,client,bridge,logger=console}){this.config=config;this.store=store;this.client=client;this.bridge=bridge;this.logger=logger;}
  async parent(){
    const parent=await this.client.resolve(this.config.parentUrl);
    if(!this.store.state.parent||this.store.state.parent.url!==this.config.parentUrl)this.store.state.parent={url:this.config.parentUrl,headerTokens:{}};
    const saved=this.store.state.parent;
    for(const heading of ["日报索引","精选沉淀","Idea List"]){
      const existing=await this.client.blocks(parent.documentId);
      if(existing.some(b=>b.heading2&&blockText(b)===heading))continue;
      saved.headerTokens[heading] ||= randomUUID();this.store.save();
      await this.client.append(parent.documentId,markdownBlocks(`## ${heading}`),{token:saved.headerTokens[heading]});
      delete saved.headerTokens[heading];this.store.save();
    }
    const blocks=await this.client.blocks(parent.documentId);
    return{...parent,selectionBlockId:blocks.find(b=>b.heading2&&blockText(b)==="精选沉淀")?.block_id,ideaListBlockId:blocks.find(b=>b.heading2&&blockText(b)==="Idea List")?.block_id};
  }
  async publish(day){
    const run=this.store.run(day);
    if(!run.report||!run.markdownPath)throw new Error("请先生成并校验本地日报草稿");
    if(run.createUncertain)throw new Error("上次创建日报的结果不确定；请先核对父目录，不能自动重复创建");
    const parent=await this.parent();
    if(!run.document){
      if(run.status==="doc_creating"){run.createUncertain=true;this.store.save();throw new Error("服务曾在创建日报时中断，请先核对是否已创建");}
      run.status="doc_creating";this.store.save();
      try{run.document=await this.client.create(parent,`${day} AI 创业融资日报`);run.writtenBlocks=0;run.status="doc_writing";this.store.save();}
      catch(error){run.createUncertain=Boolean(error.ambiguous);run.status=error.ambiguous?"create_uncertain":"draft_ready";run.error=error.message;this.store.save();throw error;}
    }
    const markdown=readFileSync(run.markdownPath,"utf8").replace(/^# [^\n]+\n/,"");
    const blocks=markdownBlocks(markdown);
    while((run.writtenBlocks||0)<blocks.length){
      const offset=run.writtenBlocks||0;const batch=blocks.slice(offset,offset+30);
      run.status="doc_writing";run.pendingBatch={offset,count:batch.length,token:stableToken(`${this.config.appId}:${day}:${run.reportKey}:body:${offset}`)};this.store.save();
      await this.client.append(run.document.documentId,batch,{token:run.pendingBatch.token});
      run.writtenBlocks=offset+batch.length;delete run.pendingBatch;this.store.save();
    }
    if(!run.indexed){
      const parentBlocks=await this.client.blocks(parent.documentId);
      const already=parentBlocks.some(b=>Object.values(b).some(v=>v?.elements?.some(e=>e.text_run?.text_element_style?.link?.url===run.document.url)));
      if(!already){const root=parentBlocks.find(b=>b.block_id===parent.documentId);const index=root?.children?.indexOf(parent.selectionBlockId);if(index==null||index<0)throw new Error("父文档精选沉淀章节位置不可用");await this.client.append(parent.documentId,markdownBlocks(`- [${day} 日报](${run.document.url}) · 重点 ${run.report.items.length} 条`),{index,token:stableToken(`${day}:${run.document.url}:index`)});}
      run.indexed=true;this.store.save();
    }
    if(this.config.bridgeEnabled&&!run.paperlarkConnected){
      try{await this.bridge.register(run.document.url,this.config.parentUrl);run.paperlarkConnected=true;delete run.paperlarkError;}
      catch(error){
        try{const reader=await this.bridge.reader();await this.client.grantReader(run.document.documentId,reader.botOpenId);await this.bridge.register(run.document.url,this.config.parentUrl);run.paperlarkConnected=true;delete run.paperlarkError;}
        catch(second){run.paperlarkError=`PaperLark 尚未接入：${second.message}`;this.logger.log(run.paperlarkError);}
      }
    }
    run.status=run.deliveredAt?"delivered":"doc_ready";delete run.error;this.store.save();return run.document;
  }
  async notify(day,{late=false}={}){
    const run=this.store.run(day);if(run.deliveredAt)return run.document;
    const userId=recipientFor(this.config,this.store.state);
    if(!userId)throw new Error("请先在 InfoLark 机器人私聊发送 /start 订阅");
    if(run.notificationStartedAt&&!run.messageId&&Date.now()-Date.parse(run.notificationStartedAt)>=55*60000)throw new Error("上次提醒的发送结果待核对，已超过去重重试窗口；不会再次自动发送");
    if(!run.document||!run.indexed)throw new Error("日报尚未完整发布");
    const count=tier=>run.report.items.filter(i=>i.tier===tier).length;
    const text=`InfoLark｜${day} 创业融资日报${late?"（补发）":""}\n个人/小团队 ${count("individual")} 条 · 初创 ${count("startup")} 条 · 大厂/企业 ${count("enterprise")} 条\n${run.document.url}\n阅读时可用 /ask、/think；/add 将重要讨论整理进汇总文档。${run.paperlarkError?"\nPaperLark 接入待修复，请检查父页面授权。":""}`;
    run.notificationUuid ||= stableToken(`${this.config.appId}:${userId}:${day}:notice`);run.notificationStartedAt ||= new Date().toISOString();run.status="notifying";this.store.save();
    try{run.messageId=await this.client.sendText(userId,text,run.notificationUuid);run.deliveredAt=new Date().toISOString();run.status="delivered";delete run.error;this.store.save();}
    catch(error){if(!error.ambiguous)delete run.notificationStartedAt;run.status=error.ambiguous?"notify_uncertain":"doc_ready";run.error=error.message;this.store.save();throw error;}
    return run.document;
  }
}
