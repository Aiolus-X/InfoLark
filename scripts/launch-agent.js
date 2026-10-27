import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { parseEnv } from "node:util";

if (process.platform !== "darwin") throw new Error("此脚本用于 macOS；其他系统请使用进程管理器保持服务运行");
const serviceName = "InfoLark";
const label = "com.infolark.daily";
const entry = "src/daemon.js";
const portKey = "INFOLARK_PORT";
const defaultPort = 8791;
const action = process.argv[2] || "install";
const cwd = resolve(fileURLToPath(new URL("..", import.meta.url)));
const directory = join(homedir(), "Library/LaunchAgents");
const file = join(directory, label + ".plist");
const domain = "gui/" + process.getuid();
const target = domain + "/" + label;
const run = args => spawnSync("launchctl", args, { encoding: "utf8", timeout: 5000 });
const existing = run(["print", target]);
const oldPid = Number(/\bpid = (\d+)/.exec(existing.stdout || "")?.[1]) || 0;
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code !== "ESRCH"; } };
const envPath = join(cwd, ".env");
const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, "utf8")) : {};
const port = Number(env[portKey]) || defaultPort;
async function health() {
  try { const response = await fetch("http://127.0.0.1:" + port + "/health", { signal: AbortSignal.timeout(1500) }); return response.ok ? await response.json() : null; } catch { return null; }
}
if (action === "status") {
  const state = await health();
  console.log(JSON.stringify({ service: serviceName, registered: existing.status === 0, pid: oldPid || undefined, reachable: Boolean(state), connection: state?.connection, subscribed: state?.subscribed, busy: state?.busy ?? Boolean(state?.jobs?.some(job => ["running", "pending"].includes(job.status))) }, null, 2));
  process.exit();
}
if (!["install", "remove"].includes(action)) throw new Error("可用操作：install / remove / status");
const current = await health();
if (current && (current.busy || current.jobs?.some(job => ["running", "pending"].includes(job.status)))) throw new Error(serviceName + " 正在处理任务；请完成后重试，避免中断写入");
if (action === "install" && existing.status !== 0 && current) throw new Error("该端口已有手动服务运行，请先停止旧进程，再安装后台任务");
if (existing.status === 0) {
  const stopped = run(["bootout", target]);
  if (stopped.status !== 0) throw new Error("停止原后台任务失败：" + (stopped.stderr || stopped.error?.message || "未知错误").trim());
  const deadline = Date.now() + 45000;
  while (run(["print", target]).status === 0 || alive(oldPid)) {
    if (Date.now() > deadline) throw new Error("旧进程仍未完全退出，未启动第二个实例；稍后重试");
    await delay(250);
  }
}
if (action === "remove") {
  if (existsSync(file)) unlinkSync(file);
  console.log(serviceName + " 后台任务已移除，下次登录不会自动启动；数据和配置保留。");
  process.exit();
}
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
mkdirSync(directory, { recursive: true });
mkdirSync(join(cwd, "data"), { recursive: true, mode: 0o700 });
const plist = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>'
  + "<key>Label</key><string>" + label + "</string>"
  + "<key>ProgramArguments</key><array><string>" + escape(process.execPath) + "</string><string>--env-file-if-exists=.env</string><string>" + escape(join(cwd, entry)) + "</string></array>"
  + "<key>WorkingDirectory</key><string>" + escape(cwd) + "</string>"
  + "<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer>"
  + "<key>ProcessType</key><string>Background</string><key>ExitTimeOut</key><integer>60</integer>"
  + "<key>StandardOutPath</key><string>" + escape(join(cwd, "data/daemon.log")) + "</string>"
  + "<key>StandardErrorPath</key><string>" + escape(join(cwd, "data/daemon-error.log")) + "</string></dict></plist>\n";
writeFileSync(file, plist, { mode: 0o600 });
let started;
for (let attempt = 0; attempt < 4; attempt++) {
  started = run(["bootstrap", domain, file]);
  if (started.status === 0 || run(["print", target]).status === 0) break;
  if (!/Bootstrap failed: 5/.test(started.stderr || "") || attempt === 3) throw new Error("后台任务加载失败：" + (started.stderr || started.error?.message || "未知错误").trim());
  await delay(500 * (attempt + 1));
}
console.log(serviceName + " 已设为后台常驻：登录后自动启动，进程退出后由 macOS 重新启动。");
console.log("状态地址：http://127.0.0.1:" + port);
