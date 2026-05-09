## 场景题实战（System Design Scenarios）

系统设计面试是高级工程师面试的标配环节。面试官关注的是你的**结构化思维能力**和**技术广度**。本章通过几个经典场景题，带你掌握系统设计的答题框架。

---

## 系统设计面试答题框架（4S 法）

```
Step 1: Scenario（场景分析）
  → 明确功能需求（核心功能 + 扩展功能）
  → 明确非功能需求（QPS、延迟、可用性、一致性）

Step 2: Service（服务划分）
  → 拆分子系统/服务
  → 定义服务间接口

Step 3: Storage（存储设计）
  → 数据模型设计（ER 图）
  → 存储选型（SQL/NoSQL/缓存）

Step 4: Scale（扩展优化）
  → 水平扩展方案
  → 缓存策略
  → 高可用设计
  → 面试加分项（监控、容灾、成本优化）
```

---

## 场景一：秒杀系统设计

### 1.1 需求分析

**功能需求**：
- 定时开抢，大量用户在瞬间涌入
- 展示商品详情、库存数量
- 用户下单扣减库存
- 每个用户限制购买数量
- 防止超卖

**非功能需求**：
- 瞬时 QPS：10万+（开抢瞬间）
- 平均 QPS：1000（平时）
- 库存准确：不能超卖，允许多扣但需退款
- 可用性：秒杀期间核心功能不能宕机

### 1.2 整体架构

```
                         ┌──────────┐
                         │  客户端    │
                         │(浏览器/APP)│
                         └─────┬────┘
                               │
                    ┌──────────▼──────────┐
                    │   CDN（静态资源）    │
                    │  商品详情页静态化    │
                    └────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │   网关层（Nginx）    │
                    │  限流 + 黑白名单    │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
       ┌──────▼──────┐  ┌─────▼──────┐  ┌──────▼──────┐
       │ 用户服务     │  │ 秒杀服务   │  │ 订单服务    │
       │ (登录/鉴权)  │  │ (核心逻辑)  │  │ (生成订单)  │
       └─────────────┘  └─────┬──────┘  └──────┬──────┘
                              │                │
                     ┌────────▼────┐    ┌───────▼───────┐
                     │   Redis     │    │   MySQL       │
                     │ 预减库存    │    │  最终库存同步  │
                     │ 用户限购标记│    │  订单持久化    │
                     └─────────────┘    └───────────────┘
```

### 1.3 核心实现

#### 第1层：前端限流

```html
<!-- 按钮置灰：防止重复点击 -->
<button id="buyBtn" onclick="flashBuy()" disabled>秒杀即将开始</button>

<script>
    // 倒计时逻辑
    var countdown = setInterval(function() {
        var now = new Date().getTime();
        var startTime = new Date("2026-05-09 10:00:00").getTime();
        var diff = startTime - now;

        if (diff <= 0) {
            document.getElementById("buyBtn").disabled = false;
            document.getElementById("buyBtn").innerText = "立即抢购";
            clearInterval(countdown);
        } else {
            var seconds = Math.floor(diff / 1000);
            document.getElementById("buyBtn").innerText = "距开始：" + seconds + "s";
        }
    }, 1000);

    // 防重复点击
    var isSubmitting = false;
    function flashBuy() {
        if (isSubmitting) return;
        isSubmitting = true;
        // 发送请求
        axios.post("/api/seckill/order", { skuId: 1001 })
            .then(function(response) {
                // 处理结果
            })
            .finally(function() {
                setTimeout(function() { isSubmitting = false; }, 3000);
            });
    }
</script>
```

#### 第2层：网关层限流

```nginx
# Nginx 限流配置
http {
    # 定义限流区域：每秒 10000 个请求（按 IP）
    limit_req_zone $binary_remote_addr zone=seckill_limit:10m rate=10000r/s;

    # 定义连接数限制：每个 IP 最多 5 个并发
    limit_conn_zone $binary_remote_addr zone=seckill_conn:10m;

    server {
        location /api/seckill/ {
            limit_req zone=seckill_limit burst=500 nodelay;
            limit_conn seckill_conn 5;
            proxy_pass http://seckill_backend;
        }
    }
}
```

