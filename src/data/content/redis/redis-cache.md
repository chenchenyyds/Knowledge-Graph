## 缓存穿透/击穿/雪崩与缓存一致性

### 概述

缓存是 Redis 最常见的应用场景。在实际系统中，缓存层位于应用层和数据库层之间，用来加速热点数据的访问。然而，缓存引入后也带来了三个经典问题——**缓存穿透、缓存击穿、缓存雪崩**，以及一个更长期的挑战——**缓存与数据库的一致性**。

这三个问题几乎是每场面试必问的题目。更重要的是，它们在实际生产中十分常见，处理不当会导致数据库被压垮，甚至引发生产事故。

---

### 缓存穿透（Cache Penetration）

#### 现象

缓存穿透指查询 **数据库中也不存在的数据**。由于缓存中没有，请求直接穿透到数据库，而数据库也返回空，缓存也就不会被写入。结果每次请求都打到数据库上。

```bash
# 缓存穿透示例
# 假设数据库中没有 id = -1 的用户

# Request 1: 查 id = -1
GET user:-1          → 缓存 MISS
SELECT * FROM user WHERE id = -1  → 数据库也查不到（无结果）
# 不写入缓存（因为没有数据可缓存）

# Request 2: 再次查 id = -1
GET user:-1          → 缓存 MISS
SELECT * FROM user WHERE id = -1  → 数据库查不到
# 这次仍然穿透到数据库！

# 如果恶意攻击者用不存在的 ID 大量请求，数据库会瞬间被压垮
```

#### 解决方案一：缓存空对象

```java
// 缓存空对象方案
public User getUser(String id) {
    // 1. 查缓存
    String cacheKey = "user:" + id;
    String cached = jedis.get(cacheKey);

    if (cached != null) {
        // 缓存命中
        if ("NULL_VALUE".equals(cached)) {
            return null; // 空对象标记，直接返回 null
        }
        return JSON.parseObject(cached, User.class);
    }

    // 2. 缓存未命中，查数据库
    User user = userMapper.selectById(id);

    // 3. 回填缓存
    if (user == null) {
        // 数据库也没有 → 缓存空对象，设置短过期时间（30-60 秒）
        jedis.setex(cacheKey, 30, "NULL_VALUE");
    } else {
        // 有数据，正常缓存
        jedis.setex(cacheKey, 3600, JSON.toJSONString(user));
    }

    return user;
}
```

**优缺点：**

| 优点 | 缺点 |
|------|------|
| 实现简单，容易理解 | 占用内存：空对象也会占用缓存空间 |
| 对现有代码改动小 | 数据不一致：数据库插入真实数据后，缓存仍是空对象 |

---

#### 解决方案二：布隆过滤器（Bloom Filter）

布隆过滤器是一种 **概率型数据结构**，可以非常高效地判断一个元素 **是否不在集合中**。

```
  布隆过滤器原理图

  初始化：m = 18 位的位数组（全部为 0）

  位数组: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]

  添加元素 "user:1001"（使用 k=3 个 hash 函数）：

  hash1("user:1001") % 18 = 3   → 位数组[3] = 1
  hash2("user:1001") % 18 = 7   → 位数组[7] = 1
  hash3("user:1001") % 18 = 12  → 位数组[12] = 1

  位数组: [0,0,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,0]

  添加元素 "user:1002"：

  hash1("user:1002") % 18 = 7   → 位数组[7] = 1（已为 1）
  hash2("user:1002") % 18 = 14  → 位数组[14] = 1
  hash3("user:1002") % 18 = 3   → 位数组[3] = 1（已为 1）

  位数组: [0,0,0,1,0,0,0,1,0,0,0,0,1,0,1,0,0,0]

  判断元素 "user:9999" 是否存在：

  hash1("user:9999") % 18 = 3   → 位数组[3] = 1 ✓
  hash2("user:9999") % 18 = 9   → 位数组[9] = 0 ✗ → 一定不存在！

  判断元素 "user:1001" 是否存在：
  hash1("user:1001") % 18 = 3   → 位数组[3] = 1 ✓
  hash2("user:1001") % 18 = 7   → 位数组[7] = 1 ✓
  hash3("user:1001") % 18 = 12  → 位数组[12] = 1 ✓ → 可能存在！
```

