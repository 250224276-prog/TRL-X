// 页面：设备连接，显示扫描到的设备和模拟连接流程
Page({
  data: {
    isSearching: true, // 控制雷达动画的状态
    deviceList: [
      { id: "BLE_001", name: "AST-Ultra-01", mac: "1A:2B:3C:4D:5E", signal: -45 },
      { id: "BLE_002", name: "TRL-X-Pro", mac: "FF:EE:DD:CC:BB", signal: -78 }
    ]
  },

  onLoad() {
    // 页面加载时自动开始“假装”搜索
    console.log("进入设备连接页面，开始搜索...");
  },

  goBack() {
    wx.navigateBack();
  },

// 点击连接按钮的交互
connectDevice(e) {
  const app = getApp(); // 获取全局公告板
  const deviceName = e.currentTarget.dataset.name;
  
  // 1. 弹出加载圈，假装正在连蓝牙
  wx.showLoading({
    title: '正在连接...',
    mask: true
  });

  // 2. 用 setTimeout 模拟 1.5 秒后连接成功
  setTimeout(() => {
    wx.hideLoading(); // 关掉加载圈
    wx.showToast({ title: '连接成功', icon: 'success' }); // 弹出成功提示
    
    // 3. ✨核心：修改全局变量，记录已连接的手表名字
    // 为了完美还原你的设计图，我把名字强制换行
    app.globalData.isConnected = true;
    app.globalData.deviceName = deviceName.replace('-', '的\n'); // 比如 AST的\nUltra-01

    // 4. 延迟 1 秒后，自动退回主页面
    setTimeout(() => {
      wx.navigateBack();
    }, 1000);
    
  }, 1500);
}
})
