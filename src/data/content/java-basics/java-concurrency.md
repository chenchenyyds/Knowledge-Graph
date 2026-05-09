## JMM（Java 内存模型）

JMM 是一套规范，定义了多线程程序中共享变量的访问规则，解决了**缓存一致性**和**指令重排序**问题。

### 内存模型结构

```
                    ┌───────────────┐
                    │   主内存        │
                    │  (所有线程共享) │
                    │ ┌───────────┐ │
                    │ │  共享变量  │ │
                    │ └───────────┘ │
                    └──────┬────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    ┌──────────┐     ┌──────────┐     ┌──────────┐
    │ 工作内存  │     │ 工作内存  │     │ 工作内存  │
    │ (本地缓存)│     │ (本地缓存)│     │ (本地缓存)│
    │ ┌──────┐ │     │ ┌──────┐ │     │ ┌──────┐ │
    │ │副本  │ │     │ │副本  │ │     │ │副本  │ │
    │ └──────┘ │     │ └──────┘ │     │ └──────┘ │
    │ Thread A │     │ Thread B │     │ Thread C │
    └──────────┘     └──────────┘     └──────────┘
```

**规则**：
1. 所有共享变量存在主内存。
2. 每个线程有自己的工作内存，存储变量的副本。
3. 线程不能直接操作主内存，必须先将变量复制到工作内存。
4. 不同线程之间不能直接访问对方的工作内存。

### 三大特性

| 特性 | 定义 | 实现手段 |
|------|------|---------|
| **原子性** | 一个或多个操作要么全部执行且不被中断 | synchronized、Lock、Atomic 类 |
| **可见性** | 一个线程修改共享变量后，其他线程能立即看到 | volatile、synchronized、final |
| **有序性** | 程序按代码顺序执行（禁止指令重排序） | volatile、synchronized、happens-before |

### happens-before 规则

如果两个操作满足 happens-before 关系，则第一个操作的结果对第二个操作可见。

| 规则 | 说明 |
|------|------|
| **程序次序规则** | 一个线程内，写在前面的操作 happens-before 后面的操作 |
| **volatile 规则** | volatile 变量的写 happens-before 后续对该变量的读 |
| **锁规则** | unlock happens-before 后续的 lock |
| **传递性** | A happens-before B，B happens-before C → A happens-before C |
| **线程启动规则** | Thread.start() happens-before 该线程的任何操作 |
| **线程终止规则** | 线程的所有操作 happens-before 其他线程检测到该线程终止 |
| **中断规则** | 线程 interrupt() happens-before 检测到中断 |
| **对象终结规则** | 对象的构造方法结束 happens-before finalize() |

### volatile 原理

```java
// volatile 变量的读写可见性和禁止重排序
private volatile boolean flag = false;

// 线程A
flag = true;  // 写 volatile：强制刷新到主内存

// 线程B
if (flag) {   // 读 volatile：强制从主内存读取
    // ...
}
```

**内存屏障**（Memory Barrier）：
```
写入 volatile 变量：
  [普通写] → [StoreStore Barrier] → [volatile 写] → [StoreLoad Barrier]

读取 volatile 变量：
  [volatile 读] → [LoadLoad Barrier] → [LoadStore Barrier] → [普通读]
```

## synchronized 原理

### 三种使用方式

```java
// 1. 实例方法锁（锁对象：this）
public synchronized void instanceMethod() { }

// 2. 静态方法锁（锁对象：Class 对象）
public static synchronized void staticMethod() { }

// 3. 同步代码块（锁对象：指定对象）
public void blockMethod() {
    synchronized (this) { }
}
```

### 锁升级过程（JDK 6+ 锁优化）

synchronized 在 JDK 6 之后引入了偏向锁、轻量级锁和重量级锁的**锁升级**机制。

```
                      Java 对象头 Mark Word（64位 JVM）
        ┌────────────────────────────────────────────────────────┐
        |                    Mark Word (8 bytes)                  |
        ├──────────┬──────────┬──────────┬───────────────────────┤
        | 分代年龄  |   标识位   |  锁状态   |       存储内容        |
        ├──────────┼──────────┼──────────┼───────────────────────┤
        |    0     |    01    |  无锁     | 偏向锁标识=0 + hash   |
        |    0     |    01    |  偏向锁   | 偏向锁标识=1 + 线程ID |
        |    0     |    00    | 轻量级锁  | 指向 Lock Record 指针 |
        |    0     |    10    | 重量级锁  | 指向 Monitor 指针      |
        |    -     |    11    |  GC标记   | 空                   |
        └──────────┴──────────┴──────────┴───────────────────────┘
```

