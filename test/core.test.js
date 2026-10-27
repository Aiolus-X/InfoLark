import test from "node:test";
import assert from "node:assert/strict";
import { localDay, yesterday, isOnDay, dayWindow, assertDay } from "../src/time.js";
import { parseFeed, canonicalUrl, extractArticle, deduplicate } from "../src/articles.js";
import { isPublicAddress, safeUrl } from "../src/http.js";
import { validateReport, renderReport } from "../src/report.js";
import { markdownBlocks, stableToken } from "../src/feishu.js";
import { resolveNewsLink } from "../src/news-links.js";

test("yesterday uses the user's calendar day and rejects adjacent UTC-day articles",()=>{
  assert.equal(yesterday(new Date("2026-10-26T16:05:00Z")),"2026-10-26");
  assert.equal(localDay(new Date("2026-10-25T17:00:00Z")),"2026-10-26");
  assert.equal(isOnDay("2026-10-26T16:00:00Z","2026-10-26"),false);
  assert.equal(isOnDay("not a date","2026-10-26"),false);
  assert.deepEqual(dayWindow("2026-10-26"),{start:"2026-10-25T16:00:00.000Z",end:"2026-10-26T16:00:00.000Z"});
  const dst=dayWindow("2026-03-08","America/New_York");assert.equal(Date.parse(dst.end)-Date.parse(dst.start),23*3600000);
  assert.throws(()=>assertDay("2026-02-30"));
});
test("RSS and Atom retain publication dates, source links and readable text",()=>{
  const source={id:"example",name:"Example",kind:"media"};
  const rss=parseFeed('<rss><channel><item><title>AI &amp; funding</title><link>https://example.com/news?utm_source=a</link><pubDate>Mon, 26 Oct 2026 01:00:00 GMT</pubDate><description>&lt;p&gt;Raised funding&lt;/p&gt;</description></item></channel></rss>',source);
  assert.equal(rss[0].title,"AI & funding");assert.equal(rss[0].summary,"Raised funding");assert.equal(rss[0].publishedAt,"2026-10-26T01:00:00.000Z");
  const atom=parseFeed('<feed><entry><title>Launch</title><link href="https://example.com/launch" rel="alternate"/><published>2026-10-26T09:00:00Z</published><summary>Hello</summary></entry></feed>',source);
  assert.equal(atom[0].url,"https://example.com/launch");
  assert.throws(()=>parseFeed("<html>Login required</html>",source),/未返回有效/);
  assert.throws(()=>parseFeed('<!DOCTYPE rss [<!ENTITY x "bad">]><rss/>',source),/自定义实体/);
});
test("tracking parameters deduplicate but meaningful URL parameters remain",()=>{
  assert.equal(canonicalUrl("https://www.example.com/post/?utm_source=one&id=2#comments"),"https://example.com/post?id=2");
  const a={id:"a",title:"A very important AI startup funding round",summary:"",canonicalUrl:"https://one.example/a"};
  const b={...a,id:"b",canonicalUrl:"https://two.example/a",url:"https://two.example/a"};
  assert.equal(deduplicate([a,b]).length,1);assert.equal(deduplicate([a,b])[0].alternateSources[0].id,"b");
});
test("article extraction obtains original publication metadata without running scripts",()=>{
  const value=extractArticle('<html><head><meta property="article:published_time" content="2026-10-26T05:00:00Z"><title>Funding</title></head><body><article><p>A startup raised funding. '+"Evidence sentence. ".repeat(50)+'</p></article><script>throw new Error("must not run")</script></body></html>',"https://example.com/article");
  assert.equal(value.publishedAt,"2026-10-26T05:00:00.000Z");assert.match(value.text,/A startup raised funding/);assert.doesNotMatch(value.text,/must not run/);
});
test("source requests reject private addresses and credential-bearing URLs",()=>{
  for(const address of ["127.0.0.1","10.0.0.4","169.254.169.254","::1","::ffff:192.168.1.1","fc00::2"])assert.equal(isPublicAddress(address),false,address);
  assert.equal(isPublicAddress("8.8.8.8"),true);
  for(const url of ["http://127.0.0.1/health","https://user:password@example.com/","file:///etc/passwd"])assert.throws(()=>safeUrl(url));
});
test("report caps each tier at five, ranks within the cap and drops unsupported facts",()=>{
  const evidence=[{id:"source",title:"Announcement",text:"The company announced a funding round of $10 million.",summary:"",url:"https://example.com/news",publishedAt:"2026-10-26T01:00:00Z",publisher:"Example"}];
  const make=(tier,i)=>({tier,title:`Company ${tier} ${i}`,eventKey:`${tier}-${i}`,selectionScore:i,selectionReason:"有可核实的结果",facts:[{label:"资金",text:"完成融资",sources:["source"],evidence:[{source:"source",quote:"announced a funding round of $10 million"}]}],analysis:[]});
  const items=[...["individual","startup","enterprise"].flatMap(tier=>Array.from({length:7},(_,i)=>make(tier,i))),{...make("startup",9),facts:[{text:"Fake",sources:["invented"],evidence:[{source:"invented",quote:"made up fact"}]}]}];
  const report=validateReport({items,methods:[],thoughts:[]},evidence,"2026-10-26",15,5);
  assert.equal(report.items.length,15);for(const tier of ["individual","startup","enterprise"]){assert.equal(report.items.filter(i=>i.tier===tier).length,5);assert.ok(report.items.filter(i=>i.tier===tier).every(i=>i.selectionScore>=2));}
  const markdown=renderReport(report,evidence,{coverage:{},firstCollectedAt:"2026-10-27T01:00:00Z"},{timezone:"Asia/Shanghai"});
  assert.match(markdown,/https:\/\/example.com\/news/);assert.match(markdown,/可复现性/);assert.match(markdown,/首次运行/);assert.doesNotMatch(markdown,/Fake/);
});
test("Feishu output creates native links and stable write idempotency tokens",()=>{
  const blocks=markdownBlocks("## Sources\n- [原文](https://example.com/a) **融资** $10 million");
  assert.equal(blocks[0].block_type,4);assert.equal(blocks[1].bullet.elements[0].text_run.text_element_style.link.url,"https://example.com/a");
  assert.equal(stableToken("day:body:0"),stableToken("day:body:0"));assert.notEqual(stableToken("day:body:0"),stableToken("day:body:1"));
});
test("public news links resolve to publisher pages without login credentials",async()=>{
  const read=async()=>({url:"https://news.google.com/rss/articles/ExampleId",text:'<div data-n-a-sg="signature" data-n-a-ts="123"></div>'});
  const post=async(url,options)=>{assert.equal(new URL(url).hostname,"news.google.com");assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);assert.match(options.body,/f.req=/);return new Response(")]}'\n\n"+JSON.stringify([["wrb.fr","Fbv4je",JSON.stringify(["garturlres","https://publisher.example/article"]),null,"0"]]));};
  assert.equal(await resolveNewsLink("https://news.google.com/rss/articles/ExampleId",{read,post}),"https://publisher.example/article");
});
