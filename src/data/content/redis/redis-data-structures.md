## 核心数据结构

### 概述

Redis 是一个 **基于内存** 的 key-value 存储系统。所谓 key-value，是指每个数据都有一个唯一的 key（键），通过 key 可以存取对应的 value（值）。但 Redis 的 value 并非简单的字符串——它支持 **五种基础数据类型**（String、List、Set、ZSet、Hash）以及 **多种高级数据结构**（HyperLogLog、Bitmap、GEO、Stream）。理解这些数据结构的底层实现和适用场景，是掌握 Redis 的第一步，也是面试中最常考察的基础知识。

---

### String（字符串）

String 是 Redis 最基础的数据类型，value 可以是字符串、整数或浮点数。

#### 典型应用场景

| 场景 | 示例 | 解释 |
|------|------|------|
| 缓存 | 缓存用户信息 JSON 字符串 | 减少数据库查询 |
| 计数器 | 文章阅读数、点赞数 | INCR 命令原子递增 |
| 分布式锁 | SET NX EX 命令 | 后面章节详述 |
| 共享 Session | 存储用户登录状态 | 多服务器共享 |

#### 常用命令

```bash
# 基本操作
SET name "zhangsan"
GET name
DEL name

# 过期时间
SET code "123456" EX 300    # 300 秒后自动删除
SETEX code 300 "123456"     # 等价写法
PSETEX code 300000 "123456" # 毫秒为单位

# 原子计数
INCR article:100:views      # +1
INCRBY article:100:views 10 # +10
DECR article:100:views      # -1

# 批量操作（减少网络往返）
MSET k1 v1 k2 v2 k3 v3
MGET k1 k2 k3

# 追加与长度
APPEND name " hello"        # 追加字符串
STRLEN name                 # 获取字符串长度

# 设置 NX/XX 条件
SET lock "1" NX EX 30       # key 不存在才设置（分布式锁）
SET lock "1" XX EX 30       # key 必须存在才设置（更新）
```

#### 底层编码：SDS（Simple Dynamic String）

Redis 没有直接使用 C 语言的 `char*` 字符串，而是自己实现了 SDS 结构：

```
  SDS 结构示意图（以 "Redis" 为例）

  ┌──────────────┬──────────────┬──────────────────────────┐
  │ len = 5      │ alloc = 10   │ flags (type info)        │
  └──────┬───────┴──────┬───────┴──────────┬───────────────┘
         │              │                  │
         ▼              ▼                  ▼
  ┌─────────────────────────────────────────────────┬──────┐
  │ 'R' │ 'e' │ 'd' │ 'i' │ 's' │ \0 │  │  │  │  │  │      │
  └─────────────────────────────────────────────────┴──────┘
  buf[] 实际存储字节数组                     预分配空间

  len   = 5    buf 中已使用的字节数（不含末尾 \0）
  alloc = 10   buf 的总分配长度（不含 \0）
  buf[]        字符数组，以 \0 结尾（兼容 C 函数）
```

**SDS 相比 C 字符串的优势：**

| 对比项 | C 字符串 | SDS |
|--------|---------|-----|
| 获取长度 | O(n) 遍历 | O(1) 读 len 字段 |
| 缓冲区溢出 | 不检查，可能覆盖相邻内存 | 自动检查空间，不足时扩容 |
| 二进制安全 | 不能存 \0（字符串结束符） | 可以存任意二进制数据 |
| 修改时内存重分配 | 频繁 realloc | 空间预分配 + 惰性释放 |

```java
// Java 中使用 Jedis 操作 String
import redis.clients.jedis.Jedis;

public class StringExample {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            // 缓存用户信息
            String userJson = "{\"id\":1001,\"name\":\"张三\",\"age\":25}";
            jedis.setex("user:1001", 3600, userJson); // 1 小时过期

            // 计数器 — 原子自增
            jedis.incr("today:visits");
            Long visits = Long.parseLong(jedis.get("today:visits"));
            System.out.println("今日访问量: " + visits);

            // 批量获取
            List<String> users = jedis.mget("user:1001", "user:1002");
        }
    }
}
```

