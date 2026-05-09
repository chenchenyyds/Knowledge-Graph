## 微服务架构概述

### 从单体到微服务

```
单体架构：                          微服务架构：
┌─────────────────────┐      ┌──────────────────────────┐
│    单体应用          │      │   API Gateway            │
│                     │      │   (Spring Cloud Gateway)  │
│  ┌───────────────┐  │      └────┬────┬────┬────┬──────┘
│  │ 用户模块       │  │           │    │    │    │
│  ├───────────────┤  │           ▼    ▼    ▼    ▼
│  │ 商品模块       │  │   ┌────┐ ┌────┐ ┌────┐ ┌────┐
│  ├───────────────┤  │   │用户│ │商品│ │订单│ │支付│
│  │ 订单模块       │  │   │服务│ │服务│ │服务│ │服务│
│  ├───────────────┤  │   └──┬─┘ └──┬─┘ └──┬─┘ └──┬─┘
│  │ 支付模块       │  │      │      │       │       │
│  ├───────────────┤  │      ▼      ▼       ▼       ▼
│  │ 通知模块       │  │   ┌──────────────────────────┐
│  └───────────────┘  │   │  注册中心 (Nacos/Eureka)  │
│                     │   └──────────────────────────┘
│  DB                 │
│  (单库)             │   每个服务独立部署、独立数据库、独立团队
└─────────────────────┘   通信：HTTP(REST) / gRPC / 消息队列
```

### Spring Cloud 核心组件栈

| 功能 | Spring Cloud 组件 | 说明 |
|------|------------------|------|
| 服务注册发现 | Nacos / Eureka | 服务地址管理 |
| 配置中心 | Nacos Config / Apollo | 统一配置管理 |
| API 网关 | Spring Cloud Gateway | 路由、鉴权、限流 |
| 远程调用 | OpenFeign | 声明式 HTTP 客户端 |
| 负载均衡 | Spring Cloud LoadBalancer | 客户端负载均衡 |
| 熔断限流 | Sentinel / Resilience4j | 服务保护 |
| 链路追踪 | Micrometer Tracing + Zipkin | 分布式调用链 |
| 分布式事务 | Seata | 跨服务事务 |

---

## 服务注册与发现

### Nacos 架构

```
                     ┌─────────────────────┐
                     │     Nacos Server     │
                     │  注册中心 + 配置中心  │
                     │   (AP + CP 可切换)   │
                     └────┬────┬────┬──────┘
                          │    │    │
              ┌───────────┘    │    └───────────┐
              ▼                ▼                ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │  Service │    │  Service │    │  Service │
        │    A     │    │    B     │    │    C     │
        │ (user)   │    │ (order)  │    │ (payment)│
        └──────────┘    └──────────┘    └──────────┘

启动流程：
1. 服务启动 → 向 Nacos 注册自身 IP + 端口
2. 定时发送心跳（默认 5s）
3. Nacos 检测心跳超时（15s）→ 标记不健康
4. 服务关闭 → 主动注销
```

**Nacos 配置：**
```yaml
spring:
  application:
    name: user-service
  cloud:
    nacos:
      discovery:
        server-addr: 192.168.1.100:8848   # Nacos 地址
        namespace: prod                    # 命名空间（环境隔离）
        group: DEFAULT_GROUP               # 分组
        cluster-name: SH                   # 集群名（上海机房）
        heart-beat-interval: 5000          # 心跳间隔
        heart-beat-timeout: 15000          # 心跳超时
```

### Eureka vs Nacos

```
┌────────────────────────────────────────────────────────────┐
│               Eureka          vs          Nacos             │
├────────────────────────────────────────────────────────────┤
│  AP 原则（优先可用）         │      CP + AP 可切换            │
│  自我保护模式               │      健康检查更丰富            │
│  只做注册中心               │      注册中心 + 配置中心        │
│  2.0 闭源（仍在维护）       │      阿里巴巴开源，社区活跃     │
│  不支持配置管理             │      支持配置动态刷新           │
│  无命名空间隔离             │      支持命名空间隔离           │
│  无权重路由                 │      支持权重路由              │
└────────────────────────────────────────────────────────────┘
```

```yaml
# Eureka 配置（了解即可，已逐渐被 Nacos 替代）
spring:
  application:
    name: user-service

eureka:
  client:
    service-url:
      defaultZone: http://localhost:8761/eureka/
    register-with-eureka: true
    fetch-registry: true
  instance:
    prefer-ip-address: true
    lease-renewal-interval-in-seconds: 10    # 心跳间隔
    lease-expiration-duration-in-seconds: 30 # 过期时间
```