**重要特性：**
- **判断不存在** → 100% 准确（不存在就是不存在）
- **判断存在** → 有可能误判（"可能存在"不等于"一定存在"）
- **不能删除元素**（因为多个 hash 可能映射到同一个位，无法判断是哪个元素设置的）
- **空间效率极高**：1 亿个元素，0.1% 误判率，只需要约 17MB 内存

```java
// Java 中使用布隆过滤器（Guava 实现）
import com.google.common.hash.BloomFilter;
import com.google.common.hash.Funnels;
import java.nio.charset.Charset;

public class BloomFilterExample {
    // 预计插入 100 万条数据，误判率 1%
    private static BloomFilter<String> bloomFilter =
        BloomFilter.create(
            Funnels.stringFunnel(Charset.defaultCharset()),
            1_000_000,    // 预计数据量
            0.01          // 期望误判率
        );

    static {
        // 预热：将所有存在的用户 ID 加入布隆过滤器
        List<Long> allUserIds = userMapper.selectAllIds();
        for (Long userId : allUserIds) {
            bloomFilter.put("user:" + userId);
        }
    }

    public User getUserWithBloom(String userId) {
        String key = "user:" + userId;

        // 1. 布隆过滤器判断（O(k) 时间，k 是 hash 函数个数）
        if (!bloomFilter.mightContain(key)) {
            // 一定不存在，直接返回
            return null;
        }

        // 2. 查缓存
        String cached = jedis.get(key);
        if (cached != null) {
            return JSON.parseObject(cached, User.class);
        }

        // 3. 查数据库
        User user = userMapper.selectById(userId);
        if (user != null) {
            jedis.setex(key, 3600, JSON.toJSONString(user));
        }
        return user;
    }
}
```

**布隆过滤器在 Redis 中的实现（RedisBloom 模块）：**

```bash
# 需要加载 RedisBloom 模块
# redis-server --loadmodule /path/to/redisbloom.so

# 创建布隆过滤器：BF.RESERVE {key} {error_rate} {capacity}
127.0.0.1:6379> BF.RESERVE user_filter 0.01 1000000
OK

# 添加元素
127.0.0.1:6379> BF.ADD user_filter user:1001
(integer) 1
127.0.0.1:6379> BF.MADD user_filter user:1002 user:1003
1) (integer) 1
2) (integer) 1

# 判断是否存在
127.0.0.1:6379> BF.EXISTS user_filter user:1001
(integer) 1   # 可能存在
127.0.0.1:6379> BF.EXISTS user_filter user:9999
(integer) 0   # 一定不存在

# 批量判断
127.0.0.1:6379> BF.MEXISTS user_filter user:1001 user:9999
1) (integer) 1
2) (integer) 0
```

---

### 缓存击穿（Cache Breakdown）

#### 现象

缓存击穿指 **某个热点 key 在过期的一瞬间**，大量并发请求同时涌入，所有请求都打到数据库上。

不同于穿透（查不存在的数据），击穿是 **热点数据刚好过期** 导致的。

```
  缓存击穿时序图

  时间轴 →
  ────────────────────────────────────────────────────

  T1: 热点 key "hot_product" 存在缓存中
      所有请求都从缓存读取，数据库无压力

  T2: key 过期了！
      ┌──────────────────────────────────────┐
      │ Request 1 → 缓存 MISS → 查数据库      │
      │ Request 2 → 缓存 MISS → 查数据库      │
      │ Request 3 → 缓存 MISS → 查数据库      │
      │ ... 同一时间 N 个请求全到数据库 ...   │
      │ 数据库连接数瞬间飙升，响应变慢            │
      └──────────────────────────────────────┘

  T3: 某个请求回填缓存成功
      后续请求恢复正常
```

#### 解决方案一：互斥锁

只让一个线程去加载数据，其他线程等待。

