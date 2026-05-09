## Spring MVC 请求处理流程

### 核心流程图

```
                     ┌──────────────────────────────┐
                     │    客户端（浏览器/App）        │
                     └─────────────┬────────────────┘
                                   │ HTTP 请求
                                   ▼
                     ┌──────────────────────────────┐
                     │      DispatcherServlet        │  （前端控制器）
                     │  doDispatch() 完成请求分发     │
                     └──────┬───────────────┬───────┘
                            │               │
                            ▼               ▼
              ┌─────────────────┐  ┌──────────────────┐
              │  HandlerMapping  │  │  HandlerAdapter  │
              │  查找 Handler    │  │  执行 Handler    │
              │  @RequestMapping │  │  调用 Controller │
              │  URL -> 方法映射  │  │  方法反射调用    │
              └────────┬────────┘  └─────────┬────────┘
                       │                     │
                       └──────────┬──────────┘
                                  ▼
                     ┌──────────────────────────────┐
                     │         Controller            │
                     │    执行业务逻辑，返回结果       │
                     └──────────────┬───────────────┘
                                    │
                          ┌─────────┴─────────┐
                          │                   │
                          ▼                   ▼
              ┌──────────────────┐  ┌──────────────────┐
              │   @ResponseBody  │  │   ModelAndView   │
              │  HttpMessageConv │  │   ViewResolver   │
              │  JSON 直接输出   │  │   视图渲染       │
              └──────────────────┘  └──────────────────┘
                          │                   │
                          └─────────┬─────────┘
                                    ▼
                     ┌──────────────────────────────┐
                     │       HTTP 响应               │
                     └──────────────────────────────┘
```

### doDispatch 源码核心逻辑

```java
// DispatcherServlet.java（核心源码简化）
protected void doDispatch(HttpServletRequest request, HttpServletResponse response) {
    HttpServletRequest processedRequest = request;
    HandlerExecutionChain mappedHandler = null;
    boolean multipartRequestParsed = false;

    try {
        // 1. 检查是否是文件上传请求
        processedRequest = checkMultipart(request);
        multipartRequestParsed = (processedRequest != request);

        // 2. HandlerMapping 查找 Handler（控制器方法）
        mappedHandler = getHandler(processedRequest);
        if (mappedHandler == null) {
            noHandlerFound(processedRequest, response);
            return;
        }

        // 3. HandlerAdapter 包装 Handler（适配不同类型的处理器）
        HandlerAdapter ha = getHandlerAdapter(mappedHandler.getHandler());

        // 4. 执行拦截器 preHandle
        if (!mappedHandler.applyPreHandle(processedRequest, response)) {
            return;
        }

        // 5. HandlerAdapter 实际调用目标方法
        ModelAndView mv = ha.handle(processedRequest, response, mappedHandler.getHandler());

        // 6. 执行拦截器 postHandle
        mappedHandler.applyPostHandle(processedRequest, response, mv);

        // 7. 视图渲染
        processDispatchResult(processedRequest, response, mappedHandler, mv, dispatchException);

    } catch (Exception ex) {
        // 异常处理
        processDispatchResult(..., mappedHandler, ..., ex);
    } finally {
        // 8. 执行拦截器 afterCompletion
        if (mappedHandler != null) {
            mappedHandler.triggerAfterCompletion(request, response, ex);
        }
    }
}
```

---

## 核心组件详解

### 1. HandlerMapping —— 请求路由

```java
// 核心接口：将请求映射到 Handler（控制器方法）
public interface HandlerMapping {
    HandlerExecutionChain getHandler(HttpServletRequest request) throws Exception;
}

// 常见实现类
// - RequestMappingHandlerMapping ：解析 @RequestMapping（最常用）
// - SimpleUrlHandlerMapping     ：显式 URL 模式匹配
// - BeanNameUrlHandlerMapping   ：Bean 名称为 URL
```

**RequestMappingHandlerMapping 工作流程：**
```
启动时解析所有 @RequestMapping 注解
        │
        ▼
Map<String, AbstractHandlerMethodMapping.T>

Key: 请求条件（路径、方法、参数等）
Value: HandlerMethod 对象
        │
        ▼
请求到达时匹配 → 路径模板匹配 → 参数匹配 → 找到对应方法
```

