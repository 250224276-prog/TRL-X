// 页面：登录注册，显示账号登录和新用户注册
const app = getApp();
const db = wx.cloud.database();

Page({
  data: {
    isLoginMode: true, // true 为登录模式，false 为注册模式
    username: '',
    password: ''
  },

  // 切换模式
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({ 
      isLoginMode: mode === 'login',
      username: '',
      password: ''
    });
  },

  // 核心提交逻辑
  handleSubmit() {
    const { username, password, isLoginMode } = this.data;
    if (!username || !password) {
      wx.showToast({ title: '请输入代号与密钥', icon: 'none' });
      return;
    }

    wx.showLoading({ title: isLoginMode ? '验证中...' : '档案生成中...' });

    if (isLoginMode) {
      // 🟢 登录逻辑
      db.collection('users').where({
        username: username,
        password: password
      }).get({
        success: res => {
          wx.hideLoading();
          if (res.data.length > 0) {
            const userDoc = res.data[0];
            // 登录成功！把信息存入全局大脑
            app.globalData.isLoggedIn = true;
            app.globalData.userName = userDoc.username;
            app.globalData.isAdmin = userDoc.role === 'admin'; // ✨ 判断是不是管理员！
            
            wx.showToast({ title: '身份确认', icon: 'success' });
            setTimeout(() => { wx.navigateBack(); }, 1000);
          } else {
            wx.showToast({ title: '账号或密码错误', icon: 'error' });
          }
        },
        fail: err => { wx.hideLoading(); wx.showToast({ title: '网络异常', icon: 'none' }); }
      });
    } else {
      // 🔵 注册逻辑
      // 1. 先查一下名字有没有被抢注
      db.collection('users').where({ username: username }).get({
        success: res => {
          if (res.data.length > 0) {
            wx.hideLoading();
            wx.showToast({ title: '代号已被占用', icon: 'none' });
          } else {
            // 2. 没被抢注，创建新档案
            db.collection('users').add({
              data: {
                username: username,
                password: password,
                role: 'user', // ✨ 默认注册的全是普通用户
                createdAt: db.serverDate()
              },
              success: addRes => {
                wx.hideLoading();
                wx.showToast({ title: '档案创建成功！', icon: 'success' });
                // 自动切换回登录模式
                this.setData({ isLoginMode: true, password: '' });
              }
            });
          }
        }
      });
    }
  },

  goBack() { wx.navigateBack(); }
});
