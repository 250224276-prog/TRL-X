const app = getApp();

Page({
  data: {
    isLoggedIn: false,
    userName: '',
    isAdmin: false
  },

  onShow() {
    wx.hideTabBar();

    if (app.globalData && app.globalData.isLoggedIn) {
      this.setData({
        isLoggedIn: true,
        userName: app.globalData.userName || 'AST 探险家',
        isAdmin: Boolean(app.globalData.isAdmin)
      });
      return;
    }

    this.setData({
      isLoggedIn: false,
      userName: '',
      isAdmin: false
    });
  },

  goToAdminPortal() {
    if (!this.data.isAdmin) {
      wx.showModal({
        title: '无权限访问',
        content: '请先登录指定管理员账号',
        showCancel: false
      });
      return;
    }

    wx.navigateTo({
      url: '/pages/admin-race-add/admin-race-add'
    });
  },

  handleCardClick() {
    if (!this.data.isLoggedIn) {
      wx.navigateTo({ url: '/pages/login/login' });
      return;
    }

    wx.showModal({
      title: '账户设置',
      content: '确定要退出当前账号吗？',
      confirmColor: '#FF9849',
      success: (res) => {
        if (!res.confirm) return;

        if (typeof app.clearAuthState === 'function') {
          app.clearAuthState();
        } else {
          app.globalData.isLoggedIn = false;
          app.globalData.userName = '';
          app.globalData.isAdmin = false;
        }

        this.onShow();
        wx.showToast({ title: '已安全退出', icon: 'success' });
      }
    });
  },

  goToIndex() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  goToAiChat() {
    wx.navigateTo({ url: '/pages/ai-chat/ai-chat' });
  },

  testParseGpx() {
    wx.showLoading({ title: '引擎解析中...', mask: true });
    wx.cloud.callFunction({
      name: 'parseGpx',
      data: {
        fileID: 'cloud://cloud1-8g7flmwwa4402751.636c-cloud1-8g7flmwwa4402751-1370853424/gpx-tracks/168Km～2025深圳100跑山赛～1218.gpx',
        fileName: '168Km～2025深圳100跑山赛～1218.gpx'
      },
      success: (res) => {
        wx.hideLoading();
        console.log('V8 引擎解析完成', res.result);
        if (res.result && res.result.success) {
          wx.showToast({ title: '解析成功，快看控制台', icon: 'none', duration: 3000 });
        } else {
          wx.showToast({ title: '解析遇到问题', icon: 'error' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络或部署异常', icon: 'error' });
      }
    });
  }
});