**锁升级流程**：

```
      无锁
       │
       ▼
    偏向锁               偏向锁撤销（有其他线程竞争）
  (偏向锁标识=1            │
   记录线程ID)              ▼
     │                 轻量级锁
     │              (CAS 自旋获取)
     │                    │
     │             ┌──────┴──────┐
     │             │             │
     │          自旋成功        自旋失败（或自旋次数耗尽）
     │             │             │
     │          保持轻量级       ▼
     │                      重量级锁
     │                  (OS 互斥量)
     │                        │
     └───────────────────────┘
  偏向锁在 JDK 15 默认禁用，JDK 21 已移除
```

**锁升级核心源码（HotSpot）**：

```java
// 偏向锁获取（简化伪码）
if (MarkWord 偏向锁标识位 == 1 && 线程ID == 当前线程) {
    // 已偏向当前线程，直接执行
} else if (MarkWord 偏向锁标识位 == 1 && 线程ID != 当前线程) {
    // 偏向锁撤销（需要 STW）
    if (原线程已退出同步块) {
        撤销偏向锁，升级为轻量级锁
    } else {
        升级为轻量级锁，原线程在安全点挂起
    }
}

// 轻量级锁获取
if (CAS(MarkWord, 无锁标记, LockRecord指针)) {
    // 获取成功
} else {
    // 自旋 + 膨胀为重量级锁
}
```

**各个锁的对比**：

| 锁类型 | 优点 | 缺点 | 适用场景 |
|--------|------|------|---------|
| 偏向锁 | 加锁解锁无开销（仅一次 CAS） | 线程间竞争时撤销需要 STW | 单线程执行同步块 |
| 轻量级锁 | 响应快，不阻塞 | 自旋消耗 CPU | 少量线程交替执行 |
| 重量级锁 | 不消耗 CPU（阻塞） | 线程阻塞/唤醒慢 | 大量线程竞争 |

## AQS（AbstractQueuedSynchronizer）

AQS 是 Java 并发包的基石，ReentrantLock、CountDownLatch、Semaphore、CyclicBarrier 等都基于 AQS 实现。

### AQS 核心结构

```
                       AQS
    ┌────────────────────────────────────────┐
    │  state (volatile int)                  │  ← 同步状态（0=未锁，>0=已锁）
    │  exclusiveOwnerThread (继承自 AOS)     │  ← 当前持有锁的线程
    │                                        │
    │  CLH 队列 (FIFO 双向链表)              │
    │  ┌──┐   ┌──┐   ┌──┐   ┌──┐          │
    │  │ H│ ◄→│  │ ◄→│  │ ◄→│ T│          │  ← head 是 dummy 节点
    │  └──┘   └──┘   └──┘   └──┘          │
    │   head                      tail       │
    │                                        │
    │  每个 Node 包含：                       │
    │  - thread（等待线程）                   │
    │  - waitStatus（0/SIGNAL/CANCELLED/...)  │
    │  - prev/next（前驱/后继）               │
    └────────────────────────────────────────┘
```

### AQS 的设计思想

```
    tryAcquire / tryRelease         ← 子类实现（模板方法模式）
          │
          ▼
    AQS 维护 CLH 队列               ← AQS 框架实现
          │
          ▼
    通过 CAS 修改 state
          │
          ▼
    线程阻塞/唤醒（LockSupport.park/unpark）
```

### ReentrantLock 实现分析

