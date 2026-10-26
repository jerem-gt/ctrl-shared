# ---- Stage 1 : récupérer timezone ----
FROM node:24.22.1-alpine AS tz
RUN apk add --no-cache tzdata

# ---- Stage final ----
FROM node:24.22.1-alpine

# Déclarer l'argument de build (reçu de GitHub Actions)
ARG APP_VERSION=dev

WORKDIR /app

# Timezone figée à Europe/Paris : seul ce fuseau est embarqué
ENV TZ=Europe/Paris

COPY --from=tz /usr/share/zoneinfo/Europe/Paris /usr/share/zoneinfo/Europe/Paris
RUN ln -snf "/usr/share/zoneinfo/$TZ" /etc/localtime \
 && echo "$TZ" > /etc/timezone

ENV APP_VERSION=$APP_VERSION

# App
COPY deploy/node_modules ./node_modules
COPY server/dist ./server/dist
COPY client/dist ./client/dist

RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- "http://localhost:${PORT}/api/health" || exit 1

# Icône affichée par Dozzle, passée en build-arg depuis client/public/favicon.svg (générée en CI).
# Déclaré en fin de stage pour ne pas invalider le cache des COPY.
ARG DOZZLE_ICON
LABEL dev.dozzle.icon=$DOZZLE_ICON

CMD ["node", "server/dist/index.js"]
