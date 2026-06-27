# Zane's Knowledge Graph · 小陈的知识图谱

个人 Java 后端知识图谱 / 学习平台，基于 Next.js 16 (App Router) 构建，将 Java 后端知识点以分类、章节、思维导图的形式组织呈现。

## 技术栈

- **框架：** Next.js 16.2 (App Router)
- **UI 库：** React 19.2
- **类型：** TypeScript 5
- **样式：** Tailwind CSS v4
- **动画：** framer-motion
- **图标：** lucide-react

## 功能

- **7 大知识分类：** Java 基础、数据库、Redis、Spring、系统设计、RAG、Docker
- **5 级章节体系：** 每个分类按 L1 基础 → L5 实战递进
- **分类详情页** — 章节列表（按级别分组展示）
- **章节详情页** — 正文 + 关键知识点 + 相关章节导航
- **思维导图** — 每个分类独立的可视化树形图，展示知识点全貌（`/[category]/mind-map`）
- **全局知识图谱** — 交互式 SVG 图，展示全量知识点之间的关联（`/graph`）
- **暗色模式** — 通过 `localStorage` 持久化主题偏好

## 路由

| 路由 | 说明 |
|---|---|
| `/` | 首页：分类卡片网格 + 学习路径指引 |
| `/[category]` | 分类详情页，章节按级别分组展示 |
| `/[category]/[chapter]` | 章节内容页，支持 prev/next 导航 |
| `/[category]/mind-map` | 分类思维导图页 |
| `/graph` | 全局知识图谱（SVG 交互式） |

## 思维导图

每个分类均提供独立的左 → 右布局思维导图，自动从章节数据生成 4 层树形结构：

```
分类标题
  ├── L1 基础
  │   └── 章节节点 ── 关键点① 关键点② 关键点③ 关键点④ 关键点⑤
  ├── L2 进阶 → ...
  ├── L3 深入 → ...
  ├── L4 高级 → ...
  └── L5 实战 → ...
```

- **36 节点/页**：1 根节点 + 5 层级标签 + 5 章节节点 + 25 关键点（直接可见）
- 悬停章节节点弹出 tooltip，展示完整章节描述与所有关键点
- 点击章节节点跳转至对应详情页
- 纯 SVG 渲染，零外部依赖

## 数据层

- `src/data/types.ts` — `Category` 和 `Chapter` 接口定义
- `src/data/categories/*.ts` — 7 个分类的定义文件（标题、颜色、图标、章节列表）
- `src/data/index.ts` — 聚合导出、查找辅助函数、级别常量
- `src/data/content/{categoryId}/{chapterId}.md` — 章节正文 Markdown 文件

## 快速开始

```bash
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 即可体验。

## 构建部署

```bash
npm run build
npm run start
```

## 项目结构

```
src/
├── app/
│   ├── layout.tsx            # 全局布局（暗色模式脚本、font）
│   ├── page.tsx              # 首页
│   ├── [category]/
│   │   ├── layout.tsx        # 分类布局（侧边栏）
│   │   ├── page.tsx          # 分类详情页（章节列表）
│   │   ├── mind-map/
│   │   │   └── page.tsx      # 思维导图页
│   │   └── [chapter]/
│   │       └── page.tsx      # 章节内容页
│   └── graph/
│       ├── page.tsx          # 全局知识图谱（服务端）
│       └── graph-client.tsx  # 图谱交互组件（客户端）
├── components/
│   ├── knowledge/
│   │   ├── category-card.tsx   # 首页分类卡片
│   │   ├── chapter-card.tsx    # 章节卡片
│   │   └── category-mind-map.tsx  # 思维导图组件
│   └── layout/
│       ├── header.tsx
│       └── sidebar.tsx
├── data/
│   ├── types.ts
│   ├── index.ts
│   ├── categories/*.ts
│   └── content/              # Markdown 正文
└── lib/
    └── utils.ts              # markdownToHtml、工具函数
```
