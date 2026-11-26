use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, params};
use uuid::Uuid;

use crate::names::{is_sequence_prefix, next_sequence_name, prefix_for};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS cards (
    id TEXT PRIMARY KEY NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
    title TEXT,
    body TEXT NOT NULL,
    image_file TEXT,
    thumb_file TEXT,
    zone TEXT NOT NULL CHECK (zone IN ('inbox', 'pinned')),
    sort_order INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    edge TEXT NOT NULL CHECK (edge IN ('left', 'right', 'top', 'bottom')),
    anchor REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS window_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    x REAL NOT NULL,
    y REAL NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    collapsed INTEGER NOT NULL DEFAULT 0,
    chip_x REAL,
    chip_y REAL
);
";

#[derive(Debug, Clone, PartialEq)]
pub struct CardRow {
    pub id: String,
    pub kind: String,
    pub title: Option<String>,
    pub body: String,
    pub image_file: Option<String>,
    pub thumb_file: Option<String>,
    pub zone: String,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WindowState {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub collapsed: bool,
    pub chip_x: Option<f64>,
    pub chip_y: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct NewImage {
    pub id: String,
    pub image_file: String,
    pub thumb_file: String,
}

pub struct Db {
    conn: Connection,
}

impl Db {
    pub fn open(path: &std::path::Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(sql_err)?;
        conn.busy_timeout(Duration::from_secs(3)).map_err(sql_err)?;
        let mut db = Self { conn };
        db.init()?;
        Ok(db)
    }

    pub fn open_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(sql_err)?;
        let mut db = Self { conn };
        db.init()?;
        Ok(db)
    }

    fn init(&mut self) -> Result<(), String> {
        self.conn.execute_batch(SCHEMA).map_err(sql_err)?;
        self.migrate_window_layout()?;
        self.flatten_legacy_zones()?;
        Ok(())
    }

    /// 第一版把卡片分在常用和收件。新看板只有一个列表：常用在前，收件在后。
    fn flatten_legacy_zones(&mut self) -> Result<(), String> {
        let mixed: i64 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM cards WHERE zone != 'inbox'",
                [],
                |row| row.get(0),
            )
            .map_err(sql_err)?;
        if mixed == 0 {
            return Ok(());
        }
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id FROM cards
                 ORDER BY CASE zone WHEN 'pinned' THEN 0 ELSE 1 END, sort_order ASC, created_at ASC",
            )
            .map_err(sql_err)?;
        let ids = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(sql_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_err)?;
        drop(stmt);
        let tx = self.conn.transaction().map_err(sql_err)?;
        for (index, id) in ids.iter().enumerate() {
            tx.execute(
                "UPDATE cards SET zone = 'inbox', sort_order = ?1 WHERE id = ?2",
                params![index as i64, id],
            )
            .map_err(sql_err)?;
        }
        tx.commit().map_err(sql_err)?;
        Ok(())
    }


    fn migrate_window_layout(&self) -> Result<(), String> {
        let mut stmt = self
            .conn
            .prepare("PRAGMA table_info(window_state)")
            .map_err(sql_err)?;
        let names = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(sql_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_err)?;
        drop(stmt);
        if !names.iter().any(|name| name == "collapsed") {
            self.conn
                .execute_batch(
                    "ALTER TABLE window_state ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0;
                     ALTER TABLE window_state ADD COLUMN chip_x REAL;
                     ALTER TABLE window_state ADD COLUMN chip_y REAL;",
                )
                .map_err(sql_err)?;
        }
        Ok(())
    }

    pub fn window(&self) -> Result<Option<WindowState>, String> {
        self.conn
            .query_row(
                "SELECT x, y, width, height, collapsed, chip_x, chip_y FROM window_state WHERE id = 1",
                [],
                |row| {
                    let collapsed: i64 = row.get(4)?;
                    Ok(WindowState {
                        x: row.get(0)?,
                        y: row.get(1)?,
                        width: row.get(2)?,
                        height: row.get(3)?,
                        collapsed: collapsed != 0,
                        chip_x: row.get(5)?,
                        chip_y: row.get(6)?,
                    })
                },
            )
            .optional()
            .map_err(sql_err)
    }

    pub fn save_window(
        &self,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        collapsed: bool,
        chip_x: Option<f64>,
        chip_y: Option<f64>,
    ) -> Result<(), String> {
        if ![x, y, width, height].iter().all(|value| value.is_finite()) {
            return Err("窗口位置无效".into());
        }
        if !(1.0..=10_000.0).contains(&width) || !(1.0..=10_000.0).contains(&height) {
            return Err("窗口尺寸无效".into());
        }
        let chip = match (chip_x, chip_y) {
            (Some(cx), Some(cy)) if cx.is_finite() && cy.is_finite() => (Some(cx), Some(cy)),
            (None, None) => (None, None),
            (Some(cx), None) if cx.is_finite() => return Err("胶囊位置无效".into()),
            (None, Some(cy)) if cy.is_finite() => return Err("胶囊位置无效".into()),
            _ => return Err("胶囊位置无效".into()),
        };
        self.conn
            .execute(
                "INSERT INTO window_state (id, x, y, width, height, collapsed, chip_x, chip_y)
                 VALUES (1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                    x = excluded.x,
                    y = excluded.y,
                    width = excluded.width,
                    height = excluded.height,
                    collapsed = excluded.collapsed,
                    chip_x = excluded.chip_x,
                    chip_y = excluded.chip_y",
                params![x, y, width, height, if collapsed { 1 } else { 0 }, chip.0, chip.1],
            )
            .map_err(sql_err)?;
        Ok(())
    }

    pub fn list_cards(&self) -> Result<Vec<CardRow>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, kind, title, body, image_file, thumb_file, zone, sort_order, created_at, updated_at
                 FROM cards
                 ORDER BY sort_order ASC, created_at ASC",
            )
            .map_err(sql_err)?;
        let rows = stmt
            .query_map([], map_card)
            .map_err(sql_err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(sql_err)?;
        Ok(rows)
    }

    pub fn get(&self, id: &str) -> Result<CardRow, String> {
        self.conn
            .query_row(
                "SELECT id, kind, title, body, image_file, thumb_file, zone, sort_order, created_at, updated_at
                 FROM cards WHERE id = ?1",
                [id],
                map_card,
            )
            .map_err(|err| match err {
                rusqlite::Error::QueryReturnedNoRows => "找不到这张卡片".into(),
                other => sql_err(other),
            })
    }

    pub fn titles_except(&self, except: Option<&str>) -> Result<Vec<String>, String> {
        titles_in(&self.conn, except)
    }

    pub fn create_text(&mut self, title: &str, body: &str) -> Result<CardRow, String> {
        let body = normalize_body(body)?;
        let tx = self.conn.transaction().map_err(sql_err)?;
        let title = resolve_title(&tx, title, "文字", None)?;
        tx.execute("UPDATE cards SET sort_order = sort_order + 1", [])
            .map_err(sql_err)?;
        let id = Uuid::new_v4().to_string();
        let now = now_ms();
        tx.execute(
            "INSERT INTO cards (id, kind, title, body, image_file, thumb_file, zone, sort_order, created_at, updated_at)
             VALUES (?1, 'text', ?2, ?3, NULL, NULL, 'inbox', 0, ?4, ?4)",
            params![id, title, body, now],
        )
        .map_err(sql_err)?;
        tx.commit().map_err(sql_err)?;
        self.get(&id)
    }

    pub fn update_body(&mut self, id: &str, body: &str) -> Result<CardRow, String> {
        let current = self.get(id)?;
        if current.kind != "text" {
            return Err("图片不能改文字".into());
        }
        let body = normalize_body(body)?;
        let now = now_ms();
        self.conn
            .execute(
                "UPDATE cards SET body = ?1, updated_at = ?2 WHERE id = ?3",
                params![body, now, id],
            )
            .map_err(sql_err)?;
        self.get(id)
    }

    pub fn rename(&mut self, id: &str, title: &str) -> Result<CardRow, String> {
        let current = self.get(id)?;
        let prefix = prefix_for(&current.kind, current.title.as_deref());
        let tx = self.conn.transaction().map_err(sql_err)?;
        let resolved = resolve_title(&tx, title, prefix, Some(id))?;
        let now = now_ms();
        tx.execute(
            "UPDATE cards SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![resolved, now, id],
        )
        .map_err(sql_err)?;
        tx.commit().map_err(sql_err)?;
        self.get(id)
    }

    pub fn delete(&mut self, id: &str) -> Result<CardRow, String> {
        let card = self.get(id)?;
        let tx = self.conn.transaction().map_err(sql_err)?;
        let changed = tx
            .execute("DELETE FROM cards WHERE id = ?1", [id])
            .map_err(sql_err)?;
        if changed == 0 {
            return Err("找不到这张卡片".into());
        }
        reindex(&tx)?;
        tx.commit().map_err(sql_err)?;
        Ok(card)
    }

    /// Move a content card to sort_order 0. The dashed add tile is not a DB row,
    /// so this never displaces it; the board always renders the add tile first.
    pub fn move_to_top(&mut self, id: &str) -> Result<(), String> {
        let _card = self.get(id)?;
        let tx = self.conn.transaction().map_err(sql_err)?;
        tx.execute("UPDATE cards SET sort_order = sort_order + 1 WHERE id != ?1", [id])
            .map_err(sql_err)?;
        let now = now_ms();
        tx.execute(
            "UPDATE cards SET sort_order = 0, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )
        .map_err(sql_err)?;
        reindex(&tx)?;
        tx.commit().map_err(sql_err)?;
        Ok(())
    }

    pub fn insert_images(&mut self, images: &[NewImage], prefix: &str) -> Result<(), String> {
        if images.is_empty() {
            return Ok(());
        }
        if !is_sequence_prefix(prefix) {
            return Err("名称前缀无效".into());
        }
        let now = now_ms();
        let tx = self.conn.transaction().map_err(sql_err)?;
        tx.execute(
            "UPDATE cards SET sort_order = sort_order + ?1",
            [images.len() as i64],
        )
        .map_err(sql_err)?;
        let mut titles = titles_in(&tx, None)?;
        for (index, image) in images.iter().enumerate() {
            let title = next_sequence_name(&titles, prefix);
            titles.push(title.clone());
            tx.execute(
                "INSERT INTO cards (id, kind, title, body, image_file, thumb_file, zone, sort_order, created_at, updated_at)
                 VALUES (?1, 'image', ?2, '', ?3, ?4, 'inbox', ?5, ?6, ?6)",
                params![image.id, title, image.image_file, image.thumb_file, index as i64, now],
            )
            .map_err(sql_err)?;
        }
        tx.commit().map_err(sql_err)?;
        Ok(())
    }
}

