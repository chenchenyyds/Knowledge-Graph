## 分块策略

文本分块是 RAG 系统中最关键的预处理步骤之一。分块的质量直接影响检索效果。

### 分块策略对比

| 策略 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|---------|
| 固定大小分块 | 按固定字符数切分 | 实现简单，速度快 | 可能切断语义 | 通用文档 |
| 递归分块 | 按层级分隔符递归切分 | 保留语义边界 | 块大小不均匀 | 结构化文档 |
| 语义分块 | 检测语义边界切分 | 语义完整性好 | 计算成本高 | 长文档 |
| 文档结构分块 | 按 Markdown/HTML 标题切分 | 结构清晰 | 依赖格式 | 结构化内容 |
| Agent 分块 | LLM 自动识别切分点 | 最智能 | 成本高，速度慢 | 高质量要求 |

### 固定大小分块

```python
from langchain_text_splitters import CharacterTextSplitter

splitter = CharacterTextSplitter(
    chunk_size=500,       # 每块字符数
    chunk_overlap=50,     # 重叠字符数
    separator="\n",       # 分隔符
    length_function=len,
)
chunks = splitter.split_text(long_text)
```

**问题**：可能切断句子或段落中间，导致语义不完整。

### 递归分块（推荐）

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter

splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
    separators=["\n\n", "\n", "。", "！", "？", ".", "!", "?", "，", ",", " ", ""],
)
chunks = splitter.split_documents(documents)
```

**优势**：优先按段落 → 句子 → 标点 → 字符的优先级切分，尽可能保留语义完整。

### 语义分块

```python
from langchain_experimental.text_splitter import SemanticChunker
from langchain_openai import OpenAIEmbeddings

splitter = SemanticChunker(
    embeddings=OpenAIEmbeddings(),
    breakpoint_threshold_type="percentile",  # 按百分位断点
    breakpoint_threshold_amount=95,          # 相似度低于 95% 分位时断开
)
chunks = splitter.split_documents(documents)
```

### 分块参数调优

```
块大小 → 过小 → 信息不足，生成质量差
       → 过大 → 噪声多，注意力分散
       → 适中 → 根据文档类型调整（代码 300-500，文章 500-1000）

块重叠 → 过小 → 上下文断裂
       → 过大 → 信息冗余
       → 适中 → 重叠 10-20%
```

| 文档类型 | 推荐 Chunk Size | 推荐 Overlap |
|---------|----------------|-------------|
| 代码文档 | 300-500 | 50-100 |
| 新闻文章 | 500-800 | 50-100 |
| 学术论文 | 800-1500 | 100-200 |
| 技术手册 | 500-1000 | 50-150 |

## Query 转换

用户原始 Query 通常不适合直接检索，需要进行转换优化。

### 常见的 Query 转换策略

| 策略 | 描述 | 适用场景 |
|------|------|---------|
| HyDE（假设文档编码） | 先生成假设答案，再用答案检索 | 查询-文档表达不一致 |
| 多查询扩展 | 生成多个相似 Query，合并结果 | 单 Query 覆盖率不够 |
| 回溯提示 | 拆解复杂问题为多个子问题 | 多跳问题 |
| Query 重写 | 用 LLM 改写为更清晰的表述 | 口语化/模糊 Query |

### HyDE（Hypothetical Document Embedding）

核心思想：先让 LLM 根据 Query 生成一个"假设的文档"，然后用这个文档去检索。

```
原始 Query: "怎么配置 Redis 哨兵模式？"
                      │
                      ▼
假设文档生成 ──→ "本文详细介绍了 Redis Sentinel 的配置方法，
(L2 模型)         包括 sentinel.conf 设置、主节点监控、
                 故障转移机制和常见问题排查..."
                      │
                      ▼
用假设文档去检索 ──→ 找到真正相关的文档
```

```python
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate

hyde_prompt = ChatPromptTemplate.from_template("""
请生成一段描述性的文档，该文档包含回答以下问题的完整信息。

问题：{question}

请以客观、详细的方式编写，就好像你已经知道了答案。
直接输出文档内容，不要加额外的说明。
""")

llm = ChatOpenAI(model="gpt-4o-mini")
hypothetical_doc = llm.invoke(hyde_prompt.format(question=query))

# 用假设文档去检索
hyde_vector = embeddings.embed_query(hypothetical_doc.content)
results = vector_store.similarity_search_by_vector(hyde_vector, k=5)
```

### 多查询扩展

```python
from langchain.output_parsers import CommaSeparatedListOutputParser
from langchain.prompts import PromptTemplate

