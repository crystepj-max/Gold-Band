use std::collections::{BTreeMap, VecDeque};

use anyhow::{anyhow, Result};
use crate::app::{App, TaskSummary};
use crate::dsl::{validate_workflow, EdgeOutcome, WorkflowDsl};
use crate::inspect::render_console_banner;
use crate::runtime::RunState;

use super::state::{
    CommandViewKind, ConsoleState, DetailLevel, DetailSelection, FocusPane, Screen, WelcomeAction, WorkspaceSelection,
    WorkspaceState,
};

pub struct ConsoleViewModel {
    pub header: String,
    pub body_title: String,
    pub body_lines: Vec<String>,
    pub detail_title: String,
    pub detail_body: String,
    pub show_detail: bool,
    pub input_title: String,
    pub input: String,
    pub input_hint: String,
    pub footer: String,
}

pub fn build_view_model(app: &App, state: &ConsoleState) -> Result<ConsoleViewModel> {
    match state.screen {
        Screen::Welcome => build_welcome_view_model(state),
        Screen::TaskPicker => build_task_picker_view_model(state),
        Screen::Workspace => build_workspace_view_model(app, state),
    }
}

pub fn build_workspace_state(app: &App, task_summary: TaskSummary) -> Result<WorkspaceState> {
    let workflow_path = app.paths.workflow_file(&task_summary.task.id);
    let workflow = if workflow_path.exists() {
        Some(crate::storage::read_json::<WorkflowDsl>(&workflow_path)?)
    } else {
        None
    };
    let dag_positions = workflow
        .as_ref()
        .and_then(|workflow| validate_workflow(workflow.clone()).ok())
        .map(|validated| dag_columns(&validated.raw))
        .unwrap_or_default();
    let selection = dag_positions
        .first()
        .and_then(|column| column.first())
        .map(|node_id| WorkspaceSelection::Node { node_id: node_id.clone() })
        .unwrap_or(WorkspaceSelection::TaskOverview);
    let active_run_id = task_summary.suggested_run_id.clone();
    let selected_round_id = active_run_id
        .as_ref()
        .and_then(|run_id| app.run_status(&task_summary.task.id, run_id).ok())
        .and_then(|run| run.current_round);
    let mut workspace = WorkspaceState {
        task_id: task_summary.task.id.clone(),
        task_summary,
        active_run_id,
        selected_round_id,
        selection,
        dag_positions,
        dag_column: 0,
        dag_row: 0,
        detail_level: DetailLevel::NodeHome,
        detail_items: Vec::new(),
        detail_index: 0,
        detail_scroll: 0,
        command_view: None,
    };
    sync_workspace_detail(app, &mut workspace)?;
    Ok(workspace)
}

pub fn sync_workspace_detail(app: &App, workspace: &mut WorkspaceState) -> Result<()> {
    workspace.detail_items = match (&workspace.selection, &workspace.detail_level) {
        (WorkspaceSelection::Node { .. }, DetailLevel::NodeHome) => build_node_home_items(app, workspace)?,
        (WorkspaceSelection::Node { .. }, DetailLevel::AttemptItems { attempt_id }) => {
            build_attempt_items(app, workspace, attempt_id)?
        }
        _ => Vec::new(),
    };
    if workspace.detail_index >= workspace.detail_items.len() {
        workspace.detail_index = workspace.detail_items.len().saturating_sub(1);
    }
    Ok(())
}

fn build_welcome_view_model(state: &ConsoleState) -> Result<ConsoleViewModel> {
    let mut body_lines = vec![
        "".to_string(),
        "  ─────────────────────────────────────────────".to_string(),
    ];
    body_lines.extend(render_console_banner().lines().map(|line| line.to_string()));
    body_lines.push("  ─────────────────────────────────────────────".to_string());
    body_lines.push(String::new());
    body_lines.push("  workflow-first runtime console".to_string());
    body_lines.push(String::new());
    body_lines.push(format!("  {}", welcome_line(state, WelcomeAction::AddTask, "新增 task（本期占位）")));
    body_lines.push(format!("  {}", welcome_line(state, WelcomeAction::SelectTask, "选择现有 task")));
    Ok(ConsoleViewModel {
        header: "Gold Band Console".to_string(),
        body_title: pane_title("Welcome", state.focus == FocusPane::Welcome),
        body_lines,
        detail_title: String::new(),
        detail_body: String::new(),
        show_detail: false,
        input_title: pane_title("Command Bar", state.focus == FocusPane::Input),
        input: state.input.clone(),
        input_hint: "/help   /task   /log   /config".to_string(),
        footer: "Enter: select   Tab: focus   Esc: quit".to_string(),
    })
}

