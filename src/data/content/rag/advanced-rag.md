## Agentic RAG

Agentic RAG 将 RAG 系统与 AI Agent 结合，让系统能够主动思考、调用工具、多步推理，而不仅仅是被动地检索和生成。

### ReAct 模式

ReAct（Reasoning + Acting）让 Agent 交替进行推理和行动：

```
用户: "比较一下 Redis 和 Memcached 的区别"
                      │
                      ▼
┌────────────────────────────────────────┐
│  Thought: 用户想知道两者的区别，        │
│  我需要先检索 Redis 相关的文档，         │
│  再检索 Memcached 相关的文档。         │
│                                        │
│  Action: retrieve(query="Redis")       │
│  Observation: [Redis 相关文档]          │
│                                        │
│  Action: retrieve(query="Memcached")   │
│  Observation: [Memcached 相关文档]      │
│                                        │
│  Thought: 现在我有两种技术的文档了，     │
│  可以生成对比分析。                     │
│                                        │
│  Action: generate(comparison)          │
│  Observation: 对比结果                  │
│                                        │
│  Final: 输出对比答案                    │
└────────────────────────────────────────┘
```

### LangGraph 实现

```python
from langgraph.graph import StateGraph, MessagesState
from langgraph.prebuilt import ToolNode
from langchain_community.tools import WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper
from langchain_core.messages import SystemMessage
from typing import Literal

# 定义检索工具
@tool
def retrieve_docs(query: str) -> str:
    """从知识库中检索相关文档"""
    docs = vector_store.similarity_search(query, k=3)
    return "\n\n".join([d.page_content for d in docs])

# 构建 Agent 图
tools = [retrieve_docs]
tool_node = ToolNode(tools)

def should_continue(state: MessagesState) -> Literal["tools", "end"]:
    messages = state["messages"]
    last = messages[-1]
    return "tools" if last.tool_calls else "end"

def call_model(state: MessagesState):
    messages = state["messages"]
    response = llm_with_tools.invoke(messages)
    return {"messages": [response]}

# 编译图
graph = StateGraph(MessagesState)
graph.add_node("agent", call_model)
graph.add_node("tools", tool_node)
graph.add_edge("agent", "tools", conditional=should_continue)
graph.add_edge("tools", "agent")
graph.set_entry_point("agent")
app = graph.compile()

# 执行
result = app.invoke({
    "messages": [
        SystemMessage(content="你是一个 RAG 助手，可以检索知识库回答问题。"),
        HumanMessage(content="Redis 和 Memcached 有什么区别？"),
    ]
})
```

### Agentic RAG 的优势

| 特性 | 传统 RAG | Agentic RAG |
|------|---------|-------------|
| 多步推理 | 单次检索 + 生成 | 多轮检索 + 推理 |
| 工具调用 | 仅检索 | 检索 + 计算 + API + 数据库 |
| 问题分解 | 不支持 | 自动分解复杂问题 |
| 循环修正 | 不支持 | 可循环检索直到满意 |
| 状态管理 | 无状态 | 有状态（上下文记忆） |

## Graph RAG

Graph RAG 使用知识图谱（而非向量库）来组织和检索信息，特别适合处理多跳关系和全局性问题。

### 与向量 RAG 的区别

```
向量 RAG:
  文档 → 分块 → 向量 → ANN 检索
  优点：语义相似度匹配
  缺点：难以处理多跳关系

Graph RAG:
  实体 → 关系 → 图结构 → 图遍历检索
  优点：关系推理、全局理解
  缺点：需要实体抽取，构建成本高
```

### 构建流程

```
原始文档
    │
    ▼
┌──────────────────┐
│  Entity Extraction│  ──→ LLM 抽取实体和关系
│  (LLM)           │      例：(Redis, 是, 内存数据库)
└────────┬─────────┘       (Redis, 支持, 持久化)
         │
         ▼
┌──────────────────┐
│  Knowledge Graph  │  ──→ Neo4j / NetworkX
│  (图存储)         │      实体 = 节点，关系 = 边
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Community        │  ──→ Leiden 算法聚类
│  Detection        │      "缓存技术社区"
└────────┬─────────┘      "NoSQL 社区"
         │
         ▼
┌──────────────────┐
│  Graph Retrieval  │  ──→ 根据问题类型选择
│  (图检索)         │      检索策略
└──────────────────┘
```

### 图检索策略

```python
# 使用 NetworkX 构建简单图
import networkx as nx

G = nx.Graph()

# 添加实体和关系
entities = [
    ("Redis", {"type": "database", "desc": "内存数据库"}),
    ("Memcached", {"type": "database", "desc": "分布式缓存"}),
    ("持久化", {"type": "concept", "desc": "数据持久存储"}),
]
G.add_nodes_from(entities)

relations = [
    ("Redis", "Memcached", {"relation": "competitor"}),
    ("Redis", "持久化", {"relation": "supports"}),
]
G.add_edges_from(relations)

# 检索：实体扩展 + 邻居实体
def graph_retrieve(query: str, hops: int = 2):
    # 1. 识别问题中的实体
    entities = extract_entities(query)
    
    # 2. 图遍历扩展
    results = set()
    for entity in entities:
        if entity in G:
            # 获取邻居及其邻居
            neighbors = nx.single_source_shortest_path_length(
                G, entity, cutoff=hops
            )
            results.update(neighbors.keys())
    
    return list(results)
```

### 全局搜索 vs 局部搜索

