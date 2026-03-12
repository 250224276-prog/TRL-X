const db = wx.cloud.database();

Page({
  data: {
    statusBarHeight: 20,
    currentTab: 'future', // 默认选中 'future' (即将参赛) 或 'history' (历史足迹)
    
    allPlans: [],    // 存放所有拉取回来的数据
    futurePlans: [], // 存放未来的数据
    historyPlans: [],// 存放过去的数据
    displayList: []  // 当前在页面上显示的数据
  },

  onLoad() {
    const systemInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: systemInfo.statusBarHeight });

    this.fetchPlans();
  },

  onShow() {
    // 每次显示页面时刷新数据（防止在详情页改了数据后返回不更新）
    if (this.data.allPlans.length > 0) {
       this.fetchPlans();
    }
  },

  goBack() {
    wx.navigateBack();
  },

  // ✨ 新增：切换 Tab 
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({
      currentTab: tab,
      // 根据点击的 Tab，决定页面上显示哪个数组
      displayList: tab === 'future' ? this.data.futurePlans : this.data.historyPlans
    });
  },

  fetchPlans() {
    wx.showLoading({ title: '加载中...', mask: true });

    db.collection('user_plans').orderBy('raceDateMs', 'asc').get({
      success: res => {
        wx.hideLoading();
        let rawPlans = res.data;
        
        const nowTime = new Date().getTime();
        const todayZero = new Date().setHours(0, 0, 0, 0); // 今天凌晨0点时间戳

        let future = [];
        let history = [];

        rawPlans.forEach(p => {
          let pureName = p.raceName || '';
          if (p.groupDist && pureName.includes(p.groupDist)) {
            pureName = pureName.replace(` - ${p.groupDist}`, '').replace(p.groupDist, '').trim();
          }
          
          let planItem = {
            ...p,
            pureRaceName: pureName,
            displayTime: p.targetHours ? `${p.targetHours}h ${p.targetMinutes}min` : '未制定计划'
          };

          // ✨ 分流逻辑
          if (p.raceDateMs && p.raceDateMs >= todayZero) {
            // 未来或今天的比赛
            let daysLeft = Math.ceil((p.raceDateMs - nowTime) / (1000 * 60 * 60 * 24));
            planItem.daysLeft = daysLeft < 0 ? 0 : daysLeft;
            future.push(planItem);
          } else if (p.raceDateMs) {
            // 过去的比赛
            history.push(planItem);
          }
        });

        // 历史比赛通常希望是最近完赛的排在最上面（倒序）
        history.sort((a, b) => b.raceDateMs - a.raceDateMs);

        this.setData({
          allPlans: rawPlans,
          futurePlans: future,
          historyPlans: history,
          // 更新当前显示列表
          displayList: this.data.currentTab === 'future' ? future : history
        });
      },
      fail: err => {
        wx.hideLoading();
        console.error("获取计划失败:", err);
      }
    });
  },

  goToMyPlan(e) {
    const planId = e.currentTarget.dataset.id;
    if (!planId) return;

    wx.navigateTo({
      url: `/pages/plan-result/plan-result?id=${planId}`
    });
  }
});