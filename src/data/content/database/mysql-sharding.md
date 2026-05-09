## 分库分表与读写分离

### 一、为什么要分库分表？

随着业务增长，单库单表会面临以下瓶颈：

| 问题 | 说明 | 影响 |
|------|------|------|
| **容量瓶颈** | 单表数据量过大 (千万/亿级) | B+ 树层数增加, IO 次数增加, 查询变慢 |
| **写入瓶颈** | 单库写入 QPS 达到上限 | 数据库成为性能瓶颈 |
| **连接数耗尽** | 最大连接数 (max_connections) 有限 | 新的请求无法连接 |
| **备份恢复慢** | 大库备份耗时长 | 影响可用性 |
| **索引效率下降** | 大表索引占用大量内存 | Buffer Pool 命中率下降 |

```sql
-- 判断是否需要分表: 查看单表数据量
SELECT
    table_schema,
    table_name,
    ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb,
    table_rows
FROM information_schema.tables
WHERE table_schema = 'your_db'
ORDER BY size_mb DESC;

-- 经验值:
-- 单表 < 500 万行: 通常不需要分表
-- 单表 500 万 ~ 2000 万行: 关注慢查询, 做好索引优化
-- 单表 > 2000 万行: 考虑分表
-- 监控 CPU/IO/连接数判断是否需要分库
```

---

### 二、分库分表策略

#### 2.1 垂直分库

按**业务模块**将不同功能的表拆分到不同的数据库实例中。

```
垂直分库架构:

+--------------------------------------------------+
|                    应用服务                          |
+--------------------------------------------------+
    |            |            |            |
    v            v            v            v
+----------+  +----------+  +----------+  +----------+
| 用户库   |  | 订单库   |  | 商品库   |  | 支付库   |
| db_user  |  | db_order |  | db_product| | db_pay   |
|          |  |          |  |          |  |          |
| users    |  | orders   |  | products |  | payments |
| addresses|  | order_items| | categories| | refunds |
+----------+  +----------+  +----------+  +----------+
    ↑              ↑             ↑            ↑
 独立实例        独立实例      独立实例      独立实例
```

**优点：**
- 业务解耦，不同模块独立扩展
- 单个库的并发压力降低
- 故障隔离（订单库宕机不影响用户查询）

**缺点：**
- 跨库 JOIN 不再可能（需要应用层或 API 组合）
- 分布式事务问题
- 需要额外的数据聚合层

#### 2.2 垂直分表

将一张大表的**大字段**或**不常用字段**拆分到扩展表，减少单行大小，提高查询效率。

```sql
-- 原表: 行很大, 每次查询都要读取大量无用数据
CREATE TABLE articles_full (
    id INT PRIMARY KEY,
    title VARCHAR(200),
    summary VARCHAR(500),
    content TEXT,             -- 大字段, 很少在列表页用到
    author_id INT,
    created_at DATETIME,
    updated_at DATETIME,
    tags VARCHAR(500),
    view_count INT,
    like_count INT
);
-- 单行数据可能超过 10KB, 一页只能存很少的行

-- 垂直分表后:

-- 主表: 只放常用字段
CREATE TABLE articles (
    id INT PRIMARY KEY,
    title VARCHAR(200),
    summary VARCHAR(500),
    author_id INT,
    created_at DATETIME,
    view_count INT,
    like_count INT
);

-- 扩展表: 大字段
CREATE TABLE article_contents (
    article_id INT PRIMARY KEY,
    content TEXT,
    tags VARCHAR(500),
    updated_at DATETIME,
    FOREIGN KEY (article_id) REFERENCES articles(id)
);

-- 列表页查询: 只查主表, 性能好
SELECT id, title, author_id FROM articles ORDER BY created_at DESC LIMIT 20;

-- 详情页查询: 需要内容时再关联扩展表
SELECT a.*, ac.content
FROM articles a
LEFT JOIN article_contents ac ON a.id = ac.article_id
WHERE a.id = 123;
```

#### 2.3 水平分片 (Sharding)

**水平分库：** 将同一张表的数据分布到多个数据库实例中

**水平分表：** 将一张表的数据分布到同一库中的多张表中

