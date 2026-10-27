import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export function stableToken(value) {
  const chars=createHash("sha256").update(value).digest("hex").slice(0,32).split("");chars[12]="5";chars[16]=((parseInt(chars[16],16)&3)|8).toString(16);const t=chars.join("");return `${t.slice(0,8)}-${t.slice(8,12)}-${t.slice(12,16)}-${t.slice(16,20)}-${t.slice(20)}`;
}
export function parseFeishu(value) {
  const url=new URL(value);
  if(url.protocol!=="https:"||!/(^|\.)(feishu\.cn|larksuite\.com)$/.test(url.hostname))throw new Error("需要 HTTPS 飞书文档链接");
  const match=/\/(wiki|docx)\/([A-Za-z0-9_-]+)/.exec(url.pathname);
  if(!match)throw new Error("需要知识库或新版文档链接");
  return {origin:url.origin,type:match[1],token:match[2],url:url.href};
}
function elements(text) {
  const output=[];let offset=0;
  for(const match of text.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g)) {
    if(match.index>offset)output.push({text_run:{content:text.slice(offset,match.index)}});
    if(match[1])output.push({text_run:{content:match[1],text_element_style:{link:{url:match[2]}}}});
    else output.push({text_run:{content:match[3]||match[4],text_element_style:match[3]?{bold:true}:{inline_code:true}}});
    offset=match.index+match[0].length;
  }
  if(offset<text.length)output.push({text_run:{content:text.slice(offset)}});
  return output;
}
export function markdownBlocks(markdown) {
  return markdown.split(/\r?\n/).filter(line=>line.trim()).flatMap(line=>{
    const heading=/^(#{1,6})\s+(.+)$/.exec(line);const bullet=/^-\s+/.test(line);const ordered=/^\d+\.\s+/.test(line);
    const key=heading?`heading${heading[1].length}`:bullet?"bullet":ordered?"ordered":"text";
    const blockType=heading?heading[1].length+2:bullet?12:ordered?13:2;
    const text=heading?heading[2]:line.replace(/^(-|\d+\.)\s+/,"");
    const result=[];
    // Split oversized plain spans while retaining complete Markdown links/emphasis.
    const rich=elements(text);let group=[];let size=0;
    const flush=()=>{if(group.length)result.push({block_type:blockType,[key]:{elements:group,...(heading&&/^(更多线索索引|来源与核实范围|采集覆盖)/.test(text)?{style:{folded:true}}:{})}});group=[];size=0;};
    for(const element of rich){const value=element.text_run.content;for(let i=0;i<value.length;i+=1200){const piece={text_run:{...element.text_run,content:value.slice(i,i+1200)}};if(size+piece.text_run.content.length>1800)flush();group.push(piece);size+=piece.text_run.content.length;}}flush();return result;
  });
}
export function blockText(block) {
  return Object.values(block).flatMap(value=>value&&Array.isArray(value.elements)?value.elements.map(e=>e.text_run?.content||""):[]).join("");
}

export class Feishu {
  constructor({config,fetchImpl=fetch}){this.config=config;this.fetch=fetchImpl;this.accessToken="";this.expiresAt=0;this.lastWrite=0;}
  get configured(){return Boolean(this.config.appId&&this.config.appSecret);}
  async token(){
    if(!this.configured)throw new Error("请先在 InfoLark/.env 填写独立 InfoLark 应用的 App ID / App Secret");
    if(this.accessToken&&this.expiresAt>Date.now())return this.accessToken;
    const response=await this.fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",{method:"POST",headers:{"Content-Type":"application/json"},signal:AbortSignal.timeout(20000),body:JSON.stringify({app_id:this.config.appId,app_secret:this.config.appSecret})});
    const data=await response.json();if(!response.ok||data.code!==0)throw new Error(`InfoLark 鉴权失败（${data.code||response.status}）`);
    this.accessToken=data.tenant_access_token;this.expiresAt=Date.now()+Math.max(60,(data.expire||7200)-60)*1000;return this.accessToken;
  }
  async request(path,{method="GET",body}={},attempt=0){
    const token=await this.token();
    if(method!=="GET"){await delay(Math.max(0,400-(Date.now()-this.lastWrite)));this.lastWrite=Date.now();}
    let response,payload;
    try{response=await this.fetch(`https://open.feishu.cn${path}`,{method,redirect:"error",signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});payload=await response.json();}
    catch{throw Object.assign(new Error("飞书请求未取得确定结果，请检查网络与任务状态"),{ambiguous:method!=="GET"});}
    if(attempt<2&&(response.status===429||[99991400,1061045].includes(payload.code))){await delay(1000*(attempt+1));return this.request(path,{method,body},attempt+1);}
    if(!response.ok||payload.code!==0)throw Object.assign(new Error(`飞书接口失败（${payload.code||response.status}）：${String(payload.msg||"请求失败").slice(0,180)}`),{code:payload.code,ambiguous:false});
    return payload.data||payload;
  }
  async resolve(url){const file=parseFeishu(url);if(file.type==="docx")return{...file,documentId:file.token};const data=await this.request(`/open-apis/wiki/v2/spaces/get_node?token=${file.token}`);if(data.node?.obj_type!=="docx")throw new Error("InfoLark 父页面必须是新版 Docx 文档");return{...file,documentId:data.node.obj_token,node:data.node,title:data.node.title};}
  async blocks(documentId){const output=[];let token="";do{const p=new URLSearchParams({document_revision_id:"-1",page_size:"200",...(token?{page_token:token}:{})});const data=await this.request(`/open-apis/docx/v1/documents/${documentId}/blocks?${p}`);output.push(...(data.items||[]));token=data.has_more?data.page_token:"";}while(token);return output;}
  async append(documentId,children,{token=randomUUID(),index=-1}={}){const data=await this.request(`/open-apis/docx/v1/documents/${documentId}/blocks/${documentId}/children?${new URLSearchParams({document_revision_id:"-1",client_token:token})}`,{method:"POST",body:{index,children}});return data.children||[];}
  async create(parent,title){if(!parent.node)throw new Error("日报需要放在知识库父页面下，请提供 wiki 链接");const data=await this.request(`/open-apis/wiki/v2/spaces/${parent.node.space_id}/nodes`,{method:"POST",body:{obj_type:"docx",node_type:"origin",parent_node_token:parent.node.node_token,title}});if(!data.node?.obj_token)throw Object.assign(new Error("创建接口未返回文档信息，结果待核对"),{ambiguous:true});return{documentId:data.node.obj_token,nodeToken:data.node.node_token,url:`${parent.origin}/wiki/${data.node.node_token}`,title};}
  async sendText(userId,text,uuid){const data=await this.request("/open-apis/im/v1/messages?receive_id_type=open_id",{method:"POST",body:{receive_id:userId,msg_type:"text",content:JSON.stringify({text}),uuid}});return data.message_id;}
  async grantReader(documentId,botOpenId){return this.request(`/open-apis/drive/v1/permissions/${documentId}/members?type=docx&need_notification=false`,{method:"POST",body:{member_type:"openid",member_id:botOpenId,perm:"edit",type:"user"}});}
}
