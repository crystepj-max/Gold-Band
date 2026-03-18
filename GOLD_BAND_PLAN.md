# Gold Band MVP 实施计划（推荐方案）

## Context
当前 `TASK.md` 的核心问题是：
1. 主会话依赖模型在长上下文里“自主分发步骤”，容易出现注意力漂移；
2. subagent 不能自动继承/发现用户 skill 生态，导致开源复用弱；
3. `ralph.sh` 用 `<promise>COMPLETE</promise>` 做完成判定，存在“声明完成但实际未完成”的误判风险。

目标是做一个介于“纯 prompt 编排”和“重型图框架”之间的轻量层：
- **程序级稳定性**（由 DSL + 状态机决定下一步，而不是由上下文漂移决定）；
- **原生集成 Claude Code**（沿用 `claude -p`、hooks、skill 入口）；
- **低门槛**（Bash + jq + JSON，先跑通 MVP）。

你已确认的 MVP 方向：
- 实现栈：**Bash + jq**
- DSL 格式：**JSON**
- 完成判定：**三重门（worker结构化输出 + 客观检查 + 独立verifier）**
- 集成入口：**独立 CLI（可被 skill 调用）**

---

## 推荐实现方案（仅保留一条主路线）

### 1) 架构：外部确定性 Runner（Gold Band）
用一个独立脚本（`gold-band.sh`）作为状态机执行器，读取 workflow JSON，逐步执行 step：
- 解析 DSL（步骤、依赖、重试、成功条件）；
- 调用 `claude -p` 执行 worker；
- 对结果做客观检查；
- 调用 verifier 再次校验；
- 只有“三重门”都通过才标记 step 完成。

> 这样把“下一步做什么”的控制权从模型上下文转移到程序逻辑，直接对应你的稳定性诉求。

### 2) 运行模型：每步短上下文 + 结构化输出
每个 step 使用：
- `claude -p ... --output-format json --json-schema ...`
- 必要时 `--allowedTools` 限制工具权限
- 不使用 `<promise>COMPLETE</promise>` 作为最终完成标准

### 3) 三重门完成判定（默认策略）
对每个 step 执行以下门控：
1. **Worker 门**：输出符合预设 JSON Schema（结构完整）；
2. **Objective 门**：客观检查通过（例如文件存在、命令退出码、文本/JSONPath 命中）；
3. **Verifier 门**：独立 verifier agent 输出 `ok=true`，并给出理由。

任一门失败则按 DSL 的 retry/on_fail 策略处理，禁止“口头完成即完成”。

### 4) 与 Claude Code 的轻量集成
- 主入口是 `gold-band.sh`（独立 CLI，便于脚本化/CI/ralph 集成）；
- 提供一个 skill 包装（后续）仅负责调用 CLI，不承载状态机逻辑；
- hooks 先用于硬约束（可选增强），不让 hooks 承担完整编排。

---

## 复用现有代码（避免重复造轮子）
优先复用 `ralph.sh` 已验证的模式：
- 参数解析模式：`ralph.sh` 参数段（约 `ralph.sh:11-35`）
- 运行状态文件约定：`prd.json/progress.txt/archive/.last-branch`（约 `ralph.sh:37-83`）
- 迭代控制主循环：`for i in ...` + 每轮执行（约 `ralph.sh:88-114`）

要替换的是“完成判定策略”（约 `ralph.sh:103-110`），从单 token 升级到三重门。

---

## 关键文件改动计划

1. **新增** `gold-band.sh`
   - 职责：DSL 解析、step 调度、重试、三重门、状态落盘。

2. **新增** `workflows/specdd-basic.json`
   - 职责：MVP 示例 workflow（设计→规划→开发→编译→测试）。

3. **新增** `schemas/workflow.schema.json`
   - 职责：约束 workflow DSL 结构，启动前校验。

4. **新增** `schemas/step-output.schema.json`（或按 step 拆分）
   - 职责：约束 worker/verifier 输出结构。

5. **新增** `prompts/worker.md`、`prompts/verifier.md`
   - 职责：统一模板，减少每步 prompt 漂移。

6. **修改** `ralph.sh`
   - 保留现有入口兼容；新增一个模式/参数将执行委托给 `gold-band.sh`。
   - 原 `<promise>COMPLETE</promise>` 路径保留为兼容模式（非默认）。

7. **新增** `gold-band.skill.md`（或项目 skill 配置文件）
   - 职责：提供 Claude Code 内一键调用 runner 的入口。

---

## 分阶段落地步骤

### Phase A：Runner 骨架与 DSL 校验
- 实现 `gold-band.sh` 的基础参数（workflow 路径、max-iterations、dry-run）。
- 用 `jq` 校验 `workflow.schema.json`。
- 跑通按顺序执行 steps（先不并行，不做复杂分支）。

### Phase B：Worker 执行与结构化产物
- 每个 step 调 `claude -p --output-format json --json-schema`。
- 记录 `runs/<run-id>/steps/<step-id>.json`。

### Phase C：Objective 检查 + Retry
- 实现最小检查器：`exit_code`、`file_exists`、`contains_text`、`jsonpath_exists`。
- 实现 `retry.max_attempts/backoff_sec`。

### Phase D：Verifier 集成（三重门闭环）
- 同步执行 verifier step（独立 prompt，独立 schema）。
- 仅当 worker+objective+verifier 全通过才置为 passed。

### Phase E：兼容与入口
- `ralph.sh` 增加委托模式。
- 增加 skill 包装入口，确保 Claude Code 内可直接触发 Gold Band。

---

## 风险与控制
- **风险：DSL 快速膨胀变复杂**
  控制：MVP 仅支持顺序步骤 + depends_on + retry，不做并行图和动态路由。

- **风险：verifier 与 worker同源偏差**
  控制：独立 verifier 模板、独立输出 schema、要求输出“未完成证据”。

- **风险：shell 解析脆弱**
  控制：只支持 JSON DSL + jq 校验，避免首版引入 YAML 解析依赖。

- **风险：上下文再次膨胀**
  控制：每 step 仅注入必要上下文与产物引用，不拼接完整历史对话。

---

## 验证方案（端到端）

1. **静态与语法校验**
   - `bash -n gold-band.sh`
   - `jq -e` 校验 workflow 与 schema 一致性

2. **功能冒烟（本地）**
   - 用 `workflows/specdd-basic.json` 跑一次完整流程；
   - 观察 step 状态文件是否按 `pending -> running -> passed/failed` 正确流转。

3. **反例验证（防撒谎）**
   - 构造“worker 声称完成但 objective 检查不通过”的 case，确认 workflow 不会误判完成。

4. **verifier 拦截验证**
   - 构造“worker+objective 通过但 verifier 发现遗漏”的 case，确认最终仍失败并给出缺口。

5. **兼容性验证**
   - 通过 `ralph.sh` 新模式调用 Gold Band，确认旧入口可用。

6. **Claude Code 集成验证**
   - 通过 skill 入口触发一次 runner，确认参数传递与执行日志完整。

---

## MVP 完成标准（验收）
- 可用 JSON DSL 定义并执行至少一个完整 specdd 工作流；
- 默认完成判定已改为三重门；
- `ralph.sh` 可兼容调用 Gold Band；
- 在 Claude Code 中可通过 skill 触发 runner；
- 至少有 1 个成功案例 + 2 个失败拦截案例（objective 拦截、verifier 拦截）。