## 集合框架体系

Java 集合框架主要分为两大接口体系：

```
                    Collection (接口)
                  ┌──────┴──────┐
                  │             │
               List           Set              Queue
            ┌───┼───┐     ┌───┼───┐        ┌───┼───┐
          ArrayList  │  HashSet  │       PriorityQueue  │
          LinkedList │  TreeSet  │        Deque          │
          Vector     │ LinkedHashSet│      ArrayDeque    │
           Stack     └───────────┘        LinkedList     │
          CopyOnWriteArrayList                         └───


                    Map (接口)
          ┌───────────┼───────────┐
          │           │           │
       HashMap   TreeMap    ConcurrentHashMap
          │
     LinkedHashMap
          │
       Hashtable
```

## HashMap 源码深度分析（JDK 8+）

### 数据结构

```
JDK 7：数组 + 链表（头插法）
JDK 8+：数组 + 链表 + 红黑树（尾插法）
```

```
      table 数组
    ┌────┬────┬────┬────┬────┐
    │    │    │    │    │    │    链表 / 红黑树
    │ 0  │ 1  │ 2  │ 3  │ 4  │
    │    │    │    │    │    │    ┌───┐   ┌───┐
    ├────┼────┼────┼────┼────┤    │ A │ → │ B │
    │    │    │    │    │    │    └───┘   └───┘
    │ 5  │ 6  │ 7  │ 8  │ 9  │
    │    │    │    │    │    │    ┌───┐
    ├────┼────┼────┼────┼────┤    │ C │
    │    │    │    │    │    │    │ D │ (红黑树)
    │ 10 │ 11 │ 12 │ 13 │ 14 │    │ E │
    │    │    │    │    │    │    └───┘
    └────┴────┴────┴────┴────┘
```

### 重要字段与常量

```java
static final int DEFAULT_INITIAL_CAPACITY = 1 << 4;  // 16
static final int MAXIMUM_CAPACITY = 1 << 30;
static final float DEFAULT_LOAD_FACTOR = 0.75f;
static final int TREEIFY_THRESHOLD = 8;       // 链表转红黑树
static final int UNTREEIFY_THRESHOLD = 6;     // 红黑树退化回链表
static final int MIN_TREEIFY_CAPACITY = 64;   // 最小树化容量

transient Node<K,V>[] table;   // Node 数组
transient int size;            // K-V 数量
int threshold;                 // 扩容阈值 = capacity * loadFactor
final float loadFactor;        // 负载因子
```

### Hash 值计算

```java
static final int hash(Object key) {
    int h;
    // key 为 null 时 hash=0（允许 null 键）
    // 高16位异或低16位，混合高位信息减少冲突
    return (key == null) ? 0 : (h = key.hashCode()) ^ (h >>> 16);
}
```

### put 方法全流程

```java
final V putVal(int hash, K key, V value, boolean onlyIfAbsent, boolean evict) {
    Node<K,V>[] tab; Node<K,V> p; int n, i;
    // 1. table 为空 → 初始化扩容
    if ((tab = table) == null || (n = tab.length) == 0)
        n = (tab = resize()).length;
    // 2. 定位桶：(n-1) & hash，桶为空直接插入
    if ((p = tab[i = (n - 1) & hash]) == null)
        tab[i] = newNode(hash, key, value, null);
    else {
        Node<K,V> e; K k;
        // 3. 桶首节点 key 相等 → 直接覆盖
        if (p.hash == hash && ((k = p.key) == key || (key != null && key.equals(k))))
            e = p;
        // 4. 树节点 → 红黑树插入
        else if (p instanceof TreeNode)
            e = ((TreeNode<K,V>)p).putTreeVal(this, tab, hash, key, value);
        // 5. 链表节点 → 遍历链表
        else {
            for (int binCount = 0; ; ++binCount) {
                if ((e = p.next) == null) {
                    // 尾插法插入新节点
                    p.next = newNode(hash, key, value, null);
                    // 链表长度 ≥ TREEIFY_THRESHOLD(8) → 转红黑树
                    if (binCount >= TREEIFY_THRESHOLD - 1)
                        treeifyBin(tab, hash);
                    break;
                }
                if (e.hash == hash && ((k = e.key) == key || (key != null && key.equals(k))))
                    break;
                p = e;
            }
        }
        // 6. key 已存在 → 替换 value，返回旧值
        if (e != null) {
            V oldValue = e.value;
            if (!onlyIfAbsent || oldValue == null)
                e.value = value;
            afterNodeAccess(e);
            return oldValue;
        }
    }
    ++modCount;
    // 7. 超过阈值 → 扩容
    if (++size > threshold)
        resize();
    afterNodeInsertion(evict);
    return null;
}
```

