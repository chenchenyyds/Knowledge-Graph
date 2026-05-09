## Lambda 表达式

Lambda 是 Java 8 引入的函数式编程特性，本质是函数式接口的匿名实现。

### 语法形式

```java
// 完整语法
(参数列表) -> { 方法体 }

// 示例
(int a, int b) -> { return a + b; }
(a, b) -> a + b                               // 单表达式可省略 return 和 {}
() -> System.out.println("Hello")             // 无参
(String s) -> s.length()                      // 单参可省略括号（不推荐）
```

### 方法引用（Method Reference）

```java
// 静态方法引用
Function<String, Integer> f1 = Integer::parseInt;  // (s) -> Integer.parseInt(s)

// 实例方法引用
Function<String, Integer> f2 = String::length;     // (s) -> s.length()

// 构造方法引用
Supplier<List<String>> f3 = ArrayList::new;         // () -> new ArrayList<>()

// 特定对象实例方法
Consumer<String> f4 = System.out::println;         // (s) -> System.out.println(s)
```

### Lambda 编译原理

```java
// Java 代码
Runnable r = () -> System.out.println("Hello");

// 编译后：invokedynamic 指令 + LambdaMetafactory 生成内部类
// 不会生成单独的 .class 文件，而是通过 ASM 动态生成内部类
// 避免每次调用创建新对象（但可变捕获变量时仍需创建）
```

### 变量捕获（Variable Capture）

```java
String prefix = "Result: ";
Function<Integer, String> func = x -> prefix + x;  // 捕获局部变量
// 被捕获的变量必须是 effectivly final（实际上是 final 或从未被修改）
```

## 函数式接口（Functional Interface）

### 四大核心函数式接口

| 接口 | 方法签名 | 用途 |
|------|---------|------|
| `Predicate<T>` | `boolean test(T t)` | 判断条件 |
| `Function<T,R>` | `R apply(T t)` | 类型转换 |
| `Consumer<T>` | `void accept(T t)` | 消费数据 |
| `Supplier<T>` | `T get()` | 提供数据 |

### 扩展接口

```java
// 二元版本
BiPredicate<T,U>
BiFunction<T,U,R>     // 合并成 reduce
BiConsumer<T,U>

// 特化版本（避免装箱拆箱）
IntPredicate, IntFunction, IntConsumer, IntSupplier
LongPredicate, LongFunction, LongConsumer, LongSupplier
DoublePredicate, DoubleFunction, DoubleConsumer, DoubleSupplier

// Operator（输入和输出类型相同）
UnaryOperator<T>      // Function<T,T>
BinaryOperator<T>     // BiFunction<T,T,T>
```

### 实用示例

```java
List<String> names = Arrays.asList("Alice", "Bob", "Charlie", "David");

// Predicate 组合
Predicate<String> length3 = s -> s.length() > 3;
Predicate<String> startA = s -> s.startsWith("A");
names.stream()
    .filter(length3.and(startA))   // Predicate.and() 组合
    .forEach(System.out::println); // 输出：Alice

// Function 组合
Function<String, String> upper = String::toUpperCase;
Function<String, String> trim = String::trim;
Function<String, String> combined = upper.andThen(trim);  // compose() 顺序相反
```

## Stream API

Stream 不是数据结构，而是对数据源（集合、数组等）的**计算操作**抽象。

### Stream 流水线架构

```
    数据源 (Collection/Array/IO)
         │
         ▼
    ┌───────────────────┐
    │ 中间操作 (中间操作)  │  ← 惰性求值，不触发计算
    │  filter, map,      │
    │  flatMap, sorted,  │
    │  distinct, peek    │
    │  skip, limit       │
    └───────────────────┘
         │
         ▼
    ┌───────────────────┐
    │ 终端操作 (终端操作)  │  ← 触发流水线执行
    │  collect, forEach, │
    │  reduce, count,    │
    │  anyMatch, findFirst│
    └───────────────────┘
         │
         ▼
       结果 (Collection/数值/Optional)
```

### 创建 Stream