---

### List（列表）

List 是一个有序的字符串列表，底层基于 quicklist 实现，支持两端高效插入和删除。

#### 典型应用场景

- **消息队列**：LPUSH + BRPOP 实现生产者-消费者模式
- **最新列表**：LPUSH + LTRIM 保留最新 N 条记录（如最新文章、最新评论）
- **栈/队列**：LPOP / RPOP 实现 LIFO 或 FIFO 语义

#### 常用命令

```bash
# 插入元素
LPUSH mylist "a" "b" "c"       # 从左侧插入，顺序：c b a
RPUSH mylist "x" "y" "z"       # 从右侧插入，顺序：a b c x y z

# 弹出元素
LPOP mylist                    # 移除并返回最左元素
RPOP mylist                    # 移除并返回最右元素

# 查看元素
LRANGE mylist 0 -1             # 查看所有元素
LRANGE mylist 0 2              # 查看前 3 个元素
LLEN mylist                    # 列表长度
LINDEX mylist 0                # 获取指定索引的元素

# 阻塞操作（常用于消息队列）
BLPOP queue 5                  # 阻塞弹出最左元素，超时 5 秒
BRPOP queue 5                  # 阻塞弹出最右元素，超时 5 秒

# 修剪列表
LTRIM mylist 0 99              # 只保留前 100 个元素

# 删除指定元素
LREM mylist 2 "a"              # 删除前 2 个值为 "a" 的元素
```

**消息队列经典模式：**

```bash
# 生产者（Producer）
LPUSH msg:queue "task1"
LPUSH msg:queue "task2"

# 消费者（Consumer）— 阻塞等待
BRPOP msg:queue 0              # 0 = 永不超时
```

#### 底层实现：quicklist

```
  quicklist 结构示意图

  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ quicklist│---->│ quicklist│---->│ quicklist│----> NULL
  │ node     │     │ node     │     │ node     │
  └────┬─────┘     └────┬─────┘     └────┬─────┘
       │                │                │
       ▼                ▼                ▼
  ┌──────────┐     ┌──────────┐     ┌──────────┐
  │ ziplist  │     │ ziplist  │     │ ziplist  │
  │ [a,b,c]  │     │ [d,e,f]  │     │ [g,h]    │
  └──────────┘     └──────────┘     └──────────┘
```

quicklist 是 **双向链表 + ziplist** 的结合体。每个节点内部是一个紧凑的 ziplist（压缩列表），多个 ziplist 通过双向指针连接。这样做既节省内存（ziplist 连续存储），又支持两端高效操作（双向链表）。

```java
// Java 中使用 Jedis 操作 List
public class ListExample {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            // 模拟最新文章列表
            String key = "latest:articles";

            // 发布新文章时插入
            jedis.lpush(key, "article:1005", "article:1004", "article:1003");
            // 只保留最新 100 篇
            jedis.ltrim(key, 0, 99);

            // 分页查询
            List<String> articles = jedis.lrange(key, 0, 9); // 第 1 页 10 条
            System.out.println("最新文章: " + articles);
        }
    }
}
```

#### 阻塞队列完整实现

```java
// 生产者线程
new Thread(() -> {
    try (Jedis jedis = new Jedis("localhost", 6379)) {
        for (int i = 0; i < 10; i++) {
            jedis.lpush("task:queue", "task-" + i);
            System.out.println("生产: task-" + i);
            Thread.sleep(100);
        }
    } catch (Exception e) { e.printStackTrace(); }
}).start();

// 消费者线程
new Thread(() -> {
    try (Jedis jedis = new Jedis("localhost", 6379)) {
        while (true) {
            // BRPOP 返回 [key, value] 列表
            List<String> result = jedis.brpop(0, "task:queue");
            System.out.println("消费: " + result.get(1));
        }
    } catch (Exception e) { e.printStackTrace(); }
}).start();
```

---

### Set（集合）

Set 是无序、不可重复的字符串集合，底层使用 intset 或 hashtable 实现。

#### 典型应用场景