#### 第3层：Redis 预减库存

```java
@Service
public class SeckillService {

    @Autowired
    private StringRedisTemplate redisTemplate;

    // Lua 脚本：预减库存
    private static final String STOCK_SCRIPT =
        "local stock = redis.call('GET', KEYS[1]) " +
        "if not stock or tonumber(stock) <= 0 then " +
        "    return -1 " +                        // 库存不足
        "end " +
        "if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then " +
        "    return -2 " +                        // 已经购买过
        "end " +
        "redis.call('DECR', KEYS[1]) " +
        "redis.call('SADD', KEYS[2], ARGV[1]) " +
        "return 1 ";                              // 成功

    public Result tryAcquire(Long skuId, Long userId) {
        // KEYS[1] = 库存 key, KEYS[2] = 已购用户 set
        // ARGV[1] = 用户 ID
        Long result = redisTemplate.execute(
            new DefaultRedisScript<>(STOCK_SCRIPT, Long.class),
            Arrays.asList("seckill:stock:" + skuId, "seckill:bought:" + skuId),
            String.valueOf(userId)
        );

        if (result == -1) {
            return Result.error("已售罄");
        }
        if (result == -2) {
            return Result.error("您已购买过");
        }

        // 预减成功，发送 MQ 消息进行异步下单
        mqProducer.sendSeckillMessage(skuId, userId);
        return Result.success("抢购成功，正在生成订单");
    }
}
```

#### 第4层：数据库防超卖

```sql
-- 乐观锁更新：CAS（Compare And Set）方式
-- 只有 stock > 0 时才更新，防止超卖
UPDATE seckill_stock
SET stock = stock - 1,
    version = version + 1
WHERE sku_id = ?
  AND stock > 0;

-- 验证更新行数：如果 affected_rows == 0，说明库存不足
```

```java
// MyBatis 实现
@Mapper
public interface SeckillStockMapper {

    @Update("UPDATE seckill_stock SET stock = stock - 1, version = version + 1 " +
            "WHERE sku_id = #{skuId} AND stock > 0")
    int deductStock(Long skuId);

    // 如果返回 0，说明库存不足（没有行被更新）
}
```

#### 异步削峰：MQ 消费

```java
@Component
public class SeckillOrderConsumer {

    @Autowired
    private OrderService orderService;

    // 消费秒杀消息，异步生成订单
    @RabbitListener(queues = "seckill.order.queue")
    public void processSeckillOrder(SeckillMessage message) {
        // 限流消费：每秒最多处理 1000 个
        // 这里使用数据库乐观锁扣减最终库存
        int rows = stockMapper.deductStock(message.getSkuId());
        if (rows > 0) {
            // 扣减成功，生成订单
            orderService.createSeckillOrder(message.getUserId(), message.getSkuId());
        } else {
            // 扣减失败（临界点超卖），给用户退款
            refundService.refund(message.getUserId(), message.getOrderId());
        }
    }
}
```

### 1.4 秒杀系统优化要点

| 优化点 | 方案 | 说明 |
|-------|------|------|
| 页面静态化 | HTML 放 CDN | 减少服务器压力 |
| 接口限流 | Nginx + Sentinel | 拦截大部分无效请求 |
| 预减库存 | Redis 原子操作 | 减少数据库压力 |
| 异步下单 | MQ 削峰填谷 | 平缓流量，避免数据库被打满 |
| 防超卖 | 乐观锁 + 库存校验 | 数据库层面保证库存准确 |
| 防重复 | 唯一索引 + 用户限购 | 防止同一个用户多次购买 |

---

## 场景二：短链接系统设计

### 2.1 需求分析

