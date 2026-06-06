//! Backend-global pool registry mapping `connection_id → DbConnection`.
//!
//! `DashMap` is used directly — it is already internally sharded/concurrent and is **not**
//! wrapped in an outer `Mutex`/`RwLock` (CLAUDE.md §4.2). `get` returns a *clone* of the
//! `DbConnection` (cheap; pools are `Arc` internally) so the map guard is released before
//! any `.await` — never hold a lock across an await.

use dashmap::DashMap;

use crate::db::client::DbConnection;
use crate::error::AppError;

#[derive(Default)]
pub struct PoolRegistry {
    conns: DashMap<String, DbConnection>,
}

impl PoolRegistry {
    pub fn new() -> Self {
        Self {
            conns: DashMap::new(),
        }
    }

    /// Atomically insert only if absent. Returns `Some(conn)` (the rejected connection) when an
    /// entry already existed, so the caller can close the now-redundant pool — this closes the
    /// check-then-insert race between two concurrent `connect` calls for the same id.
    pub fn insert_if_absent(&self, id: String, conn: DbConnection) -> Option<DbConnection> {
        use dashmap::mapref::entry::Entry;
        match self.conns.entry(id) {
            Entry::Occupied(_) => Some(conn),
            Entry::Vacant(slot) => {
                slot.insert(conn);
                None
            }
        }
    }

    pub fn get(&self, id: &str) -> Result<DbConnection, AppError> {
        self.conns
            .get(id)
            .map(|r| r.clone())
            .ok_or_else(|| AppError::not_found("Connection is not open"))
    }

    pub fn remove(&self, id: &str) -> Option<DbConnection> {
        self.conns.remove(id).map(|(_, v)| v)
    }

    pub fn contains(&self, id: &str) -> bool {
        self.conns.contains_key(id)
    }
}
