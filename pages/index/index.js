// 页面：首页，显示设备状态、近期计划和赛事入口
const app = getApp();
const db = wx.cloud.database();

Page({
  data: {
    raceList: [], 
    myPlans: [],  
    
    isConnected: false,
    deviceName: 'AST的\nRMB PRO' 
  },

  onLoad() {
    this.fetchCloudRaces();
    this.fetchMyPlans();
  },

  onShow() {
    wx.hideTabBar(); 
    
    if (app.globalData && app.globalData.isConnected) {
      this.setData({
        isConnected: true,
        deviceName: app.globalData.deviceName || 'AST的\nRMB PRO'
      });
    }
    this.fetchMyPlans();
  },

  fetchMyPlans() {
    db.collection('user_plans').orderBy('raceDateMs', 'asc').get({
      success: res => {
        let plans = res.data;
        const nowMs = new Date().setHours(0, 0, 0, 0); // 获取今天凌晨0点的时间戳

        let futurePlans = [];

        plans.forEach(p => {
          let daysLeft = -1;
          if (p.raceDateMs && p.raceDateMs >= nowMs) {
            // 计算剩余天数，防止同一天被算成负数
            daysLeft = Math.ceil((p.raceDateMs - new Date().getTime()) / (1000 * 60 * 60 * 24));
            if (daysLeft < 0) daysLeft = 0; // 兜底：如果是今天，直接置为 0
          } else {
            // 比赛时间在今天之前，直接跳过不展示在首页
            return; 
          }
          
          let pureName = p.raceName || '';
          if (p.groupDist && pureName.includes(p.groupDist)) {
            pureName = pureName.replace(` - ${p.groupDist}`, '').replace(p.groupDist, '').trim();
          }

          futurePlans.push({
            ...p,
            pureRaceName: pureName,
            daysLeft: daysLeft,
            displayTime: p.targetHours ? `${p.targetHours}h ${p.targetMinutes}min` : '未制定计划'
          });
        });

        this.setData({ myPlans: futurePlans });
      },
      fail: err => {
        console.error("获取我的计划失败:", err);
      }
    });
  },

  parseTime(dateStr) {
    if (!dateStr) return 0;
    const nums = dateStr.match(/\d+/g); 
    if (nums && nums.length >= 3) {
      return new Date(nums[0], nums[1] - 1, nums[2]).getTime();
    }
    return 0;
  },

  fetchCloudRaces() {
    wx.showLoading({ title: '加载中...', mask: true });
    const nowMs = new Date().setHours(0, 0, 0, 0); // 获取今天凌晨0点

    db.collection('races').get({
      success: res => {
        let sortedRaces = res.data.sort((a, b) => {
          return this.parseTime(a.date) - this.parseTime(b.date);
        });

        // 过滤：只保留日期大于等于今天的比赛
        let futureRaces = sortedRaces.filter(race => {
          return this.parseTime(race.date) >= nowMs;
        });

        this.setData({ raceList: futureRaces });
        wx.hideLoading();
      },
      fail: err => {
        console.error("❌ 获取云端数据失败：", err);
        wx.hideLoading();
      }
    });
  },

  goToMyPlan(e) {
    const planId = e.currentTarget.dataset.id;
    console.log("👉 [点击我的计划] 拿到的计划ID是：", planId);
    
    if (!planId) {
      wx.showToast({ title: '数据异常无法跳转', icon: 'none' });
      return;
    }

    wx.navigateTo({
      url: `/pages/plan-result/plan-result?id=${planId}`,
      fail: err => {
        console.error("❌ 跳转到 plan-result 失败：", err);
        wx.showToast({ title: '页面跳转失败', icon: 'none' });
      }
    });
  },

  goToMorePlans() {
    wx.navigateTo({ url: '/pages/my-plans/my-plans' });
  },

  goToConnect() { wx.navigateTo({ url: '/pages/ble-connect/ble-connect' }); },
  goToMore() { wx.navigateTo({ url: '/pages/race-list/race-list' }); },
  goToDetail(e) {
    wx.navigateTo({ url: `/pages/race-detail/race-detail?id=${e.currentTarget.dataset.id}` });
  },
  goToProfile() { wx.switchTab({ url: '/pages/profile/profile' }); }
});