```
水平分片架构:

原始表: orders (10 亿行)

水平分库 (4 个库):
+------------------+  +------------------+  +------------------+  +------------------+
| ds_order_0       |  | ds_order_1       |  | ds_order_2       |  | ds_order_3       |
| orders (2.5亿行) |  | orders (2.5亿行) |  | orders (2.5亿行) |  | orders (2.5亿行) |
+------------------+  +------------------+  +------------------+  +------------------+
     shard 0              shard 1              shard 2              shard 3

水平分表 (同一库 4 张表):
+------------------+
| ds_order          |
| orders_0 (2.5亿)  |
| orders_1 (2.5亿)  |
| orders_2 (2.5亿)  |
| orders_3 (2.5亿)  |
+------------------+

也可以同时分库分表: 4 个库 × 4 张表 = 16 个分片
```

**分库分表组合代数：**

```
N 个数据库 × M 张表 = N × M 个分片

示例: 4 库 × 4 表 = 16 个分片

分片规则: shard_id = hash(shard_key) % (N × M)
数据库: db = floor(shard_id / M)
表: table_no = shard_id % M
```

---

### 三、分片策略详解

#### 3.1 取模分片

```sql
-- 取模分片算法
-- shard = key % N

-- 示例: N=4
-- user_id=1  → 1%4=1  → 路由到 db_1
-- user_id=2  → 2%4=2  → 路由到 db_2
-- user_id=5  → 5%4=1  → 路由到 db_1 (和 id=1 同库)

-- 建表示例 (取模分片, 4 个库)
-- db_0:
CREATE TABLE orders LIKE template_orders;
-- db_1:
CREATE TABLE orders LIKE template_orders;
-- db_2:
CREATE TABLE orders LIKE template_orders;
-- db_3:
CREATE TABLE orders LIKE template_orders;
```

**优点：** 数据分布均匀，实现简单

**缺点：** 扩缩容需要迁移数据 (N 变了，大部分数据需要重新分布)

```sql
-- 从 4 个库扩容到 8 个库, 需要迁移:
-- 原来 user_id % 4 = 1 的数据, 现在需要 user_id % 8
-- 只有 user_id % 8 = 1 的留在原库
-- user_id % 8 = 1 的记录需要迁移到新库

-- 迁移量 ≈ N/(M+N) 的数据
-- 4→8 库: 迁移约 50% 的数据
-- 10→12 库: 迁移约 17% 的数据
```

#### 3.2 范围分片

```sql
-- 按时间范围分片
-- db_orders_2024_q1: 2024-01-01 ~ 2024-03-31 的订单
-- db_orders_2024_q2: 2024-04-01 ~ 2024-06-30 的订单

-- 按 ID 范围分片
-- db_0: user_id [1, 1千万]
-- db_1: user_id [1千万+1, 2千万]
-- db_2: user_id [2千万+1, 3千万]

-- 对业务系统来说, 路由规则:
-- user_id <= 10000000 → db_0
-- user_id <= 20000000 → db_1
-- user_id <= 30000000 → db_2
```

**优点：**
- 扩容简单，只需新增分片，无需迁移历史数据
- 范围查询友好（查某段时间的数据，路由到特定分片即可）

**缺点：**
- 数据分布可能不均匀（某些时间范围/ID 范围数据量更大）
- 热点问题（最近时间段的数据访问频繁，形成热点库）

#### 3.3 一致性哈希分片

```
一致性哈希环:

      Hash(v0) ← 虚拟节点
         |
    0 ───┤─── 2^32-1  ─── 虚拟节点 v1
    |         |
    v2 ───┐ ┌─── v3
          | |
    虚拟节点

数据分布:
  key 的 hash 值落在环上, 顺时针找到第一个虚拟节点,
  该虚拟节点映射到物理节点

扩容:
  新增物理节点 → 在环上插入虚拟节点
  只需要迁移该虚拟节点"逆时针"到上一个虚拟节点之间的数据
  迁移量 ≈ 1/N (N 为节点数)
```

**优点：** 扩缩容时迁移数据量最小 (`1/N`)

**缺点：** 实现复杂，可能出现部分不均匀 (通过虚拟节点缓解)

#### 3.4 分片键 (Shard Key) 选择

分片键的选择至关重要，直接决定了查询效率和扩展性。

