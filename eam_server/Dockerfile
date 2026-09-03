# syntax=docker/dockerfile:1

# =============================================================================
# base: shared layer with package manifests only, so npm install/ci is cached
# unless package.json/package-lock.json actually change.
# =============================================================================
FROM node:20-alpine AS base
WORKDIR /usr/src/app
COPY package*.json ./

# =============================================================================
# development: full dependency tree + source, run via Nest's watch mode.
# The compose file bind-mounts the source over this, so `npm run start:dev`
# picks up file changes live. This is the default target for local dev.
# =============================================================================
FROM base AS development
ENV NODE_ENV=development
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# =============================================================================
# build: compiles TypeScript -> dist/ using the full dependency tree.
# =============================================================================
FROM base AS build
ENV NODE_ENV=production
RUN npm ci
COPY . .
# Must run before `nest build`: the Prisma 7 client is generated TypeScript
# living in src/generated/prisma, and app code imports directly from it.
RUN npx prisma generate
RUN npm run build

# =============================================================================
# production: only production dependencies + compiled output. Small, no
# dev toolchain, runs as an unprivileged user.
# =============================================================================
FROM node:20-alpine AS production
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /usr/src/app/dist ./dist
RUN chown -R node:node /usr/src/app
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