```java
// 1. 从集合
List<String> list = Arrays.asList("a", "b", "c");
Stream<String> s1 = list.stream();
Stream<String> s2 = list.parallelStream();

// 2. 从数组
Stream<String> s3 = Arrays.stream(new String[]{"a", "b"});

// 3. 直接创建
Stream<String> s4 = Stream.of("a", "b", "c");
Stream<Integer> s5 = Stream.iterate(0, n -> n + 2).limit(10);  // 0,2,4,...,18
Stream<Double> s6 = Stream.generate(Math::random).limit(5);

// 4. 从文件
Stream<String> lines = Files.lines(Paths.get("file.txt"));
```

### 中间操作详解

```java
List<Person> people = Arrays.asList(
    new Person("Alice", 25, "Engineer"),
    new Person("Bob", 30, "Engineer"),
    new Person("Charlie", 20, "Designer"),
    new Person("David", 35, "Manager")
);

// filter — 过滤
people.stream()
    .filter(p -> p.getAge() > 25)
    .collect(Collectors.toList());  // [Bob, David]

// map — 映射/转换
people.stream()
    .map(Person::getName)
    .collect(Collectors.toList());  // [Alice, Bob, Charlie, David]

// flatMap — 扁平化映射
List<List<String>> nested = Arrays.asList(
    Arrays.asList("a", "b"),
    Arrays.asList("c", "d")
);
nested.stream()
    .flatMap(Collection::stream)
    .collect(Collectors.toList());  // [a, b, c, d]

// sorted — 排序
people.stream()
    .sorted(Comparator.comparing(Person::getAge))
    .collect(Collectors.toList());

// distinct — 去重
Stream.of(1, 2, 2, 3, 3, 3).distinct().count();  // 3

// peek — 查看中间结果（调试用）
long count = people.stream()
    .peek(p -> System.out.println("Processing: " + p))
    .filter(p -> p.getAge() > 20)
    .count();

// skip / limit — 跳过/限制
people.stream()
    .skip(1)
    .limit(2)
    .collect(Collectors.toList());  // [Bob, Charlie]
```

### 终端操作详解

```java
// collect — 收集到集合
List<String> names = people.stream()
    .map(Person::getName)
    .collect(Collectors.toList());

Set<String> roleSet = people.stream()
    .map(Person::getRole)
    .collect(Collectors.toSet());

Map<String, List<Person>> byRole = people.stream()
    .collect(Collectors.groupingBy(Person::getRole));
// {Engineer=[Alice,Bob], Designer=[Charlie], Manager=[David]}

Map<Boolean, List<Person>> partitioned = people.stream()
    .collect(Collectors.partitioningBy(p -> p.getAge() >= 25));
// {true=[Alice,Bob,David], false=[Charlie]}

String joined = people.stream()
    .map(Person::getName)
    .collect(Collectors.joining(", "));  // Alice, Bob, Charlie, David

// reduce — 归约
Optional<Integer> sumAge = people.stream()
    .map(Person::getAge)
    .reduce(Integer::sum);  // 110

int sumAgeParallel = people.parallelStream()
    .map(Person::getAge)
    .reduce(0, Integer::sum);  // 带初始值

// count — 计数
long engineerCount = people.stream()
    .filter(p -> "Engineer".equals(p.getRole()))
    .count();  // 2

// anyMatch / allMatch / noneMatch
boolean hasYoung = people.stream().anyMatch(p -> p.getAge() < 21);    // true
boolean allAdult = people.stream().allMatch(p -> p.getAge() >= 18);  // true
boolean noChild = people.stream().noneMatch(p -> p.getAge() < 18);   // true

// findFirst / findAny
Optional<Person> first = people.stream()
    .filter(p -> "Engineer".equals(p.getRole()))
    .findFirst();  // Optional[Alice]

Optional<Person> any = people.parallelStream()
    .filter(p -> "Engineer".equals(p.getRole()))
    .findAny();  // 并行流中 findAny 比 findFirst 快（无序）
```

### Collectors 工具类常用方法

| 方法 | 返回 | 说明 |
|------|------|------|
| toList() | List<T> | 收集到 List |
| toSet() | Set<T> | 收集到 Set |
| toMap(keyMapper, valueMapper) | Map<K,V> | 收集到 Map |
| joining(delimiter) | String | 字符串连接 |
| groupingBy(classifier) | Map<K, List<V>> | 分组 |
| partitioningBy(predicate) | Map<Boolean, List<V>> | 分区 |
| counting() | Long | 计数 |
| summingInt/summingLong/summingDouble | 数值 | 求和 |
| averagingInt/averagingLong/averagingDouble | Double | 求平均 |
| maxBy/minBy(comparator) | Optional<T> | 最大值/最小值 |
| reducing(identity, mapper, op) | U | 自定义归约 |