```java
// 公平锁 vs 非公平锁
ReentrantLock lock = new ReentrantLock();       // 非公平锁（默认）
ReentrantLock fairLock = new ReentrantLock(true); // 公平锁

// 非公平锁 tryAcquire
final boolean nonfairTryAcquire(int acquires) {
    final Thread current = Thread.currentThread();
    int c = getState();
    if (c == 0) {
        // 直接尝试 CAS 获取锁（不检查队列）
        if (compareAndSetState(0, acquires)) {
            setExclusiveOwnerThread(current);
            return true;
        }
    } else if (current == getExclusiveOwnerThread()) {
        // 可重入：state + 1
        int nextc = c + acquires;
        setState(nextc);
        return true;
    }
    return false;
}

// 公平锁 tryAcquire
protected final boolean tryAcquire(int acquires) {
    // 先检查队列中是否有前驱节点
    if (hasQueuedPredecessors()) return false;  // 有等待线程 → 不插队
    // 然后才尝试 CAS
    return nonfairTryAcquire(acquires);
}
```

### AQS 条件队列（Condition）

```
          AQS CLH 队列（同步队列）
    ┌────┐   ┌────┐   ┌────┐
    │ H  │ → │    │ → │ T  │
    └────┘   └────┘   └────┘
                         │
                    等待 signal
                         │
                         ▼
          Condition 条件队列（单向链表）
    ┌────┐   ┌────┐   ┌────┐
    │ C1 │ → │ C2 │ → │ C3 │
    └────┘   └────┘   └────┘
  通过 await() 从同步队列移到条件队列
  通过 signal() 从条件队列移到同步队列
```

### ReentrantLock vs synchronized

| 特性 | synchronized | ReentrantLock |
|------|-------------|---------------|
| 锁机制 | 关键字（内置锁） | API 层面 |
| 锁释放 | 自动（异常退出释放） | 必须手动 unlock（finally 中） |
| 可重入 | 是 | 是 |
| 公平性 | 非公平 | 可选公平/非公平 |
| 中断响应 | 不响应中断 | lockInterruptibly() |
| 超时 | 不支持 | tryLock(timeout, unit) |
| 条件等待 | wait/notify | Condition.await/signal |
| 性能 | JDK 6 后差异不大 | 差异不大 |

## 线程池（ThreadPoolExecutor）深度解析

### 核心参数

```java
public ThreadPoolExecutor(
    int corePoolSize,               // 核心线程数
    int maximumPoolSize,            // 最大线程数
    long keepAliveTime,             // 空闲线程存活时间
    TimeUnit unit,                  // 时间单位
    BlockingQueue<Runnable> workQueue, // 任务队列
    ThreadFactory threadFactory,    // 线程工厂
    RejectedExecutionHandler handler  // 拒绝策略
)
```

### 执行流程

```
    提交新任务
        │
        ▼
    ┌─────────────────────────────────────────────┐
    │  判断：工作线程数 < corePoolSize            │──→ 创建核心线程执行任务
    └─────────────────────────────────────────────┘
        │ 否
        ▼
    ┌─────────────────────────────────────────────┐
    │  判断：工作队列 workQueue 是否已满            │──→ 任务入队等待
    └─────────────────────────────────────────────┘
        │ 已满
        ▼
    ┌─────────────────────────────────────────────┐
    │  判断：工作线程数 < maximumPoolSize          │──→ 创建临时线程执行任务
    └─────────────────────────────────────────────┘
        │ 否
        ▼
    ┌─────────────────────────────────────────────┐
    │  执行拒绝策略                                │
    └─────────────────────────────────────────────┘
```

### 线程池状态

```
    RUNNING → SHUTDOWN → STOP → TIDYING → TERMINATED
       │         │
       │         └── 不接受新任务，但处理队列中已有任务
       └──────────── 接受新任务，处理队列中任务
```

线程池状态使用 `ctl`（AtomicInteger）的高 3 位存储，低 29 位存储工作线程数：

```java
private final AtomicInteger ctl = new AtomicInteger(ctlOf(RUNNING, 0));
private static final int COUNT_BITS = Integer.SIZE - 3; // 29
private static final int CAPACITY   = (1 << COUNT_BITS) - 1; // 最大线程数

// 状态
private static final int RUNNING    = -1 << COUNT_BITS;
private static final int SHUTDOWN   =  0 << COUNT_BITS;
private static final int STOP       =  1 << COUNT_BITS;
private static final int TIDYING    =  2 << COUNT_BITS;
private static final int TERMINATED =  3 << COUNT_BITS;
```

