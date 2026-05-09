## IO 模型概述

Java 中的 IO 模型发展经历了从 BIO → NIO → AIO 的演进，本质是操作系统 IO 模型在 Java 层面的封装。

```
  阻塞IO (BIO)       非阻塞IO (NIO)        异步IO (AIO)
  Java 1.0            Java 1.4              Java 1.7
      │                    │                     │
      ▼                    ▼                     ▼
  同步阻塞 I/O         同步非阻塞 I/O         异步非阻塞 I/O
  线程阻塞等待数据      轮询检查就绪状态      数据就绪后回调通知
```

### 三种 IO 模型对比

| 维度 | BIO（Blocking IO） | NIO（Non-blocking IO） | AIO（Asynchronous IO） |
|------|-------------------|----------------------|----------------------|
| 阻塞 | 线程阻塞在 read/write | 不阻塞，轮询 Selector | 不阻塞，回调完成 |
| 线程模型 | 一连接一线程 | 一个 Selector 管理多 Channel | 提交后回调 |
| 并发支持 | 差（线程数 = 连接数） | 好（少量线程管理大量连接） | 极好（回调驱动） |
| 适用场景 | 连接数少、固定架构 | 连接数多、短连接 | 连接数多、长连接 |
| JDK 版本 | 1.0+ | 1.4+ | 1.7+ |
| 延迟 | 高（线程上下文切换） | 低（事件驱动） | 最低（回调） |

### BIO 示例

```java
// 传统 BIO — 每连接一个线程
public class BioServer {
    public static void main(String[] args) throws IOException {
        ServerSocket serverSocket = new ServerSocket(8080);
        while (true) {
            Socket socket = serverSocket.accept(); // 阻塞
            new Thread(() -> {
                try {
                    BufferedReader reader = new BufferedReader(
                        new InputStreamReader(socket.getInputStream()));
                    PrintWriter writer = new PrintWriter(socket.getOutputStream(), true);
                    String line;
                    while ((line = reader.readLine()) != null) {
                        writer.println("Echo: " + line);
                    }
                } catch (IOException e) { e.printStackTrace(); }
            }).start();
        }
    }
}
```

**BIO 的问题**：每个连接一个线程，1000 个连接就需要 1000 个线程，线程创建/切换开销巨大。

## NIO 三大核心组件

NIO 基于事件驱动，由 Channel、Buffer、Selector 三大核心组件构成。

```
                      Selector（选择器）
                      ┌──────────┐
                      │          │
                      │ select() │  ← 单线程轮询就绪事件
                      │    │     │
                      └────┼─────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
      ┌──────┐        ┌──────┐        ┌──────┐
      │Channel│        │Channel│        │Channel│  ← 双向通道
      ├──────┤        ├──────┤        ├──────┤
      │Buffer│        │Buffer│        │Buffer│   ← 数据缓冲区
      └──────┘        └──────┘        └──────┘
```

### Channel（通道）

与流（Stream）不同，Channel 是**双向**的，既可以读也可以写。

```java
// 主要 Channel 类型
FileChannel              // 文件 IO
SocketChannel            // TCP 客户端
ServerSocketChannel      // TCP 服务端
DatagramChannel          // UDP
```

### Buffer（缓冲区）

Buffer 是 NIO 读写数据的载体，包含三个核心指针：

```
      position         limit         capacity
         │               │              │
         ▼               ▼              ▼
    ┌────┼───────────────┼──────────────┼────┐
    │  0 │  1 │ 2 │ ... │  未读  │ ...  │ N  │
    └────┴────┴────┴────┴────────┴──────┴────┘
    ←—— 已读/已写区 ——→ ←—— 可读写区 ———→
```

**核心方法**：

| 方法 | 效果 |
|------|------|
| flip() | `limit = position; position = 0` 写→读切换 |
| clear() | `position = 0; limit = capacity` 清空缓冲区 |
| compact() | 压缩未读数据到头部 |
| rewind() | `position = 0` 重新读 |
| remaining() | `limit - position` 剩余可读数量 |

