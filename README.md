# InfoLark

广泛收集前一天的创业、融资和 AI 商业信息，生成中文飞书日报，每天北京时间 11:00 提醒。日报可通过 PaperLark 评论继续提问和讨论，重要内容由用户决定是否沉淀到父文档。

## 日报结构

- 个人 / 小团队：按**可复现性**排序，最多 5 条。
- 初创 / 有一定规模：按**价值性**排序，最多 5 条。
- 大厂 / 企业：按**影响力**排序，最多 5 条。
- 当日方法论、深度思考与验证动作。
- 每条来源链接、其他合格线索索引及采集覆盖说明。

来源持续扩充，样例不作为真实新闻证据，详见 [来源与筛选策略](docs/SOURCE_STRATEGY.md)。

## 首次安装

```bash
git clone https://github.com/Aiolus-X/InfoLark.git
cd InfoLark
npm ci
cp .env.example .env
```

以上复制命令仅用于首次安装，已有 `.env` 请勿覆盖。填写自己的 InfoLark 应用凭据与父文档链接后运行：

```bash
npm run doctor
npm run collect
npm run preview -- --no-collect
npm start
```

默认复用旁边 PaperLark 的模型配置，不复用它的飞书身份。独立使用时设置 `INFOLARK_MODEL_SOURCE=own`、`INFOLARK_PAPERLARK_BRIDGE=false`，并填写 `INFOLARK_LLM_*` 参数；模型名称与推理强度以服务商支持的值为准。

若需要 PaperLark 联动，请按 [配套补丁说明](integrations/README.md) 确认其包含日报关联接口。本仓库附带所需补丁，不依赖未公开的本机修改。

预览保存到 `data/YYYY-MM-DD.md` 和结构化 JSON。状态页为 http://127.0.0.1:8791 。采集与生成使用真实公开内容，应用凭据缺失不妨碍本地预览。

## 开通独立飞书应用

入口：https://open.feishu.cn/app 。详细步骤和最小权限见 [飞书配置清单](docs/FEISHU_SETUP.md)。

配置完成后：

1. 给汇总父页面添加 InfoLark 和 PaperLark。
2. 在 InfoLark 私聊发送 `/start` 绑定本人。
3. `/now` 生成并发送昨日一期，`/status` 查看状态，`/stop` 停止自动提醒。
4. 在日报选区评论 `/ask` 或 `/think`；同线程 `/add` 将讨论写入父文档，并保留来源日报链接。
5. `/note` 在父文档末尾追加 ToDo。日报的 AI 分析不会自动写进精选汇总。

## 定时与恢复

`npm run schedule:install` 安装 macOS 后台任务；`npm run schedule:remove` 停止。默认每 30 分钟采集站点、每 3 小时做完整发现，10:30 提前准备，11:00 发送。

本机休眠/断网会延迟，恢复后只补最近一个应发日报。要脱离电脑持续准点运行，需要部署常驻机器。当前持久化为单实例 JSON，不允许两个进程同时写同一数据目录。

安装 macOS 后台任务后，日常不用保留终端窗口。查看、重载及停用方法见 [持续运行说明](docs/RUNNING.md)。

创建、正文写入、索引、PaperLark 接入、提醒分别保存状态。Docx 块使用幂等 `client_token`，消息使用 `uuid`。创建文档若未取得确定结果会停止，避免重复生成；需先核对实际父目录。已经发送成功的同一天不会再自动重复提醒。

## 验证与当前边界

```bash
npm test
```

18 项自动化测试覆盖日期边界、源解析、原文定位、引用校验、每层上限、Docx 链接、持久化、定时和写入恢复。本项目已有真实采集、日报创建、PaperLark 关联和消息通知验证；新安装仍需在自己的租户验收，不能只凭测试通过判断权限齐全。

公开搜索、RSS、社区与公司发布不能保证穷尽互联网。付费/登录内容、X API 权限、失效源和采集间断都会影响覆盖，并在日报中明示。

`.env`、`data/`、`example.txt`、`question.md`、`PLAN.md` 和 `.local/` 为本机私有文件，不进入版本库。仓库提供源码、测试、依赖锁定文件、公开来源配置、安装文档和配套补丁，不携带可直接使用的密钥。
