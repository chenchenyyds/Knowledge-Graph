## 服务治理体系概述

### 什么是服务治理？

微服务架构中，几十上百个服务互相调用，面临的问题：

```
服务雪崩：A → B → C → D
                    │
                    ▼
                  D 挂了
                    │
                    ▼
          C 等待 D 的响应（线程阻塞）
                    │
                    ▼
          B 等 C，线程池耗尽
                    │
                    ▼
          A 等 B，整个系统不可用 → 雪崩
```

**"三个设计"解决雪崩问题：**

```
服务治理三大法宝：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  限流 (Rate Limiting)   熔断 (Circuit Breaker)   降级 (Degradation)│
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────┐ │
│  │ 控制入口流量      │  │ 自动断开故障链路  │  │ 提供兜底方案   │ │
│  │ 防止系统过载      │  │ 防止故障蔓延      │  │ 保证核心功能   │ │
│  │ "限"             │  │ "断"             │  │ "舍"          │ │
│  └─────────────────┘  └─────────────────┘  └────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 限流算法详解

### 四种限流算法对比

```
┌─────────────────────────────────────────────────────────────┐
│  算法        │ 原理                    │ 特点                │
├─────────────┼─────────────────────────┼─────────────────────┤
│ 固定窗口     │ 每 X 秒最多处理 N 个请求 │ 实现简单，窗口边界有突刺 │
│ 滑动窗口     │ 按时间粒度滑动统计       │ 更平滑，精度可控       │
│ 令牌桶       │ 匀速放入令牌，取到才通过  │ 支持突发流量           │
│ 漏桶         │ 请求进入桶匀速流出       │ 绝对平滑，不支持突发    │
└─────────────────────────────────────────────────────────────┘
```

**固定窗口（计数器）算法：**
```java
public class FixedWindowRateLimiter {

    private final long windowSize;       // 窗口大小（毫秒）
    private final int maxRequests;       // 最大请求数
    private int currentCount;            // 当前计数
    private long windowStart;            // 窗口开始时间

    public FixedWindowRateLimiter(long windowSize, int maxRequests) {
        this.windowSize = windowSize;
        this.maxRequests = maxRequests;
        this.windowStart = System.currentTimeMillis();
    }

    public synchronized boolean tryAcquire() {
        long now = System.currentTimeMillis();

        // 超过窗口时间，重置
        if (now - windowStart >= windowSize) {
            windowStart = now;
            currentCount = 0;
        }

        // 检查是否超过阈值
        if (currentCount >= maxRequests) {
            return false;  // 限流
        }

        currentCount++;
        return true;
    }
}
```
固定窗口问题：在窗口切换的边界可能出现 2 倍突发流量（例如 0:59 和 1:00 各有 100 个请求，实际 1 秒内通过了 200 个）。

**滑动窗口算法：**
```java
public class SlidingWindowRateLimiter {

    private final int windowSize;        // 窗口大小（秒）
    private final int maxRequests;       // 最大请求数
    private final int slotCount;         // 子窗口数量（精度）
    private final AtomicLongArray slots; // 每个子窗口的计数
    private volatile int currentSlot;    // 当前子窗口索引

    public SlidingWindowRateLimiter(int windowSize, int maxRequests, int slotCount) {
        this.windowSize = windowSize;
        this.maxRequests = maxRequests;
        this.slotCount = slotCount;
        this.slots = new AtomicLongArray(slotCount);
    }

    public boolean tryAcquire() {
        int slot = getCurrentSlot();
        slots.incrementAndGet(slot);

        // 统计整个窗口的请求数
        long total = 0;
        for (int i = 0; i < slotCount; i++) {
            total += slots.get(i);
        }

        return total <= maxRequests;
    }

    private int getCurrentSlot() {
        long now = System.currentTimeMillis();
        return (int) ((now / (windowSize * 1000L / slotCount)) % slotCount);
    }
}
```

**令牌桶算法（常用）：**
```
                          ┌──────────────────┐
                          │  令牌桶           │
                          │  ┌──────────────┐ │
  ┌─────────┐  放入令牌      │  │ ● ● ● ● ●  │ │
  │ 令牌生成  │─────────────▶│  │ ● ● ● ●    │ │
  │ 每秒 r 个  │             │  └──────────────┘ │
  └─────────┘              │  容量 = b         │
                            └──────────┬───────┘
                                       │
                          ┌────────────┴────────────┐
                          │  请求到达，取令牌          │
                          │  有令牌 → 放行            │
                          │  无令牌 → 拒绝            │
                          └─────────────────────────┘