```sql
-- 场景: 订单表 orders
-- 查询模式 1: 按 user_id 查询用户的订单 → 选择 user_id 作为分片键
-- 查询模式 2: 按 order_id 查询单条订单 → 选择 order_id 作为分片键
-- 混合模式: 两种都要高效 → 引入"基因法"

-- 基因法: 将 user_id 的 hash 值"嵌入"到 order_id 中
-- order_id = 全局唯一 ID (如雪花算法) + user_id 的 hash 后 N 位

-- 这样 order_id 本身就能推导出分片位置, 不需要额外查询路由表
```

```sql
-- 不合适的分片键选择:
-- ❌ 按 gender 分片: 只有男/女, 最多两个分片, 且分布可能极不均匀
-- ❌ 按 status 分片: 大部分订单是"已完成", 数据倾斜严重
-- ❌ 按 created_at 分片: 历史数据冷, 最新数据热

-- 合适的分片键:
-- ✅ user_id: 均匀分布, 用户查询多
-- ✅ order_id: 均匀分布, 单条查询多
-- ✅ customer_id: 类似 user_id
```

---

### 四、ShardingSphere 实战

#### 4.1 ShardingSphere-JDBC 配置

```yaml
# application.yml
spring:
  shardingsphere:
    datasource:
      names: ds0, ds1, ds2, ds3  # 4 个数据源
      ds0:
        url: jdbc:mysql://192.168.1.10:3306/order_db_0
        username: root
        password: 123456
      ds1:
        url: jdbc:mysql://192.168.1.11:3306/order_db_1
        username: root
        password: 123456
      ds2:
        url: jdbc:mysql://192.168.1.12:3306/order_db_2
        username: root
        password: 123456
      ds3:
        url: jdbc:mysql://192.168.1.13:3306/order_db_3
        username: root
        password: 123456

    sharding:
      tables:
        orders:                          # 逻辑表名
          actual-data-nodes: ds$->{0..3}.orders_$->{0..15}  # 实际物理表: 4库×16表=64分片
          table-strategy:                # 分表策略
            inline:
              sharding-column: user_id
              algorithm-expression: orders_$->{user_id % 16}
          database-strategy:             # 分库策略
            inline:
              sharding-column: user_id
              algorithm-expression: ds$->{user_id % 4}
          key-generator:                 # 主键生成策略
            column: order_id
            type: SNOWFLAKE              # 雪花算法
```

```java
// 代码中直接使用 JPA/MyBatis, 无需关心分片逻辑
@Insert("INSERT INTO orders(user_id, amount, status) VALUES(#{userId}, #{amount}, #{status})")
int insert(Order order);

// ShardingSphere 自动根据 user_id 路由到正确的库和表
// userId=123  → ds$->{123%4=3} + orders_$->{123%16=11}
// → 实际写入 ds3.orders_11

@Select("SELECT * FROM orders WHERE user_id = #{userId} AND status = 'paid'")
List<Order> findByUserId(@Param("userId") Long userId);
// 直接路由到单一分片, 高效!

@Select("SELECT * FROM orders WHERE order_id = #{orderId}")
Order findById(@Param("orderId") Long orderId);
// 如果 order_id 也是分片键, 直接路由到单一分片
// 如果 order_id 不是分片键, 需要广播到所有分片 (性能差)
```

#### 4.2 跨分片查询的挑战

```sql
-- 不是所有 SQL 都能高效支持

-- ✅ 带分片键的查询: 路由到单一分片, 高效
SELECT * FROM orders WHERE user_id = 123;

-- ⚠️ 不带分片键的查询: 广播到所有分片, 性能差
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at LIMIT 10;
-- ShardingSphere 会向所有 64 张表发起查询
-- 收到 64 个结果后, 在内存中归并排序取 Top 10
-- 数据量大时内存和网络开销都很大!
```

```sql
-- 跨分片分页问题:
SELECT * FROM orders ORDER BY created_at DESC LIMIT 100000, 20;
-- 每个分片都取 100020 条
-- ShardingSphere 归并 64 × 100020 条数据
-- 在内存中排序取 20 条
-- 问题: 偏移量越大, 性能越差!

-- 优化方案: 使用游标分页
SELECT * FROM orders
WHERE created_at < '2024-01-01 00:00:00'  -- 上一页结束时间
ORDER BY created_at DESC
LIMIT 20;
-- 每个分片取 20 条, 归并后排序, 内存消耗小
```

