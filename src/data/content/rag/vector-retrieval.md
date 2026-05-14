## Embedding 模型

Embedding 模型将文本映射到高维向量空间，语义相近的文本在向量空间中距离也相近。它是 RAG 系统的核心基础。

### 模型选型

| 模型 | 维度 | 上下文长度 | 特点 | 适用场景 |
|------|------|-----------|------|---------|
| text-embedding-3-small | 1536 | 8191 | 性价比高，支持变长维度 | 通用场景 |
| text-embedding-3-large | 3072 | 8191 | 精度最高，支持变长维度 | 高精度场景 |
| bge-large-zh-v1.5 | 1024 | 512 | 中文优化，开源免费 | 中文场景 |
| m3e-large | 1024 | 512 | 中文嵌入，多语种支持 | 中英混合场景 |
| jina-embeddings-v3 | 1024 | 8192 | 支持任务特定向量 | 多任务场景 |
| gte-Qwen2-7B | 3584 | 8192 | 大模型级别嵌入 | 强语义理解 |

```python
# OpenAI Embedding
from openai import OpenAI

client = OpenAI()
response = client.embeddings.create(
    model="text-embedding-3-small",
    input="什么是 RAG？",
    dimensions=512,  # 可压缩维度，节省存储
)
vector = response.data[0].embedding
print(f"Vector dimension: {len(vector)}")  # 512

# 批量处理
texts = ["文档1的内容", "文档2的内容", "文档3的内容"]
response = client.embeddings.create(
    model="text-embedding-3-small",
    input=texts,
)
vectors = [data.embedding for data in response.data]
```

### 衡量指标

- **MTEB**（Massive Text Embedding Benchmark）：综合评估排行榜
- **C-MTEB**：中文嵌入模型排行榜
- **维度与效果**：一般来说维度越高精度越好，但存储和计算成本也越高

## 向量数据库

向量数据库专门用于存储和检索高维向量，支持高效的 ANN（Approximate Nearest Neighbor）搜索。

### 主流方案对比

| 特性 | FAISS | Milvus | Pinecone | Qdrant | Weaviate |
|------|-------|--------|----------|--------|----------|
| 部署方式 | 嵌入式/本地 | 分布式 | 云托管 | 自托管/云 | 自托管/云 |
| 索引类型 | IVF/HNSW/Flat | IVF/HNSW/FLAT | HNSW | HNSW | HNSW |
| 元数据过滤 | 有限 | 丰富 | 丰富 | 丰富 | 丰富 |
| 分布式 | ❌ | ✅ | ✅ | ✅ | ✅ |
| 实时更新 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 中文社区 | 一般 | 活跃 | 一般 | 一般 | 一般 |
| 适用规模 | 百万级 | 十亿级 | 亿级 | 千万级 | 千万级 |

### FAISS 快速上手

```python
import faiss
import numpy as np
from openai import OpenAI

client = OpenAI()

# 准备数据
texts = ["RAG 是一种检索增强技术", "向量数据库用于相似度搜索", "Embedding 将文本转为向量"]
response = client.embeddings.create(model="text-embedding-3-small", input=texts)
vectors = np.array([data.embedding for data in response.data]).astype("float32")

# 构建索引（HNSW）
dimension = vectors.shape[1]
index = faiss.IndexHNSWFlat(dimension, 32)  # 32 个邻居
index.add(vectors)
print(f"Index size: {index.ntotal}")

# 检索
query_vec = client.embeddings.create(
    model="text-embedding-3-small",
    input=["检索技术有哪些"],
).data[0].embedding

query_vec = np.array([query_vec]).astype("float32")
distances, indices = index.search(query_vec, k=2)

for i, idx in enumerate(indices[0]):
    print(f"Rank {i+1}: {texts[idx]} (distance: {distances[0][i]:.3f})")
```

### Milvus 快速上手

```python
from pymilvus import connections, Collection, CollectionSchema, FieldSchema, DataType

# 连接
connections.connect(host="localhost", port="19530")

# 定义 Schema
fields = [
    FieldSchema(name="id", dtype=DataType.INT64, is_primary=True),
    FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=1000),
    FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=1536),
]
schema = CollectionSchema(fields)
collection = Collection("rag_docs", schema)

# 创建索引
index_params = {
    "index_type": "IVF_FLAT",
    "metric_type": "IP",
    "params": {"nlist": 128},
}
collection.create_index("embedding", index_params)

# 检索
search_params = {"metric_type": "IP", "params": {"nprobe": 10}}
results = collection.search(
    data=[query_vector],
    anns_field="embedding",
    param=search_params,
    limit=5,
)
```

## 相似度计算

### 主流算法

| 算法 | 公式 | 范围 | 特点 |
|------|------|------|------|
| 余弦相似度 | cos(A,B) = A·B / (∥A∥ ∥B∥) | [-1, 1] | 关注方向，不关心模长 |
| 点积（IP） | A·B = Σai·bi | (-∞, +∞) | 速度快，需归一化 |
| 欧氏距离 | d(A,B) = √Σ(ai-bi)² | [0, +∞) | 越小越相似 |
| 曼哈顿距离 | d(A,B) = Σ|ai-bi| | [0, +∞) | 鲁棒性较好 |

```python
import numpy as np

def cosine_similarity(a, b):
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

def dot_product(a, b):
    return np.dot(a, b)

def euclidean_distance(a, b):
    return np.linalg.norm(a - b)

# 归一化后点积 = 余弦相似度
def normalized_dot_product(a, b):
    a_norm = a / np.linalg.norm(a)
    b_norm = b / np.linalg.norm(b)
    return np.dot(a_norm, b_norm)

# 实践建议：使用 IP（内积）索引 + 向量归一化
# 这样既能享受点积的速度，又能得到余弦相似度的效果
```

## ANN 搜索算法

### HNSW（Hierarchical Navigable Small World）

目前最流行的 ANN 算法，在速度和精度之间取得最佳平衡。

```
Level 2:     [A]─────────────────[E]
               │                   │
Level 1:   [A]──[C]──[E]    [D]──[F]
               │    │        │
Level 0: [A]─[B]─[C]─[E]─[D]─[F]─[G]
```

**特点：**
- 多层图结构，上层是"高速公路"，下层是"本地街道"
- 搜索时从上到下，先粗筛再精细
- 时间复杂度 O(log n)

### IVF（Inverted File Index）

```
           ┌── Cluster 1: [A, B, C]
Centroids ─┼── Cluster 2: [D, E, F]
           └── Cluster 3: [G, H, I]
```

**特点：**
- K-Means 聚类，搜索时只查最近的 N 个聚类
- nprobe 参数控制搜索范围（越大越精确，越慢）

### 参数对比

| 算法 | 建索引时间 | 搜索速度 | 内存占用 | 召回率 |
|------|-----------|---------|---------|-------|
| Flat（暴力） | 无 | 最慢 | 最低 | 100% |
| IVF-FLAT | 中等 | 快 | 中等 | ~95% |
| HNSW | 慢 | 最快 | 较高 | ~99% |
| IVF-PQ | 快 | 极快 | 低（压缩） | ~85% |
