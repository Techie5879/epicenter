use serde::{Deserialize, Serialize};
use std::{io::ErrorKind, sync::Mutex, time::Duration};
use tauri::Url;
use tauri_plugin_opener::OpenerExt;
use thiserror::Error;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::oneshot,
    time::timeout,
};

const CALLBACK_ADDRESS: &str = "127.0.0.1:1455";
const CALLBACK_PATH: &str = "/auth/callback";
const REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const CONNECTION_READ_TIMEOUT: Duration = Duration::from_secs(2);
const BIND_RETRY_DELAY: Duration = Duration::from_millis(25);
const BIND_ATTEMPTS: usize = 20;

#[derive(Default)]
pub struct CodexOAuthCallbackState {
    active: Mutex<ActiveCallback>,
}

#[derive(Default)]
struct ActiveCallback {
    generation: u64,
    cancel: Option<oneshot::Sender<()>>,
}

#[derive(Error, Debug, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "name")]
pub enum CodexOAuthCallbackError {
    #[error("Invalid Codex authorization URL: {message}")]
    InvalidAuthorizeUrl { message: String },

    #[error("Could not start the Codex sign-in callback: {message}")]
    CallbackBindFailed { message: String },

    #[error("Could not open the Codex sign-in page: {message}")]
    BrowserOpenFailed { message: String },

    #[error("Codex sign-in timed out: {message}")]
    CallbackTimeout { message: String },

    #[error("Could not read the Codex sign-in callback: {message}")]
    CallbackReadFailed { message: String },

    #[error("Invalid Codex sign-in callback: {message}")]
    InvalidCallbackRequest { message: String },

    #[error("Codex sign-in was rejected: {message}")]
    OAuthError { message: String },

    #[error("Codex sign-in state did not match: {message}")]
    StateMismatch { message: String },

    #[error("Codex sign-in did not return a code: {message}")]
    MissingCode { message: String },

    #[error("Codex sign-in was replaced: {message}")]
    CallbackReplaced { message: String },

    #[error("Could not manage the Codex sign-in callback: {message}")]
    CallbackLifecycleFailed { message: String },
}

impl CodexOAuthCallbackState {
    fn replace_active(&self) -> Result<(u64, oneshot::Receiver<()>), CodexOAuthCallbackError> {
        let (cancel, cancel_receiver) = oneshot::channel();
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let generation = active.generation.checked_add(1).ok_or_else(|| {
            CodexOAuthCallbackError::CallbackLifecycleFailed {
                message: "The callback generation limit was reached".to_string(),
            }
        })?;

        if let Some(previous_cancel) = active.cancel.take() {
            let _ = previous_cancel.send(());
        }

        active.generation = generation;
        active.cancel = Some(cancel);

        Ok((generation, cancel_receiver))
    }