```
PUT 流程示意图：
  开始
    │
    ▼
  计算 hash = key.hashCode() ^ (hash >>> 16)
    │
    ▼
  定位桶 index = (n - 1) & hash
    │
    ├──→ 桶为空 → 直接插入 Node
    │
    └──→ 桶不为空
            │
            ├──→ key 相等 → 替换 value
            │
            ├──→ 树节点 → 红黑树插入
            │
            └──→ 链表遍历
                    │
                    ├──→ key 相等 → 替换 value
                    │
                    └──→ 未找到 → 尾插
                            │
                            └──→ 长度 ≥8 → 转红黑树
    │
    ▼
  size > threshold → 扩容
    │
    ▼
  结束
```

### get 方法流程

```java
final Node<K,V> getNode(int hash, Object key) {
    Node<K,V>[] tab; Node<K,V> first, e; int n; K k;
    // 1. table 不为空且桶不为空
    if ((tab = table) != null && (n = tab.length) > 0 &&
        (first = tab[(n - 1) & hash]) != null) {
        // 2. 检查首节点
        if (first.hash == hash && ((k = first.key) == key || (key != null && key.equals(k))))
            return first;
        if ((e = first.next) != null) {
            // 3. 红黑树查找
            if (first instanceof TreeNode)
                return ((TreeNode<K,V>)first).getTreeNode(hash, key);
            // 4. 链表遍历
            do {
                if (e.hash == hash && ((k = e.key) == key || (key != null && key.equals(k))))
                    return e;
            } while ((e = e.next) != null);
        }
    }
    return null; // 未找到
}
```

### resize 扩容机制

```java
final Node<K,V>[] resize() {
    Node<K,V>[] oldTab = table;
    int oldCap = (oldTab == null) ? 0 : oldTab.length;
    int oldThr = threshold;
    int newCap, newThr = 0;

    if (oldCap > 0) {
        // 已达最大容量 → 无法扩容，只能碰撞
        if (oldCap >= MAXIMUM_CAPACITY) {
            threshold = Integer.MAX_VALUE;
            return oldTab;
        }
        // 新容量 = 旧容量 × 2
        else if ((newCap = oldCap << 1) <= MAXIMUM_CAPACITY &&
                 oldCap >= DEFAULT_INITIAL_CAPACITY)
            newThr = oldThr << 1; // 阈值翻倍
    } else if (oldThr > 0) {
        newCap = oldThr; // 使用阈值作为容量
    } else {
        // 初始默认值
        newCap = DEFAULT_INITIAL_CAPACITY;
        newThr = (int)(DEFAULT_LOAD_FACTOR * DEFAULT_INITIAL_CAPACITY);
    }

    // 创建新数组
    Node<K,V>[] newTab = (Node<K,V>[])new Node[newCap];
    table = newTab;

    // 元素重新分配（rehash）
    if (oldTab != null) {
        for (int j = 0; j < oldCap; ++j) {
            Node<K,V> e;
            if ((e = oldTab[j]) != null) {
                oldTab[j] = null; // 帮助 GC
                if (e.next == null)
                    // 单个节点 → 直接 rehash
                    newTab[e.hash & (newCap - 1)] = e;
                else if (e instanceof TreeNode)
                    // 红黑树拆分
                    ((TreeNode<K,V>)e).split(this, newTab, j, oldCap);
                else {
                    // 链表拆分：根据 hash & oldCap == 0 分高低位
                    Node<K,V> loHead = null, loTail = null;
                    Node<K,V> hiHead = null, hiTail = null;
                    Node<K,V> next;
                    do {
                        next = e.next;
                        if ((e.hash & oldCap) == 0) {
                            // 低位链表（位置不变）
                            if (loTail == null) loHead = e;
                            else loTail.next = e;
                            loTail = e;
                        } else {
                            // 高位链表（位置 = j + oldCap）
                            if (hiTail == null) hiHead = e;
                            else hiTail.next = e;
                            hiTail = e;
                        }
                        e = next;
                    } while (e != null);
                    if (loTail != null) {
                        loTail.next = null;
                        newTab[j] = loHead;
                    }
                    if (hiTail != null) {
                        hiTail.next = null;
                        newTab[j + oldCap] = hiHead;
                    }
                }
            }
        }
    }
    return newTab;
}
```