```java
// 互斥锁解决缓存击穿
public Product getProduct(String productId) {
    String cacheKey = "product:" + productId;
    String lockKey = "lock:product:" + productId;

    // 1. 先查缓存
    String cached = jedis.get(cacheKey);
    if (cached != null) {
        return JSON.parseObject(cached, Product.class);
    }

    // 2. 缓存未命中，尝试获取分布式锁
    // SET NX（key 不存在才设置）+ EX（过期时间）
    String requestId = UUID.randomUUID().toString();
    String result = jedis.set(lockKey, requestId, SetParams.setParams().nx().ex(10));

    if ("OK".equals(result)) {
        // 3. 获取锁成功 — 查数据库
        Product product = productMapper.selectById(productId);

        // 4. 回填缓存
        if (product != null) {
            jedis.setex(cacheKey, 3600, JSON.toJSONString(product));
        } else {
            jedis.setex(cacheKey, 60, "NULL_VALUE"); // 空对象兜底
        }

        // 5. 释放锁（Lua 保证原子性）
        String luaScript =
            "if redis.call('get', KEYS[1]) == ARGV[1] then " +
            "   return redis.call('del', KEYS[1]) " +
            "else " +
            "   return 0 " +
            "end";
        jedis.eval(luaScript, Collections.singletonList(lockKey),
                   Collections.singletonList(requestId));

        return product;
    } else {
        // 6. 获取锁失败 — 其他线程正在加载，等待重试
        try {
            Thread.sleep(100);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return getProduct(productId); // 递归重试
    }
}
```

**注意事项：** 这种方案适合 **并发量极大** 的场景，但需要处理好以下问题：
- 锁的过期时间 > 数据库查询时间（防止锁提前释放）
- 递归重试可能导致 StackOverflow（建议改用 while 循环）

#### 解决方案二：逻辑过期

不给 key 设 TTL，而是在 value 中嵌入过期时间，由后台线程异步刷新。

```java
// 逻辑过期方案
public class ProductCache {
    private static final ExecutorService refreshPool =
        Executors.newFixedThreadPool(10);

    // 缓存数据结构：实际数据 + 逻辑过期时间
    static class CacheItem<T> {
        T data;
        long expireTime; // 逻辑过期时间戳
    }

    public Product getProduct(String productId) {
        String cacheKey = "product:" + productId;

        // 1. 查缓存
        String json = jedis.get(cacheKey);
        if (json == null) {
            // 缓存完全不存在（可能是第一次访问）
            return loadFromDB(productId);
        }

        CacheItem<Product> cacheItem =
            JSON.parseObject(json, new TypeReference<CacheItem<Product>>() {});

        // 2. 检查逻辑是否过期
        if (cacheItem.expireTime > System.currentTimeMillis()) {
            // 未过期，直接返回
            return cacheItem.data;
        }

        // 3. 逻辑过期 — 异步刷新
        refreshPool.submit(() -> {
            // 获取分布式锁，避免重复刷新
            String lockKey = "lock:refresh:" + productId;
            if (tryLock(lockKey)) {
                try {
                    Product fresh = productMapper.selectById(productId);
                    CacheItem<Product> item = new CacheItem<>();
                    item.data = fresh;
                    item.expireTime = System.currentTimeMillis() + 3600_000;
                    jedis.setex(cacheKey, 7200, JSON.toJSONString(item));
                } finally {
                    unlock(lockKey);
                }
            }
        });

        // 4. 返回旧数据（虽然逻辑过期，但总比没有好）
        return cacheItem.data;
    }
}
```

#### 解决方案三：永不过期

对于真正的热点数据，采取"永不过期"策略：

```java
// 热点 Key 永不过期
public class HotKeyManager {
    // 热点 key 列表（配置中心管理）
    private static final Set<String> HOT_KEYS = Set.of(
        "product:1001", "product:1002", "config:global"
    );

    public String get(String key) {
        String value = jedis.get(key);
        if (value == null) {
            // 即使过期了，也不从数据库加载
            // 而是由后台定时任务主动刷新
            return null;
        }
        return value;
    }

    // 后台定时刷新任务
    @Scheduled(fixedDelay = 60_000) // 每分钟执行
    public void refreshHotKeys() {
        for (String key : HOT_KEYS) {
            try {
                String productId = key.replace("product:", "");
                Product product = productMapper.selectById(productId);
                jedis.set(key, JSON.toJSONString(product));
                log.info("刷新热点 key: {}", key);
            } catch (Exception e) {
                log.error("刷新热点 key 失败: {}", key, e);
            }
        }
    }
}
```

---

### 缓存雪崩（Cache Avalanche）

#### 现象

缓存雪崩指 **大量缓存同时过期**，或者 **缓存节点宕机**，导致大量请求全部打到数据库，造成数据库压力陡增甚至崩溃。