### 四种内置拒绝策略

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| AbortPolicy | 抛 RejectedExecutionException | 默认，需要感知任务丢失 |
| CallerRunsPolicy | 由提交任务的线程直接执行 | 降低提交速度，背压 |
| DiscardPolicy | 静默丢弃 | 可容忍丢任务 |
| DiscardOldestPolicy | 丢弃队列中最旧的任务，重新提交 | 任务有时效性 |

### 四种常见线程池（Executors 工厂方法）

```java
// 1. 固定线程数
ExecutorService fixed = Executors.newFixedThreadPool(10);
// core=10, max=10, queue=LinkedBlockingQueue(无界)
// 风险：队列无线增长，可能 OOM

// 2. 单线程
ExecutorService single = Executors.newSingleThreadExecutor();
// core=1, max=1, queue=LinkedBlockingQueue(无界)

// 3. 缓存线程池
ExecutorService cached = Executors.newCachedThreadPool();
// core=0, max=MAX_INT, queue=SynchronousQueue
// 风险：线程数无线增长，可能 OOM

// 4. 定时线程池
ScheduledExecutorService scheduled = Executors.newScheduledThreadPool(5);
// 支持 scheduleAtFixedRate / scheduleWithFixedDelay
```

**阿里巴巴 Java 开发手册建议**：禁止使用 Executors 创建线程池，应当手动创建 ThreadPoolExecutor，明确参数，避免 OOM。

### 线程池最佳实践

```java
// 推荐的自定义线程池
ThreadPoolExecutor executor = new ThreadPoolExecutor(
    10,                              // corePoolSize
    20,                              // maximumPoolSize
    60L, TimeUnit.SECONDS,           // keepAliveTime
    new LinkedBlockingQueue<>(1000), // 有界队列，避免 OOM
    new ThreadFactoryBuilder()       // 给线程命名（Guava）
        .setNameFormat("biz-pool-%d")
        .build(),
    new ThreadPoolExecutor.CallerRunsPolicy() // 降级策略
);

// 监控线程池
executor.getPoolSize();        // 当前线程数
executor.getActiveCount();     // 活跃线程数
executor.getQueue().size();    // 队列长度
executor.getCompletedTaskCount(); // 已完成任务数
```

### 线程池参数计算公式

- **CPU 密集型**：`corePoolSize = CPU核数 + 1`（避免因缺页中断导致线程闲置）
- **IO 密集型**：`corePoolSize = CPU核数 × 2`（或更多，取决于 IO 等待时间占比）
- **通用公式**：`corePoolSize = CPU核数 / (1 - 阻塞系数)`
  - 阻塞系数 = 阻塞时间 / (阻塞时间 + 计算时间)

## ThreadLocal

### 原理

每个 Thread 内部维护一个 ThreadLocalMap，ThreadLocal 作为 key，值作为 value。

```
                 Thread
    ┌──────────────────────────────┐
    │  threadLocals (ThreadLocalMap)│
    │  ┌────────────────────┐      │
    │  │ Entry[] table      │      │
    │  │ ┌───────────────┐  │      │
    │  │ │ key: TL Ref   │  │      │  key = ThreadLocal 的弱引用
    │  │ │ value: 副本值  │  │      │
    │  │ └───────────────┘  │      │
    │  │ ┌───────────────┐  │      │
    │  │ │ key: TL Ref   │  │      │
    │  │ │ value: 副本值  │  │      │
    │  │ └───────────────┘  │      │
    │  └────────────────────┘      │
    └──────────────────────────────┘
```

### ThreadLocalMap 的 key 使用弱引用

```
ThreadLocal 引用链：
  Thread.ref → ThreadLocalMap → Entry (key = 弱引用 ThreadLocal)

    强引用链：ThreadLocal Ref → ThreadLocal 对象 (有强引用时不会被回收)
    弱引用链：ThreadLocalMap.Entry → ThreadLocal 对象 (GC 时会被回收)

  Entry 的 key 是弱引用，GC 发生时如果 ThreadLocal 外部强引用为 null，
  则 Entry.key 变为 null，但 Entry.value 不为 null → 内存泄漏！
```

### 内存泄漏问题与解决方法

