## IoC (Inversion of Control) 控制反转

### 什么是 IoC？

传统开发中，对象自己创建和管理依赖:
```java
public class UserService {
    // 传统方式：自己 new 依赖
    private UserDao userDao = new UserDao();
    private EmailService emailService = new EmailService();
}
```

这种方式的痛点：
- **强耦合**：UserService 硬编码依赖具体实现
- **难以测试**：无法替换为 Mock 对象
- **难以扩展**：修改实现需要改代码

IoC 容器思想：将对象的创建和管理交给容器，对象只需声明"我需要什么"：
```java
@Component
public class UserService {
    @Autowired  // 由容器注入
    private UserDao userDao;

    @Autowired
    private EmailService emailService;
}
```

```
┌─────────────────────────────────────────────────────────┐
│                    IoC Container                        │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐           │
│  │UserDao   │   │UserService│   │MailService│   ...     │
│  │ (Bean)   │──▶│  (Bean)  │◀──│  (Bean)  │           │
│  └──────────┘   └──────────┘   └──────────┘           │
│       │                                      │         │
│       ▼                                      ▼         │
│  ┌──────────┐                      ┌──────────────┐   │
│  │OrderDao │                      │SmsService    │   │
│  │ (Bean)  │                      │  (Bean)      │   │
│  └──────────┘                      └──────────────┘   │
│                                                         │
│  所有 Bean 由容器管理：创建、装配、销毁                   │
└─────────────────────────────────────────────────────────┘
```

### BeanFactory vs ApplicationContext

| 特性 | BeanFactory | ApplicationContext |
|------|-------------|-------------------|
| 初始化 | 懒加载（需要时才创建） | 立即加载（启动时创建） |
| 接口 | 基础容器 | 高级容器（继承 BeanFactory） |
| 事件机制 | 不支持 | 支持事件发布/监听 |
| 国际化 | 不支持 | 支持 MessageSource |
| 资源访问 | 不支持 | 支持 ResourceLoader |
| AOP 整合 | 需手动配置 | 自动整合 |
| 常用实现 | XmlBeanFactory（已废弃） | AnnotationConfigApplicationContext |

```java
// BeanFactory 方式 —— 懒加载
BeanFactory factory = new XmlBeanFactory(new ClassPathResource("beans.xml"));
UserService userService = factory.getBean(UserService.class);  // 此时才创建

// ApplicationContext 方式 —— 立即加载
ApplicationContext ctx = new AnnotationConfigApplicationContext("com.example");
UserService userService = ctx.getBean(UserService.class);  // 启动时已创建
```

### 依赖注入的三种方式

**1. 构造器注入（推荐）**
```java
@RestController
public class UserController {

    private final UserService userService;
    private final EmailService emailService;

    // Spring 4.3+ 可以省略 @Autowired（只有一个构造器时）
    public UserController(UserService userService, EmailService emailService) {
        this.userService = userService;
        this.emailService = emailService;
    }
}
```
优点：不可变性（final）、利于测试、不会出现循环依赖（编译期检测）、Spring 官方推荐

**2. Setter 注入**
```java
@Component
public class OrderService {

    private PaymentService paymentService;

    @Autowired
    public void setPaymentService(PaymentService paymentService) {
        this.paymentService = paymentService;
    }
}
```
优点：可选依赖、可以重新注入

**3. 字段注入（不推荐）**
```java
@Component
public class ProductService {
    @Autowired
    private ProductDao productDao;
}
```
缺点：无法用 final、隐藏依赖关系、难以测试（需要反射注入）

### @Bean 与 @Component 的区别

```java
// @Component —— 标注在类上，自动扫描
@Component
@Slf4j
public class MyComponent {
    public void doSomething() {
        log.info("Doing something...");
    }
}

// @Bean —— 标注在配置类的方法上，手动注册
@Configuration
public class AppConfig {

    @Bean
    public RestTemplate restTemplate() {
        // 可以在此做复杂初始化
        RestTemplate template = new RestTemplate();
        template.setConnectTimeout(Duration.ofSeconds(5));
        template.setReadTimeout(Duration.ofSeconds(10));
        template.setMessageConverters(...);
        return template;
    }

    @Bean
    @ConditionalOnMissingBean  // 没有才创建
    public ObjectMapper objectMapper() {
        return new ObjectMapper()
            .registerModule(new JavaTimeModule())
            .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
    }
}
```

