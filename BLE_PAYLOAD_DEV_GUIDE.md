# BLE 计划载荷开发指导

本文档的意义不是介绍 UI，而是定义当前小程序里“计划页如何整理出一份可发送给手表的 BLE 数据”，以及这份数据在代码里从哪里来、何时刷新、如何校验、目前还缺什么。

它可以视为当前项目里“计划计算层”和“未来真实 BLE 传输层”之间的接口说明。

## 1. 当前 BLE 实现到什么程度了

当前仓库已经完成了下面 3 件事：

1. 生成稳定的本地计划快照
2. 从本地快照构建 BLE 载荷对象
3. 在“同步至手表”流程里打印最终待发送数据

当前还没有完成真实 BLE 通信：

- 没有调用 `wx.openBluetoothAdapter`
- 没有扫描真实外设
- 没有建立 BLE 连接
- 没有写入 characteristic
- 没有分包、ACK、重传

所以现在的 BLE 是“数据层已完成、传输层仍为模拟”。

## 2. 当前涉及的文件

### 计划与载荷生成

- `pages/plan-result/plan-result.js`
- `pages/plan-result/plan-result.wxml`

### 计划来源

- `pages/race-detail/race-detail.js`

### 模拟设备连接

- `pages/ble-connect/ble-connect.js`

### 全局连接状态

- `app.js`

## 3. 当前完整流程

现在“同步到手表”的完整链路是：

1. 用户在比赛详情页选择组别、目标时间和发枪批次
2. `race-detail` 把 `checkpoints`、`raceDate`、`startTime`、`availableStartTimes` 等数据传给 `plan-result`
3. `plan-result` 完成赛段时间、关门时间、配速、休息时间计算
4. 页面把当前计划保存成 `this.localPlanSnapshot`
5. 页面基于这份快照生成 `this.blePlanPayload`
6. 用户点击“同步至手表”
7. 如果未连接设备，弹出“仅存云端 / 去连接”弹窗
8. 如果已连接，或连接后返回，则执行模拟发送流程

关键结论：

- BLE 载荷的直接来源是本地计划快照，不是数据库回读
- 数据库保存只是持久化，不是 BLE 构建前置条件

## 4. 页面与函数关系

### 4.1 比赛详情页如何把数据带到计划页

`pages/race-detail/race-detail.js` 中：

- `generatePlan()`
  负责校验用户是否输入目标完赛时间、当前组别是否已有 `checkpoints`
- `executeJump(selectedStartTime)`
  负责组装计划草稿并通过 `EventChannel` 发送给 `plan-result`

传给计划页的关键字段有：

- `raceId`
- `raceDate`
- `groupDist`
- `name`
- `checkpoints`
- `actualDist`
- `elevation`
- `startTime`
- `availableStartTimes`

其中：

- `startTime` 是当前选中的发枪时间
- `availableStartTimes` 是当前组别所有可切换的发枪时间列表

### 4.2 计划页如何恢复数据

`pages/plan-result/plan-result.js` 中有两条入口：

- 来自赛事详情页：
  - `acceptDataFromOpenerPage`
- 来自已保存计划：
  - `db.collection('user_plans').doc(options.id).get()`

当前页面初始化后会恢复以下配置：

- 计划用时
- 发枪时间
- 平均休息
- 补给提示
- checkpoints

## 5. 本地快照是什么

当前计划页会维护一份本地快照：

- `this.localPlanSnapshot`

生成函数：

- `saveLocalPlanSnapshot(checkpoints = this.data.checkpoints)`

它保存的是当前页面已经计算完成、可直接用于上传或发送的计划数据。

当前快照包含：

```js
{
  raceId,
  raceDate,
  raceName,
  groupDist,
  startTime,
  targetHours,
  targetMinutes,
  nutritionVal,
  nutritionIndex,
  checkpoints
}
```

注意：

- `availableStartTimes` 当前只存在于页面状态里，不在本地快照里
- 因为 `uploadPlanToCloud()` 使用的也是这份快照，所以它目前也不会写入云端计划
- 这不影响 BLE 载荷构建，但会影响历史计划重新打开后的“多发枪时间切换能力”

## 6. 最终可直接发送的变量

页面中会保留两份载荷：

- `this.blePlanPayload`
- `this.data.blePlanPayload`

推荐 BLE 发送层优先读取：

```js
const payload = this.blePlanPayload;
```

原因：

- `this.blePlanPayload` 是同步赋值
- `this.data.blePlanPayload` 依赖 `setData`
- 真实 BLE 传输一般不需要经过 UI 刷新链路

## 7. 当前最终载荷结构

当前载荷版本是 `ver: 2`。

和旧版本相比，当前代码已经新增顶层字段：

- `nutritionAlert`

示例：

