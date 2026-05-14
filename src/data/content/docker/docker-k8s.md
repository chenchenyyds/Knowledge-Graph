## Kubernetes 架构

Kubernetes（K8s）是容器编排平台，用于自动部署、扩缩和管理容器化应用。

### 集群架构

```
┌─────────────────────────────────────────────┐
│              Control Plane                   │
│  ┌────────┐  ┌────────┐  ┌───────────────┐  │
│  │etcd    │  │APIServer│  │Controller     │  │
│  │(键值存储)│  │(入口)   │  │Manager(控制器)│  │
│  └────────┘  └────────┘  └───────────────┘  │
│              ┌────────────────────────┐      │
│              │Scheduler               │      │
│              │(调度器)                 │      │
│              └────────────────────────┘      │
└──────────────────────┬──────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │         Node 1             │
        │  ┌──────────────────────┐  │
        │  │  Pod                 │  │
        │  │  ┌────┐ ┌────┐      │  │
        │  │  │ctr1│ │ctr2│      │  │
        │  │  └────┘ └────┘      │  │
        │  └──────────────────────┘  │
        │  ┌──────────────────────┐  │
        │  │  kubelet  │ kube-proxy│  │
        │  └──────────────────────┘  │
        └────────────────────────────┘
```

### 核心组件

| 组件 | 部署位置 | 作用 |
|------|---------|------|
| API Server | Control Plane | 所有操作的入口，REST API |
| etcd | Control Plane | 集群状态存储（键值对） |
| Scheduler | Control Plane | 将 Pod 调度到合适的 Node |
| Controller Manager | Control Plane | 维护集群期望状态 |
| kubelet | Node | 管理节点上的 Pod |
| kube-proxy | Node | 网络代理与负载均衡 |
| Container Runtime | Node | 容器运行时（containerd） |

## 核心资源对象

### Pod

Pod 是 K8s 中最小的部署单元，一个 Pod 包含一个或多个容器。

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: myapp-pod
  labels:
    app: myapp
    env: prod
spec:
  containers:
    - name: myapp
      image: myapp:latest
      ports:
        - containerPort: 8080
      resources:
        requests:
          memory: "256Mi"
          cpu: "500m"
        limits:
          memory: "512Mi"
          cpu: "1"
      livenessProbe:
        httpGet:
          path: /actuator/health
          port: 8080
        initialDelaySeconds: 30
        periodSeconds: 10
      readinessProbe:
        httpGet:
          path: /actuator/health/readiness
          port: 8080
        initialDelaySeconds: 20
        periodSeconds: 5
```

### Deployment

Deployment 管理 Pod 的声明式更新和扩缩容。

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: myapp-deployment
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
        - name: myapp
          image: myapp:latest
          ports:
            - containerPort: 8080

---
# 滚动更新策略
spec:
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1
      maxSurge: 1
```

### Service

Service 提供稳定的网络入口，将流量分发到一组 Pod。

```yaml
apiVersion: v1
kind: Service
metadata:
  name: myapp-service
spec:
  selector:
    app: myapp
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080
  type: ClusterIP
```

### Service 类型

| 类型 | 访问方式 | 适用场景 |
|------|---------|---------|
| ClusterIP | 集群内部 IP | 内部服务通信 |
| NodePort | 节点 IP + 端口 | 外部调试访问 |
| LoadBalancer | 云厂商 LB | 对外暴露服务 |
| ExternalName | DNS CNAME | 访问外部服务 |

### 完整示例：Spring Boot 应用

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: spring-boot-app
spec:
  replicas: 2
  selector:
    matchLabels:
      app: spring-boot-app
  template:
    metadata:
      labels:
        app: spring-boot-app
    spec:
      containers:
        - name: app
          image: myregistry/spring-app:1.0.0
          ports:
            - containerPort: 8080
          env:
            - name: SPRING_PROFILES_ACTIVE
              value: "k8s"
            - name: DB_URL
              valueFrom:
                configMapKeyRef:
                  name: app-config
                  key: db_url
            - name: DB_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: app-secret
                  key: db_password
          resources:
            requests:
              memory: "512Mi"
              cpu: "500m"
            limits:
              memory: "1Gi"
              cpu: "1"
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 8080
            initialDelaySeconds: 30
---
apiVersion: v1
kind: Service
metadata:
  name: spring-boot-app
spec:
  selector:
    app: spring-boot-app
  ports:
    - port: 80
      targetPort: 8080
  type: ClusterIP
```

## ConfigMap & Secret

### ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
data:
  db_url: jdbc:mysql://mysql-service:3306/myapp
  redis_host: redis-service
  app.log.level: INFO
---
# 挂载为环境变量
envFrom:
  - configMapRef:
      name: app-config

# 或挂载为文件
volumes:
  - name: config
    configMap:
      name: app-config
```

### Secret

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: app-secret
type: Opaque
data:
  db_password: cGFzc3dvcmQxMjM=  # base64 编码
---
# 挂载为环境变量
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef:
        name: app-secret
        key: db_password
```

**注意：** Secret 默认只做 base64 编码，不是加密。需要使用外部工具（如 Sealed Secrets、External Secrets Operator、Vault）实现真正的加密。

## Ingress

Ingress 提供 HTTP/HTTPS 路由到 Service 的能力。

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: myapp-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  rules:
    - host: myapp.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend:
              service:
                name: spring-boot-app
                port:
                  number: 80
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
  tls:
    - hosts:
        - myapp.example.com
      secretName: myapp-tls
```

## Helm 包管理

Helm 是 K8s 的包管理器，将 K8s 资源打包为 Chart。

### Chart 结构

```
my-chart/
├── Chart.yaml          # 元数据（名称、版本）
├── values.yaml         # 默认配置值
├── templates/          # Go 模板资源文件
│   ├── deployment.yaml
│   ├── service.yaml
│   ├── ingress.yaml
│   ├── configmap.yaml
│   ├── _helpers.tpl    # 模板辅助函数
│   └── tests/
│       └── test-connection.yaml
└── charts/             # 子 Chart 依赖
```

### 常用命令

```bash
# 安装 Chart
helm install my-release ./my-chart

# 使用自定义值
helm install my-release ./my-chart -f values-prod.yaml

# 升级
helm upgrade my-release ./my-chart

# 回滚
helm rollback my-release 1

# 查看状态
helm list

# 卸载
helm uninstall my-release

# 添加仓库
helm repo add bitnami https://charts.bitnami.com/bitnami
```

## 常用 kubectl 命令

```bash
# 查看资源
kubectl get pods
kubectl get pods -n my-namespace
kubectl get pods -o wide
kubectl get all

# 查看详情
kubectl describe pod myapp-pod

# 日志
kubectl logs -f myapp-pod
kubectl logs -f deployment/myapp-deployment

# 进入 Pod
kubectl exec -it myapp-pod -- /bin/sh

# 端口转发
kubectl port-forward service/myapp-service 8080:80

# 应用配置
kubectl apply -f deployment.yaml

# 删除资源
kubectl delete pod myapp-pod

# 扩缩容
kubectl scale deployment myapp-deployment --replicas=5

# 查看节点
kubectl get nodes
kubectl top nodes
kubectl top pods
```
