# AST SYSTEM 小程序项目说明文档

本文档基于当前目录 `C:\Users\陈大大\Desktop\12345678` 的实际代码整理，目标是把这个微信小程序的页面、文件、JS 逻辑、云函数、云端数据库和静态资源一次性讲清楚，便于后续维护、交接和继续开发。

说明范围：

- 覆盖当前仓库内所有业务相关文件。
- `.git/` 属于 Git 元数据目录，不展开说明。
- `.DS_Store` 这类系统元数据文件会单独说明，但不属于业务逻辑。

## 1. 项目是什么

这是一个基于微信原生小程序和微信云开发实现的越野赛事与配速计划系统，分成两大侧：

- 用户侧：浏览赛事、查看赛事详情、输入目标完赛时间、生成分段计划、保存计划、查看历史计划、模拟同步到手表。
- 管理侧：新建赛事、编辑赛事、上传封面图/路线图/GPX 文件、调用云函数解析 GPX 并写回数据库。

项目当前特点：

- 页面完整，主流程是可跑通的。
- 大部分数据库读写直接在前端完成。
- BLE 连接和同步目前是模拟流程，不是真实蓝牙通信。
- 登录方案是原型级实现，`users` 集合里目前是明文密码。

## 2. 页面路由总览

`app.json` 中注册了 10 个页面，实际业务关系如下：

| 路由 | 页面名称 | 主要职责 | 主要依赖 |
| --- | --- | --- | --- |
| `pages/index/index` | 首页 / 我的产品 | 查看连接状态、近期计划、近期赛事 | `races`、`user_plans`、`app.globalData` |
| `pages/profile/profile` | 个人中心 | 登录入口、退出登录、控制台入口 | `app.globalData` |
| `pages/race-list/race-list` | 全部比赛 | 搜索、筛选、分组展示赛事 | `races` |
| `pages/race-detail/race-detail` | 比赛详情 | 查看赛事基础信息、组别、路线图、生成计划入口 | `races` |
| `pages/plan-result/plan-result` | 计划结果页 | 计算分段计划、导出图片、保存云端、模拟同步手表 | `user_plans`、本地快照、BLE 载荷 |
| `pages/my-plans/my-plans` | 全部计划 | 展示未来/历史计划、滑动删除 | `user_plans` |
| `pages/ble-connect/ble-connect` | 设备连接页 | 模拟扫描设备和连接流程 | `app.globalData` |
| `pages/login/login` | 登录/注册 | 直接对 `users` 集合做登录和注册 | `users`、`app.globalData` |
| `pages/admin-race-add/admin-race-add` | 管理控制台 | 新建/编辑赛事、上传资源、触发 GPX 解析 | `races`、云存储、`syncGpxToDb` |
| `pages/admin-race-list/admin-race-list` | 历史赛事库 | 管理端赛事列表、删除、进入编辑 | `races` |

页面主流程：

1. 管理员在控制台新建赛事并上传 GPX。
2. `syncGpxToDb` 解析 GPX，把距离、爬升、CP 数据写回 `races`。
3. 用户在首页或赛事列表进入赛事详情。
4. 用户输入目标完赛时间后进入计划结果页。
5. 计划结果页按赛段计算移动时间、休息时间、到达时间、关门判定。
6. 用户可保存到 `user_plans`，也可走模拟手表同步流程。

## 3. 云开发总览

### 3.1 云环境

`app.js` 里写死了当前云开发环境：

- 云环境 ID：`cloud1-8g7flmwwa4402751`
- `traceUser: true`

### 3.2 当前用到的云能力

- 云数据库：`races`、`user_plans`、`users`
- 云存储：赛事封面、赛事路线图、GPX 文件
- 云函数：
  - `parseGpx`
  - `syncGpxToDb`

### 3.3 云存储目录约定

管理端上传文件时采用以下目录：

- `race-covers/`：赛事主封面
- `race-maps/`：组别路线图
- `gpx-tracks/`：组别 GPX 文件

### 3.4 当前数据流

#### 赛事建档数据流

1. `pages/admin-race-add/admin-race-add.js`
2. 上传封面图、路线图、GPX 到云存储
3. 向 `races` 写入基础赛事文档
4. 对新上传的 GPX 调用 `syncGpxToDb`
5. 云函数更新 `groups[n].checkpoints`、`actualDist`、`elevation`

#### 计划生成数据流

1. `pages/race-detail/race-detail.js` 读取 `races`
2. 组装当前组别的 `checkpoints`、距离、爬升、发枪时间
3. 通过 `EventChannel` 把草稿数据传给 `pages/plan-result/plan-result.js`
4. `plan-result.js` 计算分段时间、休息、配速、关门判定
5. 可选择：
   - 保存到 `user_plans`
   - 构建 BLE 载荷并模拟“同步手表”

