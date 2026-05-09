## 慢查询排查与调优

### 一、慢查询定位流程

```
慢查询优化完整流程:

[发现慢 SQL]
    ↓
[开启慢查询日志 / 监控告警]
    ↓
[定位具体 SQL]
    ↓
[EXPLAIN 分析执行计划]
    ↓
[查看索引使用情况]
    ↓
[分析 SQL 写法 / Schema 设计]
    ↓
[制定优化方案]
    ├── 索引优化: 加索引 / 重建索引 / 联合索引调整
    ├── SQL 改写: 避免函数操作 / 拆分大查询
    ├── Schema 优化: 分表 / 字段类型调整
    └── 架构优化: 引入缓存 / 读写分离 / 分库分表
    ↓
[验证优化效果]
    └── 再次 EXPLAIN 确认 / 压测验证
```

#### 1.1 开启慢查询日志

```sql
-- ===== 慢查询日志配置 =====

-- 开启慢查询日志 (生产环境建议开启)
SET GLOBAL slow_query_log = ON;

-- 设置慢查询阈值 (单位: 秒)
-- 线上推荐 1 秒, 某些核心接口可以设置 0.1 秒
SET GLOBAL long_query_time = 1;

-- 记录未使用索引的查询 (用于排查索引问题)
SET GLOBAL log_queries_not_using_indexes = ON;

-- 查看配置是否生效
SHOW VARIABLES LIKE 'slow_query_log';
SHOW VARIABLES LIKE 'long_query_time';
SHOW VARIABLES LIKE 'slow_query_log_file';
SHOW VARIABLES LIKE 'log_queries_not_using_indexes';

-- 设置日志文件路径
SET GLOBAL slow_query_log_file = '/var/log/mysql/mysql-slow.log';
```

#### 1.2 使用 pt-query-digest 分析慢日志

```bash
# Percona Toolkit 的 pt-query-digest 是分析慢查询日志的标准工具
pt-query-digest /var/log/mysql/mysql-slow.log > slow_analysis.txt

# 输出包含:
# 1. 总览: 总查询数、总耗时、各类查询占比
# 2. 按响应时间排名的 Top SQL
# 3. 每类 SQL 的详细统计: 执行次数、平均耗时、最大耗时
```

#### 1.3 使用 performance_schema

```sql
-- MySQL 5.7+ 推荐使用 performance_schema (无需重启)

-- 查看最耗时的 SQL Top 10
SELECT DIGEST_TEXT,
       COUNT_STAR AS executions,
       SUM_TIMER_WAIT/1000000000000 AS total_time_sec,
       AVG_TIMER_WAIT/1000000000000 AS avg_time_sec,
       SUM_ROWS_EXAMINED AS rows_examined,
       SUM_ROWS_SENT AS rows_sent,
       (SUM_ROWS_EXAMINED / SUM_ROWS_SENT) AS exam_sent_ratio
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 10;

-- exam_sent_ratio 越大说明扫描的行数远超返回的行数, 需要优化!
-- 如果 ratio > 100, 说明存在严重的"扫描大量行但只返回少数行"的问题
```

#### 1.4 使用 sys 库

```sql
-- MySQL 5.7+ sys 库 (performance_schema 的封装)

-- 查看哪些 SQL 扫描的行数最多
SELECT * FROM sys.statements_with_full_table_scans LIMIT 10;

-- 查看未使用索引的查询
SELECT * FROM sys.statements_with_temp_tables LIMIT 10;

-- 查看执行慢的查询
SELECT * FROM sys.statement_analysis
ORDER BY avg_latency DESC
LIMIT 10;
```

---

### 二、常见慢查询原因深度分析

#### 2.1 索引失效场景大全

