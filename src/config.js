import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parseEnv } from "node:util";

export function loadConfig(cwd = process.cwd(), environment = process.env) {
  const file = join(cwd, ".env");
  const env = { ...environment, ...(existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {}) };
  const number = (key, fallback) => { const value = Number(env[key]); return Number.isFinite(value) && value > 0 ? value : fallback; };
  return {
    cwd, dataDir: resolve(cwd, env.INFOLARK_DATA_DIR || "data"),
    appId: env.INFOLARK_FEISHU_APP_ID || "", appSecret: env.INFOLARK_FEISHU_APP_SECRET || "",
    parentUrl: env.INFOLARK_PARENT_URL || "", recipient: env.INFOLARK_RECIPIENT_OPEN_ID || "",
    timezone: env.INFOLARK_TIMEZONE || "Asia/Shanghai", prepareTime: env.INFOLARK_PREPARE_TIME || "10:30", deliveryTime: env.INFOLARK_DELIVERY_TIME || "11:00",
    pollMinutes: number("INFOLARK_POLL_MINUTES", 30), discoveryMinutes: number("INFOLARK_DISCOVERY_MINUTES", 180), port: number("INFOLARK_PORT", 8791),
    maxFeatured: Math.min(15, number("INFOLARK_MAX_FEATURED", 15)), maxPerTier: Math.min(5, number("INFOLARK_MAX_PER_TIER", 5)), maxEvidence: number("INFOLARK_MAX_EVIDENCE", 50),
    paperlarkDir: resolve(cwd, env.PAPERLARK_DIR || "../PaperLark"), bridgeEnabled: env.INFOLARK_PAPERLARK_BRIDGE !== "false",
    modelSource: env.INFOLARK_MODEL_SOURCE || "paperlark", model: {
      mode: "live", llmBaseUrl: env.INFOLARK_LLM_BASE_URL || "", llmApiKey: env.INFOLARK_LLM_API_KEY || "", llmModel: env.INFOLARK_LLM_MODEL || "",
      llmApi: env.INFOLARK_LLM_API || "responses", llmReasoningEffort: env.INFOLARK_LLM_REASONING_EFFORT || "xhigh", llmTimeoutMs: number("INFOLARK_LLM_TIMEOUT_MS", 600000), llmStream: true
    },
    braveKey: env.BRAVE_SEARCH_API_KEY || "", xBearer: env.X_BEARER_TOKEN || ""
  };
}
