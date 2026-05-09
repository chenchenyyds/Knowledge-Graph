## 消息队列（Message Queue）

消息队列（MQ）是分布式系统中实现**异步解耦、削峰填谷、最终一致性**的核心组件。面试中 MQ 相关的题目通常考察选型对比、可靠性保证、顺序消息、事务消息等。

---

## 一、为什么要用消息队列？

```
┌─────────────────────────────────────────────────────────────┐
│                    无 MQ 的同步调用                          │
│                                                             │
│  客户端 → 订单服务 → 库存服务 → 支付服务 → 通知服务 → 分析服务 │
│                 ↑ 串行调用，整体耗时 = 各服务之和              │
│                 任何一个服务不可用，整个流程失败                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    有 MQ 的异步解耦                          │
│                                                             │
│  客户端 → 订单服务                                          │
│               ↓ 写入消息                                     │
│                ┌─────── MQ ───────┐                         │
│                ↓        ↓        ↓                          │
│            库存服务  支付服务  通知服务                       │
│             ↑ 异步消费，互不影响                              │
│             ↑ 秒杀流量削峰，MQ 做缓冲                        │
└─────────────────────────────────────────────────────────────┘
```

### 三大核心作用

1. **异步解耦**：订单创建后仅发送消息，后续服务异步处理，主流程不受影响
2. **削峰填谷**：秒杀等瞬时流量先进入 MQ，下游按能力消费，保护数据库
3. **最终一致性**：事务消息保障分布式事务的最终一致性

---

## 二、主流消息队列选型对比

| 特性 | RocketMQ | Kafka | RabbitMQ |
|------|----------|-------|----------|
| **诞生背景** | 阿里巴巴，Java 系 | LinkedIn，Scala 系 | Rabbit Technologies，Erlang 系 |
| **吞吐量** | 10万+/s | 百万+/s（日志场景最强） | 万级/s |
| **延迟** | 毫秒级 | 毫秒级 | 微秒级 |
| **顺序消息** | 支持（全局/分区） | 分区内有序 | 支持 |
| **事务消息** | 支持（半消息机制） | 不支持 | 支持 |
| **消息回溯** | 支持（按时间/偏移量） | 支持（按偏移量） | 不支持 |
| **死信队列** | 支持 | 支持 | 支持 |
| **客户端语言** | Java 为主 | 多语言 | 多语言 |
| **运维复杂度** | 中等 | 中高（依赖 ZK/KRaft） | 低 |

**选型建议**：
- 业务消息（订单、交易）→ **RocketMQ**（事务消息、顺序消息支持完善）
- 日志收集、大数据管道 → **Kafka**（高吞吐、持久化强）
- 轻量级、快速集成 → **RabbitMQ**（简单易用、社区活跃）

---

## 三、RocketMQ 架构详解

### 3.1 整体架构

```
                  ┌─────────────┐
                  │ NameServer  │ (多个，无状态，路由注册中心)
                  └──────┬──────┘
                         │ 路由信息
        ┌────────────────┼────────────────┐
        ↓                ↓                ↓
   ┌─────────┐     ┌─────────┐     ┌─────────┐
   │ Broker  │     │ Broker  │     │ Broker  │ (消息存储节点)
   │ ★ Master│     │ ★ Master│     │ ★ Master│
   │ ▲ Slave │     │ ▲ Slave │     │ ▲ Slave │
   └─────────┘     └─────────┘     └─────────┘
        ↑                ↑                ↑
   ┌─────────┐     ┌─────────┐     ┌─────────┐
   │Producer │     │Producer │     │Consumer │
   └─────────┘     └─────────┘     └─────────┘
```

### 3.2 核心组件

| 组件 | 作用 | 特点 |
|------|------|------|
| **NameServer** | 路由注册中心 | 无状态，可水平扩展，各节点不通信 |
| **Broker** | 消息存储节点 | 主从架构，存储 Topic 消息 |
| **Producer** | 消息生产者 | 从 NameServer 获取路由，发送消息到 Broker |
| **Consumer** | 消息消费者 | 从 NameServer 获取路由，消费 Broker 消息 |

### 3.3 消息模型