    fn clear_if_current(&self, generation: u64) {
        let mut active = self
            .active
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        if active.generation == generation {
            active.cancel = None;
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn complete_codex_oauth_login(
    app: tauri::AppHandle,
    callback_state: tauri::State<'_, CodexOAuthCallbackState>,
    authorize_url: String,
    expected_state: String,
) -> Result<String, CodexOAuthCallbackError> {
    validate_authorization_url(&authorize_url, &expected_state)?;
    let (generation, cancel_receiver) = callback_state.replace_active()?;

    run_callback_attempt(
        &callback_state,
        generation,
        cancel_receiver,
        CALLBACK_ADDRESS,
        &expected_state,
        CALLBACK_TIMEOUT,
        move || {
            app.opener()
                .open_url(authorize_url, None::<String>)
                .map_err(|error| CodexOAuthCallbackError::BrowserOpenFailed {
                    message: error.to_string(),
                })
        },
    )
    .await
}

async fn run_callback_attempt<F>(
    callback_state: &CodexOAuthCallbackState,
    generation: u64,
    mut cancel_receiver: oneshot::Receiver<()>,
    address: &str,
    expected_state: &str,
    callback_timeout: Duration,
    on_bound: F,
) -> Result<String, CodexOAuthCallbackError>
where
    F: FnOnce() -> Result<(), CodexOAuthCallbackError>,
{
    let callback = async move {
        let listener = bind_callback_listener(address).await?;
        on_bound()?;

        timeout(callback_timeout, receive_callback(listener, expected_state))
            .await
            .map_err(|_| CodexOAuthCallbackError::CallbackTimeout {
                message: "No callback arrived within five minutes".to_string(),
            })?
    };

    tokio::pin!(callback);
    let result = tokio::select! {
        _ = &mut cancel_receiver => Err(CodexOAuthCallbackError::CallbackReplaced {
            message: "A newer Codex sign-in attempt replaced this one".to_string(),
        }),
        result = &mut callback => result,
    };

    callback_state.clear_if_current(generation);
    result
}

async fn bind_callback_listener(address: &str) -> Result<TcpListener, CodexOAuthCallbackError> {
    let mut attempts_remaining = BIND_ATTEMPTS;

    loop {
        match TcpListener::bind(address).await {
            Ok(listener) => return Ok(listener),
            Err(error) if error.kind() == ErrorKind::AddrInUse && attempts_remaining > 1 => {
                attempts_remaining -= 1;
                tokio::time::sleep(BIND_RETRY_DELAY).await;
            }
            Err(error) => {
                return Err(CodexOAuthCallbackError::CallbackBindFailed {
                    message: error.to_string(),
                });
            }
        }
    }
}

async fn receive_callback(
    listener: TcpListener,
    expected_state: &str,
) -> Result<String, CodexOAuthCallbackError> {
    receive_callback_with_read_timeout(&listener, expected_state, CONNECTION_READ_TIMEOUT).await
}

async fn receive_callback_with_read_timeout(
    listener: &TcpListener,
    expected_state: &str,
    read_timeout: Duration,
) -> Result<String, CodexOAuthCallbackError> {
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|error| {
            CodexOAuthCallbackError::CallbackReadFailed {
                message: error.to_string(),
            }
        })?;

        let callback = match timeout(read_timeout, read_http_request(&mut stream)).await {
            Ok(request) => {
                request.and_then(|request| parse_callback_request(&request, expected_state))
            }
            Err(_) => Err(CodexOAuthCallbackError::CallbackReadFailed {
                message: "The callback connection did not send a request in time".to_string(),
            }),
        };

        let response = http_response(callback.is_ok());
        let _ = stream.write_all(response.as_bytes()).await;

        match callback {
            Ok(code) => return Ok(code),
            Err(error) if should_retry_callback_error(&error) => continue,
            Err(error) => return Err(error),
        }
    }
}

fn should_retry_callback_error(error: &CodexOAuthCallbackError) -> bool {
    matches!(
        error,
        CodexOAuthCallbackError::CallbackReadFailed { .. }
            | CodexOAuthCallbackError::InvalidCallbackRequest { .. }
            | CodexOAuthCallbackError::StateMismatch { .. }
            | CodexOAuthCallbackError::MissingCode { .. }
    )
}

async fn read_http_request(stream: &mut TcpStream) -> Result<Vec<u8>, CodexOAuthCallbackError> {
    let mut request = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 1024];

    loop {
        let bytes_read = stream.read(&mut buffer).await.map_err(|error| {
            CodexOAuthCallbackError::CallbackReadFailed {
                message: error.to_string(),
            }
        })?;

        if bytes_read == 0 {
            return Err(CodexOAuthCallbackError::InvalidCallbackRequest {
                message: "The HTTP request ended before its headers were complete".to_string(),
            });
        }

        request.extend_from_slice(&buffer[..bytes_read]);

        if request.len() > MAX_REQUEST_BYTES {
            return Err(CodexOAuthCallbackError::InvalidCallbackRequest {
                message: "The HTTP request headers were too large".to_string(),
            });
        }

        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            return Ok(request);
        }
    }
}

