# ---- Stage 1: Frontend Asset Builder ----
FROM node:20-bookworm-slim AS frontend-builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --registry=https://registry.npmjs.org/

COPY assets ./assets
COPY priv ./priv
RUN npx vite build --config assets/vite.config.js

# ---- Stage 2: Rust Workspace Builder (aims-server + aims-proxy) ----
FROM rust:slim-bookworm AS rust-builder

RUN apt-get update -y && apt-get install -y pkg-config libssl-dev ca-certificates \
    && apt-get clean && rm -f /var/lib/apt/lists/*_*

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY crates ./crates

RUN cargo build --release --workspace

# ---- Stage 3: Minimal Production Runtime ----
FROM debian:bookworm-slim

RUN apt-get update -y && \
    apt-get install -y openssl ca-certificates && \
    apt-get clean && rm -f /var/lib/apt/lists/*_*

WORKDIR /app
RUN mkdir -p /app/priv/static /app/priv/uploads && chown -R nobody:nogroup /app

COPY --from=rust-builder /app/target/release/aims-server /usr/local/bin/aims-server
COPY --from=rust-builder /app/target/release/aims-proxy /usr/local/bin/aims-proxy
COPY --from=frontend-builder --chown=nobody:nogroup /app/priv/static /app/priv/static

ENV PORT="4000"
ENV STATIC_DIR="/app/priv/static"
ENV UPLOAD_DIR="/app/priv/uploads"

USER nobody
EXPOSE 4000

CMD ["aims-server"]
