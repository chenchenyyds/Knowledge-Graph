## 事务与锁机制

### 一、事务 ACID 特性

事务是数据库系统中最基本的工作单元，由一条或多条 SQL 语句组成，是一个**要么全部成功、要么全部失败**的原子操作。

#### 1.1 A (Atomicity) 原子性

事务中的操作要么全部提交成功，要么全部回滚，不可分割。

```sql
-- 银行转账: Alice 给 Bob 转 100 元
START TRANSACTION;

UPDATE accounts SET balance = balance - 100 WHERE name = 'Alice';
UPDATE accounts SET balance = balance + 100 WHERE name = 'Bob';

-- 如果在此时发生崩溃, 怎么办?
-- InnoDB 利用 undo log 实现回滚

-- 执行成功则提交
COMMIT;
-- 或在出问题时回滚
ROLLBACK;
```

**原子性实现原理 —— undo log：**

```
原子性实现: undo log 回滚日志

1. 每个事务修改数据前, InnoDB 会先将"修改前的数据"写入 undo log
2. 如果事务回滚, InnoDB 读取 undo log 恢复到修改前的状态
3. undo log 本身也写入 redo log 保护 (undo log 是持久化的)

示例:
  UPDATE accounts SET balance = 100 WHERE name = 'Alice';
  -- 修改前 balance = 200
  -- undo log 记录: "将 name='Alice' 的 balance 恢复为 200"

  ROLLBACK;
  -- 读取 undo log → 将 balance 改回 200
```

undo log 还有另一重作用——实现 MVCC，后面会详细讲。

#### 1.2 C (Consistency) 一致性

事务执行前后，数据库必须保持**一致性状态**——所有预定义的规则（约束、级联、触发器、业务逻辑）都必须满足。

```sql
-- 一致性约束示例
CREATE TABLE accounts (
    id INT PRIMARY KEY,
    name VARCHAR(50),
    balance DECIMAL(10,2),
    CHECK (balance >= 0)  -- 余额不能为负
);

-- 转账: 如果 Alice 余额为 50, 转 100 元出去
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE name = 'Alice';
UPDATE accounts SET balance = balance + 100 WHERE name = 'Bob';
COMMIT;
-- 由于 CHECK 约束, Alice 的 balance 会变成 -50, 违反一致性
-- 数据库会拒绝这个操作并回滚

-- 业务层的一致性保证:
-- 转账前后, 所有账户的余额总和必须不变
-- 如果总和变了, 说明系统处于不一致状态
```

#### 1.3 I (Isolation) 隔离性

多个事务并发执行时，每个事务感觉不到其他事务的存在（取决于隔离级别）。

#### 1.4 D (Durability) 持久性

一旦事务提交成功，对数据的修改就是永久的，即使发生系统崩溃也不会丢失。

**持久性实现原理 —— redo log：**

```
持久性实现: redo log (WAL - Write Ahead Log) 机制

事务提交过程:
  1. 修改 Buffer Pool 中的数据页
  2. 将修改记录写入 redo log buffer (内存)
  3. COMMIT 时将 redo log buffer 刷入磁盘的 redo log 文件
  4. 返回客户端"提交成功"
  5. 后台线程 (Page Cleaner) 将脏页刷入磁盘

崩溃恢复过程:
  1. MySQL 启动时检查 redo log
  2. 找到 LSN (Log Sequence Number) 比较 redo log 和数据页
  3. 将已提交但未刷入磁盘的修改重放 (redo)
  4. 将未提交的事务回滚 (undo)
  5. 数据库恢复一致状态

WAL 原则: 先写日志, 再写数据
  为什么比直接写数据快?
  - redo log 是顺序写 (磁盘对顺序 IO 极快)
  - 数据文件是随机写 (磁盘对随机 IO 慢)
  - 一次事务提交 ≈ 一次顺序写, 而非多次随机写
```

