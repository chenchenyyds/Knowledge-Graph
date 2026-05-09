## 索引原理与 SQL 优化

### 一、索引的本质

索引是一种**以空间换时间**的数据结构，通过减少查询需要扫描的数据量来加速检索。MySQL 中索引的本质是一个排好序的、能够快速查找的数据结构。

如果没有索引，查找数据就像在一本没有目录的书里逐页翻找：

```sql
-- 无索引: 全表扫描, 需要读取所有数据页
SELECT * FROM users WHERE name = '张三';
-- 假设 users 表有 1000 万行, 平均每页 100 行
-- 就需要读取 10 万页, 即使只返回 1 行
```

有了索引，就可以像通过目录快速定位页码一样：

```sql
-- name 上有 B+ 树索引
-- 只需要 3-4 次 B+ 树查找就能定位到目标数据页
SELECT * FROM users WHERE name = '张三';
```

---

### 二、B+ 树索引

#### 2.1 B+ 树数据结构

B+ 树是 MySQL 中最常用的索引结构，下图展示了一棵简单的 B+ 树：

```
                   +-----------+
                   |    50     |        ← 非叶子节点 (内部节点)
                   +-----+-----+
                         |
            +------------+------------+
            |                         |
      +-----v-----+           +------v------+
      |   20   40  |           |   70   90   |  ← 非叶子节点
      +-----+-----+           +------+------+
            |                         |
   +--------+--------+        +-------+-------+
   |        |        |        |       |       |
+--v--+  +--v--+  +--v--+  +--v--+ +--v--+ +--v--+
|1,5, |  |21,25|  |41,45|  |51,55| |71,75| |91,95|  ← 叶子节点 (有序双向链表)
| 12  |  | 30  |  | 48  |  | 68  | | 78  | | 100 |
+-----+  +-----+  +-----+  +-----+ +-----+ +-----+
  |        |        |        |       |       |
  v        v        v        v       v       v
 数据页    数据页    数据页    数据页   数据页   数据页
```
                                                     ＜── 叶子节点之间有双向链表指针

**B+ 树的核心特性：**

1. **非叶子节点只存储键值 (索引列的值)**，不存储数据，这样可以容纳更多键值，降低树的高度
2. **叶子节点存储数据 (或指向数据行的主键)**，所有数据都在同一层
3. **叶子节点之间通过双向链表连接**，支持高效的范围查询和排序
4. **树的高度通常为 3-4 层**，3 层 B+ 树可以存储数千万条记录

**高度计算示例：**
- 假设每个非叶子节点页能存储约 1200 个键值 (MySQL 默认页 16KB，键值约 13-14 字节)
- 叶子节点页每行约 200 字节，每页可存约 80 行
- 高度为 3 时：1200 × 1200 × 80 ≈ 1.15 亿行

```sql
-- 估算 InnoDB B+ 树高度
-- 通过查询索引的物理信息
SHOW TABLE STATUS LIKE 'users'\G
-- 查看 Index_length: 索引页的总字节数

-- 估算公式:
-- 非叶子节点扇出 ≈ 16KB / (索引键大小 + 6字节指针)
-- 假设 INT 主键 (4字节) + 指针 (6字节) = 10字节
-- 扇出 ≈ 16384 / 10 ≈ 1638
-- 高度 2: 1638^2 = 268万
-- 高度 3: 1638^3 = 44亿
```

#### 2.2 B+ 树 vs B 树 vs 二叉查找树

| 特性 | 二叉查找树 | B 树 | B+ 树 |
|------|-----------|------|-------|
| 每个节点子节点数 | 最多 2 个 | 多个 (M 阶有 M-1 个键) | 多个 (同 B 树) |
| 非叶子节点是否存数据 | 是 | 是 | **否** (只存键) |
| 叶子节点是否连成链表 | 否 | 否 | **是** |
| 树高 (1000万数据) | ~24 层 | ~3-4 层 | ~3 层 |
| 磁盘 IO 次数 | ~24 次 | ~3-4 次 | ~3-4 次 |
| 范围查询效率 | 需要多次回溯 | 需要多次回溯 | 叶子链表顺序访问，极高 |
| 查询稳定性 | 不稳定 | 不稳定 | **稳定** (必须到叶子) |

