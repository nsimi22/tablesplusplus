//! PostgreSQL client: async, pooled (deadpool), native-tls.
//!
//! Implements `DbClient` and the `ToSql` adapter so app-generated DML is parameterized
//! (CLAUDE.md §7). Driver values are lowered into the generic `CellValue` before crossing
//! the bridge (docs/architecture.md §4, §5.1).

use std::time::Instant;

use base64::Engine as _;
use bytes::BytesMut;
use deadpool_postgres::{Config, ManagerConfig, RecyclingMethod, Runtime};
use tokio_postgres::types::{to_sql_checked, IsNull, ToSql, Type};
use tokio_postgres::Row;

use crate::db::client::{
    BytesCell, CellValue, ColumnInfo, ColumnMeta, ConnectionConfig, DbClient, QueryResult,
    RoutineInfo, RoutineKind, Schema, SchemaBuilder, SslMode, TableKind,
};
use crate::error::AppError;

/// Display/truncation threshold for binary cells (docs/architecture.md §8).
const MAX_BYTES: usize = 64 * 1024;

#[derive(Clone)]
pub struct PostgresClient {
    pool: deadpool_postgres::Pool,
}

impl PostgresClient {
    /// Build the connection pool (the real "connect") and verify it with a ping.
    pub async fn connect(cfg: &ConnectionConfig, secret: Option<String>) -> Result<Self, AppError> {
        let mut pcfg = Config::new();
        pcfg.host = Some(cfg.host.clone());
        pcfg.port = Some(cfg.port);
        pcfg.user = Some(cfg.user.clone());
        pcfg.password = secret;
        pcfg.dbname = Some(cfg.database.clone());
        pcfg.manager = Some(ManagerConfig {
            recycling_method: RecyclingMethod::Fast,
        });
        pcfg.pool = Some(deadpool_postgres::PoolConfig::new(8));

        let pool = match tls_connector(cfg.ssl_mode)? {
            None => pcfg
                .create_pool(Some(Runtime::Tokio1), tokio_postgres::NoTls)
                .map_err(pool_err)?,
            Some(connector) => {
                let tls = postgres_native_tls::MakeTlsConnector::new(connector);
                pcfg.create_pool(Some(Runtime::Tokio1), tls)
                    .map_err(pool_err)?
            }
        };

        let client = Self { pool };
        client.ping().await?;
        Ok(client)
    }
}

#[async_trait::async_trait]
impl DbClient for PostgresClient {
    async fn ping(&self) -> Result<(), AppError> {
        let conn = self.pool.get().await?;
        conn.simple_query("SELECT 1").await?;
        Ok(())
    }

    async fn close(&self) -> Result<(), AppError> {
        self.pool.close();
        Ok(())
    }