```sql
-- redo log 配置
SHOW VARIABLES LIKE 'innodb_log_file_size';   -- 每个 redo log 文件大小, 推荐 256M-4G
SHOW VARIABLES LIKE 'innodb_log_files_in_group'; -- 文件组中的文件数, 默认 2
SHOW VARIABLES LIKE 'innodb_flush_log_at_trx_commit'; -- 刷盘策略 (关键!)

-- innodb_flush_log_at_trx_commit 取值:
-- 0: 每秒刷盘, 性能最好, 但崩溃可能丢失 1 秒数据
-- 1: 每次提交都刷盘, 最安全但最慢 (默认, 建议生产环境使用)
-- 2: 每次提交写入 OS cache, 每秒刷盘, 性能和安全折中
```

---

### 二、隔离级别

#### 2.1 并发事务的三个问题

**脏读 (Dirty Read)：** 一个事务读到另一个**未提交事务**的修改。

```sql
-- 脏读示例 (触发条件: READ UNCOMMITTED)

-- 事务 A (未提交)
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
-- balance 从 1000 变为 900

-- 事务 B (READ UNCOMMITTED 级别)
SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
SELECT balance FROM accounts WHERE id = 1;
-- 读到 balance = 900 (这是事务 A 未提交的修改!)

-- 事务 A 回滚
ROLLBACK;
-- balance 恢复为 1000

-- 但事务 B 已经用 900 做了其他业务操作, 数据就不一致了!
```

**不可重复读 (Non-repeatable Read)：** 同一事务内，两次读取同一数据，结果不同（因为被其他已提交事务修改了）。

```sql
-- 不可重复读示例 (触发条件: READ COMMITTED)

-- 事务 A
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
BEGIN;
SELECT balance FROM accounts WHERE id = 1;  -- 第一次读: 1000

-- 事务 B (提交)
UPDATE accounts SET balance = 2000 WHERE id = 1;
COMMIT;

-- 事务 A 再次读
SELECT balance FROM accounts WHERE id = 1;  -- 第二次读: 2000 (变了!)
-- 同一个事务内读取结果不一致!
COMMIT;
```

**幻读 (Phantom Read)：** 同一事务内，两次执行相同范围查询，第二次多出了一些行（因为其他事务插入了新数据）。

```sql
-- 幻读示例

-- 事务 A
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
BEGIN;
SELECT * FROM accounts WHERE balance > 500;  -- 第一次: 返回 2 行

-- 事务 B (插入新行并提交)
INSERT INTO accounts (id, name, balance) VALUES (3, 'Charlie', 600);
COMMIT;

-- 事务 A 再次查
SELECT * FROM accounts WHERE balance > 500;  -- 第二次: 返回 3 行 (多了一条!)
-- 这就是"幻读"——多出了"幻影行"
COMMIT;
```

#### 2.2 四个隔离级别

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 实现机制 |
|---------|------|-----------|------|---------|
| READ UNCOMMITTED | 可能 | 可能 | 可能 | 不加锁，直接读最新数据 |
| READ COMMITTED (RC) | 不可能 | 可能 | 可能 | 每次 SELECT 都重新生成 ReadView |
| REPEATABLE READ (RR) | 不可能 | 不可能 | **InnoDB 下不可能** | 第一次 SELECT 时生成 ReadView，且通过 Next-Key Lock 防止幻读 |
| SERIALIZABLE | 不可能 | 不可能 | 不可能 | 所有 SELECT 隐式加锁，完全串行化 |

```sql
-- 设置事务隔离级别

-- 全局设置
SET GLOBAL transaction_isolation = 'REPEATABLE-READ';

-- 会话设置
SET SESSION transaction_isolation = 'READ-COMMITTED';

-- 当前事务设置 (MySQL 8.0+)
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 查看当前隔离级别
SHOW VARIABLES LIKE 'transaction_isolation';
```

**MySQL 默认隔离级别：REPEATABLE READ**

