## 分布式理论（Distributed Theory）

分布式系统是指一组通过网络通信、协同工作的计算机节点，对外表现为一个整体。分布式理论是解决分布式系统一致性问题的基础，也是系统设计面试的必考内容。

---

## 一、CAP 理论

CAP 理论是分布式系统的基石，由 Eric Brewer 在 2000 年提出。它指出一个分布式系统最多只能同时满足以下三个特性中的两个：

```
              一致性(C)
                 ●
                / \
               /   \
              /     \
             /       \
            /         \
           /           \
          /             \
         /               \
        ●─────────────────●
    可用性(A)           分区容错性(P)
```

### 三个特性详解

| 特性 | 英文 | 含义 |
|------|------|------|
| **一致性** | Consistency | 所有节点在同一时刻看到相同的数据 |
| **可用性** | Availability | 每个请求都能得到响应（成功或失败） |
| **分区容错性** | Partition Tolerance | 系统能容忍网络分区（节点间通信中断） |

### CAP 的权衡

在实际分布式系统中，**网络分区是不可避免的**（交换机故障、网线断裂等），因此 P 是必须保证的。我们实际上是在 C 和 A 之间做选择：

```
          CP 系统                    AP 系统
    ┌──────────────────┐     ┌──────────────────┐
    │                  │     │                  │
    │  发生网络分区时    │     │  发生网络分区时    │
    │                  │     │                  │
    │ 暂停非多数分区的  │     │  所有分区继续     │
    │  服务（放弃可用性）│     │  提供服务         │
    │                  │     │  （返回不一致数据） │
    │ 例子：ZooKeeper  │     │  例子：Eureka     │
    │      etcd        │     │       DNS        │
    └──────────────────┘     └──────────────────┘
```

**CA 系统**：单机数据库（MySQL 单实例），但实际上单机不涉及网络分区，严格来说不能算分布式系统。

| 系统 | 选择 | 说明 |
|------|------|------|
| ZooKeeper | CP | 发生分区时，少数派节点停止服务 |
| Eureka | AP | 发生分区时，各节点继续服务（返回可能过期的数据） |
| Nacos | CP/AP 切换 | 根据配置选择 CP 或 AP 模式 |
| Redis Cluster | CP | 发生分区时，少数派分区不可用 |
| Cassandra | AP | 发生分区时，各分区继续服务 |

### 面试重点

**CAP 不能简单理解为"3选2"**。实际设计中：
- 正常运行时，C 和 A 可以同时满足
- 只有发生网络分区时，才需要在 C 和 A 之间做选择
- 大多数业务场景优先保证 AP，通过其他手段达成最终一致性

---

## 二、BASE 理论

BASE 理论是对 CAP 中 AP 方案的延伸，由 eBay 的架构师 Dan Pritchett 提出。

| 缩写 | 全称 | 含义 |
|------|------|------|
| **BA** | Basically Available | **基本可用**：系统允许降级，比如秒杀时关闭非核心功能 |
| **S** | Soft State | **软状态**：允许系统存在中间状态（不一致） |
| **E** | Eventually Consistent | **最终一致性**：经过一段时间后，数据会达到一致 |

### 基本可用（BA）的体现

```
正常情况：
┌─────────────────────────────────────────────┐
│  用户查询：返回最新数据                      │
│  下单功能：正常                             │
│  推荐功能：正常                             │
└─────────────────────────────────────────────┘

秒杀期间（降级）：
┌─────────────────────────────────────────────┐
│  用户查询：返回缓存数据（可能延迟几秒）       │
│  下单功能：正常（核心功能不可降级）           │
│  推荐功能：关闭（非核心，降级处理）           │
└─────────────────────────────────────────────┘
```

### 最终一致性（E）的实现方案

1. **异步通知**：订单创建后发送 MQ 消息，库存服务异步扣减
2. **定期校对**：定时任务扫描不一致数据并修复
3. **补偿机制**：失败后通过重试或回滚达到最终一致

**面试要点**：CAP 是理论约束，BASE 是实践指导。互联网公司的大多数系统都是 BASE 导向的。

---

## 三、一致性协议

### 3.1 Raft 协议

Raft 是分布式一致性协议中最易于理解的一个，它将问题分解为三个子问题：
- Leader 选举（Leader Election）
- 日志复制（Log Replication）
- 安全性（Safety）

#### Leader 选举