### 并行流（Parallel Stream）

```java
// 底层使用 ForkJoinPool.commonPool()
// 默认线程数 = CPU 核数 - 1

long sum = LongStream.rangeClosed(1, 10_000_000)
    .parallel()
    .sum();

// 自定义 ForkJoinPool
ForkJoinPool customPool = new ForkJoinPool(4);
try {
    customPool.submit(() ->
        LongStream.rangeClosed(1, 10_000_000)
            .parallel()
            .sum()
    ).get();
} finally {
    customPool.shutdown();
}
```

**并行流适用原则**：
| 场景 | 建议 |
|------|------|
| 数据量大（> 10万） | ✅ 适合并行 |
| 独立操作（无共享状态） | ✅ 适合并行 |
| CPU 密集型 | ⚠️ 可能降低性能（上下文切换） |
| 顺序依赖 | ❌ 不适合 |
| 有阻塞操作 | ⚠️ 可能导致线程池饥饿 |

## Optional

Optional 是一个容器类，代表一个值存在或不存在，旨在减少 NullPointerException。

### 创建 Optional

```java
// 可能为空的返回值
Optional<String> empty = Optional.empty();
Optional<String> nonNull = Optional.of("Hello");   // 参数为 null 抛 NPE
Optional<String> nullable = Optional.ofNullable(someString);  // 安全创建
```

### 常用方法

```java
Optional<String> opt = Optional.ofNullable(getName());

// 判空 + 默认值
String name1 = opt.orElse("default");             // 总是计算默认值
String name2 = opt.orElseGet(() -> computeDefault()); // 延迟计算
String name3 = opt.orElseThrow(() -> new RuntimeException("Name not found"));

// 存在则消费
opt.ifPresent(System.out::println);
opt.ifPresentOrElse(
    System.out::println,
    () -> System.out.println("Not found")
);  // JDK 9+

// 转换
Optional<Integer> length = opt.map(String::length);
Optional<String> upper = opt.flatMap(s -> Optional.of(s.toUpperCase()));

// 过滤
Optional<String> filtered = opt.filter(s -> s.length() > 3);

// JDK 9+ 方法
Optional<String> result = opt.or(() -> Optional.of("fallback"));  // 备选 Optional
opt.stream().forEach(System.out::println);  // Optional 转 Stream
```

### Optional 使用规范

```java
// ✅ 正确：作为返回值
public Optional<User> findUserById(Long id) {
    User user = userDao.findById(id);
    return Optional.ofNullable(user);
}

// ❌ 错误：作为参数
public void processUser(Optional<User> user) {  // 不推荐
    user.ifPresent(u -> { ... });
}
// 应使用方法重载或 @Nullable 注解

// ❌ 错误：作为字段
public class User {
    private Optional<String> email;  // 不推荐，Optional 未实现 Serializable
}

// ❌ 错误：在集合中使用
public List<Optional<String>> getEmails();  // 不推荐，集合本身已有空判断
```

## JDK 9 - JDK 21 重要特性

### JDK 9 模块化系统（JPMS）

```java
// module-info.java
module com.example.myapp {
    requires java.sql;
    requires com.example.lib;
    exports com.example.myapp.api;
    provides com.example.myapp.spi.MyService
        with com.example.myapp.impl.MyServiceImpl;
}
```

**其他特性**：
```java
// 集合工厂方法
List<String> list = List.of("a", "b", "c");     // 不可变
Set<Integer> set = Set.of(1, 2, 3);               // 不可变
Map<String, Integer> map = Map.of("a", 1, "b", 2); // 不可变

// 接口私有方法
interface MyInterface {
    private void helper() { }  // JDK 9 允许接口私有方法
    default void doWork() {
        helper();
    }
}

// try-with-resources 增强
Resource r = new Resource();
try (r) {  // JDK 9 可直接使用 effectively final 变量
    r.process();
}

// Reactive Streams (Flow API)
Flow.Publisher, Flow.Subscriber, Flow.Subscription, Flow.Processor
```

