# 1. Base Node.js image
FROM node:20-slim

# 2. Install Ghostscript, MuPDF (mupdf-tools), and clean apt cache to minimize image size
RUN apt-get update && apt-get install -y \
    ghostscript \
    mupdf-tools \
    && rm -rf /var/lib/apt/lists/*

# 3. Set work directory and configure environment variables
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# 4. Copy configuration files and install npm production packages
COPY package*.json ./
RUN npm install --production

# 5. Copy the source codebase
COPY . .

# 6. Expose default API server port
EXPOSE 8080

# 7. Start the unified 24/7 web backend API server
CMD ["node", "server.cjs"]
