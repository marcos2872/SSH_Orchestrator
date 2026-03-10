use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::sync::atomic::{AtomicU32, Ordering as AtomicOrdering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// Hybrid Logical Clock timestamp.
/// Serialized to/from string as "timestamp_ms:counter:node_id" for SQLite storage.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HLC {
    pub timestamp_ms: u64,
    pub counter: u32,
    pub node_id: String,
}

impl HLC {
    /// Generate a new HLC for the current instant on this node.
    /// The counter auto-increments if the timestamp hasn't changed since the
    /// last call, guaranteeing uniqueness even at sub-millisecond rates.
    pub fn now(node_id: &str) -> Self {
        let ts = chrono::Utc::now().timestamp_millis() as u64;
        let c = COUNTER.fetch_add(1, AtomicOrdering::SeqCst);
        Self {
            timestamp_ms: ts,
            counter: c,
            node_id: node_id.to_string(),
        }
    }

    /// Encode to the canonical string representation stored in SQLite.
    pub fn to_string_repr(&self) -> String {
        format!("{}:{}:{}", self.timestamp_ms, self.counter, self.node_id)
    }

    /// Parse from the string representation.
    /// Supports legacy format (plain millisecond timestamp) for backward compat.
    pub fn parse(s: &str) -> Self {
        let parts: Vec<&str> = s.splitn(3, ':').collect();
        match parts.len() {
            3 => {
                let ts = parts[0].parse::<u64>().unwrap_or(0);
                let counter = parts[1].parse::<u32>().unwrap_or(0);
                let node_id = parts[2].to_string();
                Self {
                    timestamp_ms: ts,
                    counter,
                    node_id,
                }
            }
            // Legacy: plain timestamp string like "1718000000000"
            _ => {
                let ts = s.parse::<u64>().unwrap_or(0);
                Self {
                    timestamp_ms: ts,
                    counter: 0,
                    node_id: String::new(),
                }
            }
        }
    }
}

impl PartialOrd for HLC {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for HLC {
    fn cmp(&self, other: &Self) -> Ordering {
        match self.timestamp_ms.cmp(&other.timestamp_ms) {
            Ordering::Equal => match self.counter.cmp(&other.counter) {
                Ordering::Equal => self.node_id.cmp(&other.node_id),
                other => other,
            },
            other => other,
        }
    }
}

impl std::fmt::Display for HLC {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}:{}", self.timestamp_ms, self.counter, self.node_id)
    }
}

/// Last-Writer-Wins Register.
/// Resolves conflicts by keeping the value with the highest HLC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LWWRegister<T> {
    pub value: T,
    pub updated_at: HLC,
}

impl<T: Clone> LWWRegister<T> {
    pub fn new(value: T, updated_at: HLC) -> Self {
        Self { value, updated_at }
    }

    /// Merges another LWWRegister into this one.
    /// This is commutative, associative, and idempotent.
    pub fn merge(&mut self, other: Self) {
        if other.updated_at > self.updated_at {
            self.value = other.value;
            self.updated_at = other.updated_at;
        }
    }

    /// Returns true if `other` has a newer (higher) HLC than self.
    pub fn is_superseded_by(&self, other: &Self) -> bool {
        other.updated_at > self.updated_at
    }
}

// ─── Node ID helpers ────────────────────────────────────────────────────────

