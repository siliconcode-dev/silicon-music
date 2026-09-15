//! Spotify OAuth (Authorization Code + PKCE) and the Spotify side of the
//! multi-account model. Mirrors the YouTube Music account pattern in
//! `lib.rs` (a JSON index + a per-account encrypted secret) but stores
//! OAuth tokens instead of a cookie jar, since the Spotify Web API needs
//! nothing else.
//!
//! No client secret is stored or requested anywhere: PKCE means the
//! Client ID is the only credential this app needs, and it is not a
//! secret (Spotify's own docs treat it as public). Unlike the shared
//! Discord/Last.fm credentials baked in at build time, each user must
//! register their own Spotify Developer app and paste their own Client ID
//! into Settings — Spotify's Development Mode caps an app at a handful of
//! authorized users, so one shared Client ID baked into a public build
//! would stop working the moment more than a few people used it. See
//! docs/spotify-integration.md.
//!
//! The dormant cookie-based auth path described in the project plan (for
//! a possible future presence-broadcast feature) is NOT implemented here
//! yet — this module only covers the official OAuth path that v0.7.0's
//! import/sync features actually use.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::{extract::Query, extract::State as AxumState, response::Html, routing::get, Router};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Emitter, Manager};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex, Notify};

use crate::{secure_store, write_atomic};

const AUTHORIZE_URL: &str = "https://accounts.spotify.com/authorize";
const TOKEN_URL: &str = "https://accounts.spotify.com/api/token";
const PROFILE_URL: &str = "https://api.spotify.com/v1/me";
const SCOPES: &str = "playlist-read-private playlist-read-collaborative playlist-modify-private playlist-modify-public user-read-private";
/// How long a login attempt stays valid: the loopback server shuts itself
/// down after this even if the user never finishes the browser flow, and
/// `spotify_await_login` gives up waiting at the same mark.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(300);

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/* -------------------------------------------------------------------- */
/* Persisted data                                                        */
/* -------------------------------------------------------------------- */

/// Per-account metadata persisted in `spotify_accounts.json`. Tokens are
/// NOT stored here — they live encrypted under
/// `spotify_accounts/<id>/tokens.enc`. `id` is Spotify's own user id
/// (stable, unique), unlike YTM's generated ids, so re-linking the same
/// Spotify account naturally overwrites rather than duplicates.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpotifyAccount {
    id: String,
    display_name: String,
    #[serde(default)]
    email: String,
    #[serde(default)]
    avatar_url: Option<String>,
    added_at: i64,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SpotifyAccountsIndex {
    #[serde(default)]
    active: Option<String>,
    #[serde(default)]
    accounts: Vec<SpotifyAccount>,
}

/// What we hand back to the frontend.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpotifyAccountSummary {
    id: String,
    display_name: String,
    email: String,
    avatar_url: Option<String>,
    is_active: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SpotifyTokens {
    access_token: String,
    refresh_token: String,
    /// Unix seconds when `access_token` expires.
    expires_at: i64,
    #[serde(default)]
    scope: String,
}

fn spotify_accounts_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("spotify_accounts")
}

fn spotify_index_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("spotify_accounts.json")
}

fn spotify_tokens_path(app: &tauri::AppHandle, id: &str) -> PathBuf {
    spotify_accounts_dir(app).join(id).join("tokens.enc")
}

async fn read_spotify_index(app: &tauri::AppHandle) -> SpotifyAccountsIndex {
    let path = spotify_index_path(app);
    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return SpotifyAccountsIndex::default()
        }
        Err(e) => {
            eprintln!("[spotify] read spotify_accounts.json failed: {e}");
            return SpotifyAccountsIndex::default();
        }
    };
    serde_json::from_slice(&bytes).unwrap_or_else(|e| {
        eprintln!("[spotify] spotify_accounts.json is unparseable: {e}");
        SpotifyAccountsIndex::default()
    })
}

async fn write_spotify_index(
    app: &tauri::AppHandle,
    idx: &SpotifyAccountsIndex,
) -> Result<(), String> {
    let path = spotify_index_path(app);
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| format!("mkdir spotify_accounts dir: {e}"))?;
    }
    let bytes = serde_json::to_vec_pretty(idx).map_err(|e| format!("serialize: {e}"))?;
    write_atomic(&path, &bytes)
        .await
        .map_err(|e| format!("write spotify index: {e}"))
}

async fn read_tokens(app: &tauri::AppHandle, id: &str) -> Result<SpotifyTokens, String> {
    let path = spotify_tokens_path(app, id);
    let encrypted = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("read tokens: {e}"))?;
    let plain = secure_store::decrypt(&encrypted)?;
    serde_json::from_slice(&plain).map_err(|e| format!("parse tokens: {e}"))
}

