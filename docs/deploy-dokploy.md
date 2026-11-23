# Ficha de deploy: Rubik

**Status:** inventariado
**Atualizada em:** 2026-11-19, por Claude Code (Fase 0), a partir de `docs/varredura/repos/Rubik.md` no repo de migração
**Repositório(s):** letsupdev/Template-Rubik. O código é idêntico ao do `Dev-Soares/Rubik` (commit `70326a5`), que é o repositório que o Railway publica.
**Branches:**
- o Railway publica hoje `main` (do `Dev-Soares/Rubik`);
- trabalho em `migracao-dokploy` (deste repositório);
- o Dokploy publica `migracao-dokploy` no teste da VPS e no ensaio.

**Projeto no Railway:** rubik
**Projeto no Dokploy:** rubik; ambiente: production
**DNS (teste na VPS):** `rubik.upletsup.com` (front) e `api-rubik.upletsup.com` (API), registro curinga no Cloudflare
**Certificado:** Origin CA do Cloudflare (curinga `*.upletsup.com`)

## Build

Opção B (decidida em 19/11/2026, `docs/07-build-e-servicos.md`).

- **Builder real hoje no Railway:** `?`. Os `railway.json` de `server/` e `client/` pedem DOCKERFILE; os dados de setembro dizem Railpack, sem config ligada. Confirmar no log de build.
- **Config de deploy no repositório:** `server/railway.json`, `client/railway.json`
- **Build no Dokploy:** `deploy/Dockerfile`, família **Node + pnpm** (molde a partir dos `server/Dockerfile` e `client/Dockerfile` atuais); Node 22 (`.nvmrc`), pnpm 10.15.0, nginx 1.27-alpine
- **Dockerfiles antigos:** `server/Dockerfile` e `client/Dockerfile` (mais os `.dev`). Ficam até o cutover.
- **Pre-deploy de hoje:** nenhum. As migrations rodam no `CMD` (migrate → seed → ticket-sync → API).

## Serviços

| Serviço (Dokploy) | Serviço (Railway) | Tipo | Build | Comando de início | Domínio (teste) | Healthcheck | Limite (bytes) | Agendamento |
|---|---|---|---|---|---|---|---|---|
| api | server | API (NestJS) | estágio `api` | `node server/dist/db/migrate.js && seed && ticket-sync && node server/dist/main.js` | api-rubik.upletsup.com | `/health` (checa o banco) | 671088640 | `@Cron` interno `ticket-cleanup` às 04:00 (sem Schedule Job) |
| front | web | Front SPA (Vite) | estágio `front` (nginx na 3000) | nginx | rubik.upletsup.com | `/health` do nginx | 536870912 | — |

## Banco

| Nome no Dokploy | Imagem | Tamanho atual | Extensões | Usuário `consulta` | Acesso externo hoje |
|---|---|---|---|---|---|
| db | postgres:18 | ~1,1 GB (o maior dos 3 Postgres do projeto) | a confirmar | criar | não identificado |

O projeto `rubik` tem 3 Postgres no Railway. Qual deles a API usa? (pergunta aberta)

## Arquivos (S3)

| Bucket novo | Bucket de origem | Tamanho | Links assinados? |
|---|---|---|---|
| rubik | MinIO do Railway (`bitnami/minio:latest`, 7,8 MB) | 7,8 MB | sim (`S3_SIGNED_URL_TTL`) |

## Variáveis de ambiente (só nomes)

| Serviço | Variável | Origem do valor | Build ou execução | Dispara algo externo? | No teste da VPS |
|---|---|---|---|---|---|
| api | `NODE_ENV` | fixo `production` | execução | não | `production` |
| api | `DATABASE_URL` | Internal Connection URL do banco | execução | não | banco vazio |
| api | `BETTER_AUTH_URL` | `https://api-<cliente>.<dominio>` | execução | não | `https://api-rubik.upletsup.com` |
| api | `BETTER_AUTH_SECRET`, `INTEGRATION_API_KEY` | segredo, 32+ caracteres, não pode ser o placeholder | execução | não | aleatório |
| api | `CORS_ORIGIN` | origem exata do front | execução | não | `https://rubik.upletsup.com` |
| api | `TICKET_WEBHOOK_URL`, `TICKET_WEBHOOK_API_KEY`, `TICKET_WEBHOOK_PROJECT_ID`, `TICKET_WEBHOOK_TIMEOUT_MS` | integração de atendimento | execução | **sim** (envia chamados; o `ticket-sync` do boot fecha chamados e notifica) | **vazio** (desliga envio e sync) |
| api | `TICKET_RETENTION_DAYS` | fixo | execução | não (apaga chamados e fotos do bucket) | padrão |
| api | `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_SIGNED_URL_TTL` | storage | execução | não | RustFS da VPS, `S3_FORCE_PATH_STYLE=true` |
| api | `LOG_LEVEL` | fixo | execução | não | `info` |
| api | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | **novas (Fase 1)** | execução | não | conta de teste |
| front | `VITE_API_URL` | `https://api-<cliente>.<dominio>` | **build** (Build Time Arguments) | não | `https://api-rubik.upletsup.com` |

## Dependências e integrações

- **Comunicação entre serviços:** o front chama a API pela URL pública (`VITE_API_URL`). Não há chamada interna.
- **Integrações externas que chamam este projeto:** o sistema de atendimento chama `PATCH /tickets/:id/status` (`x-api-key` = `INTEGRATION_API_KEY`).
- **Domínios `*.up.railway.app` em uso:** a confirmar no painel.
- **Exceções de firewall necessárias:** nenhuma.
- **Segredos versionados encontrados:** nenhum.

## Mudanças de código previstas (Fase 1, branch `migracao-dokploy`)

- `deploy/Dockerfile` (estágios `api`, `front`, `sem-estagio`), `deploy/Dockerfile.dockerignore`, `deploy/nginx-spa.conf`. O molde já buildou numa cópia: estágio `api` em 13 min do zero, imagem de 462 MB.
- `server/src/db/seed.ts`: ler `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`; sem elas, em produção, não criar admin (hoje a credencial é fixa no código, linhas 31 e 32).

## Verificação

- **Verificado:** build do estágio `api` numa cópia limpa (19/11/2026).
- **Não verificado:** estágio `front`, boot com banco, `/health`, cookies `SameSite=None` entre `rubik.` e `api-rubik.` no Safari, rate limit atrás do proxy (sem `trust proxy`).

## Riscos e pendências

- Credencial fixa no seed (pendência 28): corrigida na Fase 1.
- O `ticket-cleanup` apaga objetos do bucket configurado: nunca apontar para o MinIO do Railway.
- O healthcheck checa o banco: com o banco fora do ar, a API reinicia em loop.
- `cookiePrefix: 'app'` genérico: sem colisão com cookie host-only, mas a regra pede nome por projeto.
