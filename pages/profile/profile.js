// 页面：个人中心，显示登录状态和控制台入口
// pages/profile/profile.js
const app = getApp(); // 引入全局大脑

Page({
  data: {
    isLoggedIn: false, // 是否已登录
    userName: '',
    isAdmin: false     // 是否为主理人
  },

  onShow() {
    wx.hideTabBar(); 

    // ✨ 核心：每次进入页面，从全局大脑读取最新状态（无论是刚进来，还是刚登录完退回来）
    if (app.globalData && app.globalData.isLoggedIn) {
      this.setData({
        isLoggedIn: true,
        userName: app.globalData.userName || 'AST 探险家',
        isAdmin: app.globalData.isAdmin || false // 从全局读取主理人权限！
      });
    } else {
      // 没登录时，清空数据，确保防盗门锁死
      this.setData({
        isLoggedIn: false,
        userName: '',
        isAdmin: false
      });
    }
  },

  // 点击前往上新控制台
  goToAdminPortal() {
    wx.navigateTo({
      url: '/pages/admin-race-add/admin-race-add'
    });
  },

  // 点击顶部名片栏
  handleCardClick() {
    if (!this.data.isLoggedIn) {
      // 如果没登录，跳转到我们刚刚写好的专属登录页面！
      wx.navigateTo({ url: '/pages/login/login' });
    } else {
      // 如果已登录，顺手加一个“退出登录”的功能
      wx.showModal({
        title: '账户设置',
        content: '确定要退出当前账号吗？',
        confirmColor: '#FF9849',
        success: (res) => {
          if (res.confirm) {
            app.globalData.isLoggedIn = false;
            app.globalData.userName = '';
            app.globalData.isAdmin = false;
            this.onShow(); // 刷新页面状态，隐藏入口
            wx.showToast({ title: '已安全退出', icon: 'success' });
          }
        }
      });
    }
  },

  goToIndex() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  // ==========================================
  // 🚀 V8 引擎解析测试入口 (保留给你未来测试用)
  // ==========================================
  testParseGpx() {
    wx.showLoading({ title: '引擎狂暴解析中...', mask: true });
    wx.cloud.callFunction({
      name: 'parseGpx', 
      data: {
        fileID: 'cloud://cloud1-8g7flmwwa4402751.636c-cloud1-8g7flmwwa4402751-1370853424/gpx-tracks/168Km～2025深圳100跑山赛～1218.gpx',
        fileName: '168Km～2025深圳100跑山赛～1218.gpx'
      },
      success: res => {
        wx.hideLoading();
        console.log("🔥 V8引擎解析完成！完美的赛段数据如下：", res.result);
        if (res.result && res.result.success) {
          wx.showToast({ title: '解析成功！快看控制台', icon: 'none', duration: 3000 });
        } else {
          wx.showToast({ title: '解析遇到了问题', icon: 'error' });
        }
      },
      fail: err => {
        wx.hideLoading();
        wx.showToast({ title: '网络或部署异常', icon: 'error' });
      }
    });
  }
})