```sql
-- 创建测试表
CREATE TABLE user_orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    order_no VARCHAR(32),
    amount DECIMAL(10,2),
    status VARCHAR(20),
    phone VARCHAR(20),
    created_at DATETIME,
    INDEX idx_user_id(user_id),
    INDEX idx_order_no(order_no),
    INDEX idx_created_status(created_at, status),
    INDEX idx_phone(phone)
);

-- ===== 1. 函数操作 =====
-- 失效
EXPLAIN SELECT * FROM user_orders WHERE DATE(created_at) = '2024-01-15';
-- 优化: 用范围查询代替函数
EXPLAIN SELECT * FROM user_orders WHERE created_at >= '2024-01-15 00:00:00' AND created_at < '2024-01-16 00:00:00';

-- 失效
EXPLAIN SELECT * FROM user_orders WHERE LEFT(order_no, 5) = 'ORD01';
-- 优化: 改用 LIKE (右模糊)
EXPLAIN SELECT * FROM user_orders WHERE order_no LIKE 'ORD01%';

-- MySQL 8.0.13+ 支持函数索引
CREATE INDEX idx_date_created ON user_orders((DATE(created_at)));

-- ===== 2. 隐式类型转换 =====
-- phone 列是 VARCHAR, 传入了数字
EXPLAIN SELECT * FROM user_orders WHERE phone = 13800138000;
-- 等价于: CAST(phone AS SIGNED) = 13800138000, 对列用了函数!

-- 优化: 传入字符串类型
EXPLAIN SELECT * FROM user_orders WHERE phone = '13800138000';

-- ===== 3. LIKE 左模糊 =====
EXPLAIN SELECT * FROM user_orders WHERE order_no LIKE '%ORDER123%';
-- 优化: 如果必须做全文搜索, 考虑 Elasticsearch 或 MySQL 全文索引
ALTER TABLE user_orders ADD FULLTEXT INDEX ft_order_no(order_no);
SELECT * FROM user_orders WHERE MATCH(order_no) AGAINST('ORDER123');

-- ===== 4. OR 导致全表扫描 =====
-- idx_user_id 和 idx_phone 分别存在,但 OR 在一起时可能全表扫描
EXPLAIN SELECT * FROM user_orders WHERE user_id = 100 OR phone = '13800138000';
-- 优化: 用 UNION ALL 替代
SELECT * FROM user_orders WHERE user_id = 100
UNION ALL
SELECT * FROM user_orders WHERE phone = '13800138000' AND (user_id != 100 OR user_id IS NULL);

-- 或者: MySQL 5.0+ 的 Index Merge 优化, 但不确定性高

-- ===== 5. 联合索引违反最左前缀 =====
EXPLAIN SELECT * FROM user_orders WHERE status = 'paid';
-- idx_created_status(created_at, status), 跳过了第一列, 索引失效!
-- 优化: 为 status 单独建索引
ALTER TABLE user_orders ADD INDEX idx_status(status);

-- ===== 6. IN + ORDER BY 组合不当 =====
EXPLAIN SELECT * FROM user_orders
WHERE status IN ('paid', 'shipped')
ORDER BY created_at DESC;
-- 可能 filesort! 因为 IN 会产生多个范围, 排序无法使用索引

-- 优化: 去掉 IN, 用 UNION 代替
SELECT * FROM user_orders WHERE status = 'paid' ORDER BY created_at DESC
UNION ALL
SELECT * FROM user_orders WHERE status = 'shipped' ORDER BY created_at DESC;
-- 但最终排序仍然需要合并... 这就是个难题
```

#### 2.2 JOIN 性能问题

