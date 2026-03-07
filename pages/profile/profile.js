// pages/profile/profile.js
const app = getApp(); // 引入全局公告板

Page({
  data: {
    isLoggedIn: false, // 是否已登录
    userName: ''
  },

  onShow() {
    wx.hideTabBar(); 

    // 保持原本的登录判断代码不变
    if (app.globalData && app.globalData.isLoggedIn) {
      this.setData({
        isLoggedIn: true,
        userName: app.globalData.userName || 'AST 探险家_007'
      });
    }
  },

  // 点击顶部名片栏
  handleCardClick() {
    if (!this.data.isLoggedIn) {
      // 如果没登录，跳转到专门的登录页面 (咱们下一步就建这个页面)
      wx.navigateTo({
        url: '/pages/login/login' 
      });
    } else {
      // 如果已登录，可以跳转到个人资料编辑页
      wx.showToast({ title: '查看个人资料', icon: 'none' });
    }
  },

  goToIndex() {
    wx.switchTab({
      url: '/pages/index/index'
    });
  },

  // ==========================================
  // 🚀 隐藏的超级管理员大招：呼叫 V8 引擎解析深百 168km GPX
  // ==========================================
  testParseGpx() {
    wx.showLoading({ title: '引擎狂暴解析中...', mask: true });

    // 呼叫我们刚刚部署好的云函数
    wx.cloud.callFunction({
      name: 'parseGpx', // 就是那个带有云朵的文件夹名字
      data: {
        // 传入你刚刚复制的深圳100燃料 File ID
        fileID: 'cloud://cloud1-8g7flmwwa4402751.636c-cloud1-8g7flmwwa4402751-1370853424/gpx-tracks/168Km～2025深圳100跑山赛～1218.gpx',
        fileName: '168Km～2025深圳100跑山赛～1218.gpx'
      },
      success: res => {
        wx.hideLoading();
        // ✨ 见证奇迹的时刻！把云端算好的数据打印在控制台
        console.log("🔥 V8引擎解析完成！完美的赛段数据如下：", res.result);
        
        if (res.result && res.result.success) {
          wx.showToast({ title: '解析成功！快看控制台', icon: 'none', duration: 3000 });
        } else {
          console.error("⚠️ 解析逻辑报错：", res.result);
          wx.showToast({ title: '解析遇到了问题', icon: 'error' });
        }
      },
      fail: err => {
        wx.hideLoading();
        console.error("❌ 呼叫引擎失败（可能是还没部署好或者网断了）：", err);
        wx.showToast({ title: '网络或部署异常', icon: 'error' });
      }
    });
  }
})