use camino::Utf8PathBuf;
use gold_band::app::App;
use gold_band::console::controller::{activate_current, escape, move_down, move_right};
use gold_band::console::state::{ConsoleState, DetailLevel, DetailSelection, FocusPane, WelcomeAction, WorkspaceSelection};
use gold_band::console::view_models::build_view_model;
use tempfile::tempdir;

fn seed_branching_repo(repo_root: &Utf8PathBuf) {
    std::fs::create_dir_all(
        repo_root
            .join(".gold-band/tasks/task-001/authoring")
            .as_std_path(),
    )
    .unwrap();
    std::fs::create_dir_all(
        repo_root
            .join(".gold-band/tasks/task-001/runs/run-001/rounds/round-001/nodes/dev/attempt-001/artifacts")
            .as_std_path(),
    )
    .unwrap();
    std::fs::create_dir_all(
        repo_root
            .join(".gold-band/tasks/task-001/runs/run-001/rounds/round-001/nodes/dev/attempt-001/attachments")
            .as_std_path(),
    )
    .unwrap();
    std::fs::write(
        repo_root.join(".gold-band/tasks/task-001/task.json").as_std_path(),
        r#"{"version":"0.1","id":"task-001","title":"Task One","description":"branching workflow"}"#,
    )
    .unwrap();
    std::fs::write(
        repo_root.join(".gold-band/tasks/task-001/authoring/workflow.json").as_std_path(),
        r#"{"version":"0.1","id":"full-flow","entry":"dev","control":{"max_repair_loops":1,"max_acceptance_loops":1,"on_acceptance_failure":"stop"},"nodes":[{"type":"worker","id":"dev","provider":"claude-code","profile":"developer","primary_artifact":"exec-plan"},{"type":"exec","id":"run-cmd","plan_from":"dev"},{"type":"verify","id":"accept","provider":"claude-code","profile":"developer"}],"edges":[{"from":"dev","to":"run-cmd","on":"success"},{"from":"dev","to":"accept","on":"failure"},{"from":"run-cmd","to":"accept","on":"invalid"}]}"#,
    )
    .unwrap();
    std::fs::write(
        repo_root.join(".gold-band/tasks/task-001/runs/run-001/run.json").as_std_path(),
        r#"{"version":"0.1","id":"run-001","task_id":"task-001","status":"paused","outcome":null,"started_at":"2026-03-30T10:00:00Z","updated_at":"2026-03-30T10:01:00Z","workflow_snapshot":"workflow.snapshot.json","current_round":"round-001","current_node":"dev","current_attempt":"attempt-001","acceptance_loops_used":0,"pause_reason":"process-interrupted"}"#,
    )
    .unwrap();
    std::fs::write(
        repo_root.join(".gold-band/tasks/task-001/runs/run-001/rounds/round-001/round.json").as_std_path(),
        r#"{"version":"0.1","id":"round-001","run_id":"run-001","index":1,"status":"paused","outcome":null,"trigger":"initial","repair_loops_used":0,"started_at":"2026-03-30T10:00:00Z"}"#,
    )
    .unwrap();
    std::fs::write(
        repo_root.join(".gold-band/tasks/task-001/runs/run-001/rounds/round-001/nodes/dev/attempt-001/node.json").as_std_path(),
        r#"{"version":"0.1","node_id":"dev","node_type":"worker","run_id":"run-001","round_id":"round-001","attempt_id":"attempt-001","status":"paused","outcome":null,"started_at":"2026-03-30T10:00:00Z","finished_at":null,"resolved_config":{}}"#,
    )
    .unwrap();
    std::fs::write(
        repo_root
            .join(".gold-band/tasks/task-001/runs/run-001/rounds/round-001/nodes/dev/attempt-001/artifacts/exec-result.json")
            .as_std_path(),
        "result-body",
    )
    .unwrap();
    std::fs::write(
        repo_root
            .join(".gold-band/tasks/task-001/runs/run-001/rounds/round-001/nodes/dev/attempt-001/attachments/stdout.txt")
            .as_std_path(),
        "stdout-body",
    )
    .unwrap();
}

fn open_workspace(app: &App) -> ConsoleState {
    let mut state = ConsoleState::default();
    state.welcome_action = WelcomeAction::SelectTask;
    activate_current(app, &mut state).unwrap();
    activate_current(app, &mut state).unwrap();
    state
}

#[test]
fn workspace_renders_dag_with_edge_markers() {
    let temp = tempdir().unwrap();
    let repo_root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    seed_branching_repo(&repo_root);
    let app = App::new(repo_root);
    let state = open_workspace(&app);
    let vm = build_view_model(&app, &state).unwrap();
    let dag = vm.body_lines.join("\n");
    assert!(dag.contains("dev"));
    assert!(dag.contains("run-cmd"));
    assert!(dag.contains("accept"));
}

#[test]
fn entering_node_moves_focus_to_detail_and_shows_attempts() {
    let temp = tempdir().unwrap();
    let repo_root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    seed_branching_repo(&repo_root);
    let app = App::new(repo_root);
    let mut state = open_workspace(&app);
    activate_current(&app, &mut state).unwrap();
    assert_eq!(state.focus, FocusPane::Detail);
    let workspace = state.workspace.as_ref().unwrap();
    assert_eq!(workspace.detail_level, DetailLevel::NodeHome);
    assert!(workspace.detail_items.iter().any(|item| matches!(item, DetailSelection::Attempt { .. })));
}

#[test]
fn entering_attempt_then_artifact_supports_escape_backtracking() {
    let temp = tempdir().unwrap();
    let repo_root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    seed_branching_repo(&repo_root);
    let app = App::new(repo_root);
    let mut state = open_workspace(&app);
    activate_current(&app, &mut state).unwrap();
    move_down(&mut state);
    activate_current(&app, &mut state).unwrap();
    {
        let workspace = state.workspace.as_ref().unwrap();
        assert!(matches!(workspace.detail_level, DetailLevel::AttemptItems { .. }));
    }
    activate_current(&app, &mut state).unwrap();
    {
        let workspace = state.workspace.as_ref().unwrap();
        assert_eq!(workspace.detail_level, DetailLevel::Content);
    }
    escape(&app, &mut state).unwrap();
    {
        let workspace = state.workspace.as_ref().unwrap();
        assert!(matches!(workspace.detail_level, DetailLevel::AttemptItems { .. }));
    }
    escape(&app, &mut state).unwrap();
    {
        let workspace = state.workspace.as_ref().unwrap();
        assert_eq!(workspace.detail_level, DetailLevel::NodeHome);
    }
}

#[test]
fn dag_navigation_moves_between_columns() {
    let temp = tempdir().unwrap();
    let repo_root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    seed_branching_repo(&repo_root);
    let app = App::new(repo_root);
    let mut state = open_workspace(&app);
    move_right(&mut state);
    let workspace = state.workspace.as_ref().unwrap();
    assert!(matches!(workspace.selection, WorkspaceSelection::Node { .. }));
}
