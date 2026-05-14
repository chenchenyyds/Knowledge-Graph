## 容器与虚拟机

容器和虚拟机都是"隔离环境"，但实现原理完全不同。

### 对比

| 维度 | 容器 | 虚拟机 |
|------|------|--------|
| 隔离级别 | 进程级隔离（OS 共享） | 硬件级虚拟化 |
| 内核 | 共享宿主机内核 | 每个 VM 独立内核 |
| 启动时间 | 毫秒级 | 分钟级 |
| 镜像大小 | MB 级 | GB 级 |
| 资源开销 | 低（仅进程开销） | 高（完整 OS 开销） |
| 密度 | 一台宿主机可跑数百个 | 一台宿主机跑数个到数十个 |

```
虚拟机：
┌─────────────────────┐
│   Hypervisor         │
├──────┬───────┬──────┤
│ VM1  │ VM2   │ VM3  │
│ OS   │ OS    │ OS   │
│ App  │ App   │ App  │
└──────┴───────┴──────┘

容器：
┌─────────────────────┐
│   Host OS / Kernel   │
├──────┬───────┬──────┤
│ 容器1 │ 容器2 │ 容器3 │
│ App   │ App   │ App  │
└──────┴───────┴──────┘
```

## 三大核心概念

### 镜像（Image）

镜像是一个**只读模板**，包含运行应用所需的全部文件（代码、运行时、库、环境变量）。

```dockerfile
# 一个简单的镜像定义
FROM openjdk:17-slim
WORKDIR /app
COPY target/myapp.jar .
EXPOSE 8080
CMD ["java", "-jar", "myapp.jar"]
```

- 镜像由多层（Layer）组成，每层只读
- 层可以被复用和缓存
- 镜像构建后不可变

### 容器（Container）

容器是镜像的**运行实例**，在镜像层之上添加一个可写层。

```
┌─────────────────┐
│  容器（可写层）    │ ← 容器删除后数据丢失
├─────────────────┤
│  镜像层 3         │
├─────────────────┤
│  镜像层 2         │
├─────────────────┤
│  镜像层 1（基础层） │
└─────────────────┘
```

### 仓库（Registry）

- **Docker Hub**：Docker 官方公共仓库
- **私有仓库**：Harbor、AWS ECR、阿里云 ACR
- 镜像命名：`[仓库地址/][命名空间/]镜像名:标签`

## Docker 架构

Docker 使用 C/S（Client/Server）架构：

```
┌──────────┐     REST API      ┌──────────────┐
│  Client   │ ──────────────→   │   Daemon      │
│ (docker   │   (socket/HTTP)  │   (dockerd)   │
│  CLI)     │                  │               │
└──────────┘                   └──────┬────────┘
                                      │
                     ┌────────────────┼────────────────┐
                     ▼                ▼                 ▼
               ┌──────────┐   ┌──────────┐   ┌──────────────┐
               │ containerd │   │ 网络     │   │  存储卷       │
               │ (运行时)    │   │ (CNI)   │   │ (Volume)     │
               └──────────┘   └──────────┘   └──────────────┘
```

## 常用命令

### 生命周期

```bash
# 运行容器
docker run -d --name myapp -p 8080:8080 nginx:alpine

# 查看运行中的容器
docker ps

# 查看所有容器（含已停止）
docker ps -a

# 停止容器
docker stop myapp

# 启动已停止容器
docker start myapp

# 删除容器
docker rm myapp

# 强制删除运行中的容器
docker rm -f myapp
```

### 镜像管理

```bash
# 拉取镜像
docker pull nginx:alpine

# 列出镜像
docker images

# 删除镜像
docker rmi nginx:alpine

# 构建镜像
docker build -t myapp:latest .

# 导出/导入镜像
docker save myapp:latest > myapp.tar
docker load < myapp.tar
```

### 交互与调试

```bash
# 进入容器 Shell
docker exec -it myapp /bin/sh

# 查看日志
docker logs -f myapp

# 查看资源占用
docker stats

# 查看容器详细信息
docker inspect myapp

# 查看容器进程
docker top myapp
```

## 容器生命周期

```
                   docker create
                       │
                       ▼
                  ┌─────────┐
                  │ Created  │
                  └────┬────┘
                       │ docker start
                       ▼
                  ┌─────────┐
        ┌────────→│ Running  │──┐
        │         └────┬────┘  │
        │              │       │
   docker pause     docker     │ docker stop
        │           restart    │
        │              │       │
        │         ┌────┴────┐  │
        └─────────┤ Paused  │  │
                  └─────────┘  │
                               │
                          ┌────▼────┐
                          │ Stopped │
                          └────┬────┘
                               │ docker rm
                               ▼
                          ┌─────────┐
                          │ Removed  │
                          └─────────┘
```

## 容器网络模式

| 模式 | 说明 | 适用场景 |
|------|------|---------|
| bridge（默认） | 独立网络命名空间，NAT 转发 | 单机多容器通信 |
| host | 共享宿主机网络栈 | 性能敏感场景 |
| none | 无网络 | 安全敏感场景 |
| overlay | 跨主机覆盖网络 | Swarm/K8s 集群 |

```bash
# 创建自定义网络
docker network create --driver bridge mynet

# 在指定网络中运行容器
docker run -d --network mynet --name app1 myapp
docker run -d --network mynet --name app2 myapp

# 容器间通过容器名通信
# app1 中可以直接 ping app2
```