### 2. HandlerAdapter —— 方法调用器

```java
public interface HandlerAdapter {
    // 是否支持此 Handler
    boolean supports(Object handler);

    // 执行 Handler，返回 ModelAndView
    ModelAndView handle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception;

    // 获取最后修改时间戳
    long getLastModified(HttpServletRequest request, Object handler);
}

// 常见实现
// RequestMappingHandlerAdapter ：执行 @RequestMapping 方法（最常用，解析参数/返回值）
// HttpRequestHandlerAdapter    ：执行 HttpRequestHandler
// SimpleControllerHandlerAdapter：执行 Controller 接口
```

**RequestMappingHandlerAdapter 的参数解析能力：**
```java
@RestController
public class DemoController {

    @GetMapping("/demo/{id}")
    public Result<?> demo(
        // 路径变量
        @PathVariable Long id,

        // 请求参数
        @RequestParam(defaultValue = "10") int size,

        // 请求头
        @RequestHeader("User-Agent") String userAgent,

        // Cookie
        @CookieValue("sessionId") String sessionId,

        // 请求体自动反序列化
        @RequestBody @Valid UserCreateRequest request,

        // 自动绑定到对象属性
        @Valid UserQuery query,

        // 原生 Servlet API 支持
        HttpServletRequest servletRequest,
        HttpServletResponse servletResponse,

        // 时区/地区
        @RequestAttribute TimeZone timeZone,
        Locale locale
    ) {
        return Result.success(query);
    }
}
```

### 3. ViewResolver —— 视图解析

```java
public interface ViewResolver {
    View resolveViewName(String viewName, Locale locale) throws Exception;
}
```

常见实现：
- **InternalResourceViewResolver**：JSP 视图 `prefix + viewName + suffix`
- **ThymeleafViewResolver**：Thymeleaf 模板引擎
- **FreeMarkerViewResolver**：FreeMarker 模板引擎
- **ContentNegotiatingViewResolver**：根据请求内容类型选择不同视图

**目前主流是前后端分离，使用 @ResponseBody 直接返回 JSON：**
```java
@RestController  // = @Controller + @ResponseBody
public class UserController {

    // 直接返回对象，自动序列化为 JSON
    @GetMapping("/users")
    public Result<List<User>> list() {
        return Result.success(userService.findAll());
    }

    // 返回 JSON 状态码
    @PostMapping("/users")
    public ResponseEntity<User> create(@RequestBody @Valid UserCreateRequest request) {
        User created = userService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }
}
```

**HttpMessageConverter 机制：**
```
请求到达 → Content-Type: application/json
        │
        ▼
读取请求体 → Jackson 反序列化 → 方法参数对象
        │
        ▼
方法执行完毕 → 返回值 → Jackson 序列化 → JSON 响应体
        │
        ▼
涉及的 HttpMessageConverter：
- MappingJackson2HttpMessageConverter  ：JSON
- StringHttpMessageConverter          ：普通文本
- ByteArrayHttpMessageConverter       ：字节数组
- FormHttpMessageConverter            ：表单数据
```

---

## 拦截器详解

### 实现自定义拦截器

```java
@Component
public class AuthInterceptor implements HandlerInterceptor {

    // 在 Handler 执行之前调用
    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
            Object handler) throws Exception {

        String token = request.getHeader("Authorization");

        // 放行登录/注册接口
        String path = request.getRequestURI();
        if (path.contains("/auth/login") || path.contains("/auth/register")) {
            return true;
        }

        // 验证 Token
        if (token == null || !token.startsWith("Bearer ")) {
            response.setStatus(HttpStatus.UNAUTHORIZED.value());
            response.setContentType("application/json");
            response.getWriter().write("{\"code\":401,\"msg\":\"未登录\"}");
            return false;
        }

        // 解析 Token 设置当前用户
        String userId = JwtUtil.parseToken(token.substring(7));
        request.setAttribute("currentUserId", userId);

        return true;  // 返回 true 继续执行，false 终止
    }

    // 在 Handler 执行之后、视图渲染之前调用（可以修改 ModelAndView）
    @Override
    public void postHandle(HttpServletRequest request, HttpServletResponse response,
            Object handler, ModelAndView modelAndView) throws Exception {
        // 对于 REST API 通常不需要此方法
    }

    // 请求完成后回调（无论是否异常）
    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
            Object handler, Exception ex) throws Exception {
        // 清理资源、记录请求日志等
        long duration = System.currentTimeMillis() - (Long) request.getAttribute("startTime");
        log.info("请求完成: {} {} 耗时: {}ms", request.getMethod(), request.getRequestURI(), duration);
    }
}
```