---

## Spring Cloud Gateway 网关

### 网关作用

```
                   ┌──────────┐
                   │  客户端   │
                   └────┬─────┘
                        │
                        ▼
              ┌─────────────────┐
              │    Gateway      │ ◀── 统一入口、鉴权、限流、日志
              │  8080 端口      │
              └──┬──┬──┬──┬────┘
                 │  │  │  │
          ┌──────┘  │  │  └──────┐
          ▼         ▼  ▼         ▼
     ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
     │user  │ │order │ │pay   │ │...   │
     │:8081 │ │:8082 │ │:8083 │ │      │
     └──────┘ └──────┘ └──────┘ └──────┘
```

### 路由配置

```yaml
server:
  port: 8080

spring:
  cloud:
    gateway:
      routes:
        # 用户服务路由
        - id: user-service
          uri: lb://user-service                     # 负载均衡到 user-service
          predicates:
            - Path=/api/user/**                      # 路径匹配
            - Header=X-Request-Source, mobile        # 请求头匹配（可选）
          filters:
            - StripPrefix=1                          # 去掉 /api 前缀
            - AddRequestHeader=X-Gateway, true       # 添加请求头

        # 订单服务路由
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
          filters:
            - StripPrefix=1
            - name: RequestRateLimiter               # 限流过滤器
              args:
                redis-rate-limiter:
                  replenishRate: 100                   # 令牌填充速率
                  burstCapacity: 200                   # 令牌桶容量

        # 商品服务路由（灰度发布）
        - id: product-service
          uri: lb://product-service
          predicates:
            - Path=/api/product/**
            - Weight=product-group, 90               # 90% 流量到稳定版本
          filters:
            - StripPrefix=1

        - id: product-service-canary
          uri: lb://product-service-canary
          predicates:
            - Path=/api/product/**
            - Weight=product-group, 10               # 10% 流量到灰度版本
            - Header=X-Canary, true                  # 或 Header 匹配
          filters:
            - StripPrefix=1
```

### 自定义网关过滤器

```java
// 自定义鉴权过滤器
@Component
@Slf4j
public class AuthGlobalFilter implements GlobalFilter, Ordered {

    @Autowired
    private AuthService authService;

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        ServerHttpResponse response = exchange.getResponse();

        // 白名单路径直接放行
        String path = request.getURI().getPath();
        if (path.contains("/auth/login") || path.contains("/auth/register")) {
            return chain.filter(exchange);
        }

        // 获取 Token
        String token = request.getHeaders().getFirst("Authorization");
        if (token == null || !token.startsWith("Bearer ")) {
            return unauthorized(response, "未登录");
        }

        // 验证 Token
        try {
            Claims claims = authService.verifyToken(token.substring(7));
            // 将用户信息传递到下游服务（通过 Header）
            ServerHttpRequest modifiedRequest = request.mutate()
                .header("X-User-Id", claims.get("userId").toString())
                .header("X-User-Name", claims.get("username").toString())
                .build();
            return chain.filter(exchange.mutate().request(modifiedRequest).build());
        } catch (Exception e) {
            log.warn("Token 验证失败: {}", e.getMessage());
            return unauthorized(response, "Token 无效");
        }
    }

    private Mono<Void> unauthorized(ServerHttpResponse response, String msg) {
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        response.getHeaders().setContentType(MediaType.APPLICATION_JSON);
        String body = String.format("{\"code\":401,\"msg\":\"%s\"}", msg);
        DataBuffer buffer = response.bufferFactory().wrap(body.getBytes());
        return response.writeWith(Mono.just(buffer));
    }

    @Override
    public int getOrder() {
        return -100;  // 优先级最高
    }
}
```

---

## OpenFeign 声明式服务调用

### 基本使用

