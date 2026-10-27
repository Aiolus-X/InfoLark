import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fetchPublic, mapLimit } from "./http.js";
import { articleId, canonicalUrl, extractArticle, mergeArticle, parseFeed, plainText, relevance } from "./articles.js";
import { dayOffset, isOnDay, dayWindow } from "./time.js";
import { resolveNewsLink } from "./news-links.js";

export function discoveryTasks(definitions, day) {
  const from = dayOffset(day, -1); const until = dayOffset(day, 1);
  return definitions.flatMap(source => {
    const dated = `${source.query} after:${from} before:${until}`;
    const google = new URL("https://news.google.com/rss/search");
    google.search = new URLSearchParams({ q: dated, hl: source.language === "zh" ? "zh-CN" : "en-US", gl: source.language === "zh" ? "CN" : "US", ceid: source.language === "zh" ? "CN:zh-Hans" : "US:en" }).toString();
    const bing = new URL("https://www.bing.com/search"); bing.search = new URLSearchParams({ q: dated, format: "rss", count: "30" }).toString();
    return [
      { ...source, id: `${source.id}:news`, name: `${source.name} · 新闻搜索`, url: google.href, adapter: "feed", discovery: true, priority: "core", searchEngine: "google-news" },
      { ...source, id: `${source.id}:web`, name: `${source.name} · 网页搜索`, url: bing.href, adapter: "feed", discovery: true, priority: "core", searchEngine: "bing-web" }
    ];
  });
}

export class Collector {
  constructor({ config, store, fetchImpl = fetchPublic, logger = console }) { this.config = config; this.store = store; this.fetch = fetchImpl; this.logger = logger; }
  async collect(day, { discovery = true } = {}) {
    const definitions = JSON.parse(readFileSync(join(this.config.cwd, "sources.json"), "utf8"));
    const tasks = [...definitions.feeds.map(source => ({ ...source, adapter: "feed" })),
      { id: "hn-show", name: "Hacker News · Show HN", adapter: "hn", kind: "community", priority: "core", region: "global" },
      { id: "hn-launch", name: "YC / Hacker News · Launch HN", adapter: "hn", query: "Launch HN", kind: "community", priority: "core", region: "global" }];
    if (discovery) tasks.push(...discoveryTasks(definitions.discovery, day));
    this.store.state.firstCollectedAt ||= new Date().toISOString();
    const results = await mapLimit(tasks, 4, async source => {
      const at = new Date().toISOString();
      try {
        const articles = source.adapter === "hn" ? await this.hackerNews(day, source) : parseFeed((await this.fetch(source.url)).text, source);
        let added = 0;
        for (const article of articles) {
          // Generic web RSS dates may describe indexing rather than original publication.
          if (source.searchEngine === "bing-web") { article.discoveredAtSearch = article.publishedAt; article.publishedAt = ""; article.publicationBasis = "unverified"; }
          if (!this.store.state.articles[article.id]) added++;
          this.store.state.articles[article.id] = mergeArticle(this.store.state.articles[article.id], article);
        }
        const newest = articles.map(a=>a.publishedAt).filter(Boolean).sort().at(-1) || null;
        this.store.state.sources[source.id] = { name: source.name, status: "ok", fetchedAt: at, found: articles.length, inWindow: articles.filter(a=>isOnDay(a.publishedAt,day,this.config.timezone)).length, added, newest, discovery: Boolean(source.discovery), query: source.query || "", url: source.url || "https://hn.algolia.com/" };
        this.store.save();
        this.logger.log(`采集 ${source.name}：${articles.length} 条`);
        return articles.length;
      } catch (error) {
        this.store.state.sources[source.id] = { name: source.name, status: "unavailable", fetchedAt: at, error: error.message, found: 0, discovery: Boolean(source.discovery), query: source.query || "", url: source.url || "https://hn.algolia.com/" };
        this.store.save();
        this.logger.log(`采集 ${source.name}：暂不可用（${error.message}）`);
        return 0;
      }
    });
    this.store.state.sources["x-direct"] = { name: "X/Twitter · 直接搜索", status: this.config.xBearer ? "configured" : "not-configured", found: 0, fetchedAt: new Date().toISOString(), error: this.config.xBearer ? "直接搜索接口将在本次查询中调用" : "未配置 X API；已尝试公开搜索发现，不能视为覆盖全部 X 内容" };
    if (this.config.xBearer && discovery) await this.collectX(day);
    if (this.config.braveKey && discovery) await this.collectBrave(definitions.discovery.filter(s=>s.id.startsWith("broad-")), day);
    this.store.state.lastCollectedAt = new Date().toISOString();
    this.store.save();
    return { fetched: results.reduce((sum,r)=>sum+(r.status === "fulfilled" ? r.value : 0),0), total: Object.keys(this.store.state.articles).length, sourceCount: tasks.length };
  }

