// pages/race-detail/race-detail.js
// 获取全局云端数据库引用
const db = wx.cloud.database();
const _ = db.command; // 引入查询指令

Page({
  data: {
    currentTab: 'detail',
    currentGroupIndex: 0,
    raceInfo: null, 
    // 记录用户输入的时间
    targetHours: '',
    targetMinutes: '',
    // 记录当前选中的是哪一个发枪时间（0 = 左边，1 = 右边）
    selectedStartTimeIndex: 0
  },

  // 页面加载时，去云端查找对应的比赛数据
  onLoad(options) {
    const targetId = options.id;
    console.log("详情页准备向云端请求赛事ID：", targetId);

    wx.showLoading({ title: '加载详情中...', mask: true });

    // 隐藏升级：双兼容查询！无论是老数据的 id，还是新上新的 _id，都能精准命中！
    db.collection('races').where(_.or([
      { id: targetId },
      { _id: targetId }
    ])).get({
      success: res => {
        wx.hideLoading();
        // 如果云端返回了数据数组，并且里面有值
        if (res.data && res.data.length > 0) {
          console.log("☁️ 详情页获取云端数据成功：", res.data[0]);
          this.setData({
            raceInfo: res.data[0], // 取出匹配到的第一场比赛并渲染
            currentGroupIndex: 0,
            selectedStartTimeIndex: 0 // 初始化为0
          });
        } else {
          console.error("糟了，云端没找到对应的赛事数据！");
          wx.showToast({ title: '赛事不存在', icon: 'none' });
        }
      },
      fail: err => {
        wx.hideLoading();
        console.error("❌ 详情页云端请求失败：", err);
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  goBack() {
    wx.navigateBack();
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ currentTab: tab });
  },

  switchGroup(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ 
      currentGroupIndex: index,
      selectedStartTimeIndex: 0 // 切换距离组别时，自动重置发枪时间为第一发
    });
  },

  // 点击发枪胶囊时的切换逻辑
  selectStartTime(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ selectedStartTimeIndex: index });
  },

  inputHours(e) {
    this.setData({ targetHours: e.detail.value });
  },

  inputMinutes(e) {
    this.setData({ targetMinutes: e.detail.value });
  },

  // 生成计划触发器
  generatePlan() {
    const { targetHours, targetMinutes, raceInfo, currentGroupIndex, selectedStartTimeIndex } = this.data;
    
    if (!targetHours && !targetMinutes) {
      wx.showToast({ title: '请输入完赛时间', icon: 'none' });
      return;
    }

    if (!raceInfo || !raceInfo.groups || raceInfo.groups.length === 0) return;

    // 获取当前选中的组别数据
    const currentGroup = raceInfo.groups[currentGroupIndex];

    // 🚨 关键拦截：检查是否有轨迹数据
    if (!currentGroup.checkpoints || currentGroup.checkpoints.length === 0) {
      wx.showToast({ title: '该组别暂无轨迹数据', icon: 'none' });
      return;
    }

    // 极简逻辑：直接根据用户的胶囊选中状态读取对应的发枪时间
    const selectedTime = selectedStartTimeIndex === 0 ? currentGroup.startTime : currentGroup.startTime2;
    // 如果出错了兜底用 07:00
    this.executeJump(selectedTime || currentGroup.startTime || '07:00');
  },

  // 🚀 专门负责携带数据跃迁的核心方法
  executeJump(selectedStartTime) {
    const { targetHours, targetMinutes, raceInfo, currentGroupIndex } = this.data;
    const currentGroup = raceInfo.groups[currentGroupIndex];
    
    const h = targetHours || '0';
    const m = targetMinutes || '0';

    wx.showLoading({ title: '极速生成中...', mask: true });

    setTimeout(() => {
      wx.hideLoading();

      // 📦 超级包裹：把真实距离、爬升和最终确定的发枪时间，以及用于保存计划的赛事基础信息一起带过去
      const draftData = {
        // ✨ 新增：传递用于保存到云端 user_plans 的基础字段
        raceId: raceInfo._id,
        raceDate: raceInfo.date,
        groupDist: currentGroup.dist,
        
        // 原有字段
        name: `${raceInfo.name || 'AST越野赛'} - ${currentGroup.dist}`, 
        checkpoints: currentGroup.checkpoints,
        actualDist: currentGroup.actualDist, 
        elevation: currentGroup.elevation,  
        startTime: selectedStartTime,        
        availableStartTimes: [currentGroup.startTime, currentGroup.startTime2].filter(t => t) 
      };

      console.log("🚀 极速跃迁数据准备就绪！", draftData);

      wx.navigateTo({
        url: `/pages/plan-result/plan-result?h=${h}&m=${m}`,
        success: (navRes) => {
          navRes.eventChannel.emit('acceptDataFromOpenerPage', draftData);
        },
        fail: err => {
          console.error("❌ 跳转失败：", err);
          wx.showToast({ title: '跳转失败', icon: 'error' });
        }
      });
    }, 300); 
  }
});