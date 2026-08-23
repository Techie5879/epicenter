use serde::{Deserialize, Serialize};
use std::{future::Future, io::ErrorKind, sync::Mutex, time::Duration};
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
    cancel: Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Error, Debug, Serialize, Deserialize, specta::Type, PartialEq, Eq)]
#[serde(tag = "name")]
pub enum CodexOAuthCallbackError {
    #[error("Invalid Codex authorization URL: {message}")]
    InvalidAuthorizeUrl { message: String },

    #[error("Codex sign-in failed: {message}")]
    CallbackFailed { message: String },

    #[error("Codex sign-in timed out: {message}")]
    CallbackTimeout { message: String },

    #[error("Codex sign-in was rejected: {message}")]
    OAuthError { message: String },

    #[error("Codex sign-in was replaced: {message}")]
    CallbackReplaced { message: String },
}

impl CodexOAuthCallbackState {
    fn replace_active(&self) -> oneshot::Receiver<()> {
        let (cancel, cancel_receiver) = oneshot::channel();
        let previous = self
            .cancel
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .replace(cancel);
        if let Some(previous_cancel) = previous {
            let _ = previous_cancel.send(());
        }

        cancel_receiver
    }
}

#[derive(Debug, PartialEq, Eq)]
enum CallbackRequestError {
    Invalid,
    OAuth(String),
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
    let cancel_receiver = callback_state.replace_active();

    settle_callback_attempt(cancel_receiver, async move {
        let listener = bind_callback_listener(CALLBACK_ADDRESS).await?;
        app.opener()
            .open_url(authorize_url, None::<String>)
            .map_err(|error| CodexOAuthCallbackError::CallbackFailed {
                message: format!("Could not open the authorization URL: {error}"),
            })?;

        timeout(
            CALLBACK_TIMEOUT,
            receive_callback(listener, &expected_state),
        )
        .await
        .map_err(|_| CodexOAuthCallbackError::CallbackTimeout {
            message: "No callback arrived within five minutes".to_string(),
        })?
    })
    .await
}

