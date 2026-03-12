# AST SYSTEM / TRL-X 微信小程序

一个基于微信小程序原生框架 + 微信云开发实现的越野赛事与配速计划系统。

项目当前覆盖两类核心场景：

- 用户侧：浏览赛事、查看组别详情、输入目标完赛时间、生成分段计划、保存计划、查看历史计划、模拟同步到手表
- 管理侧：创建赛事、编辑赛事、上传封面图/路线图/GPX、调用云函数自动解析 GPX 并回填赛事数据

## 项目定位

这个项目更接近一个“可运行的业务原型”：

- 前端页面完整，主流程已经串起来
- 依赖微信云开发数据库和云函数
- 已经具备 GPX 解析、计划生成、图片导出、云端保存等核心能力
- 仍有少量原型级实现，适合继续迭代，不建议不加改造直接上线生产

## 核心功能

- 赛事列表展示，按日期排序并过滤未来赛事
- 赛事详情展示，支持多组别切换
- 根据目标完赛时间生成 CP 分段计划
- 支持多发枪时间切换
- 支持统一休息时间或逐段手动调整
- 支持关门时间超时判断
- 支持计划保存到云数据库
- 支持“我的计划”按未来/历史拆分展示
- 支持导出长图到系统相册
- 支持模拟蓝牙设备连接与同步
- 支持后台创建/编辑/删除赛事
- 支持上传 GPX 并异步解析距离、爬升、CP 数据

## 技术栈

- 微信小程序原生框架
- 微信云开发 `wx.cloud`
- 云数据库
- 云函数 `wx-server-sdk`
- 原生 Canvas 绘制海拔图和分享长图

项目没有引入额外前端框架，也没有顶层 `package.json`。依赖主要在云函数目录内维护。

## 项目结构

```text
.
├─app.js                         小程序入口，初始化云环境
├─app.json                       页面与全局窗口配置
├─images/                        图标与二维码资源
├─pages/
│  ├─index/                      首页
│  ├─race-list/                  赛事列表
│  ├─race-detail/                赛事详情 + 计划入口
│  ├─plan-result/                计划结果页
│  ├─my-plans/                   我的计划
│  ├─ble-connect/                蓝牙连接页（当前为模拟）
│  ├─login/                      登录 / 注册
│  ├─profile/                    个人中心
│  ├─admin-race-add/             新建 / 编辑赛事
│  └─admin-race-list/            管理后台赛事列表
├─cloudfunctions/
│  ├─parseGpx/                   GPX 解析测试云函数
│  └─syncGpxToDb/                GPX 解析并回写数据库
└─utils/                         预留工具目录
```

## 页面说明

### 1. 首页 `pages/index`

职责：

- 展示当前设备连接状态
- 展示已导入的计划（最多 3 条）
- 展示云端赛事列表

主要行为：

- 读取 `races` 集合，按日期排序后仅展示今天及未来赛事
- 读取 `user_plans` 集合，展示即将参赛的计划
- 根据 `app.globalData.isConnected` 显示设备连接状态

### 2. 赛事列表 `pages/race-list`

职责：

- 展示全部赛事
- 点击后进入赛事详情页

### 3. 赛事详情 `pages/race-detail`

职责：

- 展示赛事基础信息、封面、地点、ITRA 标识
- 在多个组别之间切换
- 查看组别距离、爬升、关门时间、路线图
- 输入目标完赛时间后跳转至计划结果页

计划生成前置条件：

- 当前组别必须已经有 `checkpoints`
- 用户至少输入小时或分钟其中之一

### 4. 计划结果 `pages/plan-result`

职责：

- 读取赛事 CP 数据并计算每段用时
- 根据发枪时间推导每个 CP 的到达/离开时间
- 计算实际配速与等效配速
- 判断关门时间是否超时
- 支持保存计划、导出长图、模拟同步到手表

主要特性：

- 支持统一调整全局休息时间
- 支持逐段手动调整移动时间和休息时间
- 支持查看分段海拔图
- 支持保存图片到相册
- 支持保存到 `user_plans`

### 5. 我的计划 `pages/my-plans`

职责：

- 从 `user_plans` 中读取当前用户计划
- 按 `raceDateMs` 拆分为未来计划和历史计划

### 6. 蓝牙连接 `pages/ble-connect`

职责：

- 展示设备列表
- 模拟扫描与连接流程

当前实现说明：

- 设备列表为写死的假数据
- 连接流程由 `setTimeout` 模拟
- 成功后只会修改全局状态，不会进行真实 BLE 通信

### 7. 登录/注册 `pages/login`

职责：

- 登录：查询 `users` 集合中的账号密码
- 注册：向 `users` 集合新增用户

当前实现说明：

- 账号密码为明文存储
- 登录校验发生在前端直接查库
- 这是原型方案，生产环境必须替换

