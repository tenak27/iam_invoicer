# Serveur IAM INVOICER : API + application web.
# Image multi-architecture (amd64 : serveurs, NAS Intel/AMD ; arm64 : Raspberry Pi, NAS ARM).
# La compilation (JavaScript, identique partout) se fait sur l'architecture de la machine de
# construction ; seule l'installation des dépendances d'exécution tourne sur l'architecture cible.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:web && npm run build:server && npm run build:site

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/out/server ./out/server
COPY --from=build /app/out/web ./out/web
COPY --from=build /app/out/site ./out/site
USER node
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/health || exit 1
CMD ["node", "out/server/server.cjs"]
