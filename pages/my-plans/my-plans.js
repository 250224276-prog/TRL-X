// 页面：全部计划，显示未来/历史计划和删除入口
const db = wx.cloud.database();

function extractDistanceValue(raw = '') {
  const match = String(raw || '').match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

Page({
  data: {
    statusBarHeight: 20,
    currentTab: 'future', 
    
    allPlans: [],    
    futurePlans: [], // 现在存放的是分组后的数据
    historyPlans: [],
    displayList: []  
  },

  onLoad() {
    const systemInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: systemInfo.statusBarHeight });

    this.fetchPlans();
  },

  onShow() {
    if (this.data.allPlans.length > 0) {
       this.fetchPlans();
    }
  },

  goBack() {
    wx.navigateBack();
  },

  getGroupColor(distStr) {
    const dist = extractDistanceValue(distStr);

    if (dist < 30) return '#36E153';
    if (dist < 60) return '#FF9811';
    if (dist < 100) return '#3284FF';
    return '#F94747';
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    // 切换 Tab 时，把所有项的滑动状态复位
    let newDisplay = tab === 'future' ? this.data.futurePlans : this.data.historyPlans;
    newDisplay.forEach(group => {
      group.plans.forEach(item => item.slideX = 0);
    });

    this.setData({
      currentTab: tab,
      displayList: newDisplay
    });
  },

  fetchPlans() {
    wx.showLoading({ title: '加载中...', mask: true });

    db.collection('user_plans').orderBy('raceDateMs', 'asc').get({
      success: res => {
        wx.hideLoading();
        let rawPlans = res.data;
        
        const nowTime = new Date().getTime();
        const todayZero = new Date().setHours(0, 0, 0, 0); 

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
            groupColor: this.getGroupColor(p.groupDist),
            displayTime: p.targetHours ? `${p.targetHours}h ${p.targetMinutes}min` : '未制定计划',
            slideX: 0 
          };

          if (p.raceDateMs && p.raceDateMs >= todayZero) {
            let daysLeft = Math.ceil((p.raceDateMs - nowTime) / (1000 * 60 * 60 * 24));
            planItem.daysLeft = daysLeft < 0 ? 0 : daysLeft;
            future.push(planItem);
          } else if (p.raceDateMs) {
            history.push(planItem);
          }
        });

        history.sort((a, b) => b.raceDateMs - a.raceDateMs);

        // ✨ 核心调用：将一维数组转换为按月分组的二维数组
        let groupedFuture = this.groupPlans(future);
        let groupedHistory = this.groupPlans(history);

        this.setData({
          allPlans: rawPlans,
          futurePlans: groupedFuture,
          historyPlans: groupedHistory,
          displayList: this.data.currentTab === 'future' ? groupedFuture : groupedHistory
        });
      },
      fail: err => {
        wx.hideLoading();
        console.error("获取计划失败:", err);
      }
    });
  },

  // ✨ 数据分组逻辑：根据 raceDateMs 提取年月进行切割
  groupPlans(plans) {
    if (!plans || plans.length === 0) return [];
    let grouped = [];
    let currentGroup = null;

    plans.forEach(p => {
      let dateObj;
      if (p.raceDateMs) {
        dateObj = new Date(p.raceDateMs);
      } else if (p.raceDate) {
        const nums = p.raceDate.match(/\d+/g);
        if (nums && nums.length >= 2) {
          dateObj = new Date(nums[0], nums[1] - 1);
        } else {
          dateObj = new Date();
        }
      } else {
        dateObj = new Date();
      }

      const year = dateObj.getFullYear();
      const month = dateObj.getMonth() + 1;
      const groupKey = `${year}-${month}`;

      if (!currentGroup || currentGroup.key !== groupKey) {
        currentGroup = {
          key: groupKey,
          monthStr: `${month}月`,
          yearStr: `${year}`,
          plans: []
        };
        grouped.push(currentGroup);
      }
      currentGroup.plans.push(p);
    });
    return grouped;
  },

  // ==========================================
  // ✨ 触控滑动引擎升级：兼容嵌套数组
  // ==========================================
  onTouchStart(e) {
    if (e.touches.length === 1) {
      this.startX = e.touches[0].clientX;
      this.startY = e.touches[0].clientY;
      
      let gIndex = e.currentTarget.dataset.gindex;
      let iIndex = e.currentTarget.dataset.iindex;
      let list = this.data.displayList;
      let needsUpdate = false;
      
      list.forEach((group, gi) => {
        group.plans.forEach((item, ii) => {
          if ((gi !== gIndex || ii !== iIndex) && item.slideX !== 0) {
            item.slideX = 0;
            needsUpdate = true;
          }
        });
      });
      if (needsUpdate) this.setData({ displayList: list });
    }
  },

  onTouchMove(e) {
    if (e.touches.length === 1) {
      let moveX = e.touches[0].clientX;
      let moveY = e.touches[0].clientY;
      let disX = this.startX - moveX;
      let disY = this.startY - moveY;

      if (Math.abs(disY) > Math.abs(disX)) return;

      let gIndex = e.currentTarget.dataset.gindex;
      let iIndex = e.currentTarget.dataset.iindex;
      let list = this.data.displayList;
      let item = list[gIndex].plans[iIndex];

      if (disX > 0) { 
        let slideX = -disX;
        if (slideX < -80) slideX = -80; 
        item.slideX = slideX;
      } else if (disX < 0 && item.slideX < 0) {
        let slideX = -80 - disX; 
        if (slideX > 0) slideX = 0;
        item.slideX = slideX;
      }
      
      this.setData({ displayList: list });
    }
  },

  onTouchEnd(e) {
    if (e.changedTouches.length === 1) {
      let endX = e.changedTouches[0].clientX;
      let endY = e.changedTouches[0].clientY;
      let disX = this.startX - endX;
      let disY = this.startY - endY;
      
      if (Math.abs(disX) < 5 && Math.abs(disY) < 5) {
        return;
      }

      let gIndex = e.currentTarget.dataset.gindex;
      let iIndex = e.currentTarget.dataset.iindex;
      let list = this.data.displayList;
      let item = list[gIndex].plans[iIndex];

      if (item.slideX < -40) {
        item.slideX = -80;
      } else {
        item.slideX = 0;
      }

      this.setData({ displayList: list });
    }
  },

  deletePlan(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定要删除此计划吗？',
      confirmColor: '#FF4D4F',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '删除中...', mask: true });
          db.collection('user_plans').doc(id).remove({
            success: () => {
              wx.hideLoading();
              wx.showToast({ title: '已删除', icon: 'success' });
              this.fetchPlans(); // 重新获取数据
            },
            fail: err => {
              wx.hideLoading();
              wx.showToast({ title: '删除失败', icon: 'none' });
              console.error("删除异常", err);
            }
          });
        } else {
          // 用户取消删除，把弹出来的卡片缩回去
          let list = this.data.displayList;
          list.forEach(group => group.plans.forEach(item => item.slideX = 0));
          this.setData({ displayList: list });
        }
      }
    });
  },

  goToMyPlan(e) {
    const gIndex = e.currentTarget.dataset.gindex;
    const iIndex = e.currentTarget.dataset.iindex;
    const planItem = this.data.displayList[gIndex].plans[iIndex];

    // 防误触：如果当前项已经被滑开，点击区域只是把它收回，不进行页面跳转
    if (planItem.slideX < -10) {
      let list = this.data.displayList;
      list[gIndex].plans[iIndex].slideX = 0;
      this.setData({ displayList: list });
      return;
    }

    const planId = e.currentTarget.dataset.id;
    if (!planId) return;

    wx.navigateTo({
      url: `/pages/plan-result/plan-result?id=${planId}`
    });
  }
});
