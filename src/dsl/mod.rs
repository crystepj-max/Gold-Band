use crate::domain::{AcceptanceFailurePolicy, DEFAULT_PROVIDER, NodeType, SessionMode};
use crate::provider::supports_continue_session;
use anyhow::{Result, anyhow, bail, ensure};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const END_NODE: &str = "$end";
const RESERVED_NODE_IDS: &[&str] = &["worker", "exec", "verify", END_NODE];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowDsl {
    pub version: String,
    pub id: String,
    pub entry: String,
    pub control: WorkflowControl,
    pub nodes: Vec<NodeDsl>,
    pub edges: Vec<EdgeDsl>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowControl {
    pub max_repair_loops: u32,
    pub max_acceptance_loops: u32,
    pub on_acceptance_failure: AcceptanceFailurePolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum NodeDsl {
    Worker(WorkerNode),
    Exec(ExecNode),
    Verify(VerifyNode),
}

impl NodeDsl {
    pub fn id(&self) -> &str {
        match self {
            Self::Worker(node) => &node.id,
            Self::Exec(node) => &node.id,
            Self::Verify(node) => &node.id,
        }
    }

    pub fn node_type(&self) -> NodeType {
        match self {
            Self::Worker(_) => NodeType::Worker,
            Self::Exec(_) => NodeType::Exec,
            Self::Verify(_) => NodeType::Verify,
        }
    }

    pub fn provider(&self) -> Option<&str> {
        match self {
            Self::Worker(node) => node.provider.as_deref(),
            Self::Verify(node) => node.provider.as_deref(),
            Self::Exec(_) => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerNode {
    pub id: String,
    pub provider: Option<String>,
    pub profile: Option<String>,
    pub goal: Option<String>,
    pub primary_artifact: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecNode {
    pub id: String,
    pub plan_from: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyNode {
    pub id: String,
    pub provider: Option<String>,
    pub profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EdgeDsl {
    pub from: String,
    pub to: String,
    pub on: EdgeOutcome,
    pub session: Option<SessionMode>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EdgeOutcome {
    Success,
    Failure,
    Invalid,
}

#[derive(Debug, Clone)]
pub struct ValidatedWorkflow {
    pub raw: WorkflowDsl,
    pub nodes_by_id: IndexMap<String, NodeDsl>,
    pub verify_node_id: Option<String>,
}

impl ValidatedWorkflow {
    pub fn get_node(&self, id: &str) -> Option<&NodeDsl> {
        self.nodes_by_id.get(id)
    }
}

pub fn validate_workflow(workflow: WorkflowDsl) -> Result<ValidatedWorkflow> {
    ensure!(
        workflow.version == "0.1",
        "unsupported workflow version: {}",
        workflow.version
    );
    ensure!(
        !workflow.id.trim().is_empty(),
        "workflow id cannot be empty"
    );
    ensure!(
        !workflow.entry.trim().is_empty(),
        "workflow entry cannot be empty"
    );
    ensure!(
        !workflow.nodes.is_empty(),
        "workflow must contain at least one node"
    );
    ensure!(
        workflow.control.max_repair_loops > 0,
        "max_repair_loops must be a positive integer"
    );
    ensure!(
        workflow.control.max_acceptance_loops > 0,
        "max_acceptance_loops must be a positive integer"
    );

    let mut nodes_by_id = IndexMap::new();
    let mut seen_ids = HashSet::new();
    let mut verify_node_id = None;

    for node in &workflow.nodes {
        let id = node.id();
        ensure!(!id.trim().is_empty(), "node id cannot be empty");
        ensure!(seen_ids.insert(id.to_string()), "duplicate node id: {id}");
        ensure!(
            !RESERVED_NODE_IDS.contains(&id),
            "node id `{id}` is reserved and cannot be used"
        );

        match node {
            NodeDsl::Worker(worker) => {
                if let Some(profile) = &worker.profile {
                    ensure!(
                        !profile.trim().is_empty(),
                        "worker node `{id}` profile cannot be blank"
                    );
                }
            }
            NodeDsl::Verify(verify) => {
                if let Some(profile) = &verify.profile {
                    ensure!(
                        !profile.trim().is_empty(),
                        "verify node `{id}` profile cannot be blank"
                    );
                }
            }
            NodeDsl::Exec(_) => {}
        }

        if let NodeDsl::Verify(_) = node {
            ensure!(
                verify_node_id.is_none(),
                "workflow can contain at most one verify node"
            );
            verify_node_id = Some(id.to_string());
        }

        nodes_by_id.insert(id.to_string(), node.clone());
    }

    ensure!(
        nodes_by_id.contains_key(&workflow.entry),
        "entry node not found: {}",
        workflow.entry
    );
    ensure!(
        verify_node_id.is_some()
            || matches!(
                workflow.control.on_acceptance_failure,
                AcceptanceFailurePolicy::Stop
            ),
        "acceptance failure policy requires a verify node"
    );

    for edge in &workflow.edges {
        ensure!(
            nodes_by_id.contains_key(&edge.from),
            "edge source not found: {}",
            edge.from
        );
        ensure!(
            edge.to == END_NODE || nodes_by_id.contains_key(&edge.to),
            "edge target not found: {}",
            edge.to
        );
        ensure!(
            !(edge.to == END_NODE && edge.on == EdgeOutcome::Invalid),
            "edge `{}` cannot target `$end` on invalid",
            edge.from
        );

        if matches!(edge.session, Some(SessionMode::Continue)) {
            let target = nodes_by_id
                .get(&edge.to)
                .ok_or_else(|| anyhow!("edge target not found: {}", edge.to))?;
            let provider = target.provider().unwrap_or(DEFAULT_PROVIDER);
            ensure!(
                supports_continue_session(provider)?,
                "session=continue currently only supports provider `{DEFAULT_PROVIDER}`"
            );
        }
    }

    for node in nodes_by_id.values() {
        if let NodeDsl::Exec(exec) = node {
            let source = nodes_by_id
                .get(&exec.plan_from)
                .ok_or_else(|| anyhow!("exec planFrom not found: {}", exec.plan_from))?;
            match source {
                NodeDsl::Worker(worker) => {
                    ensure!(
                        worker.primary_artifact.as_deref() == Some("exec-plan"),
                        "exec node `{}` requires planFrom worker `{}` to declare primaryArtifact=exec-plan",
                        exec.id,
                        exec.plan_from
                    );
                }
                _ => bail!(
                    "exec node `{}` planFrom must point to a worker node",
                    exec.id
                ),
            }
        }
    }

    Ok(ValidatedWorkflow {
        raw: workflow,
        nodes_by_id,
        verify_node_id,
    })
}