```
     初始状态：所有节点都是 Follower
     ┌──────┐    ┌──────┐    ┌──────┐
     │Follower│  │Follower│  │Follower│
     │Term 1  │  │Term 1  │  │Term 1  │
     └──────┘    └──────┘    └──────┘

     选举超时 → Follower 变成 Candidate
     ┌──────┐    ┌──────┐    ┌──────┐
     │Candidate│ │Follower│  │Follower│
     │Term 2   │ │Term 2  │  │Term 2  │
     └──────┘    └──────┘    └──────┘

     获得多数票 → Candidate 变成 Leader
     ┌──────┐    ┌──────┐    ┌──────┐
     │Leader  │  │Follower│  │Follower│
     │Term 2  │  │Term 2  │  │Term 2  │
     └──────┘    └──────┘    └──────┘
```

**选举流程**：
1. Follower 在选举超时内未收到 Leader 心跳，转为 Candidate
2. Candidate 自增 Term（任期），给自己投票，并向其他节点发送 RequestVote RPC
3. 获得**超过半数**节点投票的 Candidate 成为 Leader
4. Leader 定期发送心跳（AppendEntries RPC）维持权威
5. 如果多个 Candidate 分裂选票（没有多数），开启新一轮选举

**随机选举超时**（150ms-300ms）防止选票分裂。

#### 日志复制

```
客户端请求
    │
    ▼
┌──────────┐
│  Leader   │ ← 接收客户端请求
│          │
│  Entry 1  │ ← 追加到本地日志
│  Entry 2  │
└─────┬────┘
      │ AppendEntries RPC
      ├───────────────────────┐
      ▼                       ▼
┌──────────┐          ┌──────────┐
│ Follower1│          │ Follower2│
│          │          │          │
│ Entry 1  │          │ Entry 1  │
│ Entry 2  │          │ Entry 2  │
└──────────┘          └──────────┘

Leader 收到多数确认 → 提交 Entry → 应用到状态机
```

**日志复制流程**：
1. Leader 接收客户端请求，追加日志条目到本地日志
2. Leader 并行向所有节点发送 AppendEntries RPC
3. Follower 接收日志并追加到本地日志，返回成功
4. Leader 收到**超过半数**节点的成功响应后，提交日志（应用到状态机）
5. Leader 通知 Follower 该日志已提交

### 3.2 Paxos 协议

Paxos 是分布式一致性协议的鼻祖，比 Raft 更难理解。它定义了三类角色：

| 角色 | 职责 |
|------|------|
| **Proposer**（提议者） | 提出提案（value） |
| **Acceptor**（接受者） | 对提案进行投票 |
| **Learner**（学习者） | 学习已批准的提案 |

**Paxos 两阶段流程**：

```
阶段一：Prepare（准备）
  Proposer → 所有 Acceptor：Prepare(N)
  Acceptor：如果 N > 之前见过的最大编号，承诺不再接受小于 N 的提案
  Acceptor → Proposer：Promise(N, 已接受的提案编号和值)

阶段二：Accept（接受）
  Proposer：收到多数 Promise，选择最大编号提案的值（如果没有则用自己提案的值）
  Proposer → 所有 Acceptor：Accept(N, value)
  Acceptor：接受提案（除非已承诺更大的编号）
  Acceptor → Proposer：Accepted(N, value)
```

**Paxos vs Raft 对比**：

| 对比项 | Paxos | Raft |
|--------|-------|------|
| 理解难度 | 难 | 相对简单 |
| 角色 | Proposer/Acceptor/Learner | Leader/Follower/Candidate |
| 投票机制 | 基本 Paxos 需要多轮投票 | 领导者简化了投票 |
| 实际应用 | 理论基石 | ZooKeeper（ZAB 类似 Raft）、etcd、Consul |

### 3.3 ZAB 协议（ZooKeeper Atomic Broadcast）

ZAB 是 ZooKeeper 使用的一致性协议，分为两个模式：

```
崩溃恢复模式（Recovery）：
  Leader 宕机 → 选举新 Leader → 同步数据 → 进入广播模式

消息广播模式（Broadcast）：
  Leader 接收写请求 → 广播 Proposal → 多数 Ack → 提交 Commit
```

**Epoch（纪元）**：ZAB 中的 Term 概念，标识 Leader 的任期。

---

## 四、分布式事务方案

### 4.1 方案对比总览

