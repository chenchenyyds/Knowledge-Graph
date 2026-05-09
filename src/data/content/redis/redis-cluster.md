## 集群模式

### 概述

单机 Redis 存在三个瓶颈：**容量有限**（单机内存上限）、**性能有限**（单线程处理能力）、**可用性有限**（单点故障）。为了解决这些问题，Redis 提供了三种集群架构：

| 架构 | 解决的核心问题 | 复杂度 | 推荐场景 |
|------|--------------|--------|---------|
| **主从架构** | 读写分离、数据冗余 | 低 | 读写分离场景 |
| **Sentinel（哨兵）** | 自动故障转移、高可用 | 中 | 需要自动 HA 的场景 |
| **Cluster（集群）** | 数据分片、水平扩展 | 高 | 海量数据、高吞吐场景 |

实际生产环境中，这三种架构往往会组合使用。

---

### 主从架构（Replication）

主从复制是 Redis 高可用的基础。一个主库（Master）可以有多个从库（Slave），从库实时同步主库的数据。

#### 架构图

```
  主从复制架构

                    ┌──────────────┐
                    │   客户端      │
                    │  (读写分离)   │
                    └──────┬───────┘
                           │ 写入
                           ▼
                    ┌──────────────┐
            ┌──────│   Master     │──────┐
            │      │  (主库)      │      │
            │      └──────────────┘      │
            │ 复制                   复制 │
            ▼                            ▼
     ┌──────────────┐           ┌──────────────┐
     │   Slave 1    │           │   Slave 2    │
     │  (从库-只读)  │           │  (从库-只读)  │
     └──────────────┘           └──────────────┘
            │                          │
            │ 客户端读取                │
            ▼                          ▼
     ┌──────────────┐           ┌──────────────┐
     │   客户端      │           │   客户端      │
     │  (读请求)    │           │  (读请求)    │
     └──────────────┘           └──────────────┘
```

#### 配置方式

```bash
# 方式一：在 slave 的 redis.conf 中配置
replicaof 192.168.1.100 6379

# 方式二：运行时命令（临时生效）
127.0.0.1:6379> REPLICAOF 192.168.1.100 6379

# 方式三：在 slave 启动时通过参数传入
redis-server --port 6380 --replicaof 192.168.1.100 6379

# 查看复制状态
127.0.0.1:6380> INFO replication
# 输出关键信息：
# role:slave
# master_host:192.168.1.100
# master_port:6379
# master_link_status:up
# slave_repl_offset: 12345
```

#### 全量复制流程

当新的 Slave 加入或 Slave 与 Master 断开后重连时，先进行全量复制：

```
  全量复制流程图

  Slave                          Master
    │                               │
    │──── psync ? -1 ───────────────►│
    │                               │── 当前 replication ID: abc
    │                               │── 当前 offset: 12345
    │◄── FULLRESYNC abc 12345 ──────│
    │                               │
    │                               ├── BGSAVE 生成 RDB 快照
    │                               │── 同时将新命令写入 buffer
    │                               │
    │◄────── RDB 文件 ──────────────│
    │                               │
    ├── 清空当前内存                  │
    ├── 加载 RDB 文件                │
    │                               │
    │◄── 继续发送 buffer 中的命令 ────│
    │                               │
    ├── 执行 buffer 命令             │
    ├── 开始增量复制                 │
    │──── PSYNC abc 12345 ─────────►│
    │◄── 实时推送新命令 ─────────────│
    │                               │
```

#### 增量复制流程

当 Slave 断开后短时间内重连，且 Master 的复制积压缓冲区（repl-backlog-size）中还有 Slave 断连期间的数据时，进行增量复制：

```
  增量复制流程图

  ① Slave 重连后发送 psync 命令：PSYNC abc 10000
  ② Master 检查自己的 backlog：
     - repl_backlog_histoff = 5000
     - repl_backlog 包含 offset 5000 ~ 15000 的数据
  ③ Slave 需要的 offset 10000 在 backlog 范围内
  ④ Master 回复：CONTINUE
  ⑤ Master 从 offset 10000 开始发送 backlog 中的部分数据
  ⑥ Slave 接收并执行

  关键配置（redis.conf）：
  repl-backlog-size 1mb    # 复制积压缓冲区大小（建议 10-100mb）
  # 缓冲区越大，容忍 Slave 断线的时间越长
```

#### 主从配置示例（本地模拟）

```bash
# 启动三个 Redis 实例
# 主库：6379
redis-server --port 6379

# 从库 1：6380
redis-server --port 6380 --replicaof 127.0.0.1 6379

# 从库 2：6381
redis-server --port 6381 --replicaof 127.0.0.1 6379

# 验证
redis-cli -p 6379 SET test "hello"   # 主库写入
redis-cli -p 6380 GET test            # 从库可以读到
redis-cli -p 6381 GET test            # 从库可以读到
redis-cli -p 6380 SET test2 "world"   # 错误！(error) READONLY
```