```java
// NIO Buffer 典型操作
ByteBuffer buffer = ByteBuffer.allocate(1024);

// 写入数据
buffer.put("Hello".getBytes());

// 切换为读模式
buffer.flip();

// 读取数据
byte[] dst = new byte[buffer.remaining()];
buffer.get(dst);

// 清空
buffer.clear();

// 或压缩（保留未读数据）
// buffer.compact();
```

### Selector（选择器）

Selector 是 NIO 事件驱动的核心，通过**一个线程**管理多个 Channel。

**可监听的事件**：

| 事件 | 值 | 说明 |
|------|----|------|
| OP_ACCEPT | 16 | ServerSocketChannel 有新的连接 |
| OP_CONNECT | 8 | SocketChannel 连接建立 |
| OP_READ | 1 | 通道中有数据可读 |
| OP_WRITE | 4 | 通道可以写入数据 |

```java
// NIO Selector 完整示例
public class NioServer {
    public static void main(String[] args) throws IOException {
        Selector selector = Selector.open();
        ServerSocketChannel ssc = ServerSocketChannel.open();
        ssc.configureBlocking(false);  // 必须非阻塞
        ssc.bind(new InetSocketAddress(8080));
        ssc.register(selector, SelectionKey.OP_ACCEPT);

        while (true) {
            selector.select();  // 阻塞，直到有事件就绪
            Set<SelectionKey> keys = selector.selectedKeys();
            Iterator<SelectionKey> iter = keys.iterator();

            while (iter.hasNext()) {
                SelectionKey key = iter.next();
                iter.remove();

                if (key.isAcceptable()) {
                    // 接受新连接
                    SocketChannel sc = ssc.accept();
                    sc.configureBlocking(false);
                    sc.register(selector, SelectionKey.OP_READ);
                } else if (key.isReadable()) {
                    // 读取数据
                    SocketChannel sc = (SocketChannel) key.channel();
                    ByteBuffer buffer = ByteBuffer.allocate(1024);
                    int len = sc.read(buffer);
                    if (len > 0) {
                        buffer.flip();
                        byte[] data = new byte[buffer.remaining()];
                        buffer.get(data);
                        System.out.println("Received: " + new String(data));
                    }
                }
            }
        }
    }
}
```

## Reactor 线程模型

Reactor 模式是 NIO 的最佳实践，Netty 等框架的核心设计模式。

### 单 Reactor 单线程

```
                    Reactor Thread
    ┌────────────────────────────────┐
    │           Selector             │
    │  ┌──────┐  ┌──────┐  ┌──────┐ │
    │  │accept│  │ read │  │write │ │
    │  └──────┘  └──────┘  └──────┘ │
    └───────────────┬────────────────┘
                    │
        ┌───────────┼───────────┐
        │           │           │
        ▼           ▼           ▼
    ┌──────┐   ┌──────┐   ┌──────┐
    │Handler│   │Handler│   │Handler│  ← 业务处理也在 Reactor 线程
    └──────┘   └──────┘   └──────┘
```
- **所有 IO 和业务逻辑都在一个线程**。
- 适用于 CPU 密集型、连接数少的场景。
- 缺点：业务逻辑阻塞时，整个服务阻塞。

### 单 Reactor 多线程

```
                    Reactor Thread
    ┌────────────────────────────────┐
    │           Selector             │
    │  ┌──────┐  ┌──────┐  ┌──────┐ │
    │  │accept│  │ read │  │write │ │
    │  └──────┘  └──────┘  └──────┘ │
    └───────────────┬────────────────┘
                    │ 仅处理 IO 事件
                    ▼
    ┌──────────────────────────────────┐
    │       Worker 线程池               │
    │  ┌──────┐ ┌──────┐ ┌──────┐     │ ← 业务逻辑在线程池中异步处理
    │  │Worker│ │Worker│ │Worker│     │
    │  └──────┘ └──────┘ └──────┘     │
    └──────────────────────────────────┘
```
- Reactor 线程负责所有 IO 事件分发。
- Worker 线程池处理业务逻辑。
- 缺点：Reactor 线程仍可能成为瓶颈。