## 4. 云数据库详细说明

当前真正承载业务的是 3 个集合：`races`、`user_plans`、`users`。

### 4.1 `races` 集合

用途：保存比赛主数据，是整个系统最核心的数据表。

#### 顶层字段

| 字段 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| `_id` | string | 云数据库自动生成 | 赛事主键 |
| `name` | string | 管理端填写 | 赛事名称 |
| `location` | string | 管理端填写 | 举办地点 |
| `date` | string | 管理端填写 | 比赛日期，页面里按字符串解析成年月日 |
| `hasItra` | boolean | 管理端开关 | 是否显示 ITRA 标识 |
| `coverImg` | string | 云存储 fileID | 赛事封面图 |
| `tags` | array | 管理端组别生成 | 首页/列表页展示的组别标签 |
| `groups` | array | 管理端维护 | 赛事的所有距离组别 |
| `createTime` | serverDate | 前端创建时写入 | 创建时间 |
| `updateTime` | serverDate | 前端更新时写入 | 更新时间 |

#### `tags[]` 结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `dist` | string | 如 `50km`、`100km` |
| `color` | string | 组别主题色，供列表页标签使用 |

#### `groups[]` 结构

| 字段 | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| `dist` | string | 管理端填写 | 组别简称 |
| `actualDist` | string | 云函数回写 | 实际距离，如 `52.4km` |
| `elevation` | string | 云函数回写 | 爬升/下降摘要，如 `3120m+ / 2980m-` |
| `cutoffTime` | string | 管理端填写 | 整组关门描述，主要用于详情页展示 |
| `themeColor` | string | 管理端选择 | 页面按钮和标签配色 |
| `startTime` | string | 管理端填写 | 第一发枪时间 |
| `startTime2` | string/null | 管理端填写 | 第二发枪时间，可为空 |
| `detailMapImg` | string | 云存储 fileID | 组别路线图 |
| `gpxFileID` | string | 云存储 fileID | 原始 GPX 文件 |
| `checkpoints` | array | 云函数回写 | 赛道 CP/DP/终点数据 |

#### `groups[].checkpoints[]` 持久化字段

这些字段由 `syncGpxToDb` 生成并存入数据库：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | CP 名称，若 GPX 名称尾部带 `-HH:mm`，该时间会被剥离后留下纯净名称 |
| `accDist` | number | 累计距离，单位 km |
| `accGain` | number | 累计爬升，单位 m |
| `accLoss` | number | 累计下降，单位 m |
| `tempEle` | number/null | 该点海拔 |
| `svgProfile` | string | 轻量级海拔图，供列表快速显示 |
| `rawPoints` | array | 原始采样高程点，供交互式图表使用 |
| `isDropBag` | boolean | 是否为换装点 / DP |
| `rest` | number | 默认休息分钟数，普通点 5，换装点 30 |
| `cutoffTime` | string | 从点名里提取的关门时间，如 `16:00` |
| `segDist` | number | 分段距离 |
| `segGain` | number | 分段爬升 |
| `segLoss` | number | 分段下降 |

#### `checkpoints` 的运行期扩展字段

这些字段不是云端固定 schema，而是 `pages/plan-result/plan-result.js` 在 `initData()` 或 `updateTimesAndPaces()` 内临时补充：

- `cpNum`
- `locName`
- `moveMins`
- `eqDist`
- `pace`
- `eqPace`
- `arrTime`
- `depTime`
- `arrAbsoluteMins`
- `depAbsoluteMins`
- `absoluteCutoffMins`
- `displayCutoffTime`
- `isOvertime`

也就是说：

- `races` 负责提供赛道基础事实。
- `plan-result.js` 负责把这些事实加工成“计划”。

### 4.2 `user_plans` 集合

用途：保存用户已经生成并确认的计划。

当前保存逻辑位于 `pages/plan-result/plan-result.js` 的 `uploadPlanToCloud()` 中，采用“按 `raceId + groupDist` 查重”的方式：

- 已存在：更新原文档
- 不存在：新增文档

这意味着当前系统默认“同一赛事组别只保留一份最新计划”。

