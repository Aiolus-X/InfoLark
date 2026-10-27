import { readFileSync } from "node:fs";
import { join } from "node:path";

export class PaperLarkBridge {
  constructor({config,fetchImpl=fetch}){this.config=config;this.fetch=fetchImpl;}
  connection(){
    const saved=JSON.parse(readFileSync(join(this.config.paperlarkDir,"extension/connection.local.json"),"utf8"));
    const url=new URL(saved.baseUrl);
    if(url.protocol!=="http:"||!["127.0.0.1","localhost"].includes(url.hostname)||!/^[a-f0-9]{64}$/.test(saved.token))throw new Error("PaperLark 本机配对配置无效");
    return{baseUrl:url.origin,token:saved.token};
  }
  async request(path,body){const c=this.connection();const response=await this.fetch(`${c.baseUrl}${path}`,{method:body?"POST":"GET",headers:{Authorization:`Bearer ${c.token}`,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});const data=await response.json();if(!response.ok)throw Object.assign(new Error(data.error||"PaperLark 接入失败"),{status:response.status});return data;}
  async register(url,parentUrl){return this.request("/bridge/v1/infolark/documents",{url,parentUrl});}
  async reader(){return this.request("/bridge/v1/infolark/reader");}
}
