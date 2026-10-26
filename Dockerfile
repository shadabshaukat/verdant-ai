FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node apps ./apps
COPY --chown=node:node db/control ./db/control
COPY --chown=node:node scripts ./scripts
USER node
EXPOSE 8090
CMD ["node", "apps/server/server.mjs"]
