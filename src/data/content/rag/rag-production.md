## RAG 评估体系

RAG 系统的评估与纯 LLM 评估不同，需要同时评估检索质量和生成质量。

### RAGAS 评估框架

RAGAS（Retrieval-Augmented Generation Assessment）是目前最流行的 RAG 评估框架，提供了一套标准化的评估指标。

### 核心指标

| 指标 | 衡量对象 | 说明 | 理想值 |
|------|---------|------|-------|
| Faithfulness（忠实度） | 生成 | 答案是否基于检索到的上下文 | > 0.8 |
| Answer Relevance（答案相关度） | 生成 | 答案是否与问题相关 | > 0.8 |
| Context Precision（上下文精度） | 检索 | 检索结果中相关文档的比例 | > 0.7 |
| Context Recall（上下文召回） | 检索 | 所有相关文档被检索到的比例 | > 0.8 |
| Answer Correctness（答案正确性） | 综合 | 答案与标准答案的一致性 | > 0.7 |

### 评估流程

```
评估数据集 (测试集)
     │
     ▼
┌─────────────────┐
│   RAG Pipeline    │  ──→ 问题和上下文作为输入
│   (检索 + 生成)   │  ──→ 生成答案和检索结果
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│   RAGAS 评分      │  ──→ LLM-as-Judge 评分
│   (LLM 评估器)    │  ──→ 逐项计算指标
└────────┬─────────┘
         │
         ▼
┌─────────────────┐
│   评估报告        │  ──→ 指标汇总 + 错误分析
│   (Dashboard)    │
└─────────────────┘
```

### RAGAS 实现

```python
from ragas import evaluate
from ragas.metrics import (
    faithfulness,
    answer_relevancy,
    context_precision,
    context_recall,
)
from datasets import Dataset

# 准备评估数据
eval_data = {
    "question": [
        "什么是 RAG？",
        "向量数据库有哪些？",
        "RAG 和 Fine-tuning 有什么区别？",
    ],
    "answer": [
        "RAG 是检索增强生成技术...",
        "主流向量数据库包括 FAISS、Milvus...",
        "RAG 检索外部知识，Fine-tuning 修改模型参数...",
    ],
    "contexts": [
        ["RAG 是一种检索增强生成技术..."],
        ["FAISS 是 Meta 开源的向量检索库..."],
        ["RAG 通过检索增强生成..."],
    ],
    "ground_truth": [
        "RAG 是检索增强生成（Retrieval-Augmented Generation）的缩写...",
        "主流向量数据库包括 FAISS、Milvus、Pinecone、Qdrant...",
        "RAG 和 Fine-tuning 是两种不同的模型增强方式...",
    ],
}

dataset = Dataset.from_dict(eval_data)
results = evaluate(
    dataset,
    metrics=[
        faithfulness,
        answer_relevancy,
        context_precision,
        context_recall,
    ],
    llm=ChatOpenAI(model="gpt-4o"),  # 评估 LLM
)

print(results)
# {'faithfulness': 0.92, 'answer_relevancy': 0.88, ...}
```

### 自定义评估数据集

构建高质量评估数据集的三种方式：

| 方式 | 优点 | 缺点 | 适用场景 |
|------|------|------|---------|
| 人工标注 | 最准确 | 成本高 | 核心场景 |
| LLM 生成 | 成本低 | 可能有偏差 | 快速评估 |
| 日志回放 | 反映真实场景 | 需要已有系统 | 持续评估 |

## 监控与可观测性

生产环境中的 RAG 系统需要端到端的监控。

### LangSmith 链路追踪

```python
from langsmith import traceable
from langsmith.wrappers import wrap_openai

@traceable(run_type="chain", name="rag_pipeline")
def rag_pipeline(question: str):
    # 1. 检索
    docs = retrieve(question)
    
    # 2. 生成
    answer = generate(question, docs)
    
    return {
        "question": question,
        "retrieved_docs": [d.page_content[:200] for d in docs],
        "answer": answer,
    }

# 自动追踪：延迟、Token 数、检索结果
result = rag_pipeline("什么是 RAG？")
```

### LangFuse（开源替代）

```python
from langfuse import Langfuse
from langfuse.decorators import observe

langfuse = Langfuse()

@observe()
def retrieve(query: str):
    # 自动记录输入、输出、延迟
    return vector_store.similarity_search(query, k=5)

@observe()
def generate(query: str, docs: list):
    # 自动记录 Token 用量
    return llm.invoke(prompt.format(query=query, context=docs))
```