```sql
-- 创建两张测试表
CREATE TABLE customers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50),
    email VARCHAR(100),
    created_at DATETIME
);

CREATE TABLE payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT NOT NULL,
    amount DECIMAL(10,2),
    pay_time DATETIME,
    INDEX idx_customer_id(customer_id)
);

-- ===== 驱动表选择 =====

-- 左连接: 左表是驱动表
-- customers 10 万行, payments 500 万行
EXPLAIN SELECT c.name, p.amount
FROM customers c
LEFT JOIN payments p ON c.id = p.customer_id
WHERE c.created_at > '2023-01-01';

-- 内连接: MySQL 自动选择小表做驱动表
-- customers 10 万行, payments 500 万行
EXPLAIN SELECT c.name, p.amount
FROM customers c
INNER JOIN payments p ON c.id = p.customer_id;

-- 查看执行计划中的驱动表: id 字段最小的那个 (或第一个出现的)

-- ===== JOIN 字段必须加索引 =====
-- 如果 JOIN 字段没索引, 被驱动表每次都要全表扫描!
-- 小表 1 万行 × 大表 100 万行 = 需要 1 万 × 100 万 = 100 亿次比较

-- ===== JOIN 过多问题 =====
-- 4 表 JOIN 的性能分析:
EXPLAIN SELECT *
FROM a
JOIN b ON a.id = b.a_id
JOIN c ON b.id = c.b_id
JOIN d ON c.id = d.c_id;
-- 驱动表 a, 逐层 JOIN
-- 如果每张表 10 万行, 且索引都在, 查询量级: 10 万 × 索引查找 × 3
-- 但如果索引缺失, 就变成: 10 万 × 10 万 × 10 万 × 10 万!

-- 最佳实践: 超过 3 张表 JOIN 时考虑重构业务逻辑
```

#### 2.3 子查询性能问题

```sql
-- ===== 低效的子查询 =====

-- 方式 1: IN 子查询
SELECT * FROM customers
WHERE id IN (
    SELECT customer_id FROM payments WHERE amount > 1000
);

-- 方式 2: EXISTS 子查询
SELECT * FROM customers c
WHERE EXISTS (
    SELECT 1 FROM payments p
    WHERE p.customer_id = c.id AND p.amount > 1000
);

-- 方式 3: JOIN 改写 (通常最高效)
SELECT DISTINCT c.*
FROM customers c
INNER JOIN payments p ON c.id = p.customer_id
WHERE p.amount > 1000;

-- ===== 关联子查询 =====
-- 子查询对外层每一行都执行一次
SELECT * FROM orders o
WHERE o.amount > (
    SELECT AVG(amount) FROM orders WHERE customer_id = o.customer_id
);
-- 每行都重新计算 AVG, 效率极低!

-- 优化: 先聚合, 再 JOIN
SELECT o.*
FROM orders o
INNER JOIN (
    SELECT customer_id, AVG(amount) AS avg_amount
    FROM orders
    GROUP BY customer_id
) tmp ON o.customer_id = tmp.customer_id
WHERE o.amount > tmp.avg_amount;
```

#### 2.4 大分页问题 (LIMIT offset 过大)

```sql
-- 分页越往后越慢
SELECT * FROM orders ORDER BY created_at DESC LIMIT 100000, 20;
-- 执行过程:
-- 1. 扫描到第 100020 行
-- 2. 丢弃前 100000 行
-- 3. 只返回 20 行
-- 扫描了大量无用的行!

-- ===== 优化方案 1: 延迟关联 =====
SELECT o.*
FROM orders o
INNER JOIN (
    SELECT id FROM orders
    ORDER BY created_at DESC
    LIMIT 100000, 20
) tmp ON o.id = tmp.id;

-- 子查询能用索引覆盖 (id, created_at), 只需要在索引树中扫描
-- 然后通过主键关联回表取完整数据, 回表次数只有 20 次!

-- 执行计划对比:
-- 优化前: Using index condition; Using filesort
-- 优化后: Using index (子查询) + Using where (外查询)

-- ===== 优化方案 2: 游标分页 (基于游标/指针) =====
-- 适用于"加载更多"、"无限滚动"场景

-- 前端传来上一页最后一个 order 的 created_at 和 id
SELECT * FROM orders
WHERE (created_at < '2024-01-15 10:30:00'  -- 上一页最后一条的时间
    OR (created_at = '2024-01-15 10:30:00' AND id < 1000))  -- 相同时间用 ID 区分
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- 这种方式的优点:
-- 1. 不关心 offset, 直接走索引范围扫描
-- 2. 数据量大时性能稳定
-- 3. 每页查询时间基本一致

-- ===== 优化方案 3: 倒序查询 =====
-- 如果经常需要看"最新"数据, 可以分页反着查
-- 原来: LIMIT 100000, 20 (跳太多页)
-- 倒着来: 从最新时间往前数 20 条
SELECT * FROM orders
ORDER BY created_at DESC
LIMIT 20;  -- 永远只查最新的, 性能好

-- ===== 优化方案 4: 业务降级 =====
-- 对于用户来说, 100 页以后的数据几乎没人看
-- 限制最大翻页数: 只能翻到 100 页
-- 或直接提示"请输入搜索条件精确查找"
```

