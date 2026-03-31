use crate::app::App;
use crate::command::execute::execute_command;
use crate::command::{ArtifactCommand, Command, CommandResult, RunCommand, TaskCommand};
use crate::config::{RuntimeConfig, RuntimeLogLevel};
use crate::console::run_console;
use crate::observability::{init_tracing, touch_log_file_best_effort};
use anyhow::Result;
use camino::Utf8PathBuf;
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "gold-band")]
#[command(about = "Gold Band CLI MVP")]
pub struct Cli {
    #[arg(long, default_value = "debug")]
    log_level: RuntimeLogLevel,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    Task { #[command(subcommand)] command: TaskCommands },
    Run { #[command(subcommand)] command: RunCommands },
    Artifact { #[command(subcommand)] command: ArtifactCommands },
    Console,
}

#[derive(Debug, Subcommand)]
enum TaskCommands {
    Show { task_id: String },
}

#[derive(Debug, Subcommand)]
enum RunCommands {
    Start { task_id: String, #[arg(long)] workflow: Option<Utf8PathBuf> },
    Status { task_id: String, run_id: String },
    Continue { task_id: String, run_id: String },
    Retry { task_id: String, run_id: String },
    Kill { task_id: String, run_id: String },
    OpenSession { task_id: String, run_id: String, #[arg(long)] round: String, #[arg(long)] node: String, #[arg(long)] attempt: String },
}

#[derive(Debug, Subcommand)]
enum ArtifactCommands {
    List { task_id: String, run_id: String, #[arg(long)] round: String, #[arg(long)] node: String, #[arg(long)] attempt: String },
    Show { task_id: String, run_id: String, #[arg(long)] round: String, #[arg(long)] node: String, #[arg(long)] attempt: String, #[arg(long)] name: String },
    ShowPath { path: Utf8PathBuf },
}

pub async fn run() -> Result<()> {
    let cli = Cli::parse();
    let cwd = std::env::current_dir()?;
    let repo_root = Utf8PathBuf::from_path_buf(cwd).map_err(|_| anyhow::anyhow!("working directory is not valid UTF-8"))?;
    let config = RuntimeConfig {
        log_level: cli.log_level,
        ..RuntimeConfig::default()
    };
    let app = App::with_config(repo_root, config);
    init_tracing(&app.paths, &app.config);
    touch_log_file_best_effort(&app.paths);

    match cli.command {
        Commands::Console => run_console(&app),
        Commands::Task { command } => print_result(execute_command(&app, Command::Task(map_task_command(command)?))?),
        Commands::Run { command } => print_result(execute_command(&app, Command::Run(map_run_command(command)?))?),
        Commands::Artifact { command } => print_result(execute_command(&app, Command::Artifact(map_artifact_command(command)?))?),
    }
}

fn map_task_command(command: TaskCommands) -> Result<TaskCommand> {
    Ok(match command {
        TaskCommands::Show { task_id } => TaskCommand::Show { task_id },
    })
}

fn map_run_command(command: RunCommands) -> Result<RunCommand> {
    Ok(match command {
        RunCommands::Start { task_id, workflow } => RunCommand::Start { task_id, workflow },
        RunCommands::Status { task_id, run_id } => RunCommand::Status { task_id, run_id },
        RunCommands::Continue { task_id, run_id } => RunCommand::Continue { task_id, run_id },
        RunCommands::Retry { task_id, run_id } => RunCommand::Retry { task_id, run_id },
        RunCommands::Kill { task_id, run_id } => RunCommand::Kill { task_id, run_id },
        RunCommands::OpenSession { task_id, run_id, round, node, attempt } => RunCommand::OpenSession {
            task_id,
            run_id,
            round,
            node,
            attempt,
        },
    })
}

fn map_artifact_command(command: ArtifactCommands) -> Result<ArtifactCommand> {
    Ok(match command {
        ArtifactCommands::List { task_id, run_id, round, node, attempt } => ArtifactCommand::List {
            task_id,
            run_id,
            round,
            node,
            attempt,
        },
        ArtifactCommands::Show { task_id, run_id, round, node, attempt, name } => ArtifactCommand::Show {
            task_id,
            run_id,
            round,
            node,
            attempt,
            name,
        },
        ArtifactCommands::ShowPath { path } => ArtifactCommand::ShowPath { path },
    })
}

fn print_result(result: CommandResult) -> Result<()> {
    match result {
        CommandResult::Json(value) => println!("{}", serde_json::to_string_pretty(&value)?),
        CommandResult::Text(text) => println!("{text}"),
    }
    Ok(())
}