pub fn normalize_body(raw: &str) -> Result<String, String> {
    let body = raw.trim();
    if body.is_empty() {
        return Err("正文不能为空".into());
    }
    if body.chars().count() > 200_000 {
        return Err("正文最多 20 万字".into());
    }
    Ok(body.to_string())
}

fn resolve_title(
    conn: &Connection,
    raw: &str,
    prefix: &str,
    except: Option<&str>,
) -> Result<String, String> {
    if !is_sequence_prefix(prefix) {
        return Err("名称前缀无效".into());
    }
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        let existing = titles_in(conn, except)?;
        return Ok(next_sequence_name(&existing, prefix));
    }
    if trimmed.chars().count() > 200 {
        return Err("名称最多 200 字".into());
    }
    Ok(trimmed.to_string())
}

fn titles_in(conn: &Connection, except: Option<&str>) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT title FROM cards WHERE title IS NOT NULL AND (?1 IS NULL OR id != ?1)")
        .map_err(sql_err)?;
    let rows = stmt
        .query_map(params![except], |row| row.get::<_, String>(0))
        .map_err(sql_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_err)?;
    Ok(rows)
}

fn reindex(tx: &rusqlite::Transaction<'_>) -> Result<(), String> {
    let mut stmt = tx
        .prepare("SELECT id FROM cards ORDER BY sort_order ASC, created_at ASC")
        .map_err(sql_err)?;
    let ids = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(sql_err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_err)?;
    drop(stmt);
    for (index, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE cards SET sort_order = ?1 WHERE id = ?2",
            params![index as i64, id],
        )
        .map_err(sql_err)?;
    }
    Ok(())
}