**功能需求**：
- 长 URL → 短 URL 转换
- 短 URL → 长 URL 重定向
- 支持自定义短链接
- 统计点击量

**非功能需求**：
- 写入 QPS：1万+
- 读取 QPS：10万+（读写比约 1:10）
- 短链接永久有效
- 延迟：重定向 < 50ms

### 2.2 核心算法：发号器方案

```
发号器思路：
1. 使用分布式 ID 生成器（雪花算法/Redis INCR）生成自增 ID
2. 将 ID 转换为 Base62 编码（62位=10数字+26大写+26小写）
3. 用短码作为 Key 存储长 URL

ID → Base62 转换：
0  → 0
1  → 1
...
10 → a
11 → b
...
61 → Z
62 → 10
63 → 11

ID=1000000  → Base62 = "4c92"（仅4位）
理论上 6 位 Base62 可支持 62^6 ≈ 568 亿个 URL
```

```java
// 发号器：Redis INCR 生成唯一 ID
@Component
public class IdGenerator {

    @Autowired
    private StringRedisTemplate redisTemplate;

    private static final String ID_KEY = "short_link:id_gen";

    public long nextId() {
        return redisTemplate.opsForValue().increment(ID_KEY);
    }
}

// Base62 转换
public class Base62Converter {

    private static final String BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    private static final int BASE = 62;

    public static String encode(long value) {
        StringBuilder sb = new StringBuilder();
        while (value > 0) {
            sb.append(BASE62.charAt((int) (value % BASE)));
            value /= BASE;
        }
        return sb.reverse().toString();
    }

    public static long decode(String str) {
        long result = 0;
        for (char c : str.toCharArray()) {
            result = result * BASE + BASE62.indexOf(c);
        }
        return result;
    }

    public static void main(String[] args) {
        System.out.println(encode(1000000));  // 4c92
        System.out.println(encode(56800235583L));  // ZZZZZZ (6位最大)
    }
}
```

### 2.3 存储设计

```sql
-- MySQL 存储映射关系
CREATE TABLE short_url_mapping (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    short_code VARCHAR(10) NOT NULL COMMENT '短码',
    long_url TEXT NOT NULL COMMENT '原始 URL',
    expire_time DATETIME COMMENT '过期时间，NULL=永久',
    click_count BIGINT DEFAULT 0 COMMENT '点击次数',
    create_time DATETIME NOT NULL,
    update_time DATETIME NOT NULL,
    UNIQUE KEY uk_short_code (short_code),
    KEY idx_create_time (create_time)
);

-- 缓存热点短链接（Redis）
-- Key: short:link:{shortCode}  Value: longUrl
-- TTL: 7 天（LRU 淘汰，热点数据自动保留）
```

### 2.4 核心服务实现

