import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseEnv } from "node:util";
import { createDecipheriv } from "node:crypto";

function keyFromFile(file) {
  if (!file) return "";
  const text = readFileSync(file, "utf8").trim();
  return text.startsWith("{") ? JSON.parse(text).OPENAI_API_KEY || "" : text;
}
export function modelSettings(config) {
  if (config.modelSource !== "paperlark") return { ...config.model };
  const envFile = join(config.paperlarkDir, ".env");
  if (!existsSync(envFile)) throw new Error("未找到 PaperLark 模型配置；可设置 INFOLARK_MODEL_SOURCE=own 并填写独立模型参数");
  const env = parseEnv(readFileSync(envFile, "utf8"));
  const settings = { ...config.model, llmBaseUrl: env.LLM_BASE_URL || "https://api.openai.com/v1", llmApiKey: env.LLM_API_KEY || keyFromFile(env.LLM_API_KEY_FILE ? resolve(config.paperlarkDir, env.LLM_API_KEY_FILE) : ""), llmModel: env.LLM_MODEL || "", llmApi: env.LLM_API || "responses", llmReasoningEffort: env.LLM_REASONING_EFFORT || "" };
  const personalPath = resolve(config.paperlarkDir, env.PAPERLARK_MODEL_SETTINGS || "data/model-settings.json");
  if (existsSync(personalPath)) {
    const payload = JSON.parse(readFileSync(personalPath, "utf8"));
    if (payload.encrypted) {
      const key = Buffer.from(env.PAPERLARK_ENCRYPTION_KEY || readFileSync(resolve(config.paperlarkDir, env.PAPERLARK_MODEL_KEY_FILE || "data/model-settings.key"), "utf8").trim(), "base64");
      const [iv, tag, body] = payload.encrypted.split(".").map(v=>Buffer.from(v,"base64"));
      const decipher = createDecipheriv("aes-256-gcm",key,iv); decipher.setAuthTag(tag);
      const profile = JSON.parse(Buffer.concat([decipher.update(body),decipher.final()]).toString("utf8"));
      if (profile.enabled) Object.assign(settings,{llmBaseUrl:profile.baseUrl,llmApiKey:profile.apiKey,llmModel:profile.model,llmApi:profile.api,llmReasoningEffort:profile.reasoningEffort});
    }
  }
  return settings;
}

export class Llm {
  constructor({ config, fetchImpl = fetch }) { this.config = config; this.fetch = fetchImpl; }
  async complete({ system, input, onProgress }) {
    const s = modelSettings(this.config);
    if (!s.llmApiKey || !s.llmModel || !s.llmBaseUrl) throw new Error("模型配置不完整");
    const base = s.llmBaseUrl.replace(/\/+$/, "");
    const endpoint = `${/\/v1$/.test(base) ? base : `${base}/v1`}/${s.llmApi === "responses" ? "responses" : "chat/completions"}`;
    const body = s.llmApi === "responses" ? { model:s.llmModel,instructions:system,input:[{role:"user",content:input}],store:false,stream:true,...(s.llmReasoningEffort?{reasoning:{effort:s.llmReasoningEffort}}:{}) } : {model:s.llmModel,messages:[{role:"system",content:system},{role:"user",content:input}],...(s.llmReasoningEffort?{reasoning_effort:s.llmReasoningEffort}:{})};
    const response = await this.fetch(endpoint,{method:"POST",redirect:"error",signal:AbortSignal.timeout(s.llmTimeoutMs||600000),headers:{Authorization:`Bearer ${s.llmApiKey}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
    if(!response.ok)throw new Error(`模型服务 HTTP ${response.status}，请检查 Key 与模型权限`);
    let result;
    if(response.headers.get("content-type")?.includes("text/event-stream")) {
      let buffer=""; const decoder=new TextDecoder(); let count=0;
      const frame=raw=>{const data=raw.split(/\r?\n/).filter(x=>x.startsWith("data:")).map(x=>x.slice(5).trimStart()).join("\n");if(!data||data==="[DONE]")return;const event=JSON.parse(data);if(["error","response.failed","response.incomplete"].includes(event.type))throw new Error("模型生成未完成");if(event.type==="response.output_text.delta"){count+=event.delta?.length||0;onProgress?.(count);}if(event.type==="response.completed")result=event.response;};
      for await(const chunk of response.body){buffer+=decoder.decode(chunk,{stream:true});if(buffer.length>8*1024*1024)throw new Error("模型响应过大");let separator;while((separator=/\r?\n\r?\n/.exec(buffer))){frame(buffer.slice(0,separator.index));buffer=buffer.slice(separator.index+separator[0].length);}}
      buffer+=decoder.decode();if(buffer.trim())frame(buffer);if(!result)throw new Error("模型连接中断，没有完整日报");
    } else result=await response.json();
    if(result.error||["failed","incomplete"].includes(result.status)||result.choices?.[0]?.finish_reason==="length")throw new Error("模型生成未完成");
    const text=s.llmApi==="responses"?(result.output||[]).filter(x=>x.type==="message").flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text).join("\n"):result.choices?.[0]?.message?.content;
    if(!text)throw new Error("模型没有返回正文");return text;
  }
}