**为什么不用二叉树？**
- 1000 万数据，二叉树高度约 24，需要 24 次磁盘 IO
- 磁盘 IO 是最慢的操作，B+ 树只需要 3-4 次

**为什么不用哈希索引？**
- 哈希索引只支持等值查询 (=, IN)，不支持范围查询
- 哈希冲突时性能退化严重
- 不支持 ORDER BY 排序

#### 2.3 B+ 树查找过程

```sql
-- 假设在 users 表的 id (主键) 上有 B+ 树索引
-- 查询: 查找 id = 50 的用户

-- 查找过程:
-- 1. 从根节点开始 (第一次磁盘 IO)
--   根节点存储 [20, 40, 60, 80] 等键值
--   50 > 40 且 50 < 60 → 进入对应的子节点指针

-- 2. 进入第二层节点 (第二次磁盘 IO)
--   该节点有 [41, 45, 48, 52]
--   50 > 48 且 50 < 52 → 进入对应的子节点指针

-- 3. 进入叶子节点 (第三次磁盘 IO)
--   叶子节点包含: 50 对应的完整行数据 (聚簇索引)
--   或: 50 对应的主键值 (二级索引, 需要再回表)
```

```sql
-- 范围查询: 查找 id 在 30 到 50 之间的用户
SELECT * FROM users WHERE id BETWEEN 30 AND 50;

-- B+ 树执行过程:
-- 1. 先查找 id=30 的叶子节点 (3-4 次 IO)
-- 2. 从该叶子节点开始，顺着双向链表向后扫描
-- 3. 直到第一个 id>50 的节点停止
-- 4. 范围越大扫描的叶子节点越多
```

---

### 三、聚簇索引 vs 二级索引

#### 3.1 聚簇索引 (Clustered Index)

InnoDB 中，**表数据本身就是按聚簇索引组织的**（索引组织表）。每张表必须有且只有一个聚簇索引。

**聚簇索引的规则：**
1. 有主键 → 主键就是聚簇索引
2. 没有主键 → 第一个非空 UNIQUE 列做聚簇索引
3. 都没有 → InnoDB 自动生成 6 字节的 ROWID 作为隐藏聚簇索引

```
+------------------------------------------------------+
|  聚簇索引结构示意图                                   |
+------------------------------------------------------+
|  B+ 树索引                                            |
|                                                       |
|  非叶子节点 (只存主键值)                               |
|    [1] → [4] → [7] → [10] → [15] → ...              |
|                                                       |
|  叶子节点 (存储完整行数据)                             |
|  +----------------------------------------------+    |
|  | 主键: 1                                        |    |
|  | name: "张三"  age: 25  email: z@ex.com         |    |
|  | address: "北京"  phone: "138xxxx"              |    |
|  | created_at: 2024-01-01                         |    |
|  +----------------------------------------------+    |
|  | 主键: 4                                        |    |
|  | name: "李四"  age: 30  email: l@ex.com         |    |
|  | ...                                           |    |
|  +----------------------------------------------+    |
|                                                       |
|  【叶子节点之间是双向链表, 按主键排序】               |
+------------------------------------------------------+
```

**聚簇索引的优点：**
- 数据按主键顺序存储，范围查询极快
- 通过主键查找数据只需要一次 B+ 树遍历
- 二级索引回表时，通过主键查找数据比随机 IO 快（主键有序）

**聚簇索引的缺点：**
- 如果主键不是自增的（如 UUID），插入会导致频繁的页分裂和碎片
- 更新主键代价大（需要移动整行数据）
- 二级索引的叶子节点存的是主键值，**主键越大，二级索引占用的空间越大**