### 8. 个人中心 `pages/profile`

职责：

- 展示登录状态
- 提供登录入口
- 提供管理后台入口

### 9. 管理后台新增/编辑赛事 `pages/admin-race-add`

职责：

- 新建赛事基础信息
- 配置多个组别
- 上传赛事封面、组别路线图、GPX 文件
- 保存赛事到 `races`
- 对新上传 GPX 的组别异步调用 `syncGpxToDb`

### 10. 管理后台赛事列表 `pages/admin-race-list`

职责：

- 读取全部赛事
- 进入编辑模式
- 删除赛事

## 云函数说明

### `cloudfunctions/parseGpx`

用途：

- 下载 GPX 文件
- 解析轨迹点 `trkpt`
- 解析路标点 `wpt`
- 计算总距离、累计爬升、累计下降
- 生成草稿版 checkpoint 数据并返回前端

特点：

- 主要适合调试或单独验证 GPX 解析效果
- 当前不会回写数据库

### `cloudfunctions/syncGpxToDb`

用途：

- 下载并解析指定组别的 GPX
- 根据 WPT 名称顺序匹配轨迹位置
- 生成组别 `checkpoints`
- 计算 `actualDist`、`elevation`
- 回写到 `races.groups[groupIndex]`

额外能力：

- 抽取分段原始海拔点 `rawPoints`
- 生成轻量海拔 `svgProfile`
- 支持从路标名称末尾提取关门时间，例如 `CP3-16:00`

## GPX 约定

为保证解析稳定，建议 GPX 文件满足以下约定：

- 轨迹点使用标准 `trkpt`
- 路标点使用标准 `wpt`
- 起终点命名建议使用 `START` / `FINISH`
- 检查点命名建议使用 `CP1`、`CP2`、`CP3`
- 换装点命名建议使用 `DP1`、`DP2`
- 如果需要自动识别关门时间，可在点名末尾追加 `-HH:mm`

例如：

```text
START
CP1
DP1
CP3-16:00
FINISH
```

如果 GPX 中没有有效的 WPT 或命名不规范，计划页可能无法生成可用的 CP 数据。

## 数据模型

### 1. `races`

赛事主表。

示例结构：

```json
{
  "_id": "race_doc_id",
  "name": "2026 某某越野赛",
  "location": "浙江 湖州",
  "date": "2026-10-01",
  "hasItra": true,
  "coverImg": "cloud://.../race-covers/xxx.png",
  "tags": [
    { "dist": "50km", "color": "#36E153" },
    { "dist": "100km", "color": "#FF9811" }
  ],
  "groups": [
    {
      "dist": "50km",
      "cutoffTime": "14小时",
      "themeColor": "#36E153",
      "startTime": "07:00",
      "startTime2": "07:30",
      "detailMapImg": "cloud://.../race-maps/xxx.png",
      "gpxFileID": "cloud://.../gpx-tracks/xxx.gpx",
      "actualDist": "52.4km",
      "elevation": "3120m+ / 2980m-",
      "checkpoints": []
    }
  ],
  "createTime": "serverDate",
  "updateTime": "serverDate"
}
```

`groups[].checkpoints` 中常见字段：

- `name`: CP 名称
- `accDist`: 累计距离（km）
- `accGain`: 累计爬升（m）
- `accLoss`: 累计下降（m）
- `segDist`: 分段距离（km）
- `segGain`: 分段爬升（m）
- `segLoss`: 分段下降（m）
- `tempEle`: 点位海拔
- `rawPoints`: 分段海拔原始点
- `svgProfile`: 分段海拔 SVG
- `cutoffTime`: 关门时间
- `isDropBag`: 是否换装点

### 2. `user_plans`

用户保存的赛事计划。

示例结构：

```json
{
  "_id": "plan_doc_id",
  "raceId": "race_doc_id",
  "raceName": "2026 某某越野赛 - 50km",
  "groupDist": "50km",
  "raceDate": "2026-10-01",
  "raceDateMs": 1790784000000,
  "startTime": "07:00",
  "targetHours": 10,
  "targetMinutes": 30,
  "checkpoints": [],
  "createTime": "serverDate",
  "updateTime": "serverDate"
}
```

当前保存逻辑会按照 `raceId + groupDist` 查重，命中后更新，未命中则新增。

### 3. `users`

用户账号表。

示例结构：

```json
{
  "_id": "user_doc_id",
  "username": "demo",
  "password": "123456",
  "role": "user",
  "createdAt": "serverDate"
}
```

`role` 可用于区分普通用户和管理员，但当前前端入口控制仍不严。

## 计划生成逻辑

计划页的核心思路不是简单均速，而是基于“等效距离 + 疲劳指数”分配每段用时。

关键逻辑：