---

### Redis Sentinel（哨兵模式）

哨兵模式在主从架构的基础上增加了 **自动故障转移** 能力。哨兵本身是一个独立的 Redis 进程，用于监控主库和从库的状态。

#### 架构图

```
  Sentinel 架构

              ┌─────────────────────────┐
              │   Sentinel 集群          │
              │  ┌─────┐ ┌─────┐ ┌─────┐ │
              │  │ S1  │ │ S2  │ │ S3  │ │
              │  └──┬──┘ └──┬──┘ └──┬──┘ │
              └─────┼────────┼────────┼───┘
                    │ 监控    │ 监控    │
                    ▼         ▼        ▼
              ┌──────────┐        ┌──────────┐
              │  Master   │───────│  Slave 1  │
              │  (主库)   │ 复制   │  (从库)   │
              └─────┬────┘        └──────────┘
                    │                    │
                    │ 复制                │
                    ▼                    ▼
              ┌──────────┐        ┌──────────┐
              │  Slave 2  │        │   客户端  │
              │  (从库)   │        │  (连接哨兵 │
              └──────────┘        │   获取地址)│
                                  └──────────┘
```

#### 配置部署

```bash
# sentinel.conf 配置
port 26379
sentinel monitor mymaster 127.0.0.1 6379 2  # 2：至少 2 个哨兵同意才判定主库下线
sentinel down-after-milliseconds mymaster 5000   # 5 秒无响应视为下线
sentinel failover-timeout mymaster 60000          # 故障转移超时 60 秒
sentinel parallel-syncs mymaster 1                # 新主库同时同步的从库数量

# 启动哨兵
redis-sentinel sentinel.conf
# 或
redis-server sentinel.conf --sentinel

# 客户端通过哨兵获取主库信息
redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster
```

#### 故障转移流程

```
  故障转移详细流程

  阶段一：主观下线
  ┌─────────────────────────────────────────────┐
  │  Sentinel 每 1 秒向 Master 发 PING          │
  │  → 超过 down-after-milliseconds 无响应       │
  │  → Sentinel 标记 master 为 sdown（主观下线）  │
  └─────────────────────────────────────────────┘

  阶段二：客观下线
  ┌─────────────────────────────────────────────┐
  │  Sentinel 通过 SENTINEL is-master-down-by-addr │
  │  向其他 Sentinel 询问 Master 状态             │
  │  → 超过 quorum（配置中的 2）个节点确认下线     │
  │  → 标记为 odown（客观下线）                   │
  └─────────────────────────────────────────────┘

  阶段三：Leader 选举
  ┌─────────────────────────────────────────────┐
  │  使用 Raft 算法在 Sentinel 中选举 Leader     │
  │  → 每个周期只有一个 Sentinel 成为 Leader      │
  │  → Leader 负责执行故障转移                    │
  └─────────────────────────────────────────────┘

  阶段四：从库选择
  ┌─────────────────────────────────────────────┐
  │  Leader Sentinel 从从库中选新主库：           │
  │  ① 优先选 replica-priority 最小的            │
  │  ② 优先选复制偏移量最大的（数据最新）         │
  │  ③ 优先选 runid 最小的                       │
  └─────────────────────────────────────────────┘

  阶段五：角色切换
  ┌─────────────────────────────────────────────┐
  │  ① 执行 SLAVEOF NO ONE 提升为 Master         │
  │  ② 修改其他 Slave 的复制目标为新 Master       │
  │  ③ 原 Master 恢复后设为新 Master 的 Slave     │
  └─────────────────────────────────────────────┘
```

```java
// Java 通过 JedisSentinelPool 连接哨兵管理的 Redis
import redis.clients.jedis.JedisSentinelPool;

public class SentinelExample {
    public static void main(String[] args) {
        Set<String> sentinels = new HashSet<>();
        sentinels.add("192.168.1.100:26379");
        sentinels.add("192.168.1.101:26379");
        sentinels.add("192.168.1.102:26379");

        // 创建哨兵连接池（自动获取当前主库地址）
        try (JedisSentinelPool pool = new JedisSentinelPool(
                "mymaster", sentinels)) {

            // 获取连接（pool 自动处理故障转移）
            try (Jedis jedis = pool.getResource()) {
                jedis.set("key", "value");
                System.out.println(jedis.get("key"));
            }
        }

        // 哨兵故障转移期间：
        // ① pool 会检测到连接失效
        // ② 向哨兵查询新主库地址
        // ③ 重建连接池
        // 整个过程对业务代码透明！
    }
}
```

---

### Redis Cluster