---

### 三、MySQL 参数调优

#### 3.1 内存相关参数

```ini
# my.cnf 内存相关配置

# 1. Buffer Pool (最重要的参数!)
# 建议: 物理内存的 60%-80%
# 如果是一台 32G 内存的专用 MySQL 服务器:
innodb_buffer_pool_size = 20G

# 2. Buffer Pool 实例数 (减少内部锁竞争)
# 规则: 每个实例至少 1G
innodb_buffer_pool_instances = 8

# 3. redo log 大小
# 建议: 256M-4G, 根据写入量调整
innodb_log_file_size = 1G
innodb_log_files_in_group = 2  # 总共 2G redo log

# 4. redo log 刷盘策略
# 1 = 最安全, 每次提交都刷盘 (默认)
# 2 = 写入 OS cache, 每秒刷盘
innodb_flush_log_at_trx_commit = 1

# 5. 临时表大小
# 超过此大小时, 临时表从内存转到磁盘
tmp_table_size = 64M
max_heap_table_size = 64M

# 6. 排序缓冲区 (每个会话独享, 不宜过大)
sort_buffer_size = 2M
join_buffer_size = 2M

# 7. 连接缓冲区
read_buffer_size = 1M
read_rnd_buffer_size = 1M
```

#### 3.2 连接相关参数

```ini
# 最大连接数
# 不是越大越好, 连接数过高会导致 MySQL 上下文切换频繁
# 根据服务器配置和业务: 200-2000
max_connections = 500

# 连接超时 (空闲连接断开时间, 避免连接池资源浪费)
wait_timeout = 600         # 非交互式连接
interactive_timeout = 600  # 交互式连接

# 连接数过多时的应急方案:
# 设置 admin_address 和 admin_port, 管理员通过专用端口连接
# 即使普通连接耗尽, 管理员还能连上来排查问题
```

#### 3.3 日志相关参数

```ini
# 二进制日志
server-id = 1
log_bin = /var/log/mysql/mysql-bin.log
binlog_format = ROW          # 推荐 ROW 格式
sync_binlog = 1              # 每次写入都刷盘
binlog_expire_logs_seconds = 604800  # 保留 7 天

# 慢查询日志
slow_query_log = ON
slow_query_log_file = /var/log/mysql/mysql-slow.log
long_query_time = 1
log_queries_not_using_indexes = ON
```

#### 3.4 InnoDB 专用调优

```ini
# InnoDB IO 相关
# 如果使用 SSD, 设置 0 (让操作系统自动处理)
innodb_flush_neighbors = 0   # SSD 不需要预读相邻页

# 脏页刷新策略
# 脏页比例达到此值时, 强制刷新
innodb_max_dirty_pages_pct = 75

# 自适应刷新
innodb_adaptive_flushing = ON

# IO 线程数
# SSD 可以设置高一些
innodb_read_io_threads = 8
innodb_write_io_threads = 8

# 双写缓冲区 (保证数据页写入的原子性)
# SSD 上可以考虑禁用(需要确认 SSD 是否支持原子写)
innodb_doublewrite = ON  # 默认开启, 不建议关闭

# 数据页压缩 (节省磁盘空间, 消耗 CPU)
# innodb_compression_level = 6  # 可选
```

---

### 四、Schema 设计优化

#### 4.1 字段类型选择原则

