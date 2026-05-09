## 设计模式（Design Patterns）

设计模式是经过反复验证、可用于解决特定场景问题的代码设计经验总结。掌握设计模式不仅能让你写出更优雅、更可维护的代码，也是大厂面试中高级工程师的必备技能。

---

## 一、创建型模式（Creational Patterns）

创建型模式关注**对象的创建机制**，旨在将对象的创建与使用分离，提升系统的灵活性和可扩展性。

---

### 1.1 单例模式（Singleton）

**目标**：确保一个类只有一个实例，并提供全局访问点。

#### 饿汉式（Eager Initialization）

类加载时就创建实例，由 JVM 保证线程安全。缺点是无论是否用到都会创建，可能造成资源浪费。

```java
public class EagerSingleton {
    private static final EagerSingleton INSTANCE = new EagerSingleton();

    private EagerSingleton() {}

    public static EagerSingleton getInstance() {
        return INSTANCE;
    }
}
```

**适用场景**：实例不重、一定会被使用的情况（如日志工厂）。

#### 懒汉式（Lazy Initialization）—— 线程不安全版

```java
public class LazySingleton {
    private static LazySingleton instance;

    private LazySingleton() {}

    public static LazySingleton getInstance() {
        if (instance == null) {
            instance = new LazySingleton();
        }
        return instance;
    }
}
```

**问题**：多线程下会创建多个实例，不适用于并发场景。

#### 懒汉式 —— 同步方法版

```java
public class SynchronizedSingleton {
    private static SynchronizedSingleton instance;

    private SynchronizedSingleton() {}

    public static synchronized SynchronizedSingleton getInstance() {
        if (instance == null) {
            instance = new SynchronizedSingleton();
        }
        return instance;
    }
}
```

**问题**：每次调用 getInstance() 都会加锁，性能损耗大。

#### 双重检查锁（DCL, Double-Checked Locking）

通过先判断实例是否为空来避免不必要的加锁操作，再加锁二次检查确保线程安全。`volatile` 关键字禁止指令重排序，防止拿到未初始化完成的对象。

```java
public class DCLSingleton {
    private static volatile DCLSingleton instance;

    private DCLSingleton() {}

    public static DCLSingleton getInstance() {
        if (instance == null) {                 // 第一次检查，避免加锁开销
            synchronized (DCLSingleton.class) {
                if (instance == null) {         // 第二次检查，保证单例
                    instance = new DCLSingleton();
                }
            }
        }
        return instance;
    }
}
```

**为什么用 volatile？** `instance = new DCLSingleton()` 在字节码层面是三步操作：①分配内存 ②调用构造器 ③赋值引用。如果发生指令重排序（②③对调），另一个线程可能拿到尚未构造完成的对象。

#### 静态内部类（推荐方式）

利用 JVM 类加载机制保证懒加载和线程安全。`SingletonHolder` 在外部类加载时不会初始化，只有在调用 `getInstance()` 时才会被加载。

```java
public class StaticInnerSingleton {

    private StaticInnerSingleton() {}

    private static class SingletonHolder {
        private static final StaticInnerSingleton INSTANCE = new StaticInnerSingleton();
    }

    public static StaticInnerSingleton getInstance() {
        return SingletonHolder.INSTANCE;
    }
}
```

**优点**：既实现了懒加载，又由 JVM 保证了线程安全，代码也最简洁。

#### 枚举单例（最安全方式）

Java 枚举天生支持单例模式，且自动防止反序列化和反射攻击。

```java
public enum EnumSingleton {
    INSTANCE;

    public void doSomething() {
        // 业务方法
    }
}
```

**调用**：`EnumSingleton.INSTANCE.doSomething();`

**面试高频问题：单例模式的破坏方式**
- **反射**：通过 `setAccessible(true)` 调用私有构造器 → 枚举无法被反射破坏
- **反序列化**：反序列化时会创建新实例 → 枚举的序列化由 JVM 保证单例
- **克隆**：实现 `clone()` 可破坏 → 重写 `clone()` 直接返回 `INSTANCE`

---

### 1.2 工厂模式（Factory Pattern）

工厂模式将对象的创建逻辑封装起来，客户端只需传入参数即可获得产品对象。

#### 简单工厂（Simple Factory）