Redis Cluster 是真正的分布式解决方案，**数据自动分片到多个节点**，每个节点负责一部分数据。它解决了单机容量和吞吐量的瓶颈。

#### 架构图

```
  Redis Cluster 架构（3 主 3 从）

             ┌────────────────────────────┐
             │       客户端应用             │
             │   (连接任意节点，自动重定向)  │
             └──────┬──────┬──────┬───────┘
                    │      │      │
                    ▼      ▼      ▼
             ┌──────────┐ ┌──────────┐ ┌──────────┐
             │ Node A   │ │ Node B   │ │ Node C   │
             │ Master   │ │ Master   │ │ Master   │
             │ Slots:   │ │ Slots:   │ │ Slots:   │
             │ 0-5460   │ │ 5461-    │ │ 10923-   │
             │          │ │ 10922    │ │ 16383    │
             └────┬─────┘ └────┬─────┘ └────┬─────┘
                  │            │            │
                  │ 复制       │ 复制       │ 复制
                  ▼            ▼            ▼
             ┌──────────┐ ┌──────────┐ ┌──────────┐
             │ Node D   │ │ Node E   │ │ Node F   │
             │ Slave    │ │ Slave    │ │ Slave    │
             └──────────┘ └──────────┘ └──────────┘

  节点间通过 Gossip 协议交换元数据
  所有节点互联（PING/PONG 消息）
```

#### 哈希槽分片机制

```
  Redis Cluster 分片核心逻辑

  key: "user:1001"

  hash = CRC16("user:1001")     # CRC16 计算 16 位哈希值
                                # CRC16 返回 0-65535 的值

  slot = hash % 16384           # slot = 12345

  # 根据 slot 找到对应节点：
  # Node A: slots 0-5460
  # Node B: slots 5461-10922
  # Node C: slots 10923-16383

  # user:1001 → slot 12345 → Node C
```

**Hash Tag 用法**：当需要确保多个 key 在同一个 slot 时，使用 `{}` 标记：

```bash
# 普通 key：可能分配到不同 slot
SET user:1001 "data"    # slot: 12345
SET user:1002 "data"    # slot: 67890  ← 可能不同节点
# 这两个 key 可能不在同一节点，无法直接做交集等操作

# 使用 Hash Tag：{} 内的内容参与哈希计算
SET {user}:1001 "data"  # slot: 12345
SET {user}:1002 "data"  # slot: 12345  ← 相同节点！
# 两个 key 现在可以在同一节点操作（如 MSET）

# Hash Tag 的计算：只对 {} 内的 {user} 做 CRC16
```

#### 部署与操作

```bash
# 1. 启动 6 个节点（3 主 3 从）
redis-server --port 7000 --cluster-enabled yes --cluster-config-file nodes-7000.conf
redis-server --port 7001 --cluster-enabled yes --cluster-config-file nodes-7001.conf
redis-server --port 7002 --cluster-enabled yes --cluster-config-file nodes-7002.conf
redis-server --port 7003 --cluster-enabled yes --cluster-config-file nodes-7003.conf
redis-server --port 7004 --cluster-enabled yes --cluster-config-file nodes-7004.conf
redis-server --port 7005 --cluster-enabled yes --cluster-config-file nodes-7005.conf

# 2. 创建集群（分配 slots）
redis-cli --cluster create \
  127.0.0.1:7000 127.0.0.1:7001 127.0.0.1:7002 \
  127.0.0.1:7003 127.0.0.1:7004 127.0.0.1:7005 \
  --cluster-replicas 1    # 每个主节点配 1 个从节点

# 3. 访问集群
redis-cli -c -p 7000 -h 127.0.0.1  # -c 表示集群模式
127.0.0.1:7000> SET foo bar
-> Redirected to slot [12182] located at 127.0.0.1:7002  # 自动重定向
OK

# 4. 查看集群信息
redis-cli -p 7000 CLUSTER INFO
redis-cli -p 7000 CLUSTER NODES
```

#### 集群命令与节点管理

```bash
# 查看 key 所在的 slot
CLUSTER KEYSLOT user:1001

# 查看 slots 分布
CLUSTER SLOTS

# 添加新节点
redis-cli --cluster add-node 127.0.0.1:7006 127.0.0.1:7000

# 重新分配 slots（迁移数据）
redis-cli --cluster reshard 127.0.0.1:7000

# 删除节点
redis-cli --cluster del-node 127.0.0.1:7006 <node-id>
```

