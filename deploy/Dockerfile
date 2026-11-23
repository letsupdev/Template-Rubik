# deploy/Dockerfile do Rubik (família Node + pnpm). Um estágio por serviço do Dokploy:
#   api    -> Docker Build Stage "api"   (NestJS, porta 3000)
#   front  -> Docker Build Stage "front" (SPA Vite servida pelo nginx na 3000)
# No Dokploy: Build Type Dockerfile, Dockerfile Path deploy/Dockerfile, Docker Context Path ".".
# Fica em deploy/ porque o Railway usaria sozinho um Dockerfile da raiz.

ARG NODE_VERSION=22-alpine
ARG NGINX_VERSION=1.27-alpine

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# Só os manifestos: enquanto eles não mudam, os installs abaixo saem do cache
# mesmo com o código alterado, que é o caso comum de um deploy.
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY server/package.json ./server/
COPY client/package.json ./client/

# ---------------------------------------------------------------- api
FROM manifests AS deps-api
RUN pnpm install --filter server... --frozen-lockfile

FROM manifests AS prod-deps-api
RUN pnpm install --filter server --prod --frozen-lockfile

FROM deps-api AS build-api
COPY server ./server
RUN pnpm --filter server build

FROM node:${NODE_VERSION} AS api
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=prod-deps-api --chown=app:app /app/node_modules ./node_modules
COPY --from=prod-deps-api --chown=app:app /app/server/node_modules ./server/node_modules
COPY --from=build-api --chown=app:app /app/server/dist ./server/dist
COPY --from=build-api --chown=app:app /app/server/package.json ./server/
USER app
EXPOSE 3000
# start-period de 120 s: as migrations rodam no boot
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# O mesmo boot do server/Dockerfile: migrations, seed de inicialização, sync de chamados, API.
CMD ["sh", "-c", "node server/dist/db/migrate.js && { node server/dist/db/seed.js || true; } && { node server/dist/modules/tickets/ticket-sync.js || true; } && node server/dist/main.js"]

# ---------------------------------------------------------------- front
FROM manifests AS build-front
RUN pnpm install --filter client... --frozen-lockfile
COPY client ./client
# Gravada no JavaScript durante o build: no Dokploy, em Build Time Arguments.
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || (echo "ERRO: defina VITE_API_URL em Build Time Arguments no Dokploy" && exit 1)
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter client build

FROM nginx:${NGINX_VERSION} AS front
COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build-front /app/client/dist /usr/share/nginx/html
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health > /dev/null || exit 1

# ---------------------------------------------------------------- trava
# Último de propósito: sem Docker Build Stage, o build para aqui com mensagem clara.
FROM base AS sem-estagio
RUN echo "ERRO: defina Docker Build Stage no Dokploy com o nome do serviço (api, front)" && exit 1