#### 字段结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 计划主键 |
| `raceId` | string | 对应 `races._id` |
| `raceName` | string | 页面展示名称，通常是 `赛事名 - 组别` |
| `groupDist` | string | 组别简称 |
| `raceDate` | string | 比赛日期 |
| `raceDateMs` | number | 日期时间戳，用于未来/历史排序 |
| `startTime` | string | 用户所选发枪时间 |
| `targetHours` | number | 目标小时 |
| `targetMinutes` | number | 目标分钟 |
| `checkpoints` | array | 保存当时整份计划的 CP 数据，包括移动时间、休息、配速等 |
| `createTime` | serverDate | 首次创建时间 |
| `updateTime` | serverDate | 最近更新时间 |

注意：

- 当前代码读取计划时尝试读取 `availableStartTimes`，但保存时没有写入该字段，所以重新打开历史计划时通常只能还原一个 `startTime`。
- 首页和“我的计划”页面都直接读取 `user_plans`，没有用户隔离字段，所以当前实现默认是一个公共计划池。

### 4.3 `users` 集合

用途：登录和注册。

#### 字段结构

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 用户主键 |
| `username` | string | 用户名 |
| `password` | string | 明文密码 |
| `role` | string | 角色，当前用 `user` 或 `admin` |
| `createdAt` | serverDate | 注册时间 |

#### 当前实现方式

`pages/login/login.js` 直接在前端查询：

- 登录：`where({ username, password })`
- 注册：先查重，再 `add()`

这说明当前登录体系是原型版本，主要问题有：

- 明文密码
- 前端直连数据库
- 没有基于 `openid` 的身份绑定
- `isAdmin` 仅保存在前端全局变量里

## 5. 根目录文件说明

| 文件 | 归属 | 作用 | 详细说明 |
| --- | --- | --- | --- |
| `app.js` | 全局入口 | 初始化云环境与全局状态 | 小程序启动时执行 `wx.cloud.init()`；`globalData` 里维护 `isConnected`、`deviceName`，并被首页、设备页、计划页读取 |
| `app.json` | 全局配置 | 注册页面、窗口样式、tabBar | 定义 10 个页面；导航栏统一黑底白字；tabBar 仅声明首页和个人中心，但实际页面里又自己画了一套自定义底部导航 |
| `app.wxss` | 全局样式 | 隐藏滚动条 | 全局移除滚动条外观，避免暗黑界面中出现默认滚动条 |
| `project.config.json` | 开发工具配置 | 微信开发者工具项目配置 | 指定 `cloudfunctionRoot`、`appid`、基础库版本 `3.11.1`、压缩与编译选项 |
| `project.private.config.json` | 本地私有配置 | 开发者工具本机偏好 | 只影响本机开发体验，不参与业务逻辑 |
| `.gitignore` | 仓库管理 | 忽略系统垃圾与依赖目录 | 忽略 Windows/macOS 系统文件以及 `node_modules/` |
| `.DS_Store` | 系统元数据 | macOS Finder 缓存文件 | 与业务无关，可忽略 |
| `BLE_PAYLOAD_DEV_GUIDE.md` | 开发文档 | 解释 BLE 载荷结构 | 详细说明 `plan-result.js` 里 BLE 载荷从何而来、字段含义、测试函数、发送建议 |
| `README.md` | 当前文档 | 项目说明主文档 | 本文件，已经覆盖旧版 README |

## 6. 页面文件说明

下面按页面目录解释每个页面的四件套文件：`.js`、`.wxml`、`.wxss`、`.json`。

### 6.1 首页 `pages/index`

对应页面：用户首页 / 我的产品

#### 文件说明

| 文件 | 作用 |
| --- | --- |
| `pages/index/index.js` | 拉取赛事和计划数据，控制连接状态展示与跳转 |
| `pages/index/index.wxml` | 首页结构，包含设备状态区、计划列表、赛事列表、自定义底部导航 |
| `pages/index/index.wxss` | 首页整体暗黑风样式、自定义卡片、自定义底部导航样式 |
| `pages/index/index.json` | 配置导航栏标题为 `TRL-X`，禁用原生滚动 |

#### JS 核心逻辑

- `onLoad()`：首次拉取云端赛事和我的计划。
- `onShow()`：隐藏原生 tabBar，并从 `app.globalData` 恢复设备连接状态。
- `fetchCloudRaces()`：
  - 读取 `races`
  - 使用 `parseTime()` 把日期字符串转时间戳
  - 仅保留今天及未来赛事
- `fetchMyPlans()`：
  - 读取 `user_plans`
  - 计算 `daysLeft`
  - 去掉 `raceName` 中重复的组别文案，生成 `pureRaceName`
- 跳转函数：
  - `goToMyPlan()` 进入已保存计划
  - `goToMorePlans()` 进入“我的计划”
  - `goToDetail()` 进入赛事详情
  - `goToConnect()` 进入设备页

#### 视图层说明

