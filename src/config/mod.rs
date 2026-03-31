use std::str::FromStr;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RuntimeLogLevel {
    Error,
    Warn,
    Info,
    Debug,
    Trace,
}

impl RuntimeLogLevel {
    pub fn as_directive(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warn => "warn",
            Self::Info => "info",
            Self::Debug => "debug",
            Self::Trace => "trace",
        }
    }
}

impl FromStr for RuntimeLogLevel {
    type Err = anyhow::Error;

    fn from_str(value: &str) -> Result<Self> {
        match value {
            "error" => Ok(Self::Error),
            "warn" => Ok(Self::Warn),
            "info" => Ok(Self::Info),
            "debug" => Ok(Self::Debug),
            "trace" => Ok(Self::Trace),
            _ => Err(anyhow!("unsupported log level: {value}")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeConfig {
    pub default_provider: String,
    pub log_level: RuntimeLogLevel,
    pub log_prompts: bool,
    pub log_provider_command: bool,
    pub log_retention_days: u64,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            default_provider: "claude-code".to_string(),
            log_level: RuntimeLogLevel::Debug,
            log_prompts: true,
            log_provider_command: true,
            log_retention_days: 7,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProfileSource {
    Project,
    User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedProfileRef {
    pub name: String,
    pub source: ProfileSource,
    pub path: String,
}
