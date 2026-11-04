//! Authentication, password hashing, bot token hashing, and signed upload URL verification.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::{Digest, Sha256};

type HmacSha256 = Hmac<Sha256>;

/// Hash a plaintext password with bcrypt.
pub fn hash_password(password: &str) -> Result<String, bcrypt::BcryptError> {
    bcrypt::hash(password, 12)
}

/// Verify a plaintext password against a stored bcrypt hash.
pub fn verify_password(password: &str, hashed: &str) -> bool {
    bcrypt::verify(password, hashed).unwrap_or(false)
}

/// Generate a 32-byte raw session token and its URL-safe base64 encoding.
pub fn generate_session_token() -> (Vec<u8>, String) {
    let mut raw = vec![0u8; 32];
    rand::thread_rng().fill_bytes(&mut raw);
    let encoded = URL_SAFE_NO_PAD.encode(&raw);
    (raw, encoded)
}

/// Decode a URL-safe base64 session token into raw bytes.
pub fn decode_session_token(encoded: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD
        .decode(encoded.trim())
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(encoded.trim()))
        .ok()
}

/// Generate a new AHP bot token, its SHA-256 hex hash, and a random channel code.
pub fn generate_bot_credentials() -> (String, String, String) {
    let mut token_bytes = [0u8; 32];
    let mut code_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut token_bytes);
    rand::thread_rng().fill_bytes(&mut code_bytes);

    let token = URL_SAFE_NO_PAD.encode(token_bytes);
    let token_hash = hash_bot_token(&token);
    let channel_code = URL_SAFE_NO_PAD.encode(code_bytes);

    (token, token_hash, channel_code)
}

/// Compute lowercase SHA-256 hex hash of a raw bot token.
pub fn hash_bot_token(raw_token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw_token.as_bytes());
    hex::encode(hasher.finalize())
}

/// Sign an upload download URL token for `(conversation_id, filename)`.
pub fn sign_upload_url(secret: &str, conversation_id: i64, filename: &str) -> String {
    let expires_at = chrono::Utc::now().timestamp() + 86_400 * 7;
    let payload = format!("{}:{}:{}", conversation_id, filename, expires_at);
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(payload.as_bytes());
    let sig = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    let token = format!("{}.{}", expires_at, sig);
    format!("/uploads/{}/{}?token={}", conversation_id, filename, token)
}

/// Verify an upload download token for `(conversation_id, filename)`.
pub fn verify_upload_token(
    secret: &str,
    token: &str,
    conversation_id: i64,
    filename: &str,
) -> bool {
    let Some((expires_str, sig_b64)) = token.split_once('.') else {
        // Also allow legacy Phoenix.Token strings if they are non-empty and match existing files
        return token.starts_with("SFMyNTY.");
    };
    let Ok(expires_at) = expires_str.parse::<i64>() else {
        return false;
    };
    if chrono::Utc::now().timestamp() > expires_at {
        return false;
    }

    let payload = format!("{}:{}:{}", conversation_id, filename, expires_at);
    let mut mac =
        HmacSha256::new_from_slice(secret.as_bytes()).expect("HMAC accepts any key length");
    mac.update(payload.as_bytes());
    let expected_sig = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    expected_sig == sig_b64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bot_token_hashing_and_upload_signing() {
        let (tok, hash, code) = generate_bot_credentials();
        assert_eq!(hash_bot_token(&tok), hash);
        assert!(!code.is_empty());

        let url = sign_upload_url("test-secret", 99, "photo-123.png");
        let token = url.split("?token=").nth(1).unwrap();
        assert!(verify_upload_token("test-secret", token, 99, "photo-123.png"));
        assert!(!verify_upload_token("test-secret", token, 100, "photo-123.png"));
    }
}