```java
// 产品接口
public interface Payment {
    void pay(BigDecimal amount);
}

// 具体产品
public class Alipay implements Payment {
    public void pay(BigDecimal amount) {
        System.out.println("支付宝支付：" + amount);
    }
}

public class WechatPay implements Payment {
    public void pay(BigDecimal amount) {
        System.out.println("微信支付：" + amount);
    }
}

// 简单工厂
public class PaymentFactory {
    public static Payment create(String type) {
        if ("alipay".equals(type)) {
            return new Alipay();
        } else if ("wechat".equals(type)) {
            return new WechatPay();
        }
        throw new IllegalArgumentException("Unknown payment type: " + type);
    }
}

// 使用
Payment payment = PaymentFactory.create("alipay");
payment.pay(new BigDecimal("100"));
```

**缺点**：不符合开闭原则（OCP），添加新产品需要修改工厂类。

#### 工厂方法（Factory Method）

定义创建对象的接口，让子类决定实例化哪个类。

```java
// 抽象工厂
public interface PaymentFactory {
    Payment create();
}

// 具体工厂
public class AlipayFactory implements PaymentFactory {
    public Payment create() {
        return new Alipay();
    }
}

public class WechatPayFactory implements PaymentFactory {
    public Payment create() {
        return new WechatPay();
    }
}

// 使用
PaymentFactory factory = new AlipayFactory();
Payment payment = factory.create();
```

**优点**：新增产品只需新增工厂类，符合开闭原则。

#### 抽象工厂（Abstract Factory）

创建一组相关或相互依赖的对象（产品族），适用于需要配套产品的场景。

```java
// 抽象工厂：创建 UI 组件族
public interface UIFactory {
    Button createButton();
    TextField createTextField();
}

// 具体工厂：Windows 风格
public class WindowsUIFactory implements UIFactory {
    public Button createButton() { return new WindowsButton(); }
    public TextField createTextField() { return new WindowsTextField(); }
}

// 具体工厂：Mac 风格
public class MacUIFactory implements UIFactory {
    public Button createButton() { return new MacButton(); }
    public TextField createTextField() { return new MacTextField(); }
}
```

**Spring 中的工厂模式**：
- `BeanFactory` / `ApplicationContext` 本身就是工厂模式的实现
- `FactoryBean` 接口让你自定义创建 Bean 的逻辑

---

### 1.3 建造者模式（Builder Pattern）

将一个复杂对象的构建与它的表示分离，使得同样的构建过程可以创建不同的表示。

```java
public class Order {
    private final String orderId;      // 必填
    private final String userId;       // 必填
    private final String couponId;     // 可选
    private final String remark;       // 可选
    private final List<String> items;  // 必填

    private Order(Builder builder) {
        this.orderId = builder.orderId;
        this.userId = builder.userId;
        this.couponId = builder.couponId;
        this.remark = builder.remark;
        this.items = builder.items;
    }

    public static class Builder {
        private String orderId;
        private String userId;
        private String couponId;
        private String remark;
        private List<String> items;

        public Builder(String orderId, String userId) {
            this.orderId = orderId;
            this.userId = userId;
        }

        public Builder couponId(String couponId) { this.couponId = couponId; return this; }
        public Builder remark(String remark) { this.remark = remark; return this; }
        public Builder items(List<String> items) { this.items = items; return this; }

        public Order build() {
            return new Order(this);
        }
    }
}

// 使用
Order order = new Order.Builder("ORD001", "USER001")
    .couponId("CPN001")
    .remark("请尽快发货")
    .items(Arrays.asList("item1", "item2"))
    .build();
```

**Lombok @Builder**：用注解自动生成 Builder 模式，实际开发中很常用。

---

## 二、结构型模式（Structural Patterns）

结构型模式关注**类和对象的组合**，通过继承或组合构建出更大的结构。

---

### 2.1 代理模式（Proxy Pattern）

为目标对象提供一个代理，以控制对该对象的访问。

#### 静态代理

```java
public interface UserService {
    void save(User user);
}

public class UserServiceImpl implements UserService {
    public void save(User user) {
        System.out.println("保存用户：" + user.getName());
    }
}

// 静态代理类
public class UserServiceProxy implements UserService {
    private UserService target;

    public UserServiceProxy(UserService target) {
        this.target = target;
    }

    public void save(User user) {
        System.out.println("[日志] 开始保存用户");
        target.save(user);
        System.out.println("[日志] 保存完成");
    }
}
```