```

```java
// 使用 Guava RateLimiter（令牌桶实现）
public class GuavaRateLimiterDemo {

    // 每秒生成 100 个令牌，桶最大容量 100
    private final RateLimiter rateLimiter = RateLimiter.create(100.0);

    // 预热模式（适用于秒杀等突发场景）
    // 前 10 秒从 50% 速率逐渐提升到满速
    private final RateLimiter warmupLimiter = RateLimiter.create(100.0, 10, TimeUnit.SECONDS);

    public boolean tryAcquire() {
        return rateLimiter.tryAcquire(); // 非阻塞尝试
    }

    public void acquire() {
        double waitTime = rateLimiter.acquire(); // 阻塞等待，返回等待时间
    }
}
```

---

## 熔断器（Circuit Breaker）

### 状态机

```
                   正常调用
                 ┌─────────┐
                 │         ▼
           ┌──────────┐
           │  CLOSED  │  (关闭状态：正常调用)
           │  关闭     │
           └─────┬────┘
                 │
                 │ 失败次数 / 比例超阈值
                 ▼
           ┌──────────┐
           │   OPEN   │  (开启状态：直接拒绝)
           │   打开    │
           └─────┬────┘
                 │
                 │ 超时时间到
                 ▼
           ┌──────────┐
           │ HALF_OPEN│  (半开状态：试探恢复)
           │  半开     │
           └─────┬────┘
                 │
        ┌────────┴────────┐
        │                 │
     成功（恢复）        失败（再次熔断）
        │                 │
        ▼                 ▼
    ┌──────────┐    ┌──────────┐
    │  CLOSED  │    │   OPEN   │
    └──────────┘    └──────────┘
```

### Sentinel 熔断规则配置

```java
@Configuration
public class SentinelConfig {

    @PostConstruct
    public void initCircuitBreakerRules() {
        List<DegradeRule> rules = new ArrayList<>();

        // 1. 慢调用比例熔断
        DegradeRule slowCallRule = new DegradeRule("getUserById")
            .setGrade(RuleConstant.DEGRADE_GRADE_RT)        // 按响应时间
            .setCount(200)                                   // 最大 RT 200ms
            .setTimeWindow(60)                               // 熔断时长 60s
            .setMinRequestAmount(5)                          // 最小请求数
            .setSlowRatioThreshold(0.5);                     // 慢调用比例阈值 50%
        rules.add(slowCallRule);

        // 2. 异常比例熔断
        DegradeRule exceptionRule = new DegradeRule("createOrder")
            .setGrade(RuleConstant.DEGRADE_GRADE_EXCEPTION_RATIO) // 按异常比例
            .setCount(0.2)                                       // 异常比例 20%
            .setTimeWindow(30)                                   // 熔断 30s
            .setMinRequestAmount(10);
        rules.add(exceptionRule);

        // 3. 异常数熔断
        DegradeRule exceptionCountRule = new DegradeRule("payment")
            .setGrade(RuleConstant.DEGRADE_GRADE_EXCEPTION_COUNT) // 按异常数
            .setCount(50)                                          // 最近 1 分钟 50 个异常
            .setTimeWindow(30)
            .setMinRequestAmount(10);
        rules.add(exceptionCountRule);

        DegradeRuleManager.loadRules(rules);
    }
}
```

---

## 服务降级

### 降级分级策略

```
降级级别表：
┌────────┬─────────────────────────────────────┐
│ 级别    │ 措施                                │
├────────┼─────────────────────────────────────┤
│ L1     │ 非核心服务降级（日志、监控、推荐）     │
│ L2     │ 写操作降级（评论、点赞改为异步）       │
│ L3     │ 读操作降级（展示缓存/兜底数据）        │
│ L4     │ 功能降级（关闭部分功能，只保留核心业务） │
└────────┴─────────────────────────────────────┘
```

### 降级实现示例

```java
@Service
@Slf4j
public class RecommendService {

    @Autowired
    private StringRedisTemplate redisTemplate;