**为什么 MySQL 默认用 RR 而 Oracle 用 RC？**
- MySQL 的 binlog (逻辑复制) 在 RR 级别下才能保证主从一致性
- 如果主库用 RC，基于语句的 binlog 在从库回放时结果可能不同
- MySQL 8.0 开始，binlog 格式默认为 ROW，RC 级别也能保证主从一致，但在生产实践中很多人仍然沿用 RR

#### 2.3 各隔离级别下并发事务的完整示例

```sql
-- ===== 验证 RR 级别能否防止幻读 (InnoDB) =====

-- 准备工作
CREATE TABLE t (
    id INT PRIMARY KEY,
    name VARCHAR(10)
) ENGINE=InnoDB;

INSERT INTO t VALUES (1, 'a'), (2, 'b');

-- 事务 A (RR 级别)
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
BEGIN;
SELECT * FROM t WHERE id > 0;  -- 返回 1,2 两行

-- 事务 B
BEGIN;
INSERT INTO t VALUES (3, 'c');
COMMIT;

-- 事务 A 再次查询 (快照读, MVCC)
SELECT * FROM t WHERE id > 0;  -- 仍然返回 1,2 (不会看到 3)
-- RR 级别的快照读 (MVCC) 天然防止幻读

-- 但如果事务 A 做当前读 (加锁读):
SELECT * FROM t WHERE id > 0 FOR UPDATE;
-- 如果事务 A 之前没有锁, 这次会看到 3 (因为 SELECT ... FOR UPDATE 是当前读)
-- 但 Next-Key Lock 在第一次 SELECT ... FOR UPDATE 时就锁住了间隙
-- 阻止了事务 B 的 INSERT, 所以 RR 级别下不会有幻读

COMMIT;
```

---

### 三、MVCC 多版本并发控制

MVCC 是 InnoDB 实现**读不阻塞写、写不阻塞读**的核心技术。

#### 3.1 MVCC 核心组件

```
MVCC 三大核心组件:

+--------------------------------------------------+
|  1. 隐藏字段 (每行记录都有)                        |
|                                                     |
|  DB_TRX_ID (6字节): 最后修改该行的事务 ID            |
|  DB_ROLL_PTR (7字节): 指向 undo log 中该行的前一个版本 |
|  DB_ROW_ID (6字节): 隐藏自增 ID (当表没有主键时使用)   |
|                                                     |
+--------------------------------------------------+
|  2. undo log (回滚日志, 记录了每一行的历史版本)      |
|                                                     |
|  链式结构:                                          |
|  最新版本 → 版本2 → 版本3 → 版本4 (旧版本)          |
|  通过 DB_ROLL_PTR 串联成版本链                      |
|                                                     |
+--------------------------------------------------+
|  3. ReadView (读视图, 判断当前事务能看到哪些版本)    |
|                                                     |
|  m_ids: 当前活跃 (未提交) 的事务 ID 列表             |
|  min_trx_id: 活跃事务中的最小 ID                     |
|  max_trx_id: 下一个将要分配的事务 ID                 |
|  creator_trx_id: 创建该 ReadView 的事务 ID          |
|                                                     |
+--------------------------------------------------+
```

#### 3.2 行数据的版本链

```sql
-- 假设有一个事务 id=100, 插入一行
INSERT INTO t VALUES (1, 'Alice');
-- 此时这行数据的隐藏字段:
-- DB_TRX_ID = 100
-- DB_ROLL_PTR = NULL (这是第一个版本)

-- 事务 id=150 修改该行
UPDATE t SET name = 'Bob' WHERE id = 1;
-- 1. InnoDB 将旧数据复制到 undo log
--    undo log 记录: (id=1, name='Alice', DB_TRX_ID=100)
-- 2. 更新当前行:
--    DB_TRX_ID = 150
--    DB_ROLL_PTR → 指向 undo log 中旧版本
--    name = 'Bob'

-- 事务 id=200 再次修改
UPDATE t SET name = 'Charlie' WHERE id = 1;
-- 版本链:
-- 当前行 (DB_TRX_ID=200, name='Charlie')
--    ↓ DB_ROLL_PTR
-- 版本2 (DB_TRX_ID=150, name='Bob')
--    ↓ DB_ROLL_PTR
-- 版本1 (DB_TRX_ID=100, name='Alice')
--    ↓ DB_ROLL_PTR
-- NULL
```

