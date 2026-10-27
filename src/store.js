import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class Store {
  constructor(directory) {
    this.directory = directory;
    this.file = join(directory, "state.json");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.state = existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : { version: 1, articles: {}, sources: {}, runs: {}, messages: {}, recipient: null, parent: null };
  }
  save() { writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state), { mode: 0o600 }); renameSync(`${this.file}.tmp`, this.file); }
  run(day) { return this.state.runs[day] ||= { day, status: "new", createdAt: new Date().toISOString() }; }
  writeArtifact(name, contents) {
    const file = join(this.directory, name);
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error("无效的本地文件名");
    writeFileSync(file, typeof contents === "string" ? contents : JSON.stringify(contents, null, 2), { mode: 0o600 });
    return file;
  }
  lock() {
    const path = join(this.directory, "instance.lock");
    if (existsSync(path)) {
      const record = JSON.parse(readFileSync(path, "utf8"));
      let alive = false;
      try { process.kill(record.pid, 0); alive = true; } catch (error) { if (error.code !== "ESRCH") alive = true; }
      if (alive) throw new Error("InfoLark 已在运行。请使用状态页操作，或停止旧进程后再执行 CLI");
      rmSync(path);
    }
    writeFileSync(path, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
    return () => { try { const record = JSON.parse(readFileSync(path, "utf8")); if (record.pid === process.pid) rmSync(path); } catch {} };
  }
}