async fn settle_callback_attempt<F>(
    mut cancel_receiver: oneshot::Receiver<()>,
    callback: F,
) -> Result<String, CodexOAuthCallbackError>
where
    F: Future<Output = Result<String, CodexOAuthCallbackError>>,
{
    tokio::pin!(callback);
    tokio::select! {
        biased;
        _ = &mut cancel_receiver => Err(CodexOAuthCallbackError::CallbackReplaced {
            message: "A newer Codex sign-in attempt replaced this one".to_string(),
        }),
        result = &mut callback => result,
    }
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
                return Err(CodexOAuthCallbackError::CallbackFailed {
                    message: format!("Could not bind the localhost callback: {error}"),
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
        let (mut stream, _) =
            listener
                .accept()
                .await
                .map_err(|error| CodexOAuthCallbackError::CallbackFailed {
                    message: format!("Could not accept the localhost callback: {error}"),
                })?;

        let callback = match timeout(read_timeout, read_http_request(&mut stream)).await {
            Ok(Ok(request)) => parse_callback_request(&request, expected_state),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(CallbackRequestError::Invalid),
        };

        let response = http_response(callback.is_ok());
        let _ = stream.write_all(response.as_bytes()).await;

        match callback {
            Ok(code) => return Ok(code),
            Err(CallbackRequestError::Invalid) => continue,
            Err(CallbackRequestError::OAuth(message)) => {
                return Err(CodexOAuthCallbackError::OAuthError { message });
            }
        }
    }
}

async fn read_http_request(stream: &mut TcpStream) -> Result<Vec<u8>, CallbackRequestError> {
    let mut request = Vec::with_capacity(1024);
    let mut buffer = [0_u8; 1024];

    loop {
        let bytes_read = stream
            .read(&mut buffer)
            .await
            .map_err(|_| CallbackRequestError::Invalid)?;

        if bytes_read == 0 {
            return Err(CallbackRequestError::Invalid);
        }

        request.extend_from_slice(&buffer[..bytes_read]);

        if request.len() > MAX_REQUEST_BYTES {
            return Err(CallbackRequestError::Invalid);
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
) -> Result<String, CallbackRequestError> {
    let request = std::str::from_utf8(request).map_err(|_| CallbackRequestError::Invalid)?;

    let request_line = request
        .lines()
        .next()
        .ok_or(CallbackRequestError::Invalid)?;
    let request_parts = request_line.split_whitespace().collect::<Vec<_>>();

    if request_parts.len() != 3
        || request_parts[0] != "GET"
        || !matches!(request_parts[2], "HTTP/1.0" | "HTTP/1.1")
    {
        return Err(CallbackRequestError::Invalid);
    }

    if !request_parts[1].starts_with('/') {
        return Err(CallbackRequestError::Invalid);
    }

    let callback_url = Url::parse(&format!("http://localhost{}", request_parts[1]))
        .map_err(|_| CallbackRequestError::Invalid)?;

    if callback_url.path() != CALLBACK_PATH {
        return Err(CallbackRequestError::Invalid);
    }

    let state =
        single_query_parameter(&callback_url, "state")?.ok_or(CallbackRequestError::Invalid)?;

    if state != expected_state {
        return Err(CallbackRequestError::Invalid);
    }

    if let Some(oauth_error) = single_query_parameter(&callback_url, "error")? {
        return Err(CallbackRequestError::OAuth(oauth_error));
    }

    match single_query_parameter(&callback_url, "code")? {
        Some(code) if !code.is_empty() => Ok(code),
        _ => Err(CallbackRequestError::Invalid),
    }
}

fn single_query_parameter(url: &Url, name: &str) -> Result<Option<String>, CallbackRequestError> {
    let values = url
        .query_pairs()
        .filter_map(|(key, value)| (key == name).then_some(value.into_owned()))
        .collect::<Vec<_>>();

    if values.len() > 1 {
        return Err(CallbackRequestError::Invalid);
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
            Err(CallbackRequestError::OAuth(_))
        ));
        assert!(matches!(
            parse_callback_request(missing_code, "expected"),
            Err(CallbackRequestError::Invalid)
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
    async fn cancellation_wins_when_a_stale_callback_is_already_ready() {
        let callback_state = CodexOAuthCallbackState::default();
        let stale_cancel = callback_state.replace_active();
        let _current_cancel = callback_state.replace_active();

        let result = settle_callback_attempt(
            stale_cancel,
            std::future::ready(Ok("stale-code".to_string())),
        )
        .await;

        assert!(matches!(
            result,
            Err(CodexOAuthCallbackError::CallbackReplaced { .. })
        ));
    }

    #[tokio::test]
    async fn replacement_cancels_the_listener_then_rebinds_and_completes() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);

        let callback_state = CodexOAuthCallbackState::default();
        let first_cancel = callback_state.replace_active();
        let (first_bound, first_bound_receiver) = oneshot::channel();
        let first_address = address.to_string();
        let first = tokio::spawn(async move {
            settle_callback_attempt(first_cancel, async move {
                let listener = bind_callback_listener(&first_address).await?;
                let _ = first_bound.send(());
                receive_callback(listener, "first-state").await
            })
            .await
        });
        first_bound_receiver.await.unwrap();

        let replacement_cancel = callback_state.replace_active();
        let (replacement_bound, replacement_bound_receiver) = oneshot::channel();
        let replacement_address = address.to_string();
        let replacement = tokio::spawn(async move {
            settle_callback_attempt(replacement_cancel, async move {
                let listener = bind_callback_listener(&replacement_address).await?;
                let _ = replacement_bound.send(());
                receive_callback(listener, "replacement-state").await
            })
            .await
        });

        assert!(matches!(
            first.await.unwrap(),
            Err(CodexOAuthCallbackError::CallbackReplaced { .. })
        ));
        timeout(Duration::from_secs(1), replacement_bound_receiver)
            .await
            .unwrap()
            .unwrap();

        let mut connection = TcpStream::connect(address).await.unwrap();
        connection
            .write_all(
                b"GET /auth/callback?code=replacement-code&state=replacement-state HTTP/1.1\r\nHost: localhost:1455\r\n\r\n",
            )
            .await
            .unwrap();
        connection.shutdown().await.unwrap();

        assert_eq!(replacement.await.unwrap().unwrap(), "replacement-code");
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
        let error = CodexOAuthCallbackError::CallbackFailed {
            message: "Could not bind the localhost callback".to_string(),
        };

        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({
                "name": "CallbackFailed",
                "message": "Could not bind the localhost callback"
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