**扩容优化（JDK 8）**：
- JDK 7 需要全部 rehash（计算 index 为新值）。
- JDK 8 根据 `hash & oldCap == 0` 判断：为 0 留在原位，为 1 移动到 `原位置 + oldCap`，无需重新计算 hash。

```
扩容前（容量 16）：
  hash = 0011 0101 → index = 0101 = 5
  hash = 0111 0101 → index = 0101 = 5（冲突）

扩容后（容量 32）：
  hash = 0011 0101 → index = 00101 = 5      （低位，原位）
  hash = 0111 0101 → index = 10101 = 21 = 5+16（高位，原位+oldCap）
```

## ConcurrentHashMap 源码分析

### JDK 7 实现：Segment 分段锁

```
                    ConcurrentHashMap
    ┌──────┬──────┬──────┬──────┬──────┬──────┐
    │ S0   │ S1   │ S2   │ ...  │ S14  │ S15  │     ← Segment 数组
    ├──────┼──────┼──────┼──────┼──────┼──────┤
    │HashEntry[]  │      │      │      │      │
    │ ┌─┬─┬─┐     │      │      │      │      │
    │ │E│E│E│     │      │      │      │      │     ← 每个 Segment 内 HashEntry 链表
    │ └─┴─┴─┘     │      │      │      │      │
    └──────┴──────┴──────┴──────┴──────┴──────┘
    每个 Segment = 一把 ReentrantLock
```

- **数据结构**：Segment 数组 + HashEntry 链表（数组长度默认 16，即并发度 16）。
- **put 流程**：先定位 Segment，再对 Segment 加锁（继承 ReentrantLock），然后插入。
- **size() 计算**：先无锁累加两次，不一致再逐个加锁统计。
- **缺点**：Segment 数量固定，并发度固定；链表情，查询 O(n)。

### JDK 8 实现：CAS + synchronized

```
                    ConcurrentHashMap
    ┌────┬────┬────┬────┬────┬────┬────┬────┐
    │    │    │    │    │    │    │    │    │     ← Node 数组（同 HashMap）
    ├────┼────┼────┼────┼────┼────┼────┼────┤
    │    │  N │  N │    │  N │  N │    │    │
    │    │ / \│    │    │ / \│    │    │    │     ← 链表或 TreeBin(红黑树)
    │    │/   │    │    │/   │    │    │    │
    └────┴────┴────┴────┴────┴────┴────┴────┘
    锁粒度：单个 Node/桶 (synchronized)
```

#### putVal 流程

