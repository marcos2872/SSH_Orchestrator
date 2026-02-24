use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

/// Hybrid Logical Clock timestamp (HLOC)
/// Uses a combination of physical time and a logical counter to guarantee ordering
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HLC {
    pub timestamp_ms: u64,
    pub counter: u32,
    pub node_id: String, // Unique identifier of the client generating this timestamp
}

impl PartialOrd for HLC {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for HLC {
    fn cmp(&self, other: &Self) -> Ordering {
        // First compare by physical time
        match self.timestamp_ms.cmp(&other.timestamp_ms) {
            Ordering::Equal => {
                // If physical time is the same, compare the logical counter
                match self.counter.cmp(&other.counter) {
                    Ordering::Equal => {
                        // If counters match, break tie consistently with node_id
                        self.node_id.cmp(&other.node_id)
                    }
                    other => other,
                }
            }
            other => other,
        }
    }
}

/// Last-Writer-Wins Register
/// Resolves conflicts by taking the value that has the highest HLC timestamp
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
}

// Tests to ensure HLC ordering
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hlc_ordering() {
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
        let t3 = HLC {
            timestamp_ms: 1000,
            counter: 1,
            node_id: "A".to_string(),
        };
        let t4 = HLC {
            timestamp_ms: 1000,
            counter: 0,
            node_id: "B".to_string(),
        };

        assert!(t2 > t1); // Higher physical time
        assert!(t3 > t1); // Higher counter
        assert!(t4 > t1); // Tie break on Node ID ("B" > "A")
    }

    #[test]
    fn test_lww_merge() {
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
        assert_eq!(r1.value, "B"); // r2 won because of timestamp

        let r3 = LWWRegister::new(
            "C",
            HLC {
                timestamp_ms: 50,
                counter: 0,
                node_id: "Z".to_string(),
            },
        );
        r1.merge(r3);
        assert_eq!(r1.value, "B"); // r1 keeps B because r3 was older
    }
}
