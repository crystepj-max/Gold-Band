use anyhow::{Result, anyhow, bail};
use serde::Serialize;

use crate::config::{ProfileSource, ResolvedProfileRef};
use crate::dsl::{NodeDsl, WorkflowDsl};
use crate::storage::GoldBandPaths;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedWorkflowMetadata {
    pub profiles: Vec<ResolvedProfileRef>,
}

pub(crate) fn resolve_workflow_profiles(
    paths: &GoldBandPaths,
    workflow: &WorkflowDsl,
) -> Result<ResolvedWorkflowMetadata> {
    let mut profiles = Vec::new();
    for node in &workflow.nodes {
        let profile = match node {
            NodeDsl::Worker(worker) => worker.profile.as_deref(),
            NodeDsl::Verify(verify) => verify.profile.as_deref(),
            NodeDsl::Exec(_) => None,
        };
        if let Some(profile) = profile {
            let trimmed = profile.trim();
            if trimmed.is_empty() {
                bail!("node `{}` has empty profile", node.id());
            }
            let resolved = resolve_profile(paths, trimmed)?;
            if profiles.iter().all(|existing: &ResolvedProfileRef| {
                existing.name != resolved.name || existing.path != resolved.path
            }) {
                profiles.push(resolved);
            }
        }
    }
    Ok(ResolvedWorkflowMetadata { profiles })
}

pub(crate) fn resolve_profile(
    paths: &GoldBandPaths,
    profile_name: &str,
) -> Result<ResolvedProfileRef> {
    let project_path = paths.repo_profile_file(profile_name);
    if project_path.exists() {
        return Ok(ResolvedProfileRef {
            name: profile_name.to_string(),
            source: ProfileSource::Project,
            path: project_path.to_string(),
        });
    }

    let user_path = paths.user_profile_file(profile_name);
    if user_path.exists() {
        return Ok(ResolvedProfileRef {
            name: profile_name.to_string(),
            source: ProfileSource::User,
            path: user_path.to_string(),
        });
    }

    Err(anyhow!(
        "profile `{profile_name}` not found in {} or {}",
        project_path,
        user_path
    ))
}

pub(crate) fn resolve_profile_for_node(
    metadata: &ResolvedWorkflowMetadata,
    profile_name: &str,
) -> Option<ResolvedProfileRef> {
    metadata
        .profiles
        .iter()
        .find(|profile| profile.name == profile_name)
        .cloned()
}
