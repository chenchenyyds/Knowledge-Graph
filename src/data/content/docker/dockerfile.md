## Dockerfile 指令详解

### 核心指令

| 指令 | 用途 | 示例 |
|------|------|------|
| `FROM` | 指定基础镜像 | `FROM openjdk:17-slim` |
| `WORKDIR` | 设置工作目录 | `WORKDIR /app` |
| `COPY` | 复制文件到镜像 | `COPY target/app.jar .` |
| `ADD` | 复制并支持自动解压 | `ADD archive.tar.gz /tmp/` |
| `RUN` | 构建时执行命令 | `RUN apt-get update && apt-get install -y curl` |
| `ENV` | 设置环境变量 | `ENV JAVA_HOME=/usr/lib/jvm/java-17` |
| `EXPOSE` | 声明端口 | `EXPOSE 8080` |
| `CMD` | 默认启动命令 | `CMD ["java", "-jar", "app.jar"]` |
| `ENTRYPOINT` | 入口点 | `ENTRYPOINT ["java", "-jar"]` |
| `ARG` | 构建参数 | `ARG APP_VERSION=1.0.0` |
| `LABEL` | 元数据标签 | `LABEL maintainer="team@example.com"` |

### CMD vs ENTRYPOINT

```dockerfile
# CMD：参数可被覆盖
CMD ["java", "-jar", "app.jar"]
# docker run myapp → java -jar app.jar
# docker run myapp ls → ls（CMD 被覆盖）

# ENTRYPOINT：主命令固定
ENTRYPOINT ["java", "-jar"]
CMD ["app.jar"]
# docker run myapp → java -jar app.jar
# docker run myapp other.jar → java -jar other.jar（CMD 被覆盖，ENTRYPOINT 保留）
```

**最佳实践：** ENTRYPOINT 定义不可变的主命令，CMD 提供默认参数。

## 多阶段构建

多阶段构建用一个 Dockerfile 定义多个阶段，最终只保留需要的产物，大幅减小镜像体积。

### 应用场景：Java Spring Boot

```dockerfile
# ===== 阶段 1：构建 =====
FROM maven:3.9-eclipse-temurin-17 AS builder
WORKDIR /build
COPY pom.xml .
RUN mvn dependency:go-offline  # 缓存依赖
COPY src ./src
RUN mvn package -DskipTests

# ===== 阶段 2：运行 =====
FROM eclipse-temurin:17-jre-alpine
WORKDIR /app
# 只复制构建产物，不包含 Maven 和源码
COPY --from=builder /build/target/app.jar .
EXPOSE 8080
CMD ["java", "-jar", "app.jar"]
```

### 应用场景：前端 + Nginx

```dockerfile
# ===== 阶段 1：前端构建 =====
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ===== 阶段 2：Nginx 分发 =====
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### 效果对比

| 方案 | 镜像大小 | 构建时间 | 安全风险 |
|------|---------|---------|---------|
| 单阶段（含 Maven） | ~800MB | 快 | 包含构建工具 |
| 多阶段 | ~180MB | 中等（依赖缓存） | 仅含运行时 |
| 多阶段 + distroless | ~120MB | 中等 | 最小攻击面 |

## 镜像层缓存机制

Docker 构建时每一条指令生成一个**层**（Layer），层会被缓存复用。

### 缓存生效规则

```
Dockerfile 指令                   缓存策略
─────────────────────────────────────────────────
FROM base                         ✅ 镜像存在即命中
RUN apt-get update                ✅ 命令字符串相同即命中
COPY package.json .               ❌ 文件内容变化则失效
RUN npm install                   ❌ 上层缓存失效则本级失效
COPY . .                          ❌ 始终检查文件变更
```

### 优化技巧：利用缓存分层

```dockerfile
# ❌ 低效：源码变动让 npm install 每次都重跑
COPY . .
RUN npm install
RUN npm run build

# ✅ 高效：先复制依赖描述文件，利用缓存
COPY package.json package-lock.json ./
RUN npm ci              # 依赖不变时命中缓存
COPY . .
RUN npm run build
```

## 镜像大小优化

### 优化策略对比

| 策略 | 方法 | 效果 |
|------|------|------|
| 选择最小基础镜像 | alpine/slim/distroless | 从 ~1GB 降到 ~150MB |
| 多阶段构建 | 分离构建和运行环境 | 减少 70-80% |
| 清理临时文件 | 同层 RUN 中清理 | 减少 10-30% |
| 减少层数 | 合并 RUN 指令 | 减少存储碎片 |
| .dockerignore | 排除无用文件 | 减少上下文大小 |

### 基础镜像对比

| 镜像 | 大小 | 内容 | 适用场景 |
|------|------|------|---------|
| ubuntu:22.04 | ~77MB | 完整 Ubuntu | 需要系统包 |
| alpine:3.19 | ~7MB | musl + busybox | 最小体积 |
| eclipse-temurin:17-jre | ~200MB | JRE | Java 运行 |
| eclipse-temurin:17-jre-alpine | ~170MB | JRE + Alpine | Java + 小体积 |
| gcr.io/distroless/java17 | ~120MB | 仅运行时 | 安全敏感 |

```dockerfile
# 极致优化示例：distroless
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm ci && npm run build

FROM gcr.io/distroless/nodejs20-debian12
COPY --from=build /app/dist /app
CMD ["/app/server.js"]
# 不含 shell、包管理器，攻击面最小
```

## .dockerignore

类似 `.gitignore`，排除无需发送给 Docker daemon 的文件：

```dockerignore
.git/
node_modules/
target/
*.log
.env
.idea/
.vscode/
```

**为什么重要：** `docker build` 将**整个上下文**（当前目录）发送给 daemon。没有 `.dockerignore` 时 `node_modules` 等大目录会极大拖慢构建。

## 构建上下文

```bash
# 上下文是当前目录
docker build -t myapp .

# 指定 Dockerfile 位置
docker build -t myapp -f docker/Dockerfile .

# 指定上下文为其他目录
docker build -t myapp ./backend
```

**关键理解：** `COPY . .` 复制的是**构建上下文**（`docker build` 的最后一个参数），不是 Dockerfile 所在目录。
