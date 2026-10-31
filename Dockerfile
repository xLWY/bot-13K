FROM node:20-alpine

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
COPY package*.json ./

# Install only production dependencies
# `npm install` (instead of `npm ci`) tolerates a lockfile that is slightly out of sync
RUN npm install --omit=dev --no-audit --no-fund

# Bundle app source
RUN echo "cache bust v3"
COPY . .

# Expose the health check port from src/app.js
EXPOSE 3000

# Start the bot
CMD [ "npm", "start" ]