multi_query_prompt = PromptTemplate.from_template("""
你是一个 AI 助手。请根据用户的原始问题，生成 3-5 个不同角度的变体问题，
以提高检索覆盖率。

原始问题：{question}

直接输出问题，每行一个，不要编号。
""")

response = llm.invoke(multi_query_prompt.format(question=query))
queries = [q.strip() for q in response.content.split("\n") if q.strip()]
queries.append(query)  # 包含原始问题

# 合并检索结果
all_docs = []
for q in queries:
    docs = vector_store.similarity_search(q, k=3)
    all_docs.extend(docs)

# 去重
seen = set()
unique_docs = []
for doc in all_docs:
    if doc.page_content not in seen:
        seen.add(doc.page_content)
        unique_docs.append(doc)
```

## Rerank（重排序）

两阶段检索：第一阶段用 ANN 快速召回 Top-100，第二阶段用交叉编码器（Cross-Encoder）精细重排序。

### 为什么需要 Rerank？

```
问题："Redis 的持久化方式有哪些？"

第一阶段（向量检索）召回 Top-10（速度优先）：
  1. "RDB 持久化..."（相关度高）
  2. "AOF 持久化..."（相关度高）
  3. "Redis 数据结构..."（相关度低 ✓ 需要过滤）
  4. "Redis 集群..."（相关度低 ✓ 需要过滤）
  ...

第二阶段（Rerank）重新打分：
  ✓ 把真正相关的结果排在前面
  ✓ 过滤掉低相关度的噪声
  × 增加了额外延迟（通常 50-200ms）
```

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("BAAI/bge-reranker-v2-m3")

# 第一阶段：ANN 召回 Top-100
initial_docs = vector_store.similarity_search(query, k=100)

# 第二阶段：Rerank 重排序
pairs = [[query, doc.page_content] for doc in initial_docs]
scores = reranker.predict(pairs)

# 按得分排序取 Top-5
ranked = sorted(
    zip(initial_docs, scores),
    key=lambda x: x[1],
    reverse=True,
)
top_docs = [doc for doc, score in ranked[:5]]
```

### Rerank 模型对比

| 模型 | 参数量 | 语言 | 特点 |
|------|-------|------|------|
| BAAI/bge-reranker-v2-m3 | 568M | 多语种 | 性价比高 |
| BAAI/bge-reranker-v2-gemma | 2B | 英文为主 | 精度最高 |
| cohere rerank-v3 | - | 多语种 | API 服务 |
| jina-reranker-v2 | - | 多语种 | 支持多模态 |

## Hybrid Search（混合检索）

稠密检索（Dense Retrieval）和稀疏检索（Sparse Retrieval）各有优劣，混合使用可以取长补短。

### Dense vs Sparse

| 维度 | 稠密检索（Dense） | 稀疏检索（Sparse） |
|------|------------------|-------------------|
| 表示方式 | 低维密集向量 | 高维稀疏向量 |
| 语义匹配 | 强（理解同义词/近义） | 弱（关键词匹配） |
| 精确匹配 | 弱（可能漏掉精确词） | 强（精确命中） |
| 少见词 | 可能忽略 | 精确匹配 |
| 计算成本 | 高（向量计算） | 低（倒排索引） |

### 实现方案

```python
from langchain.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever

# 稠密检索（Dense）
dense_retriever = vector_store.as_retriever(search_kwargs={"k": 10})

# 稀疏检索（Sparse - BM25）
sparse_retriever = BM25Retriever.from_documents(docs)
sparse_retriever.k = 10

# 混合检索（Ensemble）
ensemble_retriever = EnsembleRetriever(
    retrievers=[dense_retriever, sparse_retriever],
    weights=[0.7, 0.3],  # Dense 权重更高
)

results = ensemble_retriever.invoke("Redis 持久化配置")
```

### 权重调优

```
权重策略：
  ┌─────────────────────────────────────────────┐
  │  70% Dense + 30% Sparse  ← 推荐的默认值     │
  │  50% Dense + 50% Sparse   适用于精确匹配场景  │
  │  90% Dense + 10% Sparse   适用于语义理解场景  │
  │  100% Sparse              代码/ID 搜索场景   │
  └─────────────────────────────────────────────┘
```

## 上下文压缩

检索到的文档可能包含大量无关信息，需要压缩后注入 Prompt。

```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain.retrievers.document_compressors import LLMChainExtractor

# 提取压缩器
compressor = LLMChainExtractor.from_llm(llm)
compression_retriever = ContextualCompressionRetriever(
    base_compressor=compressor,
    base_retriever=vector_store.as_retriever(),
)

# 自动提取与 Query 相关的片段
compressed_docs = compression_retriever.invoke(query)
# 输出只包含关键信息的片段，而非整篇文档
```
