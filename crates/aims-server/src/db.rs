//! PostgreSQL persistence layer for users, AHP bot tokens, models, sessions/conversations, and messages.

use chrono::{NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};

use crate::auth::{
    decode_session_token, generate_bot_credentials, generate_session_token, hash_bot_token,
    hash_password, verify_password,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRecord {
    pub id: i64,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotTokenRecord {
    pub id: i64,
    pub name: String,
    pub token_hash: String,
    pub channel_code: Option<String>,
    pub bot_type: String,
    pub metadata: Value,
    pub is_connected: bool,
    pub is_working: bool,
    pub last_connected_at: Option<String>,
    pub inserted_at: String,
    pub user_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotModelRecord {
    pub id: i64,
    pub name: String,
    pub input_cost_per_token: String,
    pub output_cost_per_token: String,
    pub context_sizes: Vec<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationRecord {
    pub id: i64,
    pub title: Option<String>,
    pub external_session_id: Option<String>,
    pub status: String,
    pub metadata: Value,
    pub parent_session_id: Option<String>,
    pub bot_token_id: i64,
    pub user_id: i64,
    pub bot_name: Option<String>,
    pub bot_type: Option<String>,
    pub bot_connected: Option<bool>,
    pub last_user_input_time: Option<String>,
    pub last_modified_time: Option<String>,
    pub last_message_at: Option<String>,
    pub inserted_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageRecord {
    pub id: i64,
    pub conversation_id: i64,
    pub role: String,
    pub content_type: String,
    pub body: Option<String>,
    pub metadata: Value,
    pub model: Option<String>,
    pub context_size: Option<i32>,
    pub acknowledged: bool,
    pub acknowledged_at: Option<String>,
    pub is_suggestion: bool,
    pub inserted_at: String,
}

pub fn format_utc(dt: NaiveDateTime) -> String {
    format!("{}Z", dt.format("%Y-%m-%dT%H:%M:%S"))
}

pub fn now_naive() -> NaiveDateTime {
    Utc::now().naive_utc()
}

pub async fn init_db(pool: &PgPool) -> Result<(), sqlx::Error> {
    let statements = [
        "CREATE EXTENSION IF NOT EXISTS citext",
        r#"
        CREATE TABLE IF NOT EXISTS users (
            id BIGSERIAL PRIMARY KEY,
            email citext NOT NULL UNIQUE,
            hashed_password VARCHAR(255),
            confirmed_at TIMESTAMP(0) WITHOUT TIME ZONE,
            inserted_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS users_tokens (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token BYTEA NOT NULL,
            context VARCHAR(255) NOT NULL,
            sent_to VARCHAR(255),
            authenticated_at TIMESTAMP(0) WITHOUT TIME ZONE,
            inserted_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            UNIQUE (context, token)
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS bot_tokens (
            id BIGSERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            token_hash VARCHAR(255) NOT NULL UNIQUE,
            channel_code VARCHAR(255),
            last_connected_at TIMESTAMP(0) WITHOUT TIME ZONE,
            is_connected BOOLEAN NOT NULL DEFAULT FALSE,
            is_working BOOLEAN NOT NULL DEFAULT FALSE,
            bot_type VARCHAR(50) NOT NULL DEFAULT 'ahp',
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            revoked_at TIMESTAMP(0) WITHOUT TIME ZONE,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            inserted_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS bot_models (
            id BIGSERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            input_cost_per_token NUMERIC NOT NULL DEFAULT 0,
            output_cost_per_token NUMERIC NOT NULL DEFAULT 0,
            context_sizes INTEGER[] NOT NULL DEFAULT '{}',
            bot_token_id BIGINT NOT NULL REFERENCES bot_tokens(id) ON DELETE CASCADE,
            inserted_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            UNIQUE (bot_token_id, name)
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS conversations (
            id BIGSERIAL PRIMARY KEY,
            title VARCHAR(255),
            external_session_id VARCHAR(255),
            status VARCHAR(64) NOT NULL DEFAULT 'idle',
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            bot_token_id BIGINT NOT NULL REFERENCES bot_tokens(id) ON DELETE CASCADE,
            inserted_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS messages (
            id BIGSERIAL PRIMARY KEY,
            role VARCHAR(50) NOT NULL,
            content_type VARCHAR(50) NOT NULL DEFAULT 'text',
            body TEXT,
            metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
            model VARCHAR(255),
            context_size INTEGER,
            acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
            acknowledged_at TIMESTAMP(0) WITHOUT TIME ZONE,
            is_suggestion BOOLEAN NOT NULL DEFAULT FALSE,
            conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            inserted_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc'),
            updated_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
        )
        "#,
        "CREATE INDEX IF NOT EXISTS conversations_bot_ext_idx ON conversations(bot_token_id, external_session_id)",
        "CREATE INDEX IF NOT EXISTS messages_conv_id_idx ON messages(conversation_id, id)",
    ];

    for stmt in statements {
        sqlx::query(stmt).execute(pool).await?;
    }

    Ok(())
}

// --- Users & Auth ---

pub async fn register_user(
    pool: &PgPool,
    email: &str,
    password: &str,
) -> Result<(UserRecord, String), String> {
    let email = email.trim();
    if email.is_empty() || !email.contains('@') {
        return Err("Email must have the @ sign and no spaces".to_string());
    }
    if password.len() < 8 {
        return Err("Password should be at least 8 character(s)".to_string());
    }

    let hashed = hash_password(password).map_err(|e| e.to_string())?;
    let now = now_naive();

    let row = sqlx::query(
        r#"
        INSERT INTO users (email, hashed_password, inserted_at, updated_at)
        VALUES ($1::citext, $2, $3, $3)
        RETURNING id, email::text AS email
        "#,
    )
    .bind(email)
    .bind(&hashed)
    .bind(now)
    .fetch_one(pool)
    .await
    .map_err(|e| {
        if e.to_string().contains("unique") || e.to_string().contains("duplicate") {
            "Email has already been taken".to_string()
        } else {
            e.to_string()
        }
    })?;

    let user = UserRecord {
        id: row.get("id"),
        email: row.get("email"),
    };
    let token = create_user_session(pool, user.id).await.map_err(|e| e.to_string())?;
    Ok((user, token))
}

pub async fn login_user(
    pool: &PgPool,
    email: &str,
    password: &str,
) -> Result<Option<(UserRecord, String)>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT id, email::text AS email, hashed_password
        FROM users
        WHERE email = $1::citext
        "#,
    )
    .bind(email.trim())
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    let hashed: Option<String> = row.get("hashed_password");
    let Some(hashed) = hashed else {
        return Ok(None);
    };

    if !verify_password(password, &hashed) {
        return Ok(None);
    }

    let user = UserRecord {
        id: row.get("id"),
        email: row.get("email"),
    };
    let token = create_user_session(pool, user.id).await?;
    Ok(Some((user, token)))
}

pub async fn create_user_session(pool: &PgPool, user_id: i64) -> Result<String, sqlx::Error> {
    let (raw, encoded) = generate_session_token();
    let now = now_naive();
    sqlx::query(
        r#"
        INSERT INTO users_tokens (user_id, token, context, authenticated_at, inserted_at)
        VALUES ($1, $2, 'session', $3, $3)
        "#,
    )
    .bind(user_id)
    .bind(&raw)
    .bind(now)
    .execute(pool)
    .await?;

    Ok(encoded)
}

pub async fn authenticate_user_token(
    pool: &PgPool,
    encoded_token: &str,
) -> Result<Option<UserRecord>, sqlx::Error> {
    let Some(raw) = decode_session_token(encoded_token) else {
        return Ok(None);
    };

    let row = sqlx::query(
        r#"
        SELECT u.id, u.email::text AS email
        FROM users_tokens t
        INNER JOIN users u ON u.id = t.user_id
        WHERE t.token = $1
          AND t.context = 'session'
          AND t.inserted_at > (NOW() AT TIME ZONE 'utc') - INTERVAL '14 days'
        LIMIT 1
        "#,
    )
    .bind(&raw)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| UserRecord {
        id: r.get("id"),
        email: r.get("email"),
    }))
}

// --- Bot Tokens ---

fn map_bot_token_row(r: &sqlx::postgres::PgRow) -> BotTokenRecord {
    let last_conn: Option<NaiveDateTime> = r.get("last_connected_at");
    let inserted: NaiveDateTime = r.get("inserted_at");
    BotTokenRecord {
        id: r.get("id"),
        name: r.get("name"),
        token_hash: r.get("token_hash"),
        channel_code: r.get("channel_code"),
        bot_type: r.get("bot_type"),
        metadata: r.get("metadata"),
        is_connected: r.get("is_connected"),
        is_working: r.get("is_working"),
        last_connected_at: last_conn.map(format_utc),
        inserted_at: format_utc(inserted),
        user_id: r.get("user_id"),
    }
}

pub async fn list_bot_tokens(
    pool: &PgPool,
    user_id: i64,
) -> Result<Vec<BotTokenRecord>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, name, token_hash, channel_code, bot_type, metadata,
               is_connected, is_working, last_connected_at, inserted_at, user_id
        FROM bot_tokens
        WHERE user_id = $1 AND revoked_at IS NULL
        ORDER BY inserted_at DESC, id DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.iter().map(map_bot_token_row).collect())
}

pub async fn get_bot_token(
    pool: &PgPool,
    bot_token_id: i64,
    user_id: Option<i64>,
) -> Result<Option<BotTokenRecord>, sqlx::Error> {
    let row = if let Some(uid) = user_id {
        sqlx::query(
            r#"
            SELECT id, name, token_hash, channel_code, bot_type, metadata,
                   is_connected, is_working, last_connected_at, inserted_at, user_id
            FROM bot_tokens
            WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
            "#,
        )
        .bind(bot_token_id)
        .bind(uid)
        .fetch_optional(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT id, name, token_hash, channel_code, bot_type, metadata,
                   is_connected, is_working, last_connected_at, inserted_at, user_id
            FROM bot_tokens
            WHERE id = $1 AND revoked_at IS NULL
            "#,
        )
        .bind(bot_token_id)
        .fetch_optional(pool)
        .await?
    };

    Ok(row.as_ref().map(map_bot_token_row))
}

pub async fn authenticate_bot_token(
    pool: &PgPool,
    raw_token: &str,
) -> Result<Option<BotTokenRecord>, sqlx::Error> {
    let hash = hash_bot_token(raw_token.trim());
    let row = sqlx::query(
        r#"
        SELECT id, name, token_hash, channel_code, bot_type, metadata,
               is_connected, is_working, last_connected_at, inserted_at, user_id
        FROM bot_tokens
        WHERE token_hash = $1 AND revoked_at IS NULL
        LIMIT 1
        "#,
    )
    .bind(&hash)
    .fetch_optional(pool)
    .await?;

    Ok(row.as_ref().map(map_bot_token_row))
}

pub async fn create_bot_token(
    pool: &PgPool,
    user_id: i64,
    name: &str,
    bot_type: Option<&str>,
    metadata: Option<Value>,
) -> Result<(BotTokenRecord, String), sqlx::Error> {
    let (raw_token, token_hash, channel_code) = generate_bot_credentials();
    let now = now_naive();
    // Always default to "ahp" in the Rust AHP rewrite
    let resolved_type = match bot_type {
        Some("chat") => "chat",
        _ => "ahp",
    };
    let meta = metadata.unwrap_or_else(|| json!({}));

    let row = sqlx::query(
        r#"
        INSERT INTO bot_tokens
            (name, token_hash, channel_code, bot_type, metadata, is_connected, is_working, user_id, inserted_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, FALSE, FALSE, $6, $7, $7)
        RETURNING id, name, token_hash, channel_code, bot_type, metadata,
                  is_connected, is_working, last_connected_at, inserted_at, user_id
        "#,
    )
    .bind(name.trim())
    .bind(&token_hash)
    .bind(&channel_code)
    .bind(resolved_type)
    .bind(&meta)
    .bind(user_id)
    .bind(now)
    .fetch_one(pool)
    .await?;

    Ok((map_bot_token_row(&row), raw_token))
}

pub async fn regenerate_bot_token(
    pool: &PgPool,
    bot_token_id: i64,
    user_id: i64,
) -> Result<Option<(BotTokenRecord, String)>, sqlx::Error> {
    let (raw_token, token_hash, channel_code) = generate_bot_credentials();
    let now = now_naive();

    let row = sqlx::query(
        r#"
        UPDATE bot_tokens
        SET token_hash = $1, channel_code = $2, updated_at = $3
        WHERE id = $4 AND user_id = $5 AND revoked_at IS NULL
        RETURNING id, name, token_hash, channel_code, bot_type, metadata,
                  is_connected, is_working, last_connected_at, inserted_at, user_id
        "#,
    )
    .bind(&token_hash)
    .bind(&channel_code)
    .bind(now)
    .bind(bot_token_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.as_ref().map(|r| (map_bot_token_row(r), raw_token)))
}

pub async fn revoke_bot_token(
    pool: &PgPool,
    bot_token_id: i64,
    user_id: i64,
) -> Result<bool, sqlx::Error> {
    let now = now_naive();
    let res = sqlx::query(
        r#"
        UPDATE bot_tokens
        SET revoked_at = $1, updated_at = $1
        WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL
        "#,
    )
    .bind(now)
    .bind(bot_token_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(res.rows_affected() > 0)
}

pub async fn update_bot_status(
    pool: &PgPool,
    bot_token_id: i64,
    is_connected: Option<bool>,
    is_working: Option<bool>,
    metadata_patch: Option<Value>,
) -> Result<Option<BotTokenRecord>, sqlx::Error> {
    let Some(current) = get_bot_token(pool, bot_token_id, None).await? else {
        return Ok(None);
    };

    let next_connected = is_connected.unwrap_or(current.is_connected);
    let next_working = is_working.unwrap_or(current.is_working);
    let now = now_naive();

    let mut next_meta = current.metadata.clone();
    if let (Some(obj), Some(patch_obj)) = (
        next_meta.as_object_mut(),
        metadata_patch.as_ref().and_then(|v| v.as_object()),
    ) {
        for (k, v) in patch_obj {
            obj.insert(k.clone(), v.clone());
        }

        // If any worktree capability was reported as enabled/true, synchronize worktree_supported
        let is_wt_truthy = |val: &Value| -> bool {
            match val {
                Value::Bool(b) => *b,
                Value::Number(n) => n.as_i64() == Some(1),
                Value::String(s) => {
                    let lower = s.trim().to_lowercase();
                    matches!(
                        lower.as_str(),
                        "true" | "enabled" | "supported" | "active" | "yes" | "on" | "worktree" | "1"
                    )
                }
                _ => false,
            }
        };

        let has_truthy_wt = [
            "worktrees",
            "worktree",
            "worktrees_enabled",
            "worktree_enabled",
            "worktrees_supported",
            "worktree_supported",
            "supports_worktrees",
            "supports_worktree",
            "allow_worktree",
            "allow_worktrees",
            "enable_worktrees",
            "enable_worktree",
        ]
        .iter()
        .any(|k| patch_obj.get(*k).map(is_wt_truthy).unwrap_or(false))
            || patch_obj
                .get("capabilities")
                .and_then(|c| c.as_object())
                .map(|caps| {
                    [
                        "worktrees",
                        "worktree",
                        "worktrees_enabled",
                        "worktree_enabled",
                        "worktrees_supported",
                        "worktree_supported",
                        "supports_worktrees",
                        "supports_worktree",
                    ]
                    .iter()
                    .any(|k| caps.get(*k).map(is_wt_truthy).unwrap_or(false))
                })
                .unwrap_or(false)
            || patch_obj
                .get("capabilities")
                .and_then(|c| c.as_array())
                .map(|arr| {
                    arr.iter().any(|item| {
                        item.as_str()
                            .map(|s| {
                                let l = s.to_lowercase();
                                l == "worktrees" || l == "worktree" || l.contains("worktree")
                            })
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false);

        if has_truthy_wt {
            obj.insert("worktree_supported".to_string(), json!(true));
            obj.insert("worktrees_supported".to_string(), json!(true));
            obj.insert("worktrees_enabled".to_string(), json!(true));
            obj.insert("worktrees".to_string(), json!(true));
        }
    }

    let row = if is_connected == Some(true) {
        sqlx::query(
            r#"
            UPDATE bot_tokens
            SET is_connected = $1, is_working = $2, metadata = $3, last_connected_at = $4, updated_at = $4
            WHERE id = $5
            RETURNING id, name, token_hash, channel_code, bot_type, metadata,
                      is_connected, is_working, last_connected_at, inserted_at, user_id
            "#,
        )
        .bind(next_connected)
        .bind(next_working)
        .bind(&next_meta)
        .bind(now)
        .bind(bot_token_id)
        .fetch_optional(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            UPDATE bot_tokens
            SET is_connected = $1, is_working = $2, metadata = $3, updated_at = $4
            WHERE id = $5
            RETURNING id, name, token_hash, channel_code, bot_type, metadata,
                      is_connected, is_working, last_connected_at, inserted_at, user_id
            "#,
        )
        .bind(next_connected)
        .bind(next_working)
        .bind(&next_meta)
        .bind(now)
        .bind(bot_token_id)
        .fetch_optional(pool)
        .await?
    };

    Ok(row.as_ref().map(map_bot_token_row))
}

// --- Bot Models ---

pub async fn list_bot_models(
    pool: &PgPool,
    bot_token_id: i64,
) -> Result<Vec<BotModelRecord>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, name,
               input_cost_per_token::text AS input_cost_per_token,
               output_cost_per_token::text AS output_cost_per_token,
               context_sizes
        FROM bot_models
        WHERE bot_token_id = $1
        ORDER BY name ASC
        "#,
    )
    .bind(bot_token_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| BotModelRecord {
            id: r.get("id"),
            name: r.get("name"),
            input_cost_per_token: r.get("input_cost_per_token"),
            output_cost_per_token: r.get("output_cost_per_token"),
            context_sizes: r.get::<Option<Vec<i32>>, _>("context_sizes").unwrap_or_default(),
        })
        .collect())
}

pub async fn set_bot_models(
    pool: &PgPool,
    bot_token_id: i64,
    models: &[Value],
) -> Result<Vec<BotModelRecord>, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM bot_models WHERE bot_token_id = $1")
        .bind(bot_token_id)
        .execute(&mut *tx)
        .await?;

    let now = now_naive();
    for m in models {
        let Some(name) = m.get("name").or_else(|| m.get("id")).and_then(|v| v.as_str()) else {
            continue;
        };
        let input_cost = m
            .get("input_cost_per_token")
            .map(|v| match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                _ => "0".to_string(),
            })
            .unwrap_or_else(|| "0".to_string());
        let output_cost = m
            .get("output_cost_per_token")
            .map(|v| match v {
                Value::String(s) => s.clone(),
                Value::Number(n) => n.to_string(),
                _ => "0".to_string(),
            })
            .unwrap_or_else(|| "0".to_string());
        let context_sizes: Vec<i32> = m
            .get("context_sizes")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|x| x.as_i64().map(|n| n as i32))
                    .collect()
            })
            .unwrap_or_default();

        sqlx::query(
            r#"
            INSERT INTO bot_models
                (name, input_cost_per_token, output_cost_per_token, context_sizes, bot_token_id, inserted_at, updated_at)
            VALUES ($1, $2::numeric, $3::numeric, $4, $5, $6, $6)
            ON CONFLICT (bot_token_id, name) DO UPDATE
            SET input_cost_per_token = EXCLUDED.input_cost_per_token,
                output_cost_per_token = EXCLUDED.output_cost_per_token,
                context_sizes = EXCLUDED.context_sizes,
                updated_at = EXCLUDED.updated_at
            "#,
        )
        .bind(name)
        .bind(&input_cost)
        .bind(&output_cost)
        .bind(&context_sizes)
        .bind(bot_token_id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    list_bot_models(pool, bot_token_id).await
}

// --- Conversations & AHP Sessions ---

fn extract_parent_session_id(meta: &Value) -> Option<String> {
    meta.get("parent_session_id")
        .or_else(|| meta.get("parentSessionId"))
        .or_else(|| meta.get("parent_id"))
        .or_else(|| meta.get("parentId"))
        .and_then(|v| match v {
            Value::String(s) if !s.is_empty() => Some(s.clone()),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
}

fn map_conversation_row(r: &sqlx::postgres::PgRow) -> ConversationRecord {
    let inserted: NaiveDateTime = r.get("inserted_at");
    let updated: NaiveDateTime = r.get("updated_at");
    let last_msg: Option<NaiveDateTime> = r.try_get("last_message_at").ok().flatten();
    let last_user: Option<NaiveDateTime> = r.try_get("last_user_input_time").ok().flatten();
    let meta: Value = r.get("metadata");

    let parent_session_id = extract_parent_session_id(&meta);
    let last_user_str = meta
        .get("last_user_input_time")
        .or_else(|| meta.get("lastUserInputTime"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| last_user.map(format_utc));

    let last_mod_str = meta
        .get("last_modified_time")
        .or_else(|| meta.get("lastModifiedTime"))
        .or_else(|| meta.get("source_updated_at"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| last_msg.map(format_utc))
        .unwrap_or_else(|| format_utc(updated));

    let last_msg_str = last_msg
        .map(format_utc)
        .or_else(|| {
            meta.get("last_message_at")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .or_else(|| Some(last_mod_str.clone()));

    ConversationRecord {
        id: r.get("id"),
        title: r.get("title"),
        external_session_id: r.get("external_session_id"),
        status: r.get("status"),
        metadata: meta,
        parent_session_id,
        bot_token_id: r.get("bot_token_id"),
        user_id: r.get("user_id"),
        bot_name: r.try_get("bot_name").ok(),
        bot_type: r.try_get("bot_type").ok(),
        bot_connected: r.try_get("bot_connected").ok(),
        last_user_input_time: last_user_str,
        last_modified_time: Some(last_mod_str),
        last_message_at: last_msg_str,
        inserted_at: format_utc(inserted),
        updated_at: format_utc(updated),
    }
}

fn subagent_conversation(conversation: &ConversationRecord) -> bool {
    conversation.external_session_id.as_deref()
        .is_some_and(|id| id.starts_with("ahp-chat://subagent/"))
        || conversation.metadata["is_subagent"] == true
        || conversation.metadata["session_uri"].as_str()
            .is_some_and(|id| id.starts_with("ahp-chat://subagent/"))
}

pub async fn list_conversations(
    pool: &PgPool,
    user_id: i64,
    include_archived: bool,
) -> Result<Vec<ConversationRecord>, sqlx::Error> {
    let rows = if include_archived {
        sqlx::query(
            r#"
            SELECT c.id, c.title, c.external_session_id, c.status, c.metadata,
                   c.bot_token_id, c.user_id, c.inserted_at, c.updated_at,
                   b.name AS bot_name, b.bot_type AS bot_type, b.is_connected AS bot_connected,
                   (SELECT MAX(m.inserted_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at,
                   (SELECT MAX(m.inserted_at) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS last_user_input_time
            FROM conversations c
            INNER JOIN bot_tokens b ON b.id = c.bot_token_id
            WHERE c.user_id = $1
            ORDER BY c.updated_at DESC, c.id DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT c.id, c.title, c.external_session_id, c.status, c.metadata,
                   c.bot_token_id, c.user_id, c.inserted_at, c.updated_at,
                   b.name AS bot_name, b.bot_type AS bot_type, b.is_connected AS bot_connected,
                   (SELECT MAX(m.inserted_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at,
                   (SELECT MAX(m.inserted_at) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS last_user_input_time
            FROM conversations c
            INNER JOIN bot_tokens b ON b.id = c.bot_token_id
            WHERE c.user_id = $1 AND c.status != 'archived'
            ORDER BY c.updated_at DESC, c.id DESC
            "#,
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?
    };

    Ok(rows.iter().map(map_conversation_row)
        .filter(|conversation| include_archived || !subagent_conversation(conversation))
        .collect())
}

pub async fn list_conversations_for_bot(
    pool: &PgPool,
    bot_token_id: i64,
    include_archived: bool,
) -> Result<Vec<ConversationRecord>, sqlx::Error> {
    let rows = if include_archived {
        sqlx::query(
            r#"
            SELECT c.id, c.title, c.external_session_id, c.status, c.metadata,
                   c.bot_token_id, c.user_id, c.inserted_at, c.updated_at,
                   b.name AS bot_name, b.bot_type AS bot_type, b.is_connected AS bot_connected,
                   (SELECT MAX(m.inserted_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at,
                   (SELECT MAX(m.inserted_at) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS last_user_input_time
            FROM conversations c
            INNER JOIN bot_tokens b ON b.id = c.bot_token_id
            WHERE c.bot_token_id = $1
            ORDER BY c.updated_at DESC, c.id DESC
            "#,
        )
        .bind(bot_token_id)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT c.id, c.title, c.external_session_id, c.status, c.metadata,
                   c.bot_token_id, c.user_id, c.inserted_at, c.updated_at,
                   b.name AS bot_name, b.bot_type AS bot_type, b.is_connected AS bot_connected,
                   (SELECT MAX(m.inserted_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at,
                   (SELECT MAX(m.inserted_at) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS last_user_input_time
            FROM conversations c
            INNER JOIN bot_tokens b ON b.id = c.bot_token_id
            WHERE c.bot_token_id = $1 AND c.status != 'archived'
            ORDER BY c.updated_at DESC, c.id DESC
            "#,
        )
        .bind(bot_token_id)
        .fetch_all(pool)
        .await?
    };

    Ok(rows.iter().map(map_conversation_row)
        .filter(|conversation| include_archived || !subagent_conversation(conversation))
        .collect())
}

pub async fn get_conversation(
    pool: &PgPool,
    conversation_id: i64,
    user_id: Option<i64>,
    bot_token_id: Option<i64>,
) -> Result<Option<ConversationRecord>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT c.id, c.title, c.external_session_id, c.status, c.metadata,
               c.bot_token_id, c.user_id, c.inserted_at, c.updated_at,
               b.name AS bot_name, b.bot_type AS bot_type, b.is_connected AS bot_connected,
               (SELECT MAX(m.inserted_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at,
               (SELECT MAX(m.inserted_at) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS last_user_input_time
        FROM conversations c
        INNER JOIN bot_tokens b ON b.id = c.bot_token_id
        WHERE c.id = $1
          AND ($2::bigint IS NULL OR c.user_id = $2)
          AND ($3::bigint IS NULL OR c.bot_token_id = $3)
        "#,
    )
    .bind(conversation_id)
    .bind(user_id)
    .bind(bot_token_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.as_ref().map(map_conversation_row))
}

pub async fn get_conversation_by_external_session(
    pool: &PgPool,
    bot_token_id: i64,
    external_session_id: &str,
) -> Result<Option<ConversationRecord>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT c.id, c.title, c.external_session_id, c.status, c.metadata,
               c.bot_token_id, c.user_id, c.inserted_at, c.updated_at,
               b.name AS bot_name, b.bot_type AS bot_type, b.is_connected AS bot_connected,
               (SELECT MAX(m.inserted_at) FROM messages m WHERE m.conversation_id = c.id) AS last_message_at,
               (SELECT MAX(m.inserted_at) FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user') AS last_user_input_time
        FROM conversations c
        INNER JOIN bot_tokens b ON b.id = c.bot_token_id
        WHERE c.bot_token_id = $1 AND $2 <> '' AND (
            c.external_session_id = $2
            OR c.external_session_id IN ('ahp-session:/' || $2, 'ahp-chat:/' || $2)
            OR $2 IN ('ahp-session:/' || c.external_session_id, 'ahp-chat:/' || c.external_session_id)
            OR c.metadata->>'default_chat_uri' = $2
            OR c.metadata->>'session_uri' = $2
        )
        ORDER BY (c.external_session_id = $2) DESC, c.id DESC
        LIMIT 1
        "#,
    )
    .bind(bot_token_id)
    .bind(external_session_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.as_ref().map(map_conversation_row))
}

pub async fn reconcile_conversation(
    pool: &PgPool,
    bot_token_id: i64,
    external_session_id: &str,
    title: &str,
    status: &str,
    metadata: Value,
) -> Result<Option<ConversationRecord>, sqlx::Error> {
    let Some(existing) =
        get_conversation_by_external_session(pool, bot_token_id, external_session_id).await?
    else {
        return Ok(None);
    };
    update_conversation(pool, existing.id, Some(title), Some(status), Some(metadata)).await
}

pub async fn create_conversation(
    pool: &PgPool,
    user_id: i64,
    bot_token_id: i64,
    title: &str,
    external_session_id: Option<&str>,
    status: Option<&str>,
    metadata: Value,
) -> Result<ConversationRecord, sqlx::Error> {
    let now = now_naive();

    // Archive duplicate empty placeholder sessions with generic "* Session" title
    if title == "Session" || title.ends_with(" Session") {
        sqlx::query(
            r#"
            UPDATE conversations c
            SET status = 'archived', updated_at = $1
            WHERE c.bot_token_id = $2
              AND c.title = $3
              AND c.status IN ('idle', 'new', 'draft')
              AND NOT EXISTS (
                  SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user'
              )
            "#,
        )
        .bind(now)
        .bind(bot_token_id)
        .bind(title)
        .execute(pool)
        .await?;
    }

    let ext_id = external_session_id
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.to_string());

    let bot = get_bot_token(pool, bot_token_id, None).await?;
    let mut merged_meta = json!({});
    if let Some(ref b) = bot {
        if let Some(b_obj) = b.metadata.as_object() {
            for k in [
                "capabilities",
                "agent_roles",
                "agentRoles",
                "agent_types",
                "agentTypes",
                "roles",
                "modes",
                "agent_modes",
                "worktree_supported",
                "worktrees_supported",
                "worktrees",
                "worktree",
                "worktrees_enabled",
                "worktree_enabled",
                "supports_worktrees",
                "supports_worktree",
                "allow_worktree",
                "branches",
                "available_branches",
                "base_branch",
                "agent_mode",
                "agent_type",
            ] {
                if let Some(v) = b_obj.get(k) {
                    merged_meta[k] = v.clone();
                }
            }
        }
    }
    if let (Some(target), Some(incoming)) = (merged_meta.as_object_mut(), metadata.as_object()) {
        for (k, v) in incoming {
            target.insert(k.clone(), v.clone());
        }
    }

    let row = sqlx::query(
        r#"
        INSERT INTO conversations
            (title, external_session_id, status, metadata, user_id, bot_token_id, inserted_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        RETURNING id
        "#,
    )
    .bind(title)
    .bind(&ext_id)
    .bind(status.unwrap_or("idle"))
    .bind(&merged_meta)
    .bind(user_id)
    .bind(bot_token_id)
    .bind(now)
    .fetch_one(pool)
    .await?;

    let conv_id: i64 = row.get("id");
    get_conversation(pool, conv_id, None, None)
        .await?
        .ok_or(sqlx::Error::RowNotFound)
}

pub async fn update_conversation(
    pool: &PgPool,
    conversation_id: i64,
    title: Option<&str>,
    status: Option<&str>,
    metadata_patch: Option<Value>,
) -> Result<Option<ConversationRecord>, sqlx::Error> {
    let Some(current) = get_conversation(pool, conversation_id, None, None).await? else {
        return Ok(None);
    };

    let next_title = title
        .map(|s| s.to_string())
        .or_else(|| current.title.clone());
    let next_status = if subagent_conversation(&current)
        || metadata_patch.as_ref().is_some_and(|patch| patch["is_subagent"] == true)
    {
        "archived"
    } else {
        status.unwrap_or(&current.status)
    }.to_string();

    let mut next_meta = current.metadata.clone();
    if matches!(
        next_status.as_str(),
        "idle" | "completed" | "done" | "archived"
    ) {
        if let Some(obj) = next_meta.as_object_mut() {
            for k in ["question", "step", "tool", "action", "command"] {
                obj.remove(k);
            }
        }
    }
    if let (Some(obj), Some(patch)) = (
        next_meta.as_object_mut(),
        metadata_patch.as_ref().and_then(|v| v.as_object()),
    ) {
        for (k, v) in patch {
            obj.insert(k.clone(), v.clone());
        }
    }

    let now = now_naive();
    sqlx::query(
        r#"
        UPDATE conversations
        SET title = $1,
            status = CASE WHEN metadata->>'explicitly_archived' = 'true' THEN 'archived' ELSE $2 END,
            metadata = $3 || CASE WHEN metadata->>'explicitly_archived' = 'true'
                THEN '{"explicitly_archived": true}'::jsonb ELSE '{}'::jsonb END,
            updated_at = $4
        WHERE id = $5
        "#,
    )
    .bind(next_title)
    .bind(&next_status)
    .bind(&next_meta)
    .bind(now)
    .bind(conversation_id)
    .execute(pool)
    .await?;

    get_conversation(pool, conversation_id, None, None).await
}

pub async fn archive_conversation(
    pool: &PgPool,
    conversation_id: i64,
    user_id: i64,
) -> Result<Option<ConversationRecord>, sqlx::Error> {
    let Some(conv) = get_conversation(pool, conversation_id, Some(user_id), None).await? else {
        return Ok(None);
    };
    let mut patch = conv.metadata.clone();
    if let Some(obj) = patch.as_object_mut() {
        obj.insert("explicitly_archived".to_string(), json!(true));
    }
    update_conversation(pool, conversation_id, None, Some("archived"), Some(patch)).await
}

pub async fn archive_completed_bot_session(
    pool: &PgPool,
    bot_token_id: i64,
    external_session_id: &str,
) -> Result<Option<ConversationRecord>, sqlx::Error> {
    let Some(conv) = get_conversation_by_external_session(pool, bot_token_id, external_session_id).await? else {
        return Ok(None);
    };
    let id = sqlx::query_scalar::<_, i64>(
        r#"
        UPDATE conversations
        SET status = 'archived',
            metadata = metadata || '{"explicitly_archived": true}'::jsonb,
            updated_at = $1
        WHERE id = $2 AND bot_token_id = $3
          AND (status IN ('completed', 'done', 'archived')
               OR (status = 'idle' AND metadata->>'last_turn_complete' = 'true'))
        RETURNING id
        "#,
    )
    .bind(now_naive())
    .bind(conv.id)
    .bind(bot_token_id)
    .fetch_optional(pool)
    .await?;
    match id {
        Some(id) => get_conversation(pool, id, None, Some(bot_token_id)).await,
        None => Ok(None),
    }
}

pub async fn resolve_bot_conversation(
    pool: &PgPool,
    bot_token: &BotTokenRecord,
    payload: &Value,
) -> Result<Option<ConversationRecord>, sqlx::Error> {
    if let Some(cid) = payload.get("conversation_id") {
        if let Some(id_num) = cid.as_i64() {
            if let Some(conv) = get_conversation(pool, id_num, None, Some(bot_token.id)).await? {
                return Ok(Some(conv));
            }
        } else if let Some(id_str) = cid.as_str() {
            if let Ok(id_num) = id_str.parse::<i64>() {
                if let Some(conv) = get_conversation(pool, id_num, None, Some(bot_token.id)).await?
                {
                    return Ok(Some(conv));
                }
            }
            if !id_str.is_empty() {
                if let Some(conv) =
                    get_conversation_by_external_session(pool, bot_token.id, id_str).await?
                {
                    return Ok(Some(conv));
                }
                let created = create_conversation(
                    pool,
                    bot_token.user_id,
                    bot_token.id,
                    &format!("Session {}", id_str),
                    Some(id_str),
                    Some("idle"),
                    json!({ "synced_by_bot": true }),
                )
                .await?;
                return Ok(Some(created));
            }
        }
    }

    if let Some(ext_id) = payload
        .get("session_id")
        .or_else(|| payload.get("external_session_id"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        if let Some(conv) = get_conversation_by_external_session(pool, bot_token.id, ext_id).await?
        {
            return Ok(Some(conv));
        }
        let created = create_conversation(
            pool,
            bot_token.user_id,
            bot_token.id,
            &format!("Session {}", ext_id),
            Some(ext_id),
            Some("idle"),
            json!({ "synced_by_bot": true }),
        )
        .await?;
        return Ok(Some(created));
    }

    Ok(None)
}

#[cfg(test)]
mod admin_tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires AIMS_TEST_DATABASE_URL pointing to an isolated test database"]
    async fn archive_is_scoped_completion_guarded_and_persistent() {
        let pool = PgPool::connect(&std::env::var("AIMS_TEST_DATABASE_URL").unwrap()).await.unwrap();
        init_db(&pool).await.unwrap();
        let user_id = sqlx::query_scalar::<_, i64>(
            "INSERT INTO users (email) VALUES ($1::citext) RETURNING id",
        )
        .bind(format!("{}@example.test", uuid::Uuid::new_v4()))
        .fetch_one(&pool).await.unwrap();
        let (bot, _) = create_bot_token(&pool, user_id, "Admin test", None, None).await.unwrap();
        let (other, _) = create_bot_token(&pool, user_id, "Other bot", None, None).await.unwrap();
        assert!(reconcile_conversation(
            &pool, bot.id, "unopened-history", "Old session", "idle", json!({}),
        ).await.unwrap().is_none());
        assert!(get_conversation_by_external_session(&pool, bot.id, "unopened-history")
            .await.unwrap().is_none());
        let stale = create_conversation(
            &pool, user_id, bot.id, "Stale", Some("stale-status"), Some("running"), json!({}),
        ).await.unwrap();
        let refreshed = reconcile_conversation(
            &pool, bot.id, "stale-status", "Stale", "idle", json!({}),
        ).await.unwrap().unwrap();
        assert_eq!(refreshed.id, stale.id);
        assert_eq!(refreshed.status, "idle");
        let uri = "ahp-chat://default/session-one";
        let done = create_conversation(&pool, user_id, bot.id, "Done", Some(uri), Some("idle"),
            json!({"last_turn_complete": true})).await.unwrap();
        let running = create_conversation(&pool, user_id, bot.id, "Running",
            Some("ahp-chat://default/session-two"), Some("running"), json!({"last_turn_complete": true})).await.unwrap();
        let idle = create_conversation(&pool, user_id, bot.id, "Idle",
            Some("idle"), Some("idle"), json!({})).await.unwrap();

        assert!(archive_completed_bot_session(&pool, other.id, uri).await.unwrap().is_none());
        assert!(archive_completed_bot_session(&pool, bot.id, running.external_session_id.as_deref().unwrap()).await.unwrap().is_none());
        assert!(archive_completed_bot_session(&pool, bot.id, idle.external_session_id.as_deref().unwrap()).await.unwrap().is_none());
        assert!(get_conversation_by_external_session(&pool, bot.id, "default").await.unwrap().is_none());
        let archived = archive_completed_bot_session(&pool, bot.id, uri).await.unwrap().unwrap();
        assert_eq!(archived.id, done.id);
        assert_eq!(archived.status, "archived");
        let synced = update_conversation(&pool, done.id, None, Some("running"),
            Some(json!({"last_turn_complete": false}))).await.unwrap().unwrap();
        assert_eq!(synced.status, "archived");
        assert_eq!(synced.metadata["explicitly_archived"], true);
        assert_eq!(get_conversation(&pool, running.id, None, None).await.unwrap().unwrap().status, "running");
        let worker = create_conversation(&pool, user_id, bot.id, "Worker",
            Some("ahp-chat://subagent/session-one/worker"), Some("running"), json!({})).await.unwrap();
        let tool_worker = create_conversation(&pool, user_id, bot.id, "Tool worker",
            Some("tool-worker"), Some("running"), json!({"is_subagent": true})).await.unwrap();
        for listed in [
            list_conversations(&pool, user_id, false).await.unwrap(),
            list_conversations_for_bot(&pool, bot.id, false).await.unwrap(),
        ] {
            assert!(!listed.iter().any(|session| session.id == worker.id || session.id == tool_worker.id));
            assert!(listed.iter().any(|session| session.id == running.id));
        }
        assert!(list_conversations_for_bot(&pool, bot.id, true).await.unwrap()
            .iter().any(|session| session.id == worker.id));
        let synced_worker = update_conversation(&pool, worker.id, None, Some("running"), None).await.unwrap().unwrap();
        assert_eq!(synced_worker.status, "archived");
        pool.close().await;
    }
}

// --- Messages ---

fn map_message_row(r: &sqlx::postgres::PgRow) -> MessageRecord {
    let inserted: NaiveDateTime = r.get("inserted_at");
    let ack_at: Option<NaiveDateTime> = r.get("acknowledged_at");
    MessageRecord {
        id: r.get("id"),
        conversation_id: r.get("conversation_id"),
        role: r.get("role"),
        content_type: r.get("content_type"),
        body: r.get("body"),
        metadata: r.get("metadata"),
        model: r.get("model"),
        context_size: r.get("context_size"),
        acknowledged: r.get("acknowledged"),
        acknowledged_at: ack_at.map(format_utc),
        is_suggestion: r.get("is_suggestion"),
        inserted_at: format_utc(inserted),
    }
}

pub async fn list_messages(
    pool: &PgPool,
    conversation_id: i64,
    after_id: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<MessageRecord>, sqlx::Error> {
    let rows = match (after_id, limit) {
        (Some(aid), Some(lim)) => {
            sqlx::query(
                r#"
                SELECT id, conversation_id, role, content_type, body, metadata,
                       model, context_size, acknowledged, acknowledged_at, is_suggestion, inserted_at
                FROM messages
                WHERE conversation_id = $1 AND id > $2
                ORDER BY id DESC
                LIMIT $3
                "#,
            )
            .bind(conversation_id)
            .bind(aid)
            .bind(lim)
            .fetch_all(pool)
            .await?
        }
        (Some(aid), None) => {
            sqlx::query(
                r#"
                SELECT id, conversation_id, role, content_type, body, metadata,
                       model, context_size, acknowledged, acknowledged_at, is_suggestion, inserted_at
                FROM messages
                WHERE conversation_id = $1 AND id > $2
                ORDER BY id DESC
                "#,
            )
            .bind(conversation_id)
            .bind(aid)
            .fetch_all(pool)
            .await?
        }
        (None, Some(lim)) => {
            sqlx::query(
                r#"
                SELECT id, conversation_id, role, content_type, body, metadata,
                       model, context_size, acknowledged, acknowledged_at, is_suggestion, inserted_at
                FROM messages
                WHERE conversation_id = $1
                ORDER BY id DESC
                LIMIT $2
                "#,
            )
            .bind(conversation_id)
            .bind(lim)
            .fetch_all(pool)
            .await?
        }
        (None, None) => {
            sqlx::query(
                r#"
                SELECT id, conversation_id, role, content_type, body, metadata,
                       model, context_size, acknowledged, acknowledged_at, is_suggestion, inserted_at
                FROM messages
                WHERE conversation_id = $1
                ORDER BY id DESC
                "#,
            )
            .bind(conversation_id)
            .fetch_all(pool)
            .await?
        }
    };

    let mut msgs: Vec<MessageRecord> = rows.iter().map(map_message_row).collect();
    msgs.reverse();
    Ok(msgs)
}

pub async fn create_message(
    pool: &PgPool,
    conversation_id: i64,
    role: &str,
    content_type: &str,
    body: Option<&str>,
    mut metadata: Value,
    model: Option<&str>,
    context_size: Option<i32>,
    is_suggestion: bool,
) -> Result<MessageRecord, String> {
    let is_steer = metadata
        .get("is_steer")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if is_steer {
        if let Some(obj) = metadata.as_object_mut() {
            obj.remove("use_worktree");
            obj.remove("useWorktree");
            obj.remove("worktree");
        }
    }

    if content_type == "text" && body.unwrap_or("").is_empty() {
        return Err("body is required for text messages".to_string());
    }

    let now = now_naive();
    let row = sqlx::query(
        r#"
        INSERT INTO messages
            (conversation_id, role, content_type, body, metadata, model, context_size,
             acknowledged, is_suggestion, inserted_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8, $9, $9)
        RETURNING id, conversation_id, role, content_type, body, metadata,
                  model, context_size, acknowledged, acknowledged_at, is_suggestion, inserted_at
        "#,
    )
    .bind(conversation_id)
    .bind(role)
    .bind(content_type)
    .bind(body)
    .bind(&metadata)
    .bind(model)
    .bind(context_size)
    .bind(is_suggestion)
    .bind(now)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Touch conversation updated_at and sync config metadata if user message
    let mut config_patch = serde_json::Map::new();
    if role == "user" {
        if let Some(obj) = metadata.as_object() {
            for k in [
                "agent_mode",
                "use_worktree",
                "base_branch",
                "agent_type",
                "skill",
                "working_directory",
            ] {
                if is_steer && k == "use_worktree" {
                    continue;
                }
                if let Some(v) = obj.get(k) {
                    if !v.is_null() {
                        config_patch.insert(k.to_string(), v.clone());
                    }
                }
            }
        }
    }

    if !config_patch.is_empty() {
        let _ = update_conversation(
            pool,
            conversation_id,
            None,
            None,
            Some(Value::Object(config_patch)),
        )
        .await;
    } else {
        let _ = sqlx::query("UPDATE conversations SET updated_at = $1 WHERE id = $2")
            .bind(now)
            .bind(conversation_id)
            .execute(pool)
            .await;
    }

    Ok(map_message_row(&row))
}

pub async fn acknowledge_message(
    pool: &PgPool,
    message_id: i64,
    conversation_id: i64,
) -> Result<bool, sqlx::Error> {
    let now = now_naive();
    let res = sqlx::query(
        r#"
        UPDATE messages
        SET acknowledged = TRUE, acknowledged_at = $1, updated_at = $1
        WHERE id = $2 AND conversation_id = $3 AND role = 'user' AND NOT acknowledged
        "#,
    )
    .bind(now)
    .bind(message_id)
    .bind(conversation_id)
    .execute(pool)
    .await?;

    Ok(res.rows_affected() > 0)
}

pub async fn get_pending_messages_for_bot(
    pool: &PgPool,
    bot_token_id: i64,
) -> Result<Vec<MessageRecord>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT m.id, m.conversation_id, m.role, m.content_type, m.body, m.metadata,
               m.model, m.context_size, m.acknowledged, m.acknowledged_at, m.is_suggestion, m.inserted_at
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.bot_token_id = $1 AND m.role = 'user' AND NOT m.acknowledged
        ORDER BY m.inserted_at ASC
        "#,
    )
    .bind(bot_token_id)
    .fetch_all(pool)
    .await?;

    Ok(rows.iter().map(map_message_row).collect())
}