**缺点**：每个目标类都需要一个代理类，代码膨胀。

#### JDK 动态代理

基于接口，运行时动态生成代理类（通过 `Proxy.newProxyInstance`）。

```java
public class LogProxy implements InvocationHandler {
    private Object target;

    public LogProxy(Object target) {
        this.target = target;
    }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        System.out.println("[日志] 调用方法：" + method.getName());
        Object result = method.invoke(target, args);
        System.out.println("[日志] 方法完成：" + method.getName());
        return result;
    }

    @SuppressWarnings("unchecked")
    public static <T> T createProxy(T target) {
        return (T) Proxy.newProxyInstance(
            target.getClass().getClassLoader(),
            target.getClass().getInterfaces(),
            new LogProxy(target)
        );
    }
}

// 使用
UserService userService = new UserServiceImpl();
UserService proxy = LogProxy.createProxy(userService);
proxy.save(new User("张三"));
```

#### CGLIB 动态代理

基于子类继承，通过 ASM 字节码框架生成目标类的子类作为代理。Spring AOP 默认使用 CGLIB（自 Spring 4+ 起）。

```java
// 不需要接口，直接代理类
public class UserDao {
    public void save(String name) {
        System.out.println("保存用户：" + name);
    }
}

public class CglibProxy implements MethodInterceptor {
    private Object target;

    public CglibProxy(Object target) {
        this.target = target;
    }

    @Override
    public Object intercept(Object obj, Method method, Object[] args, MethodProxy proxy) throws Throwable {
        System.out.println("[CGLIB] 前置处理");
        Object result = proxy.invoke(target, args);
        System.out.println("[CGLIB] 后置处理");
        return result;
    }

    @SuppressWarnings("unchecked")
    public static <T> T createProxy(T target) {
        Enhancer enhancer = new Enhancer();
        enhancer.setSuperclass(target.getClass());
        enhancer.setCallback(new CglibProxy(target));
        return (T) enhancer.create();
    }
}

// 使用
UserDao dao = new UserDao();
UserDao proxy = CglibProxy.createProxy(dao);
proxy.save("张三");
```

| 对比 | JDK 动态代理 | CGLIB 动态代理 |
|------|-------------|---------------|
| 原理 | 基于接口，生成实现类 | 基于继承，生成子类 |
| 要求 | 目标对象必须实现接口 | 目标类不能是 final |
| 性能 | 创建代理更快 | 运行调用更快 |
| 默认 | Spring AOP 接口用 JDK | Spring AOP 类用 CGLIB |

**Spring AOP 中的代理选择**：如果目标 Bean 实现了接口，默认使用 JDK 动态代理；否则使用 CGLIB。可以通过 `proxy-target-class="true"` 强制使用 CGLIB。

---

### 2.2 适配器模式（Adapter Pattern）

将一个类的接口转换成客户端期望的另一个接口，让原本不兼容的类可以协同工作。

```java
// 目标接口：5V 充电
public interface USBTypeC {
    void chargeWith5V();
}

// 被适配者：220V 交流电
public class AC220 {
    public int output220V() {
        return 220;
    }
}

// 适配器：将 220V 转为 5V
public class PowerAdapter extends AC220 implements USBTypeC {
    @Override
    public void chargeWith5V() {
        int voltage = output220V();
        int output = voltage / 44;  // 变压处理
        System.out.println("220V → 5V 转换完成，输出：" + output + "V");
    }
}

// 使用
USBTypeC charger = new PowerAdapter();
charger.chargeWith5V();
```

**Spring 中的适配器模式**：
- `HandlerAdapter`：将不同的 Handler 适配为统一的调用方式
- `RequestMappingHandlerAdapter`、`SimpleControllerHandlerAdapter` 等

---

### 2.3 装饰器模式（Decorator Pattern）

动态地给对象添加额外职责，比继承更灵活。