fn build_task_picker_view_model(state: &ConsoleState) -> Result<ConsoleViewModel> {
    let body_lines = if state.task_list.is_empty() {
        vec!["No task-* directories found under .gold-band/tasks".to_string()]
    } else {
        state
            .task_list
            .iter()
            .enumerate()
            .map(|(index, summary)| {
                let cursor = if index == state.task_index { '>' } else { ' ' };
                let desc = summary.task.description.as_deref().unwrap_or("");
                let workflow = if summary.workflow_valid {
                    "workflow: ok".to_string()
                } else if summary.workflow_exists {
                    format!("workflow: invalid ({})", summary.workflow_error.as_deref().unwrap_or("unknown"))
                } else {
                    "workflow: missing".to_string()
                };
                let run_hint = summary
                    .suggested_run_id
                    .as_ref()
                    .map(|run_id| format!("run: {run_id}"))
                    .unwrap_or_else(|| "run: none".to_string());
                format!("{cursor} {} | {} | {} | {}", summary.task.id, desc, workflow, run_hint)
            })
            .collect()
    };
    Ok(ConsoleViewModel {
        header: format!("Gold Band Console • tasks discovered: {}", state.task_list.len()),
        body_title: pane_title("Task Picker", state.focus == FocusPane::TaskPicker),
        body_lines,
        detail_title: String::new(),
        detail_body: String::new(),
        show_detail: false,
        input_title: pane_title("Command Bar", state.focus == FocusPane::Input),
        input: state.input.clone(),
        input_hint: "/help   /task   /log   /config".to_string(),
        footer: "↑/↓: move   Enter: open task   Esc: back   Tab: focus".to_string(),
    })
}

fn build_workspace_view_model(app: &App, state: &ConsoleState) -> Result<ConsoleViewModel> {
    let workspace = state.workspace.as_ref().ok_or_else(|| anyhow!("workspace missing"))?;
    let show_overlay = workspace.command_view.is_some();
    let body_lines = if show_overlay {
        vec!["Command view active — Esc back".to_string()]
    } else {
        render_workspace_dag(app, workspace)?
    };
    let detail_body = render_detail_panel(app, workspace, &state.command_suggestions)?;
    Ok(ConsoleViewModel {
        header: render_workspace_header(workspace),
        body_title: pane_title(if show_overlay { "Workspace" } else { "Workflow" }, state.focus == FocusPane::Dag),
        body_lines,
        detail_title: pane_title(if show_overlay { "Overlay" } else { "Details" }, state.focus == FocusPane::Detail),
        detail_body,
        show_detail: true,
        input_title: pane_title("Command Bar", state.focus == FocusPane::Input),
        input: state.input.clone(),
        input_hint: "/task   /log   /config   /continue   /help".to_string(),
        footer: if show_overlay {
            "Esc: back   Tab: focus".to_string()
        } else {
            "DAG: ←→↑↓   Enter: open   Esc: back   Tab: focus".to_string()
        },
    })
}

fn render_workspace_header(workspace: &WorkspaceState) -> String {
    let task = &workspace.task_summary.task;
    let desc = task.description.as_deref().unwrap_or("");
    let workflow = if workspace.task_summary.workflow_valid {
        "workflow=ok".to_string()
    } else if workspace.task_summary.workflow_exists {
        format!("workflow=invalid({})", workspace.task_summary.workflow_error.as_deref().unwrap_or("unknown"))
    } else {
        "workflow=missing".to_string()
    };
    let run = workspace.active_run_id.as_deref().unwrap_or("none");
    let restore = workspace.task_summary.resumable_run_id.as_deref().unwrap_or("none");
    format!("Task: {}\n{}\n[run: {}] [resumable: {}] [{}]", task.id, desc, run, restore, workflow)
}

