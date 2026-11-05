# Stage 1: 构建编译
FROM node:20-alpine AS builder
WORKDIR /app

# 利用 Docker 层缓存加速依赖安装
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: 纯净轻量生产镜像
FROM nginx:alpine-slim
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]