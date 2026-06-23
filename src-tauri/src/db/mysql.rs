//! MySQL client: async, pooled via `mysql_async`'s built-in pool (docs/architecture.md §6.2).
//!
//! Implements `DbClient`, lowers driver values into generic `CellValue`, and binds
//! `CellValue` params positionally (`?` placeholders).

use std::time::Instant;

use base64::Engine as _;
use mysql_async::consts::ColumnType;
use mysql_async::prelude::Queryable;
use mysql_async::{OptsBuilder, Params, Pool, Row, SslOpts, Value};

use crate::db::client::{
    bytes_cell, parse_routine_kind, parse_table_kind, CellValue, ChunkSender, ColumnInfo,
    ColumnMeta, ConnectionConfig, DbClient, ForeignKeyRef, QueryResult, RoutineInfo, Schema,
    SchemaBuilder, SslMode, StreamChunk, STREAM_BATCH, STREAM_MAX_ROWS,
};
use crate::error::AppError;

const CHARSET_BINARY: u16 = 63;

#[derive(Clone)]
pub struct MysqlClient {
    pool: Pool,
}

impl MysqlClient {
    pub async fn connect(cfg: &ConnectionConfig, secret: Option<String>) -> Result<Self, AppError> {
        let mut builder = OptsBuilder::default()
            .ip_or_hostname(cfg.host.clone())
            .tcp_port(cfg.port)
            .user(Some(cfg.user.clone()))
            .pass(secret)
            .db_name(Some(cfg.database.clone()));

        // v1 SSL simplification mirrors the Postgres client (docs/architecture.md §11).
        match cfg.ssl_mode {
            SslMode::Disable | SslMode::Prefer => {}
            SslMode::Require => {
                builder =
                    builder.ssl_opts(SslOpts::default().with_danger_accept_invalid_certs(true));
            }
            SslMode::VerifyCa | SslMode::VerifyFull => {
                builder = builder.ssl_opts(SslOpts::default());
            }
        }

        let pool = Pool::new(builder);
        let client = Self { pool };
        client.ping().await?;
        Ok(client)
    }
}

#[async_trait::async_trait]
impl DbClient for MysqlClient {
    async fn ping(&self) -> Result<(), AppError> {
        let mut conn = self.pool.get_conn().await?;
        conn.ping().await?;
        Ok(())
    }

    async fn close(&self) -> Result<(), AppError> {
        self.pool.clone().disconnect().await?;
        Ok(())
    }

