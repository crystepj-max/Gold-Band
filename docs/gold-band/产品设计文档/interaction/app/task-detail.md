# 任务编排：任务详情页（已并入任务工作流页）

## 1. 当前结论

任务详情页不再作为桌面端任务编排 MVP 的独立页面出现。

原任务详情页承担的内容已经并入 [任务工作流页](task-workflow.md)：
- task id / title
- requirement 摘要
- 当前状态
- workflow 校验状态
- active run / resumable run
- 新建 run / 继续运行 / 停止运行入口

---

## 2. 调整原因

任务编排功能区采用多级递进设计，但主路径应保持清晰：

```text
任务列表 -> 任务工作流 -> Round 详情
```

如果在任务列表和工作流之间保留独立任务详情页，用户需要多一次跳转才能看到 workflow 全貌和 run -> round 执行历史，和当前桌面端核心目标不一致。

---

## 3. 当前页面归属

| 原任务详情能力 | 当前归属 |
|---|---|
| requirement 摘要 | 任务工作流页顶部 task context |
| 完整 requirement 查看 | 任务工作流页后续增强入口 |
| 当前状态 | 任务列表行、Task Preview、任务工作流页指标条 |
| 最近 run | 任务工作流页 run -> round 列表 |
| 新建 run / 继续 run | 任务工作流页顶部操作 |
| 查看失败详情 | Round 详情页 |

---

## 4. MVP 实现说明

`web/src/pages/TaskDetailPage.tsx` 和 `get_task_detail` 可暂时保留用于历史对比或后续 authoring 能力，但主导航状态机不再进入 `task-detail`。

当前 MVP 主页面为：
- `web/src/pages/TaskListPage.tsx`
- `web/src/pages/WorkflowPage.tsx`
- `web/src/pages/RoundDetailPage.tsx`

---

## 5. 一句话总结

> 任务详情页已经合并到任务工作流页，用户从任务列表直接进入 workflow 视角，再下钻到 Round 详情。
