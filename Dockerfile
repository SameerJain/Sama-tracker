# runs on any host with Docker, and on Railway if it detects this file.
# state lives in /app/data, so mount a volume there (or set STATE_DIR to wherever one is mounted)
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production
CMD ["npm", "start"]