```js
{
  ver: 2,
  raceDate: '2026-10-01',
  raceName: '2026 示例比赛 - 50km',
  nutritionAlert: 30,
  segmentCount: 3,
  segments: [
    {
      segmentIndex: 1,
      segmentName: 'CP1 - 补给站',
      arrivalTimeBjt: '2026-10-01 09:58',
      cutoffTimeBjt: '2026-10-01 10:30',
      restMin: 5
    },
    {
      segmentIndex: 2,
      segmentName: 'CP2 - 山脊',
      arrivalTimeBjt: '2026-10-01 12:16',
      cutoffTimeBjt: '2026-10-01 13:00',
      restMin: 10
    },
    {
      segmentIndex: 3,
      segmentName: '终点',
      arrivalTimeBjt: '2026-10-01 16:40',
      cutoffTimeBjt: '',
      restMin: 0
    }
  ]
}
```

## 8. 字段说明

### 8.1 顶层字段

- `ver`
  载荷版本号，当前固定为 `2`

- `raceDate`
  比赛日期，来源于计划页当前赛事

- `raceName`
  当前页面展示的赛事名称

- `nutritionAlert`
  补给提醒间隔，单位分钟

  当前规则：

  - 选择 `30m` 时，发送 `30`
  - 选择 `45m` 时，发送 `45`
  - 选择 `关闭` 时，发送 `0`

  它来自：

  ```js
  plan.nutritionVal === '关闭' ? 0 : parseInt(plan.nutritionVal)
  ```

- `segmentCount`
  段数量，等于 `segments.length`

- `segments`
  分段数组

### 8.2 每段字段

- `segmentIndex`
  段序号，从 `1` 开始

- `segmentName`
  这一段的终点名称

  当前生成规则：

  1. 优先用 `cpNum + locName`
  2. 没有时退回 `cp.name`
  3. 再退回 `cpNum`

- `arrivalTimeBjt`
  到达当前 CP 的北京时间

  固定格式：

```text
YYYY-MM-DD HH:mm
```

- `cutoffTimeBjt`
  当前 CP 的关门北京时间

  固定格式：

```text
YYYY-MM-DD HH:mm
```

  如果没有关门时间，则为空字符串：

```js
cutoffTimeBjt: ''
```

- `restMin`
  到达该 CP 后计划休息的分钟数

## 9. 段和 CP 的对应关系

当前 BLE 载荷按“段”组织，不按“点”组织。

构建时会跳过：

- `checkpoints[0]`

因为它代表起点。

因此：

- `segments[0]` 表示 `起点 -> CP1`
- `segments[1]` 表示 `CP1 -> CP2`
- `segments[2]` 表示 `CP2 -> CP3`

手表端如果展示“第 N 段”，应理解为“上一站到当前 CP 的这一段”。

## 10. 北京时间是怎么生成的

计划页在时间计算完成后，会给每个 CP 写入几个绝对时间字段：

- `arrAbsoluteMins`
- `depAbsoluteMins`
- `absoluteCutoffMins`

这些字段表示：

- 以比赛当天 `00:00` 为基准的绝对分钟数
- 支持跨天

之后通过：

- `formatBeijingDateTime(absoluteMinutes, raceDate)`

统一转换成北京时间字符串。

关键规则：

- 固定按北京时间 `UTC+8` 输出
- 不依赖手机当前时区
- 支持跨天时间

示例：

- 比赛日期：`2026-10-01`
- 到达分钟数：`420`
- 输出：`2026-10-01 07:00`

跨天示例：

- 比赛日期：`2026-10-01`
- 关门分钟数：`1530`
- 输出：`2026-10-02 01:30`

## 11. 当前涉及的核心函数

### 11.1 快照相关

- `saveLocalPlanSnapshot(checkpoints)`
- `getBleSourcePlan(sourcePlan)`

### 11.2 载荷构建相关

- `getRaceDateParts(dateStr)`
- `formatBeijingDateTime(absoluteMinutes, raceDate)`
- `getBleSegmentName(cp, index)`
- `getBleCutoffTimeBjt(cp, raceDate)`
- `buildBlePlanPayload(sourcePlan)`

### 11.3 校验与测试

- `validateBlePlanPayload(payload)`
- `testBlePlanPayload(showModal = true)`

### 11.4 时间写入入口

- `updateTimesAndPaces()`

这个函数会刷新：

- `cp.arrAbsoluteMins`
- `cp.depAbsoluteMins`
- `cp.absoluteCutoffMins`

然后立即：

1. 保存本地快照
2. 基于快照重建 `blePlanPayload`

## 12. 本地快照在什么时候刷新

当前会在这些时机更新快照或基于快照刷新载荷：

- 页面初始化完成并开始计算计划后
- 改动计划总时间后
- 改动发枪时间后
- 改动平均休息后
- 手动修改某段计划用时/休息后
- 调用 `uploadPlanToCloud()` 前
- 调用 `testBlePlanPayload()` 时

这意味着：

- BLE 始终读取的是当前页的最新计划
- 即使数据库还没写入，也能立刻构建待发送载荷

## 13. 当前“同步至手表”按钮的真实流程

入口函数：

- `syncToHardware()`

### 13.1 已连接设备时

直接执行：

- `executeSyncAnimation()`

### 13.2 未连接设备时

弹出连接弹窗，用户有两条路：

- `modalLocalSave()`
  - 只上传计划到云端
  - 不发送 BLE

