# BLE 计划载荷开发指导

本文档说明当前项目中 BLE 发送载荷的来源、结构、字段含义，以及后续如何直接接入手表同步流程。

## 1. 当前数据获取逻辑

当前 BLE 载荷不再依赖“先上传到数据库，再从 `user_plans` 回读”。

现在的流程改成了：

1. 用户在计划页生成或调整计划
2. 页面先把当前计划保存为本地快照
3. BLE 载荷直接从这份本地快照构建
4. 之后如有需要，再把同一份计划上传到 `user_plans`

也就是说：

- BLE 发送使用的是“上传前的本地计划快照”
- 数据库存储只是持久化，不再是 BLE 载荷的前置依赖

## 2. 本地快照变量

当前页面会维护一份本地计划快照：

- `this.localPlanSnapshot`

这份快照保存的是当前页已经计算完成、准备上传的数据。

BLE 载荷会基于它生成，而不是在后续流程中重新查库获取。

## 3. 最终可直接发送的变量

页面中会保留两份相同内容的载荷：

- `this.blePlanPayload`
- `this.data.blePlanPayload`

后续 BLE 发送函数建议优先读取：

```js
const payload = this.blePlanPayload;
```

原因：

- `this.blePlanPayload` 是同步赋值
- `this.data.blePlanPayload` 依赖 `setData`
- BLE 发送层通常不需要经过 UI 刷新链路

## 4. 当前最终载荷结构

当前载荷只保留手表侧需要的四类数据：

- 这段比赛的名称
- 到达下一个 CP 点的北京时间
- 该 CP 点的关门北京时间
- 到达该 CP 后的休息时间（分钟）

示例：