```
  缓存雪崩时序图

  情况一：大量 key 在同一时间过期

  ┌──────────────┐
  │  所有 key TTL │
  │  同时设为 3600│
  └──────┬───────┘
         │ 同时过期！
         ▼
  ┌─────────────────────────────────────────┐
  │  12:00:00  →  100 个 key 同时过期       │
  │  12:00:01  →  所有请求 MISS              │
  │  12:00:02  →  全部打到数据库             │
  │  12:00:03  →  数据库连接池耗尽            │
  │  12:00:04  →  数据库宕机                 │
  └─────────────────────────────────────────┘

  情况二：Redis 节点宕机

  ┌─────────────────────────────────────────┐
  │  12:00:00  →  Redis 节点宕机             │
  │  12:00:01  →  所有缓存查询失败           │
  │  12:00:02  →  请求全部穿透到数据库        │
  │  12:00:03  →  数据库被打垮               │
  └─────────────────────────────────────────┘
```

#### 解决方案一：过期时间加随机值

这是最简单也最有效的预防措施：

```java
// 设置过期时间时加入随机值
public void setCache(String key, String value, int baseTTL) {
    // 基础过期时间上增加 0-600 秒的随机偏移
    int random = ThreadLocalRandom.current().nextInt(600);
    jedis.setex(key, baseTTL + random, value);
}

// 批量设置时各自有不同偏移
public void batchCache(Map<String, String> data, int baseTTL) {
    Pipeline pipeline = jedis.pipelined();
    for (Map.Entry<String, String> entry : data.entrySet()) {
        int random = ThreadLocalRandom.current().nextInt(600);
        pipeline.setex(entry.getKey(), baseTTL + random, entry.getValue());
    }
    pipeline.sync();
}
```

```bash
# 不使用随机值：所有 key 同时过期
SETEX user:1001 3600 "data"
SETEX user:1002 3600 "data"
SETEX user:1003 3600 "data"

# 使用随机值：过期时间分散
SETEX user:1001 3723 "data"    # 3600 + 123
SETEX user:1002 3591 "data"    # 3600 + -9 → 3591
SETEX user:1003 3815 "data"    # 3600 + 215
# 每个 key 的过期时间错开，不会同时过期
```

#### 解决方案二：多级缓存

```
  多级缓存架构

  ┌──────────────┐
  │   客户端     │
  └──────┬───────┘
         │
         ▼
  ┌──────────────┐  命中直接返回（最快）
  │  本地缓存    │  Caffeine/Guava Cache
  │  (L1 Cache)  │  容量小，进程级
  └──────┬───────┘
         │ L1 MISS
         ▼
  ┌──────────────┐  命中直接返回（较快）
  │  Redis 缓存  │  分布式缓存
  │  (L2 Cache)  │  容量大，集群级
  └──────┬───────┘
         │ L2 MISS
         ▼
  ┌──────────────┐  最慢，兜底
  │  数据库      │  持久化存储
  │  (DB)        │
  └──────────────┘
```

```java
// 多级缓存实现（Caffeine + Redis）
public class MultiLevelCache {
    // L1: 本地缓存（Caffeine）
    private final Cache<String, String> localCache = Caffeine.newBuilder()
        .maximumSize(10_000)          // 最多缓存 1 万个 key
        .expireAfterWrite(5, TimeUnit.MINUTES)  // 5 分钟过期
        .build();

    // L2: Redis 缓存
    private final JedisPool jedisPool;

    public String get(String key) {
        // 1. 查本地缓存
        String value = localCache.getIfPresent(key);
        if (value != null) {
            return value;
        }

        // 2. 查 Redis
        try (Jedis jedis = jedisPool.getResource()) {
            value = jedis.get(key);
            if (value != null) {
                // 回填本地缓存
                localCache.put(key, value);
                return value;
            }
        }

        // 3. 查数据库
        value = loadFromDB(key);
        if (value != null) {
            // 回填 Redis + 本地缓存
            try (Jedis jedis = jedisPool.getResource()) {
                jedis.setex(key, 3600, value);
            }
            localCache.put(key, value);
        }
        return value;
    }
}
```

**优势**：即使 Redis 全部宕机，本地缓存还能扛住大部分读请求，数据库压力可控。

#### 解决方案三：限流降级