- `modalGoConnect()`
  - 设置 `this.pendingSync = true`
  - 跳转到 `pages/ble-connect/ble-connect`

### 13.3 连接页返回后的续传逻辑

`pages/ble-connect/ble-connect.js` 当前会做两件事：

- `app.globalData.isConnected = true`
- `app.globalData.deviceName = ...`

连接成功后自动返回计划页。

计划页 `onShow()` 中会检查：

- `this.pendingSync`
- `app.globalData.isConnected`

如果都满足，就自动继续执行：

- `executeSyncAnimation()`

也就是说，当前代码已经实现了“先去连接，再回到计划页自动继续发送”的流程。

## 14. `executeSyncAnimation()` 现在到底做了什么

当前真实行为是：

1. 先执行 `uploadPlanToCloud()`
2. 再执行 `buildBlePlanPayload()`
3. 打印两条日志
4. 用加载动画模拟“打包路书”和“蓝牙传输中”
5. 弹出成功弹窗

当前日志：

```js
console.log('[BLE Send] payload object =', payloadForBleLog);
console.log('[BLE Send] payload json =', JSON.stringify(payloadForBleLog));
```

这两条日志就是未来真实 BLE 写入前最适合接入的位置。

如果后续接入真实传输，建议直接在这里加：

```js
const text = JSON.stringify(payloadForBleLog);
// writeToCharacteristic(text)
```

## 15. 当前云端保存和 BLE 的关系

`uploadPlanToCloud()` 当前会把以下字段写入 `user_plans`：

- `raceId`
- `raceName`
- `groupDist`
- `raceDate`
- `raceDateMs`
- `startTime`
- `targetHours`
- `targetMinutes`
- `nutritionVal`
- `nutritionIndex`
- `checkpoints`

它不会写入：

- `blePlanPayload`
- `availableStartTimes`

所以现在的真实关系是：

- BLE 发送看本地快照
- 云端保存看同一份本地快照
- 但云端计划不是 BLE 发送的唯一来源，也不是必需前置条件

## 16. 发送前建议校验

建议真实写入 characteristic 之前至少检查：

- `payload` 必须存在
- `payload.ver === 2`
- `payload.raceDate` 非空
- `payload.raceName` 非空
- `payload.nutritionAlert` 为非负整数
- `payload.segmentCount > 0`
- `payload.segments.length === payload.segmentCount`
- 每个 `segmentIndex` 顺序正确
- 每个 `segmentName` 非空
- 每个 `arrivalTimeBjt` 都是合法时间串
- 每个 `cutoffTimeBjt` 要么为空，要么是合法时间串
- 每个 `restMin` 都是非负整数

## 17. 内置测试函数

当前页面已经内置两类测试辅助函数：

- `validateBlePlanPayload(payload)`
- `testBlePlanPayload(showModal = true)`

### `validateBlePlanPayload(payload)`

作用：

- 校验一份 BLE 载荷对象结构是否正确
- 不会重新生成载荷
- 不会执行 BLE 发送

返回结构：

```js
{
  valid: true,
  errors: [],
  payload: { ... }
}
```

### `testBlePlanPayload(showModal = true)`

作用：

1. 保存当前页最新快照
2. 重新生成 `this.blePlanPayload`
3. 自动执行格式校验
4. 打印结果到控制台
5. 默认弹出结果弹窗

推荐调用：

```js
const result = this.testBlePlanPayload();
```

如果只要结果不弹窗：

```js
const result = this.testBlePlanPayload(false);
```

调试日志：

- `[BLE Payload Test] payload = ...`
- `[BLE Payload Test] result = ...`

同时页面实例上还会挂一个最近结果：

```js
this.lastBlePayloadTestResult
```

## 18. 当前实现中的已知边界

这份文档必须配合下面这些现实一起看：

- 当前 BLE 连接页是模拟数据，不是真实设备扫描
- 当前成功同步只是模拟成功，不代表已经写入手表
- 当前 `availableStartTimes` 不会进入 BLE 载荷，也不会保存到云端计划
- 当前 `nutritionAlert` 是顶层全局提醒，不是按赛段单独配置

## 19. 如果后续改成真实 BLE 或二进制协议

### 如果先走 JSON 文本协议

最简单的接法就是：

```js
sendPlanToBle() {
  const payload = this.blePlanPayload;

  if (!payload || payload.segmentCount === 0) {
    wx.showToast({ title: '没有可发送的计划数据', icon: 'none' });
    return;
  }

  const text = JSON.stringify(payload);
  // writeToCharacteristic(text)
}
```

### 如果后续改成二进制协议

当前结构仍然可以复用，你只需要再定义：

- `raceDate` 的编码方式
- `raceName` 的编码方式
- `nutritionAlert` 的编码方式
- `segmentName` 的编码方式
- 时间字段的编码方式
- 分包格式
- ACK / 校验逻辑

## 20. 一句话结论

当前项目里，BLE 层最关键的不是“怎么连”，而是“计划页已经能稳定产出一份可发送的结构化数据”。  
这份数据的标准来源是 `this.localPlanSnapshot`，标准输出是 `this.blePlanPayload`，标准发送入口是 `executeSyncAnimation()`。
