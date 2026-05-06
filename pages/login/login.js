const app = getApp();
const db = wx.cloud.database();

Page({
  data: {
    isLoginMode: true,
    username: '',
    password: ''
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      isLoginMode: mode === 'login',
      username: '',
      password: ''
    });
  },

  handleSubmit() {
    const { username, password, isLoginMode } = this.data;
    if (!username || !password) {
      wx.showToast({ title: '请输入账号与密码', icon: 'none' });
      return;
    }

    wx.showLoading({ title: isLoginMode ? '验证中...' : '创建中...' });

    if (isLoginMode) {
      db.collection('users').where({
        username,
        password
      }).get({
        success: (res) => {
          wx.hideLoading();

          if (!res.data.length) {
            wx.showToast({ title: '账号或密码错误', icon: 'error' });
            return;
          }

          const userDoc = res.data[0];
          if (typeof app.persistAuthState === 'function') {
            app.persistAuthState({
              isLoggedIn: true,
              userName: userDoc.username,
              isAdmin: userDoc.role === 'admin'
            });
          } else {
            app.globalData.isLoggedIn = true;
            app.globalData.userName = userDoc.username;
            app.globalData.isAdmin = userDoc.role === 'admin';
          }

          wx.showToast({ title: '身份确认', icon: 'success' });
          setTimeout(() => {
            wx.navigateBack();
          }, 1000);
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '网络异常', icon: 'none' });
        }
      });
      return;
    }

    db.collection('users').where({ username }).get({
      success: (res) => {
        if (res.data.length > 0) {
          wx.hideLoading();
          wx.showToast({ title: '账号已被占用', icon: 'none' });
          return;
        }

        db.collection('users').add({
          data: {
            username,
            password,
            role: 'user',
            createdAt: db.serverDate()
          },
          success: () => {
            wx.hideLoading();
            wx.showToast({ title: '创建成功', icon: 'success' });
            this.setData({ isLoginMode: true, password: '' });
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '创建失败', icon: 'none' });
          }
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