```java
// Topic：逻辑分类（如 order-topic）
// MessageQueue：Topic 的物理分区
// Message：消息体

// 生产者示例
public class OrderProducer {
    public static void main(String[] args) throws Exception {
        DefaultMQProducer producer = new DefaultMQProducer("order_producer_group");
        producer.setNamesrvAddr("127.0.0.1:9876");
        producer.start();

        for (int i = 0; i < 100; i++) {
            Order order = new Order(i, "用户" + i, new BigDecimal("100"));
            Message msg = new Message(
                "order-topic",                    // Topic
                "order-paid",                     // Tag（消息过滤标签）
                String.valueOf(order.getId()),    // Key（业务标识，用于查询）
                JSON.toJSONBytes(order)           // 消息体
            );
            // 同步发送（最可靠）
            SendResult result = producer.send(msg);
            System.out.println("发送结果：" + result.getSendStatus());
        }
        producer.shutdown();
    }
}
```

### 3.4 消息可靠性机制

消息从生产到消费的全链路可靠性保障：

```
生产端 → Broker 存储 → 消费端
  ①         ②③          ④
```

**① 生产端：同步发送 + 重试**
```java
// 同步发送：等待 Broker 确认
SendResult result = producer.send(msg, 10000);  // 10s 超时

// 异步发送：回调通知
producer.send(msg, new SendCallback() {
    public void onSuccess(SendResult result) { /* 成功处理 */ }
    public void onException(Throwable e) { /* 失败处理 */ }
});

// 单向发送：不关心结果（日志等）
producer.sendOneway(msg);
```

**② Broker 存储：刷盘机制**
```java
// 同步刷盘：消息写入磁盘后才返回成功（最可靠，性能较低）
// 异步刷盘：消息写入 PageCache 即返回（性能高，断电可能丢数据）
```

```yaml
# broker.conf 配置
# 同步刷盘
flushDiskType=SYNC_FLUSH
# 异步刷盘
flushDiskType=ASYNC_FLUSH
```

**③ Broker 复制：主从同步**
```yaml
# 同步复制：Master 等待 Slave 确认后才返回成功
brokerRole=SYNC_MASTER
# 异步复制：Master 不等待 Slave
brokerRole=ASYNC_MASTER
```

**④ 消费端：ACK 机制**
```java
// 手动 ACK：消费成功后才提交偏移量
public class OrderConsumer {
    public static void main(String[] args) throws Exception {
        DefaultMQPushConsumer consumer = new DefaultMQPushConsumer("order_consumer_group");
        consumer.setNamesrvAddr("127.0.0.1:9876");
        consumer.subscribe("order-topic", "*");

        // 设置消费模式：并发的消息监听器
        consumer.registerMessageListener((MessageListenerConcurrently) (msgs, context) -> {
            for (MessageExt msg : msgs) {
                try {
                    Order order = JSON.parseObject(msg.getBody(), Order.class);
                    processOrder(order);       // 业务处理
                    return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
                } catch (Exception e) {
                    // 消费失败，稍后重试
                    if (msg.getReconsumeTimes() >= 3) {
                        // 超过重试次数，进入死信队列
                        return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
                    }
                    return ConsumeConcurrentlyStatus.RECONSUME_LATER;
                }
            }
        });
        consumer.start();
    }
}
```

### 3.5 事务消息（RocketMQ 核心亮点）

```
┌────────────────────── 事务消息流程 ──────────────────────┐
│                                                          │
│ Producer                         Broker                  │
│    │                                │                    │
│    │ 1. 发送半消息(prepare)          │                    │
│    ├───────────────────────────────→│ 半消息：暂不可见    │
│    │                                │                    │
│    │ 2. 执行本地事务                │                    │
│    │    ┌──────────────────┐       │                    │
│    │    │ 扣减库存 / 生成订单│       │                    │
│    │    └──────────────────┘       │                    │
│    │                                │                    │
│    │ 3. 提交/回滚事务               │                    │
│    ├───────────────────────────────→│ 提交→消息可见      │
│    │                                │ 回滚→消息删除      │
│    │                                │                    │
│    │ 4. (如果第3步超时) 回查事务状态 │                    │
│    │←───────────────────────────────│                    │
│    │                                │                    │
└──────────────────────────────────────────────────────────┘
```