    async fn execute_query(
        &self,
        sql: String,
        params: Vec<CellValue>,
    ) -> Result<QueryResult, AppError> {
        let started = Instant::now();
        let mut conn = self.pool.get_conn().await?;

        let my_params = to_my_params(params);
        let mut qr = conn.exec_iter(sql.as_str(), my_params).await?;

        // Capture column metadata (owned) before consuming the rows.
        let specs: Vec<ColSpec> = qr
            .columns_ref()
            .iter()
            .map(|c| ColSpec {
                name: c.name_str().into_owned(),
                column_type: c.column_type(),
                length: c.column_length(),
                charset: c.character_set(),
            })
            .collect();

        let rows: Vec<Row> = qr.collect::<Row>().await?;
        let affected = qr.affected_rows();
        let elapsed_ms = started.elapsed().as_millis() as u64;

        if specs.is_empty() {
            // Non-row-returning statement.
            return Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: Some(affected),
                elapsed_ms,
            });
        }

        let columns: Vec<ColumnMeta> = specs
            .iter()
            .map(|s| ColumnMeta {
                name: s.name.clone(),
                data_type: type_name(s.column_type).to_string(),
                // MySQL has no per-type schema; the grid's PG-only cast path ignores this.
                type_schema: String::new(),
                nullable: true,
            })
            .collect();

        let data_rows: Vec<Vec<CellValue>> = rows
            .iter()
            .map(|row| {
                specs
                    .iter()
                    .enumerate()
                    .map(|(i, spec)| {
                        let val = row.as_ref(i).cloned().unwrap_or(Value::NULL);
                        my_cell(&val, spec)
                    })
                    .collect()
            })
            .collect();

        Ok(QueryResult {
            columns,
            rows: data_rows,
            rows_affected: None,
            elapsed_ms,
        })
    }

    async fn stream_query(
        &self,
        sql: String,
        params: Vec<CellValue>,
        tx: ChunkSender,
    ) -> Result<(), AppError> {
        let started = Instant::now();
        let mut conn = self.pool.get_conn().await?;
        let mut qr = conn.exec_iter(sql.as_str(), to_my_params(params)).await?;

        let specs: Vec<ColSpec> = qr
            .columns_ref()
            .iter()
            .map(|c| ColSpec {
                name: c.name_str().into_owned(),
                column_type: c.column_type(),
                length: c.column_length(),
                charset: c.character_set(),
            })
            .collect();

        if specs.is_empty() {
            // Non-row statement: drain (no-op) and report affected rows.
            let affected = qr.affected_rows();
            let _ = tx
                .send(StreamChunk::Done {
                    rows_affected: Some(affected),
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    truncated: false,
                })
                .await;
            return Ok(());
        }

        let columns: Vec<ColumnMeta> = specs
            .iter()
            .map(|s| ColumnMeta {
                name: s.name.clone(),
                data_type: type_name(s.column_type).to_string(),
                // MySQL has no per-type schema; the grid's PG-only cast path ignores this.
                type_schema: String::new(),
                nullable: true,
            })
            .collect();
        if tx.send(StreamChunk::Columns { columns }).await.is_err() {
            return Ok(());
        }

        // Iterate row-by-row so we never buffer the whole result set in memory.
        let mut batch: Vec<Vec<CellValue>> = Vec::with_capacity(STREAM_BATCH);
        let mut total = 0usize;
        let mut truncated = false;
        while let Some(row) = qr.next().await? {
            let cells: Vec<CellValue> = specs
                .iter()
                .enumerate()
                .map(|(i, spec)| {
                    let val = row.as_ref(i).cloned().unwrap_or(Value::NULL);
                    my_cell(&val, spec)
                })
                .collect();
            batch.push(cells);
            total += 1;
            if batch.len() >= STREAM_BATCH
                && tx
                    .send(StreamChunk::Rows {
                        rows: std::mem::take(&mut batch),
                    })
                    .await
                    .is_err()
            {
                return Ok(());
            }
            if total >= STREAM_MAX_ROWS {
                truncated = true;
                break;
            }
        }
        if !batch.is_empty() {
            let _ = tx.send(StreamChunk::Rows { rows: batch }).await;
        }
        let _ = tx
            .send(StreamChunk::Done {
                rows_affected: None,
                elapsed_ms: started.elapsed().as_millis() as u64,
                truncated,
            })
            .await;
        Ok(())
    }

    async fn get_schema(&self) -> Result<Schema, AppError> {
        let mut conn = self.pool.get_conn().await?;

        let table_rows: Vec<(String, String, String)> = conn
            .query(
                "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE \
                 FROM information_schema.TABLES \
                 WHERE TABLE_SCHEMA = DATABASE() \
                 ORDER BY TABLE_NAME",
            )
            .await?;

        let col_rows: Vec<(String, String, String, String, String, String)> = conn
            .query(
                "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY \
                 FROM information_schema.COLUMNS \
                 WHERE TABLE_SCHEMA = DATABASE() \
                 ORDER BY TABLE_NAME, ORDINAL_POSITION",
            )
            .await?;

        let routine_rows: Vec<(String, String, String)> = conn
            .query(
                "SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE \
                 FROM information_schema.ROUTINES \
                 WHERE ROUTINE_SCHEMA = DATABASE() \
                 ORDER BY ROUTINE_NAME",
            )
            .await?;

        // Single-column foreign keys for the current database, keyed by (schema, table, column).
        let fk_rows: Vec<(String, String, String, String, String, String)> = conn
            .query(
                "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, \
                        REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME \
                 FROM information_schema.KEY_COLUMN_USAGE \
                 WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL",
            )
            .await?;
        let mut fks: std::collections::HashMap<(String, String, String), ForeignKeyRef> =
            std::collections::HashMap::new();
        for (schema, table, column, ref_schema, ref_table, ref_column) in &fk_rows {
            fks.insert(
                (schema.clone(), table.clone(), column.clone()),
                ForeignKeyRef {
                    schema: ref_schema.clone(),
                    table: ref_table.clone(),
                    column: ref_column.clone(),
                },
            );
        }

        let mut builder = SchemaBuilder::default();
        for (schema, name, table_type) in &table_rows {
            builder.add_table(schema.clone(), name.clone(), parse_table_kind(table_type));
        }
        for (schema, table, col_name, col_type, is_nullable, col_key) in &col_rows {
            let foreign_key = fks
                .get(&(schema.clone(), table.clone(), col_name.clone()))
                .cloned();
            builder.add_column(
                schema,
                table,
                ColumnInfo {
                    name: col_name.clone(),
                    data_type: col_type.clone(),
                    nullable: is_nullable.eq_ignore_ascii_case("YES"),
                    is_primary_key: col_key.eq_ignore_ascii_case("PRI"),
                    foreign_key,
                },
            );
        }
        let routines = routine_rows
            .iter()
            .map(|(schema, name, routine_type)| RoutineInfo {
                schema: schema.clone(),
                name: name.clone(),
                kind: parse_routine_kind(routine_type),
            })
            .collect();

        Ok(builder.finish(routines))
    }
}