---

## Bean 生命周期（面试核心）

### 完整流程图

```
                    ┌─────────────────────────┐
                    │  1. 实例化 Instantiation │
                    │  (反射创建原始对象)       │
                    └──────────┬──────────────┘
                               ▼
                    ┌─────────────────────────┐
                    │  2. 属性赋值 Populate    │
                    │  (填充 @Autowired 字段)   │
                    └──────────┬──────────────┘
                               ▼
                    ┌─────────────────────────┐
                    │  3. Aware 接口回调       │
                    └──────────┬──────────────┘
                               ▼
                    ┌─────────────────────────┐
                    │  4. BeanPostProcessor   │
                    │     #postProcessBefore  │
                    │     Initialization      │
                    └──────────┬──────────────┘
                               ▼
                    ┌─────────────────────────┐
                    │  5. 初始化 Initializing │
                    │  ● @PostConstruct       │
                    │  ● InitializingBean     │
                    │     afterPropertiesSet  │
                    │  ● @Bean(initMethod)    │
                    └──────────┬──────────────┘
                               ▼
                    ┌─────────────────────────┐
                    │  6. BeanPostProcessor   │
                    │     #postProcessAfter   │
                    │     Initialization      │
                    └──────────┬──────────────┘
                               ▼
                    ┌─────────────────────────┐
                    │  7. Bean 就绪           │
                    │  (可供应用程序使用)      │
                    └──────────┬──────────────┘
                               ▼
                    ┌─────────────────────────┐
                    │  8. 容器关闭销毁        │
                    │  ● @PreDestroy          │
                    │  ● DisposableBean       │
                    │     destroy()           │
                    │  ● @Bean(destroyMethod) │
                    └─────────────────────────┘
```

### 代码示例展示完整生命周期

```java
@Component
public class LifecycleDemoBean implements BeanNameAware, BeanFactoryAware,
        InitializingBean, DisposableBean {

    private String name;

    public LifecycleDemoBean() {
        System.out.println("1. 实例化: LifecycleDemoBean() 构造方法");
    }

    @Autowired
    public void setName(String name) {
        System.out.println("2. 属性赋值: setName(" + name + ")");
        this.name = name;
    }

    @Override
    public void setBeanName(String name) {
        System.out.println("3. Aware: setBeanName(" + name + ")");
    }

    @Override
    public void setBeanFactory(BeanFactory beanFactory) throws BeansException {
        System.out.println("3. Aware: setBeanFactory()");
    }

    @PostConstruct
    public void postConstruct() {
        System.out.println("5. @PostConstruct: 初始化回调");
    }

    @Override
    public void afterPropertiesSet() throws Exception {
        System.out.println("5. InitializingBean.afterPropertiesSet()");
    }

    @PreDestroy
    public void preDestroy() {
        System.out.println("8. @PreDestroy: 销毁前回调");
    }

    @Override
    public void destroy() throws Exception {
        System.out.println("8. DisposableBean.destroy()");
    }
}
```

### BeanPostProcessor —— 扩展的关键

```java
@Component
public class MyBeanPostProcessor implements BeanPostProcessor {

    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName)
            throws BeansException {
        if (bean instanceof UserService) {
            System.out.println("4. BeforeInit: 对 UserService 做前置处理");
        }
        return bean;  // 可以返回代理对象
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName)
            throws BeansException {
        if (bean instanceof UserService) {
            System.out.println("6. AfterInit: 对 UserService 做后置处理");
            // 常见场景：返回 AOP 代理对象
            return ProxyFactory.getProxy(bean);
        }
        return bean;
    }
}
```

---

## 循环依赖与三级缓存（面试高频）

### 什么是循环依赖？