```sql
-- 原则 1: 选择最小的数据类型
-- ❌ BAD: 年龄用 INT (4字节)
age INT NOT NULL,
-- ✅ GOOD: 年龄用 TINYINT UNSIGNED (1字节, 0-255)
age TINYINT UNSIGNED NOT NULL,

-- ❌ BAD: IP 用 VARCHAR(15)
ip VARCHAR(15),
-- ✅ GOOD: IP 用 INT UNSIGNED (4字节, INET_ATON/NTOA 转换)
ip INT UNSIGNED,
-- 查询时: WHERE ip = INET_ATON('192.168.1.1')
-- 展示时: SELECT INET_NTOA(ip) FROM ...

-- 原则 2: 使用 NOT NULL
-- ❌ BAD: 可为空
email VARCHAR(100),
-- ✅ GOOD: 不为空 + 默认值
email VARCHAR(100) NOT NULL DEFAULT '',
-- 理由: NULL 列需要额外的空位标记, 索引也更复杂, 查询时 != 不等于 NULL

-- 原则 3: 选择合适长度
-- ❌ BAD: VARCHAR(255) 但实际只有 10 个汉字
status VARCHAR(255),
-- ✅ GOOD: 按实际需求
status VARCHAR(20) DEFAULT 'pending',

-- 原则 4: 主键选 BIGINT 而非 INT (考虑未来扩展)
-- 如果可能超过 21 亿, 必须用 BIGINT
id BIGINT AUTO_INCREMENT PRIMARY KEY,
```

#### 4.2 索引设计原则

```sql
-- 原则 1: 区分度高的列放在联合索引前面

-- 计算区分度
-- 性别区分度: 2/10000 = 0.0002 (极差)
SELECT COUNT(DISTINCT gender) / COUNT(*) FROM users;

-- 手机号区分度: 几乎为 1 (极好)
SELECT COUNT(DISTINCT phone) / COUNT(*) FROM users;

-- 原则 2: 不为每个列单独建索引, 而是建联合索引
-- ❌ BAD: 三个单列索引
INDEX idx_status(status),
INDEX idx_created(created_at),
INDEX idx_type(type),

-- ✅ GOOD: 一个联合索引
INDEX idx_status_created_type(status, created_at, type),

-- 原则 3: 评估索引数量
-- 索引越多, 写入越慢 (每次 INSERT/UPDATE/DELETE 都要更新索引)
-- 索引越多, 占用空间越大
-- 一般单表索引不超过 5-6 个

-- 原则 4: 删除无用索引
-- 检查冗余索引
SELECT * FROM sys.schema_redundant_indexes;
-- 或:
SELECT * FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'your_db';
```

#### 4.3 反范式设计

```sql
-- 场景: 订单列表需要展示用户名
-- 范式化设计:
CREATE TABLE orders (
    id INT PRIMARY KEY,
    user_id INT NOT NULL,
    amount DECIMAL(10,2),
    created_at DATETIME
);
-- 查询订单列表时需要每次 JOIN users 表
SELECT o.*, u.name FROM orders o JOIN users u ON o.user_id = u.id;

-- 反范式化设计: 冗余用户名字段
CREATE TABLE orders_denormalized (
    id INT PRIMARY KEY,
    user_id INT NOT NULL,
    user_name VARCHAR(50),   -- 冗余字段!
    amount DECIMAL(10,2),
    created_at DATETIME,
    INDEX idx_user_name(user_name)
);

-- 优点: 不需要 JOIN, 查询快
-- 缺点: 用户改名时需要同步更新所有订单

-- 适用场景:
-- 1. 用户几乎不改名
-- 2. 订单列表查询量极大, JOIN 成为瓶颈
-- 3. 可以接受数据最终一致性 (后台异步同步改名)
```

---

### 五、实战案例

#### 案例 1：分页查询从 3 秒优化到 10 毫秒