### 主从 Reactor 多线程（Netty 模型）

```
    MainReactor Group (BOSS)
    ┌──────────────────────────────┐
    │   Selector (处理 accept)      │
    │   ┌──────┐  ┌──────┐       │
    │   │accept│  │accept│       │
    │   └──────┘  └──────┘       │
    └──────────────┬───────────────┘
                   │ 分发已接受的 Channel
                   ▼
    SubReactor Group (WORKER)
    ┌──────────────────────────────┐
    │   Selector (处理 read/write) │
    │   ┌─────┐ ┌─────┐ ┌─────┐  │
    │   │read │ │write│ │read │  │
    │   └─────┘ └─────┘ └─────┘  │
    └──────────────┬───────────────┘
                   │ 需要时派发
                   ▼
    ┌──────────────────────────────┐
    │  业务线程池 (ChannelHandler) │
    └──────────────────────────────┘
```

- MainReactor 负责 accept 新连接（BOSS Group）。
- SubReactor 负责已连接 Channel 的 read/write（WORKER Group）。
- 业务处理在 Handler 中异步执行，也可交给业务线程池。
- **Netty 采用此模型**，可根据 CPU 核数设置多组 SubReactor。

## 零拷贝技术（Zero-Copy）

### 传统 IO 的 4 次拷贝

```
  磁盘 → 内核缓冲区 (DMA 拷贝)
  内核缓冲区 → 用户缓冲区 (CPU 拷贝)
  用户缓冲区 → Socket 缓冲区 (CPU 拷贝)
  Socket 缓冲区 → 网卡 (DMA 拷贝)
```

```java
// 传统读-写（4 次拷贝 + 2 次系统调用 + 3 次上下文切换）
File.read(file, buf, len);
Socket.send(socket, buf, len);
```

### mmap（内存映射）

```
  磁盘 → 内核缓冲区 (DMA 拷贝)
  内核缓冲区 → 用户空间共享 (无需拷贝，通过缺页中断映射)
  内核缓冲区 → Socket 缓冲区 (CPU 拷贝)
  Socket 缓冲区 → 网卡 (DMA 拷贝)

  共 3 次拷贝（比传统少 1 次）
```

```java
FileChannel fileChannel = new RandomAccessFile("file.txt", "rw").getChannel();
MappedByteBuffer mappedBuffer = fileChannel.map(
    FileChannel.MapMode.READ_WRITE, 0, fileChannel.size());
// 直接操作 mappedBuffer 即操作文件，无需 read/write
```

### sendfile（零拷贝）

```
  磁盘 → 内核缓冲区 (DMA 拷贝)
  内核缓冲区 → 网卡 (DMA 拷贝，由 SG-DMA 引擎直接拷贝)

  共 2 次拷贝（完全在内核态完成，0 次 CPU 拷贝）
```

```java
// Linux 2.4+ 真正零拷贝
FileChannel fileChannel = FileChannel.open(Paths.get("file.txt"));
fileChannel.transferTo(0, fileChannel.size(), socketChannel);
// 底层调用 sendfile 系统调用
```

### Java 中的零拷贝总结

| 技术 | CPU 拷贝次数 | DMA 拷贝次数 | 系统调用 | 适用场景 |
|------|-------------|-------------|---------|---------|
| 传统 IO | 2 | 2 | read + write | 通用 |
| mmap | 1 | 2 | mmap + write | 文件读写频繁 |
| sendfile | 0 | 2 | sendfile | 文件传输（如静态文件服务） |
| DirectBuffer | 0 | N/A（堆外直接使用） | N/A | 网络 IO 频繁 |

## Netty 架构设计

### Netty 核心组件