```java
@Component
public class A {
    @Autowired
    private B b;
}

@Component
public class B {
    @Autowired
    private A a;
}
```

```
    A ──────依赖──────▶ B
    ▲                    │
    │                    │
    └──────依赖──────────┘
```

### 三级缓存机制

```java
public class DefaultSingletonBeanRegistry {

    // 一级缓存：成品对象（完全初始化好的 Bean）
    Map<String, Object> singletonObjects = new ConcurrentHashMap<>(256);

    // 二级缓存：半成品对象（已实例化但未完成属性赋值）
    Map<String, Object> earlySingletonObjects = new ConcurrentHashMap<>(16);

    // 三级缓存：提前暴露的 Bean 工厂（Lambda，用于生成代理）
    Map<String, ObjectFactory<?>> singletonFactories = new HashMap<>(16);
}
```

### 三级缓存工作流程

```
1. A 开始创建，实例化完成 → 放入三级缓存（early reference）
   ┌──────────────┐
   │ 三级缓存:     │
   │ A → Lambda   │  (Lambda 可返回 A 的早期引用，支持 AOP)
   └──────────────┘

2. A 填充属性 b → 发现需要 B → 去容器找 B

3. B 开始创建，实例化完成 → 放入三级缓存
   ┌──────────────┐
   │ 三级缓存:     │
   │ A → Lambda   │
   │ B → Lambda   │
   └──────────────┘

4. B 填充属性 a → 发现需要 A
   → 检查一级缓存：没有
   → 检查二级缓存：没有
   → 检查三级缓存：有！
   → 执行 Lambda 得到 A 的早期引用
   → 放入二级缓存（从三级移除）
   → 注入给 B 的 a 字段

5. B 继续初始化 → 完成 → 放入一级缓存

6. A 拿到 B 的完整引用 → 注入 b 字段
   → A 继续初始化 → 完成 → 放入一级缓存
   → 从二/三级缓存移除
```

**面试常见追问：**
- 为什么需要三级缓存而不是两级？ → 需要第三级处理 AOP 代理，如果 Bean 需要 AOP，三级缓存的 Lambda 负责生成代理对象
- 构造器注入为什么不能解决循环依赖？ → 构造器注入在实例化阶段就需要依赖，此时 Bean 还没创建出来
- `@Lazy` 如何解决？ → 生成一个代理对象注入，真正使用时才去容器获取

---

## AOP 面向切面编程

### AOP 核心概念

```
                       ┌─────────────────────────┐
                       │      Aspect（切面）      │
                       │  @Around + @Before +... │
                       └──────────┬──────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          ▼                       ▼                       ▼
   ┌─────────────┐        ┌─────────────┐        ┌─────────────┐
   │ Pointcut    │        │ Join Point  │        │  Advice     │
   │ 切点表达式   │───────▶│ 连接点       │◀───────│  通知       │
   │ execution(* │        │ (方法执行点)  │        │  @Before    │
   │  service..*)│        └─────────────┘        │  @After     │
   └─────────────┘                                └─────────────┘
```

### 通知类型详解

```java
@Aspect
@Component
@Slf4j
public class LoggingAspect {

    // @Before：在目标方法执行前运行
    @Before("execution(* com.example.service.*.*(..))")
    public void logBefore(JoinPoint joinPoint) {
        log.info(">> 方法调用: {}.{}()",
            joinPoint.getTarget().getClass().getSimpleName(),
            joinPoint.getSignature().getName());
    }

    // @AfterReturning：目标方法正常返回后运行
    @AfterReturning(value = "execution(* com.example.service.*.*(..))", returning = "result")
    public void logAfterReturning(JoinPoint joinPoint, Object result) {
        log.info("<< 方法返回: {} = {}", joinPoint.getSignature().getName(), result);
    }

    // @AfterThrowing：目标方法抛出异常后运行
    @AfterThrowing(value = "execution(* com.example.service.*.*(..))", throwing = "ex")
    public void logAfterThrowing(JoinPoint joinPoint, Exception ex) {
        log.error("!! 方法异常: {} - {}", joinPoint.getSignature().getName(), ex.getMessage());
    }

    // @After（finally）：无论是否异常都会执行
    @After("execution(* com.example.service.*.*(..))")
    public void logAfter(JoinPoint joinPoint) {
        log.info("== 方法结束: {}", joinPoint.getSignature().getName());
    }

    // @Around：最强大的通知，控制是否执行目标方法
    @Around("@annotation(com.example.annotation.Monitor)")
    public Object measureTime(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.currentTimeMillis();
        try {
            Object result = pjp.proceed();  // 执行目标方法
            return result;
        } finally {
            long duration = System.currentTimeMillis() - start;
            log.info("[监控] {}.{}() 耗时: {}ms",
                pjp.getTarget().getClass().getSimpleName(),
                pjp.getSignature().getName(),
                duration);
            if (duration > 1000) {
                log.warn("[慢调用告警] {}ms > 1000ms", duration);
            }
        }
    }
}
```

