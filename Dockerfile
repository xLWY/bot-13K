FROM node:20-alpine

WORKDIR /usr/src/app

# Install dependencies from the lockfile for reproducible builds.
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY . .

# Run as an unprivileged user.
RUN addgroup -S bot && adduser -S bot -G bot && chown -R bot:bot /usr/src/app
USER bot

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