- `index.wxml` 把连接状态分成“未连接”和“已连接”两种头部卡片。
- 已导入计划区最多展示 3 条。
- 下半部分展示未来赛事卡片。
- 页脚不是原生 tabBar，而是手动绘制的底部导航。

### 6.2 全部比赛 `pages/race-list`

对应页面：赛事搜索与筛选页

#### 文件说明

| 文件 | 作用 |
| --- | --- |
| `pages/race-list/race-list.js` | 拉取全部赛事并实现搜索、地区、距离、时间、ITRA、排序筛选 |
| `pages/race-list/race-list.wxml` | 搜索框、筛选按钮、月份分组列表、底部抽屉筛选面板 |
| `pages/race-list/race-list.wxss` | 列表页暗黑卡片风格与 iOS 风格筛选抽屉样式 |
| `pages/race-list/race-list.json` | 启用自定义导航栏 |

#### JS 核心逻辑

- `fetchCloudRaces()`：拉取 `races` 后为每项补 `timeMs`，默认按时间升序。
- `applyFilters()`：整页的核心过滤引擎，依次处理：
  - 搜索词
  - ITRA
  - 地区
  - 距离区间
  - 时间范围
  - 排序方向
- `groupAndRenderRaces()`：把结果按 `年-月` 分组，供 WXML 按月份渲染。
- `onRegionChange()`：把微信 `picker mode="region"` 返回的 3 级地区转换成适合显示的文案。
- `confirmFilters()`：统计激活筛选数，用于红点提醒。

#### 视图层说明

- 顶部自定义导航栏包含返回按钮。
- 中间是搜索框和筛选按钮。
- 下方主列表按月份分组显示赛事。
- 底部筛选面板是抽屉式弹层，包含 ITRA、距离、地区、日期范围和排序方式。

### 6.3 比赛详情 `pages/race-detail`

对应页面：赛事详情页 + 制定计划入口

#### 文件说明

| 文件 | 作用 |
| --- | --- |
| `pages/race-detail/race-detail.js` | 拉取单场赛事、切换组别、切换 Tab、校验输入并向计划页传参 |
| `pages/race-detail/race-detail.wxml` | 展示封面、基本信息、组别切换、详情/计划两个 Tab |
| `pages/race-detail/race-detail.wxss` | 赛事头图卡片、组别滑块、Tab 滑块、时间输入区和底部按钮样式 |
| `pages/race-detail/race-detail.json` | 启用自定义导航栏 |

#### JS 核心逻辑

- `onLoad(options)`：
  - 读取路由参数 `id`
  - 对 `races` 做双兼容查询：`id` 或 `_id`
  - 命中后写入 `raceInfo`
- `switchGroup()`：切换当前组别，并把发枪选择重置到第一个。
- `switchTab()`：在“比赛详细”和“制定计划”之间切换。
- `generatePlan()`：
  - 校验是否输入目标时间
  - 校验当前组别是否已有 `checkpoints`
  - 根据 `selectedStartTimeIndex` 选出发枪时间
  - 交给 `executeJump()`
- `executeJump(selectedStartTime)`：
  - 把 `raceId`、`raceDate`、`groupDist`、`checkpoints`、`actualDist`、`elevation`、`availableStartTimes` 等信息打成草稿包
  - 通过 `wx.navigateTo + EventChannel` 传给 `plan-result`

#### 视图层说明

- `wxml` 上半部分展示赛事封面、日期、地点和 ITRA 标记。
- 中间用滑块样式切换组别。
- 下半部分通过 Tab 切换“详情展示”和“目标时间输入”。
- 计划区域支持一发和二发两个发枪批次的胶囊选择。

### 6.4 计划结果页 `pages/plan-result`

对应页面：核心算法页 / 路书页 / 导出页 / 模拟同步页

这是整个项目最复杂的页面，也是所有业务逻辑最密集的文件。

#### 文件说明

| 文件 | 作用 |
| --- | --- |
| `pages/plan-result/plan-result.js` | 负责计划算法、时间推导、关门判定、图表、海报、云端保存、BLE 载荷生成和模拟同步 |
| `pages/plan-result/plan-result.wxml` | 顶部配置区、CP 列表、详情抽屉、海报画布、连接/成功弹窗 |
| `pages/plan-result/plan-result.wxss` | 整页暗黑仪表风 UI、详情底部抽屉、长图画布、弹窗样式 |
| `pages/plan-result/plan-result.json` | 启用自定义导航栏并禁用原生滚动 |

#### JS 核心逻辑分解

##### 1. 页面初始化