- **去重**：统计独立访客 IP
- **标签系统**：为用户打标签、按标签筛选用户
- **社交关系**：共同好友计算（交集）、关注关系
- **抽奖系统**：随机抽取不重复参与者

#### 常用命令

```bash
# 添加/删除元素
SADD users:online "user:1001" "user:1002"
SREM users:online "user:1001"
SPOP users:online 1            # 随机弹出 1 个元素

# 判断/查看
SISMEMBER users:online "user:1001"  # 判断是否存在（O(1)）
SMEMBERS users:online           # 返回所有元素（慎用！）
SCARD users:online              # 元素数量

# 集合运算
SINTER set1 set2               # 交集
SUNION set1 set2               # 并集
SDIFF set1 set2                # 差集（在 set1 但不在 set2 中）

# 集合运算并存储
SINTERSTORE result set1 set2   # 交集结果存入 result
```

**面试高频场景：共同好友**

```bash
# 用户 A 的好友
SADD user:1001:friends 2001 2002 2003 2004
# 用户 B 的好友
SADD user:2001:friends 1001 3001 3002
# 共同好友
SINTER user:1001:friends user:2001:friends
```

#### 底层编码

| 条件 | 编码 | 说明 |
|------|------|------|
| 所有元素都是整数，且数量 < 512 | intset | 紧凑整数数组，省内存 |
| 其他情况 | hashtable | 哈希表，O(1) 查找 |

```java
// Java 示例：标签系统
public class SetExample {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            // 给文章打标签
            jedis.sadd("article:2001:tags", "Java", "Redis", "面试");
            jedis.sadd("article:2002:tags", "Redis", "分布式", "缓存");

            // 查看某篇文章的标签
            Set<String> tags = jedis.smembers("article:2001:tags");
            System.out.println("文章标签: " + tags);

            // 查找同时包含 "Redis" 和 "Java" 标签的文章
            // 先给标签建文章索引
            jedis.sadd("tag:Redis:articles", "2001", "2002", "2003");
            jedis.sadd("tag:Java:articles", "2001", "2004", "2005");
            // 交集 = 同时有这两个标签的文章
            Set<String> result = jedis.sinter("tag:Redis:articles", "tag:Java:articles");
            System.out.println("同时包含 Redis 和 Java 的文章: " + result);
        }
    }
}
```

---

### ZSet（有序集合，Sorted Set）

ZSet 与 Set 类似，但每个元素关联一个 **score（分数）**，元素按 score 从小到大排序。底层使用 **skiplist（跳表）+ hashtable** 或 **ziplist** 实现。

#### 典型应用场景

- **排行榜**：按积分排名、按热度排序
- **延时队列**：用时间戳做 score，定时扫描过期的任务
- **范围查询**：按分数范围取数据（如价格区间）

#### 常用命令

```bash
# 添加元素
ZADD leaderboard 100 "player1" 200 "player2" 150 "player3"

# 查询排名
ZRANK leaderboard "player2"       # 升序排名（从 0 开始）
ZREVRANK leaderboard "player2"    # 降序排名

# 按排名范围取元素
ZRANGE leaderboard 0 2            # 升序，第 1-3 名
ZREVRANGE leaderboard 0 2         # 降序，第 1-3 名（排行榜最常用）
ZRANGE leaderboard 0 -1 WITHSCORES # 所有元素及其分数

# 按分数范围取元素
ZRANGEBYSCORE leaderboard 100 200       # 分数在 100-200 之间
ZRANGEBYSCORE leaderboard 100 +INF      # 分数 >= 100
ZRANGEBYSCORE leaderboard -INF 200      # 分数 <= 200

# 删除元素
ZREM leaderboard "player1"
ZREMRANGEBYRANK leaderboard 0 0         # 删除排名最低的一个

# 获取分数和元素数
ZSCORE leaderboard "player2"            # 获取分数
ZCARD leaderboard                       # 元素总数
ZCOUNT leaderboard 100 200              # 分数在范围内的数量

# 增加分数（原子操作）
ZINCRBY leaderboard 10 "player2"        # player2 分数 +10
```

