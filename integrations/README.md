# PaperLark 联动补丁

InfoLark 可以独立采集、生成并发送日报；在日报中使用 `/ask`、`/think`、`/add` 需要 PaperLark 同时运行。

本目录包含配套的 `paperlark-infolark.patch`，用于补齐：

- 经本机桥接鉴权的日报登记与父文档关联。
- `/add`、`/note` 写入长期汇总，保留来源日报回链。
- 多篇日报写入同一父文档时使用共同写锁。
- 原生链接、融资金额文本格式，以及 macOS 后台运行脚本。

补丁基于 [Aiolus-X/PaperLark](https://github.com/Aiolus-X/PaperLark) 的提交 `b28c62d7f6a561f62c3f30d7d9e0e9a49098523d` 生成。不包含 App Secret、配对 Key、个人文档链接或运行状态。

## 应用补丁

先准备好位于 InfoLark 旁边的 PaperLark 项目。首次安装可以克隆；已有项目不要重复克隆或覆盖。

在 **InfoLark 目录**执行：

```bash
git -C ../PaperLark apply --check ../InfoLark/integrations/paperlark-infolark.patch
git -C ../PaperLark apply ../InfoLark/integrations/paperlark-infolark.patch
npm --prefix ../PaperLark ci --registry=https://registry.npmjs.org
npm --prefix ../PaperLark test
```

如果当前 PaperLark 已包含这些端点和功能，就不需要重复应用。`--check` 报冲突时先比较版本和本地修改，不要强制覆盖。

重载 PaperLark 后，给父文档添加两个应用。InfoLark 发布日报时会通过本机桥接登记，不需要手动把每篇日报加入监控名单。

## 不启用联动

在 InfoLark `.env` 中设置：

```dotenv
INFOLARK_PAPERLARK_BRIDGE=false
INFOLARK_MODEL_SOURCE=own
```

随后填写独立模型参数，InfoLark 就不依赖旁边的 PaperLark 项目。日报中的阅读提示不代表未运行的 PaperLark 已接入。