- `onLoad(options)`：
  - 初始化时间选择器和休息时间选择器
  - 优先接收上一页通过 `EventChannel` 传来的赛事草稿
  - 如果没有事件通道数据且路由里有 `id`，则从 `user_plans` 读取历史计划

##### 2. 计划数据标准化

- `initData(rawCps)`：
  - 基于累计距离/爬升推导每段 `segDist`、`segGain`、`segLoss`
  - 识别 `DP` 或“换装”点，设置默认休息为 30 分钟
  - 解析点名，把 `CP1-大热换倒-16:00` 这类名字拆成：
    - `cpNum`
    - `locName`
    - `cutoffTime`
  - 初始化 `moveMins`、默认 `rest` 等字段

##### 3. 配速与疲劳计算

- `runFatigueEngine()` 是核心算法：
  - 目标总时间：`targetHours * 60 + targetMinutes`
  - 每段等强距离：`segED = segDist + segGain / 100`
  - 总等强距离：`totalED = sum(segED)`
  - 总休息时间：`sum(rest)`
  - 可移动时间：`movingMins = targetMins - totalRest`
  - 疲劳指数：`K = 1.07`
  - 使用累计法分配每段移动时间，避免逐段四舍五入误差累积

##### 4. 时间与关门线推导

- `updateTimesAndPaces()`：
  - 从发枪时间出发推导每个 CP 的到达/离开时间
  - 支持两种关门来源：
    - 赛段相对关门分钟数 `segCutoffMins`
    - 点名中提取出的绝对时刻 `cutoffTime`
  - 支持跨天关门时间
  - 计算：
    - `arrTime`
    - `depTime`
    - `displayCutoffTime`
    - `isOvertime`
    - `pace`
    - `eqPace`

##### 5. BLE 载荷

- `saveLocalPlanSnapshot()`：保存当前计划快照。
- `buildBlePlanPayload()`：把计划转换成手表侧需要的轻量数据。
- `validateBlePlanPayload()`：校验格式。
- `testBlePlanPayload()`：生成并输出调试结果。

最终 BLE 载荷结构为：

```json
{
  "ver": 2,
  "raceDate": "2026-10-01",
  "raceName": "某赛事 - 50km",
  "segmentCount": 3,
  "segments": [
    {
      "segmentIndex": 1,
      "segmentName": "CP1 - 补给站",
      "arrivalTimeBjt": "2026-10-01 09:58",
      "cutoffTimeBjt": "2026-10-01 10:30",
      "restMin": 5
    }
  ]
}
```

##### 6. 导出长图

- `savePlanImage()`：
  - 使用 `canvas type="2d"` 生成长图
  - 头部显示赛事名和总计划
  - 中段逐行绘制 CP 数据与海拔图
  - 底部绘制 `/images/qrcode.png`
  - 保存到系统相册

##### 7. 保存云端

- `uploadPlanToCloud()`：
  - 计算 `raceDateMs`
  - 组装 `planData`
  - 按 `raceId + groupDist` 查重后执行更新或新增

##### 8. 模拟同步硬件

- `syncToHardware()`：若未连接则弹窗；已连接则走同步流程。
- `executeSyncAnimation()`：
  - 先上传计划到云端
  - 再构建 BLE 载荷并打印日志
  - 用 `setTimeout` 模拟“打包路书”和“蓝牙传输中”

#### 视图层说明

- 顶部吸顶区域可调“计划用时 / 发枪时间 / 平均休息”。
- 中部是 CP 列表，每行能直接编辑赛段用时和休息时间。
- 点击某一行可以打开底部详情抽屉，查看海拔图、配速、关门时间等。
- 页面底部有“保存图片”和“同步至手表”两个主操作。
- 隐藏的 `shareCanvas` 专供导出海报，不直接显示。

### 6.5 我的计划 `pages/my-plans`

对应页面：用户计划总表

#### 文件说明

| 文件 | 作用 |
| --- | --- |
| `pages/my-plans/my-plans.js` | 拉取计划、按未来/历史分类、实现滑动删除和进入详情 |
| `pages/my-plans/my-plans.wxml` | 顶部 Tab、计划列表、滑动删除按钮、空状态 |
| `pages/my-plans/my-plans.wxss` | 列表卡片和 swipe-to-delete 动画样式 |
| `pages/my-plans/my-plans.json` | 自定义导航栏配置 |

#### JS 核心逻辑

- `fetchPlans()`：
  - 读取 `user_plans`
  - 计算 `pureRaceName`
  - 计算 `daysLeft`
  - 拆成 `futurePlans` 和 `historyPlans`