```java
// 1. 开启 Feign
@SpringBootApplication
@EnableFeignClients(basePackages = "com.example.client")
public class OrderApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}

// 2. 定义 Feign 客户端
@FeignClient(
    name = "user-service",          // 调用的服务名
    path = "/api/user",             // 基础路径
    fallbackFactory = UserClientFallbackFactory.class  // 熔断降级
)
public interface UserClient {

    @GetMapping("/{id}")
    Result<UserDTO> getUserById(@PathVariable Long id);

    @GetMapping("/batch")
    Result<List<UserDTO>> getUsers(@RequestParam List<Long> ids);

    @PostMapping("/validate")
    Result<Boolean> validateUser(@RequestBody UserValidateRequest request);
}

// 3. 熔断降级处理
@Component
@Slf4j
public class UserClientFallbackFactory implements FallbackFactory<UserClient> {

    @Override
    public UserClient create(Throwable cause) {
        log.error("user-service 调用失败: {}", cause.getMessage());
        return new UserClient() {
            @Override
            public Result<UserDTO> getUserById(Long id) {
                // 返回兜底数据
                return Result.success(new UserDTO(id, "默认用户", "未知"));
            }

            @Override
            public Result<List<UserDTO>> getUsers(List<Long> ids) {
                return Result.success(Collections.emptyList());
            }

            @Override
            public Result<Boolean> validateUser(UserValidateRequest request) {
                return Result.success(false);
            }
        };
    }
}

// 4. 服务中使用
@Service
@Slf4j
public class OrderService {

    @Autowired
    private UserClient userClient;

    public OrderVO createOrder(OrderCreateRequest request) {
        // 调用远程用户服务获取用户信息
        Result<UserDTO> userResult = userClient.getUserById(request.getUserId());
        if (userResult.getCode() != 200) {
            throw new BusinessException("用户服务异常");
        }

        UserDTO user = userResult.getData();
        log.info("下单用户: {} <{}>", user.getUsername(), user.getEmail());

        // ... 业务逻辑
        return new OrderVO();
    }
}
```

### Feign 配置进阶

```yaml
# 全局 Feign 配置
spring:
  cloud:
    openfeign:
      client:
        config:
          default:
            connect-timeout: 5000
            read-timeout: 10000
            logger-level: BASIC     # NONE / BASIC / HEADERS / FULL
          # 特定服务的配置
          user-service:
            connect-timeout: 3000
            read-timeout: 5000
      compression:
        request:
          enabled: true
          mime-types: application/json
          min-request-size: 2048
        response:
          enabled: true
```

---

## Sentinel 熔断限流

### 核心概念

```
资源（Resource）：
  ┌────────────────────────────────────┐
  │     任意被 Sentinel 保护的代码块     │
  │     ● HTTP API                     │
  │     ● 方法调用                      │
  │     ● Feign 请求                    │
  └────────────────────────────────────┘

规则（Rule）：
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ 流控规则  │  │ 熔断规则  │  │ 热点规则  │
  │ QPS/线程数│  │ 慢调用/   │  │ 参数限流  │
  │ 限流     │  │ 异常比例  │  │         │
  └──────────┘  └──────────┘  └──────────┘

效果（Effect）：
  ├── 快速失败   ── 直接抛出异常
  ├── Warm Up    ── 预热，逐步提升阈值
  └── 排队等待    ── 匀速通过（漏桶）
```

### Sentinel 集成

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-sentinel</artifactId>
</dependency>
```

```yaml
spring:
  cloud:
    sentinel:
      transport:
        dashboard: localhost:8080    # Sentinel 控制台地址
        port: 8719                   # 与控制台交互端口
      eager: true                    # 启动时立即注册（默认懒加载）
      filter:
        enabled: true
      datasource:
        # 从 Nacos 读取规则（动态规则）
        flow:
          nacos:
            server-addr: ${nacos.address}
            data-id: ${spring.application.name}-flow-rules
            group-id: SENTINEL_GROUP
            rule-type: flow
```

```java
@RestController
@RequestMapping("/api/order")
public class OrderController {

    @Autowired
    private OrderService orderService;

    // 方式一：注解方式（最简单）
    @GetMapping("/create")
    @SentinelResource(
        value = "createOrder",
        blockHandler = "createOrderBlockHandler",    // 限流/熔断处理
        fallback = "createOrderFallback"             // 业务异常处理
    )
    public Result<OrderVO> createOrder(@RequestParam Long userId) {
        return Result.success(orderService.create(userId));
    }

    // 限流后的处理方法（参数必须与原始方法一致，并多一个 BlockException）
    public Result<OrderVO> createOrderBlockHandler(Long userId, BlockException e) {
        return Result.error(429, "请求太频繁，请稍后重试");
    }

    // 业务异常兜底
    public Result<OrderVO> createOrderFallback(Long userId, Throwable e) {
        return Result.error(500, "服务异常: " + e.getMessage());
    }

    // 方式二：编程方式（灵活控制）
    @PostMapping("/batch")
    public Result<?> batchCreate(@RequestBody List<OrderRequest> requests) {
        try (Entry entry = SphU.entry("batchCreate", EntryType.IN)) {
            return Result.success(orderService.batchCreate(requests));
        } catch (BlockException e) {
            return Result.error(429, "批量创建限流");
        }
    }
}
```

### 流控规则详解

```
规则配置（来源：Sentinel 控制台 / Nacos / 代码硬编码）

