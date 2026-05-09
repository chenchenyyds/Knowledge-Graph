## 分布式锁与实战

### 概述

在单机应用中，多线程竞争共享资源时可以使用 Java 的 `synchronized` 或 `ReentrantLock`。但在 **分布式系统** 中，多个服务实例运行在不同的 JVM 甚至不同的机器上，本地锁无法跨进程生效。这时就需要 **分布式锁** 来协调多节点对共享资源的互斥访问。

Redis 因为其高性能和原子操作，是实现分布式锁最流行的方案之一。

本文将带你从最简单的 V1 版本一路演进到生产级的分布式锁方案，理解每一步解决了什么问题。

---

### 分布式锁的演进

#### V1：SETNX + EXPIRE（两步操作）

```bash
# V1 版本
127.0.0.1:6379> SETNX lock:order key_value
(integer) 1               # 加锁成功
127.0.0.1:6379> EXPIRE lock:order 30
(integer) 1               # 设置 30 秒自动过期

# 业务逻辑执行...

# 解锁
127.0.0.1:6379> DEL lock:order
(integer) 1
```

**`SETNX` vs `EXPIRE` 对比：**

| 命令 | 作用 | 说明 |
|------|------|------|
| `SETNX key value` | key 不存在时才设置 | Set if Not eXists |
| `EXPIRE key seconds` | 设置 key 的过期时间 | 防止死锁 |

**问题：SETNX 和 EXPIRE 不是原子操作！**

```
  问题场景：

  ① Thread A: SETNX lock:order "value"  → 成功
  ② Thread A: 执行 EXPIRE 之前...                ← 进程崩溃！
  ③ lock:order 永不过期！
  ④ 所有其他线程永远无法获取锁
```

---

#### V2：SET NX EX（原子操作）

Redis 2.6.12+ 为 `SET` 命令增加了 NX 和 EX 选项，将加锁和设置过期时间合并为一个原子操作：

```bash
# V2 版本：原子加锁
127.0.0.1:6379> SET lock:order "value" NX EX 30
OK                          # 加锁成功（原子操作）

127.0.0.1:6379> SET lock:order "value2" NX EX 30
(nil)                       # 锁已被持有，加锁失败

# 解锁
127.0.0.1:6379> DEL lock:order
```

```java
// Jedis 实现 V2
public boolean tryLock(Jedis jedis, String lockKey, String value, int expireSeconds) {
    // SET NX EX 原子操作
    String result = jedis.set(lockKey, value,
        SetParams.setParams().nx().ex(expireSeconds));
    return "OK".equals(result);
}
```

**新问题：锁可能被其他线程误删！**

```
  问题场景：

  ① Thread A: SET lock "A_value" NX EX 30  → 成功
  ② Thread A: 执行时间超过 30 秒，锁已自动释放
  ③ Thread B: SET lock "B_value" NX EX 30  → 成功（获得了锁）
  ④ Thread A 执行完毕：DEL lock            → 删掉了 Thread B 的锁！
  ⑤ Thread B 还在执行，但锁已被删除
  ⑥ Thread C: 获得锁 → 与 Thread B 同时执行 → 数据不一致！
```

---

#### V3：唯一标识 + 校验删除

解决误删问题：每个线程使用 **唯一 ID** 标识自己，解锁时只删除自己的锁。

```java
// V3：唯一标识
public class DistributedLockV3 {
    public boolean tryLock(Jedis jedis, String lockKey, int expireSeconds) {
        // 使用 UUID 作为唯一标识
        String threadId = UUID.randomUUID().toString();
        String result = jedis.set(lockKey, threadId,
            SetParams.setParams().nx().ex(expireSeconds));
        return "OK".equals(result);
    }

    public void unlock(Jedis jedis, String lockKey, String threadId) {
        // 校验：只有自己的锁才删除
        String value = jedis.get(lockKey);
        if (threadId.equals(value)) {
            jedis.del(lockKey);
        }
    }
}
```

**新问题：GET + DEL 不是原子操作！**

```
  问题场景：

  ① Thread A: GET lock → "A_value"（是自己的锁）
  ② Thread A: 正要执行 DEL ...                ← GC 停顿/Full GC！
  ③ lock 自动过期了
  ④ Thread B: SET lock "B_value" NX EX → 成功
  ⑤ Thread A 恢复执行：DEL lock              ← 删掉了 Thread B 的锁！
```

