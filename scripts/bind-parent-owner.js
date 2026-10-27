import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { loadConfig } from "../src/config.js";
import { Feishu } from "../src/feishu.js";
import { Store } from "../src/store.js";

// Explicit operator action, used only after the reader has asked to subscribe.
// Cross-check the same parent resource against the already paired PaperLark reader.
if (!process.argv.includes("--subscribe")) throw new Error("此操作会开启本人提醒，显式使用 --subscribe；通常在机器人私聊 /start 即可");
const config = loadConfig();
const paperEnv = parseEnv(readFileSync(join(config.paperlarkDir, ".env"), "utf8"));
const paired = JSON.parse(readFileSync(resolve(config.paperlarkDir, paperEnv.PAPERLARK_BRIDGE_CONFIG || "data/browser-bridge.json"), "utf8"));
const { FeishuClient } = await import(pathToFileURL(join(config.paperlarkDir, "src/feishu-client.js")).href);
const paper = new FeishuClient({ settings: { feishuAppId: paperEnv.FEISHU_APP_ID, feishuAppSecret: paperEnv.FEISHU_APP_SECRET } });
const info = new Feishu({ config });
const [paperParent, infoParent] = await Promise.all([paper.resolveFile(config.parentUrl), info.resolve(config.parentUrl)]);
if (paperParent.fileToken !== infoParent.documentId) throw new Error("两应用解析的父文档不一致，未绑定");
const [paperMeta, infoMeta, bot] = await Promise.all([
  paper.metadata(paperParent.fileToken, "docx"),
  info.request("/open-apis/drive/v1/metas/batch_query?user_id_type=open_id", { method: "POST", body: { request_docs: [{ doc_token: infoParent.documentId, doc_type: "docx" }], with_url: false } }),
  info.request("/open-apis/bot/v3/info")
]);
const recipient = infoMeta.metas?.[0]?.owner_id;
if (!paired.userId || paperMeta.owner_id !== paired.userId || !/^ou_[A-Za-z0-9]+$/.test(recipient || "") || recipient === bot.bot?.open_id) throw new Error("无法确认父文档所有者与已配对阅读者一致，未绑定");
const store = new Store(config.dataDir);
const release = store.lock();
try {
  if (store.state.recipient?.appId === config.appId && store.state.recipient.openId !== recipient) throw new Error("已绑定其他账号，未覆盖");
  store.state.recipient = { appId: config.appId, openId: recipient, enabled: true, bindingSource: "verified-parent-owner", boundAt: new Date().toISOString() };
  store.save();
  console.log("已交叉核对父文档所有者与 PaperLark 配对账号，绑定独立 InfoLark 身份并开启提醒。未伪造消息事件。");
} finally { release(); }