/// Reads or creates a persistent node ID stored in `node_id.txt` inside the
/// app data directory. This ensures a stable identity across app restarts.
pub fn get_or_create_node_id(app_data_dir: &std::path::Path) -> String {
    let path = app_data_dir.join("node_id.txt");
    if let Ok(id) = std::fs::read_to_string(&path) {
        let id = id.trim().to_string();
        if !id.is_empty() {
            return id;
        }
    }
    let id = uuid::Uuid::new_v4().to_string()[..8].to_string();
    let _ = std::fs::write(&path, &id);
    tracing::info!("Generated new node_id: {}", id);
    id
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hlc_ordering_timestamp() {
        let t1 = HLC {
            timestamp_ms: 1000,
            counter: 0,
            node_id: "A".to_string(),
        };
        let t2 = HLC {
            timestamp_ms: 1001,
            counter: 0,
            node_id: "A".to_string(),
        };
        assert!(t2 > t1, "Higher physical time should win");
    }

    #[test]
    fn test_hlc_ordering_counter() {
        let t1 = HLC {
            timestamp_ms: 1000,
            counter: 0,
            node_id: "A".to_string(),
        };
        let t3 = HLC {
            timestamp_ms: 1000,
            counter: 1,
            node_id: "A".to_string(),
        };
        assert!(t3 > t1, "Higher counter should win on same timestamp");
    }

    #[test]
    fn test_hlc_ordering_node_id() {
        let t1 = HLC {
            timestamp_ms: 1000,
            counter: 0,
            node_id: "A".to_string(),
        };
        let t4 = HLC {
            timestamp_ms: 1000,
            counter: 0,
            node_id: "B".to_string(),
        };
        assert!(
            t4 > t1,
            "Lexicographically greater node_id should break tie"
        );
    }

    #[test]
    fn test_hlc_roundtrip() {
        let hlc = HLC {
            timestamp_ms: 1718000000000,
            counter: 42,
            node_id: "abc123".to_string(),
        };
        let s = hlc.to_string_repr();
        assert_eq!(s, "1718000000000:42:abc123");
        let parsed = HLC::parse(&s);
        assert_eq!(parsed, hlc);
    }

    #[test]
    fn test_hlc_parse_legacy() {
        let parsed = HLC::parse("1718000000000");
        assert_eq!(parsed.timestamp_ms, 1718000000000);
        assert_eq!(parsed.counter, 0);
        assert_eq!(parsed.node_id, "");
    }

    #[test]
    fn test_hlc_parse_empty() {
        let parsed = HLC::parse("");
        assert_eq!(parsed.timestamp_ms, 0);
        assert_eq!(parsed.counter, 0);
        assert_eq!(parsed.node_id, "");
    }

    #[test]
    fn test_hlc_now_increments() {
        let a = HLC::now("test");
        let b = HLC::now("test");
        // Counter should be different even if timestamp_ms is the same
        assert!(b >= a, "Sequential HLC::now() calls must be non-decreasing");
        if a.timestamp_ms == b.timestamp_ms {
            assert!(
                b.counter > a.counter,
                "Same-ms calls must increment counter"
            );
        }
    }

    #[test]
    fn test_legacy_vs_new_ordering() {
        // A legacy HLC (just timestamp) should lose to a new HLC at the same ms
        // because the new one has counter > 0 or a non-empty node_id
        let legacy = HLC::parse("1718000000000");
        let new_hlc = HLC {
            timestamp_ms: 1718000000000,
            counter: 1,
            node_id: "x".to_string(),
        };
        assert!(
            new_hlc > legacy,
            "New HLC with counter > 0 should beat legacy at same timestamp"
        );
    }

    #[test]
    fn test_lww_merge_newer_wins() {
        let mut r1 = LWWRegister::new(
            "A",
            HLC {
                timestamp_ms: 100,
                counter: 0,
                node_id: "X".to_string(),
            },
        );
        let r2 = LWWRegister::new(
            "B",
            HLC {
                timestamp_ms: 200,
                counter: 0,
                node_id: "Y".to_string(),
            },
        );
        r1.merge(r2);
        assert_eq!(r1.value, "B", "Newer timestamp should win");
    }

    #[test]
    fn test_lww_merge_older_loses() {
        let mut r1 = LWWRegister::new(
            "B",
            HLC {
                timestamp_ms: 200,
                counter: 0,
                node_id: "Y".to_string(),
            },
        );
        let r2 = LWWRegister::new(
            "C",
            HLC {
                timestamp_ms: 50,
                counter: 0,
                node_id: "Z".to_string(),
            },
        );
        r1.merge(r2);
        assert_eq!(r1.value, "B", "Older timestamp should not overwrite");
    }

    #[test]
    fn test_lww_merge_is_idempotent() {
        let mut r1 = LWWRegister::new(
            "A",
            HLC {
                timestamp_ms: 100,
                counter: 0,
                node_id: "X".to_string(),
            },
        );
        let r2 = LWWRegister::new(
            "B",
            HLC {
                timestamp_ms: 200,
                counter: 0,
                node_id: "Y".to_string(),
            },
        );
        r1.merge(r2.clone());
        r1.merge(r2.clone());
        r1.merge(r2);
        assert_eq!(r1.value, "B", "Idempotent merge should keep same result");
        assert_eq!(r1.updated_at.timestamp_ms, 200);
    }

    #[test]
    fn test_is_superseded_by() {
        let r1 = LWWRegister::new(
            "old",
            HLC {
                timestamp_ms: 100,
                counter: 0,
                node_id: "A".to_string(),
            },
        );
        let r2 = LWWRegister::new(
            "new",
            HLC {
                timestamp_ms: 200,
                counter: 0,
                node_id: "B".to_string(),
            },
        );
        assert!(r1.is_superseded_by(&r2));
        assert!(!r2.is_superseded_by(&r1));
    }

    #[test]
    fn test_hlc_parse_node_id_with_colons() {
        // node_id itself might never contain colons, but splitn(3, ':')
        // ensures at most 3 parts so a colon in node_id would be preserved
        let hlc = HLC {
            timestamp_ms: 1000,
            counter: 5,
            node_id: "node:special".to_string(),
        };
        let s = hlc.to_string_repr();
        let parsed = HLC::parse(&s);
        assert_eq!(parsed, hlc);
    }
}