```
局部搜索（具体问题）:
  问题: "Redis 支持哪些持久化方式？"
  策略: 从 Redis 节点出发，遍历关联的持久化节点
  结果: RDB、AOF、混合持久化

全局搜索（综合问题）:
  问题: "缓存技术有哪些选型？"
  策略: 检索"缓存"社区的所有实体和关系
  结果: Redis、Memcached、Local Cache、CDN ...
```

## 多模态 RAG

将 RAG 从纯文本扩展到图片、表格、音视频等多模态内容。

### 架构方案

```
多模态文档（PDF/图片/视频）
    │
    ├── 文本提取 ──→ 文本 Embedding ──→ 文本向量库
    │
    ├── 图片提取 ──→ 多模态 Embedding ──→ 图片向量库
    │                    │
    │              ┌─────┴─────┐
    │              │ CLIP /    │
    │              │ SigLIP    │
    │              └───────────┘
    │
    └── 表格提取 ──→ 结构化存储 ──→ SQL/CSV 查询
```

### 图片检索方案

```python
# 方案一：使用图片描述（成本低）
from langchain.chains import LLMChain

def image_to_text(image_path: str) -> str:
    """用多模态 LLM 生成图片描述"""
    response = multi_modal_llm.invoke([
        {"type": "text", "text": "请详细描述这张图片的内容"},
        {"type": "image", "image": image_path},
    ])
    return response.content

# 图片描述 → 文本检索
image_desc = image_to_text("architecture_diagram.png")
image_doc = Document(page_content=image_desc, metadata={"source": "architecture_diagram.png"})
vector_store.add_documents([image_doc])

# 方案二：多模态 Embedding（精度高）
from sentence_transformers import SentenceTransformer

# 使用 CLIP 多模态模型
clip_model = SentenceTransformer("clip-ViT-B-32")
text_emb = clip_model.encode("系统架构图")
image_emb = clip_model.encode("architecture_diagram.png")

# 在同一个向量空间直接检索
```

### 表格检索

表格数据的检索是一个特殊挑战，常见方案：

| 方案 | 方法 | 优点 | 缺点 |
|------|------|------|------|
| 文本序列化 | 表格 → Markdown 文本 | 简单 | 丢失结构信息 |
| 结构化描述 | 表格 → 自然语言描述 | 检索效果好 | 生成成本高 |
| 混合索引 | 文本 + 元数据过滤 | 准确 | 实现稍复杂 |
| Table-aware | 专门表格检索模型 | 精度最高 | 生态不成熟 |

```python
# 表格 → 文本描述
def table_to_description(table_data: dict) -> str:
    prompt = f"""
    将以下表格转换为便于检索的自然语言描述：
    
    表名：{table_data['name']}
    列：{', '.join(table_data['columns'])}
    前 3 行数据：
    {table_data['sample_rows'][:3]}
    
    请用一段话总结这个表格的内容和用途。
    """
    return llm.invoke(prompt).content
```

## Streaming RAG

实时流式输出对于用户体验至关重要。

```python
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
import asyncio

app = FastAPI()

@app.post("/rag/stream")
async def rag_stream(question: str):
    async def generate():
        # 1. 检索阶段（快速）
        yield f"data: {{\"type\": \"status\", \"message\": \"正在检索...\"}}\n\n"
        docs = await asyncio.to_thread(vector_store.similarity_search, question)
        yield f"data: {{\"type\": \"status\", \"message\": \"已检索到 {len(docs)} 篇文档\"}}\n\n"
        
        # 2. 生成阶段（流式）
        context = "\n\n".join([d.page_content for d in docs])
        stream = llm.stream(prompt.format(context=context, question=question))
        
        async for chunk in stream:
            yield f"data: {{\"type\": \"token\", \"content\": \"{chunk.content}\"}}\n\n"
        
        # 3. 标注引用（最后）
        yield f"data: {{\"type\": \"done\", \"sources\": {source_list}}}\n\n"
    
    return StreamingResponse(generate(), media_type="text/event-stream")
```

## Corrective RAG 与 Self-RAG

### Corrective RAG（CRAG）

自动检测检索结果质量，决定是否修正。

```
检索结果
    │
    ▼
┌────────────┐
│  质量评估   │ ← LLM 判断检索结果是否足够
│  (Judge)   │
└─────┬──────┘
      │
  ┌───┼───┐
  │   │   │
  ▼   ▼   ▼
可信 模糊 不可信
  │   │   │
  │   ▼   │
  │ 保留  │
  │   │   │
  │   ▼   │
  │ 补充  └──→ Web 搜索
  │ 检索       / 重写 Query
  │   │
  ▼   ▼
LLM 生成
```

### Self-RAG

Self-RAG 让模型在生成过程中自我反思，动态决定是否检索。

```
生成过程：
  Token 1: "Redis 是" → 反思：需要引用吗？
    决定：需要 → 检索 → 继续生成
  Token 2: "内存数据库" → 反思：可信吗？  
    决定：可信 → 继续
  Token 3: "支持 5 种" → 反思：需要引用吗？
    决定：不需要 → 直接生成
  ...

优点：
  ✓ 只在需要时检索，节省成本
  ✓ 生成过程中自我纠错
  × 需要专门的训练或精心设计的 Prompt
```

### 实现对比

| 模式 | 检索时机 | 纠错机制 | 实现复杂度 |
|------|---------|---------|-----------|
| Naive RAG | 固定 | 无 | 低 |
| CRAG | 固定 + 后验评估 | 自动修正检索 | 中 |
| Self-RAG | 动态按需 | 生成时自我纠正 | 高 |
| Agentic RAG | 多轮灵活 | 多步推理验证 | 高 |