fn render_workspace_dag(app: &App, workspace: &WorkspaceState) -> Result<Vec<String>> {
    if workspace.dag_positions.is_empty() {
        return Ok(vec!["No valid workflow graph available".to_string()]);
    }
    let workflow: WorkflowDsl = crate::storage::read_json(&app.paths.workflow_file(&workspace.task_id))?;
    let active_run = workspace
        .active_run_id
        .as_ref()
        .and_then(|run_id| app.run_status(&workspace.task_id, run_id).ok());
    let max_rows = workspace.dag_positions.iter().map(|column| column.len()).max().unwrap_or(0);
    let mut grid = vec![vec![String::new(); workspace.dag_positions.len()]; max_rows.max(1)];
    for (column_index, column) in workspace.dag_positions.iter().enumerate() {
        for (row_index, node_id) in column.iter().enumerate() {
            let selected = matches!(&workspace.selection, WorkspaceSelection::Node { node_id: selected } if selected == node_id);
            let cursor = if workspace.dag_column == column_index && workspace.dag_row == row_index && selected { '>' } else if selected { '*' } else { ' ' };
            let status = node_status_label(active_run.as_ref(), node_id);
            grid[row_index][column_index] = format!("{}[{} {}]", cursor, node_id, status);
        }
    }

    let mut lines = Vec::new();
    for row in 0..max_rows {
        let mut line = String::new();
        for column_index in 0..workspace.dag_positions.len() {
            let node_cell = pad_cell(&grid[row][column_index]);
            line.push_str(&node_cell);
            if column_index + 1 < workspace.dag_positions.len() {
                line.push_str(&render_edge_between(&workflow, workspace, row, column_index));
            }
        }
        lines.push(line.trim_end().to_string());
    }
    Ok(lines)
}

fn render_edge_between(workflow: &WorkflowDsl, workspace: &WorkspaceState, row: usize, column_index: usize) -> String {
    let Some(from) = workspace.dag_positions.get(column_index).and_then(|column| column.get(row)) else {
        return "     ".to_string();
    };
    let Some(next_column) = workspace.dag_positions.get(column_index + 1) else {
        return "     ".to_string();
    };
    let mut markers = next_column
        .iter()
        .filter_map(|candidate| {
            workflow
                .edges
                .iter()
                .find(|edge| edge.from == *from && edge.to == *candidate)
                .map(|edge| format!("{}{}", edge_symbol(edge.on), candidate))
        })
        .collect::<Vec<_>>();
    if markers.is_empty() {
        "     ".to_string()
    } else {
        markers.sort();
        format!(" --{}--> ", markers.join("/"))
    }
}

fn render_detail_panel(app: &App, workspace: &WorkspaceState, command_suggestions: &[String]) -> Result<String> {
    if let Some((kind, body)) = &workspace.command_view {
        let title = match kind {
            CommandViewKind::Help => "Help",
            CommandViewKind::Log => "Runtime Log",
            CommandViewKind::Config => "Runtime Config",
            CommandViewKind::ContinueResult => "Continue Result",
            CommandViewKind::RuntimeCommand => "Command Result",
        };
        return Ok(format!("{}\n\n{}", title, body));
    }

    let body = match (&workspace.selection, &workspace.detail_level) {
        (WorkspaceSelection::TaskOverview, _) => Ok(render_task_summary(&workspace.task_summary)),
        (WorkspaceSelection::Node { node_id }, DetailLevel::NodeHome) => render_node_home(app, workspace, node_id),
        (WorkspaceSelection::Node { node_id }, DetailLevel::AttemptItems { attempt_id }) => {
            render_attempt_items(app, workspace, node_id, attempt_id)
        }
        (WorkspaceSelection::Node { node_id }, DetailLevel::Content) => render_content_view(app, workspace, node_id),
        _ => Ok(String::new()),
    }?;

    if command_suggestions.is_empty() {
        Ok(body)
    } else {
        Ok(format!("{}\n\nCommands\n{}", body, command_suggestions.iter().map(|item| format!("- {}", item)).collect::<Vec<_>>().join("\n")))
    }
}

fn render_task_summary(summary: &TaskSummary) -> String {
    let task = &summary.task;
    let title = task.title.as_deref().unwrap_or(task.id.as_str());
    let description = task.description.as_deref().unwrap_or("(no description)");
    let workflow = if summary.workflow_valid {
        "valid".to_string()
    } else if summary.workflow_exists {
        format!("invalid: {}", summary.workflow_error.as_deref().unwrap_or("unknown"))
    } else {
        "missing authoring/workflow.json".to_string()
    };
    let latest_run = summary
        .latest_run
        .as_ref()
        .map(|run| format!("{} ({:?})", run.id, run.status))
        .unwrap_or_else(|| "none".to_string());
    let resumable = summary.resumable_run_id.as_deref().unwrap_or("none");
    format!(
        "Task: {}\nTitle: {}\nDescription: {}\nWorkflow: {}\nLatest run: {}\nResumable run: {}",
        task.id, title, description, workflow, latest_run, resumable
    )
}

