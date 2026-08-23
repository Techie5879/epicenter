//! The read-only SQLite mirror for a vault.
//!
//! One hidden `<root>/.matter/matter.sqlite` per vault holds ONE SQL table per typed
//! folder (named for that folder), so a coding agent (or an in-app SQL console) can run
//! arbitrary SQL — including cross-table JOINs — over the whole vault. Each table mirrors
//! its folder's readable rows (valid rows AND drafts in progress, a missing cell stored as
//! NULL), so triaging unfinished drafts works too. The JS projector (`core/sqlite.ts`)
//! builds all the SQL TEXT (the schema script + the insert, quoting and placeholders
//! included) and the row tuples; Rust only opens the db, runs the schema script, and
//! parameter-binds each row. It never learns what a column or a kind is, the same faithful
//! role `entry.rs` and `watch.rs` play for writes and reads.
//!
//! Each per-folder rebuild is a full DROP + CREATE + INSERT in one transaction, and the
//! whole db is reset on vault open (`reset_mirror`), so the file is disposable: delete it,
//! reopen the vault, get an identical db. The vault (`vault.svelte.ts`) is the sole owner:
//! it resets the db on open, rewrites one table's slice per settled watcher batch, and drops
//! a table (`drop_mirror_table`) when its folder leaves the set.

use rusqlite::types::Value;
use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The vault's hidden mirror dir (`<root>/.matter`) and the db inside it
/// (`<root>/.matter/matter.sqlite`). The ONE place the on-disk layout lives: every command takes the
/// vault ROOT and never the `.matter` segment, the same way `entry.rs` takes a folder + filename and
/// joins them itself. So the frontend owns no path logic here beyond naming the vault root.
fn mirror_dir(root: &str) -> PathBuf {
    Path::new(root).join(".matter")
}
fn mirror_db(root: &str) -> PathBuf {
    mirror_dir(root).join("matter.sqlite")
}

/// Open the vault's mirror db with the given access flags. The single opener the commands share, so
/// the ONLY difference between a rebuild and a query is the flag: `OpenFlags::default()` (read-write,
/// create) for `write_mirror` versus `SQLITE_OPEN_READ_ONLY` for `query_mirror`. The `.matter` dir
/// must already exist — `reset_mirror` makes it on open, the head of the write-chain — so a writable
/// open only creates the db file, never its parent. `busy_timeout` lets either wait out an in-flight
/// rebuild instead of failing with SQLITE_BUSY.
fn open_mirror(root: &str, flags: OpenFlags) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(mirror_db(root), flags).map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    Ok(conn)
}

/// Turn one JSON arg into a SQLite-bindable value. The projector emits strings, numbers,
/// and null (a missing cell binds NULL; booleans are already 0/1, arrays are JSON text);
/// bool is mapped defensively too so a future projector change cannot panic here.
fn to_sql(value: &serde_json::Value) -> Value {
    use serde_json::Value as J;
    match value {
        J::String(s) => Value::Text(s.clone()),
        J::Number(n) => n
            .as_i64()
            .map(Value::Integer)
            .or_else(|| n.as_f64().map(Value::Real))
            .unwrap_or_else(|| Value::Text(n.to_string())),
        J::Bool(b) => Value::Integer(*b as i64),
        J::Null => Value::Null,
        other => Value::Text(other.to_string()),
    }
}