#### 4.3 分布式主键生成

分库分表后，自增主键不再可用 (多个分片会生成重复 ID)。

```sql
-- 方案 1: 雪花算法 (Snowflake)
-- 64 位 (Long): 1 bit 符号位 + 41 bit 时间戳 + 10 bit 工作机器 + 12 bit 序列号
-- 特点: 趋势递增、全局唯一、高性能

-- 方案 2: 号段模式 (Segment)
-- 从数据库批量获取 ID 段, 应用层分配
-- 如: 获取 [10001, 20000], 应用层从 10001 开始分配
-- 优点: 顺序递增, MySQL 友好

-- 方案 3: UUID
-- 36 位字符串, 完全无序
-- 缺点: 影响 Buffer Pool 热点、占用空间大
-- 不推荐作为数据库主键

-- 方案 4: Redis 自增
-- INCR order_id 获取全局唯一 ID
-- 缺点: 引入 Redis 依赖, 网络开销
```

**ShardingSphere 内置雪花算法配置：**

```yaml
key-generator:
  column: order_id
  type: SNOWFLAKE
  props:
    worker-id: 1  # 每个应用实例分配不同的 worker-id
```

---

### 五、主从复制

#### 5.1 复制原理

```
MySQL 主从复制 (异步) 流程:

+------------------+          +------------------+
|     Master       |          |     Slave        |
|                  |          |                  |
|  Client 写入       |          |  Client 读取      |
|       ↓          |          |      ↑           |
|  +------------+  |          |  +------------+  |
|  | binlog     |  |  拉取    |  | relay log  |  |
|  | (二进制日志)|──┼──────────┼→| (中继日志)  |  |
|  +------------+  |   (IO线程)|  +------------+  |
|                  |          |       ↓           |
|                  |          |  +------------+  |
|                  |          |  | SQL 线程   |  |
|                  |          |  | (回放 relay)|  |
|                  |          |  +------------+  |
|                  |          |       ↓           |
|                  |          |  +------------+  |
|                  |          |  | 数据文件    |  |
|                  |          |  +------------+  |
+------------------+          +------------------+

复制线程:
  Master:
    - 不需要额外线程 (作为普通写入, binlog 自然生成)
    - 为每个 Slave 启动一个 binlog dump 线程

  Slave:
    - IO 线程: 连 Master, 拉取 binlog, 写入 relay log
    - SQL 线程: 从 relay log 读取事件, 在 Slave 上回放
```

#### 5.2 binlog 三种格式

```sql
-- 查看 binlog 格式
SHOW VARIABLES LIKE 'binlog_format';

-- 1. STATEMENT (语句级)
-- 记录 SQL 语句本身
-- 问题: 使用 NOW(), RAND() 等非确定性函数时, 主从数据可能不一致

-- 示例: INSERT INTO t VALUES (NOW());
-- binlog 记录: INSERT INTO t VALUES ('2024-01-01 10:30:00'); -- 固定值

-- 2. ROW (行级) —— 推荐!
-- 记录每一行数据的变更
-- 安全, 主从完全一致
-- 但 binlog 文件较大

-- 示例: UPDATE t SET name='Bob' WHERE id=1;
-- binlog 记录: 将 id=1 行的 name 从 'Alice' 改为 'Bob'

-- 3. MIXED (混合)
-- MySQL 自动选择: 安全时用 STATEMENT, 不安全时自动切换 ROW
```

```sql
-- binlog 相关配置
SHOW VARIABLES LIKE 'sync_binlog';            -- 刷盘策略, 推荐 1 (最安全)
SHOW VARIABLES LIKE 'binlog_expire_logs_seconds'; -- binlog 保留时间, 建议 3600-86400 (1-7天)
SHOW VARIABLES LIKE 'max_binlog_size';        -- 单个 binlog 文件大小, 默认 1G

-- 查看 binlog 文件列表
SHOW BINARY LOGS;

-- 查看 binlog 内容 (需 ROW 格式)
SHOW BINLOG EVENTS IN 'mysql-bin.000001' LIMIT 10;
```

#### 5.3 复制模式对比

