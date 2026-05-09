## 高可用设计（High Availability Design）

高可用（HA）是指系统在面对硬件故障、软件异常、流量洪峰等突发状况时，仍能持续对外提供服务的能力。业界通常用 **N 个 9** 来衡量可用性：

| 可用性级别 | 年度不可用时间 | 描述 |
|-----------|---------------|------|
| 99%（2个9） | 87.6 小时 | 常规系统 |
| 99.9%（3个9） | 8.76 小时 | 大多数商业系统 |
| 99.99%（4个9） | 52.56 分钟 | 金融核心系统 |
| 99.999%（5个9） | 5.26 分钟 | 电信级系统 |
| 99.9999%（6个9） | 31.5 秒 | 航空/军事系统 |

---

## 一、高可用设计原则

### 1.1 消除单点故障（SPOF）

任何只有一个副本的组件都是潜在的故障点。

```
❌ 有单点的架构：
   ┌─────────┐
   │  Nginx  │ ← 单点
   └────┬────┘
        │
   ┌────▼────┐
   │  MySQL  │ ← 单点
   └─────────┘
   Nginx 或 MySQL 任何一个宕机，整个系统不可用

✅ 无单点的架构：
        ┌─────────┐
        │  DNS    │ ← 多 IP 解析
        └────┬────┘
         ┌───┴───┐
    ┌────▼────┐ ┌▼────────┐
    │Nginx 主 │ │Nginx 备 │ ← Nginx 主备（Keepalived）
    └────┬────┘ └─────────┘
         │
    ┌────▼────┐
    │MySQL 主  │ ← 主从复制
    └────┬────┘
    ┌────▼────┐
    │MySQL 从  │ ← 从库可切换为主
    └─────────┘
```

### 1.2 故障隔离（Bulkhead / 舱壁模式）

将系统划分为独立的隔离舱室，一个舱室的故障不会蔓延到其他舱室。

```
舱壁模式示意图（源于船舶设计）：
┌─────────────────────────────────────┐
│       ┌──────┐  ┌──────┐  ┌──────┐ │
│       │舱室A  │  │舱室B  │  │舱室C  │ │
│       │      │  │      │  │      │ │
│       │漏水→沉│  │正常  │  │正常  │ │
│       └──────┘  └──────┘  └──────┘ │
└─────────────────────────────────────┘
A 舱室漏水不影响 B 和 C
```

**线程池隔离**：
```java
// 不同的业务使用不同的线程池，避免互相影响
public class ThreadPoolIsolation {

    // 订单业务线程池
    private static final ThreadPoolExecutor orderPool = new ThreadPoolExecutor(
        10, 20, 60, TimeUnit.SECONDS,
        new LinkedBlockingQueue<>(100),
        new ThreadPoolExecutor.CallerRunsPolicy()
    );

    // 库存业务线程池
    private static final ThreadPoolExecutor stockPool = new ThreadPoolExecutor(
        5, 10, 60, TimeUnit.SECONDS,
        new LinkedBlockingQueue<>(50),
        new ThreadPoolExecutor.AbortPolicy()
    );

    // 支付业务线程池
    private static final ThreadPoolExecutor paymentPool = new ThreadPoolExecutor(
        20, 40, 60, TimeUnit.SECONDS,
        new LinkedBlockingQueue<>(200),
        new ThreadPoolExecutor.CallerRunsPolicy()
    );

    public void processOrder(Order order) {
        orderPool.submit(() -> {
            // 订单业务处理
        });
    }
}
```

**Hystrix 线程池隔离**：
```java
// Hystrix 命令，使用独立的线程池
public class GetProductCommand extends HystrixCommand<Product> {

    private Long productId;

    public GetProductCommand(Long productId) {
        super(Setter
            .withGroupKey(HystrixCommandGroupKey.Factory.asKey("ProductGroup"))
            .andCommandKey(HystrixCommandKey.Factory.asKey("GetProductKey"))
            .andThreadPoolKey(HystrixThreadPoolKey.Factory.asKey("ProductPool"))
            .andThreadPoolPropertiesDefaults(
                HystrixThreadPoolProperties.Setter()
                    .withCoreSize(10)
                    .withMaxQueueSize(20)
            )
        );
        this.productId = productId;
    }

    @Override
    protected Product run() throws Exception {
        return productService.getById(productId);
    }

    @Override
    protected Product getFallback() {
        // 降级：返回缓存数据
        return cacheService.getProduct(productId);
    }
}
```

