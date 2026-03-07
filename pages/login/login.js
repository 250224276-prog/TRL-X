const app = getApp(); // 引入全局公告板

Page({
  data: {
    isLoginMode: true // true为登录，false为注册
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      isLoginMode: mode === 'login'
    });
  },

  goBack() {
    wx.navigateBack(); // 点击左上角返回
  },

  submitAuth() {
    const actionName = this.data.isLoginMode ? '登录' : '注册';
    
    wx.showLoading({ title: `${actionName}中...`, mask: true });

    // 模拟 1.5 秒网络请求
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({ title: `${actionName}成功`, icon: 'success' });
      
      // ✨ 核心魔法：修改全局变量，记录用户已登录！
      if (!app.globalData) app.globalData = {};
      app.globalData.isLoggedIn = true;
      app.globalData.userName = 'AST 探险家_007'; // 给你一个炫酷的默认昵称
      
      // 延迟 1 秒后自动退回个人中心
      setTimeout(() => {
        wx.navigateBack();
      }, 1000);
      
    }, 1500);
  }
})