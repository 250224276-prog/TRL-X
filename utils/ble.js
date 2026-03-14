
/**
 * BLE 蓝牙工具模块
 * 适配微信小程序低功耗蓝牙 API，注意 BLE 分包大小限制
 */

/**
 * 初始化蓝牙适配器
 */
function openBluetoothAdapter() {
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
function closeBluetoothAdapter() {
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
function startBluetoothDevicesDiscovery() {
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
function stopBluetoothDevicesDiscovery() {
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
function createBLEConnection(deviceId) {
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
function closeBLEConnection(deviceId) {
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
function getBLEDeviceServices(deviceId) {
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
function getBLEDeviceCharacteristics(deviceId, serviceId) {
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
async function findWritableCharacteristic(deviceId) {
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
async function findNotifyCharacteristic(deviceId) {
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
function enableBLECharacteristicNotify(deviceId, serviceId, characteristicId, state = true) {
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
function onBLECharacteristicValueChange(callback) {
  wx.onBLECharacteristicValueChange(callback)
}

/**
 * 移除特征值变化监听
 */
function offBLECharacteristicValueChange(callback) {
  wx.offBLECharacteristicValueChange(callback)
}

/**
 * 向 BLE 特征值写入数据
 * 注意：单次写入长度受 BLE MTU 限制（通常 20 字节以内安全）
 */
function writeBLECharacteristicValue(deviceId, serviceId, characteristicId, value) {
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

module.exports = {
  openBluetoothAdapter,
  closeBluetoothAdapter,
  startBluetoothDevicesDiscovery,
  stopBluetoothDevicesDiscovery,
  createBLEConnection,
  closeBLEConnection,
  getBLEDeviceServices,
  getBLEDeviceCharacteristics,
  findWritableCharacteristic,
  findNotifyCharacteristic,
  enableBLECharacteristicNotify,
  onBLECharacteristicValueChange,
  offBLECharacteristicValueChange,
  writeBLECharacteristicValue
}