1. QPS 限流
   resource: createOrder
   limitApp: default
   grade: 1          # 0=线程数, 1=QPS
   count: 100         # 阈值
   strategy: 0        # 0=直接, 1=关联, 2=链路
   controlBehavior: 0 # 0=快速失败, 1=Warm Up, 2=排队等待
   warmUpPeriodSec: 10

2. 慢调用比例熔断
   resource: getUserById
   grade: 0           # 0=慢调用比例
   count: 200         # 响应时间 > 200ms
   timeWindow: 60     # 熔断时长 60s
   minRequestAmount: 5
   slowRatioThreshold: 0.5  # 比例阈值 50%
   statIntervalMs: 1000

3. 异常比例熔断
   resource: createOrder
   grade: 1           # 1=异常比例
   count: 0.2         # 20%
   timeWindow: 30
   minRequestAmount: 10
```

---

## 分布式链路追踪

### 基本原理

```
请求：浏览器 → API 网关 → UserService → OrderService → PaymentService

Trace ID: a1b2c3d4 (贯穿所有服务)

Span 结构：
┌─────────────────────────────────────────────────────┐
│ Trace (a1b2c3d4)                                    │
│  ├── Span1: gateway /api/order/create   [10ms]      │
│  ├── Span2: user-service getUserById    [5ms]       │
│  │   └── Span3: user-db query           [2ms]       │
│  ├── Span4: order-service create        [20ms]      │
│  │   └── Span5: order-db insert         [10ms]      │
│  └── Span6: payment-service deduct      [50ms]      │
│       └── Span7: payment-db update      [30ms]      │
└─────────────────────────────────────────────────────┘
```

### 集成 Micrometer Tracing + Zipkin

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-netflix-eureka-client</artifactId>
</dependency>

<!-- Micrometer Tracing（替代旧的 Sleuth） -->
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-tracing-bridge-brave</artifactId>
</dependency>
<dependency>
    <groupId>io.zipkin.reporter2</groupId>
    <artifactId>zipkin-reporter-brave</artifactId>
</dependency>
```

```yaml
spring:
  application:
    name: user-service
  # 链路追踪配置
  zipkin:
    base-url: http://zipkin-server:9411    # Zipkin 服务地址
    sender:
      type: web                             # 发送方式：web/kafka/rabbit
  sleuth:                                   # 已迁移到 micrometer
    sampler:
      probability: 1.0                      # 采样率（生产环境建议 0.1-0.5）
```

```java
// 代码中手动创建 Span
@Service
@Slf4j
public class PaymentService {

    @Autowired
    private Tracer tracer;

    public PaymentResult processPayment(PaymentRequest request) {
        // 创建自定义 Span
        ScopedSpan span = tracer.startScopedSpan("payment.process");
        try {
            span.tag("payment.method", request.getMethod());
            span.tag("amount", String.valueOf(request.getAmount()));

            // 业务逻辑
            return doProcess(request);
        } catch (Exception e) {
            span.error(e);
            throw e;
        } finally {
            span.end();  // 关闭 Span
        }
    }
}
```

---

## 面试高频题

**Q1: Eureka 和 Nacos 的对比？**
A: Eureka 是 AP 系统，只做注册中心，有自我保护机制。Nacos 支持 AP/CP 切换，同时是注册中心和配置中心，支持 Namespace 隔离，功能更丰富，目前是业界主流。

**Q2: 网关的作用有哪些？**
A: 统一入口、路由转发、负载均衡、认证鉴权、限流熔断、日志监控、跨域处理、协议转换（HTTP→Dubbo）。

**Q3: Feign 的工作原理？**
A: 通过 @EnableFeignClients 扫描 @FeignClient 接口，启动时通过 JDK 动态代理为每个接口创建代理对象，方法调用时构建 HTTP 请求，通过 Ribbon/LoadBalancer 负载均衡，发送到目标服务。

**Q4: Sentinel 的限流算法？**
A: 1. 计数器（固定窗口）2. 滑动窗口 3. 令牌桶（允许突发）4. 漏桶（平滑流量）。Sentinel 默认使用滑动窗口 + 令牌桶。

**Q5: 分布式链路追踪的核心概念？**
A: Trace（一次请求的完整链路）、Span（一次 RPC 调用）、Annotation（关键时间点：CS/CR/SS/SR）。通过 Trace ID 串联所有 Span，通过 Zipkin/Jaeger 展示。

---