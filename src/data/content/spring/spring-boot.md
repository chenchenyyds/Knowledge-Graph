## Spring Boot 自动配置原理

### 什么是 Spring Boot？

Spring Boot 是 Spring 框架的"一站式"解决方案，解决了传统 Spring 开发的痛点：
- **繁琐的 XML 配置** → 自动配置 + Java Config
- **依赖版本冲突** → Starter 统一管理版本
- **部署麻烦** → 内嵌 Web 容器，jar 包直接运行

```
传统 Spring 项目：
  pom.xml (手动管理版本)  →  XML 配置 (几百行)  →  Tomcat 安装  →  war 包部署

Spring Boot 项目：
  spring-boot-starter-parent (统一版本)  →  application.yml  →  java -jar app.jar
```

### @SpringBootApplication 拆解

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Inherited
@SpringBootConfiguration          // 标记为配置类
@EnableAutoConfiguration         // 开启自动配置（核心）
@ComponentScan(excludeFilters = { // 组件扫描
    @Filter(type = FilterType.CUSTOM, classes = TypeExcludeFilter.class)
})
public @interface SpringBootApplication {
    // 排除指定的自动配置类
    @AliasFor(annotation = EnableAutoConfiguration.class)
    Class<?>[] exclude() default {};

    // 排除指定的自动配置类名称
    @AliasFor(annotation = EnableAutoConfiguration.class)
    String[] excludeName() default {};

    // 指定扫描包
    @AliasFor(annotation = ComponentScan.class)
    String[] scanBasePackages() default {};
}
```

---

### 自动配置加载流程（面试必问）

```
启动类 @SpringBootApplication
        │
        ▼
@EnableAutoConfiguration
        │
        ▼
AutoConfigurationImportSelector
        │
        ▼
读取 META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
        │
        ▼
得到所有自动配置类全限定名（约 130+ 个）
        │
        ▼
逐一检查 @Conditional 条件
        │
        ▼
条件满足 → 加载配置类，注册 Bean
条件不满足 → 跳过
```

**关键文件：**
- Spring Boot 2.7+：`META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`
- Spring Boot 2.6-：`META-INF/spring.factories`（key = `org.springframework.boot.autoconfigure.EnableAutoConfiguration`）

**自动配置类实际内容示例：**
```java
@Configuration(proxyBeanMethods = false)
@ConditionalOnClass(DataSource.class)                    // 类路径有 DataSource
@ConditionalOnMissingBean(type = "javax.sql.DataSource") // 没有自定义 DataSource
@EnableConfigurationProperties(DataSourceProperties.class) // 绑定配置属性
@AutoConfigureAfter(JdbcTemplateAutoConfiguration.class)
public class DataSourceAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public DataSource dataSource(DataSourceProperties properties) {
        // 根据 properties 创建 HikariDataSource
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setJdbcUrl(properties.getUrl());
        dataSource.setUsername(properties.getUsername());
        dataSource.setPassword(properties.getPassword());
        return dataSource;
    }
}
```

---

### @Conditional 条件注解体系

```java
// 类路径存在时生效
@ConditionalOnClass(name = "org.springframework.data.redis.core.RedisTemplate")

// 类路径不存在时生效
@ConditionalOnMissingClass(value = "org.apache.tomcat")

// 不存在指定 Bean 时生效（用于覆盖默认配置）
@ConditionalOnMissingBean(type = "javax.sql.DataSource")

// 已存在指定 Bean 时生效
@ConditionalOnBean(annotation = EnableRetry.class)

// 配置属性匹配时生效
@ConditionalOnProperty(
    name = "spring.datasource.type",
    havingValue = "com.zaxxer.hikari.HikariDataSource",
    matchIfMissing = true   // 未配置时默认生效
)

// 资源文件存在时生效
@ConditionalOnResource(resources = "classpath:logback-spring.xml")

// Web 应用环境下生效
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)

// SpEL 表达式
@ConditionalOnExpression("${server.port:8080} == 8080")

// Java 版本匹配
@ConditionalOnJava(range = ConditionalOnJava.Range.EQUAL_OR_NEWER, version = JavaVersion.EIGHT)
```

**面试题：如何禁用某个自动配置？**
```yaml
# 方式一：exclude
spring:
  autoconfigure:
    exclude:
      - org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration

# 方式二：注解排除
@SpringBootApplication(exclude = DataSourceAutoConfiguration.class)

# 方式三：配置属性排除
spring.autoconfigure.exclude=org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration
```

---

### 自定义 Starter 实战

创建一个 Redis 操作 Starter，实现零配置即可使用：

**步骤 1：项目结构**
```
my-redis-spring-boot-starter/
  ├── pom.xml
  └── src/main/java/
      └── com/example/redis/
          ├── RedisProperties.java       # 配置属性绑定
          ├── RedisAutoConfiguration.java # 自动配置
          └── RedisOperations.java       # 对外提供的操作类
