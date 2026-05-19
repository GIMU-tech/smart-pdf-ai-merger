# ==========================================
# STAGE 1: Build static React frontend assets
# ==========================================
FROM node:20-slim AS builder
WORKDIR /app

# Install dependencies (including devDependencies like Vite and TypeScript)
COPY package*.json ./
RUN npm install

# Copy source code and build the production bundle
COPY . .
RUN npm run build

# ==========================================
# STAGE 2: Secure, production runtime container
# ==========================================
FROM node:20-slim

# Install system dependencies (Ghostscript & MuPDF tools)
RUN apt-get update && apt-get install -y \
    ghostscript \
    mupdf-tools \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Install only production runtime npm packages
COPY package*.json ./
RUN npm install --production

# Copy built React frontend bundle from the builder stage
COPY --from=builder /app/dist ./dist

# Copy backend server files
COPY server.cjs ./
COPY workers/ ./workers/
COPY *.traineddata ./

# Expose default API port
EXPOSE 8080

# Start the unified web application (React UI + Express API Backend)
CMD ["node", "server.cjs"]
