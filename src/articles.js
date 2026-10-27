import { createHash } from "node:crypto";
import { DOMParser } from "linkedom";
import { Readability } from "@mozilla/readability";
import { XMLParser } from "fast-xml-parser";
import { safeUrl } from "./http.js";

export function plainText(html = "") {
  const document = new DOMParser().parseFromString(`<html><body>${String(html)}</body></html>`, "text/html");
  for (const element of document.querySelectorAll("script,style,noscript,nav,footer,header,iframe")) element.remove();
  return document.body.textContent.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
export function canonicalUrl(value) {
  const url = safeUrl(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
  url.hostname = url.hostname.replace(/^www\./, "");
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  url.searchParams.sort();
  return url.href;
}
export const articleId = url => createHash("sha256").update(canonicalUrl(url)).digest("hex").slice(0, 20);
const array = value => value == null ? [] : Array.isArray(value) ? value : [value];
const scalar = value => typeof value === "object" && value ? value["#text"] || "" : value || "";
export function parseDate(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? "" : new Date(timestamp).toISOString();
}

export function parseFeed(xml, source) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("不支持包含自定义实体的资讯源");
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", trimValues: true, parseTagValue: false }).parse(xml);
  const items = parsed.rss?.channel?.item || parsed.feed?.entry;
  if (!items && !parsed.rss && !parsed.feed) throw new Error("该地址未返回有效 RSS/Atom");
  return array(items).flatMap(item => {
    try {
      const link = array(item.link).find(link => typeof link === "string" || !link["@_rel"] || link["@_rel"] === "alternate");
      const url = typeof link === "string" ? link : link?.["@_href"] || scalar(item.guid);
      const title = plainText(scalar(item.title));
      if (!url || !title) return [];
      const summary = plainText(scalar(item.description || item.summary || item.content)).slice(0, 3000);
      const full = plainText(scalar(item["content:encoded"] || item.content));
      const publisher = scalar(item.source) || source.name;
      return [{ id: articleId(url), url, canonicalUrl: canonicalUrl(url), title, summary, text: full.length > 400 ? full.slice(0, 16000) : "", publishedAt: parseDate(scalar(item.pubDate || item.published || item["dc:date"] || item.updated)), publicationBasis: "feed", sourceId: source.id, sourceName: source.name, publisher, publisherUrl: item.source?.["@_url"] || "", kind: source.kind || "media", priority: source.priority || "discovery", region: source.region || "mixed", evidenceLevel: full.length > 400 ? "feed-content" : "headline", discoveredBy: [source.id] }];
    } catch { return []; }
  });
}

export function extractArticle(html, url) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const meta = name => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.getAttribute("content") || "";
  let publishedAt = parseDate(meta("article:published_time") || meta("datePublished") || meta("pubdate") || meta("publishdate") || document.querySelector("time[datetime]")?.getAttribute("datetime"));
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const walk = value => {
        if (Array.isArray(value)) { value.forEach(walk); return; }
        if (!value || typeof value !== "object") return;
        const types = array(value["@type"]);
        if (!publishedAt && types.some(type => /Article|NewsPosting|BlogPosting/.test(type))) publishedAt = parseDate(value.datePublished);
        if (value["@graph"]) walk(value["@graph"]);
      };
      walk(JSON.parse(script.textContent));
    } catch {}
  }
  let article;
  try { article = new Readability(document.cloneNode(true), { charThreshold: 200, maxElemsToParse: 50000 }).parse(); } catch {}
  const main = document.querySelector("article,.entry-content,[itemprop=articleBody],main");
  const text = article?.textContent?.trim() || (main ? plainText(main.innerHTML) : "");
  const title = article?.title || meta("og:title") || document.title;
  return { title, text: text.slice(0, 16000), publishedAt, description: meta("description") || meta("og:description"), url };
}

export function relevance(article) {
  const text = `${article.title} ${article.summary}`;
  let score = 0;
  if (/\bAI\b|artificial intelligence|智能体|人工智能|大模型|机器学习|agentic|LLM|OpenAI|Anthropic|Claude|Gemini|通义|豆包|Qwen/i.test(text)) score += 4;
  if (/融[资投]|募资|种子轮|天使轮|[A-F]轮|估值|融资|收购|\bfunding\b|\brais(?:e[ds]?|ing)\b|series [a-f]|seed round|valuation|acqui[rs]/i.test(text)) score += 4;
  if (/创业|初创|独立开发|自举|startup|bootstrapp|solo founder|indie|show hn|launched|MRR|ARR/i.test(text)) score += 3;
  if (/客户|订阅|收入|营收|盈利|商业化|采购|资本开支|revenue|customer|profitable|enterprise|capex/i.test(text)) score += 2;
  if (/API|定价|降价|价格调整|下线|开发者平台|pricing|deprecat|rate.limit|release|新发布/i.test(text)) score += 2;
  if (["company","investor"].includes(article.kind)) score += 1;
  if (/股价|股市|股票|stock market|share price/i.test(text) && !/融资|募资|收购|capex|funding|acqui|investment/i.test(text)) score -= 3;
  if (/优惠|优惠券|手机评测|游戏攻略|betting|crypto price|coupon/i.test(text)) score -= 5;
  return score;
}
export function mergeArticle(previous, incoming) {
  if (!previous) return { ...incoming, firstSeenAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() };
  return { ...incoming, ...previous, publishedAt: previous.publishedAt || incoming.publishedAt, summary: incoming.summary?.length > previous.summary?.length ? incoming.summary : previous.summary, ...(incoming.text?.length > (previous.text?.length || 0) && !previous.fetchedAt ? { text: incoming.text, evidenceLevel: incoming.evidenceLevel } : {}), discoveredBy: [...new Set([...previous.discoveredBy, ...incoming.discoveredBy])], lastSeenAt: new Date().toISOString() };
}
export function deduplicate(articles) {
  const seen = new Map(); const output = [];
  for (const article of [...articles].sort((a,b) => relevance(b) - relevance(a))) {
    const titleKey = article.title.normalize("NFKC").toLowerCase().replace(/\s*[-|–]\s*(36kr|创业邦|新浪财经|techcrunch).*$/i, "").replace(/[^\p{L}\p{N}]/gu, "");
    const key = titleKey.length > 20 ? titleKey : article.canonicalUrl;
    if (seen.has(key)) { const existing = seen.get(key); existing.alternateSources ||= []; existing.alternateSources.push({ id: article.id, title: article.title, url: article.url }); continue; }
    const item = { ...article }; seen.set(key, item); output.push(item);
  }
  return output;
}