---

#### V4：Lua 脚本保证原子性

将 GET 校验和 DEL 删除合并到一个 Lua 脚本中执行，Lua 脚本在 Redis 中是 **原子执行** 的：

```lua
-- unlock.lua：原子解锁脚本
-- KEYS[1] = 锁的 key
-- ARGV[1] = 线程唯一 ID
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
```

```bash
# 测试 Lua 解锁脚本
127.0.0.1:6379> EVAL "
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
else
    return 0
end
" 1 lock:order "A_value"

(integer) 1  -- 解锁成功
```

```java
// V4：Lua 脚本实现安全解锁
public class DistributedLockV4 {
    private static final String UNLOCK_SCRIPT =
        "if redis.call('get', KEYS[1]) == ARGV[1] then " +
        "    return redis.call('del', KEYS[1]) " +
        "else " +
        "    return 0 " +
        "end";

    private final JedisPool jedisPool;

    public boolean tryLock(String lockKey, String requestId, int expireSeconds) {
        try (Jedis jedis = jedisPool.getResource()) {
            String result = jedis.set(lockKey, requestId,
                SetParams.setParams().nx().ex(expireSeconds));
            return "OK".equals(result);
        }
    }

    public boolean unlock(String lockKey, String requestId) {
        try (Jedis jedis = jedisPool.getResource()) {
            // 使用 Lua 脚本保证原子性
            Long result = (Long) jedis.eval(
                UNLOCK_SCRIPT,
                Collections.singletonList(lockKey),
                Collections.singletonList(requestId)
            );
            return result == 1;
        }
    }
}
```

**V4 仍然存在的问题：锁过期时间不好确定。**

```
  核心矛盾：

  锁超时太短：业务还没执行完，锁就过期了
  锁超时太长：线程崩溃后，其他线程要等很久

  如果设置 30 秒，但业务执行需要 60 秒 →
  ① Thread A 获得锁（30 秒过期）
  ② 30 秒后锁自动释放
  ③ Thread B 获得锁
  ④ Thread A 还在执行 ← 两个线程同时执行！
```

---

#### V5：Redisson 看门狗（自动续期）

Redisson 是 Redis 官方推荐的 Java 客户端，它内置了 **看门狗（Watch Dog）机制** 来解决锁续期问题。

```
  看门狗机制工作原理

  时间轴 →
  ──────────────────────────────────────────────────────────

  0s       Thread A: 获取锁成功
           - 锁默认过期时间：30 秒
           - 启动看门狗线程（守护线程）

  10s      看门狗检查发现锁还被持有
           - 续期：再次设置过期时间为 30 秒
           - 锁的有效期重新从当前时间算起

  20s      看门狗再次续期

  30s      看门狗再次续期

  45s      Thread A 执行完毕
           - 手动释放锁
           - 看门狗线程停止

  如果 Thread A 崩溃 →
           - 看门狗也是该进程的线程，会随之终止
           - 锁不再续期，30 秒后自动释放
           - 避免了死锁
```

```java
// Redisson 分布式锁（自动续期）
import org.redisson.Redisson;
import org.redisson.api.RLock;
import org.redisson.api.RedissonClient;
import org.redisson.config.Config;

public class RedissonLockExample {
    public static void main(String[] args) {
        // 1. 创建 Redisson 客户端
        Config config = new Config();
        config.useSingleServer()
            .setAddress("redis://127.0.0.1:6379");
        RedissonClient redisson = Redisson.create(config);

        // 2. 获取锁
        RLock lock = redisson.getLock("order:lock");

        try {
            // 3. 尝试加锁（最多等待 10 秒，锁 30 秒自动过期）
            if (lock.tryLock(10, 30, TimeUnit.SECONDS)) {
                // 4. 执行业务逻辑
                //    - 看门狗每隔 10 秒自动续期
                //    - 只要业务没结束，锁就不会过期
                System.out.println("获取锁成功，执行业务...");
                Thread.sleep(60000); // 执行 60 秒的业务
                System.out.println("业务执行完毕");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            // 5. 释放锁（同时停止看门狗）
            lock.unlock();
        }

        redisson.shutdown();
    }
}
```