#### 3.3 ReadView 可见性判断规则

```
ReadView 判断公式:

┌─────────────────────────────────────────┐
│  读取版本记录时, 用 DB_TRX_ID 判断能否看到 │
│                                          │
│  DB_TRX_ID == creator_trx_id?            │
│    ├── 是 → 是自己修改的, 可见            │
│    └── 否 → 继续判断                      │
│                                          │
│  DB_TRX_ID < min_trx_id?                 │
│    ├── 是 → 在 ReadView 创建前已提交, 可见 │
│    └── 否 → 继续判断                      │
│                                          │
│  DB_TRX_ID >= max_trx_id?                │
│    ├── 是 → 在 ReadView 创建后启动, 不可见 │
│    └── 否 → 继续判断                      │
│                                          │
│  DB_TRX_ID 在 m_ids 列表里?               │
│    ├── 是 → 未提交的活跃事务, 不可见       │
│    └── 否 → 已提交, 可见                  │
│                                          │
│  如果不可见, 通过 DB_ROLL_PTR 找到上一个    │
│  版本继续判断, 直到找到可见版本或到链尾     │
└─────────────────────────────────────────┘
```

#### 3.4 RC vs RR 的 MVCC 区别

```sql
-- 测试环境
CREATE TABLE t (
    id INT PRIMARY KEY,
    value INT
);
INSERT INTO t VALUES (1, 100);

-- 时间线:
-- T1: 事务 A 启动 (trx_id=100), 查询 value
-- T2: 事务 B 启动 (trx_id=200), 修改 value=200 并提交
-- T3: 事务 A 再次查询 value

-- ===== READ COMMITTED 下的行为 =====
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 事务 A
BEGIN;
SELECT value FROM t WHERE id = 1;  -- 第一次: 100

  -- 事务 B (在另一个会话中)
  UPDATE t SET value = 200 WHERE id = 1;
  COMMIT;

SELECT value FROM t WHERE id = 1;  -- 第二次: 200 (又生成了新的 ReadView, 看到了 B 的提交)

COMMIT;
-- 在 RC 下: 每次 SELECT 都重新生成 ReadView

-- ===== REPEATABLE READ 下的行为 =====
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- 事务 A
BEGIN;
SELECT value FROM t WHERE id = 1;  -- 第一次: 100 (生成 ReadView)

  -- 事务 B
  UPDATE t SET value = 200 WHERE id = 1;
  COMMIT;

SELECT value FROM t WHERE id = 1;  -- 第二次: 100 (复用第一次的 ReadView, 看不到 B)

COMMIT;
-- 在 RR 下: 事务第一次 SELECT 时生成 ReadView, 之后复用
```

---

### 四、InnoDB 锁机制

#### 4.1 锁类型概览

```
InnoDB 锁体系:

InnoDB Lock
├── 行级锁 (Row Lock)
│   ├── Record Lock: 锁定单条索引记录
│   ├── Gap Lock: 锁定索引记录之间的间隙, 防止插入
│   └── Next-Key Lock: Record Lock + Gap Lock, 解决幻读
├── 表级锁 (Table Lock) — InnoDB 很少使用, 但在特殊情况下会自动升级
│   ├── 意向锁 (Intention Lock)
│   │   ├── Intention Shared (IS)
│   │   └── Intention Exclusive (IX)
│   └── AUTO-INC Lock
└── 谓词锁 (Predicate Lock) — 仅适用于空间索引
```

**意向锁 (Intention Lock)：**
- 不需要手动创建，InnoDB 自动管理
- 当一个事务想要获取行的共享锁 (S) 时，先在表上加意向共享锁 (IS)
- 当一个事务想要获取行的排他锁 (X) 时，先在表上加意向排他锁 (IX)
- 作用：让表级锁和行级锁能够**快速判断是否有冲突**，而不需要逐行检查