```sql
-- 优化前 (3+ 秒):
SELECT * FROM orders
WHERE created_at > '2024-01-01'
ORDER BY id
LIMIT 100000, 20;

-- EXPLAIN:
-- type: ALL (全表扫描)
-- Extra: Using filesort
-- rows: 500万

-- 优化后 (10ms):
SELECT o.*
FROM orders o
INNER JOIN (
    SELECT id FROM orders
    WHERE created_at > '2024-01-01'
    ORDER BY id
    LIMIT 100000, 20
) tmp ON o.id = tmp.id;

-- EXPLAIN (子查询):
-- type: range (使用索引范围扫描, 很高效!)
-- Extra: Using index (覆盖索引, 不需要回表)
-- rows: 100020 (只扫描了必要的行)

-- 再对比: 如果业务允许, 用游标分页:
SELECT * FROM orders
WHERE created_at > '2024-01-01' AND id > 100000
ORDER BY id
LIMIT 20;
-- 性能: < 1ms
```

#### 案例 2：JOIN 从 30 秒优化到 0.1 秒

```sql
-- 优化前 (30 秒):
SELECT a.*, b.name, c.title
FROM logs a
JOIN users b ON a.user_id = b.id
JOIN articles c ON a.article_id = c.id
WHERE a.created_at > '2024-01-01'
ORDER BY a.created_at DESC
LIMIT 20;

-- 问题: logs 表 1 亿行, 即使有索引, 临时表排序也需要大量 IO
-- Extra: Using index condition; Using temporary; Using filesort

-- 优化后 (0.1 秒):
-- Step 1: 先只查日志表 (WHERE 条件能用上索引)
-- Step 2: 用子查询延迟关联
SELECT a.*, b.name, c.title
FROM (
    SELECT id, user_id, article_id, created_at
    FROM logs
    WHERE created_at > '2024-01-01'
    ORDER BY created_at DESC
    LIMIT 20
) a
JOIN users b ON a.user_id = b.id
JOIN articles c ON a.article_id = c.id;
-- 子查询只取 20 条, 然后再 JOIN 两次
-- 回表次数: 20 × 2 = 40 次, 非常快!
```

#### 案例 3：用覆盖索引消除排序

```sql
-- 创建联合索引 (确保 ORDER BY 的字段在索引中)
CREATE INDEX idx_status_created ON orders(status, created_at);

-- 查询
SELECT id, order_no, status, created_at
FROM orders
WHERE status = 'paid'
ORDER BY created_at DESC
LIMIT 100;

-- EXPLAIN:
-- type: ref
-- key: idx_status_created
-- Extra: Using index (覆盖索引!)
-- 没有 Using filesort!
-- 因为索引本身就是按 (status, created_at) 排序的,
-- 在索引树中, status='paid' 的部分已经按 created_at 排好序了!
```

---

### 六、面试高频题

1. **你如何优化一个慢查询？**
   先通过慢查询日志定位具体 SQL，然后用 EXPLAIN 分析执行计划。看 type、rows、Extra 字段：
   - type=ALL → 缺索引或有索引未用上
   - rows 太大 → 需要更好的过滤条件
   - Using filesort → ORDER BY 未用索引，需要优化索引
   - Using temporary → 临时表排序/去重，需要优化
   然后针对性加索引、改写 SQL 或重构业务逻辑。

2. **分页查询很慢怎么办？**
   核心是避免扫描大量行。使用延迟关联（先查主键再回表）或游标分页（基于指针而非偏移量）。如果业务允许，限制最大翻页数或引导用户使用搜索。

3. **如何发现 MySQL 的性能瓶颈？**
   使用 `SHOW PROCESSLIST` 看当前运行的查询；用 `performance_schema` 按等待事件排序；用 `SHOW ENGINE INNODB STATUS` 看 InnoDB 内部锁和 IO；配合操作系统工具（top/iostat/vmstat）看资源使用情况。

4. **什么时候用反范式设计？**
   当 JOIN 成为性能瓶颈且字段很少变化时，可以冗余少量字段到主表。接受最终一致性和额外的更新维护成本。

5. **如何选择缓冲区大小？**
   `innodb_buffer_pool_size` 设为物理内存的 60-80%。如果 Buffer Pool 命中率低于 95%（查询 `Innodb_buffer_pool_read_requests / Innodb_buffer_pool_reads`），需要增加。