---

## 二、负载均衡（Load Balancing）

将请求分发到多个服务节点上，提高系统的处理能力和可用性。

### 2.1 四层 vs 七层负载均衡

```
                    ┌──────────────────────────┐
                    │       客户端请求           │
                    └───────────┬──────────────┘
                                │
               ┌────────────────┴────────────────┐
               │                                 │
      ┌────────▼────────┐            ┌───────────▼─────────┐
      │   四层 LVS       │            │   七层 Nginx         │
      │                 │            │                      │
      │ 基于 IP + 端口  │            │ 基于 HTTP 内容       │
      │ 转发 TCP 流量   │            │ 解析 URL/Cookie/Header│
      │ 性能极高        │            │ 功能丰富             │
      │ 无法检查内容    │            │ 可做 SSL 卸载         │
      └────────┬────────┘            └───────────┬──────────┘
               │                                 │
               └────────────────┬────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │    后端服务器集群       │
                    │  Server1  Server2  S3  │
                    └───────────────────────┘
```

### 2.2 常见负载均衡算法

```java
// 1. 轮询（Round Robin）
public class RoundRobinStrategy implements LoadBalanceStrategy {
    private AtomicInteger index = new AtomicInteger(0);

    public Server select(List<Server> servers) {
        int i = index.getAndIncrement() % servers.size();
        return servers.get(i);
    }
}

// 2. 加权轮询（Weighted Round Robin）
public class WeightedRoundRobinStrategy implements LoadBalanceStrategy {
    // 权重高的服务器获得更多请求
    // Server A: weight=5, Server B: weight=3, Server C: weight=2
    // 10次请求中 A 收到5次，B 收到3次，C 收到2次
    private AtomicInteger index = new AtomicInteger(0);

    public Server select(List<Server> servers) {
        int totalWeight = servers.stream().mapToInt(Server::getWeight).sum();
        int i = index.getAndIncrement() % totalWeight;
        for (Server server : servers) {
            i -= server.getWeight();
            if (i < 0) return server;
        }
        return servers.get(0);
    }
}

// 3. 一致性哈希（Consistent Hash）
// 适合缓存场景：相同 key 始终路由到同一节点
public class ConsistentHashStrategy implements LoadBalanceStrategy {
    private TreeMap<Integer, Server> hashRing = new TreeMap<>();
    private HashFunction hashFunction = new MD5HashFunction();

    public ConsistentHashStrategy(List<Server> servers) {
        // 每个节点添加 150 个虚拟节点
        for (Server server : servers) {
            for (int i = 0; i < 150; i++) {
                int hash = hashFunction.hash(server.getId() + "_VN_" + i);
                hashRing.put(hash, server);
            }
        }
    }

    public Server select(String key) {
        if (hashRing.isEmpty()) return null;
        int hash = hashFunction.hash(key);
        // 找到第一个大于等于 hash 的节点
        Map.Entry<Integer, Server> entry = hashRing.ceilingEntry(hash);
        if (entry == null) {
            entry = hashRing.firstEntry();  // 回绕到环的起点
        }
        return entry.getValue();
    }
}
```

### 2.3 Nginx 配置示例

```nginx
# 七层负载均衡
http {
    upstream backend {
        # 负载均衡算法
        # 默认：轮询
        # ip_hash：根据客户端 IP 哈希（会话保持）
        # least_conn：最少连接
        # consistent_hash：一致性哈希（需要 ngx_http_upstream_consistent_hash 模块）

        # 加权轮询
        server 192.168.1.10:8080 weight=5 max_fails=3 fail_timeout=30s;
        server 192.168.1.11:8080 weight=3 max_fails=3 fail_timeout=30s;
        server 192.168.1.12:8080 weight=2 max_fails=3 fail_timeout=30s backup;  # 备用节点
    }

    server {
        listen 80;

        location /api/ {
            proxy_pass http://backend;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

            # 超时配置
            proxy_connect_timeout 5s;
            proxy_read_timeout 10s;
            proxy_send_timeout 10s;
        }
    }
}
```

---

## 三、限流（Rate Limiting）

限流是保护系统不被突发流量冲垮的第一道防线。

### 3.1 单机限流

**Guava RateLimiter（令牌桶）**