```java
// 组件接口
public interface Coffee {
    double cost();
    String description();
}

// 具体组件
public class Espresso implements Coffee {
    public double cost() { return 20.0; }
    public String description() { return "浓缩咖啡"; }
}

// 抽象装饰器
public abstract class CoffeeDecorator implements Coffee {
    protected Coffee coffee;

    public CoffeeDecorator(Coffee coffee) {
        this.coffee = coffee;
    }
}

// 具体装饰器
public class MilkDecorator extends CoffeeDecorator {
    public MilkDecorator(Coffee coffee) { super(coffee); }

    public double cost() { return coffee.cost() + 5.0; }
    public String description() { return coffee.description() + " + 牛奶"; }
}

public class SugarDecorator extends CoffeeDecorator {
    public SugarDecorator(Coffee coffee) { super(coffee); }

    public double cost() { return coffee.cost() + 2.0; }
    public String description() { return coffee.description() + " + 糖"; }
}

// 使用：浓缩咖啡 + 牛奶 + 糖
Coffee coffee = new SugarDecorator(new MilkDecorator(new Espresso()));
System.out.println(coffee.description() + " = " + coffee.cost() + "元");
// 输出：浓缩咖啡 + 牛奶 + 糖 = 27.0元
```

**Java IO 流就是典型的装饰器模式**：
```java
InputStream in = new BufferedInputStream(new FileInputStream("test.txt"));
// FileInputStream 是具体组件
// BufferedInputStream 是装饰器，添加缓冲功能
```

---

## 三、行为型模式（Behavioral Patterns）

行为型模式关注**对象之间的通信和职责分配**。

---

### 3.1 策略模式（Strategy Pattern）

定义一系列算法，将每个算法封装起来，使它们可以互相替换。

```java
// 策略接口
public interface DiscountStrategy {
    BigDecimal apply(BigDecimal amount);
}

// 具体策略
public class NoDiscountStrategy implements DiscountStrategy {
    public BigDecimal apply(BigDecimal amount) {
        return amount;  // 无折扣
    }
}

public class PercentageDiscountStrategy implements DiscountStrategy {
    private double percentage;  // 折扣率 0.8 = 8折

    public PercentageDiscountStrategy(double percentage) {
        this.percentage = percentage;
    }

    public BigDecimal apply(BigDecimal amount) {
        return amount.multiply(BigDecimal.valueOf(percentage));
    }
}

public class FullReductionStrategy implements DiscountStrategy {
    private BigDecimal threshold;  // 满减门槛
    private BigDecimal reduction;  // 减免金额

    public FullReductionStrategy(BigDecimal threshold, BigDecimal reduction) {
        this.threshold = threshold;
        this.reduction = reduction;
    }

    public BigDecimal apply(BigDecimal amount) {
        if (amount.compareTo(threshold) >= 0) {
            return amount.subtract(reduction);
        }
        return amount;
    }
}

// 上下文
public class OrderService {
    private DiscountStrategy strategy;

    public OrderService(DiscountStrategy strategy) {
        this.strategy = strategy;
    }

    public BigDecimal calculateFinalAmount(BigDecimal amount) {
        return strategy.apply(amount);
    }
}

// 使用
OrderService order = new OrderService(new PercentageDiscountStrategy(0.8));
BigDecimal finalAmount = order.calculateFinalAmount(new BigDecimal("100"));
// 输出：80
```

**实战场景**：支付渠道选择、促销活动、排序算法、审批流程。

---

### 3.2 观察者模式（Observer Pattern）

定义一对多依赖关系，当一个对象状态改变时，所有依赖它的对象都得到通知并自动更新。

```java
// 主题接口
public interface Subject {
    void attach(Observer observer);
    void detach(Observer observer);
    void notifyObservers(String message);
}

// 具体主题
public class NewsPublisher implements Subject {
    private List<Observer> observers = new ArrayList<>();

    public void attach(Observer observer) {
        observers.add(observer);
    }

    public void detach(Observer observer) {
        observers.remove(observer);
    }

    public void notifyObservers(String message) {
        for (Observer observer : observers) {
            observer.update(message);
        }
    }

    // 业务方法
    public void publishNews(String news) {
        System.out.println("发布新闻：" + news);
        notifyObservers(news);
    }
}

// 观察者接口
public interface Observer {
    void update(String message);
}

// 具体观察者
public class EmailObserver implements Observer {
    private String email;

    public EmailObserver(String email) {
        this.email = email;
    }

    public void update(String message) {
        System.out.println("发送邮件到 " + email + "：" + message);
    }
}

public class SmsObserver implements Observer {
    private String phone;

    public SmsObserver(String phone) {
        this.phone = phone;
    }

    public void update(String message) {
        System.out.println("发送短信到 " + phone + "：" + message);
    }
}

// 使用
NewsPublisher publisher = new NewsPublisher();
publisher.attach(new EmailObserver("user@example.com"));
publisher.attach(new SmsObserver("13800138000"));
publisher.publishNews("Java 21 正式发布！");
```