```java
@RestController
public class ShortLinkController {

    @Autowired
    private ShortLinkService shortLinkService;

    // 创建短链接
    @PostMapping("/api/shorten")
    public Result<String> shorten(@RequestParam String longUrl) {
        String shortCode = shortLinkService.createShortCode(longUrl);
        return Result.success("http://s.abc.cn/" + shortCode);
    }

    // 重定向（核心接口，QPS 高）
    @GetMapping("/{shortCode}")
    public void redirect(@PathVariable String shortCode, HttpServletResponse response) {
        String longUrl = shortLinkService.getLongUrl(shortCode);
        if (longUrl == null) {
            response.setStatus(404);
            return;
        }
        // 301 永久重定向（浏览器缓存，下次不请求服务器）
        // 302 临时重定向（每次都要请求服务器，可做统计）
        response.setStatus(301);
        response.setHeader("Location", longUrl);
    }
}

@Service
public class ShortLinkService {

    @Autowired
    private IdGenerator idGenerator;
    @Autowired
    private StringRedisTemplate redisTemplate;
    @Autowired
    private ShortUrlMapper urlMapper;

    public String createShortCode(String longUrl) {
        long id = idGenerator.nextId();
        String shortCode = Base62Converter.encode(id);

        // 存储映射关系
        ShortUrlMapping mapping = new ShortUrlMapping();
        mapping.setShortCode(shortCode);
        mapping.setLongUrl(longUrl);
        mapping.setCreateTime(new Date());
        urlMapper.insert(mapping);

        // 写入缓存
        redisTemplate.opsForValue().set(
            "short:link:" + shortCode, longUrl, 7, TimeUnit.DAYS);

        return shortCode;
    }

    public String getLongUrl(String shortCode) {
        // 1. 先从缓存查
        String longUrl = redisTemplate.opsForValue().get("short:link:" + shortCode);
        if (longUrl != null) {
            return longUrl;
        }

        // 2. 缓存 Miss，查数据库
        ShortUrlMapping mapping = urlMapper.selectByShortCode(shortCode);
        if (mapping == null) {
            return null;
        }

        // 3. 回写缓存
        redisTemplate.opsForValue().set(
            "short:link:" + shortCode, mapping.getLongUrl(), 7, TimeUnit.DAYS);

        return mapping.getLongUrl();
    }
}
```

### 2.5 301 vs 302 重定向

| 类型 | 含义 | 特点 |
|------|------|------|
| **301** | 永久重定向 | 浏览器会缓存结果，下次直接跳转，服务器压力小 |
| **302** | 临时重定向 | 每次请求都到服务器，可以做点击统计 |

**权衡**：业务需求不同选择不同
- 纯短链接服务（不需要统计）→ 301
- 需要点击统计、安全拦截 → 302

---

## 场景三：即时通讯（IM）系统

### 3.1 需求分析

**功能需求**：
- 一对一聊天（私聊）
- 群组聊天（群聊）
- 消息状态（已发送、已送达、已读）
- 离线消息
- 历史消息查询

**非功能需求**：
- DAU：1000万
- 同时在线：100万
- 消息延迟：< 100ms
- 消息可靠性：不丢消息，不重复

### 3.2 推拉模式选择

```
推模式（Push）：
  ┌──────┐   发送消息    ┌──────┐
  │ 用户A │─────────────→│ 用户B │ 在线时直接推送
  └──────┘              └──────┘
  优点：实时性高，延迟低
  缺点：用户离线时无法推送

拉模式（Pull）：
  ┌──────┐  存消息   ┌──────────┐ 拉取  ┌──────┐
  │ 用户A │─────────→│  服务端  │←─────│ 用户B │
  └──────┘          │  存储    │      └──────┘
                    └──────────┘
  优点：离线用户上线后可拉取
  缺点：轮询性能差，延迟高

推拉结合（推荐方案）：
  在线 → 推送（Push）
  离线 → 存储（存储到 DB/Redis）
  上线 → 拉取离线消息（Pull）
```

### 3.3 WebSocket 集群架构

```
                        ┌──────────────────┐
                        │  连接管理服务      │
                        │  (Redis Pub/Sub)  │
                        └────────┬─────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
    ┌───▼───┐              ┌───▼───┐              ┌───▼───┐
    │WS Node│              │WS Node│              │WS Node│
    │  ├用户A│              │  ├用户B│              │  ├用户C│
    │  ├用户D│              │  ├用户E│              │  ├用户F│
    └───────┘              └───────┘              └───────┘
        │                        │                        │
        └────────────────────────┼────────────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │    消息存储（MySQL/ES）   │
                    │    离线消息（Redis）      │
                    └─────────────────────────┘
```

### 3.4 WebSocket 实现