async fn write_tokens(
    app: &tauri::AppHandle,
    id: &str,
    tokens: &SpotifyTokens,
) -> Result<(), String> {
    let path = spotify_tokens_path(app, id);
    if let Some(dir) = path.parent() {
        tokio::fs::create_dir_all(dir)
            .await
            .map_err(|e| format!("mkdir spotify account dir: {e}"))?;
    }
    let plain = serde_json::to_vec(tokens).map_err(|e| format!("serialize tokens: {e}"))?;
    let encrypted = secure_store::encrypt(&plain)?;
    write_atomic(&path, &encrypted)
        .await
        .map_err(|e| format!("write tokens: {e}"))
}

/* -------------------------------------------------------------------- */
/* PKCE                                                                  */
/* -------------------------------------------------------------------- */

fn random_url_safe(len: usize) -> String {
    let mut bytes = vec![0u8; len];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// RFC 7636 `code_challenge` (S256): base64url(sha256(code_verifier)).
fn code_challenge(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

/* -------------------------------------------------------------------- */
/* Token exchange / refresh / profile                                    */
/* -------------------------------------------------------------------- */

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    expires_in: i64,
    #[serde(default)]
    scope: String,
}

#[derive(Deserialize)]
struct ProfileImage {
    url: String,
}

#[derive(Deserialize)]
struct ProfileResponse {
    id: String,
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    images: Vec<ProfileImage>,
}

async fn exchange_code(
    client: &reqwest::Client,
    client_id: &str,
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<SpotifyTokens, String> {
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("code", code),
            ("redirect_uri", redirect_uri),
            ("client_id", client_id),
            ("code_verifier", code_verifier),
        ])
        .send()
        .await
        .map_err(|e| format!("token request failed: {e}"))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("reading token response: {e}"))?;
    if !status.is_success() {
        return Err(format!("Spotify rejected the token exchange: {text}"));
    }
    let parsed: TokenResponse =
        serde_json::from_str(&text).map_err(|e| format!("bad token response: {e}"))?;
    let refresh_token = parsed
        .refresh_token
        .ok_or_else(|| "Spotify did not return a refresh token".to_string())?;
    Ok(SpotifyTokens {
        access_token: parsed.access_token,
        refresh_token,
        expires_at: now_unix() + parsed.expires_in,
        scope: parsed.scope,
    })
}

async fn refresh_tokens(
    client: &reqwest::Client,
    client_id: &str,
    refresh_token: &str,
) -> Result<(String, i64, Option<String>), String> {
    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
        ])
        .send()
        .await
        .map_err(|e| format!("refresh request failed: {e}"))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("reading refresh response: {e}"))?;
    if !status.is_success() {
        return Err(format!("Spotify rejected the token refresh: {text}"));
    }
    let parsed: TokenResponse =
        serde_json::from_str(&text).map_err(|e| format!("bad refresh response: {e}"))?;
    Ok((
        parsed.access_token,
        now_unix() + parsed.expires_in,
        // Spotify only sometimes rotates the refresh token; keep the old
        // one when it doesn't.
        parsed.refresh_token,
    ))
}

async fn fetch_profile(client: &reqwest::Client, access_token: &str) -> Result<SpotifyAccount, String> {
    let resp = client
        .get(PROFILE_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("profile request failed: {e}"))?;
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("reading profile response: {e}"))?;
    if !status.is_success() {
        return Err(format!("could not read the Spotify profile: {text}"));
    }
    let parsed: ProfileResponse =
        serde_json::from_str(&text).map_err(|e| format!("bad profile response: {e}"))?;
    Ok(SpotifyAccount {
        id: parsed.id,
        display_name: parsed.display_name.unwrap_or_else(|| "Spotify user".into()),
        email: parsed.email.unwrap_or_default(),
        avatar_url: parsed.images.into_iter().next().map(|i| i.url),
        added_at: now_unix(),
    })
}

/* -------------------------------------------------------------------- */
/* Loopback callback server                                              */
/* -------------------------------------------------------------------- */

type LoginResult = Result<(SpotifyAccount, SpotifyTokens), String>;

#[derive(Clone)]
struct CallbackCtx {
    expected_state: String,
    client_id: String,
    code_verifier: String,
    redirect_uri: String,
    tx: Arc<Mutex<Option<oneshot::Sender<LoginResult>>>>,
    done: Arc<Notify>,
}

const CALLBACK_OK_HTML: &str = "<!doctype html><html><body style=\"font-family:sans-serif;\
    background:#0a0a0a;color:#eee;display:flex;align-items:center;justify-content:center;\
    height:100vh;margin:0;\"><p>Spotify connected. You can close this tab and return to \
    Silicon Music.</p></body></html>";