```java
final V putVal(K key, V value, boolean onlyIfAbsent) {
    if (key == null || value == null) throw new NullPointerException();
    int hash = spread(key.hashCode());
    int binCount = 0;
    for (Node<K,V>[] tab = table;;) {
        Node<K,V> f; int n, i, fh; K fk; V fv;
        if (tab == null || (n = tab.length) == 0)
            tab = initTable();                    // CAS 初始化
        else if ((f = tabAt(tab, i = (n - 1) & hash)) == null) {
            if (casTabAt(tab, i, null, new Node<K,V>(hash, key, value)))
                break;                            // CAS 直接插入
        }
        else if ((fh = f.hash) == MOVED)
            tab = helpTransfer(tab, f);            // 协助扩容
        else {
            V oldVal = null;
            synchronized (f) {                     // 锁住桶首节点
                // 检查锁的对象是否被修改
                if (tabAt(tab, i) == f) {
                    if (fh >= 0) {                 // 链表
                        // ... 遍历插入
                    } else if (f instanceof TreeBin) { // 红黑树
                        // ... 红黑树插入
                    }
                }
            }
            if (binCount != 0) {
                if (binCount >= TREEIFY_THRESHOLD)
                    treeifyBin(tab, i);           // 链表转树
                if (oldVal != null)
                    return oldVal;
                break;
            }
        }
    }
    addCount(1L, binCount);                        // 原子性计数
    return null;
}
```

**核心改进**：
1. **锁粒度**：JDK 7 锁 Segment（多桶），JDK 8 锁单个桶首节点。
2. **数据结构**：JDK 8 引入红黑树，查询 O(log n)。
3. **size()**：使用 CounterCell 进行计数，无需加锁。

### HashMap vs HashTable vs ConcurrentHashMap

| 特性 | HashMap | HashTable | ConcurrentHashMap |
|------|---------|-----------|-----------------|
| 线程安全 | 否 | 是（synchronized 方法） | 是 |
| null key/value | 允许 | 不允许 | 不允许 |
| 性能 | 最高 | 低（全表锁） | 高（桶锁/CAS） |
| 迭代器 | fail-fast | fail-fast | fail-safe（弱一致性） |
| 底层 | 数组+链表+红黑树 | 数组+链表 | 数组+链表+红黑树 |

## ArrayList 与 LinkedList 深度对比

### ArrayList 扩容机制

```java
// 核心扩容逻辑
private void grow(int minCapacity) {
    int oldCapacity = elementData.length;
    // 新容量 = 旧容量 + 旧容量 >> 1（1.5 倍）
    int newCapacity = oldCapacity + (oldCapacity >> 1);
    if (newCapacity - minCapacity < 0)
        newCapacity = minCapacity;
    if (newCapacity - MAX_ARRAY_SIZE > 0)
        newCapacity = hugeCapacity(minCapacity);
    // Arrays.copyOf 本质是 System.arraycopy（native）
    elementData = Arrays.copyOf(elementData, newCapacity);
}
```

- **默认初始容量**：10（JDK 8+ 是懒加载，第一次 add 时初始化）。
- **扩容因子**：1.5 倍（右移一位）。
- **add 时间复杂度**：均摊 O(1)，最差 O(n)（扩容）。
- **内存占用**：如果可预见元素数量，指定初始容量避免反复扩容。

### ArrayList vs LinkedList

| 操作 | ArrayList | LinkedList |
|------|-----------|-----------|
| 底层 | Object[] | 双向链表 |
| get(i) | **O(1)** | O(n) |
| add(E) | O(1) 均摊 | O(1) |
| add(i,E) | O(n)（移动元素） | **O(n)**（查找位置 O(n) + 插入 O(1)） |
| remove(i) | O(n) | **O(n)** |
| remove(头尾) | O(n) | **O(1)** |
| 内存 | 连续，无额外指针 | 每个节点有 prev/next 指针（24 字节开销） |
| 局部性 | 好（缓存友好） | 差（内存跳跃） |

### 使用建议

