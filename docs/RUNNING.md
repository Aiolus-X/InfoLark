# InfoLark 与 PaperLark 持续运行

两项服务可安装为 macOS 当前用户的 LaunchAgent。安装后关闭终端或 Codex 不会关闭服务；登录此 macOS 账号后自动启动，进程意外退出时由系统重新启动。

| 服务 | 后台标识 | 状态页 |
| --- | --- | --- |
| InfoLark | `com.infolark.daily` | http://127.0.0.1:8791 |
| PaperLark | `com.paperlark.reader` | http://127.0.0.1:8787/status |

## 日常使用

不用反复运行 `npm start`，也不用保留终端窗口。InfoLark 默认北京时间 10:30 准备、11:00 提醒。

电脑需要保持已登录、联网且系统未休眠。显示器熄灭不等于系统休眠；关机、退出登录或系统休眠期间不能处理评论或准点发送。恢复后 InfoLark 只补最近一个应发日报，已发送的同一天不会重复提醒。

如果要求电脑关机时也能每天准点运行，需要迁到常驻机器；当前是本机方案。

## 查看、重载与停用

在 InfoLark 项目目录执行：

```bash
npm run schedule:status
npm run schedule:install
npm run schedule:remove
```

在 PaperLark 项目目录执行：

```bash
npm run service:status
npm run service:install
npm run service:remove
```

`install` 用于安装或重载，修改 `.env` 后也使用它。脚本会检查正在执行的任务，等待旧实例退出，再启动新实例。`remove` 停止并移除登录自启，配置和历史数据保留。

不要同时手动启动第二个实例。移动项目目录或更换 Node 安装路径后，应在新位置重新执行安装命令。

## 日志与消息入口

各项目的 `data/daemon.log` 和 `data/daemon-error.log` 保存运行日志。消息诊断只记录类型、时间及处理结果，不记录正文。

飞书长连接 `connected` 不等于所有消息权限都齐全。私聊指令需要应用身份 `im:message.p2p_msg:readonly`，群聊 @ 权限不能替代。`npm run doctor` 会核对机器人和实际授权范围。

通常用 InfoLark 私聊 `/start` 开启订阅，`/stop` 暂停后续自动提醒；暂停提醒不会关闭采集服务。彻底停用后台任务使用 `remove`。

在自己的安装上分别验证日报创建、父文档索引、PaperLark 关联和通知接收。操作者明确要求订阅时，可使用 `scripts/bind-parent-owner.js --subscribe` 交叉核对父文档所有者与 PaperLark 已配对账号；先停止 InfoLark 服务再运行，工具不会把该绑定伪装成已收到 `/start` 事件。