```java
// Redisson 看门狗核心配置
@Configuration
public class RedissonConfig {
    @Bean
    public RedissonClient redissonClient() {
        Config config = new Config();
        config.useSingleServer()
            .setAddress("redis://127.0.0.1:6379")
            .setConnectionPoolSize(10)
            .setConnectionMinimumIdleSize(5);

        // 看门狗超时时间（默认 30 秒）
        // 每 lockWatchdogTimeout / 3 秒续期一次（即每 10 秒一次）
        config.setLockWatchdogTimeout(30_000);

        return Redisson.create(config);
    }
}
```

---

### RedLock 算法

如果你的 Redis 是单节点部署，一旦 Redis 宕机，所有分布式锁都会失效。RedLock 算法解决了这个问题——它基于 **多台独立的 Redis 节点**（通常是 5 台）来实现高可用的分布式锁。

#### 算法流程

```
  RedLock 算法流程

  前提：有 N 个独立的 Redis 节点（通常 N=5）

  加锁步骤：
  ┌────────────────────────────────────────────────────┐
  │  ① 获取当前时间戳 T1                                │
  │                                                     │
  │  ② 依次向 N 个节点加锁（使用同一个 key 和 value）     │
  │      - 每个节点加锁超时时间很短（如 50ms）             │
  │      - 如果某个节点未响应，快速跳过                    │
  │                                                     │
  │  ③ 统计成功加锁的节点数量 M                           │
  │                                                     │
  │  ④ 计算总耗时 elapsed = 当前时间 - T1                 │
  │                                                     │
  │  ⑤ 判断条件：                                        │
  │     - M >= N/2 + 1（即多数节点加锁成功）               │
  │     - elapsed < TTL（总耗时未超过锁的过期时间）        │
  │     → 满足则加锁成功                                  │
  │     → 不满足则加锁失败                                │
  │                                                     │
  │  ⑥ 加锁失败：向所有节点发送 DEL 命令解锁               │
  └────────────────────────────────────────────────────┘
```

```
  示意图：5 节点 RedLock

  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐
  │ Node 1  │  │ Node 2  │  │ Node 3  │  │ Node 4  │  │ Node 5  │
  │ OK ✓    │  │ OK ✓    │  │ OK ✓    │  │ Timeout │  │ OK ✓    │
  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘
       ↑            ↑            ↑            ↑            ↑
       └────────────┴────────────┴────────────┴────────────┘
                    成功 4 台 ≥ 3（多数）
                    总耗时 < 锁 TTL
                    → 加锁成功！
```

#### Java 实现 RedLock

```java
// RedLock 简单实现（示意）
public class RedLock {
    private static final int TOTAL_NODES = 5;
    private static final int LOCK_TIMEOUT = 50;   // 每个节点加锁超时（ms）
    private static final int TTL = 1000;           // 锁过期时间（ms）
    private final Jedis[] nodes;

    public RedLock(Jedis[] nodes) {
        this.nodes = nodes;
    }

    public boolean tryLock(String lockKey, String requestId) {
        long start = System.currentTimeMillis();
        int successCount = 0;

        // 向所有节点加锁
        for (Jedis node : nodes) {
            try {
                // 每个节点设置短超时
                String result = node.set(lockKey, requestId,
                    SetParams.setParams().nx().px(LOCK_TIMEOUT));
                if ("OK".equals(result)) {
                    successCount++;
                }
            } catch (Exception e) {
                // 节点不可用，跳过
            }
        }

        long elapsed = System.currentTimeMillis() - start;

        // 判断条件：多数成功 + 耗时未超过 TTL
        if (successCount >= TOTAL_NODES / 2 + 1 && elapsed < TTL) {
            return true;
        }

        // 加锁失败，解锁所有节点
        for (Jedis node : nodes) {
            unlock(node, lockKey, requestId);
        }
        return false;
    }

    private void unlock(Jedis jedis, String lockKey, String requestId) {
        // Lua 脚本解锁
        jedis.eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then " +
            "    return redis.call('del', KEYS[1]) " +
            "else " +
            "    return 0 " +
            "end",
            Collections.singletonList(lockKey),
            Collections.singletonList(requestId)
        );
    }
}
```

#### 使用 Redisson 实现 RedLock

