App({
  // ✨ 小程序启动时触发，初始化云开发环境
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        // 🎯 已经为你精准填入你的专属环境 ID！
        env: 'cloud1-8g7flmwwa4402751', 
        traceUser: true,
      });
      console.log('☁️ 云开发初始化成功！');
    }
  },

  // 全局数据，所有页面都能访问
  globalData: {
    isConnected: false,    // 默认未连接
    deviceName: ''         // 存手表的名字
  }
})