### 切点表达式详解

```java
@Pointcut("execution(修饰符 返回值 包.类.方法(参数))")

// 常用表达式示例：
execution(public * com.example.service.*.*(..))          // service 包下所有 public 方法
execution(* com.example.service..*.*(..))                 // service 包及子包所有方法
execution(* com.example.service.UserService.*(..))        // UserService 所有方法
execution(* com.example.service.*.save*(Long, ..))        // 以 save 开头，第一个参数是 Long
execution(* com.example.service.*.*(@com.example.Valid (*))) // 带 @Valid 注解的参数

// 注解匹配
@within(org.springframework.stereotype.Service)           // 类上有 @Service
@annotation(org.springframework.cache.annotation.Cacheable) // 方法上有 @Cacheable
@args(com.example.annotation.Sensitive)                   // 参数上有 @Sensitive

// 组合表达式
@Pointcut("execution(* com.example.service.*.*(..))")
public void serviceLayer() {}

@Pointcut("within(com.example..*)")
public void appScope() {}

@Pointcut("serviceLayer() && appScope() && !@annotation(NoLogging)")
public void combinedPointcut() {}
```

### JDK 动态代理 vs CGLIB 代理

```
┌──────────────────────────────────────────────────────────┐
│               Spring AOP 代理选择策略                      │
│                                                          │
│                 目标类是否实现接口？                        │
│                        │                                 │
│         ┌──────────────┴──────────────┐                  │
│         ▼                             ▼                  │
│    ┌─────────┐                  ┌──────────┐            │
│    │  YES    │                  │   NO     │            │
│    └────┬────┘                  └────┬─────┘            │
│         │                            │                   │
│         ▼                            ▼                   │
│  ┌──────────────┐            ┌──────────────┐           │
│  │ JDK Proxy   │            │ CGLIB Proxy  │           │
│  │ 基于接口     │            │ 基于继承      │           │
│  │ 反射调用     │            │ ASM 生成子类  │           │
│  │ 性能较低     │            │ 性能较高      │           │
│  └──────────────┘            └──────────────┘           │
│                                                          │
│  Spring Boot 2.0+ 默认使用 CGLIB（即使有接口）            │
│  通过 spring.aop.proxy-target-class=false 切回 JDK       │
└──────────────────────────────────────────────────────────┘
```

JDK 代理示例：
```java
// 目标接口
public interface UserService {
    User findById(Long id);
}

// JDK 动态代理实现
public class JdkProxyFactory {
    public static Object getProxy(Object target) {
        return Proxy.newProxyInstance(
            target.getClass().getClassLoader(),
            target.getClass().getInterfaces(),
            (proxy, method, args) -> {
                System.out.println("JDK Proxy Before...");
                Object result = method.invoke(target, args);
                System.out.println("JDK Proxy After...");
                return result;
            }
        );
    }
}
```