### 关键监控指标

| 指标 | 说明 | 告警阈值 |
|------|------|---------|
| 检索延迟 P95 | ANN 搜索耗时 | > 500ms |
| 生成延迟 P95 | LLM 推理耗时 | > 5s |
| 端到端延迟 P95 | 总耗时 | > 8s |
| 检索空结果率 | 未命中任何文档的比例 | > 5% |
| Token 消耗 | 每请求 Token 数 | 按预算 |
| 用户反馈评分 | 用户点赞/点踩 | < 70% |

## 缓存策略

### Embedding 缓存

相同的 Query 重复计算 Embedding 是一种浪费。

```python
import hashlib
import json
from functools import lru_cache
import redis

cache = redis.Redis(host="localhost", port=6379, db=0)

def get_embedding_with_cache(text: str) -> list[float]:
    key = f"emb:{hashlib.md5(text.encode()).hexdigest()}"
    
    cached = cache.get(key)
    if cached:
        return json.loads(cached)
    
    embedding = client.embeddings.create(
        model="text-embedding-3-small",
        input=text,
    ).data[0].embedding
    
    cache.setex(key, 86400, json.dumps(embedding))  # 缓存 24h
    return embedding
```

### 结果缓存

对高频、固定的 Query 缓存完整结果。

```
缓存策略：
┌────────────────────────────────────────────┐
│   Cache-Aside                              │
│                                            │
│   Query ──→ 查缓存                         │
│               ├── Hit → 直接返回            │
│               └── Miss → 执行 RAG → 写缓存  │
│                                            │
│   缓存淘汰：LRU + TTL（按场景设置 5min-1h）  │
└────────────────────────────────────────────┘
```

## 生产架构

### 推荐架构

```
                            ┌─────────────┐
                            │  用户请求     │
                            └──────┬──────┘
                                   │
                            ┌──────▼──────┐
                            │   API Gateway │
                            │  (限流/鉴权)   │
                            └──────┬──────┘
                                   │
                   ┌───────────────┼───────────────┐
                   │               │               │
            ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
            │ Query 转换   │ │ 检索模块     │ │ 请求缓存     │
            │ (HyDE/多查询)│ │ (ANN+Rerank) │ │ (Redis)     │
            └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
                   │               │               │
                   └───────┬───────┘               │
                           │                       │
                    ┌──────▼──────┐                │
                    │ 上下文压缩   │                │
                    │ (提取/过滤)  │                │
                    └──────┬──────┘                │
                           │                       │
                    ┌──────▼──────┐                │
                    │ LLM 生成    │                │
                    │ (流式输出)   │                │
                    └──────┬──────┘                │
                           │                       │
                    ┌──────▼──────┐                │
                    │ 后处理      │                │
                    │ (引用标注)   │                │
                    └──────┬──────┘                │
                           │                       │
                    ┌──────▼──────┐                │
                    │   响应返回   │◄───────────────┘
                    └─────────────┘
```

### 异步索引 Pipeline

```
文档上传
    │
    ▼
┌──────────────┐
│  消息队列     │ ← 异步削峰
│  (RabbitMQ)  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  文档解析     │ ← PDF/Word/HTML → 纯文本
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  文本分块     │ ← RecursiveCharacterTextSplitter
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  向量化       │ ← Embedding 模型批处理
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  写入向量库   │ ← Milvus/Pinecone 批量插入
└──────────────┘
```

## 成本优化

### Token 成本分析

| 组件 | Token 消耗 | 优化方式 |
|------|-----------|---------|
| Embedding | 输入文本 × 模型 | 使用 smaller 模型，缓存高频 |
| LLM Prompt | 系统提示 + 上下文 + Query | 压缩上下文，减少检索数 |
| LLM Completion | 生成答案 | 控制 max_tokens，短答案优先 |
| Rerank | 交叉编码器推理 | 减少重排序数量 Top-20 → Top-5 |

### 优化策略

1. **选择合适模型**：text-embedding-3-small 比 large 便宜 5 倍
2. **多级缓存**：Embedding 缓存 + Query 结果缓存
3. **动态 Top-K**：简单 Query 少检索，复杂 Query 多检索
4. **上下文压缩**：LLMChainExtractor 减少注入内容
5. **批处理索引**：离线索引使用批处理 Embedding
6. **模型降级**：高负载时切换到更小的 LLM