```java
// ❌ 错误用法
ThreadLocal<UserInfo> tl = new ThreadLocal<>();
tl.set(new UserInfo());  // Entry.value 强引用 UserInfo
// tl 不再使用，但线程在池中存活
// → UserInfo 无法被 GC（Thread → ThreadLocalMap → Entry → value）

// ✅ 正确用法
ThreadLocal<UserInfo> tl = new ThreadLocal<>();
try {
    tl.set(new UserInfo());
    // 使用 tl ...
} finally {
    tl.remove(); // 务必在 finally 中 remove，清除 Entry
}
```

## CAS（Compare And Swap）

### 原理

CAS 是一条 CPU 原子指令（CMPXCHG），包含三个操作数：内存地址 V、期望值 A、新值 B。当且仅当 V 的值等于 A 时，将 V 更新为 B，否则不更新。

```java
// AtomicInteger.incrementAndGet 简化实现
public final int incrementAndGet() {
    for (;;) {
        int current = get();         // 当前值
        int next = current + 1;      // 目标值
        if (compareAndSet(current, next)) // CAS 更新
            return next;
        // 失败则重试
    }
}
```

### CAS 三大问题

| 问题 | 说明 | 解决方案 |
|------|------|---------|
| **ABA 问题** | A→B→A，CAS 误认为未修改 | AtomicStampedReference（版本号） |
| **自旋开销** | 长时间自旋浪费 CPU | 自旋次数限制 + 自适应自旋 |
| **只能操作单个变量** | 无法同时 CAS 多个变量 | AtomicReference（包装多个变量） |

### Atomic 类体系

```java
// 基本类型
AtomicInteger, AtomicLong, AtomicBoolean

// 引用类型
AtomicReference<T>, AtomicStampedReference<T>,
AtomicMarkableReference<T>

// 数组类
AtomicIntegerArray, AtomicLongArray, AtomicReferenceArray

// 更新器（对象字段）
AtomicIntegerFieldUpdater<T>, AtomicLongFieldUpdater<T>,
AtomicReferenceFieldUpdater<T,V>

// JDK 8+ 累加器（高并发性能更好，CounterCell）
LongAdder, LongAccumulator, DoubleAdder, DoubleAccumulator
```

**LongAdder vs AtomicLong**：
- AtomicLong：每次 CAS 更新一个变量，高并发下 CAS 竞争激烈，失败率高。
- LongAdder：维护一个 base + Cell[] 数组，每个线程更新自己的 Cell，最终 sum() 累加。适合"写多读少"的场景。

## 面试高频 Q&A

**Q1: volatile 能保证原子性吗？**
不能。volatile 只能保证可见性和有序性，不能保证原子性。例如 `count++` 是非原子操作（读-改-写），volatile 无法保证原子性，需要加锁或使用 AtomicInteger。

**Q2: synchronized 和 Lock 的区别？**
- synchronized 是关键字，自动释放锁；Lock 是 API，需要手动 unlock。
- Lock 支持可中断、公平锁、超时、多 Condition。
- JDK 6 后性能差异不大。
- synchronized 基于 Monitor，Lock 基于 AQS。

**Q3: 线程池的线程什么时候创建？**
- corePoolSize：提交任务时如果线程数 < corePoolSize 就创建（懒加载）。
- 临时线程：队列满且线程数 < maximumPoolSize 时创建。
- prestartAllCoreThreads()：强制提前创建所有核心线程。

**Q4: ThreadLocal 的 key 为什么设计为弱引用？**
设计为弱引用是为了让 ThreadLocal 对象能被 GC 回收。如果 ThreadLocal 使用完毕置为 null 后，弱引用会被回收，value 虽然有强引用但可以通过 `remove()` 清理。如果 key 设计为强引用，即使 ThreadLocal 对象已无外部引用，Entry.key 仍然阻止 GC，内存泄漏更严重。

**Q5: 什么是伪共享（False Sharing）？如何解决？**
伪共享指多个线程修改不同变量但位于同一缓存行（通常 64 字节），导致缓存行无效。解决：缓存行填充（@Contended 注解或手动填充 64 字节）。

**Q6: 如何实现一个延迟任务队列？**
- ScheduledThreadPoolExecutor：内部使用 DelayedWorkQueue（基于堆的延迟队列）。
- 或用 DelayQueue + 普通线程池。

---