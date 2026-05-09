## MySQL 体系结构与存储引擎

### 一、MySQL 整体架构分层

MySQL 采用 C/S 架构，分为四层：**连接层、服务层、存储引擎层、文件系统层**。下面这张 ASCII 图展示了完整的架构：

```
+------------------------------------------------------------------+
|                         MySQL 架构总览                           |
+------------------------------------------------------------------+
|  客户端连接: 应用 (JDBC/ODBC) | 命令行 | GUI 工具                |
+------------------------------------------------------------------+
|  连接层: 连接池 / 认证 / SSL / 线程复用                          |
|  +------------------------------------------------------------+ |
|  | 线程处理: 每个连接分配一个线程 (或线程池)                   | |
|  | 验证: 用户名 + 密码 + 主机白名单 + SSL 握手                | |
|  +------------------------------------------------------------+ |
+------------------------------------------------------------------+
|  服务层 (Server Layer)                                           |
|  +------------------------------------------------------------+ |
|  | 连接池/线程管理                                               | |
|  |    ↓                                                          | |
|  | SQL 接口: 接收 SQL, 处理存储过程/触发器/视图                  | |
|  |    ↓                                                          | |
|  | 查询缓存 (Query Cache) — MySQL 8.0 已移除                    | |
|  |    ↓                                                          | |
|  | 解析器 (Parser): 词法分析 → 语法分析 → 解析树               | |
|  |    ↓                                                          | |
|  | 优化器 (Optimizer): 基于成本的优化 → 执行计划                | |
|  |    ↓                                                          | |
|  | 执行器 (Executor): 调用存储引擎 API, 返回结果                | |
|  +------------------------------------------------------------+ |
+------------------------------------------------------------------+
|  存储引擎层 (Pluggable Storage Engine)                           |
|  +------------------+  +------------------+  +----------------+  |
|  |    InnoDB        |  |    MyISAM        |  |   Memory/其他  |  |
|  | - 事务 (ACID)    |  | - 不支持事务     |  | - 内存表       |  |
|  | - 行锁           |  | - 表锁           |  | - 临时表       |  |
|  | - MVCC           |  | - 全文索引       |  | - 速度快       |  |
|  | - 聚簇索引       |  | - 压缩表         |  | - 重启数据丢   |  |
|  +------------------+  +------------------+  +----------------+  |
+------------------------------------------------------------------+
|  文件系统层: 数据文件 (ibd/frm/MYD/MYI) | 日志文件 (binlog/redo/undo) |
+------------------------------------------------------------------+
```

#### 1. 连接层 (Connection Layer)

客户端与 MySQL 建立连接的过程：

```sql
-- 客户端发起连接命令
mysql -h 192.168.1.100 -P 3306 -u root -p
```

连接层内部维护一个 **连接池/线程池**，负责以下工作：
- **身份验证**：校验用户名/密码，检查主机白名单
- **SSL/TLS 加密**：可配置 SSL 连接防止中间人攻击
- **线程分配**：每个连接映射到一个线程 (one-thread-per-connection 模式)，或使用线程池复用
- **连接数控制**：通过 `max_connections` 参数限制最大连接数

```sql
-- 查看当前连接数
SHOW STATUS LIKE 'Threads_connected';
-- 查看最大连接数配置
SHOW VARIABLES LIKE 'max_connections';
-- 查看各连接状态
SHOW PROCESSLIST;
```

#### 2. 服务层 (Server Layer)

服务层是 MySQL 的核心，涵盖 SQL 从接收到结果返回的完整处理流程：

**第一步：SQL 接口**
- 接收客户端发送的 SQL 语句
- 处理 DML / DDL / DCL / 存储过程调用

**第二步：查询缓存 (仅 MySQL 5.7 及更早)**
- MySQL 8.0 已彻底移除查询缓存功能
- 之前的问题：缓存失效频繁，并发下性能反而更差

**第三步：解析器 (Parser)**

解析器做两件事：
1. **词法分析**：将 SQL 拆分成不可再分的单词 (token) —— 识别出关键字 (SELECT/FROM/WHERE)、表名、列名、操作符
2. **语法分析**：根据 MySQL 语法规则检查 SQL 是否合法，生成 **解析树 (Parse Tree)**

```sql
-- 示例 SQL
SELECT u.name, o.amount
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.amount > 100
  AND u.status = 'active'
ORDER BY o.created_at DESC
LIMIT 20;
```

解析器看到这条 SQL 后，会校验：
- `users`、`orders` 表是否存在
- `name`、`amount`、`id`、`user_id`、`status`、`created_at` 列是否存在
- 语法是否合法（SELECT 后面有没有 FROM，JOIN 条件是否合法等）

