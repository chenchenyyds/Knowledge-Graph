## Docker Compose 概述

Docker Compose 用 YAML 文件定义和运行多容器应用，适合**开发环境**和**单机编排**。

### Compose 文件结构

```yaml
version: "3.8"

services:
  app:
    build: .
    ports:
      - "8080:8080"
    depends_on:
      - db
      - redis

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: myapp
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

## 服务定义

### 完整示例：Spring Boot + MySQL + Redis

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "8080:8080"
    environment:
      SPRING_DATASOURCE_URL: jdbc:mysql://db:3306/myapp
      SPRING_REDIS_HOST: redis
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped

  db:
    image: mysql:8.0
    environment:
      MYSQL_DATABASE: myapp
      MYSQL_ROOT_PASSWORD: rootpass
    volumes:
      - mysql_data:/var/lib/mysql
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5
    ports:
      - "3306:3306"

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
```

### depends_on 详解

| 条件 | 说明 |
|------|------|
| `service_started` | 默认，容器启动即可 |
| `service_healthy` | 健康检查通过才启动 |
| `service_completed_successfully` | 预期任务成功结束 |

## 网络模式

### 默认网络

Compose 自动为项目创建 bridge 网络，所有服务通过服务名互相访问。

```
┌─────────────────────────────────┐
│    docker-compose 项目网络        │
│                                 │
│  ┌──────┐   ┌──────┐   ┌──────┐ │
│  │ app  │──→│  db  │──→│ redis│ │
│  │:8080 │   │:3306 │   │:6379 │ │
│  └──────┘   └──────┘   └──────┘ │
│                                 │
│  外部访问 app:8080 ← 端口映射     │
└─────────────────────────────────┘
```

### 自定义网络

```yaml
services:
  frontend:
    networks:
      - frontend
      - backend

  api:
    networks:
      - backend
      - db_net

  db:
    networks:
      - db_net

networks:
  frontend:
    driver: bridge
  backend:
    driver: bridge
  db_net:
    driver: bridge
```

### 网络模式对比

| 驱动 | 特性 | 适用场景 |
|------|------|---------|
| bridge | 默认，NAT 转发 | 单机多容器 |
| host | 共享宿主机网络 | 性能优先 |
| overlay | 跨主机通信 | Swarm 集群 |
| macvlan | 分配 MAC 地址 | 遗留应用 |

## 数据卷

### 三种存储方式

| 方式 | 宿主机位置 | 特点 |
|------|-----------|------|
| Volume（卷） | `/var/lib/docker/volumes/` | Docker 管理，持久化 |
| Bind Mount（绑定挂载） | 用户指定路径 | 开发热重载 |
| tmpfs | 内存 | 临时，速度最快 |

```yaml
services:
  app:
    volumes:
      # Volume（持久化）
      - app_data:/app/data

      # Bind Mount（开发用）
      - ./src:/app/src

      # tmpfs（临时）
      - type: tmpfs
        target: /app/cache

volumes:
  app_data:
```

### 常用场景：开发热重载

```yaml
services:
  app:
    build: .
    volumes:
      # 源码挂载进去，修改即时生效（需框架支持热重载）
      - ./src:/app/src
      # 排除 node_modules（避免覆盖容器内的）
      - /app/node_modules
```

## 环境与配置管理

### 多环境 Compose

```yaml
# docker-compose.base.yml（公共配置）
services:
  app:
    build: .
    ports:
      - "8080:8080"
```

```yaml
# docker-compose.dev.yml（开发环境）
services:
  app:
    volumes:
      - ./src:/app/src
    environment:
      SPRING_PROFILES_ACTIVE: dev
```

```yaml
# docker-compose.prod.yml（生产环境）
services:
  app:
    restart: always
    environment:
      SPRING_PROFILES_ACTIVE: prod
```

```bash
# 使用多个文件叠加
docker compose -f docker-compose.base.yml -f docker-compose.dev.yml up
```

### .env 文件

```bash
# .env
DB_HOST=db
DB_PORT=3306
DB_USER=myapp
DB_PASS=${DB_PASSWORD:-defaultpass}
```

```yaml
# 在 Compose 文件中引用
services:
  db:
    environment:
      MYSQL_USER: ${DB_USER}
      MYSQL_PASSWORD: ${DB_PASS}
```

## 常用 Compose 命令

```bash
# 启动所有服务
docker compose up

# 后台启动
docker compose up -d

# 构建并启动
docker compose up --build

# 停止并移除
docker compose down

# 停止并移除（含数据卷）
docker compose down -v

# 查看日志
docker compose logs -f app

# 重启服务
docker compose restart app

# 扩缩容
docker compose up -d --scale app=3

# 进入某个容器
docker compose exec app /bin/sh

# 查看运行状态
docker compose ps
```
