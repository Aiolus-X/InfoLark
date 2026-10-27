# 创建独立 InfoLark 应用

开发者后台入口：**<https://open.feishu.cn/app>** → 创建企业自建应用 → 名称填写 InfoLark。

这一步会新建独立机器人，日报通知由 InfoLark 发出。PaperLark 继续负责文档中的 `/ask`、`/think`、`/add`，两者不要共用 App ID / App Secret。

## 1. 填写凭据

在“凭证与基础信息”复制新应用凭据到项目私有 `.env`：

```dotenv
INFOLARK_FEISHU_APP_ID=your-app-id
INFOLARK_FEISHU_APP_SECRET=your-app-secret
```

将你自己的父文档链接填入 `.env` 的 `INFOLARK_PARENT_URL`。不要把 Key 或 App Secret 写到文档、截图或版本库；无需把密钥粘贴到聊天中。

## 2. 添加机器人能力与应用身份权限

在“添加应用能力”启用机器人。权限管理中选择应用身份：

| 权限                              | 用途                                   |
| ------------------------------- | ------------------------------------ |
| `docx:document`                 | 创建、读取和写入日报与父文档                       |
| `wiki:node:read`                | 解析知识库节点                              |
| `wiki:node:create`              | 在父页面下创建日报                            |
| `drive:drive.metadata:readonly` | 文档元数据                                |
| `im:message:send_as_bot`        | 给本人发送日报提醒                            |
| `im:message.p2p_msg:readonly`   | 接收本人发给 InfoLark 的 `/start` 等指令       |
| `docs:permission.member:create` | 必要时把新建日报授权给 PaperLark；父页面继承权限正常时不会调用 |

不要仅为了创建日报授予整个知识库管理员权限。API scope 与父节点资源权限是两层。

注意：添加消息事件时，后台可能提示“任选一项权限”。若选了群聊 @ 权限，私聊 `/start` 仍不会送达。这里需要应用身份的 **`im:message.p2p_msg:readonly`**，开通后发布；`npm run doctor` 可检查实际授权结果。

## 3. 发布并接入长连接

1. 创建版本，将应用可用范围先设为本人，完成发布和审批（如有）。
2. 本机运行 `npm run doctor`，确认 InfoLark 鉴权成功。
3. 运行 `npm start`，或已安装后台任务时重新运行 `npm run schedule:install`。
4. 在“事件与回调”选择长连接接收，订阅：

```text
im.message.receive_v1
```

保存并发布变更。无需公网回调域名，也无需把 PaperLark 的评论事件加到 InfoLark。评论仍由 PaperLark 自己接收。

## 4. 父文档授权

在已建好的汇总父页面中，通过“更多 → 添加文档应用”添加：

- **InfoLark**：可管理，负责新建子日报、日报索引及必要的协作者授权。
- **PaperLark**：可编辑，负责读取日报和把选定讨论追加到汇总。

确认两应用都能读取该父页面。更换父页面时需重新给两应用授权，不需要重新授权以前的论文。

父文档原有内容会保留。InfoLark 仅在缺少时补充“日报索引”“精选沉淀”“Idea List”三个根层级章节，并在索引中添加日报链接。

## 5. 订阅与验收

打开 **InfoLark 机器人私聊**，发送：

```text
/start
```

它会绑定你在这个新应用下的 open\_id。不同应用的 open\_id 不同，所以不会直接拿 PaperLark 的用户标识发送消息。

随后发送 `/now`，立即生成并发送昨日一期。检查：

1. 日报创建在父文档下面，三层各不超过 5 条，每条有来源链接。
2. 父文档只多出日报索引，没有自动堆入 AI 推测。
3. 日报里选中文字评论 `/think 我的想法……`，PaperLark 在原线程讨论。
4. 同线程回复 `/add 整理这段讨论`，内容进入父文档“精选沉淀”区域，并带来源日报链接。
5. `/note 下一步验证事项` 在父文档末尾新增 ToDo。

其他机器人命令：`/status` 查看状态；`/stop` 停止后续自动提醒。再次 `/start` 恢复订阅。

## 6. 每天 11 点运行

配置验证后执行：

```bash
npm run schedule:install
```

macOS 后台服务会定期采集：默认每 30 分钟读取站点源、每 3 小时跑完整搜索；10:30 开始生成并创建日报，11:00 发送链接。初次配置在 11 点之后会补最近一个应发日报，不连发多天历史内容。

这是本机运行方案，电脑关机、休眠或断网会延迟；恢复后补发。要在电脑离线时也准点发送，需要部署到常驻机器。本项目已完成过真实日报创建、关联和消息发送验证；你自己的安装仍需按以上步骤验收，定时触发受机器在线状态影响。

状态页：<http://127.0.0.1:8791> 。停止后台服务：`npm run schedule:remove`，本地数据不删除。

## 官方依据

- [接收机器人消息](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)
- [发送消息与 UUID 去重](https://open.feishu.cn/document/server-docs/im-v1/message/create)
- [创建知识库节点](https://open.feishu.cn/document/server-docs/docs/wiki-v2/space-node/create)
- [Docx 创建块与 client\_token](https://open.feishu.cn/document/ukTMukTMukTM/uUDN04SN0QjL1QDN/document-docx/docx-v1/document-block-children/create)
- [添加文档协作者](https://open.feishu.cn/document/server-docs/docs/permission/permission-member/create)
