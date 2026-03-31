use anyhow::{anyhow, Result};
use serde_json::to_string_pretty;

use crate::app::App;
use crate::command::execute::execute_command;
use crate::command::{Command, CommandResult, RunCommand};
use crate::inspect::{render_console_help, render_run_help};

use super::commands::{parse_console_command, suggest_console_commands, ConsoleLocalCommand, ParsedConsoleCommand};
use super::state::{
    CommandViewKind, ConsoleState, DetailLevel, DetailSelection, FocusPane, Screen, WelcomeAction, WorkspaceSelection,
};
use super::view_models::{build_view_model, build_workspace_state, sync_workspace_detail};

pub fn submit_input(app: &App, state: &mut ConsoleState) -> Result<()> {
    let input = state.input.trim().to_string();
    let parsed = parse_console_command(&input)?;
    state.history.push(input.clone());
    state.command_suggestions.clear();

    match parsed {
        ParsedConsoleCommand::Local(command) => apply_local_command(app, state, command),
        ParsedConsoleCommand::Runtime(command) => apply_runtime_command(app, state, command),
    }
}

pub fn refresh_command_suggestions(state: &mut ConsoleState) {
    state.command_suggestions = suggest_console_commands(&state.input);
}

pub fn cycle_focus(state: &mut ConsoleState) {
    state.focus = match state.screen {
        Screen::Welcome => match state.focus {
            FocusPane::Welcome => FocusPane::Input,
            _ => FocusPane::Welcome,
        },
        Screen::TaskPicker => match state.focus {
            FocusPane::TaskPicker => FocusPane::Input,
            _ => FocusPane::TaskPicker,
        },
        Screen::Workspace => match state.focus {
            FocusPane::Dag => FocusPane::Detail,
            FocusPane::Detail => FocusPane::Input,
            _ => FocusPane::Dag,
        },
    };
}

pub fn move_up(state: &mut ConsoleState) {
    match state.screen {
        Screen::Welcome => {
            state.welcome_action = WelcomeAction::AddTask;
        }
        Screen::TaskPicker => {
            if state.task_index > 0 {
                state.task_index -= 1;
            }
        }
        Screen::Workspace => match state.focus {
            FocusPane::Dag => {
                if let Some(workspace) = state.workspace.as_mut() {
                    if workspace.dag_row > 0 {
                        workspace.dag_row -= 1;
                        sync_dag_selection(workspace);
                    }
                }
            }
            FocusPane::Detail => {
                if let Some(workspace) = state.workspace.as_mut() {
                    workspace.detail_index = workspace.detail_index.saturating_sub(1);
                }
            }
            _ => {}
        },
    }
}

pub fn move_down(state: &mut ConsoleState) {
    match state.screen {
        Screen::Welcome => {
            state.welcome_action = WelcomeAction::SelectTask;
        }
        Screen::TaskPicker => {
            if state.task_index + 1 < state.task_list.len() {
                state.task_index += 1;
            }
        }
        Screen::Workspace => match state.focus {
            FocusPane::Dag => {
                if let Some(workspace) = state.workspace.as_mut() {
                    if let Some(column) = workspace.dag_positions.get(workspace.dag_column) {
                        if workspace.dag_row + 1 < column.len() {
                            workspace.dag_row += 1;
                            sync_dag_selection(workspace);
                        }
                    }
                }
            }
            FocusPane::Detail => {
                if let Some(workspace) = state.workspace.as_mut() {
                    if workspace.detail_index + 1 < workspace.detail_items.len() {
                        workspace.detail_index += 1;
                    }
                }
            }
            _ => {}
        },
    }
}

pub fn move_left(state: &mut ConsoleState) {
    if state.screen != Screen::Workspace || state.focus != FocusPane::Dag {
        return;
    }
    if let Some(workspace) = state.workspace.as_mut() {
        if workspace.dag_column > 0 {
            workspace.dag_column -= 1;
            if let Some(column) = workspace.dag_positions.get(workspace.dag_column) {
                workspace.dag_row = workspace.dag_row.min(column.len().saturating_sub(1));
            }
            sync_dag_selection(workspace);
        }
    }
}

pub fn move_right(state: &mut ConsoleState) {
    if state.screen != Screen::Workspace || state.focus != FocusPane::Dag {
        return;
    }
    if let Some(workspace) = state.workspace.as_mut() {
        if workspace.dag_column + 1 < workspace.dag_positions.len() {
            workspace.dag_column += 1;
            if let Some(column) = workspace.dag_positions.get(workspace.dag_column) {
                workspace.dag_row = workspace.dag_row.min(column.len().saturating_sub(1));
            }
            sync_dag_selection(workspace);
        }
    }
}