```
                    Netty 架构
    ┌──────────────────────────────────────────┐
    │              Bootstrap                   │
    │   ┌─────────────────────────────────┐   │
    │   │        EventLoopGroup           │   │
    │   │   ┌─────────┐  ┌─────────┐     │   │
    │   │   │EventLoop│  │EventLoop│ ... │   │
    │   │   │ ┌─────┐ │  │ ┌─────┐ │     │   │
    │   │   │ │Selector│ │  │ │Selector│ │     │   │
    │   │   │ └─────┘ │  │ └─────┘ │     │   │
    │   │   └─────────┘  └─────────┘     │   │
    │   └─────────────────────────────────┘   │
    │                                         │
    │   Channel → ChannelPipeline             │
    │              ┌─────────────────┐        │
    │              │ ChannelHandler  │        │
    │              │ ┌─────────────┐│        │
    │              │ │ Encoder     ││        │
    │              │ │ Decoder     ││        │
    │              │ │ Business    ││        │
    │              │ └─────────────┘│        │
    │              └─────────────────┘        │
    └──────────────────────────────────────────┘
```

**核心优势**：
1. ✅ API 简单易用，相比原生 NIO 代码量减少 80%。
2. ✅ 内置编解码器（Protobuf/JSON/HTTP）。
3. ✅ 零拷贝：CompositeByteBuf、FileRegion。
4. ✅ 内存池：ByteBuf 池化，避免 GC 压力。
5. ✅ 高并发：主从 Reactor 模型。
6. ✅ 可扩展：Pipeline 编排 Handler 链。

### Netty 简单示例

```java
// 服务端
EventLoopGroup bossGroup = new NioEventLoopGroup(1);      // MainReactor
EventLoopGroup workerGroup = new NioEventLoopGroup();     // SubReactor

try {
    ServerBootstrap b = new ServerBootstrap();
    b.group(bossGroup, workerGroup)
     .channel(NioServerSocketChannel.class)
     .childHandler(new ChannelInitializer<SocketChannel>() {
         @Override
         public void initChannel(SocketChannel ch) {
             ch.pipeline().addLast(
                 new StringDecoder(),
                 new StringEncoder(),
                 new SimpleChannelInboundHandler<String>() {
                     @Override
                     protected void channelRead0(ChannelHandlerContext ctx, String msg) {
                         System.out.println("收到: " + msg);
                         ctx.writeAndFlush("回复: " + msg);
                     }
                 }
             );
         }
     })
     .option(ChannelOption.SO_BACKLOG, 128)
     .childOption(ChannelOption.SO_KEEPALIVE, true);

    ChannelFuture f = b.bind(8080).sync();
    f.channel().closeFuture().sync();
} finally {
    workerGroup.shutdownGracefully();
    bossGroup.shutdownGracefully();
}
```

## 面试高频 Q&A

**Q1: BIO、NIO、AIO 的区别？**
- BIO：同步阻塞，一连接一线程。
- NIO：同步非阻塞，Selector 多路复用，事件驱动。
- AIO：异步非阻塞，数据就绪后回调。
- 实际工程中 NIO（Netty）使用最广泛，AIO 在 Linux 上性能有限。

**Q2: NIO 的空轮询问题（JDK 1.8 之前）？**
- Linux 下 epoll 的 bug 导致 Selector.select() 即使没有就绪事件也立即返回，导致 CPU 100%。
- 解决方案：记录 select 返回时间，若短时间内空转多次，重建 Selector 重新注册 Channel。
- Netty 内部已处理此问题（RebuildSelector）。

**Q3: 零拷贝解决了什么问题？**
- 减少数据在内核态和用户态之间的拷贝次数。
- 减少 CPU 开销和上下文切换。
- 提升 IO 吞吐量。

**Q4: Netty 如何解决 TCP 粘包/拆包问题？**
- 行解码器：LineBasedFrameDecoder（按换行符分割）。
- 定长解码器：FixedLengthFrameDecoder。
- 长度域解码器：LengthFieldBasedFrameDecoder（如 Length + Body）。
- 自定义：继承 ByteToMessageDecoder 自行实现。

**Q5: mmap 和 sendfile 有什么区别？**
- mmap：将文件映射到进程地址空间，用户态可直接操作文件数据，支持随机读写。
- sendfile：在内核态完成数据传输，用户态不可读数据，适合大文件传输。

---