# Railway ke liye Dockerfile — Playwright + Chromium included
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Dependencies copy + install
COPY package*.json ./
RUN npm install

# Source code copy
COPY . .

# Railway PORT env var use karo
ENV PORT=3000
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 3000

CMD ["node", "src/index.js"]
