## 持久化与内存淘汰策略

### 概述

Redis 是内存数据库，数据默认存储在内存中。一旦进程退出或机器宕机，内存中的数据就会全部丢失。**持久化机制**的作用就是将内存中的数据保存到磁盘，以便重启后恢复数据。

Redis 提供了三种持久化方案：
- **RDB**：全量快照，定期保存
- **AOF**：增量日志，记录每个写命令
- **混合持久化**（Redis 4.0+）：RDB 快照 + AOF 增量日志

与此同时，Redis 还提供了 **内存淘汰策略** 和 **过期键删除策略** 来解决内存有限的问题。选择不当可能导致大量缓存失效或内存溢出。

---

### RDB 持久化

RDB（Redis Database）是 Redis 默认的持久化方式。它会在指定时间间隔内生成内存数据的 **全量快照** 并保存到磁盘文件 `dump.rdb`。

#### 工作原理

RDB 的核心是 **fork + COW（写时复制）**：

```
  RDB 持久化流程图（BGSAVE）

          ┌─────────────┐
          │  Redis 主进程 │
          └──────┬──────┘
                 │ bgsave 命令
                 ▼
          ┌─────────────┐
          │  fork()     │──────> 子进程继承父进程内存页表
          └──────┬──────┘
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
  ┌──────────┐      ┌──────────────┐
  │  父进程   │      │   子进程      │
  │ 继续处理  │      │ 读取内存页表  │
  │ 客户端请求 │      │ 写 RDB 文件  │
  └────┬─────┘      └──────┬───────┘
       │                   │
       │  COW 机制          │
       ▼                   ▼
  ┌──────────────────────────────┐
  │  操作系统内存页               │
  │                              │
  │  当父进程要修改某内存页时：    │
  │  ① 复制该页                   │
  │  ② 父进程修改副本             │
  │  ③ 子进程继续读原始页写文件    │
  └──────────────────────────────┘
```

**关键点**：fork 后子进程与父进程共享同一份内存。只有当父进程需要修改某内存页时，才会复制该页（写时复制）。因此 RDB 在生成快照期间不会阻塞读操作，仅 fork 时有短暂停顿。

#### 触发方式

```bash
# 方式一：SAVE（同步，阻塞主进程）
127.0.0.1:6379> SAVE
OK

# 方式二：BGSAVE（异步，推荐）
127.0.0.1:6379> BGSAVE
Background saving started

# 方式三：自动触发（配置 save 指令）
# redis.conf 配置：
save 900 1        # 900 秒（15 分钟）内至少有 1 个 key 变化
save 300 10       # 300 秒（5 分钟）内至少有 10 个 key 变化
save 60 10000     # 60 秒（1 分钟）内至少有 10000 个 key 变化

# 方式四：关闭时自动触发（配置了 save 指令时）
SHUTDOWN

# 查看 RDB 文件位置
CONFIG GET dir
CONFIG GET dbfilename
```

#### RDB 文件结构

```
  dump.rdb 文件结构：

  ┌──────────────┬──────────┬──────────────┬──────────────┬──────────┐
  │ REDIS        │ RDB版本  │ 辅助字段      │ 数据库数据    │ 校验和   │
  │ (魔数5字节)   │ (4字节)  │ (Redis版本等) │ (键值对序列)  │ (8字节)  │
  └──────────────┴──────────┴──────────────┴──────────────┴──────────┘

  数据部分格式（每个键值对）：
  ┌────────┬──────────┬────────────┬──────────┬──────────────┐
  │ 过期时间 │ 类型编码  │ key 长度   │ key 数据 │ value 编码+数据│
  │ (可选)  │ (1字节)  │ (变长)     │          │              │
  └────────┴──────────┴────────────┴──────────┴──────────────┘
```

#### 优缺点

| 优点 | 缺点 |
|------|------|
| 文件紧凑，适合备份和灾备 | 可能丢失最后一次快照后的数据 |
| 恢复速度比 AOF 快 | fork 子进程耗时随内存大小增加 |
| 最大程度保证恢复性能 | COW 导致内存翻倍风险（极端写场景） |

#### 恢复演示

```bash
# 模拟数据丢失与恢复
127.0.0.1:6379> SET user:1 "zhangsan"
OK
127.0.0.1:6379> SAVE
OK
127.0.0.1:6379> FLUSHALL          # 清空数据
OK
127.0.0.1:6379> SHUTDOWN          # 关闭 Redis

# 将 dump.rdb 放到正确目录并重启 Redis
# Redis 启动时会自动加载 dump.rdb 恢复数据

127.0.0.1:6379> GET user:1
"zhangsan"                         # 数据已恢复！
```

