use gold_band::console::commands::{parse_console_command, suggest_console_commands, ConsoleLocalCommand, ParsedConsoleCommand};
use gold_band::command::{Command, RunCommand};

#[test]
fn parses_run_start_command() {
    let parsed = parse_console_command("/run start task-001").unwrap();
    match parsed {
        ParsedConsoleCommand::Runtime(Command::Run(RunCommand::Start { task_id, workflow })) => {
            assert_eq!(task_id, "task-001");
            assert!(workflow.is_none());
        }
        _ => panic!("unexpected parse result"),
    }
}

#[test]
fn parses_help_as_local_command() {
    let parsed = parse_console_command("/help").unwrap();
    match parsed {
        ParsedConsoleCommand::Local(ConsoleLocalCommand::Help) => {}
        _ => panic!("unexpected parse result"),
    }
}

#[test]
fn parses_task_and_config_commands() {
    let task = parse_console_command("/task").unwrap();
    let config = parse_console_command("/config").unwrap();
    match task {
        ParsedConsoleCommand::Local(ConsoleLocalCommand::Task) => {}
        _ => panic!("unexpected task parse result"),
    }
    match config {
        ParsedConsoleCommand::Local(ConsoleLocalCommand::Config) => {}
        _ => panic!("unexpected config parse result"),
    }
}

#[test]
fn suggests_top_level_and_subcommands() {
    assert!(suggest_console_commands("/").contains(&"/run".to_string()));
    assert!(suggest_console_commands("/r").contains(&"/run".to_string()));
    assert!(suggest_console_commands("/run ").contains(&"/run start".to_string()));
    assert!(suggest_console_commands("/artifact s").contains(&"/artifact show".to_string()));
}