```sql
-- 1. 异步复制 (默认)
-- 主库写入 binlog 后立即返回, 不管从库是否同步
-- 优点: 主库性能无影响
-- 缺点: 主库宕机时, 未同步到从库的数据会丢失

-- 2. 半同步复制 (需要安装插件)
-- 主库写入 binlog 后, 等待至少一个从库确认收到
-- 然后才返回客户端成功
-- 优点: 数据丢失概率低
-- 缺点: 主库延迟略增

-- 安装半同步插件
INSTALL PLUGIN rpl_semi_sync_master SONAME 'semisync_master.so';
INSTALL PLUGIN rpl_semi_sync_slave SONAME 'semisync_slave.so';

-- 启用半同步
SET GLOBAL rpl_semi_sync_master_enabled = 1;
SET GLOBAL rpl_semi_sync_slave_enabled = 1;

-- 查看半同步状态
SHOW STATUS LIKE 'Rpl_semi_sync_master_status';
-- ON: 半同步激活; OFF: 回退到异步

-- 3. 全同步复制 (Group Replication)
-- 所有节点都确认后才返回
-- 优点: 数据零丢失
-- 缺点: 性能差, 网络延迟影响大
```

#### 5.4 主从延迟问题

主从延迟是读写分离架构中**最常见的问题**。

```sql
-- 查看主从延迟
SHOW SLAVE STATUS\G
-- Seconds_Behind_Master: 从库落后主库的秒数
-- 正常: 0 或 1-2 秒
-- 异常: 持续增长, 可能是 Slave 性能瓶颈

-- 查看主库 binlog 位置
SHOW MASTER STATUS;
-- File: mysql-bin.000042
-- Position: 123456789

-- 查看从库同步位置 (在 SHOW SLAVE STATUS 结果中)
-- Master_Log_File: mysql-bin.000042
-- Read_Master_Log_Pos: 123456000 (已经拉取到)
-- Exec_Master_Log_Pos: 123400000 (已经回放到)
-- 如果 Read 和 Exec 差距大 → SQL 线程回放慢
-- 如果 Master 和 Read 差距大 → IO 线程拉取慢
```

**主从延迟的解决方案：**

```
+--------------------------------------------------+
|  主从延迟解决方案                                   |
+--------------------------------------------------+     |
|  1. 事务内强制走主库                                |
|     @Transactional(readOnly=false) → 路由到主库    |
|                                                    |
|  2. 实时性要求高的查询走主库                         |
|     if (query.needRealTime) → 主库                 |
|     else → 从库                                     |
|                                                    |
|  3. 短暂等待后重试                                  |
|     try: 从库查询                                   |
|     if (数据不存在 && 刚刚写入)                      |
|        Thread.sleep(100)                            |
|        从库重试                                      |
|                                                    |
|  4. 缓存标记法                                     |
|     写入主库后, 在 Redis 设置标记 (TTL=5s)          |
|     从库查询时检查标记, 存在则读主库                 |
|                                                    |
|  5. 并行复制                                       |
|     slave_parallel_workers > 1                     |
|     slave_parallel_type = LOGICAL_CLOCK            |
|     加快从库回放速度                                 |
+--------------------------------------------------+
```

```sql
-- MySQL 8.0 并行复制配置
-- my.cnf:
-- slave_parallel_workers = 8          # 8 个线程并行回放
-- slave_parallel_type = LOGICAL_CLOCK  # 基于逻辑时钟的并行
```

---

### 六、读写分离

#### 6.1 读写分离架构

```
读写分离架构:

+--------------------------------------------------+
|                    应用层                           |
|  +--------------------------------------------+  |
|  |  ShardingSphere / 数据源路由                  |  |
|  |  INSERT/UPDATE/DELETE → Master              |  |
|  |  SELECT → Slave (或特定标记走 Master)        |  |
|  +--------------------------------------------+  |
+--------------------------------------------------+
               |                    |
    (写: 主库)  v          (读: 从库) v
         +----------+         +----------+
         |  Master  | ←─────→ |  Slave 1 |
         | (读写)   |  复制    | (只读)   |
         +----------+         +----------+
                               +----------+
                               |  Slave 2 |
                               | (只读)   |
                               +----------+
                               +----------+
                               |  Slave N |
                               | (只读)   |
                               +----------+
```