- `switchTab()`：在“即将参赛”和“历史足迹”之间切换。
- `onTouchStart / onTouchMove / onTouchEnd()`：实现左滑显示删除按钮。
- `deletePlan()`：删除 `user_plans` 文档后刷新列表。
- `goToMyPlan()`：进入 `plan-result?id=计划ID`。

#### 视图层说明

- 顶部是两个 Tab。
- 中间列表每项都可左滑露出红色删除按钮。
- 未来计划显示剩余天数，历史计划显示“已完赛”。

### 6.6 设备连接 `pages/ble-connect`

对应页面：模拟 BLE 扫描与连接

#### 文件说明

| 文件 | 作用 |
| --- | --- |
| `pages/ble-connect/ble-connect.js` | 提供假设备列表并模拟连接流程 |
| `pages/ble-connect/ble-connect.wxml` | 雷达扫描动画和设备卡片列表 |
| `pages/ble-connect/ble-connect.wxss` | 扫描波纹动画、信号条、设备卡片样式 |
| `pages/ble-connect/ble-connect.json` | 自定义导航栏配置 |

#### JS 核心逻辑

- `deviceList` 是写死的测试数据。
- `connectDevice(e)`：
  - 显示加载中
  - 1.5 秒后视为连接成功
  - 写入 `app.globalData.isConnected = true`
  - 写入 `app.globalData.deviceName`
  - 自动返回上一页

#### 视图层说明

- 页面上半部分是“正在搜索附近的腕表”雷达动画。
- 下半部分是可点击的设备卡片。
- 信号条依据 `signal` 值控制高亮数量。

### 6.7 登录 / 注册 `pages/login`

对应页面：登录与注册页

#### 文件说明

| 文件 | 作用 |
| --- | --- |
| `pages/login/login.js` | 执行登录和注册，修改全局登录状态 |
| `pages/login/login.wxml` | 登录/注册切换、账号密码输入、提交按钮 |
| `pages/login/login.wxss` | 登录页整套黑橙配色样式 |
| `pages/login/login.json` | 自定义导航栏配置 |

#### JS 核心逻辑

- `switchMode()`：在登录和注册之间切换，并清空输入框。
- `handleSubmit()`：
  - 登录模式：
    - 查询 `users` 集合是否存在 `username + password`
    - 命中后写 `app.globalData.isLoggedIn`、`userName`、`isAdmin`
  - 注册模式：
    - 先判断用户名是否已存在
    - 不存在则向 `users` 插入新文档
- `goBack()`：返回个人中心。

#### 当前实现特点

- 账号密码校验完全在前端完成。
- `role === 'admin'` 会被转成全局 `isAdmin`。
- 没有 token、session、云函数鉴权。

### 6.8 个人中心 `pages/profile`

对应页面：用户信息页 / 控制台入口页

#### 文件说明

| 文件 | 作用 |
| --- | --- |
| `pages/profile/profile.js` | 展示登录状态、退出登录、进入控制台、测试 GPX 解析 |
| `pages/profile/profile.wxml` | 用户卡片、控制台入口、菜单、自定义底部导航 |
| `pages/profile/profile.wxss` | 个人中心整体布局和控制台入口样式 |
| `pages/profile/profile.json` | 自定义导航栏配置 |

#### JS 核心逻辑

- `onShow()`：从 `app.globalData` 同步 `isLoggedIn`、`userName`、`isAdmin`。
- `handleCardClick()`：
  - 未登录：进入登录页
  - 已登录：弹窗确认退出登录
- `goToAdminPortal()`：进入管理控制台。
- `testParseGpx()`：手动调用 `parseGpx`，主要用于云函数调试。

#### 当前页面行为说明

- 虽然 JS 里维护了 `isAdmin`，但 WXML 里的控制台入口写成了 `wx:if="{{true}}"`，所以当前所有人都能看到控制台入口。
- 页面底部同样使用手工绘制 tabBar。

### 6.9 管理控制台 `pages/admin-race-add`

对应页面：新建 / 编辑赛事

#### 文件说明

| 文件 | 作用 |
| --- | --- |
| `pages/admin-race-add/admin-race-add.js` | 负责赛事表单、资源上传、保存 `races`、触发 GPX 解析 |
| `pages/admin-race-add/admin-race-add.wxml` | 全局赛事档案表单、组别表单、GPX 上传入口、底部提交按钮 |
| `pages/admin-race-add/admin-race-add.wxss` | 控制台深色表单样式、组别卡片样式、底部固定提交按钮 |
| `pages/admin-race-add/admin-race-add.json` | 默认导航栏标题 `AST 控制台` |

#### JS 核心逻辑