  async hackerNews(day, source = {id:"hn-show",name:"Hacker News · Show HN"}) {
    // Use a wider UTC window, then apply the precise Asia/Shanghai date gate later.
    const start = Date.parse(`${dayOffset(day,-1)}T00:00:00Z`) / 1000;
    const end = Date.parse(`${dayOffset(day,1)}T23:59:59Z`) / 1000;
    const output = [];
    for (let page = 0; page < 3; page++) {
      const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
      url.search = new URLSearchParams({ tags: source.query ? "story" : "show_hn", ...(source.query ? {query:source.query} : {}), numericFilters: `created_at_i>=${start},created_at_i<${end}`, hitsPerPage: "100", page: String(page) }).toString();
      const payload = JSON.parse((await this.fetch(url.href)).text);
      for (const item of payload.hits || []) {
        const link = `https://news.ycombinator.com/item?id=${item.objectID}`;
        output.push({ id: articleId(link), url: link, canonicalUrl: canonicalUrl(link), projectUrl: item.url || "", title: item.title, summary: plainText(item.story_text || ""), text: plainText(item.story_text || "").slice(0,12000), publishedAt: item.created_at, publicationBasis: "platform", kind: "community", priority: "core", region: "global", sourceId: source.id, sourceName: source.name, publisher: item.author || "HN 用户", evidenceLevel: "community-post", discoveredBy: [source.id] });
      }
      if (page + 1 >= payload.nbPages) break;
    }
    return output;
  }