- **频繁随机访问**：ArrayList。
- **频繁头尾插入/删除**：LinkedList（或 ArrayDeque）。
- **频繁中间插入/删除**：两个都 O(n)，但 ArrayList 移动元素更高效（System.arraycopy 是 native）。
- **大 List 需要排序**：ArrayList（Arrays.sort），LinkedList 排序需要转为数组。

## TreeMap 与 LinkedHashMap

### TreeMap
- **底层**：红黑树，key 有序。
- **排序**：自然排序（Comparable）或 Comparator。
- **操作**：put/get/remove 均为 O(log n)。
- **适用**：需要有序遍历、范围查询（subMap、headMap、tailMap）。

### LinkedHashMap
- **继承自**：HashMap，维护双向链表记录插入/访问顺序。
- **accessOrder**：false（默认，插入顺序）；true（访问顺序，可用于 LRU 缓存）。
- **实现 LRU**：
  ```java
  class LRUCache<K,V> extends LinkedHashMap<K,V> {
      private final int maxCapacity;
      public LRUCache(int maxCapacity) {
          super(16, 0.75f, true); // accessOrder=true
          this.maxCapacity = maxCapacity;
      }
      @Override
      protected boolean removeEldestEntry(Map.Entry<K,V> eldest) {
          return size() > maxCapacity;
      }
  }
  ```

## fail-fast vs fail-safe

| 机制 | 原理 | 集合示例 | 并发修改 |
|------|------|---------|---------|
| fail-fast | 遍历时检查 modCount 变化，变化则抛 ConcurrentModificationException | ArrayList、HashMap | 不允许 |
| fail-safe | 遍历快照（副本），修改不影响遍历 | CopyOnWriteArrayList、ConcurrentHashMap | 允许（弱一致性） |

```java
// fail-fast 示例
List<String> list = new ArrayList<>(Arrays.asList("A", "B", "C"));
for (String s : list) {
    if (s.equals("B")) {
        list.remove(s); // ❌ ConcurrentModificationException
    }
}

// fail-safe 示例
List<String> copyOnWrite = new CopyOnWriteArrayList<>(Arrays.asList("A", "B", "C"));
for (String s : copyOnWrite) {
    if (s.equals("B")) {
        copyOnWrite.remove(s); // OK
    }
}
```

## 面试高频 Q&A

**Q1: HashMap 为什么要用红黑树而不用 AVL 树？**
- 红黑树插入/删除的平均旋转次数比 AVL 少（AVL 是严格平衡，旋转更多）。
- HashMap 的写入操作多于读取（至少差不多），红黑树的 O(log n) 查询已经足够快。

**Q2: HashMap 的容量为什么一定是 2 的 n 次幂？**
- `hash & (n-1)` 等价于 `hash % n`，位运算效率远高于取模。
- n-1 的二进制全是 1，能均匀分布。

**Q3: ConcurrentHashMap 的 size() 如何实现？**
- JDK 7：先无锁累加两次，不一致再逐个 Segment 加锁统计。
- JDK 8：使用 CounterCell 数组，每个线程更新自己的 CounterCell，最后累加所有 CounterCell 的值 + baseCount。

**Q4: ArrayList 的默认容量为什么是 10？**
- JDK 8+ 使用懒加载，首次 add 时才初始化容量为 10。
- 10 是一个"够用又不浪费"的经验值。

**Q5: 如何解决 HashMap 死循环？**
- JDK 7 多线程并发 put 时头插法会导致循环链表（死循环）。
- JDK 8 改为尾插法 + resize 时保持原顺序，避免了死循环，但仍需使用 ConcurrentHashMap 保证线程安全。

**Q6: 红黑树在什么条件下会退回链表？**
- 扩容时，红黑树拆分后的两个链表如果长度 <= UNTREEIFY_THRESHOLD（6），则退化为链表。
- remove 操作时，如果红黑树节点数太少也会退化。

---