- 页面模式：
  - `mode: 'create'`
  - `mode: 'edit'`
- `onLoad(options)`：
  - 有 `id` 则进入编辑模式
  - 调用 `loadRaceData(id)` 回填表单
- `loadRaceData()`：
  - 从 `races` 读取文档
  - 回填顶层信息和各组别
  - 同时记住老文件 `oldCoverFileId`、`oldMapFileId`、`oldGpxFileId`
- `chooseCoverImg()`、`chooseGroupMap()`、`chooseGroupGpx()`：选择本地媒体或 GPX 文件。
- `uploadToCloud(localPath, folderName)`：
  - 如果已经是 `cloud://` 则直接复用
  - 如果是临时文件则上传到对应云目录
- `submitAndIgnite()`：
  - 先上传封面、地图、GPX
  - 组装 `tags` 和 `groups`
  - 写入或更新 `races`
  - 对新上传的 GPX 调用 `syncGpxToDb`

#### 与数据库的关系

- 这个页面是 `races` 集合的主要写入口。
- 它先写“基础赛事文档”，再由云函数补齐 `checkpoints`、`actualDist`、`elevation`。

### 6.10 历史赛事库 `pages/admin-race-list`

对应页面：管理端赛事列表

#### 文件说明

| 文件 | 作用 |
| --- | --- |
| `pages/admin-race-list/admin-race-list.js` | 拉取赛事、删除赛事、跳转编辑 |
| `pages/admin-race-list/admin-race-list.wxml` | 列出历史赛事卡片并提供删除按钮 |
| `pages/admin-race-list/admin-race-list.wxss` | 历史赛事列表卡片样式 |
| `pages/admin-race-list/admin-race-list.json` | 自定义导航栏，禁用页面滚动 |

#### JS 核心逻辑

- `onShow()`：每次页面显示都刷新赛事列表。
- `fetchRaces()`：按 `createTime desc` 拉取 `races`。
- `goToEdit()`：进入 `admin-race-add?id=赛事ID`。
- `deleteRace()`：确认后删除对应赛事文档。

#### 视图层说明

- 每张卡片显示：
  - 赛事名称
  - 日期和地点
  - 所有组别标签
  - “点击编辑”提示
  - 删除按钮

## 7. 云函数文件说明

### 7.1 `cloudfunctions/parseGpx`

这个云函数更像“解析实验室”，主要用于调试 GPX 解析效果，不负责回写数据库。

| 文件 | 作用 |
| --- | --- |
| `cloudfunctions/parseGpx/index.js` | 下载 GPX、解析轨迹点和路标点，返回草稿 checkpoint 数据 |
| `cloudfunctions/parseGpx/package.json` | 云函数依赖定义，依赖 `wx-server-sdk ~2.6.3` |
| `cloudfunctions/parseGpx/config.json` | 云函数配置，超时 60 秒，无额外 openapi 权限 |

#### `index.js` 核心逻辑

- 下载云存储里的 GPX 文件。
- 用正则提取所有 `<trkpt>`：
  - 计算 3D 距离
  - 计算累计爬升和下降
- 用正则提取所有 `<wpt>`：
  - 识别 `START`、`FINISH`、`CPn`、`DPn`
  - 过滤水站、医疗、路标等黑名单点
- 用滑窗方式把路标点匹配到轨迹点。
- 最终返回：
  - `draft.name`
  - `draft.checkpoints`

当前调用入口：

- `pages/profile/profile.js` 的 `testParseGpx()`

### 7.2 `cloudfunctions/syncGpxToDb`

这是当前正式业务链路里真正使用的 GPX 解析函数。

| 文件 | 作用 |
| --- | --- |
| `cloudfunctions/syncGpxToDb/index.js` | 下载 GPX、解析检查点、生成海拔数据并写回 `races` |
| `cloudfunctions/syncGpxToDb/package.json` | 云函数依赖定义，依赖 `wx-server-sdk ~3.0.4` |
| `cloudfunctions/syncGpxToDb/config.json` | 云函数权限配置，无额外 openapi 权限 |

#### `index.js` 核心逻辑

1. 下载 GPX 文件。
2. 解析所有 `trkpt`，累计：
   - `totalDistM`
   - `totalGain`
   - `totalLoss`
3. 解析所有 `wpt`，识别有效 CP/DP。
4. 用滑窗匹配 CP 对应的轨迹索引。
5. 为每个赛段生成：
   - `rawPoints`
   - `svgProfile`
6. 从点名尾部提取关门时间：
   - 例如 `CP3-16:00`