```java
// 限流降级：数据库压力过大时，直接降级返回兜底数据
public class CacheDegradation {
    // Guava RateLimiter：每秒最多 1000 个数据库查询
    private final RateLimiter dbRateLimiter = RateLimiter.create(1000);

    public String get(String key) {
        // 1. 查缓存
        String cached = jedis.get(key);
        if (cached != null) {
            return cached;
        }

        // 2. 限流：是否可以查数据库
        if (dbRateLimiter.tryAcquire()) {
            // 可以通过 → 查数据库
            String value = loadFromDB(key);
            if (value != null) {
                jedis.setex(key, 3600, value);
            }
            return value;
        } else {
            // 限流了 → 返回兜底数据
            return getStaleData(key); // 可能是旧缓存或默认值
        }
    }

    private String getStaleData(String key) {
        // 返回过期的缓存数据（有比没有好）
        // 或者返回一个默认值
        return jedis.get(key); // 即使过期也能读到
    }
}
```

---

### 缓存一致性

#### 问题本质

数据库和缓存是两个独立的存储系统，对数据库的写操作无法原子性地同步到缓存。因此出现了 **缓存与数据库数据不一致** 的问题。

```
  不一致问题示例：

  线程 A: 写 DB (SET name = "Alice")
  线程 B: 写 DB (SET name = "Bob")
  线程 B: 删除缓存 (DEL name)
  线程 A: 删除缓存 (DEL name)
  → 缓存被删除，下次读到的是 Bob（正确）

  但是：

  线程 A: 写 DB (SET name = "Alice")
  线程 B: 写 DB (SET name = "Bob")
  线程 B: 删除缓存 (DEL name)
  线程 A: 更新缓存 (SET name = "Alice")  ← 旧数据！
  → 缓存中存的是 "Alice"，数据库中是 "Bob"（不一致！）
```

#### 方案一：Cache Aside（旁路缓存模式）

这是最常用的模式，核心原则：

```
  读操作：
  ① 先读缓存，命中直接返回
  ② MISS 则读数据库
  ③ 将数据库结果写入缓存
  ④ 返回

  写操作：
  ① 先更新数据库
  ② 再删除缓存（不是更新缓存！）
```

**为什么写操作要删除缓存而不是更新缓存？**

```
  原因一：懒加载
  删除缓存 → 下次读取时自然回填
  更新缓存可能做了无用功（可能这个 key 不再被访问）

  原因二：并发写冲突
  线程 A: 写 DB (SET name = "A")
  线程 B: 写 DB (SET name = "B")
  线程 B: 更新缓存 (SET name = "B")
  线程 A: 更新缓存 (SET name = "A")  ← 旧值覆盖新值！

  如果改成"删除缓存"：
  线程 A: 写 DB (SET name = "A")
  线程 B: 写 DB (SET name = "B")
  线程 B: 删除缓存 (DEL name)
  线程 A: 删除缓存 (DEL name)
  → 缓存被清空，下次读时拿到最新的 "B"
```

#### 方案二：延迟双删

```java
// 延迟双删策略
public void updateUser(User user) {
    String cacheKey = "user:" + user.getId();

    // 第一步：删除缓存
    jedis.del(cacheKey);

    // 第二步：更新数据库
    userMapper.updateById(user);

    // 第三步：延迟 500ms 再次删除缓存
    // 目的是删除在第一步之后、第二步之前可能回填的脏数据
    executorService.schedule(() -> {
        jedis.del(cacheKey);
    }, 500, TimeUnit.MILLISECONDS);
}
```

```
  延迟双删为何能保证一致性：

  时间线：
  ┌─────────────────────────────────────────────────────┐
  │  ① 线程 A: 删除缓存 (DEL key)                        │
  │  ② 线程 B: 读 MISS → 从 DB 读取旧数据                 │
  │  ③ 线程 A: 更新 DB (写新值)                           │
  │  ④ 线程 B: 设置缓存 (SET key = 旧数据 ← 脏数据)      │
  │  ⑤ 延迟 500ms: 删除缓存 (DEL key)  ← 清除脏数据      │
  │  ⑥ 后续请求: 读 MISS → 从 DB 读取新值 → 缓存新值     │
  └─────────────────────────────────────────────────────┘
```

#### 方案三：订阅 binlog 实现最终一致性