#### 排行榜实战

```bash
# 记录玩家得分
ZINCRBY game:ranking 50 "user:1001"
ZINCRBY game:ranking 30 "user:1002"
ZINCRBY game:ranking 80 "user:1003"

# 查看 TOP 3
ZREVRANGE game:ranking 0 2 WITHSCORES

# 返回结果：
# 1) "user:1003"    -- 第一名
# 2) "80"
# 3) "user:1001"    -- 第二名
# 4) "50"
# 5) "user:1002"    -- 第三名
# 6) "30"
```

```java
// Java 排行榜实现
public class LeaderboardExample {
    private static final String LEADERBOARD_KEY = "rank:total";

    public static void addScore(Jedis jedis, String userId, double score) {
        jedis.zincrby(LEADERBOARD_KEY, score, userId);
    }

    public static Set<Tuple> getTopN(Jedis jedis, int n) {
        // ZREVRANGE 降序返回
        return jedis.zrevrangeWithScores(LEADERBOARD_KEY, 0, n - 1);
    }

    public static long getRank(Jedis jedis, String userId) {
        Long rank = jedis.zrevrank(LEADERBOARD_KEY, userId);
        return rank == null ? -1 : rank + 1; // 转成第 1 名开始
    }

    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            addScore(jedis, "Alice", 100);
            addScore(jedis, "Bob", 200);
            addScore(jedis, "Charlie", 150);

            System.out.println("=== 排行榜 TOP 3 ===");
            for (Tuple t : getTopN(jedis, 3)) {
                System.out.println(t.getElement() + ": " + t.getScore());
            }

            System.out.println("Bob 排名: 第 " + getRank(jedis, "Bob") + " 名");
        }
    }
}
```

#### 跳表（Skiplist）实现原理

ZSet 在数据量大时使用跳表作为底层结构。跳表是一种 **多层有序链表**，可以理解为在链表基础上加了"索引层"：

```
  跳表结构示意图（查找 score=66 的元素）

  Level 3 ───────────────────────────────────────────> NULL
                │
  Level 2 ────────────────> 55 ──────────────────────> NULL
                │              │
  Level 1 ───────────> 40 ──────────> 66 ────────────> NULL
                │         │              │
  Level 0 ──> 12 ──> 30 ──> 40 ──> 55 ──> 66 ──> 80 ──> NULL
               (head)

  查找 66 的路径（从 Level 3 开始）：
  ① head(Level 3) → NULL（越过，降级）
  ② head(Level 2) → 55 → NULL（55 小于 66，继续；NULL 越过）
  ③ head(Level 1) → 40 → 66（找到！）
```

**跳表与平衡树对比：**

| 特性 | 跳表 | 红黑树/B+ 树 |
|------|------|-------------|
| 实现难度 | 简单 | 复杂 |
| 范围查询 | 支持（链表天然有序） | 支持 |
| 单点查询 | O(log N) | O(log N) |
| 并发场景 | 锁更少（乐观更新） | 重平衡需要锁 |

---

### Hash（哈希）

Hash 是一个 **field-value（字段-值）映射表**，适合存储对象类型的数据。

#### 典型应用场景

- **对象缓存**：存储用户信息、商品信息等结构化数据
- **计数器分组**：每个网站 ID 的独立计数器

#### 常用命令

```bash
# 设置字段
HSET user:1001 name "张三"
HSET user:1001 age 25
HSET user:1001 city "北京"
HMSET user:1001 name "张三" age 25 city "北京"  # 批量设置

# 获取字段
HGET user:1001 name
HMGET user:1001 name age city          # 批量获取
HGETALL user:1001                       # 获取所有字段和值

# 删除字段
HDEL user:1001 city

# 数字操作
HINCRBY user:1001 age 1                # age +1
HINCRBYFLOAT account:1001 balance 50.5 # 浮点增加

# 其他
HEXISTS user:1001 name                 # 字段是否存在
HLEN user:1001                         # 字段数量
HKEYS user:1001                        # 所有字段名
HVALS user:1001                        # 所有字段值
```