7. 生成每个检查点的：
   - `accDist`
   - `accGain`
   - `accLoss`
   - `segDist`
   - `segGain`
   - `segLoss`
   - `rest`
   - `isDropBag`
   - `cutoffTime`
8. 最后把结果写回：
   - `groups.{groupIndex}.checkpoints`
   - `groups.{groupIndex}.actualDist`
   - `groups.{groupIndex}.elevation`

当前调用入口：

- `pages/admin-race-add/admin-race-add.js` 的 `submitAndIgnite()`

## 8. 静态资源与空目录说明

### 8.1 `images/`

| 文件 | 使用位置 | 作用 |
| --- | --- | --- |
| `images/watch1.png` | `pages/index/index.wxml` | 首页底部导航中“我的产品”图标，当前激活态 |
| `images/people1.png` | `pages/index/index.wxml` | 首页底部导航中“个人中心”图标，未激活态 |
| `images/watch.png` | `pages/profile/profile.wxml` | 个人中心底部导航中“我的产品”图标，未激活态 |
| `images/people.png` | `pages/profile/profile.wxml` | 个人中心底部导航中“个人中心”图标，当前激活态 |
| `images/qrcode.png` | `pages/plan-result/plan-result.js` | 导出长图海报底部二维码 |

### 8.2 `utils/`

当前为空目录，说明作者预留了工具函数目录，但暂时没有把通用方法拆出来。

## 9. 当前 BLE 设计说明

当前 BLE 不是原生蓝牙实现，而是“页面逻辑 + 载荷结构 + 模拟动画”三部分：

- 设备发现和连接：
  - `pages/ble-connect/ble-connect.js`
  - 使用写死设备列表和 `setTimeout`
- 是否连接：
  - 存在 `app.globalData.isConnected`
- 手表名称：
  - 存在 `app.globalData.deviceName`
- 真正发送前的数据准备：
  - `pages/plan-result/plan-result.js`
  - `buildBlePlanPayload()`
- 额外文档：
  - `BLE_PAYLOAD_DEV_GUIDE.md`

当前 BLE 侧已经完成的是：

- 手表所需数据结构定义
- 到达时间/关门时间转换成北京时间字符串
- 载荷格式校验
- 模拟上传和传输提示

当前 BLE 侧还没有完成的是：

- `wx.openBluetoothAdapter`
- `wx.createBLEConnection`
- 特征值读写
- 分包、重试、ACK

## 10. GPX 命名和解析约定

当前 GPX 解析对命名有明显约定，维护时必须知道：

- 起点：`START` 或含“起点”
- 终点：`FINISH` 或含“终点”
- 检查点：`CP1`、`CP2`、`CP3`
- 换装点：`DP1`、`DP2` 或含“换装”
- 点名尾部可附带关门时间：`CP3-16:00`

示例：

```text
START
CP1
DP1
CP3-16:00
FINISH
```

如果 GPX 的 `<wpt>` 命名不符合这个规则，云函数很可能无法正确生成 `checkpoints`。

## 11. 当前实现中的关键注意点

这些不是文件缺失，而是当前代码行为上必须知道的事实：

- 首页和“我的计划”都直接读取整个 `user_plans` 集合，没有按用户做隔离。
- 登录状态只存在前端 `app.globalData` 中，关闭小程序后不会持久化。
- `profile` 页虽然维护了 `isAdmin`，但控制台入口在模板里始终显示。
- 大部分数据库写操作发生在前端页面中，而不是云函数中。
- `plan-result.js` 是最核心的业务文件，后续任何计划算法、BLE 接入、导出逻辑都要从这里继续维护。

## 12. 接手时建议优先看哪些文件

如果要快速理解项目，建议按这个顺序阅读：

1. `app.js`
2. `app.json`
3. `pages/admin-race-add/admin-race-add.js`
4. `cloudfunctions/syncGpxToDb/index.js`
5. `pages/race-detail/race-detail.js`
6. `pages/plan-result/plan-result.js`
7. `pages/index/index.js`
8. `pages/my-plans/my-plans.js`
9. `pages/login/login.js`
10. `BLE_PAYLOAD_DEV_GUIDE.md`

## 13. 一句话总结

这个仓库的本质是一个“越野赛事数据后台 + 计划计算器 + 模拟手表同步”的微信小程序原型。其中：

- `races` 决定赛事事实数据，
- `syncGpxToDb` 决定赛道 CP 数据质量，
- `plan-result.js` 决定用户最终看到的配速计划，
- `user_plans` 承担计划持久化，
- `users` 只提供了最基础、最原型级的登录能力。

后续无论是接真实 BLE、改权限、做用户隔离，还是继续优化算法，核心都绕不开这几处。
