// 页面：首页，显示设备状态、近期计划和赛事入口
const app = getApp();
const db = wx.cloud.database();

Page({
  data: {
    raceList: [], 
    myPlans: [],  
    
    isConnected: false,
    deviceName: 'AST的\nRMB PRO',
    hasMoreRaces: false 
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

  // ✨ 新增：组别颜色智能解析引擎
  getGroupColor(distStr) {
    if (!distStr) return '#36E153'; // 默认绿色
    // 提取字符串中的数字部分
    let numStr = distStr.replace(/[^\d.]/g, ''); 
    let dist = parseFloat(numStr) || 0;
    
    // 按照赛事筛选的里程标准划分颜色
    if (dist < 30) return '#36E153';       // 绿色 (短距离)
    if (dist < 60) return '#FF9811';       // 橙色 (中距离)
    if (dist < 100) return '#3284FF';      // 蓝色 (长距离)
    return '#F94747';                      // 红色 (超长距离 100km+)
  },

  fetchMyPlans() {
    db.collection('user_plans').orderBy('raceDateMs', 'asc').get({
      success: res => {
        let plans = res.data;
        const nowMs = new Date().setHours(0, 0, 0, 0); 

        let futurePlans = [];

        plans.forEach(p => {
          let daysLeft = -1;
          if (p.raceDateMs && p.raceDateMs >= nowMs) {
            daysLeft = Math.ceil((p.raceDateMs - new Date().getTime()) / (1000 * 60 * 60 * 24));
            if (daysLeft < 0) daysLeft = 0; 
          } else {
            return; 
          }
          
          let pureName = p.raceName || '';
          if (p.groupDist && pureName.includes(p.groupDist)) {
            pureName = pureName.replace(` - ${p.groupDist}`, '').replace(p.groupDist, '').trim();
          }

          // ✨ 给每个计划动态计算组别颜色
          let groupColor = this.getGroupColor(p.groupDist);

          futurePlans.push({
            ...p,
            pureRaceName: pureName,
            groupColor: groupColor, // 注入颜色变量
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
    const nowMs = new Date().setHours(0, 0, 0, 0); 

    db.collection('races').get({
      success: res => {
        let sortedRaces = res.data.sort((a, b) => {
          return this.parseTime(a.date) - this.parseTime(b.date);
        });

        let futureRaces = sortedRaces.filter(race => {
          return this.parseTime(race.date) >= nowMs;
        });

        const MAX_DISPLAY = 10;
        const displayRaces = futureRaces.slice(0, MAX_DISPLAY);
        const hasMore = futureRaces.length > MAX_DISPLAY;

        this.setData({ 
          raceList: displayRaces,
          hasMoreRaces: hasMore 
        });
        
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
    if (!planId) {
      wx.showToast({ title: '数据异常无法跳转', icon: 'none' });
      return;
    }

    wx.navigateTo({
      url: `/pages/plan-result/plan-result?id=${planId}`,
      fail: err => {
        console.error("❌ 跳转失败：", err);
        wx.showToast({ title: '页面跳转失败', icon: 'none' });
      }
    });
  },

  goToMorePlans() { wx.navigateTo({ url: '/pages/my-plans/my-plans' }); },
  goToConnect() { wx.navigateTo({ url: '/pages/ble-connect/ble-connect' }); },
  goToMore() { wx.navigateTo({ url: '/pages/race-list/race-list' }); },
  goToDetail(e) { wx.navigateTo({ url: `/pages/race-detail/race-detail?id=${e.currentTarget.dataset.id}` }); },
  goToProfile() { wx.switchTab({ url: '/pages/profile/profile' }); }
});