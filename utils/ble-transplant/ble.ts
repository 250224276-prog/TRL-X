/**
 * BLE 蓝牙工具模块
 * 适配微信小程序低功耗蓝牙 API，注意 BLE 分包大小限制
 */

export interface BLECharacteristic {
  uuid: string
  serviceId: string
}

/**
 * 初始化蓝牙适配器
 */
export function openBluetoothAdapter(): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.openBluetoothAdapter({
      success: () => resolve(),
      fail: (err) => reject(err)
    })
  })
}

/**
 * 关闭蓝牙适配器
 */
export function closeBluetoothAdapter(): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.closeBluetoothAdapter({
      success: () => resolve(),
      fail: (err) => reject(err)
    })
  })
}

/**
 * 开始搜索蓝牙设备
 */
export function startBluetoothDevicesDiscovery(): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.startBluetoothDevicesDiscovery({
      allowDuplicatesKey: false,
      success: () => resolve(),
      fail: (err) => reject(err)
    })
  })
}

/**
 * 停止搜索蓝牙设备
 */
export function stopBluetoothDevicesDiscovery(): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.stopBluetoothDevicesDiscovery({
      success: () => resolve(),
      fail: (err) => reject(err)
    })
  })
}

/**
 * 连接 BLE 设备
 */
export function createBLEConnection(deviceId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.createBLEConnection({
      deviceId,
      timeout: 10000,
      success: () => resolve(),
      fail: (err) => reject(err)
    })
  })
}

/**
 * 断开 BLE 设备连接
 */
export function closeBLEConnection(deviceId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.closeBLEConnection({
      deviceId,
      success: () => resolve(),
      fail: (err) => reject(err)
    })
  })
}

/**
 * 获取 BLE 设备服务列表
 */
export function getBLEDeviceServices(deviceId: string): Promise<WechatMiniprogram.BluetoothService[]> {
  return new Promise((resolve, reject) => {
    wx.getBLEDeviceServices({
      deviceId,
      success: (res) => resolve(res.services),
      fail: (err) => reject(err)
    })
  })
}

/**
 * 获取 BLE 设备特征值列表（筛选支持 write 的特征值）
 */
export function getBLEDeviceCharacteristics(
  deviceId: string,
  serviceId: string
): Promise<WechatMiniprogram.BLECharacteristic[]> {
  return new Promise((resolve, reject) => {
    wx.getBLEDeviceCharacteristics({
      deviceId,
      serviceId,
      success: (res) => resolve(res.characteristics),
      fail: (err) => reject(err)
    })
  })
}

/**
 * 查找支持写入的特征值
 * BLE 写入需使用 write 或 writeNoResponse 属性的特征值
 */
export async function findWritableCharacteristic(
  deviceId: string
): Promise<BLECharacteristic> {
  const services = await getBLEDeviceServices(deviceId)

  for (const service of services) {
    const characteristics = await getBLEDeviceCharacteristics(
      deviceId,
      service.uuid
    )
    const writable = characteristics.find(
      (c) => c.properties.write || c.properties.writeNoResponse
    )
    if (writable) {
      return { uuid: writable.uuid, serviceId: service.uuid }
    }
  }

  throw new Error('未找到支持写入的 BLE 特征值')
}

/**
 * 查找支持通知的特征值
 * BLE 接收数据需使用 notify 或 indicate 属性的特征值
 */
export async function findNotifyCharacteristic(
  deviceId: string
): Promise<BLECharacteristic> {
  const services = await getBLEDeviceServices(deviceId)

  for (const service of services) {
    const characteristics = await getBLEDeviceCharacteristics(
      deviceId,
      service.uuid
    )
    const notifyable = characteristics.find(
      (c) => c.properties.notify || c.properties.indicate
    )
    if (notifyable) {
      return { uuid: notifyable.uuid, serviceId: service.uuid }
    }
  }

  throw new Error('未找到支持通知的 BLE 特征值')
}

/**
 * 启用特征值通知
 */
export function enableBLECharacteristicNotify(
  deviceId: string,
  serviceId: string,
  characteristicId: string,
  state: boolean = true
): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.notifyBLECharacteristicValueChange({
      deviceId,
      serviceId,
      characteristicId,
      state,
      success: () => resolve(),
      fail: (err) => reject(err)
    })
  })
}

/**
 * 监听特征值变化（接收数据）
 */
export function onBLECharacteristicValueChange(
  callback: (res: WechatMiniprogram.OnBLECharacteristicValueChangeCallbackResult) => void
): void {
  wx.onBLECharacteristicValueChange(callback)
}

/**
 * 移除特征值变化监听
 */
export function offBLECharacteristicValueChange(
  callback?: (res: WechatMiniprogram.OnBLECharacteristicValueChangeCallbackResult) => void
): void {
  wx.offBLECharacteristicValueChange(callback)
}

/**
 * 向 BLE 特征值写入数据
 * 注意：单次写入长度受 BLE MTU 限制（通常 20 字节以内安全）
 */
export function writeBLECharacteristicValue(
  deviceId: string,
  serviceId: string,
  characteristicId: string,
  value: ArrayBuffer
): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.writeBLECharacteristicValue({
      deviceId,
      serviceId,
      characteristicId,
      value,
      success: () => resolve(),
      fail: (err) => reject(err)
    })
  })
}