    // 方案 A：直接降级（返回空/默认值）
    @SentinelResource(value = "recommend", fallback = "defaultRecommend")
    public List<Product> getRecommendations(Long userId) {
        // 调用推荐系统（可能耗时较久）
        return recommendClient.getRecommendations(userId);
    }

    // 默认兜底
    public List<Product> defaultRecommend(Long userId, Throwable e) {
        log.warn("推荐系统不可用，返回默认推荐: {}", e.getMessage());
        // 返回缓存的热门商品
        return getHotProductsFromCache();
    }

    // 方案 B：渐进式降级（尝试不同级别）
    public PageResult<Product> searchProducts(String keyword, int page, int size) {
        try {
            // Level 0：正常搜索
            return searchFromES(keyword, page, size);
        } catch (Exception e) {
            log.warn("ES 搜索失败，降级到 MySQL: {}", e.getMessage());
            try {
                // Level 1：降级到 MySQL LIKE 搜索
                return searchFromDB(keyword, page, size);
            } catch (Exception e2) {
                // Level 2：降级到缓存数据
                return searchFromCache(keyword);
            }
        }
    }

    // 方案 C：开关降级（通过配置中心动态控制）
    public Result<?> dynamicDegradation(String key) {
        // 从配置中心读取降级开关
        String degradeLevel = configCenter.getConfig("degrade.recommend.level");

        if ("full".equals(degradeLevel)) {
            return Result.success(Collections.emptyList());  // 完全降级
        }
        if ("simple".equals(degradeLevel)) {
            return Result.success(getSimpleRecommend());     // 简单模式
        }
        return Result.success(getFullRecommend());            // 正常模式
    }
}
```

---

## 灰度发布

### 策略对比

```
┌──────────────┬─────────────────────┬──────────────────────┐
│   策略        │ 原理                 │ 适用场景              │
├──────────────┼─────────────────────┼──────────────────────┤
│ 蓝绿部署      │ 两套完整环境，切流量   │ 重大版本升级          │
│              │                      │ 快速回滚重要          │
├──────────────┼─────────────────────┼──────────────────────┤
│ 金丝雀发布    │ 先升级少量实例验证     │ 功能验证、性能测试     │
│              │ 逐步扩大范围          │                      │
├──────────────┼─────────────────────┼──────────────────────┤
│ 按比例灰度    │ 5%→20%→50%→100%    │ 功能逐步放量          │
├──────────────┼─────────────────────┼──────────────────────┤
│ 按标签灰度    │ 特定用户/地域/IP灰度  │ 内测、A/B 测试        │
└──────────────┴─────────────────────┴──────────────────────┘
```

### Nacos + Gateway 灰度实现

```yaml
# 灰度服务元数据配置（在 Nacos 注册时添加）
spring:
  cloud:
    nacos:
      discovery:
        metadata:
          version: v2.0.1                # 灰度版本号
          canary: true                    # 灰度标记
```

```java
// 灰度路由过滤器
@Component
@Slf4j
public class GrayRouteFilter implements GlobalFilter, Ordered {

    // 灰度用户列表（生产环境从配置中心读取）
    @Value("#{'${gray.users:}'.split(',')}")
    private Set<String> grayUsers;

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String userId = request.getHeaders().getFirst("X-User-Id");

        boolean isGray = false;

        // 判断是否灰度用户
        if (userId != null && grayUsers.contains(userId)) {
            isGray = true;
        }

        // 也可以通过 Header 标记（测试专用）
        if ("true".equals(request.getHeaders().getFirst("X-Gray"))) {
            isGray = true;
        }

        log.debug("用户 {} 灰度状态: {}", userId, isGray);

        // 在请求头中加入灰度标记，下游服务根据此标记选择版本
        ServerHttpRequest modifiedRequest = request.mutate()
            .header("X-Gray-Flag", String.valueOf(isGray))
            .build();