### JDK 10 局部变量类型推断（var）

```java
var list = new ArrayList<String>();           // ➡ ArrayList<String>
var map = Map.of("a", 1, "b", 2);             // ➡ Map<String, Integer>
var stream = list.stream()
    .filter(s -> s.length() > 3)
    .collect(Collectors.toList());             // ➡ List<String>

// 不能使用 var 的场景
// var x;                     // ❌ 需要初始化
// var f = () -> "Hello";     // ❌ Lambda 需要目标类型
// var nullValue = null;      // ❌ 不能推断 null
```

### JDK 11 重要特性

```java
// 字符串增强
"  Hello  ".strip();          // "Hello"（去除全角/半角空格）
"a\nb\nc".lines().count();   // 3（返回 Stream<String>）
"a".repeat(3);                // "aaa"
"  ".isBlank();               // true

// Files.readString / writeString
String content = Files.readString(Paths.get("file.txt"));
Files.writeString(Paths.get("output.txt"), "Hello");

// HttpClient（正式版，JDK 9 孵化）
HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com"))
    .GET()
    .build();
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());
```

### JDK 14 Records（预览，JDK 16 正式）

```java
// record — 自动生成构造器、getter、equals、hashCode、toString
public record Point(int x, int y) { }

// 使用
Point p = new Point(3, 4);
System.out.println(p.x());  // 注意：不是 getX() 而是 x()
System.out.println(p);      // Point[x=3, y=4]

// 自定义行为
public record Range(int min, int max) {
    public Range {  // 紧凑构造器
        if (min > max) throw new IllegalArgumentException("min > max");
    }
    public boolean contains(int value) {
        return value >= min && value <= max;
    }
}
```

### JDK 15 Sealed Classes（预览，JDK 17 正式）

```java
// sealed — 限制继承/实现
public sealed class Shape
    permits Circle, Rectangle, Triangle { }

final class Circle extends Shape { }
final class Rectangle extends Shape { }
final class Triangle extends Shape { }

// sealed interface
public sealed interface Expression
    permits Add, Subtract, Multiply, Divide, Constant { }

record Add(Expression left, Expression right) implements Expression { }
record Constant(int value) implements Expression { }

// 配合 switch 模式匹配
int eval(Expression e) {
    return switch (e) {
        case Add(var l, var r)      -> eval(l) + eval(r);
        case Subtract(var l, var r) -> eval(l) - eval(r);
        case Multiply(var l, var r) -> eval(l) * eval(r);
        case Divide(var l, var r)   -> eval(l) / eval(r);
        case Constant(var v)        -> v;
    };
}
```

### JDK 16 Pattern Matching for instanceof（正式）

```java
// 旧写法
if (obj instanceof String) {
    String s = (String) obj;
    System.out.println(s.length());
}

// 新写法
if (obj instanceof String s) {
    System.out.println(s.length());  // 直接使用 s
}

// 组合条件
if (obj instanceof String s && s.length() > 5) {
    System.out.println(s.toUpperCase());
}
```

### JDK 17 Switch 模式匹配（预览，JDK 21 正式）

```java
// switch 表达式 + 模式匹配
Object obj = "Hello";
String result = switch (obj) {
    case Integer i -> "Integer: " + i;
    case String s  -> "String: " + s;
    case Long l    -> "Long: " + l;
    case null      -> "null value";      // JDK 17+ null 支持
    default        -> "Unknown type";
};

// Guarded pattern (JDK 17+)
String formatted = switch (obj) {
    case Integer i && i > 0 -> "Positive: " + i;
    case Integer i          -> "Non-positive: " + i;
    case String s && !s.isEmpty() -> "Non-empty string: " + s;
    case null               -> "null";
    default                 -> "Other: " + obj;
};
```

### JDK 21 虚拟线程（Virtual Threads）

虚拟线程是 JDK 21 正式发布的 LTS 特性，属于 Project Loom。

#### 原理

```
传统平台线程（Platform Thread）：
  Java 线程 ←1:1映射→ OS 线程

虚拟线程（Virtual Thread）：
  虚拟线程 ←M:N映射→ 载体线程（平台线程）

  10000 个虚拟线程 ↔ 少量平台线程（如 8 个）
```