```js
{
  ver: 2,
  raceDate: '2026-10-01',
  raceName: '2026 示例比赛 - 50km',
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

## 5. 字段说明

### 顶层字段

- `ver`
  载荷版本号。当前为 `2`。

- `raceDate`
  比赛日期。

- `raceName`
  当前页面中的比赛名称。

- `segmentCount`
  分段数量，等于 `segments.length`。

- `segments`
  分段数组。

### 每段字段

- `segmentIndex`
  段序号，从 `1` 开始。

- `segmentName`
  这一段的名称。
  当前定义为“上一 CP -> 当前 CP”中的目标 CP 名称，也就是本段终点 CP 的名称。

- `arrivalTimeBjt`
  到达下一个 CP 点的北京时间。
  格式固定为：

```text
YYYY-MM-DD HH:mm
```

- `cutoffTimeBjt`
  该 CP 点的关门北京时间。
  格式同样为：

```text
YYYY-MM-DD HH:mm
```

如果没有关门时间，则为空字符串：

```js
cutoffTimeBjt: ''
```

- `restMin`
  到达该 CP 点后的计划休息时间，单位是分钟。

## 6. 段和 CP 的对应关系

当前 BLE 载荷按“段”组织，不是按“CP 点”组织。

构建时会跳过 `checkpoints[0]`，因为它代表起点。

因此：

- `segments[0]` 表示 `起点 -> CP1`
- `segments[1]` 表示 `CP1 -> CP2`
- `segments[2]` 表示 `CP2 -> CP3`

所以手表端如果展示“第 N 段”，应理解为“上一站到当前 CP 的这一段”。

## 7. 北京时间是怎么生成的

页面会先在时间计算阶段写入几个数值字段：

- `arrAbsoluteMins`
- `depAbsoluteMins`
- `absoluteCutoffMins`

这些字段的含义是：

- 以“比赛当天 00:00”为基准的绝对分钟数
- 支持跨天

之后再通过：

- `formatBeijingDateTime(absoluteMinutes, raceDate)`

转换成北京时间字符串。

### 关键规则

- 输出固定为北京时间（UTC+8）
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

## 8. 当前涉及的函数

本地快照相关函数：

- `saveLocalPlanSnapshot(checkpoints)`
- `getBleSourcePlan(sourcePlan)`

BLE 载荷相关函数：

- `getRaceDateParts(dateStr)`
- `formatBeijingDateTime(absoluteMinutes, raceDate)`
- `getBleSegmentName(cp, index)`
- `getBleCutoffTimeBjt(cp, raceDate)`
- `buildBlePlanPayload(sourcePlan)`

时间字段写入位置：

- `updateTimesAndPaces()`

这个函数目前会写入：

- `cp.arrAbsoluteMins`
- `cp.depAbsoluteMins`
- `cp.absoluteCutoffMins`

然后立即保存本地快照，并从本地快照刷新 BLE 载荷。

## 9. 什么时候会保存本地快照

本地快照会在以下时机更新：

- 页面上的计划重新计算时
- 调用 `uploadPlanToCloud()` 之前
- 调用 `testBlePlanPayload()` 时

这保证了：

- BLE 始终拿到的是当前页最新计划
- 即使数据库还没写入，也能立即发送

## 10. 后续 BLE 发送怎么接

最简单的接法：

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

如果手表侧先按 JSON 接收，这一步就足够了。

## 11. 当前发送到手表的页面和函数

当前“发送到手表”的逻辑位于：

- 页面：`pages/plan-result/plan-result.js`

这条链路里有两个关键函数：

- `syncToHardware()`
  这是页面上的“同步至手表”按钮入口函数。
  作用是判断当前是否已经连接设备。

- `executeSyncAnimation()`
  这是当前真正执行“发送到手表流程”的函数。
  当前项目里虽然还没有接入真实 BLE API，但现在模拟的手表发送流程、发送前的数据构建和日志打印，都是在这个函数里完成的。

也就是说：

- 用户点击按钮后，先进入 `syncToHardware()`
- 如果设备已连接，则继续调用 `executeSyncAnimation()`
- `executeSyncAnimation()` 里会先上传计划，再构建 `this.blePlanPayload`，并打印将要发送的数据

当前在 `executeSyncAnimation()` 中已经增加了两条日志：

```js
console.log('[BLE Send] payload object =', payloadForBleLog);
console.log('[BLE Send] payload json =', JSON.stringify(payloadForBleLog));
```

这两条日志表示：

- 第一条打印对象结构
- 第二条打印最终字符串形式

后续如果你要接入真实 BLE 写入函数，建议直接把它放在 `executeSyncAnimation()` 里当前日志打印之后。

## 12. 发送前建议校验

建议在真正写入 BLE 特征值之前先检查：

- `payload` 是否存在
- `payload.segmentCount > 0`
- `payload.segments.length === payload.segmentCount`
- 每个 `segmentName` 是否非空
- 每个 `arrivalTimeBjt` 是否非空
- 每个 `restMin` 是否为非负整数
- 每个 `cutoffTimeBjt` 是否为空字符串或合法时间字符串

## 13. 内置测试函数

当前页面已经内置了两类测试辅助函数：

- `validateBlePlanPayload(payload)`
- `testBlePlanPayload(showModal = true)`

### `validateBlePlanPayload(payload)`

作用：

- 校验一份 BLE 载荷对象的结构是否正确
- 不会重新生成载荷
- 不会执行 BLE 发送

返回结果结构：

```js
{
  valid: true,
  errors: [],
  payload: { ... }
}
```

如果校验失败：

```js
{
  valid: false,
  errors: [
    'segments[0].arrivalTimeBjt 格式必须为 YYYY-MM-DD HH:mm'
  ],
  payload: { ... }
}
```

### `testBlePlanPayload(showModal = true)`

作用：

- 基于当前页面最新计划先保存本地快照
- 基于这份本地快照重新生成 `this.blePlanPayload`
- 自动执行格式校验
- 将结果打印到控制台
- 默认弹出校验结果弹窗

推荐调用方式：

```js
const result = this.testBlePlanPayload();
```

如果你只想拿结果、不弹窗：

```js
const result = this.testBlePlanPayload(false);
```

### 这两个函数会校验什么

- `payload` 必须是对象
- `payload.ver` 必须为 `2`
- `payload.raceDate` 不能为空
- `payload.raceName` 不能为空
- `payload.segmentCount` 必须是非负整数
- `payload.segments.length` 必须与 `segmentCount` 一致
- 每段的 `segmentIndex` 必须从 `1` 顺序递增
- 每段的 `segmentName` 不能为空
- `arrivalTimeBjt` 必须符合 `YYYY-MM-DD HH:mm`
- `cutoffTimeBjt` 必须为空字符串或 `YYYY-MM-DD HH:mm`
- `restMin` 必须为非负整数

### 调试时怎么看结果

测试函数执行后会输出两条日志：

- `[BLE Payload Test] payload = ...`
- `[BLE Payload Test] result = ...`

同时页面实例上还会挂一份最近一次结果：

```js
this.lastBlePayloadTestResult
```

适合你在开发者工具里反复检查。

## 14. 如果后续改成二进制协议

如果以后不走 JSON，而是要发二进制包，当前结构仍然可以继续复用。

到时你只需要再定义：

- `segmentName` 的字符串编码方式
- `arrivalTimeBjt` 的字符串编码方式
- `cutoffTimeBjt` 的字符串编码方式
- 分包格式
- ACK / 校验逻辑

当前这一步已经把业务数据整理成本地稳定快照，并转换成可直接发送的结构化对象，后续 BLE 层可以直接消费。
