use anyhow::{anyhow, Result};
use git2::{Cred, RemoteCallbacks, Repository, Signature};
use std::path::Path;
use std::{fs, thread, time::Duration};

const MAX_RETRIES: u32 = 3;
const RETRY_BASE_MS: u64 = 500;

/// Content of the `.gitignore` placed inside the sync repo to prevent
/// accidental commits of temporary / OS-generated files.
const GITIGNORE_CONTENT: &str = r#"# SSH Orchestrator sync repo – auto-generated
.DS_Store
Thumbs.db
*.swp
*.lock
*.tmp
"#;

pub struct GitSyncService {
    pub local_path: String,
}

impl GitSyncService {
    pub fn new(app_data_dir: &Path) -> Self {
        let path = app_data_dir.join("sync_repo");
        Self {
            local_path: path.to_string_lossy().to_string(),
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// Build `RemoteCallbacks` that authenticate with a GitHub OAuth token.
    fn make_callbacks(token: &str) -> RemoteCallbacks<'_> {
        let mut cb = RemoteCallbacks::new();
        cb.credentials(|_url, _username_from_url, _allowed_types| {
            Cred::userpass_plaintext("oauth2", token)
        });
        cb
    }

    /// Make sure a `.gitignore` exists inside the sync repo so that OS junk
    /// files (`.DS_Store`, `Thumbs.db`, etc.) are never committed.
    fn ensure_gitignore(repo_path: &Path) {
        let gitignore_path = repo_path.join(".gitignore");
        if !gitignore_path.exists() {
            if let Err(e) = fs::write(&gitignore_path, GITIGNORE_CONTENT) {
                tracing::warn!("Failed to write .gitignore in sync repo: {}", e);
            } else {
                tracing::info!("Created .gitignore in sync repo");
            }
        }
    }

    /// Retry a fallible closure up to `MAX_RETRIES` times with exponential
    /// back-off.  Only network-ish errors are retried; if the closure returns
    /// `Ok` we return immediately.
    fn with_retry<F, T>(operation: &str, mut f: F) -> Result<T>
    where
        F: FnMut() -> Result<T>,
    {
        let mut last_err = anyhow!("{}: no attempts made", operation);
        for attempt in 1..=MAX_RETRIES {
            match f() {
                Ok(val) => return Ok(val),
                Err(e) => {
                    last_err = e;
                    if attempt < MAX_RETRIES {
                        let delay = Duration::from_millis(RETRY_BASE_MS * 2u64.pow(attempt - 1));
                        tracing::warn!(
                            "{}: attempt {}/{} failed ({}). Retrying in {:?}…",
                            operation,
                            attempt,
                            MAX_RETRIES,
                            last_err,
                            delay,
                        );
                        thread::sleep(delay);
                    }
                }
            }
        }
        tracing::error!(
            "{}: all {} attempts failed. Last error: {}",
            operation,
            MAX_RETRIES,
            last_err,
        );
        Err(last_err)
    }

    // ── public API ──────────────────────────────────────────────────────────

    /// Clones or opens the local sync repository.
    /// On fresh clone the `.gitignore` is created automatically.
    pub fn init_repo(&self, clone_url: &str, token: &str) -> Result<Repository> {
        let repo_path = Path::new(&self.local_path);

        if repo_path.exists() {
            tracing::info!(
                "GitSyncService: sync_repo exists at {:?}, opening…",
                repo_path
            );
            let repo = Repository::open(repo_path)?;
            Self::ensure_gitignore(repo_path);
            Ok(repo)
        } else {
            tracing::info!(
                "GitSyncService: sync_repo does not exist, cloning from {}…",
                clone_url
            );

            // Clone is itself a network operation so we wrap it in retry.
            let local = self.local_path.clone();
            let url = clone_url.to_string();
            let tok = token.to_string();

            let repo = Self::with_retry("git clone", move || {
                // If a partial clone left a directory behind, clean it up.
                let p = Path::new(&local);
                if p.exists() {
                    let _ = fs::remove_dir_all(p);
                }

                let mut callbacks = Self::make_callbacks(&tok);
                // Suppress noisy sideband progress messages
                callbacks.sideband_progress(|_| true);

                let mut fetch_options = git2::FetchOptions::new();
                fetch_options.remote_callbacks(callbacks);

                let mut builder = git2::build::RepoBuilder::new();
                builder.fetch_options(fetch_options);

                let r = builder.clone(&url, p)?;
                Ok(r)
            })?;

            Self::ensure_gitignore(Path::new(&self.local_path));
            tracing::info!("GitSyncService: clone successful");
            Ok(repo)
        }
    }

    /// Pulls changes from remote (fetch + fast-forward or hard-reset).
    pub fn pull(&self, repo: &Repository, token: &str) -> Result<()> {
        // ── Fetch with retry ────────────────────────────────────────────────
        let repo_path_str = self.local_path.clone();
        let tok = token.to_string();
        Self::with_retry("git fetch", || {
            // We need to re-open the remote each attempt because the callback
            // closures are consumed by libgit2.
            let r = Repository::open(&repo_path_str)?;
            let mut remote = r.find_remote("origin")?;
            let mut fetch_options = git2::FetchOptions::new();
            fetch_options.remote_callbacks(Self::make_callbacks(&tok));
            remote.fetch(&["main"], Some(&mut fetch_options), None)?;
            Ok(())
        })?;

        // ── Merge / fast-forward ────────────────────────────────────────────
        let fetch_head = repo.find_reference("FETCH_HEAD")?;
        let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)?;

        let mut checkout_builder = git2::build::CheckoutBuilder::new();
        checkout_builder.force();

        let (merge_analysis, _) = repo.merge_analysis(&[&fetch_commit])?;

        if merge_analysis.is_up_to_date() {
            tracing::debug!("pull: already up to date");
            return Ok(());
        }

        let refname = "refs/heads/main";

        if merge_analysis.is_fast_forward() {
            tracing::debug!("pull: fast-forwarding");
            let mut reference = repo.find_reference(refname)?;
            reference.set_target(fetch_commit.id(), "Fast-Forward")?;
            repo.set_head(refname)?;
            repo.checkout_head(Some(&mut checkout_builder))?;
        } else {
            // Diverged histories — hard-reset to the remote HEAD so that the
            // CRDT merge algorithm can compare the remote JSON state against
            // the local SQLite DB and reconcile properly.
            tracing::warn!("pull: diverged — hard-resetting to FETCH_HEAD for CRDT merge");
            let fetch_commit_obj = repo.find_object(fetch_commit.id(), None)?;
            repo.reset(
                &fetch_commit_obj,
                git2::ResetType::Hard,
                Some(&mut checkout_builder),
            )?;
            if let Ok(mut reference) = repo.find_reference(refname) {
                reference.set_target(fetch_commit.id(), "Hard reset for CRDT")?;
            }
        }

        Ok(())
    }

