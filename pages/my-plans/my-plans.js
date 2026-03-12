const db = wx.cloud.database();

Page({
  data: {
    statusBarHeight: 20,
    currentTab: 'future', 
    
    allPlans: [],    
    futurePlans: [], 
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

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    // 切换 Tab 时，把所有项的滑动状态复位
    let newDisplay = tab === 'future' ? this.data.futurePlans : this.data.historyPlans;
    newDisplay.forEach(item => item.slideX = 0);

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

        this.setData({
          allPlans: rawPlans,
          futurePlans: future,
          historyPlans: history,
          displayList: this.data.currentTab === 'future' ? future : history
        });
      },
      fail: err => {
        wx.hideLoading();
        console.error("获取计划失败:", err);
      }
    });
  },

  // ==========================================
  // ✨ 触控滑动引擎 (Swipe to Delete)
  // ==========================================
  onTouchStart(e) {
    if (e.touches.length === 1) {
      this.startX = e.touches[0].clientX;
      this.startY = e.touches[0].clientY;
      
      let index = e.currentTarget.dataset.index;
      let list = this.data.displayList;
      let needsUpdate = false;
      list.forEach((item, i) => {
        if (i !== index && item.slideX !== 0) {
          item.slideX = 0;
          needsUpdate = true;
        }
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

      let index = e.currentTarget.dataset.index;
      let list = this.data.displayList;

      if (disX > 0) { 
        let slideX = -disX;
        if (slideX < -80) slideX = -80; 
        list[index].slideX = slideX;
      } else if (disX < 0 && list[index].slideX < 0) {
        let slideX = -80 - disX; 
        if (slideX > 0) slideX = 0;
        list[index].slideX = slideX;
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
      
      // 防手抖：点击不触发缩回
      if (Math.abs(disX) < 5 && Math.abs(disY) < 5) {
        return;
      }

      let index = e.currentTarget.dataset.index;
      let list = this.data.displayList;

      if (list[index].slideX < -40) {
        list[index].slideX = -80;
      } else {
        list[index].slideX = 0;
      }

      this.setData({ displayList: list });
    }
  },

  // ✨ 恢复原生弹窗确认删除
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
          list.forEach(item => item.slideX = 0);
          this.setData({ displayList: list });
        }
      }
    });
  },

  goToMyPlan(e) {
    const index = e.currentTarget.dataset.index;
    const planItem = this.data.displayList[index];

    // 防误触：如果当前项已经被滑开，点击区域只是把它收回，不进行页面跳转
    if (planItem.slideX < -10) {
      let list = this.data.displayList;
      list[index].slideX = 0;
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