| 方案 | 一致性 | 性能 | 代码侵入 | 适用场景 |
|------|--------|------|---------|---------|
| 2PC | 强一致 | 低（同步阻塞） | 低 | 短事务、低并发 |
| TCC | 强一致 | 中 | 高（需实现 Try/Confirm/Cancel） | 跨服务、高并发 |
| 本地消息表 | 最终一致 | 高 | 中 | 异步场景、低一致性要求 |
| 可靠消息（MQ） | 最终一致 | 高 | 低 | 异步场景 |
| Seata AT | 强一致 | 中 | 低（无侵入） | 微服务场景 |

### 4.2 2PC（两阶段提交）

```
阶段一：准备（Prepare Phase）
  协调者                           参与者
    │                                │
    ├─── CanCommit? ────────────────→│
    │←── Yes / No ──────────────────┤
    │                                │
阶段二：提交/回滚（Commit/Abort Phase）
    │                                │
    ├─── DoCommit / DoAbort ────────→│
    │←── Commit ACK / Abort ACK ────┤
```

```java
// 伪代码示例：XA 事务
@Transactional
public void createOrder(Order order) {
    // 资源管理器1：订单库
    orderDao.insert(order);
    // 资源管理器2：库存库（跨库 XA 事务）
    stockDao.deduct(order.getSkuId(), order.getQuantity());
    // 资源管理器3：账户库
    accountDao.debit(order.getUserId(), order.getAmount());
    // 提交时执行 2PC 协议
}
```

**缺点**：
- 同步阻塞：参与者必须等待协调者指令
- 单点故障：协调者宕机可能导致所有参与者阻塞
- 数据不一致：第二阶段部分参与者提交失败

### 4.3 TCC（Try-Confirm-Cancel）

TCC 是业务层面的补偿型分布式事务方案。

```
Try 阶段：
  - 订单服务：创建订单，状态为"待确认"
  - 库存服务：预留库存（冻结库存 + 1）
  - 账户服务：冻结金额

Confirm 阶段（Try 全部成功）：
  - 订单服务：订单状态改为"已确认"
  - 库存服务：扣减实际库存（释放冻结库存）
  - 账户服务：扣减账户余额（释放冻结金额）

Cancel 阶段（Try 任何失败）：
  - 订单服务：取消订单
  - 库存服务：释放预留库存
  - 账户服务：解冻金额
```

```java
public interface OrderTccService {

    @TwoPhaseBusinessAction(
        name = "orderTcc",
        commitMethod = "confirm",
        rollbackMethod = "cancel"
    )
    void tryCreateOrder(BusinessActionContext context, Order order);

    boolean confirm(BusinessActionContext context);

    boolean cancel(BusinessActionContext context);
}

// 使用 TCC 框架（如 tcc-transaction、Hmily）
@Service
public class OrderServiceImpl {

    @Autowired
    private OrderTccService orderTccService;
    @Autowired
    private InventoryTccService inventoryTccService;
    @Autowired
    private AccountTccService accountTccService;

    public void createOrder(Order order) {
        try {
            orderTccService.tryCreateOrder(null, order);
            inventoryTccService.tryDeduct(null, order.getSkuId(), order.getQuantity());
            accountTccService.tryFreeze(null, order.getUserId(), order.getAmount());
        } catch (Exception e) {
            // 任一个 Try 失败，框架自动调用各服务的 Cancel
            throw new RuntimeException("创建订单失败", e);
        }
    }
}
```

### 4.4 本地消息表

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│  订单服务                    库存服务                  │
│    │                           │                     │
│    │ 1. 创建订单 + 插入消息表   │                     │
│    │   (同一个本地事务)         │                     │
│    │                           │                     │
│    │ 2. 定时任务扫描消息表      │                     │
│    ├───────────────────────────→│ 3. 发送 MQ 消息     │
│    │                           │                     │
│    │ 4. 库存服务消费并扣减库存  │                     │
│    │                           │                     │
│    │ 5. 扣减成功 → 更新消息状态 │                     │
│    │   扣减失败 → 定时重试     │                     │
│    │                           │                     │
└──────────────────────────────────────────────────────┘
```

```sql
-- 本地消息表
CREATE TABLE local_message (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    business_key VARCHAR(64) NOT NULL,    -- 业务唯一键
    business_module VARCHAR(32) NOT NULL, -- 业务模块
    message_body TEXT NOT NULL,           -- 消息内容（JSON）
    status TINYINT NOT NULL DEFAULT 0,    -- 0=待发送 1=已发送 2=已完成
    retry_count INT DEFAULT 0,            -- 重试次数
    next_retry_time DATETIME,             -- 下次重试时间
    create_time DATETIME NOT NULL,
    update_time DATETIME NOT NULL,
    UNIQUE KEY uk_business_key (business_key)
);
```

```java
// 本地消息表 + 定时任务实现最终一致性
@Component
public class OrderService {