#### 3.2 二级索引 (Secondary Index / 辅助索引 / 非聚簇索引)

二级索引的叶子节点不存数据，而是存储**主键值**。通过二级索引查询数据需要**回表 (bookmark lookup)**。

```
+------------------------------------------------------+
|  二级索引 (idx_name) 结构示意图                        |
+------------------------------------------------------+
|                                                       |
|  非叶子节点 (存 name 值)                               |
|   ["Alice"] → ["Bob"] → ["Charlie"] → ...            |
|                                                       |
|  叶子节点 (存 name + 对应的主键)                      |
|  +----------------------------------------------+    |
|  | name: "Alice"  → 主键: 15                      |    |
|  +----------------------------------------------+    |
|  | name: "Bob"    → 主键: 7                       |    |
|  +----------------------------------------------+    |
|  | name: "Charlie" → 主键: 23                     |    |
|  +----------------------------------------------+    |
|  【叶子节点按 name 排序】                               |
+------------------------------------------------------+
```

**回表查询过程：**

```sql
-- 创建测试表
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,      -- 聚簇索引
    name VARCHAR(50),
    age INT,
    email VARCHAR(100),
    created_at DATETIME
);

-- 在 name 上创建二级索引
CREATE INDEX idx_name ON users(name);

-- 查询: 通过 name 查找
SELECT * FROM users WHERE name = 'Alice';

-- 执行过程:
-- 1. 在 idx_name 索引树上查找 name='Alice'
--    叶子节点找到主键值: id=15
-- 2. 拿着 id=15 回聚簇索引树查询
--    聚簇索引查找 id=15 的完整行数据
-- 3. 返回结果 → 总共 4-6 次磁盘 IO (两个 B+ 树各 2-3 次)
```

#### 3.3 覆盖索引 (Covering Index)

如果查询所需的列**全部在二级索引中**，就不需要回表，这就是**覆盖索引**。

```sql
-- 创建联合索引
CREATE INDEX idx_name_age ON users(name, age);

-- 覆盖索引查询: 不需要回表!
SELECT name, age FROM users WHERE name = 'Alice';
-- 执行过程:
-- 在 idx_name_age 索引树上直接找到 name='Alice' 的节点
-- 叶子节点包含 name 和 age, 直接返回
-- 不需要回表! (可见 Extra='Using index')

-- 对比: 需要回表的查询
SELECT name, age, email FROM users WHERE name = 'Alice';
-- email 不在 idx_name_age 索引中, 需要回表查完整行
-- Extra 中显示 NULL (不显示 Using index)
```

```sql
-- 验证是否使用覆盖索引
EXPLAIN SELECT name, age FROM users WHERE name = 'Alice';
-- Extra: Using index   ← 这就是覆盖索引的标志

EXPLAIN SELECT * FROM users WHERE name = 'Alice';
-- Extra: NULL  (没有 Using index, 说明需要回表)
```

---

### 四、索引类型详解

#### 4.1 联合索引 (Composite Index / 多列索引)

联合索引按定义时从左到右的顺序建立 B+ 树，键值按定义的第一列、第二列...逐层排序。

**联合索引的物理结构：**

```
idx_name_age_city (name, age, city) 的 B+ 树:
                      |
               [Alice,20,北京] ─→ [Bob,25,上海] ─→ [Charlie,30,广州]
                        |
                 叶子节点按 (name, age, city)
                 字典序排列:
                 (Alice,20,北京) < (Alice,20,广州) < (Alice,25,上海)
```

#### 4.2 最左前缀原则

