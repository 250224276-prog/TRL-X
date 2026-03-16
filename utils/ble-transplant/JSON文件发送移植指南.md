# JSON 文件发送移植指南

## 一、概述

本指南用于将 JSON 文件通过 BLE 蓝牙传输到设备的功能移植到其他微信小程序项目中。

与 KML/GPX 文件传输相比，JSON 文件发送：
- 无需复杂的解析和压缩算法
- 直接发送原始文本内容
- 同样支持分包发送和结束符标记

## 二、核心功能

### 2.1 依赖文件

| 文件 | 功能 |
|------|------|
| [ble.ts](file:///c:\Users\OUYQ\Desktop\TRL\KML_BLE\miniprogram-2\miniprogram\utils\ble-transplant\ble.ts) | BLE 蓝牙底层 API 封装 |
| [kml-sender.ts](file:///c:\Users\OUYQ\Desktop\TRL\KML_BLE\miniprogram-2\miniprogram\utils\ble-transplant\kml-sender.ts) | 提供数据分包发送基础功能 |

### 2.2 BLE 模块功能 (ble.ts)

- `openBluetoothAdapter()` - 初始化蓝牙适配器
- `closeBluetoothAdapter()` - 关闭蓝牙适配器
- `startBluetoothDevicesDiscovery()` - 开始搜索设备
- `stopBluetoothDevicesDiscovery()` - 停止搜索设备
- `createBLEConnection(deviceId)` - 连接 BLE 设备
- `closeBLEConnection(deviceId)` - 断开连接
- `getBLEDeviceServices(deviceId)` - 获取设备服务列表
- `getBLEDeviceCharacteristics(deviceId, serviceId)` - 获取特征值列表
- `findWritableCharacteristic(deviceId)` - 查找可写入特征值
- `findNotifyCharacteristic(deviceId)` - 查找可通知特征值
- `enableBLECharacteristicNotify(deviceId, serviceId, characteristicId, state)` - 启用通知
- `writeBLECharacteristicValue(deviceId, serviceId, characteristicId, value)` - 写入数据
- `onBLECharacteristicValueChange(callback)` - 监听数据接收

### 2.3 发送相关常量与类型

```typescript
/** BLE 单次写入最大字节数 */
const BLE_CHUNK_SIZE = 230

/** 发送结束符序列 */
const END_MARKER = [0xFF, 0xFF, 0xFF]

interface SendProgress {
  sentBytes: number
  totalBytes: number
  percent: number
  currentChunk: number
  totalChunks: number
}

interface SendOptions {
  deviceId: string
  chunkSize?: number      // 默认 230
  writeDelayMs?: number    // 默认 20ms
  onProgress?: (progress: SendProgress) => void
}
```

## 三、移植步骤

### 3.1 复制文件

将以下文件复制到目标项目的 utils 目录下：
- `ble.ts`
- `kml-sender.ts`（复用其中的分包发送功能）

### 3.2 创建 JSON 发送模块

新建 `json-sender.ts` 文件：

```typescript
import {
  writeBLECharacteristicValue,
  findWritableCharacteristic
} from './ble'

/** BLE 单次写入最大字节数 */
export const BLE_CHUNK_SIZE = 230

/** 发送结束符序列 */
export const END_MARKER = [0xFF, 0xFF, 0xFF]

export interface SendProgress {
  sentBytes: number
  totalBytes: number
  percent: number
  currentChunk: number
  totalChunks: number
}

export interface JsonSendOptions {
  deviceId: string
  chunkSize?: number
  writeDelayMs?: number
  onProgress?: (progress: SendProgress) => void
}

/**
 * 读取 JSON 文件为 ArrayBuffer
 */
export async function readJsonFile(filePath: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      encoding: 'binary',
      success: (res) => {
        const buffer = res.data as ArrayBuffer
        resolve(buffer)
      },
      fail: reject
    })
  })
}

/**
 * 将 ArrayBuffer 按指定大小分块
 */
export function chunkArrayBuffer(
  buffer: ArrayBuffer,
  chunkSize: number
): ArrayBuffer[] {
  const chunks: ArrayBuffer[] = []
  const view = new Uint8Array(buffer)
  for (let i = 0; i < view.length; i += chunkSize) {
    chunks.push(view.slice(i, i + chunkSize).buffer)
  }
  return chunks
}

/**
 * 延时函数
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 发送 JSON 数据到 BLE 设备
 */
export async function sendJsonToBle(
  buffer: ArrayBuffer,
  options: JsonSendOptions
): Promise<void> {
  const {
    deviceId,
    chunkSize = BLE_CHUNK_SIZE,
    writeDelayMs = 20,
    onProgress
  } = options

  // 查找可写入特征值
  const writeChar = await findWritableCharacteristic(deviceId)

  // 生成带结束符的载荷
  const totalBytes = buffer.byteLength + END_MARKER.length
  const payload = new Uint8Array(totalBytes)
  payload.set(new Uint8Array(buffer), 0)
  payload.set(END_MARKER, payload.length - END_MARKER.length)

  // 分块
  const chunks = chunkArrayBuffer(payload.buffer, chunkSize)
  const totalChunks = chunks.length

  // 逐包发送
  for (let i = 0; i < chunks.length; i++) {
    await writeBLECharacteristicValue(
      deviceId,
      writeChar.serviceId,
      writeChar.uuid,
      chunks[i]
    )

    // 进度回调
    if (onProgress) {
      const sentBytes = Math.min((i + 1) * chunkSize, totalBytes)
      onProgress({
        sentBytes,
        totalBytes,
        percent: Math.round((sentBytes / totalBytes) * 100),
        currentChunk: i + 1,
        totalChunks
      })
    }

    // 包间延迟
    if (writeDelayMs > 0 && i < chunks.length - 1) {
      await delay(writeDelayMs)
    }
  }
}
```

### 3.3 在页面中使用

**示例 - 蓝牙连接与 JSON 文件传输:**

```typescript
import {
  openBluetoothAdapter,
  startBluetoothDevicesDiscovery,
  stopBluetoothDevicesDiscovery,
  createBLEConnection,
  findWritableCharacteristic,
  findNotifyCharacteristic,
  enableBLECharacteristicNotify,
  onBLECharacteristicValueChange,
  closeBLEConnection
} from '../../utils/ble-transplant/ble'

import {
  readJsonFile,
  sendJsonToBle
} from '../../utils/json-sender'

Page({
  data: {
    devices: [],
    selectedDevice: null,
    status: 'idle' as 'idle' | 'scanning' | 'connected' | 'sending'
  },

  // 1. 初始化蓝牙
  async initBLE() {
    try {
      await openBluetoothAdapter()
      await startBluetoothDevicesDiscovery()
      this.setData({ status: 'scanning' })
      
      // 监听设备发现
      wx.onBluetoothDeviceFound((res) => {
        // 处理发现的设备
        const devices = res.devices.filter(d => d.name)
        this.setData({ devices: [...this.data.devices, ...devices] })
      })
    } catch (err) {
      console.error('蓝牙初始化失败:', err)
    }
  },

  // 2. 连接设备
  async connectDevice(deviceId: string) {
    try {
      await createBLEConnection(deviceId)
      
      // 查找可写入和可通知的特征值
      const writeChar = await findWritableCharacteristic(deviceId)
      const notifyChar = await findNotifyCharacteristic(deviceId)
      
      // 启用通知
      await enableBLECharacteristicNotify(
        deviceId, 
        notifyChar.serviceId, 
        notifyChar.uuid, 
        true
      )
      
      // 监听数据接收
      onBLECharacteristicValueChange((res) => {
        const data = new Uint8Array(res.value)
        console.log('收到数据:', data)
      })
      
      this.setData({ 
        status: 'connected',
        selectedDevice: { deviceId }
      })
    } catch (err) {
      console.error('连接失败:', err)
    }
  },

  // 3. 选择并发送 JSON 文件
  async chooseAndSendJson() {
    try {
      // 选择文件
      const res = await wx.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ['json']
      })
      
      const file = res.tempFiles[0]
      
      // 读取 JSON 文件
      const buffer = await readJsonFile(file.path)
      console.log('文件大小:', buffer.byteLength, '字节')
      
      // 发送到 BLE 设备
      this.setData({ status: 'sending' })
      
      await sendJsonToBle(buffer, {
        deviceId: this.data.selectedDevice.deviceId,
        chunkSize: 230,        // BLE MTU 限制
        writeDelayMs: 20,       // 包间延迟
        onProgress: (progress) => {
          console.log(`发送进度: ${progress.percent}% (${progress.currentChunk}/${progress.totalChunks})`)
          this.setData({ 
            progress: `${progress.percent}%` 
          })
        }
      })
      
      console.log('发送完成')
      this.setData({ status: 'connected' })
    } catch (err) {
      console.error('发送失败:', err)
      this.setData({ status: 'connected' })
    }
  },

  // 4. 断开连接
  async disconnect() {
    if (this.data.selectedDevice) {
      await closeBLEConnection(this.data.selectedDevice.deviceId)
      this.setData({ 
        status: 'idle',
        selectedDevice: null 
      })
    }
  }
})
```

## 四、数据格式说明

### 4.1 发送数据包结构

```
[JSON 数据内容] + [结束符 0xFF 0xFF 0xFF]
```

### 4.2 分包规则

- 每包最大 230 字节（可根据设备 MTU 调整）
- 最后一包包含结束符序列
- 包间建议延迟 20ms

### 4.3 示例 JSON 数据

```json
{
  "type": "config",
  "version": "1.0",
  "settings": {
    "brightness": 80,
    "volume": 50
  }
}
```

## 五、注意事项

### 5.1 BLE 限制

- **MTU 限制**: 单次写入最大 20-512 字节，建议使用 230 字节以确保兼容性
- **分包发送**: 大文件需要分包发送，每包之间建议添加 20ms 延迟
- **结束符**: 发送完成后必须追加 `0xFF 0xFF 0xFF` 结束符序列

### 5.2 权限配置

在目标小程序的 `app.json` 中需要配置权限：

```json
{
  "permission": {
    "scope.bluetooth": {
      "desc": "用于连接 BLE 设备传输数据"
    }
  }
}
```

### 5.3 文件选择限制

- 使用 `wx.chooseMessageFile` 选择文件
- 限制文件类型为 `['json']`
- 注意文件大小，过大文件可能需要更长的发送时间

## 六、与 KML 发送的区别

| 特性 | JSON 发送 | KML/GPX 发送 |
|------|-----------|--------------|
| 文件解析 | 无需解析 | 需要解析提取坐标 |
| 数据压缩 | 不压缩 | 支持差分压缩 |
| CRC 校验 | 可选 | 内置 CRC32 计算 |
| 结束符 | `0xFF 0xFF 0xFF` | `0xFF 0xFF 0xFF` |
| 适用场景 | 配置文件、数据同步 | 轨迹文件传输 |

## 七、常见问题

### 7.1 连接失败

- 检查设备是否开启
- 确保蓝牙权限已授权
- 部分设备需要先配对才能连接

### 7.2 发送失败

- 检查设备是否支持 BLE 写入
- 确保 MTU 设置足够
- 尝试增加 `writeDelayMs` 延迟

### 7.3 数据接收不完整

- 确认结束符 `0xFF 0xFF 0xFF` 已正确发送
- 检查设备端是否正确处理分包
- 适当增加包间延迟

---

**文档版本**: 1.0  
**创建日期**: 2026-03-16