```java
// 事务消息生产者
public class TransactionOrderProducer {
    public static void main(String[] args) throws Exception {
        TransactionMQProducer producer = new TransactionMQProducer("tx_producer_group");
        producer.setNamesrvAddr("127.0.0.1:9876");

        // 设置本地事务执行器
        producer.setTransactionListener(new TransactionListener() {

            // 执行本地事务
            @Override
            public LocalTransactionState executeLocalTransaction(Message msg, Object arg) {
                try {
                    Order order = (Order) arg;
                    // 1. 扣减库存
                    inventoryService.deduct(order.getSkuId(), order.getQuantity());
                    // 2. 生成订单
                    orderService.createOrder(order);
                    // 本地事务成功 → 提交消息
                    return LocalTransactionState.COMMIT_MESSAGE;
                } catch (Exception e) {
                    // 本地事务失败 → 回滚消息
                    return LocalTransactionState.ROLLBACK_MESSAGE;
                }
            }

            // 回查本地事务状态（针对第3步超时的补偿）
            @Override
            public LocalTransactionState checkLocalTransaction(MessageExt msg) {
                String orderId = msg.getKeys();
                // 查询本地是否已成功创建订单
                if (orderService.isOrderExists(orderId)) {
                    return LocalTransactionState.COMMIT_MESSAGE;
                }
                return LocalTransactionState.UNKNOW;
            }
        });

        producer.start();

        // 发送事务消息
        Order order = new Order(1L, "商品A", 2);
        Message msg = new Message("order-tx-topic", JSON.toJSONBytes(order));
        producer.sendMessageInTransaction(msg, order);
    }
}
```

**面试重点**：事务消息的核心是**半消息 + 本地事务 + 回查机制**，本质是**最终一致性**方案，不是强一致性。

---

## 四、Kafka 架构详解

### 4.1 整体架构

```
                     ┌──────────────┐
                     │  ZooKeeper   │ (元数据管理，新版可用 KRaft 替代)
                     └──────┬───────┘
                            │ 协调
        ┌───────────────────┼───────────────────┐
        ↓                   ↓                   ↓
   ┌─────────┐       ┌─────────┐        ┌─────────┐
   │ Broker 1│       │ Broker 2│        │ Broker 3│
   │ ┌─────┐ │       │ ┌─────┐ │        │ ┌─────┐ │
   │ │P0 L │ │       │ │P0 F │ │        │ │P0 F │ │
   │ │P1 F │ │       │ │P1 L │ │        │ │P1 F │ │
   │ │P2 F │ │       │ │P2 F │ │        │ │P2 L │ │
   │ └─────┘ │       │ └─────┘ │        │ └─────┘ │
   └─────────┘       └─────────┘        └─────────┘
   ↑ L=Leader  F=Follower

    ┌─────────────────┐
    │ Consumer Group A │ ← 每个分区同一消费组内只有一个消费者
    │  ├─ Consumer 1   │
    │  └─ Consumer 2   │
    └─────────────────┘
```

### 4.2 核心概念

| 概念 | 说明 |
|------|------|
| **Topic** | 消息分类，逻辑概念 |
| **Partition** | 物理分片，每个 Partition 是追加写的日志文件 |
| **Offset** | 消息在 Partition 内的偏移量，唯一标识 |
| **Consumer Group** | 消费组，组内消费者共同消费 Topic，每个分区只能被组内一个消费者消费 |
| **ISR** | In-Sync Replicas，与 Leader 保持同步的副本集合 |
| **Leader** | 每个 Partition 的主副本，负责读写 |
| **Follower** | 从副本，从 Leader 拉取数据同步 |

### 4.3 生产端代码示例