```sql
-- 创建一个三列联合索引
CREATE INDEX idx_a_b_c ON users(col_a, col_b, col_c);

-- 哪些查询能用到索引?
-- ✅ 完全匹配: 用到了全部索引列
EXPLAIN SELECT * FROM users WHERE col_a = 1 AND col_b = 2 AND col_c = 3;

-- ✅ 最左前缀: 只用到前两列, 但索引有效
EXPLAIN SELECT * FROM users WHERE col_a = 1 AND col_b = 2;

-- ✅ 只用到第一列, 索引有效 (部分)
EXPLAIN SELECT * FROM users WHERE col_a = 1;

-- ❌ 没用到第一列, 索引完全失效!
EXPLAIN SELECT * FROM users WHERE col_b = 2 AND col_c = 3;
-- 结果: type=ALL (全表扫描) 或 type=index (扫描整个索引树)

-- ⚠️ 跳过中间列: 中间列的条件无法使用索引
EXPLAIN SELECT * FROM users WHERE col_a = 1 AND col_c = 3;
-- col_a 用到索引进行等值过滤, 但 col_c 无法利用索引
-- InnoDB 会在 col_a=1 的结果中逐行过滤 col_c=3
```

**口诀：带头大哥不能死，中间兄弟不能断。**

#### 4.3 单列索引 vs 联合索引

```sql
-- 场景: 查询 WHERE age=25 AND name='Alice'
-- 方案 1: 分别建两个单列索引
CREATE INDEX idx_age ON users(age);
CREATE INDEX idx_name ON users(name);
-- MySQL 优化器会选择其中一个 (一般选择性高的), 另一个条件在回表后过滤

-- 方案 2: 建一个联合索引
CREATE INDEX idx_name_age ON users(name, age);
-- 一个索引覆盖两个条件, 直接在索引树过滤, 不需要回表

-- 方案 3: 建一个覆盖索引 (把 SELECT 的列也放进去)
CREATE INDEX idx_name_age_email ON users(name, age, email);
-- 查询 SELECT name, age, email WHERE name='Alice'
-- Extra: Using index (完美覆盖, 零回表!)
```

#### 4.4 唯一索引 vs 普通索引

```sql
-- 唯一索引: 保证值的唯一性
CREATE UNIQUE INDEX idx_id_card ON users(id_card);

-- 普通索引: 不强制唯一性
CREATE INDEX idx_name ON users(name);

-- 唯一索引的查询: 找到目标就停止 (因为不可能有重复)
-- 普通索引的查询: 找到后继续扫描下一个, 直到值不同
-- 实际性能差异很小 (数据在内存中, 多扫描一条的记录很小)

-- 唯一索引对写入有额外影响:
-- 要检查唯一性, 需要先将数据页读入内存
-- 而普通索引可以利用 Change Buffer 延迟写入, 性能更好
```

---

### 五、索引失效场景 (高频面试)

```sql
-- 场景 1: 对索引列使用函数
EXPLAIN SELECT * FROM users WHERE LOWER(name) = 'alice';
-- 解决方案: 使用函数索引 (MySQL 8.0.13+)
CREATE INDEX idx_lower_name ON users((LOWER(name)));

-- 场景 2: 隐式类型转换
EXPLAIN SELECT * FROM users WHERE phone = 13800138000;
-- phone 是 VARCHAR 类型, 但传入了整数
-- MySQL 会将 phone 转换为数字, 相当于 CAST(phone AS SIGNED)
-- 索引失效!
-- 解决方案: 保持类型一致
EXPLAIN SELECT * FROM users WHERE phone = '13800138000';

-- 场景 3: LIKE 以通配符开头
EXPLAIN SELECT * FROM users WHERE name LIKE '%张三%';
-- 索引失效, 全表扫描
-- 解决方案: 如果有全文搜索需求, 使用全文索引或 Elasticsearch
-- 只有 LIKE '张三%' 才能用到索引

-- 场景 4: OR 条件中部分列无索引
-- idx_a 在 col_a 上
EXPLAIN SELECT * FROM users WHERE col_a = 1 OR col_b = 2;
-- col_b 没有索引, 整个查询会全表扫描!
-- 解决方案: 为 col_b 也建索引, 或用 UNION ALL 改写
SELECT * FROM users WHERE col_a = 1
UNION ALL
SELECT * FROM users WHERE col_b = 2 AND col_a != 1;

-- 场景 5: 索引列参与计算
EXPLAIN SELECT * FROM orders WHERE amount + 100 > 500;
-- 相当于对 amount 做了运算, 索引失效
-- 解决方案: 改写 SQL
EXPLAIN SELECT * FROM orders WHERE amount > 400;

-- 场景 6: 联合索引违反最左前缀
CREATE INDEX idx_status_time ON orders(status, created_at);
-- 跳过了第一列
EXPLAIN SELECT * FROM orders WHERE created_at > '2024-01-01';
-- 索引失效
-- 解决方案: 需要把 status 条件也带上, 或建 status 单列索引
```