    async fn execute_query(
        &self,
        sql: String,
        params: Vec<CellValue>,
    ) -> Result<QueryResult, AppError> {
        let started = Instant::now();
        let conn = self.pool.get().await?;
        let stmt = conn.prepare(&sql).await?;

        let param_refs: Vec<&(dyn ToSql + Sync)> =
            params.iter().map(|p| p as &(dyn ToSql + Sync)).collect();

        if stmt.columns().is_empty() {
            // Non-row-returning statement (INSERT/UPDATE/DDL).
            let affected = conn.execute(&stmt, &param_refs).await?;
            return Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: Some(affected),
                elapsed_ms: started.elapsed().as_millis() as u64,
            });
        }

        let columns: Vec<ColumnMeta> = stmt
            .columns()
            .iter()
            .map(|c| ColumnMeta {
                name: c.name().to_string(),
                data_type: c.type_().name().to_string(),
                nullable: true,
            })
            .collect();

        let rows = conn.query(&stmt, &param_refs).await?;
        let mut out = Vec::with_capacity(rows.len());
        for row in &rows {
            let mut cells = Vec::with_capacity(columns.len());
            for (i, col) in stmt.columns().iter().enumerate() {
                cells.push(pg_cell(row, i, col.type_())?);
            }
            out.push(cells);
        }

        Ok(QueryResult {
            columns,
            rows: out,
            rows_affected: None,
            elapsed_ms: started.elapsed().as_millis() as u64,
        })
    }

    async fn get_schema(&self) -> Result<Schema, AppError> {
        let conn = self.pool.get().await?;

        // Tables & views.
        let table_rows = conn
            .query(
                "SELECT table_schema, table_name, table_type \
                 FROM information_schema.tables \
                 WHERE table_schema NOT IN ('pg_catalog','information_schema') \
                 ORDER BY table_schema, table_name",
                &[],
            )
            .await?;

        // Columns with primary-key flag.
        let col_rows = conn
            .query(
                "SELECT c.table_schema, c.table_name, c.column_name, c.data_type, \
                        (c.is_nullable = 'YES') AS nullable, COALESCE(pk.is_pk, false) AS is_pk \
                 FROM information_schema.columns c \
                 LEFT JOIN ( \
                     SELECT kcu.table_schema, kcu.table_name, kcu.column_name, true AS is_pk \
                     FROM information_schema.table_constraints tc \
                     JOIN information_schema.key_column_usage kcu \
                       ON tc.constraint_name = kcu.constraint_name \
                      AND tc.table_schema = kcu.table_schema \
                     WHERE tc.constraint_type = 'PRIMARY KEY' \
                 ) pk ON pk.table_schema = c.table_schema \
                     AND pk.table_name = c.table_name \
                     AND pk.column_name = c.column_name \
                 WHERE c.table_schema NOT IN ('pg_catalog','information_schema') \
                 ORDER BY c.table_schema, c.table_name, c.ordinal_position",
                &[],
            )
            .await?;

        let routine_rows = conn
            .query(
                "SELECT routine_schema, routine_name, routine_type \
                 FROM information_schema.routines \
                 WHERE routine_schema NOT IN ('pg_catalog','information_schema') \
                 ORDER BY routine_schema, routine_name",
                &[],
            )
            .await?;

        let mut builder = SchemaBuilder::default();
        for r in &table_rows {
            let schema: String = r.try_get(0)?;
            let name: String = r.try_get(1)?;
            let table_type: String = r.try_get(2)?;
            let kind = if table_type.eq_ignore_ascii_case("VIEW") {
                TableKind::View
            } else {
                TableKind::Table
            };
            builder.add_table(schema, name, kind);
        }
        for r in &col_rows {
            let schema: String = r.try_get(0)?;
            let table: String = r.try_get(1)?;
            let col = ColumnInfo {
                name: r.try_get(2)?,
                data_type: r.try_get(3)?,
                nullable: r.try_get(4)?,
                is_primary_key: r.try_get(5)?,
            };
            builder.add_column(&schema, &table, col);
        }
        let mut routines = Vec::with_capacity(routine_rows.len());
        for r in &routine_rows {
            let routine_type: String = r.try_get(2)?;
            routines.push(RoutineInfo {
                schema: r.try_get(0)?,
                name: r.try_get(1)?,
                kind: if routine_type.eq_ignore_ascii_case("PROCEDURE") {
                    RoutineKind::Procedure
                } else {
                    RoutineKind::Function
                },
            });
        }

        Ok(builder.finish(routines))
    }
}

// ---- helpers ----

fn pool_err(e: deadpool_postgres::CreatePoolError) -> AppError {
    AppError::connection("Failed to create PostgreSQL pool").with_detail(e.to_string())
}

/// Map the SSL mode to an optional native-tls connector.
///
/// v1 simplification (docs/architecture.md §11): `prefer` is treated like `disable`, and
/// `verifyCa`/`verifyFull` both do full verification.
fn tls_connector(mode: SslMode) -> Result<Option<native_tls::TlsConnector>, AppError> {
    match mode {
        SslMode::Disable | SslMode::Prefer => Ok(None),
        SslMode::Require => Ok(Some(
            native_tls::TlsConnector::builder()
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true)
                .build()?,
        )),
        SslMode::VerifyCa | SslMode::VerifyFull => {
            Ok(Some(native_tls::TlsConnector::builder().build()?))
        }
    }
}

fn bytes_cell(mut b: Vec<u8>) -> CellValue {
    let truncated = b.len() > MAX_BYTES;
    if truncated {
        b.truncate(MAX_BYTES);
    }
    CellValue::Bytes(BytesCell {
        data: base64::engine::general_purpose::STANDARD.encode(&b),
        truncated,
    })
}

