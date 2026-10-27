import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns";
import { isIP } from "node:net";
import { createGunzip, createBrotliDecompress, createInflate } from "node:zlib";

export function isPublicAddress(address) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && [18, 19].includes(b)));
  }
  return isIP(normalized) === 6 && normalized !== "::" && normalized !== "::1" && !/^(fc|fd|fe[89ab]|ff)/.test(normalized);
}
function publicLookup(hostname, options, callback) {
  lookup(hostname, { all: true }, (error, records) => {
    if (error) return callback(error);
    if (!records.length || records.some(record => !isPublicAddress(record.address))) return callback(new Error("拒绝访问非公开网络地址"));
    callback(null, options.all ? records : records[0].address, records[0].family);
  });
}
export function safeUrl(value) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || (url.port && !["80", "443"].includes(url.port))) throw new Error("资讯链接必须是公开 HTTP(S) 地址");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || (isIP(host) && !isPublicAddress(host))) throw new Error("拒绝访问非公开网络地址");
  return url;
}

export async function fetchPublic(value, { timeoutMs = 15000, maxBytes = 5 * 1024 * 1024, redirects = 4 } = {}) {
  const url = safeUrl(value);
  const result = await new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(url, {
      lookup: publicLookup, timeout: timeoutMs, signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "InfoLark/0.1 (personal news research; public pages only)", Accept: "application/rss+xml,application/atom+xml,application/json,text/html;q=0.9,*/*;q=0.5", "Accept-Encoding": "gzip, br" }
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume(); resolve({ redirect: new URL(response.headers.location, url).href }); return;
      }
      const encoding = response.headers["content-encoding"];
      const decompressor = encoding === "gzip" ? createGunzip() : encoding === "br" ? createBrotliDecompress() : encoding === "deflate" ? createInflate() : null;
      const stream = decompressor ? response.pipe(decompressor) : response;
      let length = 0; const chunks = [];
      stream.on("data", chunk => { length += chunk.length; if (length > maxBytes) { request.destroy(); stream.destroy(new Error("资讯响应超过大小限制")); } else chunks.push(chunk); });
      stream.on("error", reject); response.on("error", reject);
      stream.on("end", () => {
        const contentType = String(response.headers["content-type"] || "");
        const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] || "utf-8";
        let text; try { text = new TextDecoder(charset).decode(Buffer.concat(chunks)); } catch { text = Buffer.concat(chunks).toString("utf8"); }
        resolve({ url: url.href, status: response.statusCode, contentType, text });
      });
    });
    request.on("timeout", () => request.destroy(new Error("资讯源请求超时")));
    request.on("error", reject);
  });
  if (result.redirect) {
    if (!redirects) throw new Error("资讯链接重定向过多");
    return fetchPublic(result.redirect, { timeoutMs, maxBytes, redirects: redirects - 1 });
  }
  if (result.status < 200 || result.status >= 300) throw new Error(`资讯源 HTTP ${result.status}`);
  return result;
}

export async function mapLimit(values, limit, task) {
  const results = new Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) { const index = cursor++; try { results[index] = { status: "fulfilled", value: await task(values[index], index) }; } catch (reason) { results[index] = { status: "rejected", reason }; } }
  }));
  return results;
}