### 六、SQL 优化实战

#### 6.1 JOIN 优化

```sql
-- 创建两张测试表
CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    amount DECIMAL(10,2),
    status VARCHAR(20),
    created_at DATETIME,
    INDEX idx_user_id(user_id),
    INDEX idx_created(created_at)
);

CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50),
    age INT,
    INDEX idx_age(age)
);

-- 优化前: 全表扫描驱动表 (大表驱动小表)
EXPLAIN SELECT u.name, o.amount
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.age > 18;

-- 优化器会尽量选小表做驱动表
-- JOIN 字段 (user_id) 必须在被驱动表上有索引

-- 小表驱动大表原则:
-- 假设 users 10 万行, orders 500 万行
-- users 做驱动表: 10 万次 × orders 索引查找 = 10 万次 (好!)
-- orders 做驱动表: 500 万次 × users 索引查找 = 500 万次 (差!)
```

#### 6.2 分页优化

```sql
-- 传统分页: 越往后越慢
SELECT * FROM orders ORDER BY id LIMIT 100000, 20;
-- 执行过程: 扫描 100020 行, 丢弃前 100000 行, 取 20 行
-- 慢!

-- 方案 1: 延迟关联 (子查询先走索引)
SELECT o.* FROM orders o
INNER JOIN (
    SELECT id FROM orders
    ORDER BY id
    LIMIT 100000, 20
) tmp ON o.id = tmp.id;

-- 方案 2: 游标分页 (基于指针, 适合"加载更多")
SELECT * FROM orders
WHERE id > 100000   -- 上次翻页的最后一条 id
ORDER BY id
LIMIT 20;
-- 缺点是只支持按顺序翻页, 不能直接跳到第 N 页

-- 方案 3: 覆盖索引做 LIMIT
SELECT id, order_no, amount FROM orders
WHERE created_at > '2024-01-01'
ORDER BY id
LIMIT 100000, 20;
-- 如果 (id, order_no, amount) 在同一个索引中, 回表次数大大减少
```

#### 6.3 子查询优化

```sql
-- 低效: 子查询对每一行外层数据都会执行一次
SELECT * FROM users u
WHERE u.id IN (
    SELECT user_id FROM orders WHERE amount > 1000
);

-- MySQL 优化器在 5.6+ 会对 IN 子查询做半连接优化
-- 但有些情况还是显式改写更可靠

-- 改写为 JOIN (效率更高, 还能利用索引)
SELECT DISTINCT u.*
FROM users u
INNER JOIN orders o ON u.id = o.user_id
WHERE o.amount > 1000;
-- 注意用 DISTINCT 避免因 JOIN 产生重复行
```

#### 6.4 EXPLAIN 执行计划深度解读