```java
public class KafkaOrderProducer {
    public static void main(String[] args) {
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
        props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");
        props.put("acks", "all");                  // 等待所有副本确认
        props.put("retries", 3);                   // 重试次数
        props.put("enable.idempotence", true);     // 开启幂等性，防止重复
        props.put("linger.ms", 5);                 // 批量发送延迟(ms)
        props.put("batch.size", 16384);            // 批量发送大小(bytes)

        KafkaProducer<String, String> producer = new KafkaProducer<>(props);

        for (int i = 0; i < 100; i++) {
            String orderId = "ORDER_" + i;
            String msg = "{\"orderId\":\"" + orderId + "\",\"amount\":100}";

            // 指定 key 保证同一订单进入同一分区（保持顺序）
            ProducerRecord<String, String> record = new ProducerRecord<>(
                "order-topic", orderId, msg
            );

            producer.send(record, (metadata, exception) -> {
                if (exception != null) {
                    System.err.println("发送失败：" + exception.getMessage());
                } else {
                    System.out.println("发送成功：partition=" + metadata.partition()
                        + ", offset=" + metadata.offset());
                }
            });
        }
        producer.close();
    }
}
```

### 4.4 消费端代码示例

```java
public class KafkaOrderConsumer {
    public static void main(String[] args) {
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("group.id", "order-consumer-group");
        props.put("key.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
        props.put("value.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
        props.put("enable.auto.commit", "false");   // 手动提交偏移量
        props.put("auto.offset.reset", "earliest"); // 从头开始消费

        KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
        consumer.subscribe(Arrays.asList("order-topic"));

        try {
            while (true) {
                ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
                for (ConsumerRecord<String, String> record : records) {
                    try {
                        System.out.printf("partition=%d, offset=%d, key=%s, value=%s%n",
                            record.partition(), record.offset(), record.key(), record.value());
                        processOrder(record.value());
                        // 手动提交偏移量
                        consumer.commitSync();
                    } catch (Exception e) {
                        // 业务处理失败，可以记录偏移量到死信队列
                        logError(record);
                    }
                }
            }
        } finally {
            consumer.close();
        }
    }
}
```

### 4.5 ISR 机制详解

```
时间轴 →
Leader:  W1 W2 W3 W4 W5 W6 W7 W8 W9
Follower1:  W1 W2 W3 W4 W5 W6        ← 正常同步，在 ISR 中
Follower2:  W1 W2                    ← 落后太多，被踢出 ISR
                          ↑
                    LEO(Log End Offset)
```

- Leader 维护 ISR（In-Sync Replicas）列表，只有同步状态良好的副本在列表中
- Follower 从 Leader 拉取数据，通过 HW（High Watermark）机制保证一致性
- 消费者只能消费 HW 之前的消息（保证所有副本都有该消息）
- 如果 Follower 超过 `replica.lag.time.max.ms` 未同步，被踢出 ISR
- ISR 中所有副本都确认后，消息才被视为"已提交"

**acks 参数详解**：
- `acks=0`：Producer 不等待确认，最快但可能丢数据
- `acks=1`：Leader 写入即返回，默认值（Leader 宕机可能丢数据）
- `acks=all`（或 `-1`）：等待 ISR 中所有副本确认，最安全

---

## 五、顺序消息实现

### RocketMQ 顺序消息

RocketMQ 通过**队列选择器**实现，保证同一业务 key 的消息进入同一队列。

```java
// 顺序消息（同一订单的消息按顺序消费）
public class OrderMessageProducer {
    public static void main(String[] args) throws Exception {
        DefaultMQProducer producer = new DefaultMQProducer("order_producer");
        producer.setNamesrvAddr("127.0.0.1:9876");
        producer.start();

        // 模拟订单生命周期事件
        String orderId = "ORDER_001";
        String[] events = {"创建", "支付", "发货", "完成"};

        for (String event : events) {
            Message msg = new Message("order-event", (orderId + ":" + event).getBytes());

            // 关键：使用队列选择器，按 orderId 选择固定队列
            SendResult result = producer.send(msg, new MessageQueueSelector() {
                @Override
                public MessageQueue select(List<MessageQueue> mqs, Message msg, Object arg) {
                    String orderId = (String) arg;
                    // 相同 orderId 总是进入同一队列
                    int index = orderId.hashCode() % mqs.size();
                    return mqs.get(index);
                }
            }, orderId);

            System.out.println("事件[" + event + "] 发送到队列：" + result.getMessageQueue());
        }
    }
}

// 顺序消费
public class OrderMessageConsumer {
    public static void main(String[] args) throws Exception {
        DefaultMQPushConsumer consumer = new DefaultMQPushConsumer("order_consumer");
        consumer.setNamesrvAddr("127.0.0.1:9876");
        consumer.subscribe("order-event", "*");

        // 关键：使用 MessageListenerOrderly（顺序消费）
        consumer.registerMessageListener((MessageListenerOrderly) (msgs, context) -> {
            for (MessageExt msg : msgs) {
                System.out.println("消费：" + new String(msg.getBody()));
            }
            return ConsumeOrderlyStatus.SUCCESS;
        });

        consumer.start();
    }
}
```