```java
public class GuavaRateLimiterExample {
    // 每秒生成 100 个令牌（QPS = 100）
    private RateLimiter rateLimiter = RateLimiter.create(100);

    public void handleRequest(Request request) {
        // 阻塞直到获取到令牌（允许突发流量）
        double waitTime = rateLimiter.acquire();

        // 或者：非阻塞，获取不到直接返回 false
        // if (rateLimiter.tryAcquire(100, TimeUnit.MILLISECONDS)) {
        //     process(request);
        // } else {
        //     return error("系统繁忙，请稍后重试");
        // }

        process(request);
    }
}
```

**Semaphore（信号量，控制并发数）**

```java
public class SemaphoreLimiter {
    // 最多允许 50 个并发请求
    private Semaphore semaphore = new Semaphore(50);

    public void handleRequest(Request request) {
        if (!semaphore.tryAcquire()) {
            throw new RuntimeException("系统繁忙");
        }
        try {
            process(request);
        } finally {
            semaphore.release();
        }
    }
}
```

### 3.2 分布式限流（Redis + Lua）

```lua
-- 滑动窗口限流 Lua 脚本
-- KEYS[1] = 限流 key (e.g., "rate_limit:user:123")
-- ARGV[1] = 窗口大小（毫秒）
-- ARGV[2] = 窗口内最大请求数

local key = KEYS[1]
local window = tonumber(ARGV[1])  -- 窗口大小(ms)
local limit = tonumber(ARGV[2])   -- 限流阈值

local now = redis.call('TIME')[1]  -- 当前时间戳（秒）
local currentWindow = math.floor(now / (window / 1000))

-- ZSET 清理过期元素
redis.call('ZREMRANGEBYSCORE', key, 0, now - window / 1000)

-- 统计当前窗口请求数
local count = redis.call('ZCARD', key)

if count >= limit then
    return 0  -- 限流
end

-- 添加当前请求
redis.call('ZADD', key, now, now .. ':' .. math.random())
redis.call('EXPIRE', key, window / 1000)

return 1  -- 通过
```

```java
// Java 调用分布式限流
@Component
public class DistributedRateLimiter {

    @Autowired
    private StringRedisTemplate redisTemplate;

    // 加载 Lua 脚本
    private DefaultRedisScript<Long> rateLimitScript;

    @PostConstruct
    public void init() {
        rateLimitScript = new DefaultRedisScript<>();
        rateLimitScript.setScriptSource(new ResourceScriptSource(
            new ClassPathResource("rate_limit.lua")));
        rateLimitScript.setResultType(Long.class);
    }

    public boolean tryAcquire(String key, long windowMs, int limit) {
        Long result = redisTemplate.execute(
            rateLimitScript,
            Arrays.asList(key),
            String.valueOf(windowMs),
            String.valueOf(limit)
        );
        return result != null && result == 1L;
    }
}

// 使用
if (rateLimiter.tryAcquire("rate_limit:user:" + userId, 1000, 10)) {
    // QPS 限制：每秒最多 10 次
    processRequest(request);
} else {
    return ResponseEntity.status(429).body("请求过于频繁");
}
```

### 3.3 Sentinel 限流

```java
// Sentinel 限流注解
@RestController
public class OrderController {

    @GetMapping("/order/create")
    @SentinelResource(
        value = "createOrder",
        blockHandler = "createOrderBlockHandler",
        fallback = "createOrderFallback"
    )
    public Result createOrder(@RequestParam Long userId) {
        // 业务逻辑
        return Result.success(orderService.createOrder(userId));
    }

    // 限流后的处理
    public Result createOrderBlockHandler(Long userId, BlockException e) {
        return Result.error("系统繁忙，请稍后重试");
    }

    // 熔断降级后的处理
    public Result createOrderFallback(Long userId, Throwable e) {
        return Result.error("服务异常，请稍后重试");
    }
}
```

```yaml
# Sentinel 规则配置
# 限流规则
flowRules:
  - resource: createOrder
    grade: 1                # 0=线程数, 1=QPS
    count: 1000             # 限流阈值
    controlBehavior: 0      # 0=直接拒绝, 1=WarmUp, 2=排队等待
    warmUpPeriodSec: 10     # 预热时间（秒）

# 熔断规则
degradeRules:
  - resource: createOrder
    grade: 0                # 0=慢调用比例, 1=异常比例, 2=异常数
    count: 100              # 阈值（慢调用：MS；异常比例：0.5=50%）
    timeWindow: 30          # 熔断时长（秒）
    minRequestAmount: 5     # 最小请求数
    statIntervalMs: 1000    # 统计窗口
```

---

## 四、熔断与降级

### 4.1 熔断器状态机