```java
// Java 使用 JedisCluster 连接集群
import redis.clients.jedis.JedisCluster;

public class ClusterExample {
    public static void main(String[] args) {
        Set<HostAndPort> clusterNodes = new HashSet<>();
        clusterNodes.add(new HostAndPort("192.168.1.100", 7000));
        clusterNodes.add(new HostAndPort("192.168.1.101", 7001));
        clusterNodes.add(new HostAndPort("192.168.1.102", 7002));

        // JedisCluster 自动处理：
        // ① 初始化时从任意节点获取集群拓扑
        // ② 计算 key 的 slot，直连对应节点
        // ③ 遇到 MOVED 重定向时更新本地缓存
        try (JedisCluster cluster = new JedisCluster(clusterNodes)) {
            // 写入 → 自动路由到正确节点
            cluster.set("key1", "value1");
            cluster.set("key2", "value2");

            // 批量操作限制：只能在同一个 slot 内
            // 以下操作会报错（key1 和 key2 可能不在同一节点）
            // cluster.mset("key1", "v1", "key2", "v2");

            // 使用 hash tag 修复：
            cluster.set("{group}:key1", "v1");
            cluster.set("{group}:key2", "v2");
            // 现在这两个 key 肯定在同一节点
        }
    }
}
```

---

### Gossip 协议

Redis Cluster 的节点之间通过 **Gossip 协议** 交换信息，这是一种去中心化的通信方式。

#### 消息类型

| 消息类型 | 说明 |
|---------|------|
| MEET | 请求加入集群 |
| PING | 定期探测节点是否存活（频率：每秒随机选 5 个节点） |
| PONG | 回应 PING，包含自身状态信息 |
| FAIL | 广播某个节点已宕机 |

#### 通信流程

```
  Gossip 通信

  每秒钟，每个节点：

  ① 从已知节点列表中随机选 1 个未通信时间最长的节点
  ② 发送 PING 消息（包含已知节点信息）
  ③ 对方回复 PONG（同步状态）

  ④ 如果收到 PONG 的节点不在本节点列表中
     → 记录新节点（MEET 消息感知新节点）

  ⑤ 如果某个节点超过 node-timeout 未响应
     → 标记为疑似下线（PFAIL）
     → 通过 Gossip 传播给其他节点
     → 超过半数节点确认 → 标记为 FAIL → 广播
```

#### 集群的限制

Redis Cluster 有以下限制，设计时需要注意：

1. **不支持多键操作**（key 在不同 slot 时）
   ```bash
   # MSET、MGET、SINTER 等操作要求所有 key 在同一个 slot
   # 解决方案：使用 Hash Tag
   MSET {user}:1001 "a" {user}:1002 "b"   # 可以
   MSET user:1001 "a" user:1002 "b"       # 可能不行
   ```

2. **不支持多数据库**（只能使用 db 0）
   ```bash
   # 在集群模式下，SELECT 命令不可用
   SELECT 1
   (error) ERR SELECT is not allowed in cluster mode
   ```

3. **Pipeline 和事务的限制**
   - Pipeline 可以跨节点，但每个节点独立执行
   - MULTI/EXEC 事务内的所有 key 必须在同一节点

4. **数据分布不均**：某些 key 访问太热导致节点负载不均衡

5. **集群可用性**：超过半数主节点不可用，集群整体不可用

---

### 面试技巧与最佳实践

#### 常见面试题

1. **主从复制的核心原理？**
   Slave 发送 psync 命令，Master 执行 BGSAVE 生成 RDB 发送给 Slave，然后持续发送增量命令。

2. **全量复制和增量复制的区别？**
   - 全量复制：发送完整 RDB 文件，用于新节点加入或断连太久
   - 增量复制：从 backlog 缓冲区发送部分数据，用于短时间断连

3. **Sentinel 如何选主？**
   - 优先 replica-priority 最小
   - 其次复制偏移量最大（数据最新）
   - 再次 runid 最小

4. **Cluster 的哈希槽是怎么分配的？**
   16384 个槽，CRC16(key) % 16384 计算 slot，每个节点负责一段连续的 slot 范围。

5. **Cluster 为什么是 16384 个槽而不是更多？**
   - 16384 个槽的元数据约 2KB（bitmap 表示），Gossip 消息小
   - CRC16 输出 16 位，取模 16384 正好映射完整输出空间
   - 太多槽增加元数据传播开销

6. **集群模式下如何执行批量操作？**
   确保 key 使用相同 Hash Tag，或者客户端自己做分组按节点发送。

#### 实战注意事项

- **主从一定要跨机房部署**：避免单机房故障导致全部不可用
- **repl-backlog-size 要足够大**：用 `(主库写入速度) × (期望容忍断连秒数)` 计算
- **集群最少 6 个节点**（3 主 3 从），保证高可用
- **Cluster 不支持事务跨 slot**：设计 key 时要规划好 Hash Tag
- **集群扩容时注意数据迁移对性能的影响**：reshard 期间节点压力增大
- **客户端缓存集群拓扑**：遇到 MOVED/ASK 重定向时更新本地节点映射
- **不要在 slave 上执行消耗性能的操作**（如 KEYS、SORT、大范围查询）