pub fn activate_current(app: &App, state: &mut ConsoleState) -> Result<()> {
    match state.screen {
        Screen::Welcome => match state.welcome_action {
            WelcomeAction::AddTask => {
                state.message = Some("新增 task 本期暂未实现".to_string());
            }
            WelcomeAction::SelectTask => open_task_picker(app, state)?,
        },
        Screen::TaskPicker => open_selected_task(app, state)?,
        Screen::Workspace => match state.focus {
            FocusPane::Dag => open_selected_node(app, state)?,
            FocusPane::Detail => open_detail_selection(app, state)?,
            FocusPane::Input => {
                if !state.input.trim().is_empty() {
                    match submit_input(app, state) {
                        Ok(()) => state.input.clear(),
                        Err(err) => state.message = Some(err.to_string()),
                    }
                }
            }
            _ => {}
        },
    }
    Ok(())
}

pub fn escape(app: &App, state: &mut ConsoleState) -> Result<bool> {
    match state.screen {
        Screen::Welcome => Ok(true),
        Screen::TaskPicker => {
            state.screen = Screen::Welcome;
            state.focus = FocusPane::Welcome;
            state.command_suggestions.clear();
            Ok(false)
        }
        Screen::Workspace => {
            if let Some(workspace) = state.workspace.as_mut() {
                if workspace.command_view.is_some() {
                    workspace.command_view = None;
                    return Ok(false);
                }
                match workspace.detail_level {
                    DetailLevel::Content => {
                        if let Some(DetailSelection::Artifact { attempt_id, .. } | DetailSelection::Attachment { attempt_id, .. }) =
                            workspace.detail_items.get(workspace.detail_index).cloned()
                        {
                            workspace.detail_level = DetailLevel::AttemptItems { attempt_id };
                            sync_workspace_detail(app, workspace)?;
                        }
                        return Ok(false);
                    }
                    DetailLevel::AttemptItems { .. } => {
                        workspace.detail_level = DetailLevel::NodeHome;
                        sync_workspace_detail(app, workspace)?;
                        return Ok(false);
                    }
                    DetailLevel::NodeHome => {
                        if state.focus != FocusPane::Dag {
                            state.focus = FocusPane::Dag;
                            return Ok(false);
                        }
                    }
                    DetailLevel::CommandView => {
                        workspace.command_view = None;
                        workspace.detail_level = DetailLevel::NodeHome;
                        return Ok(false);
                    }
                }
            }
            state.screen = Screen::TaskPicker;
            state.focus = FocusPane::TaskPicker;
            state.workspace = None;
            state.task_list = app.task_summaries()?;
            Ok(false)
        }
    }
}

pub fn refresh_tick(app: &App, state: &mut ConsoleState) -> Result<()> {
    if !state.auto_refresh_enabled {
        return Ok(());
    }
    if state.screen == Screen::TaskPicker {
        state.task_list = app.task_summaries()?;
        if state.task_index >= state.task_list.len() {
            state.task_index = state.task_list.len().saturating_sub(1);
        }
    }
    state.last_refresh_label = Some("auto".to_string());
    Ok(())
}

fn apply_local_command(app: &App, state: &mut ConsoleState, command: ConsoleLocalCommand) -> Result<()> {
    match command {
        ConsoleLocalCommand::Help => show_command_view(app, state, CommandViewKind::Help, render_help_body(state)),
        ConsoleLocalCommand::Task => open_task_picker(app, state),
        ConsoleLocalCommand::Log => {
            let body = app.runtime_log_show()?.unwrap_or_else(|| "runtime log not found".to_string());
            show_command_view(app, state, CommandViewKind::Log, body)
        }
        ConsoleLocalCommand::Config => {
            let body = to_string_pretty(&app.config)?;
            show_command_view(app, state, CommandViewKind::Config, body)
        }
        ConsoleLocalCommand::Continue => continue_workspace_run(app, state),
    }
}

fn apply_runtime_command(app: &App, state: &mut ConsoleState, command: Command) -> Result<()> {
    let result = execute_command(app, command)?;
    let body = match result {
        CommandResult::Json(value) => to_string_pretty(&value)?,
        CommandResult::Text(text) => text,
    };
    if let Some(workspace) = state.workspace.as_mut() {
        workspace.command_view = Some((CommandViewKind::RuntimeCommand, body));
    } else {
        state.message = Some(body);
    }
    Ok(())
}