// ---- helpers ----

struct ColSpec {
    name: String,
    column_type: ColumnType,
    length: u32,
    charset: u16,
}

fn to_my_params(params: Vec<CellValue>) -> Params {
    if params.is_empty() {
        return Params::Empty;
    }
    let vals: Vec<Value> = params.into_iter().map(cell_to_value).collect();
    Params::Positional(vals)
}

fn cell_to_value(c: CellValue) -> Value {
    match c {
        CellValue::Null => Value::NULL,
        CellValue::Bool(b) => Value::Int(b as i64),
        CellValue::Int(i) => Value::Int(i),
        CellValue::Float(f) => Value::Double(f),
        // Numeric/text/datetime are sent as strings; the server casts to the column type.
        CellValue::Decimal(s) => Value::Bytes(s.into_bytes()),
        CellValue::Text(s) => Value::Bytes(s.into_bytes()),
        CellValue::DateTime(s) => Value::Bytes(s.into_bytes()),
        CellValue::Json(v) => Value::Bytes(v.to_string().into_bytes()),
        CellValue::Bytes(bc) => {
            match base64::engine::general_purpose::STANDARD.decode(bc.data.as_bytes()) {
                Ok(raw) => Value::Bytes(raw),
                Err(_) => Value::NULL,
            }
        }
    }
}

