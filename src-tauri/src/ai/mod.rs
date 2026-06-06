//! AI provider gateway (Anthropic / OpenAI / OpenRouter).
//!
//! Rust has no first-party Anthropic SDK, so providers are called over HTTP. The API key is
//! resolved from the OS keyring (never persisted to disk); only the provider + model id are
//! stored as non-secret settings. Anthropic uses `POST /v1/messages` with `x-api-key`; OpenAI
//! and OpenRouter share the OpenAI-compatible `/chat/completions` shape.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, ErrorKind};

const MAX_TOKENS: u32 = 1024;
const ANTHROPIC_VERSION: &str = "2023-06-01";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AiProvider {
    Anthropic,
    OpenAi,
    OpenRouter,
}

impl AiProvider {
    /// Stable key used for the keyring account (`ai:{id}:apiKey`).
    pub fn keyring_id(self) -> &'static str {
        match self {
            AiProvider::Anthropic => "anthropic",
            AiProvider::OpenAi => "openai",
            AiProvider::OpenRouter => "openrouter",
        }
    }

    pub fn default_model(self) -> &'static str {
        match self {
            // Latest, most capable Claude model.
            AiProvider::Anthropic => "claude-opus-4-8",
            AiProvider::OpenAi => "gpt-4o",
            AiProvider::OpenRouter => "anthropic/claude-sonnet-4-6",
        }
    }
}

/// Non-secret AI settings persisted under the app config dir (`ai.json`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub provider: AiProvider,
    pub model: String,
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider: AiProvider::Anthropic,
            model: AiProvider::Anthropic.default_model().to_string(),
        }
    }
}

/// Run a single completion: a system instruction + a user prompt → assistant text.
pub async fn complete(
    provider: AiProvider,
    model: &str,
    api_key: &str,
    system: &str,
    prompt: &str,
) -> Result<String, AppError> {
    // Reuse one client so connection pools are shared across calls.
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    let client = CLIENT.get_or_init(reqwest::Client::new);
    match provider {
        AiProvider::Anthropic => anthropic_complete(client, model, api_key, system, prompt).await,
        AiProvider::OpenAi => {
            openai_complete(
                client,
                "https://api.openai.com/v1/chat/completions",
                model,
                api_key,
                system,
                prompt,
                false,
            )
            .await
        }
        AiProvider::OpenRouter => {
            openai_complete(
                client,
                "https://openrouter.ai/api/v1/chat/completions",
                model,
                api_key,
                system,
                prompt,
                true,
            )
            .await
        }
    }
}

async fn anthropic_complete(
    client: &reqwest::Client,
    model: &str,
    api_key: &str,
    system: &str,
    prompt: &str,
) -> Result<String, AppError> {
    // No `temperature`/`thinking`: removed on the latest Opus models; omitting thinking keeps
    // latency low for short SQL-shaped completions.
    let body = serde_json::json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "messages": [{ "role": "user", "content": prompt }],
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;

    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(api_error(status.as_u16(), &text));
    }

    let v: serde_json::Value = serde_json::from_str(&text)?;
    // content: [{ "type": "text", "text": "..." }, ...]
    let out = v["content"]
        .as_array()
        .and_then(|blocks| {
            blocks.iter().find_map(|b| {
                if b["type"] == "text" {
                    b["text"].as_str()
                } else {
                    None
                }
            })
        })
        .unwrap_or_default()
        .trim()
        .to_string();
    Ok(out)
}

async fn openai_complete(
    client: &reqwest::Client,
    url: &str,
    model: &str,
    api_key: &str,
    system: &str,
    prompt: &str,
    openrouter: bool,
) -> Result<String, AppError> {
    let body = serde_json::json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": prompt },
        ],
        "temperature": 0,
        "max_tokens": MAX_TOKENS,
    });

    let mut req = client
        .post(url)
        .header("authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json");
    if openrouter {
        // Optional attribution headers recognized by OpenRouter.
        req = req.header("x-title", "Tables++");
    }

    let resp = req.json(&body).send().await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(api_error(status.as_u16(), &text));
    }

    let v: serde_json::Value = serde_json::from_str(&text)?;
    let out = v["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .trim()
        .to_string();
    Ok(out)
}

/// Map an HTTP error response to an `AppError`, keeping a bounded, secret-free detail.
fn api_error(status: u16, body: &str) -> AppError {
    let detail: String = body.chars().take(300).collect();
    match status {
        401 | 403 => AppError::new(ErrorKind::Auth, "The AI provider rejected the API key")
            .with_detail(detail),
        429 => {
            AppError::new(ErrorKind::Timeout, "AI provider rate limit reached").with_detail(detail)
        }
        _ => AppError::new(ErrorKind::Internal, "The AI request failed").with_detail(detail),
    }
}