```
行锁和表锁的兼容性矩阵:

         |  IS  |  IX  |  S   |  X
---------+------+------+------+------
   IS    |  ✅  |  ✅  |  ✅  |  ✅
   IX    |  ✅  |  ✅  |  ❌  |  ❌
   S     |  ✅  |  ❌  |  ✅  |  ❌
   X     |  ✅  |  ❌  |  ❌  |  ❌
```

#### 4.2 Record Lock (记录锁)

```sql
-- 锁定 id=5 这一行 (主键索引上的记录锁)
BEGIN;
SELECT * FROM users WHERE id = 5 FOR UPDATE;
-- 或者:
UPDATE users SET name = 'NewName' WHERE id = 5;

-- 其他事务不能修改 id=5 的行
-- 但可以插入新行 (id=6) 或修改其他行

-- 共享锁 (S Lock): 其他事务可以读, 但不能写
BEGIN;
SELECT * FROM users WHERE id = 5 LOCK IN SHARE MODE;
-- MySQL 8.0+ 也可以写:
SELECT * FROM users WHERE id = 5 FOR SHARE;

-- 排它锁 (X Lock): 其他事务既不能读也不能写
BEGIN;
SELECT * FROM users WHERE id = 5 FOR UPDATE;
```

```sql
-- 实验: 验证行锁阻塞
-- 会话 A
BEGIN;
UPDATE users SET name = 'Alice' WHERE id = 1;

-- 会话 B 尝试修改同一行
UPDATE users SET name = 'Bob' WHERE id = 1;
-- 这里会被阻塞, 等会话 A 提交或回滚

-- 会话 B 修改不同行, 不会阻塞
UPDATE users SET name = 'Charlie' WHERE id = 2;
-- 立即成功 (行级锁只锁这一行)
```

#### 4.3 Gap Lock (间隙锁)

间隙锁锁住的是**索引记录之间的间隙**，防止其他事务在该间隙插入新行，从而防止幻读。

```
索引数据:
   id:  1 | 3 | 5 | 7 | 9

  间隙: (1,3) | (3,5) | (5,7) | (7,9) | (9, +∞)
```

```sql
-- Gap Lock 示例 (RR 级别下生效)

BEGIN;
-- 锁住 id>3 但不等于任何记录的间隙
SELECT * FROM users WHERE id > 3 AND id < 5 FOR UPDATE;
-- 锁了间隙 (3, 5), 其他事务不能插入 id=4 的行
-- 注意: id=3 和 id=5 本身不会被 Record Lock 锁住 (因为不匹配条件)

-- 另一个事务尝试插入 id=4
INSERT INTO users (id, name) VALUES (4, 'New');
-- 会被阻塞, 直到第一个事务释放锁

-- 但如果插入 id=2, 不受影响
INSERT INTO users (id, name) VALUES (2, 'New');
-- 立即成功
```

**Gap Lock 只在 REPEATABLE READ 级别下生效。** 在 READ COMMITTED 级别下，Gap Lock 会被禁用 (MySQL 会将 `innodb_locks_unsafe_for_binlog` 打开)。

```sql
-- 在 RC 级别下不会有 Gap Lock
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
BEGIN;
SELECT * FROM users WHERE id > 3 AND id < 5 FOR UPDATE;
-- 只有 id=4 的记录锁 (如果没有 id=4 的行, 就没有锁)
-- 其他事务可以插入 id=4 (可能导致幻读!)
```

#### 4.4 Next-Key Lock (临键锁)

Next-Key Lock = Record Lock + Gap Lock，是 InnoDB 在 RR 级别下的**默认行锁算法**。