```
  基于 Canal 的缓存一致性方案

                           ┌──────────────┐
                           │   业务应用    │
                           └──────┬───────┘
                                  │ 写操作
                                  ▼
  ┌──────────────┐        ┌──────────────┐
  │   缓存       │        │   数据库      │
  │   (Redis)    │        │   (MySQL)    │
  └──────┬───────┘        └──────┬───────┘
         │                       │
         │  DELETE               │ binlog
         │                       │
         │                ┌──────┴───────┐
         │                │   Canal      │
         │                │ (binlog 订阅) │
         │                └──────┬───────┘
         │                       │
         └──────────┬────────────┘
                    │ 解析 binlog 生成删除缓存事件
                    ▼
             ┌──────────────┐
             │   MQ         │
             │ (RocketMQ)   │
             └──────┬───────┘
                    │ 异步消费
                    ▼
             ┌──────────────┐
             │  删除缓存     │
             │ 消费者        │
             └──────────────┘
```

**优势**：
- 业务代码 **零侵入**（不需要修改业务代码来维护缓存）
- 完全解耦，缓存维护与业务逻辑分离
- 支持 MySQL 和 Redis 之间的最终一致性

```java
// Canal 客户端消费 binlog 事件
public class CanalClient {
    public void processBinlog(CanalEntry.Entry entry) {
        if (entry.getEntryType() == CanalEntry.EntryType.ROWDATA) {
            CanalEntry.RowChange rowChange = CanalEntry.RowChange.parseFrom(
                entry.getStoreValue()
            );

            String tableName = entry.getHeader().getTableName();
            String schemaName = entry.getHeader().getSchemaName();

            for (CanalEntry.RowData rowData : rowChange.getRowDatasList()) {
                if (rowChange.getEventType() == CanalEntry.EventType.UPDATE
                    || rowChange.getEventType() == CanalEntry.EventType.DELETE) {

                    // 获取主键值
                    String id = getColumnValue(rowData.getAfterColumnsList(), "id");
                    String cacheKey = tableName + ":" + id;

                    // 发送 MQ 消息，异步删除缓存
                    rocketMQTemplate.sendOneWay(
                        "cache-clear-topic",
                        cacheKey
                    );
                }
            }
        }
    }
}
```

#### 如何选择缓存一致性方案？

| 方案 | 一致性 | 复杂度 | 适用场景 |
|------|--------|--------|---------|
| Cache Aside（删除缓存） | 最终一致（有短暂不一致窗口） | 低 | 大部分场景 |
| 延迟双删 | 最终一致（减少不一致窗口） | 低 | 对一致性要求稍高 |
| 读写锁 | 强一致 | 中 | 读写冲突严重的场景 |
| Canal + binlog | 最终一致 | 高 | 需要无侵入、解耦 |

---

### 面试技巧与最佳实践

#### 常见面试题

1. **缓存穿透和缓存击穿有什么区别？**
   - 穿透：查的数据在数据库也不存在，导致每次穿过缓存
   - 击穿：热点 key 过期，大量并发同时访问

2. **布隆过滤器为什么判断不存在是准确的？**
   因为只要有一个 hash 位为 0，就说明该元素从未被加入过（所有 hash 位都是 1 才有可能是存在的）。

3. **缓存雪崩怎么解决？**
   过期时间加随机值、多级缓存、限流降级、缓存预热。

4. **更新数据库后为什么要删缓存而不是更新缓存？**
   避免并发写导致的旧值覆盖新值问题；懒加载节省资源。

5. **延迟双删的延迟时间怎么确定？**
   通常 500ms-1000ms，取决于业务读取回填缓存的时间。原则：延迟时间 > 业务从 DB 读取到回填缓存的耗时。

#### 实战注意事项

- **缓存预热**：系统上线前，将热点数据提前加载到缓存。可以写一个预热脚本，在流量进来之前把数据灌进去。
- **本地缓存容量控制**：多级缓存中的本地缓存不要太大（建议 < 100MB），防止 JVM GC 压力。
- **监控缓存命中率**：
  ```bash
  # Redis 查看命中率
  INFO stats
  # keyspace_hits: 9500    # 命中次数
  # keyspace_misses: 500   # 未命中次数
  # 命中率 = 9500 / (9500+500) = 95%
  ```
- **空对象过期时间要短**：如果缓存了空对象，TTL 设置 30-60 秒即可，防止数据库插入真实数据后长时间不一致。
- **布隆过滤器更新时机**：数据库新增数据时，别忘了同步更新布隆过滤器。