fn render_node_home(app: &App, workspace: &WorkspaceState, node_id: &str) -> Result<String> {
    let Some(run_id) = workspace.active_run_id.as_ref() else {
        return Ok(format!("Node: {}\nNo active run", node_id));
    };
    let Some(round_id) = workspace.selected_round_id.as_ref() else {
        return Ok(format!("Node: {}\nNo active round", node_id));
    };
    let workflow: WorkflowDsl = crate::storage::read_json(&app.paths.workflow_file(&workspace.task_id))?;
    let summary = app.node_runtime_summary(&workspace.task_id, run_id, round_id, &workflow, node_id)?;
    let mut lines = vec![format!("Node: {}", node_id), String::new(), "Attempts".to_string()];
    for (index, item) in workspace.detail_items.iter().enumerate() {
        match item {
            DetailSelection::RetryAction => {
                let marker = if workspace.detail_index == index { ">" } else { " " };
                lines.push(format!("{} retry current node", marker));
            }
            DetailSelection::Attempt { attempt_id } => {
                let marker = if workspace.detail_index == index { ">" } else { " " };
                let status = summary
                    .attempts
                    .iter()
                    .find(|attempt| &attempt.attempt_id == attempt_id)
                    .map(|attempt| format!("{:?}", attempt.status))
                    .unwrap_or_else(|| "unknown".to_string());
                lines.push(format!("{} {} [{}]", marker, attempt_id, status));
            }
            _ => {}
        }
    }
    if !summary.outgoing_edges.is_empty() {
        lines.push(String::new());
        lines.push("Outgoing".to_string());
        for edge in summary.outgoing_edges {
            lines.push(format!("- {} {}", edge_symbol(edge.on), edge.to));
        }
    }
    Ok(lines.join("\n"))
}

fn render_attempt_items(app: &App, workspace: &WorkspaceState, node_id: &str, attempt_id: &str) -> Result<String> {
    let Some(run_id) = workspace.active_run_id.as_ref() else {
        return Ok("No active run".to_string());
    };
    let Some(round_id) = workspace.selected_round_id.as_ref() else {
        return Ok("No active round".to_string());
    };
    let attempt = app
        .attempt_list(&workspace.task_id, run_id, round_id, node_id)?
        .into_iter()
        .find(|attempt| attempt.attempt_id == attempt_id)
        .ok_or_else(|| anyhow!("attempt not found"))?;
    let mut lines = vec![
        format!("Attempt: {}", attempt_id),
        format!("Status: {:?}", attempt.status),
        format!("Started: {}", attempt.started_at),
        format!("Finished: {:?}", attempt.finished_at),
        String::new(),
        "Items".to_string(),
    ];
    for (index, item) in workspace.detail_items.iter().enumerate() {
        let marker = if workspace.detail_index == index { ">" } else { " " };
        match item {
            DetailSelection::Artifact { name, .. } => lines.push(format!("{} artifact {}", marker, name)),
            DetailSelection::Attachment { name, .. } => lines.push(format!("{} attachment {}", marker, name)),
            _ => {}
        }
    }
    Ok(lines.join("\n"))
}

fn render_content_view(app: &App, workspace: &WorkspaceState, node_id: &str) -> Result<String> {
    let Some(run_id) = workspace.active_run_id.as_ref() else {
        return Ok("No active run".to_string());
    };
    let Some(round_id) = workspace.selected_round_id.as_ref() else {
        return Ok("No active round".to_string());
    };
    let Some(item) = workspace.detail_items.get(workspace.detail_index) else {
        return Ok("No content selected".to_string());
    };
    match item {
        DetailSelection::Artifact { attempt_id, name } => app.artifact_show(&workspace.task_id, run_id, round_id, node_id, attempt_id, name),
        DetailSelection::Attachment { attempt_id, name } => app.attachment_show(&workspace.task_id, run_id, round_id, node_id, attempt_id, name),
        _ => Ok("No content selected".to_string()),
    }
}

