use serde::{Deserialize, Serialize};
use std::time::Duration;
use thiserror::Error;
use tokio::time::timeout;

const TOKEN_ENDPOINT: &str = "https://auth.openai.com/oauth/token";
const RESPONSES_ENDPOINT: &str = "https://chatgpt.com/backend-api/codex/responses";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_TOKEN_BODY_BYTES: usize = 32 * 1024;
const MAX_RESPONSES_BODY_BYTES: usize = 1024 * 1024;
const MAX_CREDENTIAL_BYTES: usize = 32 * 1024;
const MAX_HEADER_BYTES: usize = 1024;

#[derive(Deserialize, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CodexHttpRequest {
    Token {
        body: String,
    },
    Responses {
        access_token: String,
        account_id: Option<String>,
        residency: Option<String>,
        body: String,
    },
}

#[derive(Serialize, specta::Type)]
pub struct CodexHttpResponse {
    status: u16,
    body: String,
}

#[derive(Error, Debug, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "name")]
pub enum CodexHttpError {
    #[error("Invalid Codex request: {message}")]
    InvalidRequest { message: String },

    #[error("Codex request failed: {message}")]
    RequestFailed { message: String },

    #[error("Codex request timed out: {message}")]
    RequestTimedOut { message: String },
}

#[tauri::command]
#[specta::specta]
pub async fn send_codex_http_request(
    request: CodexHttpRequest,
) -> Result<CodexHttpResponse, CodexHttpError> {
    validate_request(&request)?;
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|_| request_failed())?;

    let request = match request {
        CodexHttpRequest::Token { body } => client
            .post(TOKEN_ENDPOINT)
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .body(body),
        CodexHttpRequest::Responses {
            access_token,
            account_id,
            residency,
            body,
        } => {
            let mut request = client
                .post(RESPONSES_ENDPOINT)
                .bearer_auth(access_token)
                .header(reqwest::header::ACCEPT, "text/event-stream")
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .header("originator", "whispering")
                .body(body);
            if let Some(account_id) = account_id {
                request = request.header("ChatGPT-Account-Id", account_id);
            }
            if let Some(residency) = residency {
                request = request.header("x-openai-internal-codex-residency", residency);
            }
            request
        }
    };

    send_and_read(request, REQUEST_TIMEOUT).await
}

fn validate_request(request: &CodexHttpRequest) -> Result<(), CodexHttpError> {
    match request {
        CodexHttpRequest::Token { body } => {
            validate_size("token request body", body, MAX_TOKEN_BODY_BYTES)
        }
        CodexHttpRequest::Responses {
            access_token,
            account_id,
            residency,
            body,
        } => {
            validate_size("access token", access_token, MAX_CREDENTIAL_BYTES)?;
            if access_token.is_empty() {
                return Err(invalid_request("The access token is empty"));
            }
            if let Some(account_id) = account_id {
                validate_size("account ID", account_id, MAX_HEADER_BYTES)?;
            }
            if let Some(residency) = residency {
                validate_size("residency", residency, MAX_HEADER_BYTES)?;
            }
            validate_size("Responses request body", body, MAX_RESPONSES_BODY_BYTES)
        }
    }
}

fn validate_size(label: &str, value: &str, maximum: usize) -> Result<(), CodexHttpError> {
    if value.len() <= maximum {
        return Ok(());
    }
    Err(invalid_request(&format!("The {label} is too large")))
}

async fn send_and_read(
    request: reqwest::RequestBuilder,
    deadline: Duration,
) -> Result<CodexHttpResponse, CodexHttpError> {
    timeout(deadline, async {
        let response = request.send().await.map_err(|_| request_failed())?;
        let status = response.status();
        let body = if status.is_success() {
            response.text().await.map_err(|_| request_failed())?
        } else {
            String::new()
        };
        Ok(CodexHttpResponse {
            status: status.as_u16(),
            body,
        })
    })
    .await
    .map_err(|_| CodexHttpError::RequestTimedOut {
        message: "The endpoint did not finish before the deadline".to_string(),
    })?
}

fn invalid_request(message: &str) -> CodexHttpError {
    CodexHttpError::InvalidRequest {
        message: message.to_string(),
    }
}

fn request_failed() -> CodexHttpError {
    CodexHttpError::RequestFailed {
        message: "The endpoint could not be reached".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    async fn local_response(response: &'static [u8], linger: Duration) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 4096];
            let _ = stream.read(&mut request).await;
            stream.write_all(response).await.unwrap();
            tokio::time::sleep(linger).await;
        });
        format!("http://{address}")
    }

    #[test]
    fn oversized_requests_are_rejected_before_network_access() {
        let request = CodexHttpRequest::Token {
            body: "x".repeat(MAX_TOKEN_BODY_BYTES + 1),
        };

        assert_eq!(
            validate_request(&request),
            Err(CodexHttpError::InvalidRequest {
                message: "The token request body is too large".to_string(),
            })
        );
    }

    #[tokio::test]
    async fn content_length_finishes_without_waiting_for_connection_close() {
        let endpoint = local_response(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok",
            Duration::from_secs(2),
        )
        .await;
        let request = reqwest::Client::new().post(endpoint).body("request");

        let response = tokio::time::timeout(
            Duration::from_millis(500),
            send_and_read(request, Duration::from_secs(1)),
        )
        .await
        .expect("response body should finish before the connection closes")
        .unwrap();

        assert_eq!(response.status, 200);
        assert_eq!(response.body, "ok");
    }

    #[tokio::test]
    async fn stalled_requests_stop_at_the_deadline() {
        let endpoint = local_response(b"", Duration::from_secs(1)).await;
        let request = reqwest::Client::new().post(endpoint).body("request");

        let result = send_and_read(request, Duration::from_millis(25)).await;

        assert!(matches!(
            result,
            Err(CodexHttpError::RequestTimedOut { .. })
        ));
    }

    #[tokio::test]
    async fn rejected_response_bodies_do_not_cross_ipc() {
        let endpoint = local_response(
            b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 14\r\n\r\nprivate-detail",
            Duration::ZERO,
        )
        .await;
        let request = reqwest::Client::new().post(endpoint).body("request");

        let response = send_and_read(request, Duration::from_secs(1))
            .await
            .unwrap();

        assert_eq!(response.status, 401);
        assert!(response.body.is_empty());
    }
}