**第四步：优化器 (Optimizer)**

优化器基于**代价模型 (Cost Model)** 选择最佳执行计划。它会考虑：
- 使用哪个索引？全表扫描还是索引扫描？
- 多表 JOIN 时，先查哪张表？（驱动表选择）
- 子查询如何改写？能否转化为 JOIN？
- 是否使用索引下推 (ICP)？
- 是否使用覆盖索引？

```sql
-- 查看优化器选择的执行计划
EXPLAIN FORMAT=JSON
SELECT u.name, o.amount
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.amount > 100;
```

输出中会显示 `cost_info`，可以看到优化器估算的代价：

```json
{
  "query_cost": "12654.23",
  "cost_info": {
    "read_cost": "12500.00",
    "eval_cost": "154.23",
    "prefix_cost": "12654.23",
    "data_read_per_join": "2M"
  }
}
```

**第五步：执行器 (Executor)**

执行器根据执行计划，按顺序调用存储引擎 API 获取数据，处理后将结果返回给客户端。

```sql
-- 跟踪执行过程 (MySQL 5.7+)
SET optimizer_trace='enabled=on';
SELECT ...; -- 你的查询
SELECT * FROM information_schema.OPTIMIZER_TRACE;
SET optimizer_trace='enabled=off';
```

#### 3. 存储引擎层 (Storage Engine Layer)

MySQL 使用 **插件式架构**，支持多种存储引擎。默认且使用最广泛的是 **InnoDB**。

```sql
-- 查看当前 MySQL 支持的存储引擎
SHOW ENGINES;

-- 查看默认存储引擎
SHOW VARIABLES LIKE 'default_storage_engine';

-- 查看某张表的存储引擎
SHOW TABLE STATUS WHERE Name = 'your_table';

-- 创建表时指定存储引擎
CREATE TABLE example (
    id INT PRIMARY KEY,
    name VARCHAR(50)
) ENGINE=InnoDB;

-- 修改已有表的存储引擎
ALTER TABLE example ENGINE=MyISAM;
```

#### 4. 文件系统层 (File System Layer)

数据最终存储在磁盘上，主要文件类型：

| 文件类型 | 扩展名 | 说明 |
|---------|--------|------|
| 表空间文件 | .ibd | InnoDB 表数据和索引 (独立表空间) |
| 共享表空间 | ibdata1 | 系统表空间，存储数据字典、undo log 等 |
| 重做日志 | ib_logfile0/1 | redo log，保证事务持久性 |
| 二进制日志 | binlog.xxxxxx | 记录所有数据变更，用于复制和恢复 |
| 错误日志 | hostname.err | 错误、警告、启动关闭信息 |
| 慢查询日志 | hostname-slow.log | 记录超过 long_query_time 的 SQL |

---

### 二、InnoDB 存储引擎深度解析

#### 2.1 核心特性

InnoDB 相比其他存储引擎有五大核心能力：

```sql
-- 验证 InnoDB 特性：事务支持
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT; -- 要么都成功，要么都回滚

-- 验证行级锁 (两个会话分别执行)
-- 会话 A:
BEGIN;
UPDATE orders SET status = 'paid' WHERE id = 100;

-- 会话 B: 可以更新其他行，不会阻塞
UPDATE orders SET status = 'cancelled' WHERE id = 200;
-- 但如果尝试更新同一行，会被阻塞直到会话 A 提交

-- 外键约束
CREATE TABLE orders (
    id INT PRIMARY KEY,
    user_id INT,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### 2.2 缓冲池 (Buffer Pool)

Buffer Pool 是 InnoDB 性能的核心。它是一块内存区域，用于缓存数据页和索引页，避免每次读写都访问磁盘。

**Buffer Pool 的 LRU 变体算法：**

```
+------------------------------------------------------------------+
|  Buffer Pool 内存结构 (LRU 链表)                                  |
+------------------------------------------------------------------+
|  新子列表 (New Sublist / Young)          | 旧子列表 (Old Sublist) |
|  热点数据 (频繁访问)                     | 冷数据 (仅扫描一次)    |
|                                          |                        |
|  [热端] ← ... ← [中间] → ... → [旧端]   | 默认占 37% (由        |
|  每次访问移到链表头部                     | innodb_old_blocks_pct |
|                                          | 控制)                  |
|                                          |                        |
|  → 数据首次读入放在旧子列表头部          |                        |
|  → 如果在旧子列表停留超过                |                        |
|    innodb_old_blocks_time (默认1秒)      |                        |
|    再次访问才移到新子列表                |                        |
|  → 这样避免全表扫描数据"污染"热点        |                        |
+------------------------------------------------------------------+
```

**关键参数：**

```sql
-- 查看 Buffer Pool 大小 (建议设为物理内存的 60%-80%)
SHOW VARIABLES LIKE 'innodb_buffer_pool_size';