  async collectX(day) {
    const record = this.store.state.sources["x-direct"];
    try {
      const url = new URL("https://api.x.com/2/tweets/search/recent");
      const window=dayWindow(day,this.config.timezone);
      url.search = new URLSearchParams({ query: '(AI OR startup) (funding OR raised OR bootstrapped OR ARR) -is:retweet', max_results: "100", "tweet.fields": "created_at,author_id", start_time: window.start, end_time: window.end }).toString();
      const response = await fetch(url, { headers: { Authorization: `Bearer ${this.config.xBearer}` }, redirect: "error", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`X API HTTP ${response.status}`);
      const payload = await response.json();
      for (const item of payload.data || []) {
        const link = `https://x.com/i/web/status/${item.id}`;
        const article = { id: articleId(link), url: link, canonicalUrl: canonicalUrl(link), title: item.text.slice(0,160), summary: item.text, text: item.text, publishedAt: item.created_at, publicationBasis: "platform", kind: "community", priority: "core", region: "global", sourceId: "x-direct", sourceName: "X/Twitter", publisher: "X 公开用户帖", evidenceLevel: "community-post", discoveredBy: ["x-direct"] };
        this.store.state.articles[article.id] = mergeArticle(this.store.state.articles[article.id], article);
      }
      Object.assign(record, { status: "ok", found: payload.data?.length || 0, error: "", note: payload.meta?.next_token ? "本次达到分页上限，X 未全量覆盖" : "按查询条件检索的公开帖" });
    } catch (error) { Object.assign(record, { status: "unavailable", error: error.message }); }
  }

  async collectBrave(queries, day) {
    for (const source of queries) {
      const id = `${source.id}:brave`;
      try {
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.search = new URLSearchParams({ q: `${source.query} after:${dayOffset(day,-1)} before:${dayOffset(day,1)}`, count: "20" }).toString();
        const response = await fetch(url, { headers: { "X-Subscription-Token": this.config.braveKey, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`Brave API HTTP ${response.status}`);
        const payload = await response.json();
        for (const item of payload.web?.results || []) {
          const article = { id: articleId(item.url), url: item.url, canonicalUrl: canonicalUrl(item.url), title: plainText(item.title), summary: plainText(item.description), text: "", publishedAt: "", publicationBasis: "unverified", kind: "discovery", priority: "core", region: "mixed", sourceId: id, sourceName: source.name, publisher: new URL(item.url).hostname, evidenceLevel: "headline", discoveredBy: [id] };
          this.store.state.articles[article.id] = mergeArticle(this.store.state.articles[article.id], article);
        }
        this.store.state.sources[id] = { name: `${source.name} · Brave`, status: "ok", found: payload.web?.results?.length || 0, fetchedAt: new Date().toISOString() };
      } catch (error) { this.store.state.sources[id] = { name: `${source.name} · Brave`, status: "unavailable", found: 0, error: error.message, fetchedAt: new Date().toISOString() }; }
    }
  }

  async enrich(day) {
    const all = Object.values(this.store.state.articles);
    const dated = all.filter(a=>isOnDay(a.publishedAt,day,this.config.timezone) && relevance(a)>=5);
    const undated = all.filter(a=>!a.publishedAt && relevance(a)>=6 && !a.fetchedAt);
    const scoreOrder = values => values.sort((a,b)=>relevance(b)-relevance(a));
    const primary = scoreOrder(dated.filter(a=>a.kind === "community")).slice(0,10);
    const chinese = scoreOrder(dated.filter(a=>a.region === "cn" || /[\u4e00-\u9fff]/.test(a.title))).slice(0,15);
    const targets = [...new Map([...primary,...chinese,...scoreOrder(dated),...scoreOrder(undated).slice(0,40)].map(a=>[a.id,a])).values()].filter(a=>!a.fetchedAt || (new URL(a.url).hostname === "news.google.com" && !a.resolveAttemptAt)).slice(0,this.config.maxEvidence + 40);
    await mapLimit(targets, 4, async article => {
      try {
        if (new URL(article.url).hostname === "news.google.com") {
          article.resolveAttemptAt = new Date().toISOString();
          const resolved = await resolveNewsLink(article.url, { read: this.fetch });
          article.discoveryUrl = article.url; article.url = resolved; article.canonicalUrl = canonicalUrl(resolved);
        }
        if (/^https:\/\/(?:www\.)?(?:x|twitter)\.com\//.test(article.url)) {
          const id = /\/status\/(\d+)/.exec(article.url)?.[1] || /\/status\/(\d+)/.exec(article.canonicalUrl)?.[1];
          if (id) {
            const url = `https://publish.twitter.com/oembed?omit_script=true&url=${encodeURIComponent(article.url)}`;
            const payload = JSON.parse((await this.fetch(url)).text);
            article.text = plainText(payload.html); article.publisher = payload.author_name || "X 用户";
            article.publishedAt = new Date(Number((BigInt(id) >> 22n) + 1288834974657n)).toISOString();
            article.publicationBasis = "platform-id"; article.evidenceLevel = "community-post"; article.kind = "community";
          }
        } else if (!new URL(article.url).hostname.endsWith("news.google.com")) {
          const response = await this.fetch(article.url);
          const extracted = extractArticle(response.text, response.url);
          if (extracted.text.length > Math.max(400, article.text?.length || 0)) {
            article.text = extracted.text;
            article.evidenceLevel = /subscribe to (read|continue)|订阅后.*阅读|付费.*阅读全文/i.test(extracted.text) ? "partial" : "article";
          }
          if (extracted.publishedAt && article.kind !== "community") { article.feedPublishedAt = article.publishedAt; article.publishedAt = extracted.publishedAt; article.publicationBasis = "publisher-page"; }
          if (extracted.description && !article.summary) article.summary = extracted.description;
        } else article.fetchNote = "聚合索引链接，未取得发布者全文；仅作线索";
      } catch (error) { article.fetchNote = error.message; }
      article.fetchedAt = new Date().toISOString();
      this.store.save();
    });
    return { inspected: targets.length };
  }
}
