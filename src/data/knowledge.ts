export interface Chapter {
  id: string;
  title: string;
  level: number;
  description: string;
  content: string;
  keyPoints: string[];
  relatedChapters: string[];
  interviewFrequency: "high" | "medium" | "low";
}

export interface Category {
  id: string;
  title: string;
  description: string;
  color: string;
  icon: string;
  chapters: Chapter[];
}

export const CATEGORIES: Category[] = [
  {
    id: "java-basics",
    title: "Java 基础",
    description: "JVM、集合、并发、IO 等 Java 核心技术",
    color: "#3B82F6",
    icon: "Coffee",
    chapters: [
      {
        id: "jvm-memory",
        title: "JVM 内存模型与垃圾回收",
        level: 1,
        description: "运行时数据区、GC 算法、垃圾收集器、内存泄漏排查",
        content: `## JVM 运行时数据区

JVM 将内存划分为多个区域，每个区域有不同的用途和生命周期。

### 堆（Heap）
- 所有线程共享，存储对象实例和数组
- 分为年轻代（Young Generation）和老年代（Old Generation）
- 年轻代进一步分为 Eden、Survivor From、Survivor To

### 虚拟机栈（Stack）
- 线程私有，每个方法创建一个栈帧
- 栈帧包含局部变量表、操作数栈、动态链接、方法出口

### 方法区（Metaspace）
- 存储类信息、常量、静态变量
- JDK 8+ 使用元空间（Metaspace）替代永久代

### 本地方法栈
- 为 Native 方法服务

### 程序计数器
- 当前线程执行的字节码行号指示器

## 垃圾回收算法

### 标记-清除（Mark-Sweep）
先标记存活对象，再统一回收未标记对象。会产生内存碎片。

### 标记-复制（Mark-Copy）
将内存分为两块，只使用一块，GC 时将存活对象复制到另一块。适用于新生代。

### 标记-整理（Mark-Compact）
标记存活对象，将所有存活对象向一端移动，然后清除边界外内存。适用于老年代。

## 垃圾收集器对比

| 收集器 | 适用区域 | 算法 | 特点 |
|--------|---------|------|------|
| Serial | 新生代 | 复制 | 单线程，暂停所有用户线程 |
| ParNew | 新生代 | 复制 | Serial 的多线程版本 |
| CMS | 老年代 | 标记-清除 | 并发收集，低停顿 |
| G1 | 整堆 | 标记-整理+复制 | 分区式，可预测停顿 |
| ZGC | 整堆 | 染色指针 | 超低延迟，大堆场景 |

## 内存泄漏常见场景

1. 静态集合类 holding 对象引用未释放
2. 未关闭的资源（Connection、Stream、Socket）
3. 内部类持有外部类引用
4. equals() 和 hashCode() 实现不当导致 HashMap 内存泄漏`,
        keyPoints: [
          "JVM 内存区域划分与作用",
          "GC 算法原理（标记-清除/复制/整理）",
          "常见 GC 收集器对比",
          "内存泄漏排查手段（jstack/jmap/mat）",
          "对象存活判定（引用计数/Root GC）",
        ],
        relatedChapters: ["java-collection", "java-concurrency"],
        interviewFrequency: "high",
      },
      {
        id: "java-collection",
        title: "集合框架",
        level: 2,
        description: "HashMap、ConcurrentHashMap、ArrayList、LinkedList 源码分析",
        content: `## HashMap 源码分析

### 数据结构
数组 + 链表 + 红黑树（JDK 8+）

### 重要参数
- 默认容量：16
- 负载因子：0.75
- 树化阈值：8
- 退化阈值：6

### put 流程
1. 计算 key 的 hash（高16位异或低16位）
2. 如果 table 为空则 resize
3. 定位桶：hash & (n-1)
4. 桶为空直接插入，不为空则遍历
5. 链表长度 ≥8 转红黑树
6. 超过阈值则 resize

### 扩容机制
- 2 倍扩容
- 元素重新分配（rehash）
- 红黑树拆分回链表

## ConcurrentHashMap

### JDK 7：Segment 分段锁
- 继承 ReentrantLock
- 默认 16 个 Segment，并行度 16

### JDK 8：CAS + synchronized
- 放弃分段锁，使用 Node 数组
- put 时：空桶用 CAS，非空桶用 synchronized
- 红黑树节点改为 TreeBin

## ArrayList vs LinkedList

| ArrayList | LinkedList |
|-----------|------------|
| 数组实现 | 双向链表实现 |
| 随机访问 O(1) | 随机访问 O(n) |
| 尾部插入 O(1) | 头尾插入 O(1) |
| 中间插入 O(n) | 中间插入 O(n) |
| 内存连续 | 内存分散 |`,
        keyPoints: [
          "HashMap 数据结构与 put/get 流程",
          "ConcurrentHashMap 并发安全机制",
          "ArrayList 扩容机制",
          "红黑树化条件与退化条件",
          "HashTable vs HashMap vs ConcurrentHashMap",
        ],
        relatedChapters: ["jvm-memory", "java-concurrency"],
        interviewFrequency: "high",
      },
      {
        id: "java-concurrency",
        title: "多线程与并发编程",
        level: 3,
        description: "JMM、synchronized、Lock、AQS、线程池、并发工具类",
        content: `## JMM（Java 内存模型）

### 三大特性
- **原子性**：synchronized、Lock、Atomic 类
- **可见性**：volatile、synchronized、final
- **有序性**：volatile、synchronized、happens-before 规则

### volatile 原理
- 写 volatile 变量时强制刷新到主内存
- 读 volatile 变量时强制从主内存读取
- 禁止指令重排序（内存屏障）

## synchronized 原理

### 锁升级过程（偏向锁 → 轻量级锁 → 重量级锁）
1. 偏向锁：单线程竞争，Mark Word 记录线程 ID
2. 轻量级锁：少量线程竞争，CAS 自旋
3. 重量级锁：大量线程竞争，操作系统互斥量

## AQS（AbstractQueuedSynchronizer）

### 核心思想
- CLH 队列（FIFO 双向链表）
- state 变量（volatile int）
- CAS 操作 state

### 实现类
- ReentrantLock：独占锁
- CountDownLatch：计数器
- Semaphore：信号量
- CyclicBarrier：栅栏

## 线程池（ThreadPoolExecutor）

### 核心参数
- corePoolSize：核心线程数
- maximumPoolSize：最大线程数
- keepAliveTime：空闲线程存活时间
- workQueue：任务队列
- threadFactory：线程工厂
- RejectedExecutionHandler：拒绝策略

### 执行流程
1. 线程数 < corePoolSize → 创建新线程
2. 任务队列未满 → 放入队列
3. 线程数 < maximumPoolSize → 创建新线程
4. 执行拒绝策略

### 拒绝策略
- AbortPolicy：抛异常（默认）
- CallerRunsPolicy：调用者线程执行
- DiscardPolicy：丢弃
- DiscardOldestPolicy：丢弃最旧任务`,
        keyPoints: [
          "JMM 三大特性与 volatile 原理",
          "synchronized 锁升级过程",
          "AQS 原理与 ReentrantLock 实现",
          "线程池参数与执行流程",
          "ThreadLocal 内存泄漏问题",
        ],
        relatedChapters: ["jvm-memory", "java-collection"],
        interviewFrequency: "high",
      },
      {
        id: "java-io",
        title: "IO/NIO 模型",
        level: 4,
        description: "BIO/NIO/AIO、零拷贝、Reactor 模式",
        content: `## IO 模型对比

| 模型 | 描述 | 适用场景 |
|------|------|---------|
| BIO | 同步阻塞 | 连接数少，固定架构 |
| NIO | 同步非阻塞 | 连接数多，短连接 |
| AIO | 异步非阻塞 | 连接数多，长连接 |

## NIO 三大核心

### Channel（通道）
- FileChannel、SocketChannel、ServerSocketChannel
- 双向传输，可异步

### Buffer（缓冲区）
- ByteBuffer、CharBuffer、IntBuffer 等
- position、limit、capacity 三个指针

### Selector（选择器）
- 单线程管理多个 Channel
- 基于事件驱动（OP_ACCEPT、OP_READ、OP_WRITE）
- select() 返回就绪的 Channel 数量

## Reactor 模式

### 单 Reactor 单线程
- 一个线程处理 accept 和 read/write
- 适用于 CPU 密集型场景

### 单 Reactor 多线程
- Reactor 线程处理 accept
- Worker 线程池处理 read/write

### 主从 Reactor 多线程
- MainReactor 处理 accept
- SubReactor 处理 read/write
- Netty 采用此模型

## 零拷贝技术

1. **mmap**：文件映射到内存，减少一次拷贝
2. **sendfile**：内核态直接传输，无需经过用户态
3. **DirectBuffer**：堆外内存，避免 GC`,
        keyPoints: [
          "BIO/NIO/AIO 区别",
          "NIO 三大核心组件",
          "Reactor 线程模型",
          "零拷贝技术原理",
          "Netty 架构设计",
        ],
        relatedChapters: ["java-concurrency"],
        interviewFrequency: "medium",
      },
      {
        id: "java-8-plus",
        title: "Java8+ 新特性",
        level: 5,
        description: "Lambda、Stream、Optional、函数式接口、模块化",
        content: `## Lambda 表达式

### 语法
\`\`\`java
(parameters) -> expression
(parameters) -> { statements; }
\`\`\`

### 函数式接口
- Predicate<T>：test(T) → boolean
- Function<T,R>：apply(T) → R
- Consumer<T>：accept(T) → void
- Supplier<T>：get() → T

## Stream API

### 创建
- collection.stream()
- Stream.of()
- Arrays.stream()

### 中间操作
- filter、map、flatMap、sorted、distinct
- 惰性求值，不触发实际计算

### 终端操作
- collect、forEach、reduce、count
- 触发流水线执行

### 并行流
- parallelStream()
- 底层使用 ForkJoinPool
- 注意线程安全问题

## Optional

- 避免 NullPointerException
- ofNullable()、orElse()、orElseGet()、map()、flatMap()

## 其他特性

### JDK 9+
- 模块化系统（JPMS）
- 接口私有方法
- Collection.of() 工厂方法

### JDK 11+
- var 局部变量类型推断
- HttpClient

### JDK 17+ (LTS)
- sealed 类
- record 类
- pattern matching instanceof

### JDK 21+ (LTS)
- 虚拟线程（Virtual Thread）
- 结构化并发`,
        keyPoints: [
          "Lambda 表达式与函数式接口",
          "Stream 流水线执行机制",
          "Optional 使用场景",
          "虚拟线程原理与优势",
          "JDK 8/11/17/21 重要特性",
        ],
        relatedChapters: ["java-collection", "java-concurrency"],
        interviewFrequency: "medium",
      },
    ],
  },
  {
    id: "database",
    title: "数据库",
    description: "MySQL 体系、索引、事务、SQL 优化",
    color: "#10B981",
    icon: "Database",
    chapters: [
      {
        id: "mysql-architecture",
        title: "MySQL 体系结构与存储引擎",
        level: 1,
        description: "MySQL 架构分层、InnoDB 存储引擎、缓冲池",
        content: `## MySQL 架构分层

### 连接层
- 连接池管理客户端连接
- 验证用户名密码

### 服务层
- SQL 接口：接收 SQL 语句
- 查询缓存（8.0 已移除）
- 解析器：词法/语法分析生成解析树
- 优化器：选择执行计划
- 执行器：调用存储引擎接口

### 存储引擎层
- 插件式架构
- InnoDB、MyISAM、Memory 等

### 文件系统层
- 数据文件、日志文件

## InnoDB 存储引擎

### 核心特性
- 支持事务（ACID）
- 行级锁
- MVCC 多版本并发控制
- 聚簇索引
- 外键约束

### 缓冲池（Buffer Pool）
- 缓存数据页和索引页
- 链表管理：LRU 变体
- Change Buffer 缓存二级索引变更

## InnoDB vs MyISAM

| 特性 | InnoDB | MyISAM |
|------|--------|--------|
| 事务 | 支持 | 不支持 |
| 锁粒度 | 行锁 | 表锁 |
| 外键 | 支持 | 不支持 |
| 全文索引 | 支持（8.0+） | 支持 |
| 聚簇索引 | 是 | 否 |`,
        keyPoints: [
          "MySQL 架构分层与各层作用",
          "InnoDB 核心特性（事务/行锁/MVCC）",
          "Buffer Pool 工作原理",
          "InnoDB vs MyISAM 对比",
          "一条 SQL 的执行过程",
        ],
        relatedChapters: ["mysql-index", "mysql-transaction"],
        interviewFrequency: "high",
      },
      {
        id: "mysql-index",
        title: "索引原理与 SQL 优化",
        level: 2,
        description: "B+ 树索引、聚簇索引、覆盖索引、索引下推、执行计划",
        content: `## B+ 树索引

### 特点
- 非叶子节点只存键值
- 叶子节点存数据（聚簇索引）或主键（二级索引）
- 叶子节点形成双向链表
- 高度通常 3-4 层

### 对比 B 树
- B+ 树非叶子节点不存数据，扇出更大
- B+ 树叶子节点有序链表，范围查询高效
- B+ 树查询更稳定（都要到叶子节点）

## 聚簇索引 vs 二级索引

### 聚簇索引
- InnoDB 主键就是聚簇索引
- 叶子节点存整行数据
- 表必须要有聚簇索引

### 二级索引（辅助索引）
- 叶子节点存主键值
- 回表查询：二级索引→主键→聚簇索引

## 索引优化策略

### 最左前缀原则
- 联合索引从最左列开始匹配
- 跳过中间列会导致部分失效

### 覆盖索引
- 查询列在索引中已包含
- 避免回表

### 索引下推（ICP）
- 在存储引擎层过滤数据
- 减少回表次数

## 执行计划分析

### type 字段
- system > const > eq_ref > ref > range > index > ALL

### Extra 字段
- Using index：覆盖索引
- Using index condition：ICP
- Using filesort：需要优化
- Using temporary：需要优化

## SQL 优化原则
1. 避免 SELECT *
2. 使用 LIMIT 分页
3. JOIN 字段加索引
4. 避免索引列上使用函数
5. 批量操作代替逐条操作`,
        keyPoints: [
          "B+ 树数据结构与查询过程",
          "聚簇索引 vs 二级索引",
          "最左前缀原则",
          "EXPLAIN 执行计划解读",
          "常见 SQL 优化手段",
        ],
        relatedChapters: ["mysql-architecture", "mysql-transaction"],
        interviewFrequency: "high",
      },
      {
        id: "mysql-transaction",
        title: "事务与锁机制",
        level: 3,
        description: "ACID、隔离级别、MVCC、行锁/Gap锁/Next-key锁、死锁",
        content: `## 事务 ACID 特性

- **原子性（A）**：undolog 回滚
- **一致性（C）**：约束保证
- **隔离性（I）**：锁 + MVCC
- **持久性（D）**：redolog 崩溃恢复

## 隔离级别

| 级别 | 脏读 | 不可重复读 | 幻读 |
|------|------|-----------|------|
| READ UNCOMMITTED | ❌ | ❌ | ❌ |
| READ COMMITTED | ✅ | ❌ | ❌ |
| REPEATABLE READ | ✅ | ✅ | ❌ |
| SERIALIZABLE | ✅ | ✅ | ✅ |

MySQL 默认隔离级别：REPEATABLE READ

## MVCC（多版本并发控制）

### 核心组件
- **隐藏字段**：DB_TRX_ID、DB_ROLL_PTR、DB_ROW_ID
- **undolog**：记录数据历史版本
- **readview**：事务可见性判断

### ReadView 生成时机
- RC：每次 SELECT 都生成
- RR：事务第一次 SELECT 时生成

## 行锁实现

### Record Lock
- 锁定索引记录

### Gap Lock
- 锁定间隙，防止插入
- RR 级别下生效

### Next-Key Lock
- Record Lock + Gap Lock
- 解决幻读

## 死锁排查

1. SHOW ENGINE INNODB STATUS
2. 查看 LATEST DETECTED DEADLOCK
3. 调整 SQL 执行顺序
4. 缩短事务范围`,
        keyPoints: [
          "事务 ACID 与隔离级别",
          "MVCC 实现原理（ReadView/undolog）",
          "Next-Key Lock 解决幻读",
          "行锁/Gap锁/临键锁区别",
          "死锁排查与预防",
        ],
        relatedChapters: ["mysql-index", "mysql-optimization"],
        interviewFrequency: "high",
      },
      {
        id: "mysql-sharding",
        title: "分库分表与读写分离",
        level: 4,
        description: "分库分表策略、ShardingSphere、主从复制、读写分离",
        content: `## 分库分表策略

### 垂直分库
- 按业务模块拆分
- 每个库独立部署

### 垂直分表
- 大字段拆分到扩展表
- 减少单行大小

### 水平分库
- 按分片键取模/范围
- 每个库数据结构相同

### 水平分表
- 单表数据量过大时拆分
- 按 ID 取模等策略

## 分片策略

- **取模分片**：均匀分布，扩容需迁移
- **范围分片**：按时间/ID 范围，分布不均
- **一致性哈希**：减少扩容迁移数据量

## ShardingSphere

### 核心功能
- 数据分片
- 读写分离
- 分布式事务
- 数据加密

## 主从复制

### 流程
1. Master 写入 binlog
2. Slave IO 线程拉取 binlog 到 relay log
3. Slave SQL 线程回放 relay log

### 三种模式
- **异步复制**：主库不管从库是否成功
- **半同步复制**：等待至少一个从库确认
- **全同步复制**：所有从库都确认

## 读写分离注意事项

- 主从延迟问题
- 事务内强制走主库
- 实时性要求高的查询走主库`,
        keyPoints: [
          "水平分库 vs 垂直分库",
          "分片策略对比（取模/范围/一致性哈希）",
          "主从复制原理与 binlog 格式",
          "读写分离架构",
          "分布式事务方案（XA/TCC/Seata）",
        ],
        relatedChapters: ["mysql-transaction", "mysql-optimization"],
        interviewFrequency: "medium",
      },
      {
        id: "mysql-optimization",
        title: "慢查询排查与调优",
        level: 5,
        description: "慢查询日志、profiling、参数调优、schema 设计",
        content: `## 慢查询排查流程

1. 开启慢查询日志
2. 分析慢查询 SQL
3. EXPLAIN 查看执行计划
4. 优化索引或 SQL
5. 验证优化效果

## 慢查询日志配置

\`\`\`sql
-- 开启慢查询日志
SET GLOBAL slow_query_log = ON;
-- 设置阈值（秒）
SET GLOBAL long_query_time = 1;
-- 查看日志位置
SHOW VARIABLES LIKE 'slow_query_log_file';
\`\`\`

## 常见慢查询原因

### 索引问题
- 未加索引
- 索引选择性差
- 索引失效（函数操作、隐式转换、LIKE '%xx'）

### SQL 问题
- JOIN 过多
- 子查询性能差
- 大分页（LIMIT offset 过大）
- ORDER BY 未使用索引

### 锁问题
- 行锁升级为表锁
- 间隙锁范围过大
- 死锁重试

## 参数调优

| 参数 | 说明 | 建议 |
|------|------|------|
| innodb_buffer_pool_size | 缓冲池大小 | 物理内存的 70% |
| innodb_log_file_size | redo log 大小 | 256M-4G |
| max_connections | 最大连接数 | 根据业务调整 |
| query_cache_type | 查询缓存 | 8.0 已废弃 |

## Schema 设计原则

1. 字段类型越小越好
2. NOT NULL 约束
3. 主键使用自增 ID 或雪花 ID
4. 适当冗余减少 JOIN
5. 大字段拆分到关联表`,
        keyPoints: [
          "慢查询定位与分析流程",
          "索引失效常见场景",
          "大分页优化（延迟关联/游标分页）",
          "MySQL 参数调优",
          "数据库 schema 设计规范",
        ],
        relatedChapters: ["mysql-index", "mysql-sharding"],
        interviewFrequency: "medium",
      },
    ],
  },
  {
    id: "redis",
    title: "Redis",
    description: "数据结构、持久化、集群、缓存策略、分布式锁",
    color: "#F59E0B",
    icon: "Zap",
    chapters: [
      {
        id: "redis-data-structures",
        title: "核心数据结构",
        level: 1,
        description: "String、List、Set、ZSet、Hash、底层编码",
        content: `## 五种基础数据结构

### String
- 场景：缓存、计数器、分布式锁
- 底层：SDS（Simple Dynamic String）
- SDS 优势：O(1) 获取长度、杜绝缓冲区溢出、二进制安全

### List
- 场景：消息队列、最新列表
- 底层：quicklist（ziplist 链表）

### Set
- 场景：去重、交集/并集运算
- 底层：intset / hashtable
- 命令：SADD、SISMEMBER、SINTER、SUNION

### ZSet（Sorted Set）
- 场景：排行榜、延时队列
- 底层：ziplist / skiplist + hashtable
- 每个元素关联一个 score

### Hash
- 场景：对象缓存
- 底层：ziplist / hashtable
- 命令：HSET、HGET、HGETALL

## 底层编码

| 类型 | 编码方式 | 触发条件 |
|------|---------|---------|
| String | int/embstr/raw | 根据长度自动选择 |
| List | quicklist | 始终使用 |
| Set | intset/hashtable | 元素全整数且数量<512 |
| ZSet | ziplist/skiplist | 元素数量<128且大小<64byte |
| Hash | ziplist/hashtable | 字段数量<512且大小<64byte |

## 高级数据结构

### HyperLogLog
- 基数统计，12KB 内存
- 标准误差 0.81%

### Bitmap
- 位操作，适合签到、日活统计

### GEO
- 地理位置存储与查询

### Stream
- 消息队列，支持消费者组`,
        keyPoints: [
          "五种基础数据结构与使用场景",
          "SDS 原理与优势",
          "跳表（skiplist）实现原理",
          "底层编码转换条件",
          "高级数据结构应用",
        ],
        relatedChapters: ["redis-persistence", "redis-cache"],
        interviewFrequency: "high",
      },
      {
        id: "redis-persistence",
        title: "持久化与淘汰策略",
        level: 2,
        description: "RDB、AOF、混合持久化、内存淘汰策略、过期策略",
        content: `## RDB 持久化

### 原理
- fork 子进程，写时复制（COW）
- 生成全量快照文件 dump.rdb

### 触发方式
- SAVE：阻塞主进程
- BGSAVE：异步执行
- 自动触发：配置 save 指令

### 优点
- 文件紧凑，适合备份
- 恢复速度快

### 缺点
- 可能丢失最后一次快照后的数据
- fork 耗时与内存大小成正比

## AOF 持久化

### 原理
- 追加写命令到 aof 文件
- 通过 appendfsync 控制刷盘策略

### 刷盘策略
- always：每条命令都刷盘，最安全最慢
- everysec：每秒刷盘，折中方案（推荐）
- no：由 OS 决定，最快但最不安全

### AOF 重写
- BGREWRITEAOF 压缩文件
- 合并冗余命令

## 混合持久化（Redis 4.0+）
- RDB 做全量快照 + AOF 做增量日志
- 加载时先加载 RDB 再回放 AOF

## 内存淘汰策略

| 策略 | 描述 |
|------|------|
| noeviction | 不淘汰，写返回错误 |
| allkeys-lru | 所有键中淘汰最近最少使用 |
| volatile-lru | 设置过期时间的键中淘汰 LRU |
| allkeys-lfu | 所有键中淘汰最不经常使用（4.0+） |
| volatile-ttl | 淘汰即将过期的键 |

## 过期策略
- **定期删除**：每 100ms 随机检查一批键
- **惰性删除**：访问时检查是否过期`,
        keyPoints: [
          "RDB 与 AOF 原理对比",
          "AOF 刷盘策略",
          "混合持久化优势",
          "8 种内存淘汰策略",
          "定期删除 + 惰性删除机制",
        ],
        relatedChapters: ["redis-data-structures", "redis-cluster"],
        interviewFrequency: "high",
      },
      {
        id: "redis-cluster",
        title: "集群模式",
        level: 3,
        description: "主从、Sentinel、Cluster、数据分片、高可用",
        content: `## 主从架构

### 复制流程
1. Slave 发送 psync 命令
2. Master 执行 BGSAVE 生成 RDB
3. Master 发送 RDB 到 Slave
4. Slave 加载 RDB
5. Master 持续发送写命令到 Slave

### 主从配置
\`\`\`bash
replicaof <master-ip> <master-port>
\`\`\`

## Redis Sentinel

### 功能
- 监控：检查主从是否可用
- 自动故障转移：主库宕机自动选新主
- 通知：通知客户端

### 故障转移流程
1. Sentinel 检测主库主观下线
2. 多个 Sentinel 确认客观下线
3. 选举 Leader Sentinel
4. 从库中选出新主库
5. 通知客户端新主库地址

## Redis Cluster

### 数据分片
- 16384 个哈希槽（hash slot）
- CRC16(key) % 16384 确定槽位
- 每个节点负责一部分槽位

### Gossip 协议
- 节点之间交换元数据
- 去中心化架构

### 高可用
- 主节点宕机，从节点自动晋升
- 超过半数主节点无法通信则集群不可用

### 限制
- 不支持多键操作（跨 slot）
- 使用 hash tag 让相关 key 落在同一 slot`,
        keyPoints: [
          "主从复制原理与全量/增量同步",
          "Sentinel 哨兵模式与故障转移",
          "Cluster 哈希槽分片机制",
          "Gossip 协议通信",
          "集群限制与 hash tag 使用",
        ],
        relatedChapters: ["redis-persistence", "redis-cache"],
        interviewFrequency: "high",
      },
      {
        id: "redis-cache",
        title: "缓存穿透/击穿/雪崩",
        level: 4,
        description: "缓存穿透、缓存击穿、缓存雪崩、缓存一致性、布隆过滤器",
        content: `## 缓存穿透

### 现象
查询一个不存在的数据，每次都会穿透到数据库

### 解决方案
1. 缓存空对象（设置短过期时间）
2. 布隆过滤器（Bloom Filter）

### 布隆过滤器原理
- 多个 hash 函数映射到位数组
- 判断"不在"一定准确
- 判断"在"可能有误判
- 不可删除

## 缓存击穿

### 现象
热点 key 过期，大量并发请求打到数据库

### 解决方案
1. **互斥锁**：只让一个线程去加载
2. **逻辑过期**：不设置 TTL，后台异步刷新
3. **永不过期**：热点 key 不做过期

## 缓存雪崩

### 现象
大量缓存同时过期，导致数据库压力骤增

### 解决方案
1. 过期时间加随机值
2. 多级缓存（本地缓存 + Redis）
3. 限流降级
4. 缓存预热

## 缓存一致性

### Cache Aside（旁路缓存）
- 读：先读缓存，miss 则读 DB 并回填
- 写：先写 DB，再删除缓存

### 延迟双删
\`\`\`java
// 先删除缓存
redis.del(key);
// 写数据库
db.update(data);
// 延迟一段时间再次删除
Thread.sleep(500);
redis.del(key);
\`\`\`

### 最终一致性方案
- 订阅 binlog（Canal）+ 删除缓存
- 保证最终一致性`,
        keyPoints: [
          "缓存穿透/击穿/雪崩解决思路",
          "布隆过滤器原理",
          "缓存一致性方案对比",
          "延迟双删策略",
          "Canal + binlog 最终一致性",
        ],
        relatedChapters: ["redis-data-structures", "redis-lock"],
        interviewFrequency: "high",
      },
      {
        id: "redis-lock",
        title: "分布式锁与实战",
        level: 5,
        description: "SETNX、RedLock、Redisson、分布式锁设计",
        content: `## 分布式锁演进

### V1：SETNX + EXPIRE
\`\`\`java
SETNX lock_key value
EXPIRE lock_key 30
\`\`\`
问题：两步操作非原子，EXPIRE 可能失败

### V2：SET NX EX（原子操作）
\`\`\`java
SET lock_key value NX EX 30
\`\`\`
问题：锁可能被其他线程误删

### V3：SET NX EX + 唯一标识
\`\`\`java
// 加锁
SET lock_key request_id NX EX 30
// 解锁
if redis.get(key) == request_id:
    redis.del(key)
\`\`\`
问题：GET + DEL 非原子，需要 Lua 脚本

### V4：Lua 脚本保证原子性
\`\`\`lua
if redis.call("get",KEYS[1]) == ARGV[1] then
    return redis.call("del",KEYS[1])
else
    return 0
end
\`\`\`

## RedLock 算法

### 流程
1. 获取当前时间
2. 依次向 N 个 Redis 节点加锁（超时短）
3. 计算耗时，超过半数节点成功且耗时 < TTL 则加锁成功
4. 失败则向所有节点发起解锁

### 优缺点
- 优点：高可用，容忍部分节点故障
- 缺点：复杂度高，时钟漂移问题

## Redisson 实现

### 看门狗机制
- 默认锁超时 30s
- 每隔 10s 自动续期
- 业务完成释放锁

## 实战注意事项

1. **可重入**：同一线程可重复加锁
2. **公平锁**：按请求顺序获取锁
3. **读写锁**：读读不互斥，读写互斥
4. **信号量**：控制并发量`,
        keyPoints: [
          "分布式锁演进过程",
          "RedLock 算法与优缺点",
          "Redisson 看门狗机制",
          "可重入/公平锁/读写锁",
          "分布式锁 vs 本地锁",
        ],
        relatedChapters: ["redis-cache", "redis-cluster"],
        interviewFrequency: "medium",
      },
    ],
  },
  {
    id: "spring",
    title: "Spring",
    description: "IoC/AOP、Spring Boot、Spring Cloud、微服务",
    color: "#8B5CF6",
    icon: "Leaf",
    chapters: [
      {
        id: "spring-ioc-aop",
        title: "IoC 与 AOP 原理",
        level: 1,
        description: "IoC 容器、依赖注入、Bean 生命周期、AOP 代理",
        content: `## IoC 容器

### 核心接口
- BeanFactory：最底层容器
- ApplicationContext：高级容器（事件、资源、i18n）

### 依赖注入方式
- 构造器注入（推荐）
- Setter 注入
- 字段注入（@Autowired）

## Bean 生命周期

1. 实例化 Instantiation
2. 属性赋值 Populate
3. Aware 接口回调
4. BeanPostProcessor#postProcessBeforeInitialization
5. @PostConstruct / InitializingBean
6. BeanPostProcessor#postProcessAfterInitialization
7. 就绪使用
8. @PreDestroy / DisposableBean

### 作用域
- singleton（默认）
- prototype
- request / session / application

## AOP 实现

### 通知类型
- @Before
- @AfterReturning
- @AfterThrowing
- @After
- @Around

### 代理机制
- **JDK 代理**：基于接口，反射调用
- **CGLIB 代理**：基于类，ASM 生成子类

### 切面执行顺序
1. @Around 前半部分
2. @Before
3. 目标方法执行
4. @Around 后半部分
5. @After
6. @AfterReturning / @AfterThrowing`,
        keyPoints: [
          "IoC 容器工作原理",
          "Bean 生命周期完整流程",
          "循环依赖与三级缓存",
          "JDK 代理 vs CGLIB 代理",
          "AOP 通知类型与执行顺序",
        ],
        relatedChapters: ["spring-boot", "spring-mvc"],
        interviewFrequency: "high",
      },
      {
        id: "spring-boot",
        title: "Spring Boot 自动配置",
        level: 2,
        description: "自动配置原理、启动流程、Starter、@Conditional",
        content: `## 自动配置原理

### @SpringBootApplication 组合注解
- @SpringBootConfiguration：标识配置类
- @EnableAutoConfiguration：开启自动配置
- @ComponentScan：扫描组件

### 自动配置流程
1. @EnableAutoConfiguration 导入 AutoConfigurationImportSelector
2. 扫描 META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
3. 根据 @Conditional 条件判断是否生效
4. 加载对应的自动配置类

## Starter 机制

### 自定义 Starter 步骤
1. 创建 AutoConfiguration
2. 配置 spring.factories
3. 添加 @ConditionalOnClass / @ConditionalOnMissingBean
4. 提供配置属性绑定

## 启动流程

1. 创建 SpringApplication
2. 推断应用类型（Web/Reactive/None）
3. 加载 ApplicationContextInitializer
4. 加载 ApplicationListener
5. 确定主启动类
6. 准备 Environment
7. 创建 ApplicationContext
8. 刷新上下文（重要！触发自动配置）
9. 调用 CommandLineRunner / ApplicationRunner

## @Conditional 系列

- @ConditionalOnClass：类路径存在时
- @ConditionalOnMissingBean：Bean 不存在时
- @ConditionalOnProperty：配置属性匹配时
- @ConditionalOnExpression：SpEL 表达式
- @ConditionalOnWebApplication：Web 环境下`,
        keyPoints: [
          "自动配置加载流程",
          "自定义 Starter 开发",
          "Spring Boot 启动流程",
          "@Conditional 条件注解体系",
          "外部化配置优先级",
        ],
        relatedChapters: ["spring-ioc-aop", "spring-mvc"],
        interviewFrequency: "high",
      },
      {
        id: "spring-mvc",
        title: "Spring MVC 流程",
        level: 3,
        description: "DispatcherServlet、HandlerMapping、HandlerAdapter、拦截器",
        content: `## MVC 处理流程

1. 客户端发送请求
2. DispatcherServlet 接收请求
3. HandlerMapping 查找 Handler
4. HandlerAdapter 执行 Handler
5. Handler 返回 ModelAndView
6. ViewResolver 解析视图
7. 渲染视图响应

## DispatcherServlet 核心组件

### HandlerMapping
- RequestMappingHandlerMapping：@RequestMapping 映射
- SimpleUrlHandlerMapping：URL 映射

### HandlerAdapter
- RequestMappingHandlerAdapter：@RequestMapping 方法
- HttpRequestHandlerAdapter：HttpRequestHandler
- SimpleControllerHandlerAdapter：Controller 接口

### ViewResolver
- InternalResourceViewResolver：JSP 视图
- ThymeleafViewResolver：Thymeleaf 模板

## 拦截器链

### 执行顺序
1. preHandle 顺序执行
2. 目标方法执行
3. postHandle 逆序执行
4. afterCompletion 逆序执行

### 过滤器 vs 拦截器
| 过滤器 Filter | 拦截器 Interceptor |
|---------------|-------------------|
| Servlet 规范 | Spring 框架 |
| 所有请求 | 仅 Spring 管理的请求 |
| 无法获取 Bean | 可获取 Spring Bean |
| 在拦截器之前执行 | 在过滤器之后执行 |

## 异常处理

- @ExceptionHandler：局部异常处理
- @ControllerAdvice：全局异常处理
- HandlerExceptionResolver：异常解析器`,
        keyPoints: [
          "DispatcherServlet 请求处理流程",
          "HandlerMapping/HandlerAdapter 作用",
          "拦截器与过滤器区别",
          "RESTful 接口设计规范",
          "全局异常处理机制",
        ],
        relatedChapters: ["spring-boot", "spring-cloud"],
        interviewFrequency: "high",
      },
      {
        id: "spring-cloud",
        title: "Spring Cloud 微服务",
        level: 4,
        description: "注册中心、网关、配置中心、服务调用、链路追踪",
        content: `## 服务注册与发现

### Eureka
- 服务注册、心跳检测
- AP 原则（优先可用性）
- 自我保护机制

### Nacos
- 注册中心 + 配置中心
- CP + AP 模式切换
- 支持健康检查

## 网关（Gateway）

### 核心概念
- Route：路由
- Predicate：匹配条件
- Filter：过滤链

### 配置示例
\`\`\`yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/user/**
          filters:
            - StripPrefix=1
\`\`\`

## 配置中心

### Nacos Config
- 动态刷新 @RefreshScope
- 配置变更监听

### Apollo
- 配置管理界面
- 灰度发布

## 服务调用

### Feign/OpenFeign
- 声明式 HTTP 客户端
- 集成负载均衡 Ribbon
- 集成 Sentinel 熔断

### 负载均衡
- Ribbon：客户端负载均衡
- 策略：轮询/随机/最少并发/响应时间加权

## 分布式链路追踪

### Sleuth + Zipkin
- Trace ID 串联调用链
- Span 标识每次调用
- Zipkin 存储和展示

## Sentinel 熔断限流

### 限流模式
- 直接拒绝
- 预热（Warm Up）
- 排队等待

### 熔断策略
- 慢调用比例
- 异常比例
- 异常数`,
        keyPoints: [
          "Eureka vs Nacos 注册中心对比",
          "Gateway 路由与过滤器",
          "Feign 声明式调用与负载均衡",
          "Sentinel 限流与熔断",
          "分布式链路追踪原理",
        ],
        relatedChapters: ["spring-mvc", "system-design"],
        interviewFrequency: "high",
      },
      {
        id: "spring-governance",
        title: "服务治理与配置中心",
        level: 5,
        description: "服务网格、配置管理、服务降级、灰度发布、全链路压测",
        content: `## 服务治理体系

### 限流（Rate Limiting）
- 令牌桶：允许突发流量
- 漏桶：平滑流量
- 计数器：固定窗口

### 熔断（Circuit Breaker）
- 关闭 → 打开 → 半开
- 熔断恢复探测

### 降级（Degradation）
- 非核心服务降级
- 返回兜底数据（Mock）

## 灰度发布

### 策略
1. 按比例灰度（5% → 20% → 100%）
2. 按标签灰度（特定用户/地域）
3. 蓝绿部署
4. 金丝雀发布

### 实现
- Nacos 元数据 + 路由规则
- Gateway 灰度过滤器
- LoadBalancer 自定义规则

## 全链路压测

### 挑战
- 流量隔离
- 数据隔离（影子表/影子库）
- 压测标记传递

## 配置管理最佳实践

1. 配置中心统一管理
2. 敏感信息加密
3. 配置变更审计
4. 多环境隔离

## 服务网格（Service Mesh）

### Istio 架构
- 控制平面：Pilot、Mixer、Citadel
- 数据平面：Envoy Sidecar

### 优势
- 无侵入
- 流量控制
- 可观测性`,
        keyPoints: [
          "限流/熔断/降级设计模式",
          "灰度发布方案",
          "全链路压测架构",
          "配置中心最佳实践",
          "服务网格 vs 传统微服务",
        ],
        relatedChapters: ["spring-cloud", "system-design"],
        interviewFrequency: "medium",
      },
    ],
  },
  {
    id: "system-design",
    title: "系统设计",
    description: "设计模式、消息队列、分布式理论、场景题",
    color: "#EF4444",
    icon: "Settings",
    chapters: [
      {
        id: "design-patterns",
        title: "设计模式",
        level: 1,
        description: "单例、工厂、代理、策略、观察者、模板方法",
        content: `## 创建型模式

### 单例模式
- **饿汉式**：类加载时创建（浪费内存）
- **懒汉式**：使用时创建（线程安全问题）
- **双重检查锁（DCL）**：volatile + synchronized
- **静态内部类**：推荐方式，利用类加载机制
- **枚举**：最简单，防止反序列化

### 工厂模式
- **简单工厂**：一个工厂创建所有产品
- **工厂方法**：每个产品对应一个工厂接口
- **抽象工厂**：产品族创建

### 建造者模式
- 分离构建和表示
- 适用于复杂对象创建（Lombok @Builder）

## 结构型模式

### 代理模式
- **静态代理**：编译期确定代理
- **JDK 动态代理**：基于接口
- **CGLIB 动态代理**：基于类

### 适配器模式
- 适配不兼容的接口
- Spring MVC HandlerAdapter

### 装饰器模式
- 动态增强对象功能
- Java IO 流体系

## 行为型模式

### 策略模式
- 定义算法族，可互相替换
- 场景：支付渠道、促销活动

### 观察者模式
- 发布-订阅模型
- Spring Event / Listener

### 模板方法模式
- 定义算法骨架，子类实现细节
- JdbcTemplate、RestTemplate`,
        keyPoints: [
          "单例模式 5 种实现与线程安全",
          "JDK 动态代理 vs CGLIB 原理",
          "策略模式应用场景",
          "Spring 中使用的设计模式",
          "工厂方法 vs 抽象工厂",
        ],
        relatedChapters: ["spring-ioc-aop", "message-queue"],
        interviewFrequency: "medium",
      },
      {
        id: "message-queue",
        title: "消息队列",
        level: 2,
        description: "RocketMQ、Kafka 核心概念、消息可靠性、顺序消息",
        content: `## 消息队列选型

| 特性 | RocketMQ | Kafka | RabbitMQ |
|------|----------|-------|----------|
| 吞吐量 | 10万+/s | 百万+/s | 万级/s |
| 延迟 | 毫秒级 | 毫秒级 | 微秒级 |
| 顺序消息 | 支持 | 分区内支持 | 支持 |
| 事务消息 | 支持 | 不支持 | 支持 |
| 消息回溯 | 支持 | 支持 | 不支持 |

## RocketMQ 核心概念

### 架构组件
- **NameServer**：路由注册中心
- **Broker**：消息存储节点
- **Producer**：消息生产者
- **Consumer**：消息消费者

### 消息模型
- Topic：逻辑分类
- Queue：物理分区
- MessageQueue：Topic 的分片

### 消息可靠性
1. Producer 同步发送 + 重试
2. Broker 刷盘机制（同步/异步）
3. Consumer 消费确认
4. 死信队列处理失败消息

## Kafka 核心概念

### 架构
- **ZooKeeper**：元数据管理
- **Broker**：消息存储
- **Partition**：日志分片
- **Consumer Group**：消费组

### ISR 机制
- Leader 维护 ISR 列表
- Follower 从 Leader 拉取数据
- 落后太多被踢出 ISR

### 消息顺序性
- 同一分区内消息有序
- 指定 key 始终进入同一分区

## 消息可靠投递

1. 生产端：ACK 机制
2. 存储端：多副本同步
3. 消费端：手动 ACK`,
        keyPoints: [
          "RocketMQ vs Kafka 架构对比",
          "消息可靠性保证机制",
          "顺序消息实现",
          "事务消息原理",
          "消息积压处理方案",
        ],
        relatedChapters: ["distributed-theory", "system-design-scenarios"],
        interviewFrequency: "high",
      },
      {
        id: "distributed-theory",
        title: "分布式理论",
        level: 3,
        description: "CAP、BASE、一致性协议（Paxos/Raft）、分布式事务",
        content: `## CAP 理论

- **C（一致性）**：所有节点看到相同数据
- **A（可用性）**：请求总能得到响应
- **P（分区容错性）**：系统能容忍网络分区

### CAP 权衡
- CP 系统：ZooKeeper、etcd
- AP 系统：Eureka
- CA 系统：单机数据库（实际无法完全 CA）

## BASE 理论

- **BA（基本可用）**：允许降级
- **S（软状态）**：中间状态允许存在
- **E（最终一致性）**：不用实时一致

## 一致性协议

### Paxos
- **Proposer**：提出提案
- **Acceptor**：批准提案
- **Learner**：学习结果

### Raft（更易理解）
1. **Leader 选举**：选举超时触发
2. **日志复制**：Leader 追加日志到 Follower
3. **安全性**：只有最新日志的节点能当选

### ZAB（ZooKeeper）
- 崩溃恢复 + 消息广播
- Epoch 标识领导任期

## 分布式事务方案

| 方案 | 一致性 | 适用场景 |
|------|--------|---------|
| 2PC（两阶段提交） | 强一致 | 短事务，低并发 |
| TCC（Try-Confirm-Cancel） | 强一致 | 跨服务，高并发 |
| 本地消息表 | 最终一致 | 异步场景 |
| 可靠消息（RocketMQ） | 最终一致 | 异步场景 |
| Seata AT | 强一致 | 接入简单 |`,
        keyPoints: [
          "CAP 理论与 BASE 理论",
          "Raft 协议核心流程",
          "分布式事务方案对比",
          "Seata AT 模式原理",
          "Paxos vs Raft vs ZAB",
        ],
        relatedChapters: ["message-queue", "system-design-ha"],
        interviewFrequency: "high",
      },
      {
        id: "system-design-ha",
        title: "高可用设计",
        level: 4,
        description: "负载均衡、限流、熔断、降级、多活架构、容灾",
        content: `## 高可用策略

### 冗余
- 多副本、主从、多机房
- 消除单点故障

### 故障隔离
- 线程池隔离
- 信号量隔离
- 舱壁模式（Bulkhead）

## 负载均衡

### 四层 vs 七层
- **四层（LVS）**：IP+端口转发
- **七层（Nginx）**：HTTP 内容分发

### 算法
- 轮询、加权轮询
- 最少连接
- 一致性哈希

## 限流实现

### 单机限流
- Guava RateLimiter（令牌桶）
- Semaphore

### 分布式限流
- Redis + Lua 脚本
- Sentinel

## 多活架构

| 方案 | RTO | RPO | 成本 |
|------|-----|-----|------|
| 主备 | 分钟级 | 秒级 | 低 |
| 双活 | 秒级 | 秒级 | 中 |
| 三地五中心 | 分钟级 | 分钟级 | 高 |

## 容灾演练

1. 定期故障注入（Chaos Engineering）
2. 模拟网络分区、节点宕机
3. 验证自动恢复能力

## 监控体系

### 三要素
- 指标（Metrics）：Prometheus
- 日志（Logging）：ELK
- 链路（Tracing）：Jaeger`,
        keyPoints: [
          "高可用设计原则（冗余/隔离/降级）",
          "负载均衡四层 vs 七层",
          "分布式限流实现方案",
          "多活架构对比",
          "全链路监控体系",
        ],
        relatedChapters: ["distributed-theory", "system-design-scenarios"],
        interviewFrequency: "medium",
      },
      {
        id: "system-design-scenarios",
        title: "场景题实战",
        level: 5,
        description: "秒杀系统、短链接、即时通讯、海量数据处理",
        content: `## 秒杀系统设计

### 核心挑战
- 高并发（瞬时流量）
- 超卖问题
- 刷单防护

### 架构方案
1. **前端**：按钮置灰 + CDN 静态化
2. **网关**：限流 + 拦截重复请求
3. **预减库存**：Redis 原子递减
4. **消息队列**：异步下单，削峰填谷
5. **数据库**：乐观锁更新库存

### 防超卖
\`\`\`sql
UPDATE seckill_stock
SET stock = stock - 1
WHERE sku_id = ? AND stock > 0
\`\`\`

## 短链接系统

### 核心逻辑
1. 长 URL → 短码映射
2. 哈希 + 碰撞处理
3. 重定向（301/302）

### 发号器方案
- 雪花 ID 转 Base62
- 预生成 ID 池

## 即时通讯 IM

### 推拉模式
- **推模式**：实时在线推送
- **拉模式**：离线拉取消息

### WebSocket 集群
- 连接保持
- 消息路由
- 离线消息存储

## 海量数据 TopK

### 大文件找 Top 100
1. 哈希分片到多个文件
2. 每个文件单独排序
3. 归并排序取 Top 100

### 实时 TopK
- 小顶堆（O(nlogk)）
- 滑动窗口

## 设计原则

### SOLID 原则
- 单一职责（S）
- 开闭原则（O）
- 里氏替换（L）
- 接口隔离（I）
- 依赖反转（D）`,
        keyPoints: [
          "秒杀系统架构设计",
          "短链接系统实现方案",
          "IM 实时消息推送架构",
          "海量数据 TopK 解决方案",
          "系统设计面试答题框架",
        ],
        relatedChapters: ["distributed-theory", "system-design-ha"],
        interviewFrequency: "high",
      },
    ],
  },
];

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

export function getChapter(categoryId: string, chapterId: string): Chapter | undefined {
  const category = getCategory(categoryId);
  return category?.chapters.find((ch) => ch.id === chapterId);
}

export function getRelatedChapters(chapter: Chapter): { category: Category; chapter: Chapter }[] {
  const result: { category: Category; chapter: Chapter }[] = [];
  for (const relatedId of chapter.relatedChapters) {
    for (const category of CATEGORIES) {
      const found = category.chapters.find((ch) => ch.id === relatedId);
      if (found) {
        result.push({ category, chapter: found });
      }
    }
  }
  return result;
}

export function getAllChapters(): { category: Category; chapter: Chapter }[] {
  const result: { category: Category; chapter: Chapter }[] = [];
  for (const category of CATEGORIES) {
    for (const chapter of category.chapters) {
      result.push({ category, chapter });
    }
  }
  return result;
}

export const LEVEL_COLORS = [
  "",
  "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
];

export const LEVEL_LABELS = ["", "L1 基础", "L2 进阶", "L3 深入", "L4 高级", "L5 实战"];