---

### AOF 持久化

AOF（Append Only File）通过记录 **每一条写命令** 来实现持久化。重启时逐条回放 AOF 文件中的命令来恢复数据。

#### 工作原理

```
  AOF 写入流程

  客户端命令: SET name "redis"
                  │
                  ▼
          ┌───────────────┐
          │  协议格式转换  │  →  "*3\r\n$3\r\nSET\r\n$4\r\nname\r\n$5\r\nredis\r\n"
          └───────┬───────┘
                  │
                  ▼
          ┌───────────────┐
          │ 追加到 aof_buf │  →  写入内存中的 AOF 缓冲区
          └───────┬───────┘
                  │
          ┌───────┴───────┐
          │  appendfsync  │  →  根据策略刷盘
          │  策略控制      │
          └───────┬───────┘
                  │
                  ▼
          ┌───────────────┐
          │  write()      │  →  写入操作系统内核缓冲区
          └───────┬───────┘
                  │
          ┌───────┴───────┐
          │  fsync()      │  →  真正写入磁盘
          └───────────────┘
```

#### 配置与刷盘策略

```bash
# redis.conf 配置
appendonly yes                  # 开启 AOF（默认 no）
appendfilename "appendonly.aof" # AOF 文件名

# 刷盘策略（三者选一）
appendfsync always              # 每条命令都 fsync，最安全最慢
appendfsync everysec            # 每秒 fsync，推荐折中方案（默认）
appendfsync no                  # 由操作系统决定，最快但最不安全
```

**三种策略对比：**

| 策略 | 数据安全性 | 性能 | 说明 |
|------|-----------|------|------|
| always | 最多丢 1 条命令 | 最慢 | 每次写操作都 fsync，SSD 下约每秒几百次 |
| everysec | 最多丢 1 秒数据 | 较好 | 每秒 batch fsync，兼顾安全与性能 |
| no | 可能丢较多数据 | 最快 | 由 OS 内核决定刷盘时机 |

#### AOF 重写机制

随着运行时间增长，AOF 文件会越来越大。例如对同一个 key 做了 100 次 INCR，AOF 文件中会记录 100 条命令，但实际只需要保存最终值。

```
  AOF 重写优化示例：

  原始 AOF 内容（多条命令）：
  INCR counter    →  counter = 1
  INCR counter    →  counter = 2
  INCR counter    →  counter = 3
  ...（100 次 INCR 共 100 条命令）

  重写后 AOF 内容（1 条命令）：
  SET counter 100
```

```bash
# 手动触发 AOF 重写
127.0.0.1:6379> BGREWRITEAOF
Background append only file rewriting started

# 自动触发配置
auto-aof-rewrite-percentage 100   # 文件增长超过 100% 时触发
auto-aof-rewrite-min-size 64mb    # 文件至少达到 64MB 才触发
```

**重写流程：**

```
  AOF 重写流程图（BGREWRITEAOF）

  主进程                   子进程
    │                       │
    ├── fork() ────────────►│
    │                       ├── 读取当前内存数据
    │                       ├── 生成最小命令集
    │                       ├── 写入临时 AOF 文件
    │                       │
    │ 继续处理请求            │
    │ 写命令追加到：          │
    │ ① AOF 缓冲区（旧文件）  │
    │ ② AOF 重写缓冲区        │
    │                       │
    │◄──── 子进程完成 ──────┤
    │                       │
    ├── 将 AOF 重写缓冲区     │
    │  内容追加到新 AOF 文件  │
    ├── 用新 AOF 文件替换旧文件│
    ▼                       ▼
  完成重写
```

```java
// Java 中通过 RedisTemplate 配置 AOF 相关参数
// 注意：AOF 配置在 Redis 服务端，客户端无法动态控制
// 但可以通过 RedisTemplate 的各种 API 了解命令对 AOF 的影响

@Configuration
public class RedisConfig {
    @Bean
    public RedisTemplate<String, Object> redisTemplate(
            RedisConnectionFactory factory) {
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);
        // 设置序列化方式
        template.setKeySerializer(new StringRedisSerializer());
        template.setValueSerializer(new GenericJackson2JsonRedisSerializer());
        return template;
    }
}
```

---

### 混合持久化（Redis 4.0+）

Redis 4.0 引入了 **混合持久化** 模式，结合了 RDB 的快照优势和 AOF 的增量优势。

#### 原理

