# Stage 1: Build frontend
FROM node:20-alpine AS builder

WORKDIR /app

ARG REACT_APP_BACKEND_URL=""
ENV REACT_APP_BACKEND_URL=$REACT_APP_BACKEND_URL

COPY frontend/package.json frontend/yarn.loc[k] ./
RUN yarn install

COPY frontend/ .
RUN yarn build

# Stage 2: Nginx with headers-more module
FROM debian:bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends nginx-extras && \
    rm -rf /var/lib/apt/lists/*

# Remove default config
RUN rm -f /etc/nginx/sites-enabled/default

COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=builder /app/build /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