```
Next-Key Lock 锁的范围:

  假设索引值: 1, 3, 5, 7, 9

  Next-Key Lock 锁的范围:
  (-∞, 1], (1, 3], (3, 5], (5, 7], (7, 9], (9, +∞)

  当 WHERE 条件是 id=5 时 (且 id 上有唯一索引):
  → 只锁住 Record Lock (id=5), 因为唯一索引不会产生幻读
  → 退化( gap lock 不需要, 因为唯一)

  当 WHERE 条件是 id>3 (非唯一索引或无索引):
  → 锁住所有匹配的 Next-Key Lock 范围
```

```sql
-- Next-Key Lock 实验

-- 表结构和数据
CREATE TABLE orders (
    id INT PRIMARY KEY,
    order_no VARCHAR(20),
    amount DECIMAL(10,2),
    INDEX idx_amount(amount)
);

INSERT INTO orders VALUES
(1, 'A001', 100),
(3, 'A002', 200),
(5, 'A003', 300),
(7, 'A004', 400),
(9, 'A005', 500);

-- 事务 A: RR 级别
BEGIN;
SELECT * FROM orders WHERE amount > 200 FOR UPDATE;
-- 锁范围分析:
-- 1. amount = 300 (id=5): Next-Key Lock 锁住 (200, 300]
-- 2. amount = 400 (id=7): Next-Key Lock 锁住 (300, 400]
-- 3. amount = 500 (id=9): Next-Key Lock 锁住 (400, 500]
-- 4. 最后还 Gap Lock 锁住 (500, +∞)
-- 总计: (200, +∞) 范围内都不能插入新行

-- 事务 B: 以下插入都会被阻塞
INSERT INTO orders VALUES (6, 'A006', 350);  -- 在 (300, 400] 范围内, 被阻塞!
INSERT INTO orders VALUES (10, 'A007', 600); -- 在 (500, +∞) 范围内, 被阻塞!

-- 但可以插入 amount <= 200 的行
INSERT INTO orders VALUES (2, 'A008', 150);  -- 成功! (不在锁的范围内)
```

---

### 五、死锁 (Deadlock)

#### 5.1 死锁的产生

死锁是两个或多个事务互相持有对方需要的锁，互相等待，永远无法继续。

```
死锁场景:

事务 A:                        事务 B:
BEGIN;                         BEGIN;

UPDATE users SET ... WHERE id=1;   UPDATE users SET ... WHERE id=2;

UPDATE users SET ... WHERE id=2;   UPDATE users SET ... WHERE id=1;
(等待 B 释放 id=2 的锁)            (等待 A 释放 id=1 的锁)

                 ┌─────────┐
                 │  死锁!  │
                 └─────────┘
        事务 A 等 B        事务 B 等 A
        谁也无法继续...

InnoDB 死锁检测:
  检测到死锁后, InnoDB 选择"回滚代价较小"的事务
  让其回滚并释放锁, 另一个事务继续执行
  被回滚的事务收到: ERROR 1213 (40001): Deadlock found when trying to get lock; try restarting transaction
```

#### 5.2 真实死锁案例分析

```sql
-- 案例 1: 不同的加锁顺序 (最常见的死锁原因)
-- 表: products (id, name, stock)

-- 事务 A
BEGIN;
UPDATE products SET stock = stock - 1 WHERE id = 1;  -- 锁 id=1
UPDATE products SET stock = stock - 1 WHERE id = 2;  -- 等待 B 释放 id=2

-- 事务 B (同时)
BEGIN;
UPDATE products SET stock = stock - 1 WHERE id = 2;  -- 锁 id=2
UPDATE products SET stock = stock - 1 WHERE id = 1;  -- 等待 A 释放 id=1
-- DEADLOCK 发生!

-- 解决方案: 所有事务按相同顺序加锁 (先锁 id=1, 再锁 id=2)
```

