# Dockerfile for E2E Testing
# Run with: docker build -t planar-nexus-e2e . && docker run --rm planar-nexus-e2e

FROM node:20-bookworm

# Install system dependencies for Playwright and Tauri
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    gnupg \
    bash \
    libssl3 \
    libdbus-1-3 \
    libgtk-3-0 \
    libnotify-dev \
    libgbm1 \
    libasound2 \
    libxshmfence1 \
    # For Tauri
    libwebkit2gtk-4.1-0 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright browsers
RUN npx playwright install chromium --with-deps

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY next.config.* ./
COPY tsconfig.* ./

# Install npm dependencies
RUN npm ci --legacy-peer-deps

# Copy source code (exclude built artifacts to avoid binary issues)
COPY . .

# Ensure .deb exists for tests
RUN ls -la src-tauri/target/release/bundle/deb/*.deb || echo "No .deb found"

# Run E2E tests with APP_PATH set to /app (Docker path)
CMD ["sh", "-c", "APP_PATH=/app npx playwright test e2e/tauri-deck-builder.spec.ts --project=chromium"]
