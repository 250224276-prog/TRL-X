const {
  openBluetoothAdapter,
  closeBluetoothAdapter,
  startBluetoothDevicesDiscovery,
  stopBluetoothDevicesDiscovery,
  createBLEConnection,
  closeBLEConnection,
  findWritableCharacteristic,
  findNotifyCharacteristic,
  enableBLECharacteristicNotify,
  onBLECharacteristicValueChange
} = require('../../utils/ble')

Page({
  data: {
    isSearching: true,
    deviceList: [],
    connectingDeviceId: null,
    status: 'idle'
  },

  onLoad() {
    console.log('进入设备连接页面，开始搜索...')
    this.startDiscovery()
  },

  onUnload() {
    this.stopDiscovery()
  },

  goBack() {
    wx.navigateBack()
  },

  async startDiscovery() {
    try {
      this.setData({ isSearching: true, status: 'scanning' })
      await openBluetoothAdapter()
      console.log('蓝牙适配器已打开')

      wx.onBluetoothDeviceFound(this.onDeviceFound.bind(this))
      await startBluetoothDevicesDiscovery()
      console.log('开始搜索设备')

      setTimeout(() => {
        this.stopDiscovery()
      }, 15000)
    } catch (err) {
      console.error('启动搜索失败:', err)
      wx.showToast({
        title: '蓝牙不可用',
        icon: 'none'
      })
      this.setData({ isSearching: false, status: 'idle' })
    }
  },

  onDeviceFound(res) {
    const devices = res.devices
    if (!devices || devices.length === 0) return

    devices.forEach(device => {
      if (!device.name || device.name.trim() === '') return

      const existingIndex = this.data.deviceList.findIndex(d => d.deviceId === device.deviceId)

      const newDevice = {
        deviceId: device.deviceId,
        name: device.name || '未知设备',
        rssi: device.RSSI || -100,
        signal: this.getSignalStrength(device.RSSI)
      }

      if (existingIndex === -1) {
        this.setData({
          deviceList: [...this.data.deviceList, newDevice]
        })
      } else {
        const newList = [...this.data.deviceList]
        newList[existingIndex] = newDevice
        this.setData({ deviceList: newList })
      }
    })
  },

  getSignalStrength(rssi) {
    if (!rssi) return '弱'
    if (rssi >= -50) return '强'
    if (rssi >= -70) return '中'
    return '弱'
  },

  async stopDiscovery() {
    try {
      await stopBluetoothDevicesDiscovery()
      console.log('停止搜索设备')
    } catch (err) {
      console.error('停止搜索失败:', err)
    }
    this.setData({ isSearching: false })
  },

  async connectDevice(e) {
    const deviceId = e.currentTarget.dataset.deviceid
    const deviceName = e.currentTarget.dataset.name

    if (this.data.status === 'connecting') {
      return
    }

    this.setData({
      connectingDeviceId: deviceId,
      status: 'connecting'
    })

    wx.showLoading({
      title: '正在连接...',
      mask: true
    })

    try {
      await this.stopDiscovery()

      console.log('正在连接设备:', deviceId, deviceName)
      await createBLEConnection(deviceId)
      console.log('设备连接成功')

      const writeChar = await findWritableCharacteristic(deviceId)
      console.log('找到可写入特征值:', writeChar)

      const notifyChar = await findNotifyCharacteristic(deviceId)
      console.log('找到可通知特征值:', notifyChar)

      await enableBLECharacteristicNotify(deviceId, notifyChar.serviceId, notifyChar.uuid, true)
      console.log('通知已启用')

      onBLECharacteristicValueChange((res) => {
        console.log('接收到设备数据:', res)
        this.handleReceivedData(res.value)
      })

      const app = getApp()
      app.globalData.isConnected = true
      app.globalData.deviceName = deviceName
      app.globalData.connectedDeviceId = deviceId
      app.globalData.writeCharacteristic = writeChar
      app.globalData.notifyCharacteristic = notifyChar

      wx.hideLoading()
      wx.showToast({
        title: '连接成功',
        icon: 'success'
      })

      this.setData({
        status: 'connected',
        connectingDeviceId: null
      })

      setTimeout(() => {
        wx.navigateBack()
      }, 1000)

    } catch (err) {
      console.error('连接设备失败:', err)
      wx.hideLoading()
      wx.showToast({
        title: '连接失败',
        icon: 'none'
      })
      this.setData({
        status: 'idle',
        connectingDeviceId: null
      })
    }
  },

  handleReceivedData(value) {
    const hex = Array.from(new Uint8Array(value))
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ')
    console.log('收到数据 (HEX):', hex)
  },

  async disconnectDevice() {
    const app = getApp()
    if (!app.globalData.connectedDeviceId) return

    try {
      await closeBLEConnection(app.globalData.connectedDeviceId)
      app.globalData.isConnected = false
      app.globalData.deviceName = ''
      app.globalData.connectedDeviceId = null
      app.globalData.writeCharacteristic = null
      app.globalData.notifyCharacteristic = null

      wx.showToast({
        title: '已断开连接',
        icon: 'none'
      })
    } catch (err) {
      console.error('断开连接失败:', err)
    }
  },

  refreshList() {
    this.setData({ deviceList: [] })
    this.startDiscovery()
  }
})