```java
// WebSocket 配置（Spring Boot）
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(chatHandler(), "/ws/chat")
                .setAllowedOrigins("*")
                .addInterceptors(new ChatHandshakeInterceptor());
    }

    @Bean
    public WebSocketHandler chatHandler() {
        return new ChatWebSocketHandler();
    }
}

// WebSocket 处理器
@Component
public class ChatWebSocketHandler extends TextWebSocketHandler {

    // 在线用户管理：userId → WebSocketSession
    private static final ConcurrentHashMap<Long, WebSocketSession> ONLINE_USERS = new ConcurrentHashMap<>();

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        Long userId = (Long) session.getAttributes().get("userId");
        ONLINE_USERS.put(userId, session);

        // 推送离线消息
        List<String> offlineMessages = redisTemplate.opsForList().range(
            "offline:msg:" + userId, 0, -1);
        for (String msg : offlineMessages) {
            session.sendMessage(new TextMessage(msg));
        }
        redisTemplate.delete("offline:msg:" + userId);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        ChatMessage chatMessage = JSON.parseObject(message.getPayload(), ChatMessage.class);

        if (chatMessage.getType() == MessageType.SINGLE) {
            // 私聊
            handleSingleChat(chatMessage);
        } else {
            // 群聊
            handleGroupChat(chatMessage);
        }
    }

    private void handleSingleChat(ChatMessage message) {
        Long receiverId = message.getReceiverId();
        WebSocketSession receiverSession = ONLINE_USERS.get(receiverId);

        if (receiverSession != null && receiverSession.isOpen()) {
            // 在线：直接推送
            receiverSession.sendMessage(new TextMessage(JSON.toJSONString(message)));
        } else {
            // 离线：存储到离线消息队列
            redisTemplate.opsForList().rightPush(
                "offline:msg:" + receiverId, JSON.toJSONString(message));
            // 设置过期时间（保留 7 天）
            redisTemplate.expire("offline:msg:" + receiverId, 7, TimeUnit.DAYS);
        }

        // 持久化消息
        saveMessage(message);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Long userId = (Long) session.getAttributes().get("userId");
        ONLINE_USERS.remove(userId);
    }
}

// 消息体
@Data
public class ChatMessage {
    private Long id;
    private Long senderId;
    private Long receiverId;
    private Long groupId;
    private MessageType type;     // SINGLE / GROUP
    private String content;
    private Long timestamp;
}

enum MessageType {
    SINGLE, GROUP
}
```

### 3.5 群聊消息扩散方式

```
写扩散（推模式）：
  发送者写入自己的时间线
  系统推送给所有群成员（群人数少时适用）

读扩散（拉模式）：
  发送者写入群组时间线
  每个成员拉取自己最后读取时间之后的增量
  群人数多（1000+）时用读扩散

优化方案：大群用读扩散，小群用写扩散
{
    "write_mode": "PUSH",    // 小群推
    "read_mode": "PULL"      // 大群拉
}
```

---

## 场景四：海量数据 TopK 问题

### 4.1 问题描述

在一个 100GB 的日志文件中，找出访问次数最多的 100 个 URL。单机内存只有 4GB。

### 4.2 分治策略

```
Step 1: 哈希分片
  大文件 (100GB)
        │
        │ hash(url) % 1000
        ▼
  ┌──┬──┬──┬──┬──┬──┬──┬──┐
  │0 │1 │2 │...│    │998│999│
  └──┴──┴──┴──┴──┴──┴──┴──┘
  1000 个小文件，每个约 100MB
  相同 URL 一定进入同一文件

Step 2: 每个文件分别统计
  小文件 → HashMap<String, Integer> 统计频率
         → 小顶堆(MinHeap) 取 Top 100

Step 3: 多路归并
  合并 1000 个 Top 100 列表
  最终取全局 Top 100
```

### 4.3 代码实现

