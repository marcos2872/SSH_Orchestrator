use anyhow::Result;
use git2::{Cred, RemoteCallbacks, Repository, Signature};
use std::path::Path;

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

    /// Clones or opens the local sync repository
    pub fn init_repo(&self, clone_url: &str, token: &str) -> Result<Repository> {
        let repo_path = Path::new(&self.local_path);

        if repo_path.exists() {
            tracing::info!(
                "GitSyncService: sync_repo exists at {:?}, opening...",
                repo_path
            );
            let repo = Repository::open(repo_path)?;
            Ok(repo)
        } else {
            tracing::info!(
                "GitSyncService: sync_repo does not exist, cloning from {}...",
                clone_url
            );
            let mut callbacks = RemoteCallbacks::new();
            callbacks.credentials(|_url, _username_from_url, _allowed_types| {
                Cred::userpass_plaintext("oauth2", token)
            });

            let mut fetch_options = git2::FetchOptions::new();
            fetch_options.remote_callbacks(callbacks);

            let mut builder = git2::build::RepoBuilder::new();
            builder.fetch_options(fetch_options);

            tracing::info!("GitSyncService: Starting clone...");
            let repo = match builder.clone(clone_url, repo_path) {
                Ok(r) => {
                    tracing::info!("GitSyncService: Clone successful!");
                    r
                }
                Err(e) => {
                    tracing::error!("GitSyncService: Clone failed: {}", e);
                    return Err(e.into());
                }
            };
            Ok(repo)
        }
    }

    /// Pulls changes from remote
    pub fn pull(&self, repo: &Repository, token: &str) -> Result<()> {
        let mut remote = repo.find_remote("origin")?;

        let mut callbacks = RemoteCallbacks::new();
        callbacks.credentials(|_url, _username_from_url, _allowed_types| {
            Cred::userpass_plaintext("oauth2", token)
        });

        let mut fetch_options = git2::FetchOptions::new();
        fetch_options.remote_callbacks(callbacks);

        remote.fetch(&["main"], Some(&mut fetch_options), None)?;

        let fetch_head = repo.find_reference("FETCH_HEAD")?;
        let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)?;

        // Fast-forward merge strategy for simplicity in this MVP
        let _config = repo.config()?;
        let mut checkout_builder = git2::build::CheckoutBuilder::new();
        checkout_builder.force();

        let (merge_analysis, _) = repo.merge_analysis(&[&fetch_commit])?;

        if merge_analysis.is_up_to_date() {
            return Ok(());
        } else if merge_analysis.is_fast_forward() {
            let refname = format!("refs/heads/main");
            let mut reference = repo.find_reference(&refname)?;
            reference.set_target(fetch_commit.id(), "Fast-Forward")?;
            repo.set_head(&refname)?;
            repo.checkout_head(Some(&mut checkout_builder))?;
        } else {
            // Both local and remote have commits.
            // In our CRDT model, the remote JSON is the source of truth for the "other side".
            // We should just hard reset our local JSON files to the remote's HEAD,
            // read those remote JSONs, merge them with our local DB, overwrite the JSONs,
            // and push a new commit. The hard reset allows us to effectively discard the local
            // unpushed JSON state in favor of reading the remote's state for the merge algorithm.
            tracing::warn!(
                "Real merge required. Hard resetting local to FETCH_HEAD for CRDT merge."
            );

            let fetch_commit_obj = repo.find_object(fetch_commit.id(), None)?;
            repo.reset(
                &fetch_commit_obj,
                git2::ResetType::Hard,
                Some(&mut checkout_builder),
            )?;

            // Set the main branch reference to point to the fetched commit
            let refname = format!("refs/heads/main");
            if let Ok(mut reference) = repo.find_reference(&refname) {
                reference.set_target(fetch_commit.id(), "Hard reset for CRDT")?;
            }
        }

        Ok(())
    }

    /// Commits and pushes changes
    pub fn push(&self, repo: &Repository, token: &str, message: &str) -> Result<()> {
        let mut index = repo.index()?;
        index.add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)?;
        index.write()?;

        let oid = index.write_tree()?;
        let signature = Signature::now("SSH Config Sync", "sync@local")?;
        let parent_commit = repo.head()?.peel_to_commit()?;
        let tree = repo.find_tree(oid)?;

        repo.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &[&parent_commit],
        )?;

        let mut remote = repo.find_remote("origin")?;
        let mut callbacks = RemoteCallbacks::new();
        callbacks.credentials(|_url, _username_from_url, _allowed_types| {
            Cred::userpass_plaintext("oauth2", token)
        });

        let mut push_options = git2::PushOptions::new();
        push_options.remote_callbacks(callbacks);

        remote.push(
            &["+refs/heads/main:refs/heads/main"],
            Some(&mut push_options),
        )?;

        Ok(())
    }
}