fn open_task_picker(app: &App, state: &mut ConsoleState) -> Result<()> {
    state.task_list = app.task_summaries()?;
    state.task_index = 0;
    state.screen = Screen::TaskPicker;
    state.focus = FocusPane::TaskPicker;
    state.command_suggestions.clear();
    Ok(())
}

fn open_selected_task(app: &App, state: &mut ConsoleState) -> Result<()> {
    let Some(summary) = state.task_list.get(state.task_index).cloned() else {
        return Ok(());
    };
    let workspace = build_workspace_state(app, summary)?;
    state.workspace = Some(workspace);
    state.screen = Screen::Workspace;
    state.focus = FocusPane::Dag;
    state.command_suggestions.clear();
    Ok(())
}

fn open_selected_node(app: &App, state: &mut ConsoleState) -> Result<()> {
    let Some(workspace) = state.workspace.as_mut() else {
        return Ok(());
    };
    workspace.detail_level = DetailLevel::NodeHome;
    workspace.command_view = None;
    sync_workspace_detail(app, workspace)?;
    state.focus = FocusPane::Detail;
    Ok(())
}

fn open_detail_selection(app: &App, state: &mut ConsoleState) -> Result<()> {
    let Some(workspace) = state.workspace.as_mut() else {
        return Ok(());
    };
    let Some(item) = workspace.detail_items.get(workspace.detail_index).cloned() else {
        return Ok(());
    };
    match item {
        DetailSelection::RetryAction => retry_selected_node(app, state),
        DetailSelection::Attempt { attempt_id } => {
            workspace.detail_level = DetailLevel::AttemptItems { attempt_id };
            workspace.detail_index = 0;
            sync_workspace_detail(app, workspace)
        }
        DetailSelection::Artifact { .. } | DetailSelection::Attachment { .. } => {
            workspace.detail_level = DetailLevel::Content;
            Ok(())
        }
    }
}

fn retry_selected_node(app: &App, state: &mut ConsoleState) -> Result<()> {
    let Some(workspace) = state.workspace.as_mut() else {
        return Ok(());
    };
    let Some(run_id) = workspace.active_run_id.clone() else {
        return Err(anyhow!("no active run to retry"));
    };
    let result = execute_command(
        app,
        Command::Run(RunCommand::Retry {
            task_id: workspace.task_id.clone(),
            run_id,
        }),
    )?;
    let body = match result {
        CommandResult::Json(value) => to_string_pretty(&value)?,
        CommandResult::Text(text) => text,
    };
    workspace.command_view = Some((CommandViewKind::RuntimeCommand, body));
    Ok(())
}

fn continue_workspace_run(app: &App, state: &mut ConsoleState) -> Result<()> {
    let Some(workspace) = state.workspace.as_mut() else {
        state.message = Some("No active workspace".to_string());
        return Ok(());
    };
    let Some(run_id) = workspace.active_run_id.clone() else {
        workspace.command_view = Some((CommandViewKind::ContinueResult, "No resumable run".to_string()));
        return Ok(());
    };
    let result = execute_command(
        app,
        Command::Run(RunCommand::Continue {
            task_id: workspace.task_id.clone(),
            run_id,
        }),
    )?;
    let body = match result {
        CommandResult::Json(value) => to_string_pretty(&value)?,
        CommandResult::Text(text) => text,
    };
    workspace.command_view = Some((CommandViewKind::ContinueResult, body));
    Ok(())
}

fn show_command_view(app: &App, state: &mut ConsoleState, kind: CommandViewKind, body: String) -> Result<()> {
    if let Some(workspace) = state.workspace.as_mut() {
        workspace.command_view = Some((kind, body));
        workspace.detail_level = DetailLevel::CommandView;
        state.focus = FocusPane::Detail;
    } else {
        state.message = Some(body);
        let _ = build_view_model(app, state)?;
    }
    Ok(())
}

fn render_help_body(state: &ConsoleState) -> String {
    if state.input.trim() == "/run --help" {
        render_run_help()
    } else {
        render_console_help()
    }
}

fn sync_dag_selection(workspace: &mut super::state::WorkspaceState) {
    if let Some(node_id) = workspace
        .dag_positions
        .get(workspace.dag_column)
        .and_then(|column| column.get(workspace.dag_row))
        .cloned()
    {
        workspace.selection = WorkspaceSelection::Node { node_id };
    }
}