/// Rebuild one folder's table in the vault's mirror from the projected rows. `root` is the vault
/// root (the db is `<root>/.matter/matter.sqlite`); `schema` (a `DROP` + `CREATE` script) and
/// `insert` are the SQL the JS projector built; `rows` is one tuple per readable row, positional
/// against the insert's columns. Full drop-and-recreate in one transaction, so the file is disposable.
#[tauri::command]
pub fn write_mirror(
    root: String,
    schema: String,
    insert: String,
    rows: Vec<Vec<serde_json::Value>>,
) -> Result<(), String> {
    // Reconciles fire per watcher batch and each opens its own connection, so two can
    // overlap on a large folder (or with an agent reading). The shared `busy_timeout`
    // waits for the lock instead of failing fast with SQLITE_BUSY; the rebuild is a full
    // drop-and-recreate, so a brief wait is cheaper than a lost rebuild.
    let mut conn = open_mirror(&root, OpenFlags::default())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // execute_batch runs the multi-statement DROP + CREATE script (no params).
    tx.execute_batch(&schema).map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare(&insert).map_err(|e| e.to_string())?;
        for row in &rows {
            let params: Vec<Value> = row.iter().map(to_sql).collect();
            stmt.execute(rusqlite::params_from_iter(params))
                .map_err(|e| e.to_string())?;
        }
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Reset the vault's mirror at vault open: ensure the hidden `.matter` dir exists, then delete
/// `matter.sqlite` so the db starts empty and refills incrementally as each table loads (rule 3,
/// "fresh db on open" — a table gone since last session leaves no stale SQL table). `root` is the
/// vault root; this is the only command that creates the `.matter` dir (the head of the write-chain),
/// so a later `write`/`drop` only opens the db. One call does the `mkdir(.matter)` and the delete; a
/// missing db is not an error.
#[tauri::command]
pub fn reset_mirror(root: String) -> Result<(), String> {
    std::fs::create_dir_all(mirror_dir(&root)).map_err(|e| e.to_string())?;
    match std::fs::remove_file(mirror_db(&root)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Drop one folder's SQL table from the vault's mirror (rule 2, "DROP on removal"): the
/// vault calls this when a folder leaves the set or goes untyped, so its table does not
/// linger in the shared db. `table` is quoted here (doubling embedded quotes) since it is a
/// folder name, not projector-built SQL. `IF EXISTS` makes it idempotent. `root` is the vault root.
#[tauri::command]
pub fn drop_mirror_table(root: String, table: String) -> Result<(), String> {
    let conn = open_mirror(&root, OpenFlags::default())?;
    let quoted = format!("\"{}\"", table.replace('"', "\"\""));
    conn.execute_batch(&format!("DROP TABLE IF EXISTS {quoted}"))
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// One result set from `query_mirror`: the column names and the rows (each a positional
/// list of JSON-encoded cell values). Generic and schema-blind, like the rest of this
/// module: Rust runs the SQL and hands back values, it never interprets them.
#[derive(Debug, serde::Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
}

/// Turn one SQLite cell into JSON for the frontend (the inverse of `to_sql`). matter
/// never projects blobs, so a blob maps to null defensively rather than dragging in a
/// base64 dependency.
fn from_sql(value: rusqlite::types::ValueRef) -> serde_json::Value {
    use rusqlite::types::ValueRef as V;
    use serde_json::Value as J;
    match value {
        V::Null => J::Null,
        V::Integer(i) => J::Number(i.into()),
        V::Real(f) => serde_json::Number::from_f64(f).map(J::Number).unwrap_or(J::Null),
        V::Text(s) => J::String(String::from_utf8_lossy(s).into_owned()),
        V::Blob(_) => J::Null,
    }
}

/// Run a READ-ONLY query against the vault's mirror (`<root>/.matter/matter.sqlite`) and return the
/// rows, up to `limit`, or every match when `limit` is `None`. The connection is opened read-only, so
/// a query can never mutate the disposable mirror (a write would be lost on the next reconcile
/// anyway). The SQL is the caller's (the user's own query against their own local file), so Rust
/// stays schema-blind: it runs the statement and hands back column names and JSON values, nothing
/// interpreted.
#[tauri::command]
pub fn query_mirror(
    root: String,
    sql: String,
    limit: Option<usize>,
) -> Result<QueryResult, String> {
    let conn = open_mirror(&root, OpenFlags::SQLITE_OPEN_READ_ONLY)?;

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let col_count = columns.len();

    let mut out: Vec<Vec<serde_json::Value>> = Vec::new();
    let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        if let Some(limit) = limit {
            if out.len() >= limit {
                break;
            }
        }
        let mut record = Vec::with_capacity(col_count);
        for i in 0..col_count {
            record.push(from_sql(row.get_ref(i).map_err(|e| e.to_string())?));
        }
        out.push(record);
    }

    Ok(QueryResult {
        columns,
        rows: out,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A unique scratch vault root under the OS temp dir (mirrors `entry.rs`).
    fn scratch() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "matter-mirror-test-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A scratch vault root with its mirror reset (so `.matter/` exists), the production sequence a
    /// write/drop assumes — `reset_mirror` is the head of the write-chain. Returns the root.
    fn fresh() -> std::path::PathBuf {
        let dir = scratch();
        reset_mirror(dir.to_string_lossy().into()).unwrap();
        dir
    }

    const SCHEMA: &str = r#"DROP TABLE IF EXISTS "drafts";
CREATE TABLE "drafts" ("path" TEXT PRIMARY KEY, "title" TEXT NOT NULL, "count" INTEGER NOT NULL, "_extra" TEXT NOT NULL)"#;
    const INSERT: &str =
        r#"INSERT INTO "drafts" ("path", "title", "count", "_extra") VALUES (?, ?, ?, ?)"#;

    fn count(root: &std::path::Path) -> i64 {
        Connection::open(mirror_db(&root.to_string_lossy()))
            .unwrap()
            .query_row(r#"SELECT COUNT(*) FROM "drafts""#, [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn writes_the_db_under_dot_matter_with_typed_values() {
        let dir = fresh();
        let path: String = dir.to_string_lossy().into();
        let rows = vec![
            vec![json!("a.md"), json!("Hello"), json!(3), json!("{}")],
            vec![json!("b.md"), json!("World"), json!(5), json!(r#"{"k":1}"#)],
        ];

        write_mirror(path, SCHEMA.into(), INSERT.into(), rows).unwrap();

        // The db lands at `<root>/.matter/matter.sqlite` — Rust owns the layout, the caller passes
        // only the vault root.
        assert!(mirror_db(&dir.to_string_lossy()).exists());

        let conn = Connection::open(mirror_db(&dir.to_string_lossy())).unwrap();
        let (title, n): (String, i64) = conn
            .query_row(
                r#"SELECT "title", "count" FROM "drafts" WHERE "path" = ?"#,
                ["a.md"],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(title, "Hello");
        assert_eq!(n, 3); // INTEGER stored and read back as a number
        assert_eq!(count(&dir), 2);
    }

    #[test]
    fn rebuild_is_a_full_drop_and_recreate() {
        let dir = fresh();
        let path: String = dir.to_string_lossy().into();

        write_mirror(
            path.clone(),
            SCHEMA.into(),
            INSERT.into(),
            vec![
                vec![json!("a.md"), json!("A"), json!(1), json!("{}")],
                vec![json!("b.md"), json!("B"), json!(2), json!("{}")],
            ],
        )
        .unwrap();
        assert_eq!(count(&dir), 2);

        // A second write with one row replaces the table wholesale (disposable).
        write_mirror(
            path,
            SCHEMA.into(),
            INSERT.into(),
            vec![vec![json!("only.md"), json!("Solo"), json!(9), json!("{}")]],
        )
        .unwrap();
        assert_eq!(count(&dir), 1);
    }

    #[test]
    fn query_mirror_reads_rows_limits_and_rejects_writes() {
        let dir = fresh();
        let path: String = dir.to_string_lossy().into();
        write_mirror(
            path.clone(),
            SCHEMA.into(),
            INSERT.into(),
            vec![
                vec![json!("a.md"), json!("Hello"), json!(3), json!("{}")],
                vec![json!("b.md"), json!("World"), json!(5), json!("{}")],
            ],
        )
        .unwrap();

        let result = query_mirror(
            path.clone(),
            r#"SELECT "path", "count" FROM "drafts" WHERE "count" > 3"#.into(),
            None,
        )
        .unwrap();
        assert_eq!(result.columns, vec!["path".to_string(), "count".to_string()]);
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0][0], json!("b.md"));
        assert_eq!(result.rows[0][1], json!(5));

        // `Some(limit)` caps the row count; `None` returns every match.
        let limited =
            query_mirror(path.clone(), r#"SELECT "path" FROM "drafts""#.into(), Some(1)).unwrap();
        assert_eq!(limited.rows.len(), 1);
        let unbounded =
            query_mirror(path.clone(), r#"SELECT "path" FROM "drafts""#.into(), None).unwrap();
        assert_eq!(unbounded.rows.len(), 2);

        // The connection is read-only, so a write is rejected, never a silent mutation.
        let err = query_mirror(path, r#"DELETE FROM "drafts""#.into(), None).unwrap_err();
        assert!(err.to_lowercase().contains("readonly"));
    }

    #[test]
    fn reset_mirror_makes_dot_matter_and_deletes_the_db() {
        let root = scratch();
        let path: String = root.to_string_lossy().into();
        let matter = root.join(".matter");

        // First reset on a root with no `.matter` yet: create_dir_all makes it, the missing db is fine.
        reset_mirror(path.clone()).unwrap();
        assert!(matter.exists());
        assert!(!mirror_db(&path).exists());

        // Write a table, then reset again: the db file is gone (fresh on open).
        write_mirror(path.clone(), SCHEMA.into(), INSERT.into(), vec![]).unwrap();
        assert!(mirror_db(&path).exists());
        reset_mirror(path.clone()).unwrap();
        assert!(!mirror_db(&path).exists());
    }

    #[test]
    fn drop_mirror_table_removes_one_table_and_is_idempotent() {
        let dir = fresh();
        let path: String = dir.to_string_lossy().into();
        write_mirror(
            path.clone(),
            SCHEMA.into(),
            INSERT.into(),
            vec![vec![json!("a.md"), json!("A"), json!(1), json!("{}")]],
        )
        .unwrap();
        assert_eq!(count(&dir), 1);

        // Drop the "drafts" table: a later query against it errors (no such table).
        drop_mirror_table(path.clone(), "drafts".into()).unwrap();
        let err = query_mirror(path.clone(), r#"SELECT * FROM "drafts""#.into(), None).unwrap_err();
        assert!(err.to_lowercase().contains("no such table"));

        // Dropping a table that is already gone is a no-op, never an error (IF EXISTS).
        drop_mirror_table(path, "drafts".into()).unwrap();
    }

    #[test]
    fn binds_null_for_a_missing_cell() {
        // The projector emits null for a NEEDS_VALUE cell (a draft in progress) against a
        // nullable column; it must bind as SQL NULL so `IS NULL` finds the draft.
        let dir = fresh();
        let path: String = dir.to_string_lossy().into();
        let schema = "DROP TABLE IF EXISTS \"drafts\";\nCREATE TABLE \"drafts\" (\"path\" TEXT PRIMARY KEY, \"title\" TEXT)";
        let insert = r#"INSERT INTO "drafts" ("path", "title") VALUES (?, ?)"#;
        write_mirror(
            path.clone(),
            schema.into(),
            insert.into(),
            vec![vec![json!("draft.md"), json!(null)]],
        )
        .unwrap();

        let result = query_mirror(
            path,
            r#"SELECT "path" FROM "drafts" WHERE "title" IS NULL"#.into(),
            None,
        )
        .unwrap();
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0][0], json!("draft.md"));
    }
}