```

**步骤 2：配置属性绑定**
```java
@ConfigurationProperties(prefix = "my.redis")
public class RedisProperties {

    private String host = "localhost";   // 默认值
    private int port = 6379;
    private String password;
    private int timeout = 3000;
    private Pool pool = new Pool();

    // getters / setters ...

    public static class Pool {
        private int maxActive = 8;
        private int maxIdle = 8;
        private int minIdle = 0;
        // getters / setters ...
    }
}
```

**步骤 3：自动配置类**
```java
@Configuration
@ConditionalOnClass(JedisPool.class)   // 类路径有 Jedis 才生效
@EnableConfigurationProperties(RedisProperties.class)
public class RedisAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public JedisPool jedisPool(RedisProperties properties) {
        JedisPoolConfig config = new JedisPoolConfig();
        config.setMaxTotal(properties.getPool().getMaxActive());
        config.setMaxIdle(properties.getPool().getMaxIdle());
        config.setMinIdle(properties.getPool().getMinIdle());

        return new JedisPool(
            config,
            properties.getHost(),
            properties.getPort(),
            properties.getTimeout(),
            properties.getPassword()
        );
    }

    @Bean
    @ConditionalOnMissingBean
    public RedisOperations redisOperations(JedisPool jedisPool) {
        return new RedisOperations(jedisPool);
    }
}
```

**步骤 4：对外 API**
```java
public class RedisOperations {

    private final JedisPool jedisPool;

    public RedisOperations(JedisPool jedisPool) {
        this.jedisPool = jedisPool;
    }

    public void set(String key, String value) {
        try (Jedis jedis = jedisPool.getResource()) {
            jedis.set(key, value);
        }
    }

    public String get(String key) {
        try (Jedis jedis = jedisPool.getResource()) {
            return jedis.get(key);
        }
    }

    public boolean setNx(String key, String value, int ttlSeconds) {
        try (Jedis jedis = jedisPool.getResource()) {
            String result = jedis.set(key, value, "NX", "EX", ttlSeconds);
            return "OK".equals(result);
        }
    }
}
```

**步骤 5：注册自动配置**
在 `src/main/resources/META-INF/spring` 目录下创建文件：
`org.springframework.boot.autoconfigure.AutoConfiguration.imports`
```
com.example.redis.RedisAutoConfiguration
```

**步骤 6：用户使用**
```yaml
# application.yml
my:
  redis:
    host: 192.168.1.100
    port: 6379
    password: secret
    pool:
      max-active: 20
```

```java
@RestController
public class DemoController {

    @Autowired
    private RedisOperations redisOperations;  // 开箱即用

    @GetMapping("/cache/{key}")
    public String get(@PathVariable String key) {
        return redisOperations.get(key);
    }
}
```

---

## Spring Boot 启动流程（源码级）

```
构造函数 SpringApplication.run()
        │
        ▼
1. 推断应用类型
   ├─ ClassUtils.isPresent("javax.servlet.Servlet")       → SERVLET
   └─ ClassUtils.isPresent("org.springframework.web.")     → REACTIVE
        │
        ▼
2. 加载 ApplicationContextInitializer
   (从 spring.factories 读取)
        │
        ▼
3. 加载 ApplicationListener
   (从 spring.factories 读取)
        │
        ▼
4. 确定主启动类
   (通过堆栈信息找到 main 方法所在类)
        │
        ▼
5. 准备 Environment
   ├─ 加载 application.yml/properties
   ├─ 激活 profiles
   └─ 添加命令行参数
        │
        ▼
6. 创建 ApplicationContext
   ├─ SERVLET  → AnnotationConfigServletWebServerApplicationContext
   └─ REACTIVE → AnnotationConfigReactiveWebServerApplicationContext
        │
        ▼
7. 刷新上下文 (refresh)
   ├─ BeanFactory 初始化
   ├─ BeanDefinition 注册
   ├─ 自动配置生效 ← 关键步骤
   ├─ 内嵌 Web 服务器启动 (Tomcat/Jetty/Undertow)
   └─ 发布 ContextRefreshedEvent
        │
        ▼
8. 运行 CommandLineRunner / ApplicationRunner
        │
        ▼
