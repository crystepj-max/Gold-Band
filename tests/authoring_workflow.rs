use camino::Utf8PathBuf;
use gold_band::app::{App, CreateTaskInput};
use gold_band::domain::SessionMode;
use gold_band::dsl::WorkflowDsl;
use gold_band::provider::{DoctorResult, ProviderAdapter, ProviderCapabilities, ProviderInfo, ProviderRunResult, ProviderRunStatus, SessionRef, WorkerInvocation};
use tempfile::tempdir;

#[derive(Clone)]
struct SuccessProvider;

impl ProviderAdapter for SuccessProvider {
    fn describe_provider(&self) -> ProviderInfo {
        ProviderInfo {
            provider_id: "fake".to_string(),
            display_name: "Fake".to_string(),
            capabilities: ProviderCapabilities {
                supports_open_session: true,
                supports_continue_session: true,
                supports_raw_stream: false,
            },
            is_default: false,
        }
    }

    fn doctor(&self) -> DoctorResult {
        DoctorResult { available: true, reason: None }
    }

    fn run_worker(&self, _req: WorkerInvocation) -> anyhow::Result<ProviderRunResult> {
        Ok(ProviderRunResult {
            status: ProviderRunStatus::Success,
            exit_code: Some(0),
            result_payload: None,
            worker_ref_seed: Some(SessionRef {
                provider: "claude-code".to_string(),
                mode: SessionMode::New,
                supports_open_session: true,
                supports_continue_session: true,
                continue_ref: Some(serde_json::json!({"sessionId":"session-1"})),
                open_command: Some("claude -c session-1".to_string()),
            }),
            stream_path: None,
        })
    }

    fn open_session(&self, _worker_ref: &SessionRef) -> anyhow::Result<()> {
        Ok(())
    }

    fn build_continue_command(&self, _worker_ref: &SessionRef) -> anyhow::Result<Option<String>> {
        Ok(Some("claude -c session-1".to_string()))
    }
}

fn workflow(entry: &str) -> WorkflowDsl {
    serde_json::from_value(serde_json::json!({
        "version": "0.1",
        "id": "authoring-flow",
        "entry": entry,
        "control": {
            "max_repair_loops": 1,
            "max_acceptance_loops": 1,
            "on_acceptance_failure": "stop"
        },
        "nodes": [
            { "id": entry, "type": "worker", "provider": "claude-code", "goal": "Do the work" }
        ],
        "edges": [
            { "from": entry, "to": "$end", "on": "success" }
        ]
    })).unwrap()
}

#[test]
fn create_task_from_requirement_writes_authoring_files() {
    let temp = tempdir().unwrap();
    let repo_root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    let app = App::new(repo_root);

    let summary = app.create_task_from_requirement(CreateTaskInput {
        title: Some("Imported requirement".to_string()),
        description: Some("created from md".to_string()),
        requirement_file_name: "requirement.md".to_string(),
        requirement_content: "Build a workflow".to_string(),
        workflow: workflow("plan"),
    }).unwrap();

    assert_eq!(summary.task.id, "task-001");
    assert!(app.paths.task_file("task-001").exists());
    assert!(app.paths.requirement_file("task-001").exists());
    assert!(app.paths.workflow_file("task-001").exists());
}

#[test]
fn editing_authoring_workflow_does_not_mutate_run_snapshot() {
    let temp = tempdir().unwrap();
    let repo_root = Utf8PathBuf::from_path_buf(temp.path().to_path_buf()).unwrap();
    let app = App::with_provider(repo_root, Box::new(SuccessProvider));

    app.create_task_from_requirement(CreateTaskInput {
        title: Some("Snapshot task".to_string()),
        description: None,
        requirement_file_name: "requirement.txt".to_string(),
        requirement_content: "Keep snapshot stable".to_string(),
        workflow: workflow("plan"),
    }).unwrap();

    app.run_start("task-001", None).unwrap();
    app.save_task_workflow("task-001", workflow("dev")).unwrap();

    let snapshot: WorkflowDsl = gold_band::storage::read_json(&app.paths.workflow_snapshot_file("task-001", "run-001")).unwrap();
    let authoring: WorkflowDsl = gold_band::storage::read_json(&app.paths.workflow_file("task-001")).unwrap();
    assert_eq!(snapshot.entry, "plan");
    assert_eq!(authoring.entry, "dev");
}