### 注册拦截器

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Autowired
    private AuthInterceptor authInterceptor;

    @Autowired
    private RateLimitInterceptor rateLimitInterceptor;

    @Autowired
    private RequestLogInterceptor requestLogInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(requestLogInterceptor)
                .addPathPatterns("/**")
                .order(1);

        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/auth/**", "/api/public/**")
                .order(2);

        registry.addInterceptor(rateLimitInterceptor)
                .addPathPatterns("/api/**")
                .order(3);
    }
}
```

### 拦截器 vs 过滤器

```
请求进入
    │
    ▼
┌──────────────────────┐
│   Filter（Web 容器层） │  ● 基于 Servlet 规范
│   1. CharacterEncoding│  ● 可以处理所有资源（静态/动态）
│   2. CorsFilter       │  ● 无法获取 Spring Bean
│   3. SecurityFilter   │  ● 在 Interceptor 之前执行
│  ...                 │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ DispatcherServlet    │  ← Spring MVC 入口
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  Interceptor（Spring）│  ● Spring 框架层
│   1. preHandle       │  ● 只能处理 Controller 请求
│   2. postHandle      │  ● 可获取 Spring Bean
│   3. afterCompletion │  ● 细粒度路径匹配
└──────────────────────┘
           ▼
     Controller 方法
```

---

## 全局异常处理

```java
// 统一异常响应格式
@Data
@AllArgsConstructor
public class ErrorResponse {
    private int code;
    private String message;
    private long timestamp;
}

// 自定义业务异常
public class BusinessException extends RuntimeException {
    private final int code;

    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
    }

    public int getCode() { return code; }
}

// 全局异常处理器
@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    // 处理自定义业务异常
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ErrorResponse> handleBusinessException(BusinessException e) {
        log.warn("业务异常: code={}, msg={}", e.getCode(), e.getMessage());
        return ResponseEntity
            .badRequest()
            .body(new ErrorResponse(e.getCode(), e.getMessage(), System.currentTimeMillis()));
    }

    // 处理参数校验失败
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleValidationException(
            MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
            .map(error -> error.getField() + ": " + error.getDefaultMessage())
            .collect(Collectors.joining(", "));
        return ResponseEntity
            .badRequest()
            .body(new ErrorResponse(400, message, System.currentTimeMillis()));
    }

    // 处理参数类型不匹配
    @ExceptionHandler(TypeMismatchException.class)
    public ResponseEntity<ErrorResponse> handleTypeMismatch(TypeMismatchException e) {
        return ResponseEntity
            .badRequest()
            .body(new ErrorResponse(400, "参数类型错误: " + e.getPropertyName(), System.currentTimeMillis()));
    }

    // 处理资源不存在
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(NoResourceFoundException e) {
        return ResponseEntity
            .status(HttpStatus.NOT_FOUND)
            .body(new ErrorResponse(404, "资源不存在", System.currentTimeMillis()));
    }

    // 兜底：处理未预期的异常
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleException(Exception e) {
        log.error("系统异常", e);
        return ResponseEntity
            .status(HttpStatus.INTERNAL_SERVER_ERROR)
            .body(new ErrorResponse(500, "系统繁忙，请稍后重试", System.currentTimeMillis()));
    }
}
```

---

## 完整 REST API 实战案例

```java
// 实体
@Data
@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank(message = "用户名不能为空")
    @Column(unique = true, nullable = false, length = 50)
    private String username;

    @Email(message = "邮箱格式不正确")
    @Column(nullable = false, length = 100)
    private String email;

    @Min(value = 1, message = "年龄必须大于0")
    @Max(value = 150, message = "年龄不能超过150")
    private Integer age;

    @Column(nullable = false)
    private Boolean enabled = true;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime createdAt;

    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    private LocalDateTime updatedAt;
}

// 请求 DTO
@Data
public class UserCreateRequest {
    @NotBlank
    @Size(min = 2, max = 50)
    private String username;

    @Email
    @NotBlank
    private String email;

    @Min(1)
    @Max(150)
    private Integer age;
}

// 响应 DTO
@Data
@AllArgsConstructor
@NoArgsConstructor
public class PageResult<T> {
    private List<T> content;
    private int page;
    private int size;
    private long total;
    private int totalPages;
}

// 控制器
@RestController
@RequestMapping("/api/users")
@Validated
@Slf4j
public class UserController {

    @Autowired
    private UserService userService;

    @GetMapping
    public Result<PageResult<User>> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "10") int size,
            @RequestParam(required = false) String keyword) {
        PageResult<User> result = userService.findPage(page, size, keyword);
        return Result.success(result);
    }

    @GetMapping("/{id}")
    public Result<User> getById(@PathVariable @Positive Long id) {
        return Result.success(userService.findById(id));
    }

    @PostMapping
    public ResponseEntity<Result<User>> create(
            @RequestBody @Valid UserCreateRequest request) {
        User user = userService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(Result.success(user));
    }

    @PutMapping("/{id}")
    public Result<User> update(
            @PathVariable @Positive Long id,
            @RequestBody @Valid UserCreateRequest request) {
        return Result.success(userService.update(id, request));
    }

    @DeleteMapping("/{id}")
    public Result<Void> delete(@PathVariable @Positive Long id) {
        userService.delete(id);
        return Result.success();
    }

    @PatchMapping("/{id}/status")
    public Result<User> toggleStatus(@PathVariable @Positive Long id) {
        return Result.success(userService.toggleStatus(id));
    }
}
```

---

## 异步处理

```java
@RestController
@RequestMapping("/async")
public class AsyncController {

    // 方式一：Callable（在异步线程池执行）
    @GetMapping("/callable")
    public Callable<String> handleCallable() {
        log.info("主线程: {}", Thread.currentThread().getName());
        return () -> {
            Thread.sleep(1000);
            log.info("异步线程: {}", Thread.currentThread().getName());
            return "异步结果";
        };
    }

    // 方式二：DeferredResult（由其他线程设置结果）
    @GetMapping("/deferred")
    public DeferredResult<String> handleDeferred() {
        DeferredResult<String> result = new DeferredResult<>(5000L); // 超时5秒

        // 超时回调
        result.onTimeout(() -> {
            result.setErrorResult("请求超时");
        });

        // 完成回调
        result.onCompletion(() -> {
            log.info("请求完成");
        });

        // 模拟其他线程设置结果
        new Thread(() -> {
            try {
                Thread.sleep(2000);
                result.setResult("DeferredResult 结果");
            } catch (InterruptedException e) {
                result.setErrorResult(e);
            }
        }).start();

        return result;
    }

    // 异步配置
    @Configuration
    public static class AsyncConfig implements WebMvcConfigurer {
        @Override
        public void configureAsyncSupport(AsyncSupportConfigurer configurer) {
            configurer.setDefaultTimeout(30000);
            configurer.setTaskExecutor(new ThreadPoolTaskExecutor());
        }
    }
}
```

---

## 面试高频题

**Q1: DispatcherServlet 的工作流程？**
A: 1. 接收请求 2. HandlerMapping 查找 Handler 3. HandlerAdapter 执行 4. 解析视图（或直接返回 JSON）5. 返回响应。具体步骤参见 doDispatch 源码。

**Q2: @ControllerAdvice 的原理？**
A: 使用 AOP 的思想，在目标 Controller 执行前后增强。通过 ExceptionHandlerExceptionResolver 匹配异常类型和执行对应的方法。

**Q3: 拦截器和过滤器的区别？**
A: Filter 是 Servlet 规范，在 DispatcherServlet 之前执行，不能获取 Spring Bean。Interceptor 是 Spring 框架，在 Handler 前后执行，可以获取 Bean，更精细的路径匹配。

**Q4: RESTful 接口设计规范？**
A: 资源命名用名词复数（/users），用 HTTP 方法表示操作（GET/查、POST/增、PUT/全量更新、PATCH/部分更新、DELETE/删），使用状态码（201 Created、204 No Content、400 Bad Request、404 Not Found、500 Internal Server Error）。

---