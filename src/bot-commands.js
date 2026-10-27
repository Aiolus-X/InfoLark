export function parseBotCommand(message) {
  let content;
  try { content = typeof message.content === "string" ? JSON.parse(message.content) : message.content; } catch { return ""; }
  let text = "";
  if (message.message_type === "text") text = content?.text || "";
  else if (message.message_type === "post") {
    const post = content?.zh_cn || content?.en_us || content;
    const lines = (post?.content || []).map(row => Array.isArray(row) ? row.map(part => ["text", "a"].includes(part.tag) ? part.text || "" : "").join("") : "").filter(Boolean);
    text = [post?.title || "", ...lines].filter(Boolean).join("\n");
  }
  return /^\/(start|stop|status|now)(?=\s|$)/i.exec(String(text).replace(/[\u200B-\u200D\uFEFF]/g, "").trim())?.[0].toLowerCase() || "";
}
