FROM oven/bun:1 AS deps

WORKDIR /app

COPY package.json bun.lock ./
COPY apps/betterzeriya/package.json apps/betterzeriya/package.json
COPY packages/client/package.json packages/client/package.json
COPY packages/server/package.json packages/server/package.json

RUN bun install --frozen-lockfile

FROM deps AS build

COPY . .

RUN bun run --cwd packages/client build
RUN bun run --cwd apps/betterzeriya build

FROM node:24-alpine AS runtime

ENV HOST=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

COPY --from=build /app/apps/betterzeriya/build ./build

EXPOSE 3000

CMD ["node", "build"]
