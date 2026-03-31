use anyhow::Result;
use camino::Utf8PathBuf;
use std::fs;

use crate::domain::{NodeType, SessionMode};
use crate::dsl::{EdgeOutcome, NodeDsl, ValidatedWorkflow};
use crate::runtime::NodeState;

use super::ids::latest_attempt_id;
use super::App;

pub(crate) fn find_latest_artifact_path(
    app: &App,
    task_id: &str,
    run_id: &str,
    round_id: &str,
    node_id: &str,
    name: &str,
) -> Result<Option<Utf8PathBuf>> {
    let node_dir = app.paths.node_dir(task_id, run_id, round_id, node_id);
    if !node_dir.exists() {
        return Ok(None);
    }
    let attempt_id = latest_attempt_id(&node_dir)?;
    Ok(attempt_id.map(|attempt_id| app.paths.artifact_file(task_id, run_id, round_id, node_id, &attempt_id, name)))
}

pub(crate) fn find_verify_exec_result_path(
    app: &App,
    task_id: &str,
    run_id: &str,
    round_id: &str,
    workflow: &ValidatedWorkflow,
    verify_node_id: &str,
) -> Result<Option<Utf8PathBuf>> {
    let Some(upstream_node_id) = find_upstream_success_source_node_id(workflow, verify_node_id) else {
        return Ok(None);
    };
    match workflow.get_node(&upstream_node_id) {
        Some(NodeDsl::Exec(_)) => find_latest_artifact_path(app, task_id, run_id, round_id, &upstream_node_id, "exec-result"),
        _ => Ok(None),
    }
}

pub(crate) fn find_verify_worker_primary_artifact(
    app: &App,
    task_id: &str,
    run_id: &str,
    round_id: &str,
    workflow: &ValidatedWorkflow,
    verify_node_id: &str,
) -> Result<Option<Utf8PathBuf>> {
    let Some(upstream_node_id) = find_upstream_success_source_node_id(workflow, verify_node_id) else {
        return Ok(None);
    };
    let worker_id = match workflow.get_node(&upstream_node_id) {
        Some(NodeDsl::Exec(exec)) => exec.plan_from.clone(),
        Some(NodeDsl::Worker(worker)) => worker.id.clone(),
        _ => return Ok(None),
    };
    let Some(NodeDsl::Worker(worker)) = workflow.get_node(&worker_id) else {
        return Ok(None);
    };
    let Some(primary_artifact) = worker.primary_artifact.as_deref() else {
        return Ok(None);
    };
    find_latest_artifact_path(app, task_id, run_id, round_id, &worker_id, primary_artifact)
}

pub(crate) fn find_verify_attachment_paths(
    app: &App,
    task_id: &str,
    run_id: &str,
    round_id: &str,
    workflow: &ValidatedWorkflow,
    verify_node_id: &str,
) -> Result<Vec<Utf8PathBuf>> {
    let Some(upstream_node_id) = find_upstream_success_source_node_id(workflow, verify_node_id) else {
        return Ok(Vec::new());
    };
    let attachment_node_id = match workflow.get_node(&upstream_node_id) {
        Some(NodeDsl::Exec(exec)) => exec.plan_from.clone(),
        _ => upstream_node_id,
    };
    let node_dir = app.paths.node_dir(task_id, run_id, round_id, &attachment_node_id);
    if !node_dir.exists() {
        return Ok(Vec::new());
    }
    let Some(attempt_id) = latest_attempt_id(&node_dir)? else {
        return Ok(Vec::new());
    };
    let attachments_dir = app.paths.attachments_dir(task_id, run_id, round_id, &attachment_node_id, &attempt_id);
    if !attachments_dir.exists() {
        return Ok(Vec::new());
    }
    let mut attachments = fs::read_dir(attachments_dir.as_std_path())?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| Utf8PathBuf::from_path_buf(entry.path()).ok())
        .filter(|path| path.is_file())
        .collect::<Vec<_>>();
    attachments.sort();
    Ok(attachments)
}

fn find_upstream_success_source_node_id(workflow: &ValidatedWorkflow, node_id: &str) -> Option<String> {
    workflow
        .raw
        .edges
        .iter()
        .find(|edge| edge.to == node_id && edge.on == EdgeOutcome::Success)
        .map(|edge| edge.from.clone())
}

pub(crate) fn find_latest_worker_ref_for_transition(
    app: &App,
    task_id: &str,
    run_id: &str,
    round_id: &str,
    previous_node: &NodeState,
    target_node_id: &str,
    session_mode: SessionMode,
) -> Result<Option<Utf8PathBuf>> {
    if session_mode != SessionMode::Continue {
        return Ok(None);
    }
    if previous_node.node_type != NodeType::Exec {
        return Ok(None);
    }
    let path = app.paths.worker_ref_file(task_id, run_id, round_id, target_node_id, "attempt-001");
    if path.exists() {
        Ok(Some(path))
    } else {
        Ok(None)
    }
}

pub(crate) fn feedback_summary_from_previous_node(
    app: &App,
    task_id: &str,
    run_id: &str,
    round_id: &str,
    node: &NodeState,
) -> Result<Option<String>> {
    match node.node_type {
        NodeType::Exec => {
            let path = app.paths.artifact_file(task_id, run_id, round_id, &node.node_id, &node.attempt_id, "exec-result");
            if path.exists() {
                Ok(Some(fs::read_to_string(path)?))
            } else {
                Ok(None)
            }
        }
        NodeType::Verify => {
            let path = app.paths.artifact_file(task_id, run_id, round_id, &node.node_id, &node.attempt_id, "verify-result");
            if path.exists() {
                Ok(Some(fs::read_to_string(path)?))
            } else {
                Ok(None)
            }
        }
        _ => Ok(None),
    }
}
