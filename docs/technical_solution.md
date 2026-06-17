# 水电表抄表计费与可视化管理平台技术方案
## 架构选型：Node.js + React + MySQL (支持 SQLite/PostgreSQL 快速切换)

本方案旨在将现有的“手写图片识别 + Excel 本地生成 + PDF 计费”流程升级为**工业级、移动端适配的数字化管理平台**。系统支持抄表人员现场手机录入、店铺表计动态管理、历史账期追溯以及后台一键批量生成 PDF。

---

## 一、 系统架构设计

系统采用前后端分离架构，前端适配移动端（手机浏览器、微信内置浏览器），后端提供 RESTful API，并结合现有的 Python PDF 转换引擎进行一键出单。

```
                       ┌─────────────────────────┐
                       │   React 移动端/电脑端   │
                       └────────────┬────────────┘
                                    │ HTTP / JSON
                                    ▼
                       ┌─────────────────────────┐
                       │     Node.js 后端        │
                       │   (Express + Prisma/DB) │
                       └──────┬────────────┬─────┘
                              │            │
         ┌────────────────────▼──┐      ┌──▼────────────────────┐
         │       数据库          │      │     现有的 Python     │
         │ (MySQL / PostgreSQL)  │      │     PDF 计费生成引擎  │
         └───────────────────────┘      └───────────────────────┘
```

### 1. 技术栈选型
* **前端 (Frontend)**：React 18 + Vite + TailwindCSS + Ant Design Mobile (或 Lucide Icons)
  * **选型理由**：Vite 带来极速的开发构建体验；TailwindCSS 原生支持 `sm:`、`md:` 响应式断点，可完美实现“移动端优先”的自适应布局；Ant Design Mobile 提供了专为手机端优化的表单、输入和弹出层组件。
* **后端 (Backend)**：Node.js (Express / NestJS) + Prisma ORM (或 Sequelize)
  * **选型理由**：Node.js 拥有强大的并发处理能力与极佳的开发效率。通过 Prisma ORM，可以极大简化复杂的关联查询（1对多表计），并轻松在 MySQL（主流成熟的生产关系型数据库）与 SQLite / PostgreSQL 之间切换。
* **数据库 (Database)**：**MySQL** (推荐 5.7 或 8.0+)
  * **选型理由**：MySQL 是企业级项目最常用的、极为成熟的开源关系数据库。相比 SQLite，它原生支持高并发写入和完善的用户权限隔离，非常适合作为多抄表员同时在线提交数据时的中央数据仓储。
* **核心混合设计（PDF 引擎复用）**：
  * **核心亮点**：不需要在 Node.js 中用 JS 重新编写繁琐的水电计算、确定性进位（Round-Half-Up）和中文大写人民币转换。
  * **实现方案**：Node.js 后端通过数据组装生成临时 Excel，然后利用 Node.js 的 `child_process` 子进程模块，直接调用已经跑通并验证 100% 准确的 Python 计费脚本：
    ```javascript
    const { exec } = require('child_process');
    exec(`.venv/bin/python3 scripts/generate_billing_pdf.py ${excelPath} ${pdfPath}`);
    ```
    该方案在架构上实现了“专业的事情交给专业的语言去做”，既保证了 Web 平台的快速迭代，又继承了 Python 计算的高精度与可靠性。

---

## 二、 数据库实体模型设计

为了支持**“每个店铺水电表数量可以自由编辑、新增、禁用”**的核心需求，我们采用经典的关系型数据库“1 对多”设计：

### 1. Prisma ORM 实体表达
```prisma
// 1. 商铺实体 (Shops)
model Shop {
  id          Int      @id @default(autoincrement())
  shopCode    String   @unique // 铺面编号，如 "1-2#", "4-5#"
  shopName    String   // 店铺名称，如 "彩票", "新大众"
  laborFee    Float    // 固定水电人工费 (如 30.0, 60.0)
  rubbishFee  Float    // 固定垃圾处理费 (如 50.0, 80.0)
  meters      Meter[]  // 一个店铺拥有多个表计 (1对多关联)
  createdAt   DateTime @default(now())
}

// 2. 表计配置实体 (Meters) - 支持每个商铺自由新增、编辑表计
model Meter {
  id          Int            @id @default(autoincrement())
  shopId      Int
  shop        Shop           @relation(fields: [shopId], references: [id], onDelete: Cascade)
  meterType   String         // 类型: "water" (水表) | "electricity" (电表)
  meterName   String         // 仪表别名: "电表1", "动力电", "水表"
  unitPrice   Float          // 表计独立单价，如电费 1.03, 水费 4.13
  isActive    Boolean        @default(true) // 是否启用 (禁用代表历史表计，不参与当月录入)
  readings    MeterReading[] // 一个表计拥有多条历史抄表记录 (1对多关联)
  createdAt   DateTime       @default(now())
}

// 3. 抄表历史记录实体 (MeterReadings)
model MeterReading {
  id              Int      @id @default(autoincrement())
  meterId         Int
  meter           Meter    @relation(fields: [meterId], references: [id], onDelete: Cascade)
  billingPeriod   String   // 账期格式: "2026-06"
  previousReading Float    // 上期读数 (系统自动从上月带入，不可编辑)
  currentReading  Float?   // 本期读数 (允许为空，为空代表本期未录入)
  readingDate     DateTime?// 抄表人提交时间
  status          String   @default("pending") // 状态: "pending" (待录入) | "completed" (已录入)
}
```