        return chain.filter(exchange.mutate().request(modifiedRequest).build());
    }

    @Override
    public int getOrder() {
        return -50;
    }
}
```

```yaml
# 灰度路由配置
spring:
  cloud:
    gateway:
      routes:
        # 灰度版本
        - id: order-service-canary
          uri: lb://order-service-canary?canary=true    # 路由到灰度实例
          predicates:
            - Path=/api/order/**
            - Header=X-Gray-Flag, true                  # 只有灰度标记才走
          filters:
            - StripPrefix=1

        # 稳定版本
        - id: order-service-stable
          uri: lb://order-service                        # 路由到稳定实例
          predicates:
            - Path=/api/order/**
          filters:
            - StripPrefix=1
```

### 自定义 LoadBalancer 灰度规则

```java
// 自定义负载均衡过滤器
@Component
@Slf4j
public class GrayLoadBalancer implements ReactorServiceInstanceLoadBalancer {

    private final String serviceId;

    public GrayLoadBalancer(String serviceId) {
        this.serviceId = serviceId;
    }

    @Override
    public Mono<Response<ServiceInstance>> choose(Request request) {
        // 从 Request 中获取灰度标记
        RequestDataContext context = (RequestDataContext) request.getContext();
        String grayFlag = context.getClientRequest().getHeaders()
            .getFirst("X-Gray-Flag");

        boolean isGray = "true".equals(grayFlag);

        // 获取所有可用实例
        return serviceInstanceListSupplierProvider.get(serviceId)
            .flatMap(supplier -> supplier.get(request))
            .map(instances -> {
                // 灰度请求优先选择灰度实例
                if (isGray) {
                    List<ServiceInstance> grayInstances = instances.stream()
                        .filter(instance -> "true".equals(
                            instance.getMetadata().getOrDefault("canary", "false")))
                        .collect(Collectors.toList());

                    if (!grayInstances.isEmpty()) {
                        return Response.of(selectOne(grayInstances));
                    }
                }

                // 非灰度或没有灰度实例时选择正常实例
                List<ServiceInstance> normalInstances = instances.stream()
                    .filter(instance -> !"true".equals(
                        instance.getMetadata().getOrDefault("canary", "false")))
                    .collect(Collectors.toList());

                return Response.of(selectOne(normalInstances));
            });
    }

    private ServiceInstance selectOne(List<ServiceInstance> instances) {
        if (instances.isEmpty()) {
            return null;
        }
        // 简单轮询
        return instances.get(ThreadLocalRandom.current().nextInt(instances.size()));
    }
}
```

---

## 全链路压测

### 架构图

```
压力机 (JMeter / wrk / Locust)
        │
        ▼
┌──────────────────────────┐
│       Gateway            │ ← 识别压测标记 Header
│  识别压测流量 → 添加标记   │
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│     User Service         │ ← 传递压测标记
│  正常表：user_0           │
│  影子表：shadow_user_0    │ ← 压测数据写影子表
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│     Order Service        │
│  正常表：order_0          │
│  影子表：shadow_order_0   │ ← 不影响线上数据
└──────────┬───────────────┘
           │
           ▼
┌──────────────────────────┐
│       MQ                 │
│  压测消息隔离 (Tag 过滤)  │
└──────────────────────────┘
```

### 影子表实现方案

```java
/**
 * 基于 ThreadLocal 的压测上下文
 * 压测标记在整个调用链中传递
 */
@Component
public class PerfTestContext {

    private static final ThreadLocal<Boolean> PERF_FLAG = new ThreadLocal<>();

    // 从请求中识别压测流量
    public boolean isPerfTest(HttpServletRequest request) {
        return "true".equals(request.getHeader("X-Perf-Test"));
    }

    // 从链路追踪标记判断
    public boolean isPerfTestByTrace() {
        return Boolean.TRUE.equals(PERF_FLAG.get());
    }

    public void setPerfFlag(boolean isPerf) {
        PERF_FLAG.set(isPerf);
    }

    public void clear() {
        PERF_FLAG.remove();
    }
}

/**
 * 压测流量数据源路由（读写分离 + 影子库）
 */
@Component
public class PerformanceDataSourceRouter extends AbstractRoutingDataSource {

    @Autowired
    private PerfTestContext perfTestContext;

    @Override
    protected Object determineCurrentLookupKey() {
        // 压测流量 → 影子数据源
        if (perfTestContext.isPerfTestByTrace()) {
            return "shadow";
        }
        return "master";
    }
}
```

```yaml
# 多数据源配置
spring:
  datasource:
    # 主库（正常业务）
    master:
      url: jdbc:mysql://master-host:3306/mydb
      username: app
      password: secret

    # 影子库（压测数据）
    shadow:
      url: jdbc:mysql://shadow-host:3306/mydb_shadow
      username: app
      password: secret