fn validate_authorization_url(
    authorize_url: &str,
    expected_state: &str,
) -> Result<(), CodexOAuthCallbackError> {
    let url =
        Url::parse(authorize_url).map_err(|_| CodexOAuthCallbackError::InvalidAuthorizeUrl {
            message: "The URL could not be parsed".to_string(),
        })?;

    let is_valid_endpoint = url.scheme() == "https"
        && url.host_str() == Some("auth.openai.com")
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/oauth/authorize"
        && url.fragment().is_none();

    if !is_valid_endpoint {
        return Err(CodexOAuthCallbackError::InvalidAuthorizeUrl {
            message: "Expected the OpenAI OAuth authorization endpoint".to_string(),
        });
    }

    let redirect_uris = url
        .query_pairs()
        .filter_map(|(key, value)| (key == "redirect_uri").then_some(value))
        .collect::<Vec<_>>();

    if redirect_uris.len() != 1 || redirect_uris[0] != REDIRECT_URI {
        return Err(CodexOAuthCallbackError::InvalidAuthorizeUrl {
            message: "Expected the Whispering localhost callback URL".to_string(),
        });
    }

    let states = url
        .query_pairs()
        .filter_map(|(key, value)| (key == "state").then_some(value))
        .collect::<Vec<_>>();

    if expected_state.is_empty()
        || states.len() != 1
        || states[0].is_empty()
        || states[0] != expected_state
    {
        return Err(CodexOAuthCallbackError::InvalidAuthorizeUrl {
            message: "Expected one matching OAuth state parameter".to_string(),
        });
    }

    Ok(())
}

fn parse_callback_request(
    request: &[u8],
    expected_state: &str,
) -> Result<String, CodexOAuthCallbackError> {
    let request = std::str::from_utf8(request).map_err(|_| {
        CodexOAuthCallbackError::InvalidCallbackRequest {
            message: "The HTTP request was not valid UTF-8".to_string(),
        }
    })?;

    let request_line =
        request
            .lines()
            .next()
            .ok_or_else(|| CodexOAuthCallbackError::InvalidCallbackRequest {
                message: "The HTTP request line was missing".to_string(),
            })?;
    let request_parts = request_line.split_whitespace().collect::<Vec<_>>();

    if request_parts.len() != 3
        || request_parts[0] != "GET"
        || !matches!(request_parts[2], "HTTP/1.0" | "HTTP/1.1")
    {
        return Err(CodexOAuthCallbackError::InvalidCallbackRequest {
            message: "Expected an HTTP GET request".to_string(),
        });
    }

    if !request_parts[1].starts_with('/') {
        return Err(CodexOAuthCallbackError::InvalidCallbackRequest {
            message: "Expected an origin-form request target".to_string(),
        });
    }

    let callback_url =
        Url::parse(&format!("http://localhost{}", request_parts[1])).map_err(|_| {
            CodexOAuthCallbackError::InvalidCallbackRequest {
                message: "The callback URL could not be parsed".to_string(),
            }
        })?;

    if callback_url.path() != CALLBACK_PATH {
        return Err(CodexOAuthCallbackError::InvalidCallbackRequest {
            message: "The callback path did not match".to_string(),
        });
    }

    let state = single_query_parameter(&callback_url, "state")?.ok_or_else(|| {
        CodexOAuthCallbackError::StateMismatch {
            message: "The callback state was missing".to_string(),
        }
    })?;

    if state != expected_state {
        return Err(CodexOAuthCallbackError::StateMismatch {
            message: "The callback state was not the expected value".to_string(),
        });
    }

    if let Some(oauth_error) = single_query_parameter(&callback_url, "error")? {
        return Err(CodexOAuthCallbackError::OAuthError {
            message: oauth_error,
        });
    }

    match single_query_parameter(&callback_url, "code")? {
        Some(code) if !code.is_empty() => Ok(code),
        _ => Err(CodexOAuthCallbackError::MissingCode {
            message: "The callback code was missing".to_string(),
        }),
    }
}

fn single_query_parameter(
    url: &Url,
    name: &str,
) -> Result<Option<String>, CodexOAuthCallbackError> {
    let values = url
        .query_pairs()
        .filter_map(|(key, value)| (key == name).then_some(value.into_owned()))
        .collect::<Vec<_>>();

    if values.len() > 1 {
        return Err(CodexOAuthCallbackError::InvalidCallbackRequest {
            message: format!("The callback contained more than one {name} parameter"),
        });
    }

    Ok(values.into_iter().next())
}

