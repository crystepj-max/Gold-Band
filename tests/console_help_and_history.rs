use camino::Utf8PathBuf;
use gold_band::app::App;
use gold_band::console::controller::{activate_current, escape, move_down, submit_input};
use gold_band::console::state::{ConsoleState, FocusPane, Screen, WelcomeAction};
use gold_band::console::view_models::build_view_model;
use gold_band::inspect::render_console_banner;
use tempfile::tempdir;

#[test]
fn generated_banner_contains_multiple_lines() {
    let banner = render_console_banner();
    assert!(banner.lines().count() >= 3);
    assert!(!banner.trim().is_empty());
}

#[test]
fn welcome_screen_is_default_and_renders_primary_actions() {
    let temp = tempdir().unwrap();
    let repo_root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    let app = App::new(repo_root);
    let state = ConsoleState::default();
    let vm = build_view_model(&app, &state).unwrap();
    assert_eq!(state.screen, Screen::Welcome);
    assert_eq!(state.focus, FocusPane::Welcome);
    assert!(vm.body_lines.iter().any(|line| line.contains("新增 task")));
    assert!(vm.body_lines.iter().any(|line| line.contains("选择现有 task")));
    assert!(!vm.show_detail);
}

#[test]
fn welcome_select_existing_task_enters_task_picker() {
    let temp = tempdir().unwrap();
    let repo_root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    std::fs::create_dir_all(repo_root.join(".gold-band/tasks/task-001/authoring").as_std_path()).unwrap();
    std::fs::write(
        repo_root.join(".gold-band/tasks/task-001/task.json").as_std_path(),
        r#"{"version":"0.1","id":"task-001","description":"demo task"}"#,
    )
    .unwrap();
    std::fs::write(
        repo_root.join(".gold-band/tasks/task-001/authoring/workflow.json").as_std_path(),
        r#"{"version":"0.1","id":"full-flow","entry":"dev","control":{"max_repair_loops":1,"max_acceptance_loops":1,"on_acceptance_failure":"stop"},"nodes":[{"type":"worker","id":"dev","provider":"claude-code","profile":"developer"}],"edges":[]}"#,
    )
    .unwrap();
    let app = App::new(repo_root);
    let mut state = ConsoleState::default();
    state.welcome_action = WelcomeAction::SelectTask;
    activate_current(&app, &mut state).unwrap();
    assert_eq!(state.screen, Screen::TaskPicker);
    assert_eq!(state.task_list.len(), 1);
}

#[test]
fn slash_task_command_opens_task_picker() {
    let temp = tempdir().unwrap();
    let repo_root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    std::fs::create_dir_all(repo_root.join(".gold-band/tasks/task-001").as_std_path()).unwrap();
    std::fs::write(
        repo_root.join(".gold-band/tasks/task-001/task.json").as_std_path(),
        r#"{"version":"0.1","id":"task-001","description":"demo task"}"#,
    )
    .unwrap();
    let app = App::new(repo_root);
    let mut state = ConsoleState::default();
    state.focus = FocusPane::Input;
    state.input = "/task".to_string();
    submit_input(&app, &mut state).unwrap();
    assert_eq!(state.screen, Screen::TaskPicker);
}

#[test]
fn task_picker_selection_enters_workspace() {
    let temp = tempdir().unwrap();
    let repo_root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    std::fs::create_dir_all(repo_root.join(".gold-band/tasks/task-001/authoring").as_std_path()).unwrap();
    std::fs::write(
        repo_root.join(".gold-band/tasks/task-001/task.json").as_std_path(),
        r#"{"version":"0.1","id":"task-001","title":"Task One","description":"demo task"}"#,
    )
    .unwrap();
    std::fs::write(
        repo_root.join(".gold-band/tasks/task-001/authoring/workflow.json").as_std_path(),
        r#"{"version":"0.1","id":"full-flow","entry":"dev","control":{"max_repair_loops":1,"max_acceptance_loops":1,"on_acceptance_failure":"stop"},"nodes":[{"type":"worker","id":"dev","provider":"claude-code","profile":"developer"}],"edges":[]}"#,
    )
    .unwrap();
    let app = App::new(repo_root);
    let mut state = ConsoleState::default();
    state.welcome_action = WelcomeAction::SelectTask;
    activate_current(&app, &mut state).unwrap();
    activate_current(&app, &mut state).unwrap();
    assert_eq!(state.screen, Screen::Workspace);
    let vm = build_view_model(&app, &state).unwrap();
    assert!(vm.header.contains("task-001"));
    assert!(vm.show_detail);
}

#[test]
fn esc_from_workspace_returns_to_task_picker() {
    let temp = tempdir().unwrap();
    let repo_root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    std::fs::create_dir_all(repo_root.join(".gold-band/tasks/task-001/authoring").as_std_path()).unwrap();
    std::fs::write(
        repo_root.join(".gold-band/tasks/task-001/task.json").as_std_path(),
        r#"{"version":"0.1","id":"task-001","description":"demo task"}"#,
    )
    .unwrap();
    std::fs::write(
        repo_root.join(".gold-band/tasks/task-001/authoring/workflow.json").as_std_path(),
        r#"{"version":"0.1","id":"full-flow","entry":"dev","control":{"max_repair_loops":1,"max_acceptance_loops":1,"on_acceptance_failure":"stop"},"nodes":[{"type":"worker","id":"dev","provider":"claude-code","profile":"developer"}],"edges":[]}"#,
    )
    .unwrap();
    let app = App::new(repo_root);
    let mut state = ConsoleState::default();
    state.welcome_action = WelcomeAction::SelectTask;
    activate_current(&app, &mut state).unwrap();
    activate_current(&app, &mut state).unwrap();
    assert_eq!(state.screen, Screen::Workspace);
    escape(&app, &mut state).unwrap();
    assert_eq!(state.screen, Screen::TaskPicker);
}

#[test]
fn move_down_changes_selected_task() {
    let temp = tempdir().unwrap();
    let repo_root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    for id in ["task-001", "task-002"] {
        std::fs::create_dir_all(repo_root.join(format!(".gold-band/tasks/{id}")).as_std_path()).unwrap();
        std::fs::write(
            repo_root.join(format!(".gold-band/tasks/{id}/task.json")).as_std_path(),
            format!(r#"{{"version":"0.1","id":"{id}","description":"demo"}}"#),
        )
        .unwrap();
    }
    let app = App::new(repo_root);
    let mut state = ConsoleState::default();
    state.welcome_action = WelcomeAction::SelectTask;
    activate_current(&app, &mut state).unwrap();
    move_down(&mut state);
    assert_eq!(state.task_index, 1);
}