```
         ┌──────────────────────┐
         │                      │
         │       CLOSED         │ ← 正常状态，请求正常通过
         │  (正常调用)          │
         └──────┬───────────────┘
                │ 失败达到阈值
                ▼
         ┌──────────────────────┐
         │                      │
         │        OPEN          │ ← 熔断打开，请求快速失败
         │  (熔断打开)          │
         └──────┬───────────────┘
                │ 时间窗口到期
                ▼
         ┌──────────────────────┐
         │                      │
         │      HALF_OPEN       │ ← 半开状态，放行少量请求
         │  (探测恢复)          │     探测服务是否恢复
         └──────┬───────────────┘
           ┌────┴────┐
           ▼         ▼
       成功率达标   成功率仍低
        → CLOSED   → OPEN (重置时间窗口)
```

### 4.2 熔断降级实现（Resilience4j）

```java
// Resilience4j 熔断器配置
@Bean
public CircuitBreaker orderCircuitBreaker() {
    CircuitBreakerConfig config = CircuitBreakerConfig.custom()
        .failureRateThreshold(50)                   // 失败率阈值：50%
        .waitDurationInOpenState(Duration.ofSeconds(30))  // 熔断持续时间
        .permittedNumberOfCallsInHalfOpenState(3)   // 半开状态允许请求数
        .slidingWindowSize(100)                     // 滑动窗口大小
        .slidingWindowType(CircuitBreakerConfig.SlidingWindowType.COUNT_BASED)
        .build();

    return CircuitBreakerRegistry.of(config)
        .circuitBreaker("orderService");
}

// 使用
@Component
public class OrderServiceClient {

    @Autowired
    private CircuitBreaker circuitBreaker;

    public Order getOrder(Long orderId) {
        return circuitBreaker.executeSupplier(() -> {
            // 可能失败的远程调用
            return restTemplate.getForObject(
                "http://order-service/order/" + orderId, Order.class);
        });
    }
}
```

**面试重点**：熔断和降级的区别
- **熔断**：自动触发，由系统状态决定（失败率过高、慢调用比例过高）
- **降级**：主动关闭非核心功能，由业务决定（秒杀期间关闭评论功能）
- 熔断后通常触发降级（返回兜底数据）

---

## 五、多活架构

### 5.1 架构对比

```
┌──────────────────────────────────────────────────────────┐
│  主备架构                                                 │
│                                                          │
│  机房A（主）                   机房B（备）                 │
│  ┌──────────────┐            ┌──────────────┐            │
│  │  Nginx       │            │  Nginx       │            │
│  │  App Server  │ ← 同步 →  │  App Server  │            │
│  │  MySQL Master│            │  MySQL Slave │            │
│  └──────────────┘            └──────────────┘            │
│  正常：流量全部到 A                                       │
│  故障：DNS 切换到 B                                       │
│  RTO=分钟级  RPO=秒级                                     │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  双活架构                                                 │
│                                                          │
│  机房A                        机房B                       │
│  ┌──────────────┐            ┌──────────────┐            │
│  │ 流量进入      │            │ 流量进入      │            │
│  │  App Server  │ ← 双向 →  │  App Server  │            │
│  │  MySQL A     │   同步     │  MySQL B     │            │
│  └──────────────┘            └──────────────┘            │
│  正常：流量同时进入 A 和 B                                 │
│  故障：故障机房流量切换到正常机房                           │
│  RTO=秒级  RPO=秒级                                       │
│  难点：数据双向同步冲突处理                                 │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  三地五中心架构                                           │
│                                                          │
│  华北(北京)          华东(上海)          华南(深圳)        │
│  ┌──┬──┐            ┌──┬──┐            ┌──┬──┐          │
│  │A1│A2│            │B1│B2│            │C1│  │          │
│  └──┴──┘            └──┴──┘            └──┴──┘          │
│  5个数据中心，任意 2 个故障不影响整体                       │
│  成本极高，适合金融、电信等关键系统                         │
└──────────────────────────────────────────────────────────┘
```

### 5.2 多活数据同步方案