**Spring 中的观察者模式**：
```java
// 事件
public class OrderCreatedEvent extends ApplicationEvent {
    private Long orderId;
    public OrderCreatedEvent(Object source, Long orderId) {
        super(source);
        this.orderId = orderId;
    }
}

// 监听器
@Component
public class EmailListener {
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        System.out.println("发送订单确认邮件，订单ID：" + event.getOrderId());
    }
}

@Component
public class SmsListener {
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        System.out.println("发送下单短信通知");
    }
}

// 发布事件
@Autowired
private ApplicationEventPublisher publisher;

public void createOrder(Order order) {
    // 保存订单
    orderRepository.save(order);
    // 发布事件
    publisher.publishEvent(new OrderCreatedEvent(this, order.getId()));
}
```

---

### 3.3 模板方法模式（Template Method Pattern）

定义一个操作的算法骨架，将一些步骤延迟到子类中实现。

```java
public abstract class AbstractDataProcessor {

    // 模板方法：定义算法骨架
    public final void process(String filePath) {
        // 1. 加载数据
        String data = loadData(filePath);
        // 2. 解析数据（由子类实现）
        Object parsed = parseData(data);
        // 3. 校验数据
        if (!validate(parsed)) {
            throw new IllegalArgumentException("数据校验失败");
        }
        // 4. 处理数据（由子类实现）
        Object result = doProcess(parsed);
        // 5. 输出结果
        outputResult(result);
    }

    private String loadData(String filePath) {
        System.out.println("从 " + filePath + " 加载数据");
        return "raw data";
    }

    protected abstract Object parseData(String data);        // 子类实现
    protected abstract Object doProcess(Object parsed);      // 子类实现

    protected boolean validate(Object data) {
        return data != null;  // 默认实现，子类可重写
    }

    private void outputResult(Object result) {
        System.out.println("处理结果：" + result);
    }
}

// 具体子类：JSON 处理器
public class JsonDataProcessor extends AbstractDataProcessor {
    protected Object parseData(String data) {
        return new JSONObject(data);
    }

    protected Object doProcess(Object parsed) {
        JSONObject json = (JSONObject) parsed;
        // 业务处理
        return json.getString("name");
    }
}

// 具体子类：XML 处理器
public class XmlDataProcessor extends AbstractDataProcessor {
    protected Object parseData(String data) {
        return DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(data);
    }

    protected Object doProcess(Object parsed) {
        Document doc = (Document) parsed;
        return doc.getElementsByTagName("name").item(0).getTextContent();
    }
}
```

**Spring 中的模板方法**：
- `JdbcTemplate`、`RestTemplate`、`JmsTemplate`、`TransactionTemplate`

---

## 四、设计模式在 Spring 中的应用（面试高频）

| 设计模式 | Spring 中的体现 |
|---------|----------------|
| 单例模式 | Bean 默认作用域是 Singleton |
| 工厂模式 | BeanFactory、ApplicationContext |
| 代理模式 | AOP（JDK 动态代理 / CGLIB） |
| 模板方法 | JdbcTemplate、RestTemplate |
| 观察者模式 | ApplicationEvent / @EventListener |
| 适配器模式 | HandlerAdapter、AdvisorAdapter |
| 策略模式 | ResourceLoader、InstantiationStrategy |
| 装饰器模式 | BeanWrapper、TransactionAwareCacheDecorator |
| 责任链模式 | Interceptor 链、Filter 链 |
| 建造者模式 | BeanDefinitionBuilder、UriComponentsBuilder |

---

## 五、面试小贴士

1. **单例模式**是面试最高频的设计模式，务必掌握 DCL 和静态内部类两种实现，并能说明 volatile 的作用。
2. **代理模式**要能说清楚 JDK 动态代理和 CGLIB 的底层实现原理（反射 vs ASM 字节码）。
3. **策略模式 + 工厂模式**经常结合使用，面试中可用来重构 if-else 分支。
4. **模板方法模式**在 Spring 源码中随处可见，面试官喜欢让举例子。
5. **不要生搬硬套**模式，过度设计比没有设计更糟糕 — 模式是为解决特定问题而生的工具。