```sql
-- 先创建表和数据
CREATE TABLE employees (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50),
    dept_id INT,
    salary DECIMAL(10,2),
    hire_date DATE,
    INDEX idx_dept_salary(dept_id, salary),
    INDEX idx_hire_date(hire_date)
);

INSERT INTO employees VALUES
(1, '张三', 1, 15000, '2023-01-15'),
(2, '李四', 1, 12000, '2023-03-20'),
(3, '王五', 2, 18000, '2023-02-10'),
(4, '赵六', 2, 10000, '2023-05-01');

-- 分析查询
EXPLAIN FORMAT=TRADITIONAL
SELECT * FROM employees
WHERE dept_id = 1 AND salary > 13000
ORDER BY hire_date DESC
LIMIT 10\G

-- 输出解读:
-- id: 1
-- select_type: SIMPLE
-- table: employees
-- type: ref              (使用非唯一索引或唯一索引前缀匹配)
-- possible_keys: idx_dept_salary
-- key: idx_dept_salary   (实际使用的索引)
-- key_len: 5             (使用 4 字节 dept_id + 1 字节 NULL 标记)
-- ref: const             (等值匹配, dept_id=1)
-- rows: 2                (估算扫描的行数)
-- filtered: 33.33        (回表后过滤掉约 67% 的行)
-- Extra: Using index condition; Using filesort
--        ↑ 触发了索引下推 (ICP), 在索引中过滤 salary
--        ↑ Using filesort 表示未用索引排序, 需要优化
```

**type 字段详解 (性能从好到差)：**

| type | 说明 | 例子 |
|------|------|------|
| system | 系统表, 只有一行 | 不常见 |
| const | 主键或唯一索引等值匹配 | `WHERE id=1` |
| eq_ref | JOIN 时被驱动表主键/唯一索引等值匹配 | `ON u.id=o.user_id` |
| ref | 普通索引等值匹配 | `WHERE dept_id=1` |
| range | 索引范围扫描 | `WHERE id>100` |
| index | 扫描整个索引树 | `SELECT COUNT(*)` |
| ALL | 全表扫描 | 无索引条件 |

#### 6.5 索引设计最佳实践

```sql
-- 1. 高选择性列放在索引前面
-- 选择性 = DISTINCT 值数量 / 总行数
-- 越接近 1 选择性越高
SELECT COUNT(DISTINCT id_card) / COUNT(*) FROM users;   -- ≈1.0 极好
SELECT COUNT(DISTINCT gender) / COUNT(*) FROM users;    -- ≈0.5 很差

-- 2. 主键选择自增 ID 而非 UUID
-- ✅ 好: 自增 INT/BIGINT
CREATE TABLE good (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    data VARCHAR(100)
);

-- ❌ 差: UUID 作为主键
CREATE TABLE bad (
    id CHAR(36) PRIMARY KEY,  -- UUID, 随机插入导致页分裂
    data VARCHAR(100)
);

-- 3. 避免冗余索引
-- 下面三个索引是冗余的:
CREATE INDEX idx_a ON t(a);
CREATE INDEX idx_ab ON t(a, b);
CREATE INDEX idx_abc ON t(a, b, c);
-- 只需要 idx_abc 就覆盖了所有情况

-- 4. 使用索引提示 (在特殊情况下, 如优化器选错索引)
SELECT * FROM employees FORCE INDEX(idx_dept_salary)
WHERE dept_id = 1 AND salary > 13000;
```

**面试高频题：**

1. **B+ 树和 B 树的本质区别？**
   B+ 树非叶子节点不存数据，所以同样大小的节点能存更多键，树更矮。叶子节点有链表连接，范围查询可以直接遍历。B 树则需要在树中来回遍历。

2. **什么情况下最左前缀会失效？**
   跳过联合索引中的某一列、使用 `>` `<` `BETWEEN` 等范围查询（后续列无法使用索引）、使用 `ORDER BY` 与索引顺序不一致等。

3. **MRR (Multi-Range Read) 是什么？**
   MySQL 5.6+ 的优化，当二级索引回表时，先把主键排序再批量回表，把随机 IO 变成顺序 IO。

4. **ICP (Index Condition Pushdown) 是什么？**
   把 WHERE 中能用索引过滤的条件下推到存储引擎层，在索引遍历时直接过滤，减少回表次数。Extra 显示 `Using index condition`。