### Kafka 顺序消息

Kafka 的**分区内天然有序**，只需将相同 key 的消息路由到同一分区。

```java
// 保证同一订单进入同一分区
ProducerRecord<String, String> record = new ProducerRecord<>(
    "order-topic",
    orderId,      // 相同 key → 同一分区，保持顺序
    orderData
);
```

**面试要点**：顺序消息会降低吞吐量（分区/队列数减少、消费并行度降低），只有在业务必要时才使用。

---

## 六、消息积压处理方案

### 6.1 定位问题

```bash
# RocketMQ 查看堆积情况
mqadmin consumerProgress -n 127.0.0.1:9876 -g consumer_group

# Kafka 查看堆积
kafka-consumer-groups --bootstrap-server localhost:9092 \
  --group consumer_group --describe
```

### 6.2 常见原因

1. **消费者能力不足**：消费速度 < 生产速度
2. **消费者阻塞**：业务处理慢、DB 连接池满、GC 停顿
3. **路由异常**：部分分区不可用

### 6.3 解决措施

```java
// 1. 临时扩容消费者
//    先暂停原消费者，创建新的 Topic（更多队列），
//    用临时消费者批量消费原积压消息，再发送到新 Topic

// 2. 优化消费逻辑
//    批量处理代替逐条处理
boolean processBatch(List<Message> messages) {
    // 批量写入数据库（insert batch）
    db.batchInsert(messages.stream()
        .map(this::parseMessage)
        .collect(toList()));
    return true;
}

// 3. 跳过非关键消息（降级）
//    对于可以丢弃的消息，直接 ACK 跳过
```

**面试核心思路**：
- 先恢复消费能力（扩容消费者/提升并行度）
- 再排查堆积原因（慢 SQL？外部依赖？）
- 最后做长期优化（调整消费逻辑、资源配置）

---

## 七、消息队列面试高频问题

### Q1：如何保证消息不丢失？
**答**：从三个环节保证：
1. **生产端**：同步发送 + 重试机制（RocketMQ）/ acks=all（Kafka）
2. **Broker**：同步刷盘 + 主从同步（SYNC_FLUSH + SYNC_MASTER）
3. **消费端**：业务处理完成后手动 ACK

### Q2：如何保证消息不重复消费（幂等性）？
**答**：MQ 最多保证"至少一次"（at least once），重复消费需要业务端实现幂等：
```java
// 方案1：数据库唯一键约束
INSERT INTO order_consume_log(order_id, status) VALUES('ORDER001', 'PROCESSED');
-- 重复插入会报唯一键冲突

// 方案2：Redis 去重
Boolean existed = redis.setIfAbsent("consume:" + orderId, "1", 1, TimeUnit.HOURS);
if (!existed) {
    // 已经处理过，跳过
    return;
}
processOrder(orderId);
```

### Q3：RocketMQ 和 Kafka 怎么选？
**答**：
- 业务消息系统（订单、交易、通知）→ **RocketMQ**（事务消息、顺序消息支持完善）
- 日志收集、大数据管道、埋点 → **Kafka**（高吞吐、持久化）
- 团队技术栈：Java 系优先 RocketMQ，多语言系优先 Kafka

### Q4：消息积压了怎么办？
**答**：①临时扩容消费者 ②排查消费慢的原因 ③评估是否可以跳过部分消息

---

## 八、面试小贴士

1. **消息可靠性**是最核心的考点，要能从生产→存储→消费全链路回答。
2. **顺序消息**要强调它是有代价的（损失吞吐量）
3. **事务消息**是 RocketMQ 区别于 Kafka 的关键特性，务必掌握原理
4. **幂等性**是分布式系统的通用主题，MQ 一定会结合考察
5. 面试中可以说"RabbitMQ 适合小规模项目，RocketMQ/Kafka 适合大规模分布式系统"