-- 查看 Buffer Pool 命中率
SHOW STATUS LIKE 'Innodb_buffer_pool_read%';

-- 计算命中率:
-- Innodb_buffer_pool_read_requests / (Innodb_buffer_pool_read_requests + Innodb_buffer_pool_reads)
-- 应该 > 99%, 如果低于 95% 说明 buffer pool 太小

-- 调整 Buffer Pool 大小 (my.cnf)
-- [mysqld]
-- innodb_buffer_pool_size = 8G
-- innodb_buffer_pool_instances = 8  -- 拆分为多个实例减少锁竞争
```

**Change Buffer (写缓冲)：**

当修改**非唯一二级索引**的页面不在 Buffer Pool 中时，InnoDB 不立即从磁盘加载该页，而是将修改缓存在 Change Buffer 中。等后续读取该页时，再将这些修改合并 (merge) 进去。

```
+------------------------------------------------------------------+
|  Change Buffer 工作流程                                          |
+------------------------------------------------------------------+
|                                                                  |
|  执行 UPDATE 修改二级索引                                          |
|       ↓                                                           |
|  (1) 目标页在 Buffer Pool 中?                                     |
|      ├── 是 → 直接修改 Buffer Pool 中的页                         |
|      └── 否 → 将修改记录到 Change Buffer                          |
|                                                                  |
|  后续读该二级索引页时:                                            |
|       ↓                                                           |
|  (2) 从磁盘加载页到 Buffer Pool                                   |
|  (3) 从 Change Buffer 中合并 (merge) 未应用的修改                 |
|  (4) 读取最新数据                                                 |
|                                                                  |
|  优点: 避免每次修改都随机读盘, 显著提升 DML 性能                  |
|  限制: 仅对非唯一二级索引生效 (唯一索引必须先读盘检查唯一性)      |
+------------------------------------------------------------------+
```

```sql
-- 查看 Change Buffer 配置
SHOW VARIABLES LIKE 'innodb_change_buffer_max_size';  -- 占 Buffer Pool 百分比, 默认 25
SHOW VARIABLES LIKE 'innodb_change_buffering';         -- 默认 'all'

-- 查看 Change Buffer 使用统计
SHOW ENGINE INNODB STATUS\G
-- 搜索 "INSERT BUFFER AND ADAPTIVE HASH INDEX" 段落
```

#### 2.3 Adaptive Hash Index (自适应哈希索引)

InnoDB 监控索引页的访问模式，如果发现频繁通过 B+ 树 "某一特定值" 访问，会自动在该索引上构建哈希索引，实现 O(1) 的直接查找。

```sql
-- 查看 AHI 状态
SHOW VARIABLES LIKE 'innodb_adaptive_hash_index';  -- 默认 ON

-- 完全禁用 (极端场景: 高并发下 AHI 可能成为瓶颈)
-- SET GLOBAL innodb_adaptive_hash_index = OFF;
```

---

### 三、InnoDB vs MyISAM 对比

| 特性 | InnoDB | MyISAM |
|------|--------|--------|
| **事务 (ACID)** | 支持 | 不支持 |
| **锁粒度** | 行锁 (record/gap/next-key) | 表锁 |
| **外键** | 支持 | 不支持 |
| **聚簇索引** | 是 (主键即聚簇索引) | 否 (索引和数据分开) |
| **MVCC** | 支持 | 不支持 |
| **全文索引** | 支持 (InnoDB 1.2+, MySQL 5.6+) | 支持 |
| **数据压缩** | 支持 (透明页压缩) | 支持 (压缩表, MyISAM 特有) |
| **缓存** | Buffer Pool 缓存数据和索引 | Key Cache 只缓存索引 |
| **文件** | .frm + .ibd (或 ibdata) | .frm + .MYD + .MYI |
| **崩溃恢复** | 支持 (redo log) | 不支持 (需修复) |
| **count(*)** | 需要全表或索引扫描 | 直接读取缓存的行数 |
| **适用场景** | OLTP, 事务性业务 | 只读或读多写少的日志/统计 |

```sql
-- MyISAM 快速 count(*) 示例
CREATE TABLE log_table (
    id INT AUTO_INCREMENT PRIMARY KEY,
    message TEXT,
    created_at TIMESTAMP
) ENGINE=MyISAM;