```
  混合持久化 AOF 文件结构：

  ┌──────────────────────────────────────┬────────────────────�-m─────┐
  │         RDB 格式的二进制数据           │    AOF 格式的增量命令    │
  │     （全量快照，加载极快）              │   （重启后的增量数据）   │
  └──────────────────────────────────────┴──────────────────────────┘
          ↑                                    ↑
     最近一次 AOF 重写时的数据                重写后新执行的命令
```

#### 配置

```bash
# redis.conf
aof-use-rdb-preamble yes   # 开启混合持久化（Redis 4.0+，默认 yes）
appendonly yes             # 需要同时开启 AOF
```

#### 恢复流程对比

```
  纯 AOF 恢复：                    混合持久化恢复：

  启动                             启动
    │                                │
    ▼                                ▼
  读取 AOF 文件                    读取 AOF 文件
    │                                │
    ▼                                ├── 发现文件头是 RDB 格式
  逐条回放所有命令                    ├── 直接加载 RDB 部分（极快）
  （命令越多越慢）                    ├── 回放尾部 AOF 命令（增量）
    │                                │
    ▼                                ▼
  恢复完成                         恢复完成（快 10x+）
```

#### 优点

- 启动恢复速度接近 RDB（直接加载 RDB 快照）
- 数据安全性接近 AOF（增量命令不丢失）
- 文件大小比纯 AOF 小得多

---

### 过期键删除策略

Redis 使用 **定期删除 + 惰性删除** 两种策略配合来清理过期键。

#### 定期删除

```
  定期删除执行流程（每 100ms）

  ┌─────────────────────────────────────────────┐
  │  每 100ms 执行一次                          │
  │                                             │
  │  ① 从设置了过期时间的 key 中随机取 20 个     │
  │  ② 删除其中已过期的 key                      │
  │  ③ 如果过期比例 > 25%，重复步骤 ①            │
  │  ④ 最多执行 25ms，超时暂停等待下个周期        │
  │                                             │
  │  目的：避免长时间卡住 Redis 主线程            │
  └─────────────────────────────────────────────┘
```

#### 惰性删除

当客户端读取一个 key 时，Redis 会先检查该 key 是否已过期，如果过期则删除并返回 nil。

```bash
# 惰性删除演示
127.0.0.1:6379> SETEX session:abc 5 "data"
OK
127.0.0.1:6379> GET session:abc    # 5 秒内
"data"
127.0.0.1:6379> GET session:abc    # 5 秒后（惰性删除触发）
(nil)
```

**两者配合**：定期删除做"主动清理"，惰性删除做"兜底清理"，确保不会有过期 key 长期占用内存。

---

### 内存淘汰策略

当 Redis 内存使用达到 `maxmemory` 限制时，Redis 会根据配置的策略淘汰 key 以释放内存。

#### 配置

```bash
# redis.conf
maxmemory 4gb                          # 最大内存限制
maxmemory-policy allkeys-lru           # 淘汰策略（默认 noeviction）
maxmemory-samples 5                    # LRU/LFU 采样数（越大越精确，越慢）
```

#### 八种淘汰策略详解

| 策略 | 作用范围 | 淘汰依据 | 说明 |
|------|---------|---------|------|
| **noeviction** | — | — | 不淘汰，写请求直接返回 OOM 错误（默认） |
| **allkeys-lru** | 所有 key | LRU | 淘汰最近最少使用的 key |
| **allkeys-lfu** | 所有 key | LFU | 淘汰最不经常使用的 key（4.0+） |
| **allkeys-random** | 所有 key | 随机 | 随机淘汰 |
| **volatile-lru** | 设置了 TTL 的 key | LRU | 在过期 key 中淘汰最近最少使用的 |
| **volatile-lfu** | 设置了 TTL 的 key | LFU | 在过期 key 中淘汰最不经常使用的 |
| **volatile-random** | 设置了 TTL 的 key | 随机 | 在过期 key 中随机淘汰 |
| **volatile-ttl** | 设置了 TTL 的 key | TTL | 淘汰即将过期的 key（剩余 TTL 最短） |

#### 如何选择淘汰策略

```
  选型决策流程：

  是否接受缓存服务不可写？
  ├── 否 → noeviction
  └── 是 → 是否所有 key 都应该被淘汰？
       ├── 是 → 是否热点访问集中？
       │    ├── 是 → allkeys-lru（最常用）
       │    └── 否 → allkeys-lfu（访问频率差异大时）
       └── 否 → 使用 volatile-* 系列
            ├── LRU 访问 → volatile-lru
            ├── 频率差异大 → volatile-lfu
            └── 能预测 TTL → volatile-ttl
```

**生产环境推荐**：绝大多数场景使用 `allkeys-lru`。

#### LRU vs LFU 对比