fn map_card(row: &rusqlite::Row<'_>) -> rusqlite::Result<CardRow> {
    Ok(CardRow {
        id: row.get(0)?,
        kind: row.get(1)?,
        title: row.get(2)?,
        body: row.get(3)?,
        image_file: row.get(4)?,
        thumb_file: row.get(5)?,
        zone: row.get(6)?,
        sort_order: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn sql_err(err: rusqlite::Error) -> String {
    format!("数据库出错：{err}")
}

#[cfg(test)]
mod tests {
    use super::*;

    const V1_SCHEMA: &str = "
    CREATE TABLE cards (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
        title TEXT,
        body TEXT NOT NULL,
        image_file TEXT,
        thumb_file TEXT,
        zone TEXT NOT NULL CHECK (zone IN ('inbox', 'pinned')),
        sort_order INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        edge TEXT NOT NULL CHECK (edge IN ('left', 'right', 'top', 'bottom')),
        anchor REAL NOT NULL
    );
    ";

    #[test]
    fn blank_titles_use_the_next_free_number_and_land_on_top() {
        let mut db = Db::open_memory().unwrap();
        let named = db.create_text("  甲  ", "  一条  ").unwrap();
        let first = db.create_text("   ", "第二条").unwrap();
        assert_eq!(first.title.as_deref(), Some("文字1"));
        assert_eq!(first.body, "第二条");
        let cards = db.list_cards().unwrap();
        assert_eq!(cards[0].id, first.id);
        assert_eq!(cards[1].id, named.id);
        assert_eq!(cards[1].title.as_deref(), Some("甲"));

        let second = db.create_text("", "第三条").unwrap();
        assert_eq!(second.title.as_deref(), Some("文字2"));
        db.delete(&first.id).unwrap();
        let reused = db.create_text(" ", "补位").unwrap();
        assert_eq!(reused.title.as_deref(), Some("文字1"));
    }

    #[test]
    fn a_custom_name_does_not_consume_a_sequence_number() {
        let mut db = Db::open_memory().unwrap();
        db.create_text("文字", "自定义").unwrap();
        let card = db.create_text("", "自动").unwrap();
        assert_eq!(card.title.as_deref(), Some("文字1"));
    }

    #[test]
    fn update_keeps_the_name_and_rename_can_clear_it() {
        let mut db = Db::open_memory().unwrap();
        let card = db.create_text("会议", "旧").unwrap();
        let updated = db.update_body(&card.id, "  新正文  ").unwrap();
        assert_eq!(updated.title.as_deref(), Some("会议"));
        assert_eq!(updated.body, "新正文");
        let renamed = db.rename(&card.id, "  ").unwrap();
        assert_eq!(renamed.title.as_deref(), Some("文字1"));
    }

    #[test]
    fn screenshot_keeps_its_prefix_until_the_name_is_changed() {
        let mut db = Db::open_memory().unwrap();
        db.insert_images(
            &[NewImage {
                id: "shot".into(),
                image_file: "shot.png".into(),
                thumb_file: "shot.thumb.png".into(),
            }],
            "截图",
        )
        .unwrap();
        assert_eq!(db.get("shot").unwrap().title.as_deref(), Some("截图1"));
        db.rename("shot", "").unwrap();
        assert_eq!(db.get("shot").unwrap().title.as_deref(), Some("截图1"));
        db.rename("shot", "照片").unwrap();
        db.rename("shot", "").unwrap();
        assert_eq!(db.get("shot").unwrap().title.as_deref(), Some("图片1"));
    }

    #[test]
    fn images_are_named_in_order_without_using_text_numbers() {
        let mut db = Db::open_memory().unwrap();
        db.create_text("", "笔记").unwrap();
        db.insert_images(
            &[
                NewImage {
                    id: "img-1".into(),
                    image_file: "img-1.png".into(),
                    thumb_file: "img-1.thumb.png".into(),
                },
                NewImage {
                    id: "img-2".into(),
                    image_file: "img-2.png".into(),
                    thumb_file: "img-2.thumb.png".into(),
                },
            ],
            "图片",
        )
        .unwrap();
        let cards = db.list_cards().unwrap();
        assert_eq!(cards[0].id, "img-1");
        assert_eq!(cards[0].title.as_deref(), Some("图片1"));
        assert_eq!(cards[1].id, "img-2");
        assert_eq!(cards[1].title.as_deref(), Some("图片2"));
        assert_eq!(cards[2].title.as_deref(), Some("文字1"));
        assert!(db.update_body("img-1", "不能").is_err());
    }

    #[test]
    fn rejects_empty_body_and_long_title() {
        let mut db = Db::open_memory().unwrap();
        assert!(db.create_text("标题", "   ").is_err());
        let too_long = "题".repeat(201);
        assert!(db.create_text(&too_long, "正文").is_err());
    }

    #[test]
    fn delete_removes_the_row_and_closes_the_gap() {
        let mut db = Db::open_memory().unwrap();
        let first = db.create_text("甲", "a").unwrap();
        let second = db.create_text("乙", "b").unwrap();
        db.delete(&second.id).unwrap();
        let cards = db.list_cards().unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].id, first.id);
        assert_eq!(cards[0].sort_order, 0);
    }

    #[test]
    fn move_to_top_puts_the_card_first_and_keeps_the_rest() {
        let mut db = Db::open_memory().unwrap();
        let first = db.create_text("甲", "a").unwrap();
        let second = db.create_text("乙", "b").unwrap();
        let third = db.create_text("丙", "c").unwrap();
        // newest lands on top: 丙, 乙, 甲
        db.move_to_top(&first.id).unwrap();
        let cards = db.list_cards().unwrap();
        assert_eq!(
            cards.iter().map(|c| c.title.clone()).collect::<Vec<_>>(),
            vec![Some("甲".into()), Some("丙".into()), Some("乙".into())]
        );
        assert_eq!(cards[0].id, first.id);
        assert_eq!(cards[0].sort_order, 0);
        assert_eq!(cards[1].id, third.id);
        assert_eq!(cards[1].sort_order, 1);
        assert_eq!(cards[2].id, second.id);
        assert_eq!(cards[2].sort_order, 2);
        db.move_to_top(&first.id).unwrap();
        let again = db.list_cards().unwrap();
        assert_eq!(again[0].id, first.id);
    }

    #[test]
    fn window_round_trip() {
        let db = Db::open_memory().unwrap();
        assert!(db.window().unwrap().is_none());
        db.save_window(12.0, -4.0, 336.0, 492.0, false, None, None).unwrap();
        assert_eq!(
            db.window().unwrap(),
            Some(WindowState {
                x: 12.0,
                y: -4.0,
                width: 336.0,
                height: 492.0,
                collapsed: false,
                chip_x: None,
                chip_y: None,
            })
        );
        db.save_window(12.0, -4.0, 336.0, 492.0, true, Some(80.0), Some(90.0))
            .unwrap();
        assert_eq!(
            db.window().unwrap(),
            Some(WindowState {
                x: 12.0,
                y: -4.0,
                width: 336.0,
                height: 492.0,
                collapsed: true,
                chip_x: Some(80.0),
                chip_y: Some(90.0),
            })
        );
        assert!(db.save_window(f64::NAN, 0.0, 336.0, 492.0, false, None, None).is_err());
        assert!(db.save_window(0.0, 0.0, 0.0, 640.0, false, None, None).is_err());
        assert!(db
            .save_window(0.0, 0.0, 336.0, 492.0, true, Some(80.0), None)
            .is_err());
    }

    #[test]
    fn migrates_a_four_column_window_row() {
        let dir = std::env::temp_dir().join(format!("bianliban-win-{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cards.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(
                "CREATE TABLE window_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    x REAL NOT NULL,
                    y REAL NOT NULL,
                    width REAL NOT NULL,
                    height REAL NOT NULL
                );
                INSERT INTO window_state (id, x, y, width, height) VALUES (1, 10.0, 20.0, 420.0, 640.0);",
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        assert_eq!(
            db.window().unwrap(),
            Some(WindowState {
                x: 10.0,
                y: 20.0,
                width: 420.0,
                height: 640.0,
                collapsed: false,
                chip_x: None,
                chip_y: None,
            })
        );
        db.save_window(10.0, 20.0, 336.0, 492.0, true, Some(40.0), Some(50.0))
            .unwrap();
        assert_eq!(db.window().unwrap().unwrap().chip_x, Some(40.0));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn opens_a_v1_database_and_flattens_zones() {
        let dir = std::env::temp_dir().join(format!("bianliban-v1-{}", Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("cards.db");
        {
            let conn = Connection::open(&path).unwrap();
            conn.execute_batch(V1_SCHEMA).unwrap();
            conn.execute(
                "INSERT INTO settings (id, edge, anchor) VALUES (1, 'right', 12.5)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO cards (id, kind, title, body, image_file, thumb_file, zone, sort_order, created_at, updated_at)
                 VALUES ('p', 'text', '钉住', '甲', NULL, NULL, 'pinned', 1, 1, 1)",
                [],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO cards (id, kind, title, body, image_file, thumb_file, zone, sort_order, created_at, updated_at)
                 VALUES ('i', 'image', NULL, '', 'i.png', 'i.thumb.png', 'inbox', 0, 2, 2)",
                [],
            )
            .unwrap();
        }
        let db = Db::open(&path).unwrap();
        let cards = db.list_cards().unwrap();
        assert!(cards.iter().all(|card| card.zone == "inbox"));
        assert_eq!(cards[0].id, "p");
        assert_eq!(cards[0].title.as_deref(), Some("钉住"));
        assert_eq!(cards[1].id, "i");
        assert_eq!(cards[1].title, None);
        assert_eq!(cards[0].sort_order, 0);
        assert_eq!(cards[1].sort_order, 1);
        assert!(db.window().unwrap().is_none());
        let _ = std::fs::remove_dir_all(dir);
    }
}