```sql
-- 案例 2: 隐式锁转换
-- 表: t (a INT PRIMARY KEY, b INT, INDEX idx_b(b))

INSERT INTO t VALUES (1, 10), (2, 20);

-- 事务 A
BEGIN;
SELECT * FROM t WHERE b = 10 FOR UPDATE;  -- 锁住 (b=10) 的 Next-Key Lock

-- 事务 B
BEGIN;
SELECT * FROM t WHERE b = 20 FOR UPDATE;  -- 锁住 (b=20) 的 Next-Key Lock

-- 事务 A 尝试插入
INSERT INTO t VALUES (3, 15);  -- 需要 (10, 20] 间隙的 Gap Lock, 被 B 阻塞!

-- 事务 B 尝试插入
INSERT INTO t VALUES (4, 15);  -- 需要 (10, 20] 间隙的 Gap Lock, 被 A 阻塞!
-- DEADLOCK!
```

#### 5.3 死锁排查

```sql
-- 1. 查看最近一次死锁日志
SHOW ENGINE INNODB STATUS\G
-- 搜索 "LATEST DETECTED DEADLOCK" 段落

-- 输出包含:
-- (1) 造成死锁的事务及 SQL
-- (2) 持有的锁 (HOLDS THE LOCK)
-- (3) 等待的锁 (WAITING FOR THIS LOCK TO BE GRANTED)
-- (4) 被回滚的事务 (WE ROLL BACK TRANSACTION)

-- 2. 查看当前正在运行的锁
SELECT * FROM performance_schema.data_locks\G

-- 3. 查看事务状态
SELECT * FROM information_schema.INNODB_TRX\G

-- 4. 定位锁等待
SELECT * FROM sys.innodb_lock_waits;
```

#### 5.4 死锁预防

```sql
-- 1. 保持固定的加锁顺序
-- NOT: 事务 A: lock(1), lock(2); 事务 B: lock(2), lock(1)
-- GOOD: 都按 lock(1), lock(2) 顺序

-- 2. 缩短事务范围
-- BAD:
BEGIN;
SELECT * ... FOR UPDATE;
... 复杂计算, 网络调用 ...
UPDATE ...
COMMIT;

-- GOOD:
... 计算, 准备工作 ...
BEGIN;
UPDATE ...
COMMIT;

-- 3. 降低隔离级别 (如果业务允许)
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
-- RC 级别没有 Gap Lock, 死锁概率大大降低

-- 4. 使用 NOWAIT 或 SKIP LOCKED (MySQL 8.0+)
SELECT * FROM products WHERE id = 1 FOR UPDATE NOWAIT;
-- 如果不能立即获得锁, 立刻报错而不是等待

SELECT * FROM products WHERE id = 1 FOR UPDATE SKIP LOCKED;
-- 跳过已被锁的行, 只返回未锁的行

-- 5. 合理设计索引, 减少锁范围
-- 如果 UPDATE 的 WHERE 条件能用上索引, 锁范围小
-- 如果 WHERE 条件没有索引, 可能锁全表!
```

---

### 六、面试高频题

1. **MVCC 能解决幻读吗？**
   MVCC 的快照读 (普通的 SELECT) 在 RR 级别下可以防幻读，因为 ReadView 不变。但**当前读** (SELECT ... FOR UPDATE / UPDATE / DELETE) 需要依靠 Next-Key Lock 来防止幻读。

2. **RC 和 RR 哪个性能更好？**
   RC 通常性能更好：(1) 不需要 Gap Lock，并发度更高；(2) 锁冲突概率低；(3) undo log 可以更早清理。很多互联网公司使用 RC + ROW 格式 binlog。

3. **如何避免死锁？**
   统一加锁顺序、缩短事务、降低隔离级别、使用 NOWAIT/SKIP LOCKED、合理设计索引。

4. **undo log 会无限增长吗？**
   不会。当没有事务需要访问某个历史版本时，对应的 undo log 可以被 purge 线程清理。但长事务会导致 undo log 膨胀。

5. **INSERT 加锁吗？**
   INSERT 会加隐式锁 (implicit lock)，InnoDB 用更轻量的方式处理。当其他事务也要修改此行时，隐式锁转化为显式锁。