CGLIB 代理示例：
```java
// CGLIB 代理（不需要接口）
public class CglibProxyFactory implements MethodInterceptor {

    public Object getProxy(Class<?> clazz) {
        Enhancer enhancer = new Enhancer();
        enhancer.setSuperclass(clazz);
        enhancer.setCallback(this);
        return enhancer.create();
    }

    @Override
    public Object intercept(Object obj, Method method, Object[] args,
            MethodProxy proxy) throws Throwable {
        System.out.println("CGLIB Before...");
        Object result = proxy.invokeSuper(obj, args);  // 调用父类方法（不走反射）
        System.out.println("CGLIB After...");
        return result;
    }
}
```

---

## 实战案例：自定义注解 + AOP 实现日志审计

```java
// 1. 自定义注解
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface AuditLog {
    String action();          // 操作类型：CREATE/UPDATE/DELETE/QUERY
    String module();          // 模块名
    String description() default "";
}

// 2. AOP 切面
@Aspect
@Component
@Slf4j
public class AuditLogAspect {

    @Autowired
    private AuditLogRepository auditLogRepository;

    @Around("@annotation(auditLog)")
    public Object around(ProceedingJoinPoint pjp, AuditLog auditLog) throws Throwable {
        // 获取操作前数据
        String methodName = pjp.getSignature().getName();
        Object[] args = pjp.getArgs();
        String params = args.length > 0 ? args[0].toString() : "";

        // 获取当前用户（从 SecurityContext）
        String username = SecurityContextHolder.getContext()
            .getAuthentication().getName();

        Object result = null;
        boolean success = true;
        String errorMsg = null;

        try {
            result = pjp.proceed();
            return result;
        } catch (Exception e) {
            success = false;
            errorMsg = e.getMessage();
            throw e;
        } finally {
            // 异步记录审计日志
            AuditLogEntity logEntity = new AuditLogEntity();
            logEntity.setUsername(username);
            logEntity.setAction(auditLog.action());
            logEntity.setModule(auditLog.module());
            logEntity.setMethod(methodName);
            logEntity.setParams(params);
            logEntity.setSuccess(success);
            logEntity.setErrorMsg(errorMsg);
            logEntity.setDuration(...);
            auditLogRepository.save(logEntity);
        }
    }
}

// 3. 使用
@RestController
@RequestMapping("/api/users")
public class UserController {

    @AuditLog(action = "CREATE", module = "用户管理", description = "创建用户")
    @PostMapping
    public Result<User> createUser(@RequestBody @Valid UserCreateRequest request) {
        return Result.success(userService.create(request));
    }

    @AuditLog(action = "UPDATE", module = "用户管理")
    @PutMapping("/{id}")
    public Result<User> updateUser(@PathVariable Long id, @RequestBody UserUpdateRequest request) {
        return Result.success(userService.update(id, request));
    }

    @AuditLog(action = "DELETE", module = "用户管理")
    @DeleteMapping("/{id}")
    public Result<Void> deleteUser(@PathVariable Long id) {
        userService.delete(id);
        return Result.success();
    }
}
```

---

## 面试高频题

**Q1: Spring IoC 容器是如何启动的？**
A: 以 AnnotationConfigApplicationContext 为例：1. 扫描指定包下的类 2. 解析 @Component、@Service 等注解 3. 通过 BeanDefinitionReader 读取为 BeanDefinition 4. BeanFactoryPostProcessor 处理 BeanDefinition 5. 实例化所有单例 Bean（已完成生命周期）

**Q2: @Autowired 和 @Resource 的区别？**
A: @Autowired 是 Spring 注解，按类型注入；@Resource 是 JSR-250 注解，默认按名称注入。@Autowired 可以和 @Qualifier 配合实现按名称注入。

**Q3: Spring AOP 和 AspectJ 的关系？**
A: Spring AOP 是运行时织入（基于代理），只支持方法级别的切面；AspectJ 是编译期织入（通过修改字节码），支持更丰富的切点（构造器、字段等）。Spring 使用 AspectJ 的注解语法（@Aspect/@Before 等），但底层仍用 Spring 的代理机制。

**Q4: 如何解决循环依赖？**
A: 三级缓存 + 提前暴露。构造器注入无法解决（可加 @Lazy），prototype 作用域无法解决（不在缓存中），多例和单例混合也无法解决。

---