```

---

## 配置中心最佳实践

### Nacos Config 配置

```yaml
spring:
  application:
    name: user-service
  cloud:
    nacos:
      config:
        server-addr: ${NACOS_ADDR:localhost:8848}
        namespace: ${NAMESPACE:prod}
        group: DEFAULT_GROUP
        file-extension: yaml
        refresh-enabled: true           # 开启配置自动刷新
        shared-configs:                 # 共享配置（多服务共用）
          - data-id: common.yaml
            group: DEFAULT_GROUP
            refresh: true
          - data-id: redis.yaml
            group: SHARED_GROUP
            refresh: true
```

```java
// 动态刷新配置
@Component
@RefreshScope  // 关键注解：配置变更时自动刷新 Bean
@ConfigurationProperties(prefix = "order")
@Data
public class OrderConfig {

    private int maxOrderPerUser = 10;       // 每人最大订单数
    private int orderTimeoutMinutes = 30;   // 订单超时时间
    private boolean enableAutoCancel = true; // 是否自动取消超时订单
    private List<String> blacklistUsers;    // 黑名单用户
}

// 监听配置变更
@Component
public class ConfigChangeListener {

    @Autowired
    private NacosConfigManager nacosConfigManager;

    @PostConstruct
    public void init() {
        nacosConfigManager.getConfigService().addListener(
            "user-service.yaml", "DEFAULT_GROUP", new Listener() {
                @Override
                public Executor getExecutor() {
                    return Executors.newSingleThreadExecutor();
                }

                @Override
                public void receiveConfigInfo(String configInfo) {
                    log.info("配置变更: {}", configInfo);
                    // 执行配置变更后的操作（如重新加载缓存）
                    reloadConfig();
                }
            }
        );
    }
}
```

### 配置隔离与安全

```
配置隔离策略：

Namespace（环境隔离）
├── dev    命名空间：开发环境
│   ├── user-service 配置
│   └── order-service 配置
├── test   命名空间：测试环境
│   ├── user-service 配置
│   └── order-service 配置
├── prod   命名空间：生产环境
│   ├── user-service 配置
│   └── order-service 配置
│
Group（版本隔离）
├── DEFAULT_GROUP    通用组
├── BLUE_GROUP       蓝组（新版）
├── GREEN_GROUP      绿组（旧版）

Data ID（粒度隔离）
├── user-service.yaml          主配置
├── user-service-db.yaml       数据库配置（敏感）
├── user-service-redis.yaml    Redis 配置（敏感）
└── user-service-secret.yaml   密钥配置（加密）
```

**配置加密方案：**
```yaml
# Jasypt 加密敏感配置
jasypt:
  encryptor:
    password: ${JASYPT_PASSWORD}   # 加密密钥（环境变量传入，不硬编码）
    algorithm: PBEWithMD5AndDES

# 加密后的配置
spring:
  datasource:
    password: ENC(加密后的密文字符串)
```

---

## 服务网格（Service Mesh）

### Istio 架构

```
┌──────────────────────────────────────────────────────────────────┐
│                     Istio 控制平面                                │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Pilot    │  │ Citadel  │  │ Galley   │  │ Kiali    │        │
│  │ 服务发现  │  │ 证书管理  │  │ 配置校验  │  │ 可视化   │        │
│  │ 流量控制  │  │ 安全认证  │  │ 配置分发  │  │ 拓扑图   │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└──────────────────────────┬───────────────────────────────────────┘
                           │ 控制配置下发
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Istio 数据平面（K8s Pod）                      │
│                                                                  │
│  ┌──────────────────┐    ┌──────────────────┐                    │
│  │ Pod A            │    │ Pod B            │                    │
│  │ ┌────┐ ┌──────┐ │    │ ┌────┐ ┌──────┐ │                    │
│  │ │ App│◀─▶Envoy│ │    │ │ App│◀─▶Envoy│ │                    │
│  │ └────┘ └──────┘ │    │ └────┘ └──────┘ │                    │
│  └────────┬─────────┘    └────────┬─────────┘                    │
│           │                       │                              │
│           └─────── Envoy 之间 mTLS 加密通信 ──────┘              │
│                                                                  │
│  每个 Pod 自动注入 Envoy Sidecar 容器，拦截所有进出流量            │
│  应用代码零感知（零侵入）                                         │
└──────────────────────────────────────────────────────────────────┘
```

### 传统微服务 vs Service Mesh

```
传统微服务框架（Spring Cloud）：
┌───────────────────────────────────────────────┐
│  应用代码  (业务逻辑 + 注册发现 + 熔断 + 限流)  │
│  需要引入各种 Starter、注解、配置                │
│  框架升级需要改代码重新编译                      │
│  跨语言困难（只适合 Java）                      │
└───────────────────────────────────────────────┘

