## 什么是 RAG？

RAG（Retrieval-Augmented Generation，检索增强生成）是一种通过**检索外部知识库**来增强大语言模型（LLM）生成质量的技术范式。它在 LLM 生成答案之前，先从知识库中检索相关文档，将检索结果作为上下文注入 Prompt，让模型基于真实信息生成回答。

### 核心思想

```
用户 Query
    │
    ▼
┌─────────────────────┐
│    Query 编码        │  ──→  Embedding 模型
│    (向量化)          │
└────────┬────────────┘
         │ query vector
         ▼
┌─────────────────────┐
│   向量检索            │  ──→ ANN 搜索 Top-K
│   (Vector DB)        │
└────────┬────────────┘
         │ relevant docs
         ▼
┌─────────────────────┐
│   Prompt 拼接         │  ──→ 原始 Query + 检索文档
│   (Context 注入)      │
└────────┬────────────┘
         │ augmented prompt
         ▼
┌─────────────────────┐
│   LLM 生成           │  ──→ 基于上下文生成答案
│   (Generation)       │
└────────┬────────────┘
         │ final answer
         ▼
       用户
```

### 为什么需要 RAG？

| 问题 | 传统 LLM | RAG 方案 |
|------|---------|----------|
| 知识截止 | 训练数据有截止日期 | 实时检索最新信息 |
| 幻觉问题 | 可能编造事实 | 基于检索结果回答，可溯源 |
| 领域知识 | 通用知识，缺乏专业深度 | 注入企业私有知识库 |
| 知识更新 | 需要重训模型 | 只需更新检索库 |
| 可解释性 | 黑盒输出 | 可展示引用来源 |

## Naive RAG 三阶段流程

### 阶段一：Indexing（索引构建）

离线阶段，将原始文档处理为可检索的索引：

1. **文档解析**：PDF/HTML/Word → 纯文本
2. **文本分块**：将长文本切分为语义完整的 Chunk
3. **向量化**：使用 Embedding 模型将 Chunk 转为向量
4. **索引存储**：向量 + 元数据写入 Vector DB

```python
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import FAISS

# 1. 加载文档
loader = PyPDFLoader("company_handbook.pdf")
docs = loader.load()

# 2. 文本分块
splitter = RecursiveCharacterTextSplitter(
    chunk_size=500,
    chunk_overlap=50,
)
chunks = splitter.split_documents(docs)

# 3. 向量化 + 存储
embeddings = OpenAIEmbeddings(model="text-embedding-3-small")
vector_store = FAISS.from_documents(chunks, embeddings)
```

### 阶段二：Retrieval（检索）

在线阶段，根据用户 Query 召回相关文档：

1. **Query 编码**：用相同 Embedding 模型将 Query 转为向量
2. **ANN 搜索**：在向量库中搜索最相似的 Top-K 向量
3. **结果排序**：按相似度得分排序
4. **元数据过滤**：按时间、类别等条件过滤

```python
# 检索 Top-3 相关文档
query = "公司年假政策是什么？"
retrieved_docs = vector_store.similarity_search_with_score(
    query,
    k=3,
    filter={"category": "HR"},
)

for doc, score in retrieved_docs:
    print(f"Score: {score:.3f} | {doc.page_content[:50]}...")
```

### 阶段三：Generation（生成）

将检索结果注入 Prompt，让 LLM 生成答案：

```python
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate

prompt = ChatPromptTemplate.from_template("""
你是一个智能问答助手。请基于以下检索到的上下文信息回答用户问题。

上下文：
{context}

用户问题：{question}

要求：
1. 如果上下文不足以回答问题，请明确说明
2. 在答案末尾标注引用来源
3. 使用中文回答

答案：
""")

llm = ChatOpenAI(model="gpt-4o-mini", temperature=0)

# 拼接上下文
context = "\n\n---\n\n".join([
    f"[来源{i+1}] {doc.page_content}"
    for i, (doc, _) in enumerate(retrieved_docs)
])

response = llm.invoke(prompt.format(
    context=context,
    question=query,
))
print(response.content)
```

## RAG vs Fine-tuning

| 维度 | RAG | Fine-tuning |
|------|-----|-------------|
| 知识源 | 外部知识库，动态更新 | 模型参数，静态存储 |
| 更新成本 | 只需更新索引库 | 需要重新训练部署 |
| 幻觉控制 | 强（可溯源） | 弱（模型记忆偏差） |
| 推理成本 | 较高（检索 + 生成） | 较低（纯生成） |
| 开发门槛 | 低（无需训练） | 高（需要训练工程） |
| 适用场景 | 知识问答、客服、文档分析 | 风格迁移、指令遵循、代码生成 |

### 组合使用

实际生产中最优方案往往是 **RAG + Fine-tuning** 组合：

```
    Fine-tuned LLM（指令遵循能力）
           │
    ┌──────┴──────┐
    │   RAG Pipeline  │
    │  (检索外部知识)  │
    └──────┬──────┘
           │
    ┌──────┴──────┐
    │   Post-processing │
    │  (引用标注/过滤)  │
    └──────┬──────┘
           ▼
     最终答案
```

- **Fine-tuning**：让模型学会更好的指令遵循和输出格式
- **RAG**：提供最新的、私域的、可验证的知识
- 两者互补，非替代关系

## 应用场景

| 场景 | 说明 |
|------|------|
| 企业知识库问答 | 内部文档、制度、手册的智能问答 |
| 客服系统 | 基于产品文档的自动回复 |
| 医疗辅助 | 检索医学文献辅助诊断建议 |
| 法律咨询 | 基于法规库的智能问答 |
| 代码文档 | 检索 API 文档生成代码示例 |
| 教育辅导 | 基于教材的个性化答疑 |
