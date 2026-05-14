## 容器安全

### 最小权限原则

```dockerfile
# ❌ 不安全：以 root 运行
FROM node:20-alpine
COPY . .
RUN npm install
CMD ["node", "server.js"]

# ✅ 安全：使用非 root 用户
FROM node:20-alpine
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app
COPY --chown=appuser:appgroup . .
USER appuser
CMD ["node", "server.js"]
```

### 安全最佳实践

| 实践 | 说明 |
|------|------|
| 使用最小基础镜像 | alpine / distroless 减少攻击面 |
| 非 root 运行 | 容器内创建专用用户 |
| 镜像签名验证 | Docker Content Trust 或 Cosign |
| 定期漏洞扫描 | Trivy / Snyk / Docker Scout |
| 只读根文件系统 | `read_only: true` 限制写权限 |
| 资源限制 | 防止 DoS 攻击 |
| 健康检查 | 检测应用是否正常响应 |

### Trivy 漏洞扫描

```bash
# 安装 Trivy
# 扫描镜像漏洞
trivy image myapp:latest

# 扫描严重漏洞
trivy image --severity CRITICAL,HIGH myapp:latest

# 扫描文件系统
trivy filesystem --severity CRITICAL .

# CI 中集成（失败时退出码非 0）
trivy image --exit-code 1 --severity CRITICAL myapp:latest
```

### Docker Bench Security

```bash
# 运行安全审计
docker run --net host --pid host --cap-add audit_control \
  -e DOCKER_CONTENT_TRUST=$DOCKER_CONTENT_TRUST \
  -v /var/lib:/var/lib:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /etc:/etc:ro \
  docker/docker-bench-security
```

## 日志收集

### 日志驱动

| 驱动 | 说明 | 适用场景 |
|------|------|---------|
| json-file（默认） | 写入 JSON 文件 | 开发环境 |
| syslog | 发送到 syslog | 传统运维 |
| journald | 发送到 systemd 日志 | systemd 系统 |
| fluentd | 发送到 Fluentd | 统一日志收集 |
| awslogs | 发送到 CloudWatch | AWS 环境 |
| gelf | Graylog 格式 | 集中式日志 |
| loki | Grafana Loki | Prometheus 生态 |

```yaml
# docker-compose.yml
services:
  app:
    logging:
      driver: "loki"
      options:
        loki-url: "http://loki:3100/loki/api/v1/push"
        max-size: "10m"
        max-file: "3"
```

### Loki + Promtail 方案

```yaml
services:
  app:
    # 使用 json-file 驱动，由 Promtail 收集
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"

  promtail:
    image: grafana/promtail:latest
    volumes:
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
      - ./promtail-config.yml:/etc/promtail/config.yml
    command: -config.file=/etc/promtail/config.yml

  loki:
    image: grafana/loki:latest
    ports:
      - "3100:3100"
    volumes:
      - loki_data:/loki

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3000:3000"
```

## 资源限制

### 限制容器资源

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M
        reservations:
          cpus: "0.5"
          memory: 256M
```

```bash
# 命令行限制
docker run -d --name app \
  --cpus="1.0" \
  --memory="512m" \
  --memory-swap="1g" \
  --memory-reservation="256m" \
  --pids-limit=100 \
  --restart=unless-stopped \
  myapp
```

### 监控容器资源

```bash
# 实时监控
docker stats

# 查看单个容器资源
docker stats app

# 查看容器进程
docker top app

# 事件监控
docker events --filter 'container=app' --filter 'event=oom'
```

### cAdvisor + Prometheus

```yaml
services:
  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    ports:
      - "8080:8080"
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    privileged: true

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    command:
      - --config.file=/etc/prometheus/prometheus.yml
```

## CI/CD 集成

### GitHub Actions

```yaml
name: Build and Push Docker Image

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to Docker Hub
        uses: docker/login-action@v3
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: |
            ${{ secrets.DOCKER_USERNAME }}/myapp:latest
            ${{ secrets.DOCKER_USERNAME }}/myapp:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

### 镜像仓库管理

| 仓库 | 描述 | 特点 |
|------|------|------|
| Docker Hub | Docker 官方仓库 | 公共免费，私有收费 |
| Harbor | 企业级仓库 | 漏洞扫描、RBAC、复制 |
| AWS ECR | AWS 托管 | IAM 集成，无需登录 |
| 阿里云 ACR | 阿里云托管 | 国内速度快 |

```bash
# Harbor 操作
docker login harbor.example.com
docker tag myapp:latest harbor.example.com/library/myapp:latest
docker push harbor.example.com/library/myapp:latest

# 镜像清理策略
# 保留最近 10 个版本
# 保留 30 天内拉取过的版本
# 超过 90 天自动清理
```