#### 创建和使用

```java
// 方式 1：Thread.ofVirtual()
Thread vThread = Thread.ofVirtual()
    .name("vthread-1")
    .start(() -> {
        System.out.println("Hello from virtual thread");
    });

// 方式 2：Executors.newVirtualThreadPerTaskExecutor()
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
List<Future<String>> futures = IntStream.range(0, 10000)
    .mapToObj(i -> executor.submit(() -> {
        Thread.sleep(100);  // 虚拟线程睡眠时不阻塞 OS 线程
        return "Task " + i + " completed";
    }))
    .toList();

// 方式 3：结构化并发（JDK 21）
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Future<String> user = scope.fork(() -> fetchUser());
    Future<Integer> order = scope.fork(() -> fetchOrder());
    scope.join();               // 等待所有子任务
    scope.throwIfFailed();      // 任一失败则抛出
    return new Response(user.resultNow(), order.resultNow());
}
```

#### 虚拟线程 vs 平台线程

| 特性 | 平台线程 | 虚拟线程 |
|------|---------|---------|
| 创建成本 | 高（1MB 栈） | 极低（几 KB） |
| 最大数量 | 几千 | 百万级 |
| 上下文切换 | OS 级，昂贵 | JVM 级，极快 |
| 适用场景 | CPU 密集型 | IO 密集型 |
| 兼容性 | 全部 | 大部分（需注意 ThreadLocal 和 synchronized） |

**注意事项**：
- 虚拟线程不要池化（池化无意义，创建成本低）。
- 避免在虚拟线程中使用 `synchronized` 块（会锁定载体线程），使用 `ReentrantLock` 替代。
- 虚拟线程中使用 `ThreadLocal` 要谨慎（数量大时内存消耗高）。

## 面试高频 Q&A

**Q1: Lambda 表达式和匿名内部类的区别？**
- 底层机制：匿名内部类编译后产生独立 .class 文件；Lambda 使用 invokedynamic + LambdaMetafactory 动态生成。
- this 指向：匿名内部类的 this 指向自身；Lambda 的 this 指向外部类。
- 变量捕获：两者都要求被捕获变量是 effectively final。
- 性能：Lambda 更优（减少类加载开销）。

**Q2: Stream 的中间操作和终端操作有什么区别？**
- 中间操作返回 Stream，多个中间操作串联成流水线，**惰性求值**（不触发计算）。
- 终端操作产生最终结果或副作用，触发整个流水线的执行。
- 一个 Stream 只能有一个终端操作，执行后 Stream 被消费，不可复用。

**Q3: parallelStream 一定比 stream 快吗？**
不一定。并行流有额外开销（ForkJoin 任务拆分、合并结果、线程切换）。
适合：数据量大、元素独立处理、CPU 密集型计算、无共享可变状态。
不适合：数据量小、有阻塞操作、顺序依赖、大量拆装箱。

**Q4: Optional 的正确使用场景？**
- ✅ 作为方法返回值类型，表示返回值可能为空。
- ❌ 不作为方法参数（使用重载或 @Nullable）。
- ❌ 不作为类的字段（未实现 Serializable）。
- ❌ 不在集合中使用。

**Q5: 虚拟线程解决了什么问题？**
- 线程创建成本高 → 虚拟线程成本极低，创建百万级无压力。
- 线程上下文切换昂贵 → 虚拟线程切换在 JVM 内，纳秒级。
- 传统 Thread-Per-Request 模型下平台线程利用率低（大量时间阻塞在 IO 上）。

**Q6: 什么是 Record？使用 Record 有什么好处？**
Record 是 JDK 14 预览、JDK 16 正式引入的数据载体类。自动生成构造器、equals、hashCode、toString、getter（不叫 getX 而是 x()）。适合做 DTO、VO、值对象。减少样板代码，不可变（所有字段都是 private final）。

**Q7: Sealed Class 的作用是什么？**
- 限制类的继承体系，明确哪些子类可以继承。
- 配合模式匹配实现穷尽式检查（exhaustive switch）。
- 增强代码安全性和可维护性。

---```java
(parameters) -> expression
(parameters) -> { statements; }
```

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
- 结构化并发