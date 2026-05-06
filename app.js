const AUTH_STORAGE_KEY = 'trlx_auth_state';

App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: 'cloud1-8g7flmwwa4402751',
        traceUser: true
      });
      console.log('云开发初始化成功');
    }

    this.restoreAuthState();
  },

  restoreAuthState() {
    try {
      const saved = wx.getStorageSync(AUTH_STORAGE_KEY);
      if (!saved || typeof saved !== 'object') return;

      this.globalData.isLoggedIn = Boolean(saved.isLoggedIn);
      this.globalData.userName = saved.userName || '';
      this.globalData.isAdmin = Boolean(saved.isAdmin);
    } catch (err) {
      console.warn('恢复登录状态失败', err);
    }
  },

  persistAuthState(authState = {}) {
    const nextState = {
      isLoggedIn: Boolean(authState.isLoggedIn),
      userName: authState.userName || '',
      isAdmin: Boolean(authState.isAdmin)
    };

    this.globalData.isLoggedIn = nextState.isLoggedIn;
    this.globalData.userName = nextState.userName;
    this.globalData.isAdmin = nextState.isAdmin;

    try {
      wx.setStorageSync(AUTH_STORAGE_KEY, nextState);
    } catch (err) {
      console.warn('保存登录状态失败', err);
    }
  },

  clearAuthState() {
    this.globalData.isLoggedIn = false;
    this.globalData.userName = '';
    this.globalData.isAdmin = false;

    try {
      wx.removeStorageSync(AUTH_STORAGE_KEY);
    } catch (err) {
      console.warn('清理登录状态失败', err);
    }
  },

  globalData: {
    isLoggedIn: false,
    userName: '',
    isAdmin: false,
    isConnected: false,
    deviceName: '',
    connectedDeviceId: null,
    writeCharacteristic: null,
    notifyCharacteristic: null
  }
});