fn http_response(success: bool) -> String {
    let (status, title, message) = if success {
        (
            "200 OK",
            "Connected to Codex",
            "You can close this window and return to Whispering.",
        )
    } else {
        (
            "400 Bad Request",
            "Codex connection failed",
            "Return to Whispering and try again.",
        )
    };
    let body = format!(
        "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{title}</title><body><main><h1>{title}</h1><p>{message}</p></main></body></html>"
    );

    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_AUTHORIZE_URL: &str = "https://auth.openai.com/oauth/authorize?client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=expected";

    #[test]
    fn validates_the_openai_authorization_url() {
        assert_eq!(
            validate_authorization_url(VALID_AUTHORIZE_URL, "expected"),
            Ok(())
        );
    }

    #[test]
    fn rejects_an_untrusted_authorization_url() {
        for authorize_url in [
            "http://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback",
            "https://example.com/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback",
            "https://auth.openai.com/other?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback",
            "https://auth.openai.com/oauth/authorize?redirect_uri=https%3A%2F%2Fexample.com%2Fcallback",
        ] {
            assert!(matches!(
                validate_authorization_url(authorize_url, "expected"),
                Err(CodexOAuthCallbackError::InvalidAuthorizeUrl { .. })
            ));
        }
    }

    #[test]
    fn rejects_authorization_url_state_mismatch_or_duplicates() {
        for (authorize_url, expected_state) in [
            (
                "https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=wrong",
                "expected",
            ),
            (
                "https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=expected&state=expected",
                "expected",
            ),
            (
                "https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=",
                "expected",
            ),
            (
                "https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=expected",
                "",
            ),
        ] {
            assert!(matches!(
                validate_authorization_url(authorize_url, expected_state),
                Err(CodexOAuthCallbackError::InvalidAuthorizeUrl { .. })
            ));
        }
    }

    #[test]
    fn parses_and_decodes_a_valid_callback() {
        let request = b"GET /auth/callback?code=code%2Fvalue&state=expected HTTP/1.1\r\nHost: localhost:1455\r\n\r\n";

        assert_eq!(
            parse_callback_request(request, "expected"),
            Ok("code/value".to_string())
        );
    }

    #[test]
    fn rejects_an_invalid_callback_method_path_or_state() {
        let requests: &[&[u8]] = &[
            b"POST /auth/callback?code=value&state=expected HTTP/1.1\r\n\r\n",
            b"GET /other?code=value&state=expected HTTP/1.1\r\n\r\n",
            b"GET /auth/callback?code=value&state=wrong HTTP/1.1\r\n\r\n",
        ];

        for request in requests {
            assert!(parse_callback_request(request, "expected").is_err());
        }
    }

    #[test]
    fn rejects_an_oauth_error_or_missing_code() {
        let oauth_error = b"GET /auth/callback?error=access_denied&state=expected HTTP/1.1\r\n\r\n";
        let missing_code = b"GET /auth/callback?state=expected HTTP/1.1\r\n\r\n";

        assert!(matches!(
            parse_callback_request(oauth_error, "expected"),
            Err(CodexOAuthCallbackError::OAuthError { .. })
        ));
        assert!(matches!(
            parse_callback_request(missing_code, "expected"),
            Err(CodexOAuthCallbackError::MissingCode { .. })
        ));
    }

    #[tokio::test]
    async fn keeps_listening_after_a_stalled_or_invalid_connection() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let callback = tokio::spawn(async move {
            receive_callback_with_read_timeout(&listener, "expected", Duration::from_millis(20))
                .await
        });

        let stalled_connection = TcpStream::connect(address).await.unwrap();
        tokio::time::sleep(Duration::from_millis(40)).await;

        let mut invalid_connection = TcpStream::connect(address).await.unwrap();
        invalid_connection
            .write_all(b"GET /noise HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .await
            .unwrap();
        invalid_connection.shutdown().await.unwrap();

        let mut valid_connection = TcpStream::connect(address).await.unwrap();
        valid_connection
            .write_all(
                b"GET /auth/callback?code=accepted&state=expected HTTP/1.1\r\nHost: localhost:1455\r\n\r\n",
            )
            .await
            .unwrap();

        let code = timeout(Duration::from_secs(1), callback)
            .await
            .unwrap()
            .unwrap()
            .unwrap();

        drop(stalled_connection);
        assert_eq!(code, "accepted");
    }

    #[tokio::test]
    async fn returns_a_matching_oauth_error_after_writing_failure_html() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let callback = tokio::spawn(receive_callback(listener, "expected"));

        let mut connection = TcpStream::connect(address).await.unwrap();
        connection
            .write_all(
                b"GET /auth/callback?error=access_denied&state=expected HTTP/1.1\r\nHost: localhost:1455\r\n\r\n",
            )
            .await
            .unwrap();
        connection.shutdown().await.unwrap();

        let callback_error = callback.await.unwrap().unwrap_err();
        let mut response = String::new();
        connection.read_to_string(&mut response).await.unwrap();

        assert!(matches!(
            callback_error,
            CodexOAuthCallbackError::OAuthError { .. }
        ));
        assert!(response.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        assert!(response.contains("Codex connection failed"));

        drop(connection);
        let rebound_listener = TcpListener::bind(address).await.unwrap();
        drop(rebound_listener);
    }

    #[tokio::test]
    async fn returns_a_valid_code_after_the_client_closes() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let callback = tokio::spawn(receive_callback(listener, "expected"));

        let mut connection = TcpStream::connect(address).await.unwrap();
        connection
            .write_all(
                b"GET /auth/callback?code=accepted&state=expected HTTP/1.1\r\nHost: localhost:1455\r\n\r\n",
            )
            .await
            .unwrap();
        connection.shutdown().await.unwrap();
        drop(connection);

        let code = callback.await.unwrap().unwrap();

        assert_eq!(code, "accepted");
    }

    #[tokio::test]
    async fn a_new_attempt_replaces_the_active_listener() {
        let reservation = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = reservation.local_addr().unwrap();
        drop(reservation);

        let callback_state = std::sync::Arc::new(CodexOAuthCallbackState::default());
        let (first_generation, first_cancel) = callback_state.replace_active().unwrap();
        let (first_bound, first_bound_receiver) = oneshot::channel();
        let first_state = std::sync::Arc::clone(&callback_state);
        let first_address = address.to_string();
        let first_attempt = tokio::spawn(async move {
            run_callback_attempt(
                first_state.as_ref(),
                first_generation,
                first_cancel,
                &first_address,
                "first-state",
                Duration::from_secs(2),
                move || {
                    let _ = first_bound.send(());
                    Ok(())
                },
            )
            .await
        });
        first_bound_receiver.await.unwrap();

        let (replacement_generation, replacement_cancel) = callback_state.replace_active().unwrap();
        let (replacement_bound, replacement_bound_receiver) = oneshot::channel();
        let replacement_state = std::sync::Arc::clone(&callback_state);
        let replacement_address = address.to_string();
        let replacement_attempt = tokio::spawn(async move {
            run_callback_attempt(
                replacement_state.as_ref(),
                replacement_generation,
                replacement_cancel,
                &replacement_address,
                "replacement-state",
                Duration::from_secs(2),
                move || {
                    let _ = replacement_bound.send(());
                    Ok(())
                },
            )
            .await
        });

        let first_error = timeout(Duration::from_secs(1), first_attempt)
            .await
            .unwrap()
            .unwrap()
            .unwrap_err();
        assert!(matches!(
            first_error,
            CodexOAuthCallbackError::CallbackReplaced { .. }
        ));
        timeout(Duration::from_secs(1), replacement_bound_receiver)
            .await
            .unwrap()
            .unwrap();

        let mut connection = TcpStream::connect(address).await.unwrap();
        connection
            .write_all(
                b"GET /auth/callback?code=replacement-code&state=replacement-state HTTP/1.1\r\nHost: localhost\r\n\r\n",
            )
            .await
            .unwrap();

        let replacement_code = timeout(Duration::from_secs(1), replacement_attempt)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(replacement_code, "replacement-code");
    }

    #[test]
    fn creates_success_and_failure_html_responses() {
        let success = http_response(true);
        let failure = http_response(false);

        assert!(success.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(success.contains("Connected to Codex"));
        assert!(failure.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        assert!(failure.contains("Codex connection failed"));
        assert!(success.contains("Cache-Control: no-store"));
        assert!(failure.contains("Cache-Control: no-store"));
    }

    #[test]
    fn serializes_command_errors_as_discriminated_objects() {
        let error = CodexOAuthCallbackError::StateMismatch {
            message: "The callback state was not the expected value".to_string(),
        };

        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "name": "StateMismatch",
                "message": "The callback state was not the expected value"
            })
        );

        let replaced = CodexOAuthCallbackError::CallbackReplaced {
            message: "A newer Codex sign-in attempt replaced this one".to_string(),
        };

        assert_eq!(
            serde_json::to_value(replaced).unwrap(),
            serde_json::json!({
                "name": "CallbackReplaced",
                "message": "A newer Codex sign-in attempt replaced this one"
            })
        );
    }
}