/// Lower a single Postgres column value into a generic `CellValue` (docs/architecture.md §5.1).
fn pg_cell(row: &Row, idx: usize, ty: &Type) -> Result<CellValue, AppError> {
    macro_rules! map {
        ($t:ty, $f:expr) => {{
            let v: Option<$t> = row.try_get(idx)?;
            match v {
                Some(x) => $f(x),
                None => CellValue::Null,
            }
        }};
    }

    let cell = match *ty {
        Type::BOOL => map!(bool, CellValue::Bool),
        Type::INT2 => map!(i16, |x| CellValue::Int(x as i64)),
        Type::INT4 => map!(i32, |x| CellValue::Int(x as i64)),
        Type::INT8 => map!(i64, CellValue::Int),
        Type::OID => map!(u32, |x| CellValue::Int(x as i64)),
        Type::FLOAT4 => map!(f32, |x| CellValue::Float(x as f64)),
        Type::FLOAT8 => map!(f64, CellValue::Float),
        Type::NUMERIC => match row.try_get::<_, Option<rust_decimal::Decimal>>(idx) {
            Ok(Some(d)) => CellValue::Decimal(d.to_string()),
            Ok(None) => CellValue::Null,
            // numeric NaN/Inf is not representable as a Decimal.
            Err(_) => CellValue::Text("NaN".into()),
        },
        Type::CHAR | Type::BPCHAR | Type::VARCHAR | Type::TEXT | Type::NAME => {
            map!(String, CellValue::Text)
        }
        Type::UUID => map!(uuid::Uuid, |x: uuid::Uuid| CellValue::Text(x.to_string())),
        Type::BYTEA => {
            let v: Option<Vec<u8>> = row.try_get(idx)?;
            match v {
                Some(b) => bytes_cell(b),
                None => CellValue::Null,
            }
        }
        Type::TIMESTAMP => map!(chrono::NaiveDateTime, |x: chrono::NaiveDateTime| {
            CellValue::DateTime(x.format("%Y-%m-%dT%H:%M:%S%.f").to_string())
        }),
        Type::TIMESTAMPTZ => map!(chrono::DateTime<chrono::Utc>, |x: chrono::DateTime<
            chrono::Utc,
        >| {
            CellValue::DateTime(x.to_rfc3339())
        }),
        Type::DATE => map!(chrono::NaiveDate, |x: chrono::NaiveDate| {
            CellValue::DateTime(x.format("%Y-%m-%d").to_string())
        }),
        Type::TIME => map!(chrono::NaiveTime, |x: chrono::NaiveTime| {
            CellValue::DateTime(x.format("%H:%M:%S%.f").to_string())
        }),
        Type::JSON | Type::JSONB => map!(serde_json::Value, CellValue::Json),
        _ => match row.try_get::<_, Option<String>>(idx) {
            Ok(Some(s)) => CellValue::Text(s),
            Ok(None) => CellValue::Null,
            Err(_) => match row.try_get::<_, Option<Vec<u8>>>(idx) {
                Ok(Some(b)) => bytes_cell(b),
                Ok(None) => CellValue::Null,
                Err(_) => CellValue::Text(format!("<{}>", ty.name())),
            },
        },
    };
    Ok(cell)
}

type BoxError = Box<dyn std::error::Error + Sync + Send>;

/// Bind `CellValue` params as Postgres values. `accepts` returns true and `to_sql` encodes to
/// match the server-inferred parameter type (docs/architecture.md §6.3).
impl ToSql for CellValue {
    fn to_sql(&self, ty: &Type, out: &mut BytesMut) -> Result<IsNull, BoxError> {
        match self {
            CellValue::Null => Ok(IsNull::Yes),
            CellValue::Bool(b) => b.to_sql(ty, out),
            CellValue::Int(i) => match *ty {
                Type::INT2 => (*i as i16).to_sql(ty, out),
                Type::INT4 => (*i as i32).to_sql(ty, out),
                _ => i.to_sql(ty, out),
            },
            CellValue::Float(f) => match *ty {
                Type::FLOAT4 => (*f as f32).to_sql(ty, out),
                _ => f.to_sql(ty, out),
            },
            CellValue::Decimal(s) => {
                let d: rust_decimal::Decimal = s
                    .parse()
                    .map_err(|e: rust_decimal::Error| Box::new(e) as BoxError)?;
                d.to_sql(ty, out)
            }
            CellValue::Text(s) => s.to_sql(ty, out),
            CellValue::Bytes(b) => {
                let raw = base64::engine::general_purpose::STANDARD
                    .decode(b.data.as_bytes())
                    .map_err(|e| Box::new(e) as BoxError)?;
                raw.to_sql(ty, out)
            }
            CellValue::DateTime(s) => encode_datetime(s, ty, out),
            CellValue::Json(v) => v.to_sql(ty, out),
        }
    }

    fn accepts(_ty: &Type) -> bool {
        true
    }

    to_sql_checked!();
}

fn encode_datetime(s: &str, ty: &Type, out: &mut BytesMut) -> Result<IsNull, BoxError> {
    match *ty {
        Type::TIMESTAMPTZ => {
            let dt = chrono::DateTime::parse_from_rfc3339(s)
                .map(|d| d.with_timezone(&chrono::Utc))
                .map_err(|e| Box::new(e) as BoxError)?;
            dt.to_sql(ty, out)
        }
        Type::TIMESTAMP => {
            let dt = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f")
                .or_else(|_| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S%.f"))
                .map_err(|e| Box::new(e) as BoxError)?;
            dt.to_sql(ty, out)
        }
        Type::DATE => {
            let d = chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map_err(|e| Box::new(e) as BoxError)?;
            d.to_sql(ty, out)
        }
        Type::TIME => {
            let t = chrono::NaiveTime::parse_from_str(s, "%H:%M:%S%.f")
                .map_err(|e| Box::new(e) as BoxError)?;
            t.to_sql(ty, out)
        }
        // Fallback: hand the string to the server to cast.
        _ => s.to_sql(ty, out),
    }
}
