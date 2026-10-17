# Nihongo Graph web app (Express API + static vanilla-JS frontend).
FROM node:22-alpine
# poppler-utils gives pdftotext/pdfinfo for optional PDF resource ingestion (the app works without it).
RUN apk add --no-cache poppler-utils
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY scripts ./scripts
COPY public ./public
COPY resources ./resources
COPY docs ./docs
ENV NODE_ENV=production PORT=3002
EXPOSE 3002
USER node
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3002)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
