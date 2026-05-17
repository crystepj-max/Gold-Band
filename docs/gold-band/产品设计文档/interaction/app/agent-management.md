# Agent 管理页

## 1. 一句话定义
Agent 管理页负责维护当前桌面 workspace 可用的 agent type 配置，并提供诊断、编辑与删除能力。

---

## 2. 页面目标
当前桌面端需要把“节点声明用哪个 agent”和“这个 agent 实际怎么执行”分开：
- workflow 节点通过 `provider` 显式声明 agent type
- Agent 管理页负责维护这个 type 的执行命令、参数、环境变量和诊断状态

当前规则：
- Worker / Verify 节点必须显式声明 `provider`
- 当前不提供默认 Claude 兜底
- 当前同一 agent type 只能配置一份实例

---

## 3. 页面结构

```text
Page Header
- 标题 / 副标题
- 刷新
- 新增 Agent（下拉）

Agent Cards
- icon
- display name
- agent type
- command / args / env 摘要
- 诊断状态 / 最近检测时间（本地系统时区 `YYYY-MM-DD HH:MM:SS`）
- 诊断 / 修改 / 删除

布局要求：
- agent card 内容与卡片边缘保持稳定左右内边距，不允许内容贴边
- 编辑 Sheet 头部、表单区和底部操作区需要保持统一左右内边距
```

---

## 4. 新增 Agent
新增按钮使用下拉菜单：
- Claude Code：当前可新增
- Codex CLI：待支持
- OpenCode：待支持
- Gemini CLI：待支持

限制：
- 已配置过的 agent type 不可重复新增
- 当前只允许真正创建 `claude-code`

---

## 5. 编辑能力
当前 MVP 编辑项：
- display name
- command
- args
- env

交互：
- 通过右侧 Sheet 编辑
- `args` 按“一行一个参数”输入，编辑态保留原始多行文本，保存时再解析
- `env` 按 `KEY=VALUE` 输入，编辑态保留原始多行文本，保存时再解析
- 保存只更新配置并清空旧诊断状态，不同步触发环境诊断，避免保存流程被诊断进程阻塞

---

## 6. 诊断能力
每个 agent card 提供：
- 手动“环境诊断”按钮
- 诊断状态图标
- 最近检测时间（展示为本地系统时区 `YYYY-MM-DD HH:MM:SS`）
- 错误原因（如果有）
- 诊断完成后显示数秒成功横幅，提示诊断进程已退出

后台能力：
- 桌面端启动后自动执行诊断
- 后台每 60 秒自动诊断一次当前 workspace 下已配置 agent
- 手动诊断和自动诊断都必须在诊断结束或初始化失败后关闭 ACP adapter 进程
- 诊断状态只做运行时缓存，不写入用户持久化配置

---

## 7. 与 workflow 的关系
Agent 管理页不是 workflow 编辑器，但它决定 workflow 里声明的 agent type 是否可执行。

当前约束：
- workflow 节点中的 `provider` 字段表示 managed agent type
- 创建任务与工作流编辑器的节点 Agent 下拉来源于 Agent 管理页已配置且当前支持的 agent card
- 若节点引用的 agent type 未在 Agent 管理页中配置，则 workflow 校验失败
- 节点详情页应展示当前节点绑定的 agent type，便于确认执行来源

---

## 8. 一句话总结
> Agent 管理页解决的是“这个 agent type 在当前 workspace 里怎么跑、是否健康”；节点执行仍然由 workflow 显式声明 `provider` 决定。