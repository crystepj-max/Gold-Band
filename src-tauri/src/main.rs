mod commands;
mod i18n;
mod state;
mod view_models;

use anyhow::Context;
use commands::{
    choose_workspace, continue_run, get_app_bootstrap, get_round_detail, get_run_detail,
    get_task_detail, get_task_list, get_workflow, kill_run, retry_run, save_desktop_preferences,
    select_recent_workspace, show_artifact, show_attachment, show_worker_ref, start_run,
};
use state::{DesktopContext, DesktopState};

fn main() {
    if let Err(error) = run() {
        eprintln!("failed to start Gold Band desktop: {error:?}");
    }
}

fn run() -> anyhow::Result<()> {
    let context = DesktopContext::from_current_dir()?;
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DesktopState::new(context))
        .invoke_handler(tauri::generate_handler![
            get_app_bootstrap,
            get_task_list,
            choose_workspace,
            select_recent_workspace,
            get_task_detail,
            get_workflow,
            get_run_detail,
            get_round_detail,
            start_run,
            continue_run,
            retry_run,
            kill_run,
            show_artifact,
            show_attachment,
            show_worker_ref,
            save_desktop_preferences,
        ])
        .run(tauri::generate_context!())
        .context("tauri runtime failed")?;
    Ok(())
}