```yaml
# ShardingSphere 读写分离配置
spring:
  shardingsphere:
    datasource:
      names: master, slave1, slave2
      master:
        url: jdbc:mysql://192.168.1.100:3306/db
        username: root
        password: 123456
      slave1:
        url: jdbc:mysql://192.168.1.101:3306/db
        username: root
        password: 123456
      slave2:
        url: jdbc:mysql://192.168.1.102:3306/db
        username: root
        password: 123456

    readwrite-splitting:
      data-sources:
        ds:
          write-data-source-name: master
          read-data-source-names: slave1, slave2
          load-balancer-name: round_robin  # 从库负载均衡策略

    load-balancers:
      round_robin:
        type: ROUND_ROBIN  # 或 RANDOM
```

#### 6.2 强制走主库的场景

```java
// 使用 ShardingSphere 的Hint强制走主库
HintManager hintManager = HintManager.getInstance();
hintManager.setWriteRouteOnly();  // 本次查询强制走主库
try {
    // 实时性要求高的查询
    Order order = orderMapper.findByOrderNo(orderNo);
    return order;
} finally {
    hintManager.close();
}
```

```sql
-- 业务场景: 下单后立即查看订单详情
-- 订单写入主库 → 用户立即查看 → 如果走了从库, 可能因为延迟查不到

-- 解决方案:
-- 1. 第一次查走主库
SELECT * FROM orders WHERE id = 123;  -- 路由到主库

-- 2. 后续查询走从库 (可以接受最终一致性)
SELECT * FROM orders WHERE id = 123;  -- 路由到从库
```

---

### 七、分布式事务

分库分表后，跨库事务成为挑战。

| 方案 | 一致性 | 性能 | 实现复杂度 | 适用场景 |
|------|--------|------|-----------|---------|
| **XA (2PC)** | 强一致 | 低 (同步阻塞) | 中 | 短事务, 低并发 |
| **TCC** | 强一致 | 中 | 高 | 跨服务, 高并发 |
| **本地消息表** | 最终一致 | 高 | 低 | 异步场景 |
| **RocketMQ 事务消息** | 最终一致 | 高 | 中 | 异步场景 |
| **Seata AT** | 强一致 | 中 | 低 | 接入简单的场景 |

```java
// Seata AT 模式示例 - 对业务几乎无侵入
@GlobalTransactional  // 开启分布式事务
public void createOrder(OrderDTO order) {
    // 扣减库存 (库 A)
    stockService.deduct(order.getSkuId(), order.getQuantity());

    // 创建订单 (库 B)
    orderService.create(order);

    // 扣减余额 (库 C)
    accountService.debit(order.getUserId(), order.getAmount());
}
// Seata 自动管理: 全部成功提交 / 任意失败全回滚
```

```sql
-- RocketMQ 事务消息 (最终一致性方案)
-- 1. 发送半消息 (prepare)
-- 2. 执行本地事务 (扣库存+创建订单)
-- 3. 提交/回滚事务消息
-- 4. 消费者消费消息, 执行后续操作

-- 如果步骤 2 失败 → 回滚消息, 消费者不执行
-- 如果步骤 2 成功但步骤 3 超时 → RocketMQ 回调检查本地事务状态
-- 保证: 本地事务和消息发送的最终一致性
```

---

### 八、面试高频题

1. **分库分表后，跨分片 ORDER BY / GROUP BY / JOIN 如何处理？**
   中间件在各分片执行子查询后，在内存中归并。数据量大时性能差，建议避免。通过合理的设计，如预先聚合、宽表冗余等手段减少跨分片操作。

2. **如何做平滑扩容？**
   前置代理层做路由规则迁移、双写方案、灰度切流。核心原则：先扩容读能力，再扩容写能力，最终完成数据迁移。

3. **主从延迟如何监控？**
   `SHOW SLAVE STATUS` 的 `Seconds_Behind_Master` 是基础指标，还需监控 `Relay_Log_Space`、`Slave_IO_Running`、`Slave_SQL_Running`。建议用 Prometheus + 业务指标监控（如"写入后查不到"的比例）。

4. **分片键如何选择？**
   (1) 业务查询频率最高的字段；(2) 数据分布均匀的字段；(3) 一旦确定不要轻易更改。常见选择：user_id、order_id、customer_id。