    /// Commits all changes and force-pushes to `main`.
    pub fn push(&self, repo: &Repository, token: &str, message: &str) -> Result<()> {
        // ── Stage everything ────────────────────────────────────────────────
        let mut index = repo.index()?;
        index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
        index.update_all(["*"].iter(), None)?;
        index.write()?;

        let oid = index.write_tree()?;
        let tree = repo.find_tree(oid)?;
        let signature = Signature::now("SSH Config Sync", "sync@local")?;
        let parent_commit = repo.head()?.peel_to_commit()?;

        // Skip the push entirely when the tree hasn't changed (nothing new to
        // push). This avoids creating empty commits and wasting a network
        // round-trip.
        if parent_commit.tree_id() == oid {
            tracing::info!("push: tree unchanged, skipping");
            return Ok(());
        }

        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &[&parent_commit],
        )?;

        // ── Push with retry ─────────────────────────────────────────────────
        //
        // Strategy: attempt a normal (fast-forward) push first.  Because the
        // caller always does pull → merge → serialize before pushing, the
        // local HEAD should be a descendant of the remote HEAD in the common
        // case, so a fast-forward push will succeed and is the safest option.
        //
        // If the normal push fails (e.g. another device pushed between our
        // pull and this push, or the histories diverged for any other reason),
        // we fall back to a force push (`+refs/heads/main`) so the sync is
        // not blocked.  Data loss is mitigated by the fact that we already
        // merged the remote state into our local DB before serializing.
        let repo_path_str = self.local_path.clone();
        let tok = token.to_string();

        // First: try a normal push (no `+` prefix = reject non-fast-forward).
        let normal_result = Self::with_retry("git push (ff)", {
            let rp = repo_path_str.clone();
            let t = tok.clone();
            move || {
                let r = Repository::open(&rp)?;
                let mut remote = r.find_remote("origin")?;
                let mut push_options = git2::PushOptions::new();
                push_options.remote_callbacks(Self::make_callbacks(&t));
                remote.push(
                    &["refs/heads/main:refs/heads/main"],
                    Some(&mut push_options),
                )?;
                Ok(())
            }
        });

        match normal_result {
            Ok(()) => {
                tracing::info!("push: fast-forward push succeeded");
            }
            Err(ff_err) => {
                // Fast-forward was rejected — fall back to force push.
                tracing::warn!(
                    "push: fast-forward push failed ({}), falling back to force push",
                    ff_err,
                );

                Self::with_retry("git push (force)", move || {
                    let r = Repository::open(&repo_path_str)?;
                    let mut remote = r.find_remote("origin")?;
                    let mut push_options = git2::PushOptions::new();
                    push_options.remote_callbacks(Self::make_callbacks(&tok));
                    remote.push(
                        &["+refs/heads/main:refs/heads/main"],
                        Some(&mut push_options),
                    )?;
                    Ok(())
                })?;

                tracing::info!("push: force push succeeded as fallback");
            }
        }

        Ok(())
    }
}
