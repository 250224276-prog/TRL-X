
App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-8g7flmwwa4402751',
        traceUser: true,
      });
      console.log('☁️ 云开发初始化成功！');
    }
  },

  globalData: {
    isConnected: false,
    deviceName: '',
    connectedDeviceId: null,
    writeCharacteristic: null,
    notifyCharacteristic: null
  }
})