```java
// Redisson 内置 RedLock 支持
public class RedissonRedLockExample {
    public static void main(String[] args) {
        // 创建 3 个 Redisson 客户端（对应 3 个独立 Redis 节点）
        RedissonClient client1 = createClient("redis://node1:6379");
        RedissonClient client2 = createClient("redis://node2:6379");
        RedissonClient client3 = createClient("redis://node3:6379");

        // 从每个客户端获取锁
        RLock lock1 = client1.getLock("resource");
        RLock lock2 = client2.getLock("resource");
        RLock lock3 = client3.getLock("resource");

        // 创建 RedLock
        RedissonRedLock redLock = new RedissonRedLock(lock1, lock2, lock3);

        try {
            // 尝试加锁（最多等 10 秒，锁过期 30 秒）
            if (redLock.tryLock(10, 30, TimeUnit.SECONDS)) {
                // 业务逻辑
                System.out.println("RedLock 加锁成功！");
                Thread.sleep(5000);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            redLock.unlock(); // 自动解锁所有节点
        }

        client1.shutdown();
        client2.shutdown();
        client3.shutdown();
    }

    private static RedissonClient createClient(String address) {
        Config config = new Config();
        config.useSingleServer().setAddress(address);
        return Redisson.create(config);
    }
}
```

#### RedLock 的争论

Martin Kleppmann（《数据密集型应用系统设计》作者）曾公开批评 RedLock，认为它在某些场景下不安全：

```
  RedLock 的争议：时钟漂移问题

  问题：RedLock 依赖系统时钟来判断"总耗时 < TTL"

  场景：
  ① Node 1 获取锁成功（本地时间 10:00:00）
  ② Node 1 的系统时钟突然跳跃到 10:00:40
  ③ Node 1 认为锁已过期（40 秒 > 30 秒 TTL）
  ④ Node 1 上的线程还在执行...  ← 危险！
```

实践中 **大多数场景下 RedLock 是安全的**，但在极苛刻的强一致性场景下，需要考虑更复杂的方案（如 ZooKeeper 的分布式锁）。

---

### 分布式锁的高级特性

Redisson 的锁不只是简单的互斥锁，还提供了多种高级特性。

#### 可重入锁

同一个线程可以重复获取同一把锁（计数器 +1），避免自己死锁自己：

```java
// 可重入演示
public void reentrantExample() {
    RLock lock = redisson.getLock("lock");

    lock.lock();
    try {
        System.out.println("第一次获取锁");

        // 再次获取同一把锁（可重入）
        lock.lock();
        try {
            System.out.println("第二次获取锁（可重入）");
            // 这里已经重入了 2 次
        } finally {
            lock.unlock(); // 释放第二次
        }

    } finally {
        lock.unlock(); // 释放第一次
    }
}
```

**实现原理**：Redis Hash 结构记录重入次数。

```bash
# Redisson 可重入锁的 Redis 数据结构

# 加锁命令（Hash 结构）
# key: 锁名称
# field: 线程 ID（UUID:threadId）
# value: 重入次数

# 第一次加锁：
HSET lock:order "uuid-abc:thread-1" 1
EXPIRE lock:order 30

# 第二次重入（同一线程）：
HINCRBY lock:order "uuid-abc:thread-1" 1
EXPIRE lock:order 30   # 续期

# 解锁（释放一次重入）：
HINCRBY lock:order "uuid-abc:thread-1" -1
# 如果 value 变为 0，则删除 key
```

#### 公平锁

按请求顺序获取锁（FIFO）：

```java
// 公平锁
public void fairLockExample() {
    // 公平锁：按照请求顺序分配
    RLock fairLock = redisson.getFairLock("fair:lock");

    // 所有线程排队，先到先得
    fairLock.lock();
    try {
        // 业务逻辑
    } finally {
        fairLock.unlock();
    }
}
```

**实现原理**：使用 Redis List 维护等待队列 + ZSet 记录过期时间。

#### 读写锁

读锁和读锁不互斥，读锁和写锁互斥，写锁和写锁互斥：