-- MyISAM 维护了精确的行数, 下面的查询瞬间返回
SELECT COUNT(*) FROM log_table;  -- 非常快

-- InnoDB 需要扫描, 但可以通过二级索引优化
CREATE INDEX idx_created ON log_table(created_at);
SELECT COUNT(*) FROM log_table;  -- 会使用 idx_created
```

**面试高频题: 为什么 InnoDB 不缓存行数？**
因为 InnoDB 支持 MVCC 和事务隔离，不同事务看到的行数可能不同，缓存一个全局行数在并发下无法保证一致性。MyISAM 不支持事务，所以可以缓存。

---

### 四、一条 SQL 的完整执行过程 (实战案例)

假设执行这条查询：

```sql
SELECT u.name, o.amount
FROM users u
INNER JOIN orders o ON u.id = o.user_id
WHERE o.amount > 100
ORDER BY o.amount DESC
LIMIT 5;
```

**逐步执行过程：**

```
Step 1: 连接层
  - 客户端与 MySQL 建立 TCP 连接 (MySQL 默认端口 3306)
  - 校验用户名密码
  - 获取该用户的权限信息
  - 分配线程处理该连接

Step 2: SQL 接口
  - 接收 SQL 文本: "SELECT u.name, o.amount FROM ..."
  - 判断是否为 SELECT, 是否可路由到查询缓存 (8.0 跳过)

Step 3: 解析器
  - 词法分析: 识别 SELECT/FROM/INNER JOIN/WHERE/ORDER BY/LIMIT
  - 语法分析: 构建语法树
  - 元数据校验: 检查 users 有 name 列, orders 有 amount 和 user_id 列

Step 4: 预处理器
  - 解析表名和列名的实际含义 (如 u.name → users.name)
  - 检查权限: 当前用户是否有 users 和 orders 的 SELECT 权限

Step 5: 优化器 (关键)
  - 统计信息收集: 查看两张表的行数、索引分布
  - 计算代价:
    - 方案 A: 全表扫描 users (1000行) → 走索引查找 orders (100万行中查找)
    - 方案 B: 全表扫描 orders (100万行) → 走索引查找 users
    - 方案 C: 先对 orders.amount > 100 做索引范围扫描 → 再回表查 users
  - 最终选择代价最小的方案

Step 6: 执行器
  - 根据执行计划顺序执行:
    a. 调用 InnoDB 接口扫描 users 表 (驱动表)
    b. 对每一行, 调用 InnoDB 接口通过索引查找匹配的 orders
    c. 检查 amounts > 100 条件
    d. 将结果放入临时表 (若有 ORDER BY 且无法使用索引排序)
  - 排序: 对结果按 amount DESC 排序
  - LIMIT: 取前 5 条

Step 7: 返回结果
  - 将结果集编码 (ProtocolText/ProtocolBinary)
  - 通过连接发送给客户端
  - 如果开启查询日志, 记录到 general_log
```

---

### 五、实践与面试指南

**企业实践中如何选择存储引擎：**

- **核心业务表（用户、订单、支付）**：必须 InnoDB，需要事务和行锁
- **日志、流水、审计表**：可以考虑 InnoDB（MySQL 8.0 后 MyISAM 已不推荐）
- **临时中间表**：Memory 引擎
- **全文搜索场景**：优先使用 Elasticsearch，而非 MySQL 全文索引

**常见面试题：**

1. **Buffer Pool 的 LRU 算法和普通的 LRU 有什么区别？**
   普通 LRU 会被全表扫描"污染"——扫描一个大表会把热点数据挤出。InnoDB 将链表分为新旧两个子列表，新读入的页放在旧子列表头部，第二次访问后才移入新子列表，避免扫描污染。

2. **MySQL 8.0 为什么移除查询缓存？**
   查询缓存粒度过粗（整张表），表上有任何更新就会使该表所有缓存失效。在高并发写入场景下，缓存失效的开销反而比不用缓存还大。因此 MySQL 8.0 彻底移除了。

3. **为什么 InnoDB 推荐使用自增主键？**
   聚簇索引按主键顺序存储。自增主键保证插入顺序递增，新数据直接追加在 B+ 树末尾，不需要频繁分裂页。UUID 或业务主键会导致随机插入，引起大量页分裂和碎片。

4. **COUNT(*) 在 InnoDB 和 MyISAM 中的区别？**
   MyISAM 存储了行数计数器，直接返回。InnoDB 因为 MVCC 无法缓存行数，需要扫描索引行。建议对频繁的 COUNT(*) 用 Redis 维护计数器，或使用二级索引（通常比聚簇索引小，扫描更快）。