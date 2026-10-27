import { fetchPublic, safeUrl } from "./http.js";

// Google News' public article redirect uses a browser RPC, not a publisher API.
// Do not retry through a proxy or use login cookies when it is unavailable.
export async function resolveNewsLink(url, { read = fetchPublic, post = fetch } = {}) {
  const parsed = safeUrl(url);
  if (parsed.hostname !== "news.google.com") return url;
  const id = /\/(?:articles|read)\/([A-Za-z0-9_-]+)/.exec(parsed.pathname)?.[1];
  if (!id || id.length > 1500) throw new Error("聚合链接标识无效");
  const page = await read(url);
  if (new URL(page.url).hostname !== "news.google.com") return safeUrl(page.url).href;
  const signature = /data-n-a-sg="([^"]+)"/.exec(page.text)?.[1];
  const timestamp = /data-n-a-ts="(\d+)"/.exec(page.text)?.[1];
  if (!signature || !timestamp) throw new Error("聚合页面未提供公开原文跳转信息");
  const context = [["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0];
  const payload = [["Fbv4je",JSON.stringify(["garturlreq",context,id,Number(timestamp),signature]),null,"0"]];
  const response = await post("https://news.google.com/_/DotsSplashUi/data/batchexecute", { method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:new URLSearchParams({"f.req":JSON.stringify([payload])}).toString() });
  if(!response.ok)throw new Error(`聚合原文定位 HTTP ${response.status}`);
  const text=await response.text();
  if(text.length>1024*1024)throw new Error("聚合原文定位响应异常");
  for(const line of text.split("\n")) {
    if(!line.trim().startsWith("[["))continue;
    let rows;try{rows=JSON.parse(line);}catch{continue;}
    for(const row of rows){if(row?.[0]!=="wrb.fr"||row[1]!=="Fbv4je")continue;let value;try{value=typeof row[2]==="string"?JSON.parse(row[2]):row[2];}catch{continue;}if(value?.[0]==="garturlres"&&typeof value[1]==="string"){const target=safeUrl(value[1]);if(target.hostname!=="news.google.com")return target.href;}}
  }
  throw new Error("未取得可核对的发布者原文链接");
}