```bash
# LRU 问题场景：一次批量查询可能把冷数据变成"最近使用"
# 假设缓存中有以下数据：
# A 被频繁访问，B 被一次性批量扫描
LRU 会误判 B 为"最近使用"，可能淘汰 A
LFU 跟踪访问频率，不会受单次扫描影响

# 模拟访问模式：
# A: 每 5 分钟访问一次（长期活跃）
# B: 今天 10:00 批量查询了 1000 次（一次性）
```

| 特性 | LRU | LFU |
|------|-----|-----|
| 适用范围 | 通用场景 | 访问频率差异大的场景 |
| 内存开销 | 较小 | 较大（需记录访问频率） |
| 应对突发 | 容易被"冷扫描"污染 | 能抵抗突发扫描 |
| 实现复杂度 | 简单 | 复杂（衰减机制） |

LRU 的近似实现（Redis 使用采样近似法，而非精确 LRU）：

```
  Redis LRU 近似算法:

  ┌────────────────────────────────────────────────┐
  │  key1 (最近访问)                                │
  │  key2                                          │
  │  key3                                          │
  │  ...                                           │
  │  keyN (最久未访问) ← 池中待淘汰的候选           │
  └────────────────────────────────────────────────┘

  pool = []     # 淘汰候选池（大小 16）
  for i in range(maxmemory-samples):
      key = 随机采样一个 key
      pool.add(key)   # 按空闲时间排序
  evict(pool[0])      # 淘汰空闲时间最长的
```

```java
// Java 中监控 Redis 内存使用情况
import redis.clients.jedis.Jedis;

public class MemoryMonitor {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            // 查看内存使用
            String info = jedis.info("memory");
            System.out.println(info);

            // 获取 maxmemory 配置
            String maxMemory = jedis.configGet("maxmemory").get(1);
            String policy = jedis.configGet("maxmemory-policy").get(1);
            System.out.println("最大内存: " + maxMemory + " bytes");
            System.out.println("淘汰策略: " + policy);

            // 获取当前已用内存
            Long usedMemory = Long.parseLong(
                jedis.info("memory").lines()
                    .filter(l -> l.startsWith("used_memory:"))
                    .findFirst()
                    .orElse("used_memory:0")
                    .split(":")[1]
            );
            System.out.println("已用内存: " + usedMemory + " bytes");
        }
    }
}
```

---

### 面试技巧与最佳实践

#### 常见面试题

1. **RDB 和 AOF 如何选择？**
   - 对数据安全要求极高（不丢失数据）：AOF + everysec
   - 对恢复速度要求高：RDB
   - 既要安全又要恢复快：混合持久化
   - 可以接受分钟级数据丢失：RDB

2. **AOF always 和 everysec 有什么区别？**
   always 每次写命令都 fsync，最多丢一条；everysec 每秒 fsync，最多丢 1 秒数据。

3. **为什么 AOF 文件越来越大？怎么处理？**
   因为记录所有写命令。通过 BGREWRITEAOF 重写压缩，将多条命令合并为最小命令集。

4. **RDB 的 save 和 bgsave 有什么区别？**
   save 阻塞主进程，bgsave fork 子进程异步执行。

5. **Redis 过期 key 是如何清理的？**
   定期删除（每 100ms 随机采样 20 个）+ 惰性删除（访问时检查）。

6. **allkeys-lru 和 volatile-lru 的区别？**
   allkeys-lru 对所有 key 生效，volatile-lru 只对设置了 TTL 的 key 生效。

#### 实战注意事项

- **RDB 的 fork 问题**：如果实例占用内存很大（如 10GB+），fork 耗时可达数秒甚至十几秒，期间 Redis 无法响应。建议：
  - 单个 Redis 实例内存不超过 10GB
  - 使用物理机而非容器（fork 性能更好）
  - 监控 `latest_fork_usec` 指标

- **AOF 文件损坏**：使用 `redis-check-aof` 工具修复
  ```bash
  redis-check-aof --fix appendonly.aof
  ```

- **RDB 文件损坏**：使用 `redis-check-rdb` 工具
  ```bash
  redis-check-rdb dump.rdb
  ```

- **内存淘汰监控**：
  ```bash
  # 查看被淘汰的 key 数量
  INFO stats | grep evicted_keys

  # 查看过期 key 数量
  INFO stats | grep expired_keys
  ```

- **不要混用淘汰策略**：如果同时设置了一些 key 的 TTL 和一些不设 TTL，用 volatile-lru 可能导致设了 TTL 的 key 被快速淘汰完，而不设 TTL 的 key 永远不被淘汰。