```java
// Canal 监听 binlog 实现数据同步
@Component
public class BinlogSyncService {

    @PostConstruct
    public void startSync() {
        CanalConnector connector = CanalConnectors.newSingleConnector(
            new InetSocketAddress("192.168.1.1", 11111),
            "example", "", "");

        connector.connect();
        connector.subscribe("order_db\\..*");
        connector.rollback();

        while (true) {
            Message message = connector.getWithoutAck(100);
            for (CanalEntry.Entry entry : message.getEntries()) {
                if (entry.getEntryType() == CanalEntry.EntryType.ROWDATA) {
                    CanalEntry.RowChange rowChange = CanalEntry.RowChange.parseFrom(
                        entry.getStoreValue());

                    for (CanalEntry.RowData rowData : rowChange.getRowDatasList()) {
                        // 同步到异地机房
                        syncToRemote(rowData);
                    }
                }
            }
            connector.ack(message.getId());
        }
    }
}
```

---

## 六、容灾演练与混沌工程

### 6.1 Chaos Engineering（混沌工程）

Netflix 提出的理念：**在生产环境中主动注入故障，验证系统的弹性**。

```java
// 使用 Chaos Monkey（Spring Boot 集成）
@Component
@ConditionalOnProperty(name = "chaos.monkey.enabled", havingValue = "true")
public class LatencyChaosAssault extends ChaosMonkeyBaseAssault {

    @Override
    public boolean isActive() {
        return true;
    }

    @Override
    public void attack() {
        long latency = ThreadLocalRandom.current().nextLong(100, 500);
        log.warn("混沌工程：注入 {}ms 延迟", latency);
        try {
            Thread.sleep(latency);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

```yaml
# application.yml
chaos:
  monkey:
    enabled: true  # 生产环境谨慎开启
    assaults:
      latency-active: true
      exceptions-active: true
      kill-application-active: false  # 杀进程攻击默认关闭
```

### 6.2 常见容灾演练场景

| 演练场景 | 模拟方式 | 验证目标 |
|---------|---------|---------|
| 网络延迟 | TC 命令注入延迟 | 超时处理、熔断是否正常 |
| 网络分区 | 防火墙阻断节点间通信 | CAP 策略是否正确 |
| CPU 飙升 | stress 工具压满 CPU | 限流是否触发、服务降级是否正常 |
| 内存溢出 | OOM killer | JVM 参数、自动重启是否正常 |
| 磁盘满 | dd 填充磁盘 | 日志清理、监控告警是否正常 |
| 节点宕机 | kill 服务进程 | 负载均衡摘除、主从切换是否正常 |

---

## 七、全链路监控体系

```
                     ┌──────────────────────┐
                     │    统一监控面板       │
                     │    (Grafana)         │
                     └──────┬───────┬───────┘
                            │       │
          ┌─────────────────┼───────┼──────────────────┐
          │                 │       │                   │
    ┌─────▼─────┐   ┌──────▼──┐ ┌──▼────────┐   ┌─────┴─────┐
    │  指标     │   │  日志   │ │  链路     │   │  告警     │
    │ Metrics   │   │ Logging │ │ Tracing   │   │ Alert     │
    ├───────────┤   ├─────────┤ ├───────────┤   ├───────────┤
    │Prometheus │   │  ELK    │ │  Jaeger   │   │ Alertmanager│
    │Node-Exporter│ │Logstash │ │  Zipkin   │   │ 钉钉/邮件  │
    │           │   │ES+Kibana│ │  SkyWalking│   │           │
    └───────────┘   └─────────┘ └───────────┘   └───────────┘
```

### 7.1 指标监控（Metrics）

```yaml
# Prometheus + Micrometer 配置
management:
  metrics:
    export:
      prometheus:
        enabled: true
  endpoints:
    web:
      exposure:
        include: prometheus,health,info
```

### 7.2 链路追踪（Tracing）

```java
// Spring Cloud Sleuth + Zipkin
@Bean
public Sampler defaultSampler() {
    // 采样率：100%（生产环境适当降低）
    return Sampler.ALWAYS_SAMPLE;
}

// 链路信息自动传递
// 每个请求自带 Trace ID，串联整个调用链
// [order-service, trace-id, span-id, parent-span-id]
```

**面试核心要点**：可观测性三支柱（Metrics、Logging、Tracing）缺一不可。

---

## 八、面试小贴士

1. **高可用设计的核心是冗余和自动故障转移** — 没有冗余就没有高可用
2. **限流、熔断、降级**是面试中必须说清楚的三件套，要能说明它们的区别和联系
3. **多活架构**要结合实际场景讨论，不是所有公司都需要三地五中心
4. **混沌工程**是高级话题，可以用来展示你的深度思考
5. 面试中可以说 "我们通过全链路压测发现瓶颈，通过混沌工程验证弹性，通过限流熔断保护系统"