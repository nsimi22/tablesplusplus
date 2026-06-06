//! Database abstraction layer: engine-agnostic DTOs, the `DbClient` contract, the
//! `DbConnection` enum dispatch, concrete engine clients, and the pool registry.

pub mod client;
pub mod mysql;
pub mod pool;
pub mod postgres;