const CALLBACK_ERR_HTML: &str = "<!doctype html><html><body style=\"font-family:sans-serif;\
    background:#0a0a0a;color:#eee;display:flex;align-items:center;justify-content:center;\
    height:100vh;margin:0;\"><p>Something went wrong connecting Spotify. You can close this \
    tab and try again from Silicon Music.</p></body></html>";

async fn callback_handler(
    AxumState(ctx): AxumState<CallbackCtx>,
    Query(params): Query<HashMap<String, String>>,
) -> Html<&'static str> {
    let result = handle_callback(&ctx, &params).await;
    let ok = result.is_ok();
    if let Some(tx) = ctx.tx.lock().await.take() {
        let _ = tx.send(result);
    }
    ctx.done.notify_one();
    Html(if ok { CALLBACK_OK_HTML } else { CALLBACK_ERR_HTML })
}

async fn handle_callback(ctx: &CallbackCtx, params: &HashMap<String, String>) -> LoginResult {
    if let Some(err) = params.get("error") {
        return Err(format!("Spotify login was not completed: {err}"));
    }
    let state = params.get("state").ok_or("missing state parameter")?;
    if state != &ctx.expected_state {
        // Never happens for a real Spotify redirect; guards against a
        // stray request hitting the loopback port during the login window.
        return Err("state mismatch".into());
    }
    let code = params.get("code").ok_or("missing code parameter")?;

    let client = reqwest::Client::new();
    let tokens = exchange_code(
        &client,
        &ctx.client_id,
        code,
        &ctx.redirect_uri,
        &ctx.code_verifier,
    )
    .await?;
    let account = fetch_profile(&client, &tokens.access_token).await?;
    Ok((account, tokens))
}

/// Binds an ephemeral loopback port, spawns the one-shot callback server,
/// and returns the redirect URI to use in the authorize URL along with the
/// receiver that resolves once the browser redirects back (or the login
/// times out / is cancelled).
async fn spawn_callback_server(
    expected_state: String,
    client_id: String,
    code_verifier: String,
) -> Result<(String, oneshot::Receiver<LoginResult>), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("could not open a local port for the Spotify login: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("could not read the local port: {e}"))?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let (tx, rx) = oneshot::channel();
    let done = Arc::new(Notify::new());
    let ctx = CallbackCtx {
        expected_state,
        client_id,
        code_verifier,
        redirect_uri: redirect_uri.clone(),
        tx: Arc::new(Mutex::new(Some(tx))),
        done: done.clone(),
    };
    let router = Router::new()
        .route("/callback", get(callback_handler))
        .with_state(ctx);

    tokio::spawn(async move {
        let shutdown = async move {
            tokio::select! {
                _ = done.notified() => {}
                _ = tokio::time::sleep(LOGIN_TIMEOUT) => {}
            }
        };
        if let Err(e) = axum::serve(listener, router)
            .with_graceful_shutdown(shutdown)
            .await
        {
            eprintln!("[spotify] loopback callback server error: {e}");
        }
    });

    Ok((redirect_uri, rx))
}

/* -------------------------------------------------------------------- */
/* Tauri commands                                                        */
/* -------------------------------------------------------------------- */

/// Tracks logins that have started but not yet completed, keyed by a
/// random id handed to the frontend. Managed as Tauri state.
#[derive(Default)]
pub struct SpotifyLoginState(Mutex<HashMap<String, oneshot::Receiver<LoginResult>>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BeginLoginResponse {
    login_id: String,
    authorize_url: String,
}

/// Starts a Spotify login: binds a loopback listener, builds the
/// authorize URL, and returns it for the frontend to open in the system
/// browser (via the existing `openUrl` helper, same as the Last.fm
/// connect flow). Call `spotify_await_login` with the returned `loginId`
/// to wait for the user to finish in the browser.
#[tauri::command]
pub async fn spotify_begin_login(
    state: tauri::State<'_, SpotifyLoginState>,
    client_id: String,
) -> Result<BeginLoginResponse, String> {
    if client_id.trim().is_empty() {
        return Err("Spotify Client ID is not set".into());
    }
    let verifier = random_url_safe(64);
    let challenge = code_challenge(&verifier);
    let csrf_state = random_url_safe(16);

    let (redirect_uri, rx) =
        spawn_callback_server(csrf_state.clone(), client_id.clone(), verifier).await?;

    let authorize_url = format!(
        "{AUTHORIZE_URL}?response_type=code&client_id={client}&scope={scope}\
         &redirect_uri={redirect}&state={state}&code_challenge_method=S256\
         &code_challenge={challenge}",
        client = urlencoding::encode(&client_id),
        scope = urlencoding::encode(SCOPES),
        redirect = urlencoding::encode(&redirect_uri),
        state = urlencoding::encode(&csrf_state),
        challenge = urlencoding::encode(&challenge),
    );

    let login_id = random_url_safe(12);
    state.0.lock().await.insert(login_id.clone(), rx);

    Ok(BeginLoginResponse {
        login_id,
        authorize_url,
    })
}

/// Awaits the browser redirect for a login started with
/// `spotify_begin_login`, persists the account + encrypted tokens on
/// success, makes it the active Spotify account, and returns its summary.
#[tauri::command]
pub async fn spotify_await_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, SpotifyLoginState>,
    login_id: String,
) -> Result<SpotifyAccountSummary, String> {
    let rx = state
        .0
        .lock()
        .await
        .remove(&login_id)
        .ok_or("unknown or already-consumed login")?;

    let (account, tokens) = tokio::time::timeout(LOGIN_TIMEOUT, rx)
        .await
        .map_err(|_| "Spotify login timed out".to_string())?
        .map_err(|_| "Spotify login was cancelled".to_string())??;

    write_tokens(&app, &account.id, &tokens).await?;

    let mut idx = read_spotify_index(&app).await;
    if let Some(existing) = idx.accounts.iter_mut().find(|a| a.id == account.id) {
        *existing = account.clone();
    } else {
        idx.accounts.push(account.clone());
    }
    idx.active = Some(account.id.clone());
    write_spotify_index(&app, &idx).await?;
    let _ = app.emit("spotify-accounts-changed", ());

    Ok(SpotifyAccountSummary {
        id: account.id,
        display_name: account.display_name,
        email: account.email,
        avatar_url: account.avatar_url,
        is_active: true,
    })
}