```java
// Step 1: 哈希分片
public class HashPartitioner {

    public void partition(String inputFile, int numShards) throws IOException {
        BufferedWriter[] writers = new BufferedWriter[numShards];
        for (int i = 0; i < numShards; i++) {
            writers[i] = new BufferedWriter(new FileWriter("shard_" + i + ".txt"));
        }

        try (BufferedReader reader = new BufferedReader(new FileReader(inputFile))) {
            String line;
            while ((line = reader.readLine()) != null) {
                int shard = Math.abs(line.hashCode() % numShards);
                writers[shard].write(line);
                writers[shard].newLine();
            }
        }

        for (BufferedWriter writer : writers) {
            writer.close();
        }
    }
}

// Step 2: 单文件 TopK 统计
public class TopKCounter {

    public List<Map.Entry<String, Integer>> getTopK(String filePath, int k) throws IOException {
        // 1. HashMap 统计频率
        Map<String, Integer> frequency = new HashMap<>();
        try (BufferedReader reader = new BufferedReader(new FileReader(filePath))) {
            String line;
            while ((line = reader.readLine()) != null) {
                frequency.merge(line, 1, Integer::sum);
            }
        }

        // 2. 小顶堆取 Top K
        PriorityQueue<Map.Entry<String, Integer>> minHeap = new PriorityQueue<>(
            (a, b) -> a.getValue() - b.getValue()
        );

        for (Map.Entry<String, Integer> entry : frequency.entrySet()) {
            if (minHeap.size() < k) {
                minHeap.offer(entry);
            } else if (entry.getValue() > minHeap.peek().getValue()) {
                minHeap.poll();
                minHeap.offer(entry);
            }
        }

        // 3. 按频率从高到低排序
        List<Map.Entry<String, Integer>> result = new ArrayList<>(minHeap);
        result.sort((a, b) -> b.getValue() - a.getValue());
        return result;
    }
}

// Step 3: 多路归并（全局 TopK）
public class MergeTopK {

    public List<Map.Entry<String, Integer>> mergeTopK(List<List<Map.Entry<String, Integer>>> shardResults, int k) {
        // 所有 URL 汇总
        Map<String, Integer> global = new HashMap<>();
        for (List<Map.Entry<String, Integer>> shard : shardResults) {
            for (Map.Entry<String, Integer> entry : shard) {
                global.merge(entry.getKey(), entry.getValue(), Integer::sum);
            }
        }

        // 小顶堆取全局 Top K
        PriorityQueue<Map.Entry<String, Integer>> minHeap = new PriorityQueue<>(
            (a, b) -> a.getValue() - b.getValue()
        );

        for (Map.Entry<String, Integer> entry : global.entrySet()) {
            if (minHeap.size() < k) {
                minHeap.offer(entry);
            } else if (entry.getValue() > minHeap.peek().getValue()) {
                minHeap.poll();
                minHeap.offer(entry);
            }
        }

        List<Map.Entry<String, Integer>> result = new ArrayList<>(minHeap);
        result.sort((a, b) -> b.getValue() - a.getValue());
        return result;
    }
}
```

### 4.4 实时 TopK（滑动窗口）

```java
// 基于 Redis ZSet 的实时 TopK
@Component
public class RealtimeTopK {

    @Autowired
    private StringRedisTemplate redisTemplate;

    private static final String ZSET_KEY = "realtime:hot:urls";

    // 记录一次访问
    public void recordAccess(String url) {
        redisTemplate.opsForZSet().incrementScore(ZSET_KEY, url, 1);
        // 设置过期时间，实现滑动窗口（1小时热点）
        redisTemplate.expire(ZSET_KEY, 1, TimeUnit.HOURS);
    }

    // 获取 Top K
    public List<String> getTopK(int k) {
        // 按分数从高到低取 k 个
        Set<ZSetOperations.TypedTuple<String>> topK = redisTemplate.opsForZSet()
            .reverseRangeWithScores(ZSET_KEY, 0, k - 1);

        return topK.stream()
            .map(tuple -> tuple.getValue() + " (" + tuple.getScore().intValue() + "次)")
            .collect(Collectors.toList());
    }
}
```

---

## 场景五：设计一个短延迟的定时任务调度器