    @Transactional
    public void createOrder(Order order) {
        // 1. 创建订单
        orderDao.insert(order);
        // 2. 插入本地消息表（同一个本地事务）
        LocalMessage msg = new LocalMessage();
        msg.setBusinessKey(order.getId().toString());
        msg.setBusinessModule("order");
        msg.setMessageBody(JSON.toJSONString(order));
        msg.setStatus(0);
        localMessageDao.insert(msg);
    }
}

// 定时任务：扫描待发送的消息
@Component
public class MessageRetryTask {

    @Scheduled(fixedDelay = 5000)  // 每5秒扫描一次
    public void scanAndSend() {
        List<LocalMessage> pendingMessages = localMessageDao.selectPending();
        for (LocalMessage msg : pendingMessages) {
            try {
                // 发送到 MQ
                mqProducer.send(msg.getMessageBody());
                // 更新状态
                localMessageDao.updateStatus(msg.getId(), 1);
            } catch (Exception e) {
                msg.setRetryCount(msg.getRetryCount() + 1);
                msg.setNextRetryTime(DateUtil.addMinutes(new Date(), 5));
                localMessageDao.update(msg);
            }
        }
    }
}
```

### 4.5 Seata AT 模式

Seata（Simple Extensible Autonomous Transaction Architecture）是阿里开源的分布式事务框架，AT 模式对业务代码**几乎无侵入**。

```
Seata AT 执行流程：
                    TC（Transaction Coordinator）
                    /        |        \
                   /         |         \
                  /          |          \
              TM(业务)    RM(资源1)    RM(资源2)

1. TM 向 TC 申请全局事务 ID（XID）
2. TM 通过 XID 传播到各个微服务
3. 每个 RM 执行业务 SQL，同时记录前后镜像（undo log）
4. TM 向 TC 发起全局提交/回滚
5. TC 通知各 RM 提交/回滚
   - 提交：删除 undo log
   - 回滚：根据 undo log 生成反向 SQL 恢复数据
```

```java
// Seata AT 对业务几乎无侵入
@GlobalTransactional  // 只需加这个注解
public void createOrder(Order order) {
    // 订单服务本地事务
    orderDao.insert(order);

    // 调用库存服务（跨服务）
    inventoryFeignClient.deduct(order.getSkuId(), order.getQuantity());

    // 调用账户服务（跨服务）
    accountFeignClient.debit(order.getUserId(), order.getAmount());

    // 所有服务都成功 → 全局提交
    // 任一服务失败 → 全局回滚（根据 undo log 自动恢复）
}
```

---

## 五、面试高频问题

### Q1：CAP 中的 P 为什么是必须的？
因为网络分区是分布式系统的必然现象。消息丢失、交换机故障、网络延迟等都可能导致节点间通信中断。

### Q2：你们项目用了什么分布式事务方案？
根据业务场景选择：核心交易用 TCC 或 Seata AT（强一致），非核心场景用 RocketMQ 事务消息（最终一致）。

### Q3：Raft 选举时出现平票怎么办？
每个 Candidate 的选举超时时间是随机的（150ms-300ms），大概率会有先发起的 Candidate 获得多数票。如果确实出现分裂，本次选举失败，等待下一轮随机超时后重新选举。

### Q4：2PC 有什么问题？为什么不用？
同步阻塞（性能差）、协调者单点、数据不一致（第二阶段部分失败）。现代互联网高并发场景下基本不用 2PC。

---

## 六、面试小贴士

1. **CAP 理论**是所有分布式系统面试的起点，一定要能结合具体系统举例（ZooKeeper=CP, Eureka=AP）
2. **BASE 理论**是互联网公司的指导思想，"最终一致性"是核心关键词
3. **Paxos vs Raft** 面试中至少能说清楚 Raft 的选举和日志复制流程
4. **分布式事务**面试时不要说"我们只用一种方案"，电商系统往往是多方案组合
5. 面试中可以说"我们核心链路用 Seata AT 保证强一致，非核心用 MQ 保证最终一致"