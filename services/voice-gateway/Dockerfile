# Two stages: build a single bundled file, then run it on a tiny distroless Node 22 image
# (no shell, no package manager; small image = faster cold starts and stays within free storage).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY config ./config
RUN npm run build

FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
COPY --from=build /app/dist ./dist
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["--enable-source-maps", "dist/server.mjs"]