### 2. MySQL 物理表创建 DDL (直接运行建表)
```sql
-- 1. 创建数据库
CREATE DATABASE IF NOT EXISTS meter_billing CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE meter_billing;

-- 2. 创建商铺表 (shops)
CREATE TABLE IF NOT EXISTS shops (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shop_code VARCHAR(50) NOT NULL UNIQUE COMMENT '铺面编号，如 1-2#, 4-5#',
    shop_name VARCHAR(100) NOT NULL COMMENT '店铺名称，如 彩票, 新大众',
    labor_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT '固定水电人工费',
    rubbish_fee DECIMAL(10, 2) NOT NULL DEFAULT 0.00 COMMENT '固定垃圾处理费',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. 创建表计配置表 (meters)
CREATE TABLE IF NOT EXISTS meters (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shop_id INT NOT NULL,
    meter_type VARCHAR(20) NOT NULL COMMENT '类型: water | electricity',
    meter_name VARCHAR(50) NOT NULL COMMENT '别名: 电表1, 备用电, 水表',
    unit_price DECIMAL(10, 4) NOT NULL COMMENT '表计独立单价',
    is_active TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. 创建抄表历史记录表 (meter_readings)
CREATE TABLE IF NOT EXISTS meter_readings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    meter_id INT NOT NULL,
    billing_period VARCHAR(7) NOT NULL COMMENT '账期格式: yyyy-MM (如 2026-06)',
    previous_reading DECIMAL(12, 2) NOT NULL COMMENT '上期读数',
    current_reading DECIMAL(12, 2) DEFAULT NULL COMMENT '本期读数',
    reading_date DATETIME DEFAULT NULL COMMENT '提交日期',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '状态: pending | completed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meter_id) REFERENCES meters(id) ON DELETE CASCADE,
    UNIQUE KEY ukey_meter_period (meter_id, billing_period) COMMENT '限制同一表计在同一账期只能有一条记录'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```


---

## 三、 前端页面设计 (移动端优先)

### 1. 响应式布局规范 (Tailwind CSS)
* 手机端（< 768px）：单栏展示。列表卡片化（Card Layout），点击卡片进入底部滑出表单（Drawer）进行数值录入。
* 电脑端（>= 768px）：侧边栏导航 + 主体网格/表格（Table Layout）。可以直接进行多行快速批量录入与账期统一结算。

### 2. 核心移动端录入界面流
1. **账期与商铺列表页**：
   * 顶部：账期选择器（如 `2026-06` ）。
   * 中部：展示所有商铺列表，并在商铺右侧带有高亮徽标（`4个待录入` / `已完成`），展示录入进度。
2. **表单录入页（商铺详情）**：
   * 抄表人员点击商铺后，系统动态发送 API 请求（`GET /api/shops/:id/readings?period=2026-06`）。
   * 页面根据该商铺下目前 `isActive == true` 的表计数量，**动态渲染表单输入框**。
   * 每个输入框展示：**“仪表名（如：电表2）”**、**“上期读数：1509 (灰色不可编辑)”**、**“本期读数输入框”**。
3. **输入实时防错（核心体验）**：
   * 在输入框失去焦点或点击提交时，React 逻辑进行拦截：
     ```javascript
     if (currentReading < previousReading) {
       Toast.show("错误：本期读数不能小于上期读数！");
       return;
     }
     ```

---

## 四、 后端 RESTful API 接口设计

| 动作 | 请求路径 | 功能描述 |
| :--- | :--- | :--- |
| **商铺管理** | `GET /api/shops` | 获取所有商铺（及关联的表计数量） |
| | `POST /api/shops` | 新增一个商铺 |
| | `PUT /api/shops/:id` | 修改商铺基础费（人工费、垃圾费） |
| **表计管理** | `POST /api/shops/:id/meters` | 核心：为指定店铺**新增**一个电表或水表 |
| | `PUT /api/meters/:id` | 修改表计状态（禁用或编辑单价） |
| **录入接口** | `GET /api/shops/:id/readings` | 动态获取商铺在指定账期（如 `2026-06`）的表计待输入信息 |
| | `POST /api/readings/bulk` | 提交或保存本次抄表录入结果 |
| **一键出单** | `POST /api/export/pdf` | 一键生成该账期所有已录入商铺的 Excel 与 PDF 缴费通知单压缩包 |

---

## 五、 开发实施路线图

1. **第 1 阶段：初始化后端服务**
   * 创建 Express/Node.js 项目，使用 Prisma 配置好本地 SQLite 数据库。
   * 初始化三张表，导入当前 `template.xlsx` 作为初始种子数据（Seed Data）。
2. **第 2 阶段：实现表计后台管理**
   * 编写商铺、表计增删改查的后台 API，实现**“每个店铺水电表可以动态增减”**的业务逻辑。
3. **第 3 阶段：开发 React 移动端录入界面**
   * 使用 React + Vite 快速搭建，利用 Ant Design Mobile 组件库保证手机端的高体验度，确保在施工地/物业抄表人单手即可操作。
4. **第 4 阶段：混合封装 Python 一键 PDF 引擎**
   * 编写 Node.js 导出中间件，将当期录入数据渲染为 `temp.xlsx`，通过 `child_process` 触发 Python 脚本直接输出精美的 PDF 包。