#[tauri::command]
pub async fn spotify_list_accounts(
    app: tauri::AppHandle,
) -> Result<Vec<SpotifyAccountSummary>, String> {
    let idx = read_spotify_index(&app).await;
    let active = idx.active.clone();
    Ok(idx
        .accounts
        .into_iter()
        .map(|a| SpotifyAccountSummary {
            is_active: active.as_deref() == Some(a.id.as_str()),
            id: a.id,
            display_name: a.display_name,
            email: a.email,
            avatar_url: a.avatar_url,
        })
        .collect())
}

#[tauri::command]
pub async fn spotify_switch_account(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut idx = read_spotify_index(&app).await;
    if !idx.accounts.iter().any(|a| a.id == id) {
        return Err(format!("no such Spotify account: {id}"));
    }
    idx.active = Some(id);
    write_spotify_index(&app, &idx).await?;
    let _ = app.emit("spotify-accounts-changed", ());
    Ok(())
}

/// Removes a linked Spotify account and its encrypted tokens. Does not
/// revoke the grant on Spotify's side — there is no API for that; the
/// user can revoke it from their Spotify account's app-access settings.
#[tauri::command]
pub async fn spotify_logout(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let mut idx = read_spotify_index(&app).await;
    let pos = idx
        .accounts
        .iter()
        .position(|a| a.id == id)
        .ok_or_else(|| format!("no such Spotify account: {id}"))?;
    idx.accounts.remove(pos);
    if idx.active.as_deref() == Some(id.as_str()) {
        idx.active = idx.accounts.first().map(|a| a.id.clone());
    }
    write_spotify_index(&app, &idx).await?;
    let dir = spotify_accounts_dir(&app).join(&id);
    if dir.exists() {
        let _ = tokio::fs::remove_dir_all(&dir).await;
    }
    let _ = app.emit("spotify-accounts-changed", ());
    Ok(())
}

/// Returns a valid access token for the given account (or the active one
/// when `id` is `None`), refreshing it first if it's expired or close to
/// it. The frontend never sees the refresh token, only this short-lived
/// access token, mirroring how YTM only ever exposes a derived cookie
/// header rather than the raw jar.
#[tauri::command]
pub async fn spotify_get_access_token(
    app: tauri::AppHandle,
    client_id: String,
    id: Option<String>,
) -> Result<String, String> {
    let idx = read_spotify_index(&app).await;
    let id = match id {
        Some(id) => id,
        None => idx
            .active
            .clone()
            .ok_or("no Spotify account is connected")?,
    };
    let mut tokens = read_tokens(&app, &id).await?;

    // Refresh a little before actual expiry so a request in flight
    // doesn't race the token dying mid-call.
    if tokens.expires_at <= now_unix() + 60 {
        let client = reqwest::Client::new();
        let (access_token, expires_at, rotated_refresh) =
            refresh_tokens(&client, &client_id, &tokens.refresh_token).await?;
        tokens.access_token = access_token;
        tokens.expires_at = expires_at;
        if let Some(rotated) = rotated_refresh {
            tokens.refresh_token = rotated;
        }
        write_tokens(&app, &id, &tokens).await?;
    }

    Ok(tokens.access_token)
}
