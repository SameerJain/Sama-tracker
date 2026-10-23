# runs on any host with Docker, and on Railway if it detects this file.
# state lives in /app/data, so mount a volume there (or set STATE_DIR to wherever one is mounted)
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production
# docker waits this long for /health to answer 200 before calling the container unhealthy
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then((r)=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