### 需求
- 支持百万级延迟任务
- 时间精度：秒级
- 支持任务取消
- 适用于订单超时取消、优惠券过期等场景

### 时间轮（Time Wheel）算法

```
时间轮原理（类比钟表）：

                        刻度槽（每个槽存一组任务）
                        0   1   2   3  ...  59
                       ┌──┬──┬──┬──┬──┬──┬──┐
                       │  │  │  │  │  │  │  │  ← 指针每秒移动一格
                       └──┴──┴──┴──┴──┴──┴──┘
                         │
                   任务链表（同一时刻的任务）

  分层时间轮（多层时钟）：
    秒级：60 格 × 1s = 1 分钟
    分钟级：60 格 × 1m = 1 小时
    小时级：24 格 × 1h = 1 天
```

```java
// 简单时间轮实现
public class TimeWheel {

    private final int tickDuration;         // 每格时间跨度（秒）
    private final int wheelSize;           // 格子数量
    private final AtomicInteger currentTick = new AtomicInteger(0);  // 当前指针

    // 每个格子的任务队列
    private final List<Queue<TimerTask>> slots;

    public TimeWheel(int tickDuration, int wheelSize) {
        this.tickDuration = tickDuration;
        this.wheelSize = wheelSize;
        this.slots = new ArrayList<>(wheelSize);
        for (int i = 0; i < wheelSize; i++) {
            slots.add(new ConcurrentLinkedQueue<>());
        }

        // 启动指针移动线程
        startTickThread();
    }

    // 添加任务
    public void addTask(TimerTask task, long delaySeconds) {
        int ticks = (int) (delaySeconds / tickDuration);
        int targetSlot = (currentTick.get() + ticks) % wheelSize;
        task.setRemainingCycles(ticks / wheelSize);  // 跨圈数
        slots.get(targetSlot).offer(task);
    }

    // 指针移动（每秒调用一次）
    private void tick() {
        int slot = currentTick.getAndUpdate(i -> (i + 1) % wheelSize);
        Queue<TimerTask> tasks = slots.get(slot);

        for (TimerTask task : tasks) {
            if (task.getRemainingCycles() > 0) {
                // 跨圈任务，减少圈数
                task.decrementCycles();
            } else {
                // 时间到，执行任务
                task.execute();
                tasks.remove(task);
            }
        }
    }

    private void startTickThread() {
        ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleAtFixedRate(this::tick, 0, tickDuration, TimeUnit.SECONDS);
    }
}
```

**常见的定时任务方案对比**：

| 方案 | 精度 | 适用规模 | 复杂度 |
|------|------|---------|-------|
| ScheduledExecutorService | 毫秒级 | 万级 | 低 |
| Quartz | 秒级 | 万级 | 中 |
| 时间轮（Netty HashedWheelTimer） | 毫秒级 | 百万级 | 中 |
| Redis ZSet（到期时间做 Score） | 秒级 | 千万级 | 低 |
| MQ 延迟消息（RocketMQ） | 秒级 | 亿级 | 低 |

---

## 六、面试小贴士

1. **4S 答题框架**一定要熟练：Scenario → Service → Storage → Scale
2. **先说大逻辑，再说小细节**：先画出架构图（在面试中用手绘），再逐层深入
3. **QPS 估算能力很重要**：
   - 秒杀 10W QPS → 必须用 Redis + MQ
   - IM 100W 在线 → 必须用 WebSocket 集群 + 离线存储
   - 短链接 1W QPS → 可以用 MySQL + Redis 缓存
4. **Trade-off（权衡）是亮点**：不要只说"用 XX 方案"，要说为什么选这个方案，优缺点是什么
5. **常用数据随口说**：Redis 单机 QPS ≈ 10万，MySQL 单表 ≈ 5000 QPS，MQ 吞吐 ≈ 10万/s
6. **灾难恢复要对答如流**：面试官总会问"如果 Redis 挂了怎么办？""如果 MQ 挂了怎么办？"