**String vs Hash 存储对象的区别：**

```bash
# String 方式：整个对象序列化为 JSON
SET user:1001 '{"name":"张三","age":25}'
# 缺点：修改单个字段需要整个读取再写入

# Hash 方式：每个字段独立存储
HSET user:1001 name "张三" age 25
# 优点：修改单个字段无需序列化整个对象
# 优点：字段独立过期（但 HSET 本身不支持过期，需配合 EXPIRE）
```

```java
// Java 使用 Hash 缓存对象
public class HashExample {
    static class User {
        String id, name, city;
        int age;
        // constructor, getters/setters omitted
    }

    public static void cacheUser(Jedis jedis, User user) {
        Map<String, String> map = new HashMap<>();
        map.put("name", user.name);
        map.put("age", String.valueOf(user.age));
        map.put("city", user.city);
        jedis.hset("user:" + user.id, map);
        jedis.expire("user:" + user.id, 3600); // 1 小时过期
    }

    public static User getUser(Jedis jedis, String userId) {
        Map<String, String> map = jedis.hgetAll("user:" + userId);
        if (map.isEmpty()) return null;
        User user = new User();
        user.id = userId;
        user.name = map.get("name");
        user.age = Integer.parseInt(map.get("age"));
        user.city = map.get("city");
        return user;
    }
}
```

#### 底层编码：ziplist vs hashtable

当字段数量 < 512 且每个字段名/值长度 < 64 字节时，使用 **ziplist（压缩列表）**，否则切换为 **hashtable（哈希表）**。

```
  ziplist 内存布局（紧凑存储）

  ┌──────┬──────┬──────────┬──────────┬──────────┬──────────┬──────┐
  │zlbytes│zllen │ entry1  │ entry2  │ entry3  │ ...     │ zlend │
  │       │      │(field1) │(value1) │(field2) │         │       │
  └──────┴──────┴──────────┴──────────┴──────────┴──────────┴──────┘

  每个 entry:
  ┌──────────────┬────────────────┬──────────────────┐
  │ prev_len     │ encoding       │ content          │
  │ (前一个entry  │ (编码类型/长度) │ (实际数据)       │
  │  的长度)      │                │                  │
  └──────────────┴────────────────┴──────────────────┘
```

ziplist 的优势是内存连续、节省空间。缺点是插入/删除可能触发级联更新。当数据量增大时，ziplist 的读写性能下降，Redis 会自动将其转换为 hashtable。

---

### 面试技巧与最佳实践

#### 常见面试题

1. **Redis 为什么这么快？**
   - 纯内存操作
   - 单线程模型，避免上下文切换和锁竞争
   - I/O 多路复用（epoll）
   - 数据结构针对场景优化（SDS、ziplist、跳表）

2. **SDS 相比 C 字符串有哪些优势？**
   O(1) 获取长度、杜绝缓冲区溢出、二进制安全、空间预分配减少内存重分配

3. **跳表的查询时间复杂度？**
   O(log N)，平均每层跳过一半节点

4. **ZSet 为什么用跳表而不是红黑树？**
   跳表实现更简单；范围查询更方便（链表结构）；在并发场景更容易做乐观更新

5. **ziplist 为什么能节省内存？**
   连续内存存储，没有额外的指针开销；使用变长编码

#### 面试答题技巧

- 回答数据结构问题时，**先说命令演示，再说底层编码，最后说场景实战**
- 提到跳表时，手动画一个多层结构图（面试官很看重这一点）
- 对比 Hash 和 String 存对象的优劣，展示你有架构选型能力
- 提到 Sorted Set 时，一定说出基于 score 排序和范围查询的能力

#### 实战注意事项

- 慎用 `KEYS *` 命令（生产环境会阻塞 Redis），用 `SCAN` 替代
- 慎用 `SMEMBERS` / `HGETALL` 等返回大量数据的命令
- 批量操作使用 pipeline 提高性能
- 合理设置 Key 命名规范（业务:对象:ID），如 `user:1001:info`
- 控制单个 key 的数据量，避免过大（超过 10MB 考虑拆分）