fn my_cell(val: &Value, spec: &ColSpec) -> CellValue {
    use ColumnType::*;
    match val {
        Value::NULL => CellValue::Null,
        Value::Int(i) => {
            // TINYINT(1) is conventionally a boolean.
            if spec.column_type == MYSQL_TYPE_TINY && spec.length == 1 {
                CellValue::Bool(*i != 0)
            } else {
                CellValue::Int(*i)
            }
        }
        Value::UInt(u) => {
            // TINYINT(1) UNSIGNED is also conventionally a boolean.
            if spec.column_type == MYSQL_TYPE_TINY && spec.length == 1 {
                CellValue::Bool(*u != 0)
            } else if *u > i64::MAX as u64 {
                CellValue::Decimal(u.to_string())
            } else {
                CellValue::Int(*u as i64)
            }
        }
        Value::Float(f) => CellValue::Float(*f as f64),
        Value::Double(d) => CellValue::Float(*d),
        Value::Bytes(b) => match spec.column_type {
            MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => {
                CellValue::Decimal(String::from_utf8_lossy(b).into_owned())
            }
            MYSQL_TYPE_JSON => serde_json::from_slice(b)
                .map(CellValue::Json)
                .unwrap_or_else(|_| CellValue::Text(String::from_utf8_lossy(b).into_owned())),
            MYSQL_TYPE_BLOB
            | MYSQL_TYPE_TINY_BLOB
            | MYSQL_TYPE_MEDIUM_BLOB
            | MYSQL_TYPE_LONG_BLOB
            | MYSQL_TYPE_STRING
            | MYSQL_TYPE_VAR_STRING
            | MYSQL_TYPE_BIT
            | MYSQL_TYPE_GEOMETRY => {
                if spec.charset == CHARSET_BINARY {
                    bytes_cell(b.clone())
                } else {
                    CellValue::Text(String::from_utf8_lossy(b).into_owned())
                }
            }
            _ => CellValue::Text(String::from_utf8_lossy(b).into_owned()),
        },
        Value::Date(y, mo, d, h, mi, s, us) => {
            // Space separator (not ISO 'T') so the value round-trips into MySQL DATETIME/
            // TIMESTAMP literals on commit, including on MySQL 5.x.
            if spec.column_type == MYSQL_TYPE_DATE {
                CellValue::DateTime(format!("{y:04}-{mo:02}-{d:02}"))
            } else if *us > 0 {
                CellValue::DateTime(format!(
                    "{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}.{us:06}"
                ))
            } else {
                CellValue::DateTime(format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}"))
            }
        }
        Value::Time(neg, days, h, mi, s, us) => {
            let sign = if *neg { "-" } else { "" };
            let total_h = days * 24 + *h as u32;
            if *us > 0 {
                CellValue::DateTime(format!("{sign}{total_h:02}:{mi:02}:{s:02}.{us:06}"))
            } else {
                CellValue::DateTime(format!("{sign}{total_h:02}:{mi:02}:{s:02}"))
            }
        }
    }
}

/// Friendly type label for the column metadata.
fn type_name(ct: ColumnType) -> &'static str {
    use ColumnType::*;
    match ct {
        MYSQL_TYPE_TINY => "tinyint",
        MYSQL_TYPE_SHORT => "smallint",
        MYSQL_TYPE_INT24 => "mediumint",
        MYSQL_TYPE_LONG => "int",
        MYSQL_TYPE_LONGLONG => "bigint",
        MYSQL_TYPE_FLOAT => "float",
        MYSQL_TYPE_DOUBLE => "double",
        MYSQL_TYPE_DECIMAL | MYSQL_TYPE_NEWDECIMAL => "decimal",
        MYSQL_TYPE_VARCHAR | MYSQL_TYPE_VAR_STRING => "varchar",
        MYSQL_TYPE_STRING => "char",
        MYSQL_TYPE_BLOB | MYSQL_TYPE_TINY_BLOB | MYSQL_TYPE_MEDIUM_BLOB | MYSQL_TYPE_LONG_BLOB => {
            "blob/text"
        }
        MYSQL_TYPE_JSON => "json",
        MYSQL_TYPE_DATE | MYSQL_TYPE_NEWDATE => "date",
        MYSQL_TYPE_TIME | MYSQL_TYPE_TIME2 => "time",
        MYSQL_TYPE_DATETIME | MYSQL_TYPE_DATETIME2 => "datetime",
        MYSQL_TYPE_TIMESTAMP | MYSQL_TYPE_TIMESTAMP2 => "timestamp",
        MYSQL_TYPE_YEAR => "year",
        MYSQL_TYPE_BIT => "bit",
        MYSQL_TYPE_GEOMETRY => "geometry",
        _ => "unknown",
    }
}
