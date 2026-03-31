pub use crate::domain::SessionRef;
use crate::domain::{InvocationKind, SessionMode, DEFAULT_PROVIDER};
use crate::observability::append_raw_stream_best_effort;
use crate::storage::ensure_parent_dir;
use anyhow::{anyhow, bail, ensure, Result};
use camino::Utf8PathBuf;
use serde::{Deserialize, Serialize};
use std::io::{BufReader, Read};
use std::process::{Command, Stdio};
use std::thread;
use tracing::{debug, warn};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderInfo {
    pub provider_id: String,
    pub display_name: String,
    pub capabilities: ProviderCapabilities,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderCapabilities {
    pub supports_open_session: bool,
    pub supports_continue_session: bool,
    pub supports_raw_stream: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoctorResult {
    pub available: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerInvocation {
    pub invocation_kind: InvocationKind,
    pub profile: Option<String>,
    pub requirement_path: Option<Utf8PathBuf>,
    pub requirement_text: Option<String>,
    pub workspace_dir: Utf8PathBuf,
    pub attempt_dir: Utf8PathBuf,
    pub primary_artifact: Option<String>,
    pub task_instruction: Option<String>,
    pub session_mode: SessionMode,
    pub continue_ref: Option<serde_json::Value>,
    pub stream_mode: StreamMode,
    #[serde(default)]
    pub log_prompts: bool,
    #[serde(default)]
    pub log_provider_command: bool,
    pub feedback_summary: Option<String>,
    pub verify_result_path: Option<Utf8PathBuf>,
    pub attachments_dir: Option<Utf8PathBuf>,
    pub cold_artifacts: Vec<ColdFileRef>,
    pub cold_attachments: Vec<ColdFileRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColdFileRef {
    pub name: Option<String>,
    pub path: Utf8PathBuf,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StreamMode {
    None,
    Raw,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderRunResult {
    pub status: ProviderRunStatus,
    pub exit_code: Option<i32>,
    pub result_payload: Option<ProviderResultPayload>,
    pub worker_ref_seed: Option<SessionRef>,
    pub stream_path: Option<Utf8PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderRunStatus {
    Success,
    Failure,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderResultPayload {
    pub primary_artifact: Option<PrimaryArtifactPayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrimaryArtifactPayload {
    pub name: String,
    pub content: String,
}


#[derive(Debug, Clone)]
pub struct PromptBundle {
    pub system_prompt: String,
    pub user_prompt: String,
}

pub trait ProviderAdapter: Send + Sync {
    fn describe_provider(&self) -> ProviderInfo;
    fn doctor(&self) -> DoctorResult;
    fn run_worker(&self, req: WorkerInvocation) -> Result<ProviderRunResult>;
    fn open_session(&self, worker_ref: &SessionRef) -> Result<()>;
    fn build_continue_command(&self, worker_ref: &SessionRef) -> Result<Option<String>>;
}

pub struct ClaudeCodeProvider;

impl ProviderAdapter for ClaudeCodeProvider {
    fn describe_provider(&self) -> ProviderInfo {
        ProviderInfo {
            provider_id: "claude-code".to_string(),
            display_name: "Claude Code".to_string(),
            capabilities: ProviderCapabilities {
                supports_open_session: true,
                supports_continue_session: true,
                supports_raw_stream: true,
            },
            is_default: true,
        }
    }

    fn doctor(&self) -> DoctorResult {
        let result = Command::new("claude").arg("--version").output();
        match result {
            Ok(output) if output.status.success() => DoctorResult {
                available: true,
                reason: None,
            },
            Ok(output) => DoctorResult {
                available: false,
                reason: Some(format!("claude --version failed with status {:?}", output.status.code())),
            },
            Err(err) => DoctorResult {
                available: false,
                reason: Some(err.to_string()),
            },
        }
    }

    fn run_worker(&self, req: WorkerInvocation) -> Result<ProviderRunResult> {
        let prompt = render_prompt_bundle(&req)?;
        let mut command = Command::new("claude");
        debug!(invocation_kind = ?req.invocation_kind, attempt_dir = %req.attempt_dir, session_mode = ?req.session_mode, stream_mode = ?req.stream_mode, "starting claude provider invocation");
        command.current_dir(req.workspace_dir.as_std_path());
        command.arg("--bare").arg("-p");
        command.arg(format!("{}\n\n{}", prompt.system_prompt, prompt.user_prompt));
        command.arg("--output-format").arg("json");

        match req.session_mode {
            SessionMode::New => {}
            SessionMode::Continue => {
                let continue_ref = req
                    .continue_ref
                    .clone()
                    .ok_or_else(|| anyhow!("sessionMode=continue requires continueRef"))?;
                let session_id = continue_ref
                    .get("sessionId")
                    .and_then(|value| value.as_str())
                    .ok_or_else(|| anyhow!("continueRef is missing sessionId"))?;
                command.arg("--resume").arg(session_id);
            }
        }

        if req.log_provider_command {
            debug!(cwd = %req.workspace_dir, argv = ?provider_command_summary(&command), "provider command summary");
        }
        log_prompt_bundle(
            &prompt,
            req.invocation_kind,
            req.profile.as_deref(),
            req.primary_artifact.as_deref(),
            req.feedback_summary.is_some(),
            req.cold_artifacts.len(),
            req.cold_attachments.len(),
            req.log_prompts,
        );
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        let raw_stream_path = matches!(req.stream_mode, StreamMode::Raw).then(|| req.attempt_dir.join("raw.stream.jsonl"));
        if let Some(path) = raw_stream_path.as_ref() {
            ensure_parent_dir(path)?;
            let _ = std::fs::File::options().create(true).append(true).open(path.as_std_path())?;
            debug!(path = %path, "prepared raw stream file");
        }
        let mut child = command.spawn()?;

        let stdout = child.stdout.take().ok_or_else(|| anyhow!("failed to capture claude stdout"))?;
        let stderr = child.stderr.take().ok_or_else(|| anyhow!("failed to capture claude stderr"))?;
        let stdout_path = raw_stream_path.clone();
        let stderr_path = raw_stream_path.clone();

        let stdout_handle = thread::spawn(move || read_stream(stdout, "stdout", stdout_path));
        let stderr_handle = thread::spawn(move || read_stream(stderr, "stderr", stderr_path));

        let status = child.wait()?;
        let exit_code = status.code();
        let stdout = stdout_handle.join().map_err(|_| anyhow!("stdout reader thread panicked"))?;
        let stderr = stderr_handle.join().map_err(|_| anyhow!("stderr reader thread panicked"))?;
        let stdout = stdout.trim().to_string();
        let stderr = stderr.trim().to_string();
        let stream_path = raw_stream_path;
        debug!(?exit_code, stdout_len = stdout.len(), stderr_len = stderr.len(), "claude provider finished");

        if !status.success() {
            warn!(?exit_code, "claude provider returned failure status");
            return Ok(ProviderRunResult {
                status: ProviderRunStatus::Failure,
                exit_code,
                result_payload: None,
                worker_ref_seed: None,
                stream_path,
            });
        }

        let response: ClaudeJsonResponse = serde_json::from_str(&stdout)
            .map_err(|err| anyhow!("failed to parse Claude Code JSON output: {err}; stdout={stdout}; stderr={stderr}"))?;

        let worker_ref_seed = response.session_id.as_ref().map(|session_id| SessionRef {
            provider: "claude-code".to_string(),
            mode: req.session_mode,
            supports_open_session: true,
            supports_continue_session: true,
            continue_ref: Some(serde_json::json!({ "sessionId": session_id })),
            open_command: Some(format!("claude -c {session_id}")),
        });

        let result_payload = req.primary_artifact.as_ref().map(|primary_artifact| ProviderResultPayload {
            primary_artifact: Some(PrimaryArtifactPayload {
                name: primary_artifact.clone(),
                content: response.result,
            }),
        });

        Ok(ProviderRunResult {
            status: ProviderRunStatus::Success,
            exit_code,
            result_payload,
            worker_ref_seed,
            stream_path,
        })
    }

    fn open_session(&self, worker_ref: &SessionRef) -> Result<()> {
        if !worker_ref.supports_open_session {
            bail!("provider does not support open-session");
        }
        Ok(())
    }

    fn build_continue_command(&self, worker_ref: &SessionRef) -> Result<Option<String>> {
        Ok(worker_ref.open_command.clone())
    }
}

#[derive(Debug, Deserialize)]
struct ClaudeJsonResponse {
    result: String,
    #[serde(default)]
    session_id: Option<String>,
}

fn current_timestamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    format!("{secs}Z")
}

fn read_stream<R: Read>(reader: R, stream: &'static str, path: Option<Utf8PathBuf>) -> String {
    let mut collected = String::new();
    let mut reader = BufReader::new(reader);
    let mut buffer = [0_u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read_len) => {
                let chunk = String::from_utf8_lossy(&buffer[..read_len]);
                if let Some(path) = path.as_ref() {
                    append_raw_stream_best_effort(path, &current_timestamp(), stream, &chunk);
                }
                collected.push_str(&chunk);
            }
            Err(err) => {
                warn!(stream, error = %err, "failed reading provider stream");
                break;
            }
        }
    }
    collected
}

fn render_prompt_bundle(req: &WorkerInvocation) -> Result<PromptBundle> {
    ensure!(req.requirement_path.is_some() || req.requirement_text.is_some(), "worker invocation requires requirementPath or requirementText");

    let requirement_text = match (&req.requirement_text, &req.requirement_path) {
        (Some(text), _) => text.clone(),
        (None, Some(path)) => std::fs::read_to_string(path)?,
        (None, None) => unreachable!(),
    };

    let system_prompt = format!(
        "You are running inside Gold Band runtime.\n\nCurrent location:\n- Invocation kind: {:?}\n- Attempt directory: {}\n- Workspace directory: {}\n{}{}{}\n- Return only the final answer content for the declared primary artifact when one is required.",
        req.invocation_kind,
        req.attempt_dir,
        req.workspace_dir,
        req.profile
            .as_ref()
            .map(|profile| format!("- Profile: {profile}\n"))
            .unwrap_or_default(),
        req.primary_artifact
            .as_ref()
            .map(|artifact| format!("- Required primary artifact: {artifact}\n"))
            .unwrap_or_default(),
        req.attachments_dir
            .as_ref()
            .map(|path| format!("- Free-form attachments may only be written under: {path}\n"))
            .unwrap_or_default(),
    );

    let mut user_sections = vec![format!("# Requirement\n{}", requirement_text.trim())];

    if let Some(feedback_summary) = &req.feedback_summary {
        user_sections.push(format!("# Current Feedback\n{}", feedback_summary.trim()));
    }

    if let Some(task_instruction) = &req.task_instruction {
        user_sections.push(format!("# Task\n{}", task_instruction.trim()));
    }

    if !req.cold_artifacts.is_empty() {
        let index = req
            .cold_artifacts
            .iter()
            .map(|entry| match &entry.name {
                Some(name) => format!("- {name}: {}", entry.path),
                None => format!("- {}", entry.path),
            })
            .collect::<Vec<_>>()
            .join("\n");
        user_sections.push(format!("# Cold Artifact Index\n{}", index));
    }

    if !req.cold_attachments.is_empty() {
        let index = req
            .cold_attachments
            .iter()
            .map(|entry| format!("- {}", entry.path))
            .collect::<Vec<_>>()
            .join("\n");
        user_sections.push(format!("# Cold Attachment Index\n{}", index));
    }

    Ok(PromptBundle {
        system_prompt,
        user_prompt: user_sections.join("\n\n"),
    })
}

fn provider_command_summary(command: &Command) -> Vec<String> {
    let mut argv = Vec::new();
    argv.push(command.get_program().to_string_lossy().to_string());
    let mut skip_next_prompt = false;
    for arg in command.get_args() {
        let arg = arg.to_string_lossy().to_string();
        if skip_next_prompt {
            argv.push("<prompt-redacted>".to_string());
            skip_next_prompt = false;
            continue;
        }
        if arg == "-p" {
            argv.push(arg);
            skip_next_prompt = true;
            continue;
        }
        argv.push(arg);
    }
    argv
}

fn log_prompt_bundle(
    prompt: &PromptBundle,
    invocation_kind: InvocationKind,
    profile: Option<&str>,
    primary_artifact: Option<&str>,
    has_feedback: bool,
    cold_artifacts: usize,
    cold_attachments: usize,
    log_prompts: bool,
) {
    debug!(
        invocation_kind = ?invocation_kind,
        profile = ?profile,
        primary_artifact = ?primary_artifact,
        system_prompt_len = prompt.system_prompt.len(),
        user_prompt_len = prompt.user_prompt.len(),
        has_feedback,
        cold_artifacts,
        cold_attachments,
        "provider prompt bundle summary"
    );
    if log_prompts {
        debug!(system_prompt = %prompt.system_prompt, user_prompt = %prompt.user_prompt, "provider prompt bundle content");
    }
}

pub fn provider_capabilities(provider_id: &str) -> Result<ProviderCapabilities> {
    match provider_id {
        DEFAULT_PROVIDER => Ok(ClaudeCodeProvider.describe_provider().capabilities),
        _ => bail!("unsupported provider: {provider_id}"),
    }
}

pub fn supports_continue_session(provider_id: &str) -> Result<bool> {
    Ok(provider_capabilities(provider_id)?.supports_continue_session)
}

pub fn provider_from_id(provider_id: &str) -> Result<Box<dyn ProviderAdapter>> {
    match provider_id {
        DEFAULT_PROVIDER => Ok(Box::new(ClaudeCodeProvider)),
        _ => bail!("unsupported provider: {provider_id}"),
    }
}

pub fn default_provider() -> Box<dyn ProviderAdapter> {
    provider_from_id(DEFAULT_PROVIDER).expect("default provider must be supported")
}
