// pages/index/index.js

// 获取小程序的全局实例
const app = getApp();

// 获取云端数据库的遥控器
const db = wx.cloud.database();

Page({
  data: {
    // 初始设为空数组，等云端数据回来再填满
    raceList: [],
    
    // 控制顶部 UI 状态的变量
    isConnected: false,
    deviceName: 'AST的\nRMB PRO' 
  },

  // 页面加载时触发，去云端拉取数据
  onLoad() {
    this.fetchCloudRaces();
  },

  onShow() {
    // 隐藏微信官方原生的底部栏，只用我们自己画的 custom-tabbar
    wx.hideTabBar(); 
    
    // 保持原本的判断登录连接状态的代码不变
    if (app.globalData && app.globalData.isConnected) {
      this.setData({
        isConnected: true,
        deviceName: app.globalData.deviceName || 'AST的\nRMB PRO'
      });
    }
  },

  // ✨ 去云端拉取比赛数据的核心函数（包含时间自动排序魔法）
  fetchCloudRaces() {
    wx.showLoading({ title: '加载赛事中...', mask: true });

    // 去名为 'races' 的集合里拿数据
    db.collection('races').get({
      success: res => {
        console.log("☁️ 云端获取的原始数据：", res.data);

        // ✨ 核心魔法：按比赛日期进行“升序”排列（时间越早越靠前）
        let sortedRaces = res.data.sort((a, b) => {
          // 将 "2026年 3月 29号" 转化为计算机能对比的时间戳数字
          const parseTime = (dateStr) => {
            if (!dateStr) return 0;
            // 提取字符串里的所有数字（年、月、日）
            const nums = dateStr.match(/\d+/g); 
            if (nums && nums.length >= 3) {
              // JS 的 Date 对象里，月份是从 0 开始的，所以要减去 1
              return new Date(nums[0], nums[1] - 1, nums[2]).getTime();
            }
            return 0; // 格式解析失败则默认排到最前面
          };

          // 比较两场比赛的时间
          return parseTime(a.date) - parseTime(b.date);
        });

        // 把排好序的数组塞进页面！
        this.setData({
          raceList: sortedRaces 
        });
        
        wx.hideLoading();
      },
      fail: err => {
        console.error("❌ 获取云端数据失败：", err);
        wx.hideLoading();
        wx.showToast({ title: '网络请求失败', icon: 'none' });
      }
    });
  },

  goToConnect() {
    wx.navigateTo({ url: '/pages/ble-connect/ble-connect' });
  },

  goToMore() {
    wx.navigateTo({ url: '/pages/race-list/race-list' });
  },

  goToDetail(e) {
    const raceId = e.currentTarget.dataset.id;
    console.log("👉 第一步：检测到点击！拿到的赛事ID是：", raceId);

    wx.navigateTo({
      // 这里的路径必须和 app.json 里配置的一模一样
      url: `/pages/race-detail/race-detail?id=${raceId}`,
      success: function() {
        console.log("✅ 第二步：跳转页面成功！");
      },
      fail: function(err) {
        console.error("❌ 第二步：跳转失败！微信给出的原因是：", err);
      }
    });
  },

  goToProfile() {
    wx.switchTab({
      url: '/pages/profile/profile'
    });
  }
  
})