1. 每段等效距离 `segED = segDist + segGain / 100`
2. 累计等效距离 `totalED = sum(segED)`
3. 目标总时间减去休息时间，得到总移动时间 `movingMins`
4. 使用疲劳指数 `K = 1.07` 分配每段移动时间
5. 再叠加发枪时间和每站休息时间，得到到达/离开时间
6. 如果 CP 配有 `cutoffTime`，则与推导到达时间比较，判断是否超时

这套算法适合作为越野赛事的配速草案，但不是医学或训练学意义上的严格模型。

## 运行环境与启动方式

### 前置条件

- 安装微信开发者工具
- 小程序基础库版本支持云开发
- 已开通微信云开发环境

当前仓库内可见的配置：

- 小程序 AppID：`wx4bb1c2c6c6358eda`
- 云环境 ID：`cloud1-8g7flmwwa4402751`
- 云函数根目录：`cloudfunctions/`

### 启动步骤

1. 使用微信开发者工具打开项目根目录
2. 检查并按需修改 `app.js` 中的云环境 ID
3. 检查并按需修改 `project.config.json` 中的 `appid`
4. 进入两个云函数目录安装依赖
5. 在开发者工具中上传并部署云函数
6. 创建数据库集合并配置权限
7. 导入测试数据后运行小程序

### 云函数依赖安装

在项目根目录执行：

```powershell
cd cloudfunctions\parseGpx
npm install
cd ..\syncGpxToDb
npm install
```

或者直接在微信开发者工具中对每个云函数执行“上传并部署：云端安装依赖”。

### 云函数部署

需要部署的函数：

- `parseGpx`
- `syncGpxToDb`

如果只保留主业务流程，至少要保证 `syncGpxToDb` 已部署成功。

## 数据库准备

至少需要创建以下集合：

- `races`
- `user_plans`
- `users`

推荐权限思路：

- `races`
  当前代码由前端直接增删改查。开发期可以放宽，生产期建议改成只允许管理员经云函数写入。
- `user_plans`
  建议只允许记录创建者读写自己的计划。
- `users`
  当前是前端直查明文密码，不建议开放真实生产权限。

## 推荐联调顺序

1. 先部署云函数
2. 在 `users` 插入一个测试管理员账号
3. 进入管理后台创建一条赛事
4. 为某个组别上传 GPX，等待 `syncGpxToDb` 回填
5. 回到用户侧查看赛事详情
6. 输入目标时间生成计划
7. 保存计划到 `user_plans`
8. 在“我的计划”确认数据是否正常

## 当前实现中的已知限制

### 1. 蓝牙连接是模拟实现

`pages/ble-connect` 当前没有调用真实 BLE API，设备列表和连接成功状态都是本地模拟。

### 2. 登录方案不安全

当前登录/注册直接在前端查询 `users` 集合，并使用明文密码存储。这个方案只能用于原型验证，正式环境必须改成：

- 云函数登录
- 服务端校验
- 密码加密存储
- 更严格的角色鉴权

### 3. 管理入口当前不是严格受控

个人中心页面中，管理后台入口当前直接展示。即使有 `isAdmin` 状态，页面层面也没有真正做完备权限隔离。

### 4. 云环境是硬编码的

`app.js` 中直接写死了云环境 ID。切换到新的云环境时必须手动修改。

### 5. 管理写操作目前走前端直连数据库

赛事新增、编辑、删除都在前端页面直接执行数据库写入。原型阶段可以接受，但生产环境应迁移到云函数，避免越权风险。

## 后续可优先改造的方向

- 用真实 BLE 通信替换当前模拟连接页
- 将用户登录迁移到云函数并加密密码
- 将赛事管理写操作迁移到云函数
- 增加管理员鉴权与页面拦截
- 增加 GPX 导入失败的前端状态反馈
- 为 `README` 中的数据结构补充样例数据脚本
- 增加自动化测试和数据校验

## 常见问题

### 1. 为什么赛事详情页生成不了计划？

通常是当前组别没有 `checkpoints`。请确认：

- 已上传 GPX
- `syncGpxToDb` 已正确部署
- 云函数执行后已把 `groups[].checkpoints` 回写到 `races`

### 2. 为什么首页没有显示赛事？

首页只展示当天及未来赛事。如果赛事日期早于今天，会被过滤掉。

### 3. 为什么“我的计划”里看不到数据？

请确认：

- 计划是否已成功写入 `user_plans`
- 当前集合权限是否允许当前用户读取自己的数据
- `raceDateMs` 是否正确写入

### 4. 为什么导出图片失败？

计划长图保存依赖相册权限。请在微信中允许“保存到相册”。

## 当前仓库状态说明

截至当前代码：

- 没有自动化测试配置
- 没有 CI/CD 配置
- 没有顶层 npm 依赖
- 主要业务依赖微信开发者工具和云开发环境

如果后续继续迭代，建议优先补齐权限边界和云函数化写操作，再考虑 UI 和设备协议接入。
