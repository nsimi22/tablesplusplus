//! Optional per-connection SSH tunnel: a local TCP listener that forwards each accepted
//! connection over an SSH `direct-tcpip` channel to the database host. The database client then
//! connects to the local address instead of the real host, so the DB traffic rides the SSH
//! session. The tunnel is kept alive for the connection's lifetime (held by `DbConnection`) and
//! torn down when the connection is dropped/disconnected.
//!
//! v1 limitations (documented): the server host key is accepted without `known_hosts`
//! verification, and `agent` auth is not yet supported.

use std::net::SocketAddr;
use std::sync::Arc;

use russh::client;
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use crate::db::client::{SshAuthMethod, SshConfig};
use crate::error::{AppError, ErrorKind};

/// A live SSH tunnel. Dropping it aborts the accept loop and closes the SSH session.
pub struct SshTunnel {
    local_addr: SocketAddr,
    accept_task: JoinHandle<()>,
    // Kept alive so the SSH session stays open while the tunnel is in use.
    _session: Arc<client::Handle<Handler>>,
}

impl SshTunnel {
    /// The local `127.0.0.1:<ephemeral>` address the database client should connect to.
    pub fn local_addr(&self) -> SocketAddr {
        self.local_addr
    }
}

impl Drop for SshTunnel {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

/// russh client handler. Accepts the server key (v1 — no `known_hosts` check).
struct Handler;

#[async_trait::async_trait]
impl client::Handler for Handler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

fn ssh_err(e: russh::Error) -> AppError {
    AppError::new(ErrorKind::Ssh, "SSH connection failed").with_detail(e.to_string())
}

/// Open a tunnel: connect + authenticate to the SSH host, then start a local forwarder to
/// `target_host:target_port`. `secret` is the SSH password (password auth) or the key passphrase
/// (key auth); pass `None` if there is none.
pub async fn open_tunnel(
    ssh: &SshConfig,
    target_host: &str,
    target_port: u16,
    secret: Option<String>,
) -> Result<SshTunnel, AppError> {
    let config = Arc::new(client::Config::default());
    let mut handle = client::connect(config, (ssh.host.as_str(), ssh.port), Handler)
        .await
        .map_err(ssh_err)?;

    let authenticated = match ssh.auth_method {
        SshAuthMethod::Password => {
            let password =
                secret.ok_or_else(|| AppError::new(ErrorKind::Auth, "SSH password is required"))?;
            handle
                .authenticate_password(&ssh.user, password)
                .await
                .map_err(ssh_err)?
        }
        SshAuthMethod::Key => {
            let path = ssh
                .key_path
                .as_deref()
                .ok_or_else(|| AppError::new(ErrorKind::Ssh, "SSH private key path is required"))?;
            let key = russh_keys::load_secret_key(path, secret.as_deref()).map_err(|e| {
                AppError::new(ErrorKind::Ssh, "Failed to load the SSH private key")
                    .with_detail(e.to_string())
            })?;
            handle
                .authenticate_publickey(&ssh.user, Arc::new(key))
                .await
                .map_err(ssh_err)?
        }
        SshAuthMethod::Agent => {
            return Err(AppError::new(
                ErrorKind::Ssh,
                "SSH agent authentication is not supported yet",
            ));
        }
    };

    if !authenticated {
        return Err(AppError::new(ErrorKind::Auth, "SSH authentication failed"));
    }

    let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
    let local_addr = listener.local_addr()?;
    let session = Arc::new(handle);

    let target_host = target_host.to_string();
    let sess = session.clone();
    let accept_task = tokio::spawn(async move {
        loop {
            let (mut local, peer) = match listener.accept().await {
                Ok(pair) => pair,
                Err(_) => break,
            };
            let sess = sess.clone();
            let host = target_host.clone();
            tokio::spawn(async move {
                let channel = match sess
                    .channel_open_direct_tcpip(
                        host,
                        target_port as u32,
                        peer.ip().to_string(),
                        peer.port() as u32,
                    )
                    .await
                {
                    Ok(channel) => channel,
                    Err(_) => return,
                };
                let mut remote = channel.into_stream();
                // Pump bytes both ways until either side closes.
                let _ = tokio::io::copy_bidirectional(&mut local, &mut remote).await;
            });
        }
    });

    Ok(SshTunnel {
        local_addr,
        accept_task,
        _session: session,
    })
}