fn build_node_home_items(app: &App, workspace: &WorkspaceState) -> Result<Vec<DetailSelection>> {
    let WorkspaceSelection::Node { node_id } = &workspace.selection else {
        return Ok(Vec::new());
    };
    let Some(run_id) = workspace.active_run_id.as_ref() else {
        return Ok(Vec::new());
    };
    let Some(round_id) = workspace.selected_round_id.as_ref() else {
        return Ok(Vec::new());
    };
    let attempts = app.attempt_list(&workspace.task_id, run_id, round_id, node_id)?;
    let mut items = vec![DetailSelection::RetryAction];
    items.extend(attempts.into_iter().rev().map(|attempt| DetailSelection::Attempt {
        attempt_id: attempt.attempt_id,
    }));
    Ok(items)
}

fn build_attempt_items(app: &App, workspace: &WorkspaceState, attempt_id: &str) -> Result<Vec<DetailSelection>> {
    let WorkspaceSelection::Node { node_id } = &workspace.selection else {
        return Ok(Vec::new());
    };
    let Some(run_id) = workspace.active_run_id.as_ref() else {
        return Ok(Vec::new());
    };
    let Some(round_id) = workspace.selected_round_id.as_ref() else {
        return Ok(Vec::new());
    };
    let mut items = app
        .artifact_list(&workspace.task_id, run_id, round_id, node_id, attempt_id)?
        .into_iter()
        .map(|name| DetailSelection::Artifact {
            attempt_id: attempt_id.to_string(),
            name: name.trim_end_matches(".json").to_string(),
        })
        .collect::<Vec<_>>();
    items.extend(
        app.attachment_list(&workspace.task_id, run_id, round_id, node_id, attempt_id)?
            .into_iter()
            .map(|name| DetailSelection::Attachment {
                attempt_id: attempt_id.to_string(),
                name,
            }),
    );
    Ok(items)
}

fn node_status_label(active_run: Option<&RunState>, node_id: &str) -> &'static str {
    let Some(run) = active_run else {
        return "idle";
    };
    if run.current_node.as_deref() == Some(node_id) {
        return "current";
    }
    match run.status {
        crate::domain::RunStatus::Completed => "done",
        crate::domain::RunStatus::Paused => "paused",
        crate::domain::RunStatus::Running => "seen",
    }
}

fn dag_columns(workflow: &WorkflowDsl) -> Vec<Vec<String>> {
    let mut adjacency = BTreeMap::<String, Vec<String>>::new();
    let mut indegree = BTreeMap::<String, usize>::new();
    for node in &workflow.nodes {
        adjacency.entry(node.id().to_string()).or_default();
        indegree.entry(node.id().to_string()).or_insert(0);
    }
    for edge in &workflow.edges {
        if edge.to == crate::dsl::END_NODE {
            continue;
        }
        adjacency.entry(edge.from.clone()).or_default().push(edge.to.clone());
        *indegree.entry(edge.to.clone()).or_insert(0) += 1;
    }
    let mut queue = VecDeque::new();
    queue.push_back(workflow.entry.clone());
    let mut depth = BTreeMap::<String, usize>::new();
    depth.insert(workflow.entry.clone(), 0);
    while let Some(node_id) = queue.pop_front() {
        let current_depth = depth.get(&node_id).copied().unwrap_or(0);
        if let Some(targets) = adjacency.get(&node_id) {
            for target in targets {
                let next_depth = current_depth + 1;
                let entry = depth.entry(target.clone()).or_insert(next_depth);
                if next_depth > *entry {
                    *entry = next_depth;
                }
                queue.push_back(target.clone());
            }
        }
    }
    let mut columns = BTreeMap::<usize, Vec<String>>::new();
    for node in &workflow.nodes {
        let column = depth.get(node.id()).copied().unwrap_or(0);
        columns.entry(column).or_default().push(node.id().to_string());
    }
    columns.into_values().collect()
}

fn welcome_line(state: &ConsoleState, action: WelcomeAction, label: &str) -> String {
    let marker = if state.welcome_action == action { '>' } else { ' ' };
    format!("{} {}", marker, label)
}

fn pad_cell(cell: &str) -> String {
    format!("{cell:<20}")
}

fn edge_symbol(outcome: EdgeOutcome) -> &'static str {
    match outcome {
        EdgeOutcome::Success => "√",
        EdgeOutcome::Failure => "×",
        EdgeOutcome::Invalid => "？",
    }
}

fn pane_title(title: &str, focused: bool) -> String {
    if focused {
        format!("{} *", title)
    } else {
        title.to_string()
    }
}
