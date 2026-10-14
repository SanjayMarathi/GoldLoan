# syntax=docker/dockerfile:1
# One image: the API serves the built React app, so there is a single origin (no CORS) and a single port.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
