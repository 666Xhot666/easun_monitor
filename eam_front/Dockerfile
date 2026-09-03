# syntax=docker/dockerfile:1

# =============================================================================
# base: shared layer with package manifests only.
# =============================================================================
FROM node:20-alpine AS base
WORKDIR /usr/src/app
COPY package*.json ./

# =============================================================================
# development: Vite dev server with HMR. compose bind-mounts the source over
# this image so edits on the host are picked up instantly. Default target.
# =============================================================================
FROM base AS development
ENV NODE_ENV=development
RUN npm install
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# =============================================================================
# build: production Vite build -> static assets in dist/.
# =============================================================================
FROM base AS build
RUN npm ci
COPY . .
RUN npm run build

# =============================================================================
# production: static assets served by nginx. No Node runtime in the final
# image.
# =============================================================================
FROM nginx:1.27-alpine AS production
COPY --from=build /usr/src/app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