9. 启动完成，打印 Started Application in X.XX seconds
```

**核心源码：**
```java
// SpringApplication.java (简化)
public ConfigurableApplicationContext run(String... args) {
    long startTime = System.nanoTime();
    DefaultBootstrapContext bootstrapContext = createBootstrapContext();
    ConfigurableApplicationContext context = null;

    // 1. 设置 Headless 模式
    configureHeadlessProperty();

    // 2. 获取并启动监听器
    SpringApplicationRunListeners listeners = getRunListeners(args);
    listeners.starting(bootstrapContext);

    try {
        // 3. 准备 Environment
        ApplicationArguments applicationArguments = new DefaultApplicationArguments(args);
        ConfigurableEnvironment environment = prepareEnvironment(listeners, bootstrapContext, applicationArguments);

        // 4. 打印 Banner
        printBanner(environment);

        // 5. 创建 ApplicationContext
        context = createApplicationContext();
        context.setApplicationStartup(this.applicationStartup);

        // 6. 准备上下文（加载 BeanDefinition）
        prepareContext(bootstrapContext, context, environment, listeners, applicationArguments, printedBanner);

        // 7. 刷新上下文（核心：触发自动配置）
        refreshContext(context);

        // 8. 刷新后处理
        afterRefresh(context, applicationArguments);

        listeners.started(context);

        // 9. 执行 Runner
        callRunners(context, applicationArguments);

        listeners.ready(context);
        return context;

    } catch (Throwable ex) {
        handleRunFailure(context, ex, listeners);
        throw new IllegalStateException(ex);
    }
}
```

---

## 外部化配置优先级

```
优先级从高到低：

1. 命令行参数              --server.port=8081
2. JNDI 属性               java:comp/env
3. 系统属性                System.getProperties()
4. OS 环境变量             SPRING_DATASOURCE_URL
5. 随机属性                random.*
6. application-{profile}.yml   (按 profile 优先级)
7. application.yml         (主配置文件)
8. @PropertySource         (注解引入的配置文件)
9. SpringApplication.setDefaultProperties()
```

**Profile 管理：**
```yaml
# application.yml（公共配置）
server:
  port: 8080
spring:
  profiles:
    active: dev

---
# application-dev.yml（开发环境）
spring:
  config:
    activate:
      on-profile: dev
server:
  port: 8081
datasource:
  url: jdbc:h2:mem:testdb

---
# application-prod.yml（生产环境）
spring:
  config:
    activate:
      on-profile: prod
server:
  port: 80
datasource:
  url: jdbc:mysql://prod-db:3306/mydb
```

```bash
# 启动指定环境
java -jar app.jar --spring.profiles.active=prod

# 或使用环境变量
export SPRING_PROFILES_ACTIVE=prod
java -jar app.jar
```

---

## Actuator —— 生产就绪监控

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

```yaml
management:
  endpoints:
    web:
      exposure:
        include: "health,info,metrics,env,beans,mappings"
      # 暴露所有端点：include: "*"
  endpoint:
    health:
      show-details: always   # 显示详细健康信息
  server:
    port: 9090               # 用独立端口（生产推荐）
```

**常用端点：**
| 端点 | 说明 | 用途 |
|------|------|------|
| /actuator/health | 健康检查 | K8s 探针、负载均衡 |
| /actuator/info | 应用信息 | 版本号、Git commit |
| /actuator/metrics | 指标数据 | JVM、CPU、内存 |
| /actuator/env | 环境属性 | 排查配置问题 |
| /actuator/beans | 所有 Bean | 检查 Bean 是否加载 |
| /actuator/mappings | 请求映射 | 查看所有 API 路由 |
| /actuator/loggers | 日志级别 | 运行时修改日志级别 |

```bash
# 运行时修改日志级别（无需重启）
curl -X POST localhost:9090/actuator/loggers/com.example.service \
  -H "Content-Type: application/json" \
  -d '{"configuredLevel": "DEBUG"}'
```

---

## 面试高频题

**Q1: @SpringBootApplication 注解的作用？**
A: 组合注解，等效于 @SpringBootConfiguration + @EnableAutoConfiguration + @ComponentScan。

**Q2: Spring Boot 如何实现自动配置？**
A: 通过 @EnableAutoConfiguration 导入 AutoConfigurationImportSelector，读取 AutoConfiguration.imports 中的配置类，结合 @Conditional 条件注解按需加载。

**Q3: 如何覆盖自动配置的 Bean？**
A: 三种方式：1. @Bean + @Primary 2. @ConditionalOnMissingBean（自动配置类已经使用）3. 在 exclude 中排除自动配置类后自己定义。

**Q4: Spring Boot 支持哪些内嵌容器？**
A: Tomcat（默认）、Jetty、Undertow、Netty（WebFlux）。通过排除 tomcat-starter 引入其他 starter 即可切换。

**Q5: Spring Boot 的配置加载顺序？**
A: 命令行参数 > JNDI > 系统属性 > 环境变量 > Profile 配置文件 > 主配置文件 > @PropertySource > 默认值。

---