Service Mesh（Istio + Envoy）：
┌───────────────────────────────────────────────┐
│  应用代码  (只关注业务逻辑)                     │
│  ─────────────────────────────────────────    │
│  Sidecar Proxy（透明拦截所有流量）              │
│  - 服务发现、负载均衡                           │
│  - 熔断、重试、超时控制                          │
│  - 流量拆分、灰度发布                           │
│  - mTLS 加密、访问控制                          │
│  - 指标收集、链路追踪                           │
│  上述能力由 Sidecar + 控制平面提供，应用无感知    │
└───────────────────────────────────────────────┘
```

### Istio 流量控制示例（对比 Spring Cloud 配置）

**Spring Cloud 方式（代码侵入）：**
```java
@SentinelResource(value = "product", blockHandler = "block")
public Product getProduct(Long id) {
    return productClient.getProduct(id);
}
```

**Istio 方式（无代码侵入）：**
```yaml
# VirtualService：流量路由
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata:
  name: product-service
spec:
  hosts:
  - product-service
  http:
  - match:
    - headers:
        X-Canary:
          exact: "true"
    route:
    - destination:
        host: product-service
        subset: v2          # 灰度版本
      weight: 100
  - route:
    - destination:
        host: product-service
        subset: v1          # 稳定版本
      weight: 100

---
# DestinationRule：熔断配置
apiVersion: networking.istio.io/v1beta1
kind: DestinationRule
metadata:
  name: product-service
spec:
  host: product-service
  trafficPolicy:
    connectionPool:
      tcp:
        maxConnections: 100          # 最大连接数
      http:
        http1MaxPendingRequests: 10   # 最大等待请求
        http2MaxRequests: 1000        # 最大请求数
    outlierDetection:                 # 熔断检测
      consecutive5xxErrors: 5         # 连续 5 次 5xx 触发熔断
      interval: 30s                   # 检测间隔
      baseEjectionTime: 60s           # 驱逐基础时间
      maxEjectionPercent: 50          # 最大驱逐比例
```

---

## 面试高频题

**Q1: 限流、熔断、降级的区别与联系？**
A: 限流是控制入口流量防止系统过载（主动）；熔断是检测到下游故障时自动断开链路防止故障蔓延（被动）；降级是在系统压力大时舍弃非核心功能保证核心可用（主动）。三者配合使用：入口限流 + 故障熔断 + 非核心降级。

**Q2: 如何实现灰度发布？**
A: 三种方式：1. 网关层：通过 Nacos 元数据标记实例版本，Gateway 根据 Header/Cookie 路由到不同版本。2. 负载均衡层：自定义 LoadBalancer 规则，根据请求特征选择实例。3. K8s/Istio 层：通过 Service Mesh 的 VirtualService/DestinationRule 做流量分发。

**Q3: 服务治理在 Spring Cloud 和 Service Mesh 中的实现差异？**
A: Spring Cloud 是代码侵入式，需要在业务代码中集成各种 Starter（Sentinel/Feign 等），升级需要改代码。Service Mesh 是透明代理模式，通过 Sidecar 拦截流量，与语言无关，升级只需更新 Sidecar。趋势是从 Spring Cloud 向 Service Mesh 演进。

**Q4: 配置中心选型 Nacos vs Apollo？**
A: Nacos 轻量级，同时是注册中心和配置中心，适合中小团队。Apollo 功能更丰富（配置界面完善、灰度发布、权限管理、配置审计），适合大型团队。如果已有 Nacos 做注册中心，建议直接用 Nacos Config 减少组件。

**Q5: 全链路压测的挑战与方案？**
A: 挑战：1. 流量识别——通过 Header 标记压测请求 2. 数据隔离——影子表/影子库，压测数据不影响线上 3. 存储隔离——压测数据最终要清理 4. 第三方依赖——通过 Mock 或压测独有的测试账号隔离。方案：在网关层识别压测标记，通过 ThreadLocal 在整个调用链传递，数据访问层根据标记路由到影子数据源。