```java
// 读写锁示例
public class ReadWriteLockExample {
    private final RReadWriteLock rwLock = redisson.getReadWriteLock("data:lock");

    // 读方法：可以并发读
    public String readData() {
        RLock readLock = rwLock.readLock();
        readLock.lock();
        try {
            // 多个线程可以同时进入这里（读读不互斥）
            return jedis.get("data");
        } finally {
            readLock.unlock();
        }
    }

    // 写方法：互斥写入
    public void writeData(String data) {
        RLock writeLock = rwLock.writeLock();
        writeLock.lock();
        try {
            // 只有一个线程能进入（写写互斥，读写互斥）
            jedis.set("data", data);
            Thread.sleep(5000); // 模拟耗时写入
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            writeLock.unlock();
        }
    }
}
```

#### 信号量（Semaphore）

控制同时访问某个资源的并发线程数：

```java
// 信号量示例：控制并发数
public class SemaphoreExample {
    public static void main(String[] args) {
        RSemaphore semaphore = redisson.getSemaphore("concurrent:limit");

        // 初始化 3 个许可（在系统启动时执行一次）
        // semaphore.trySetPermits(3);

        // 获取许可（获取不到则等待）
        semaphore.acquire();
        try {
            // 最多 3 个线程同时执行
            System.out.println("执行业务逻辑...");
            Thread.sleep(2000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        } finally {
            semaphore.release(); // 释放许可
        }
    }
}
```

---

### 面试技巧与最佳实践

#### 常见面试题

1. **Redis 分布式锁的演进过程是怎样的？**
   SETNX + EXPIRE → SET NX EX → 唯一标识校验 → Lua 脚本 → Redisson 看门狗

2. **Redisson 的看门狗机制是什么？**
   加锁成功后启动守护线程，每隔 1/3 锁超时时间（默认 10 秒）检查一次，如果锁还被持有则自动续期，防止业务未完成锁已过期。

3. **Redis 分布式锁和 ZooKeeper 分布式锁对比？**

   | 特性 | Redis | ZooKeeper |
   |------|-------|-----------|
   | 性能 | 高（纯内存） | 中（磁盘+选举） |
   | 可靠性 | AP（最终一致） | CP（强一致） |
   | 死锁处理 | TTL 自动释放 | 会话过期自动释放 |
   | 锁续期 | 需看门狗 | 心跳自动续期 |
   | 实现复杂度 | 低（SET NX + Lua） | 中（临时顺序节点） |

4. **什么场景下应该使用 RedLock？**
   对锁可靠性要求极高，且 Redis 集群部署时。普通场景单节点 + 主从切换即可满足。

5. **如何避免锁超时导致的数据不一致？**
   - Redisson 看门狗自动续期
   - 设置合理的锁超时时间（预估业务最大执行时间）
   - 重要操作使用乐观锁兜底（CAS）

#### 实战注意事项

- **锁粒度要小**：锁的 key 越精细越好（如 `lock:order:1001` 而不是 `lock:order`），避免锁竞争影响吞吐量。
- **设置合理超时**：锁超时时间建议设置为业务预估最大执行时间的 3-5 倍。
- **解锁放在 finally 中**：确保锁一定会释放，避免死锁。
- **注意主从切换问题**：单节点加锁成功后，主节点宕机，从节点还没同步锁数据就升为新的主节点，导致其他线程也能获取锁。生产环境用 RedLock 或多从同步配置。
- **监控锁的获取情况**：使用 Redis 慢查询日志监控异常慢的锁操作。

```bash
# 监控锁相关命令的耗时
SLOWLOG LEN
SLOWLOG GET 10
```

```java
// 分布式锁最佳实践模板
public class DistributedLockTemplate {
    private final RedissonClient redisson;

    public <T> T executeWithLock(String lockKey,
                                  long waitTime,
                                  long leaseTime,
                                  Supplier<T> supplier) {
        RLock lock = redisson.getLock(lockKey);
        try {
            boolean locked = lock.tryLock(waitTime, leaseTime, TimeUnit.SECONDS);
            if (!locked) {
                throw new RuntimeException("获取锁超时: " + lockKey);
            }
            return supplier.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("获取锁被中断", e);
        } finally {
            // 如果锁还被当前线程持有才释放
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}

// 使用
String result = lockTemplate.executeWithLock(
    "order:12345", 10, 30, () -> {
        // 需要同步的业务逻辑
        return orderService.processOrder("12345");
    }
);
```