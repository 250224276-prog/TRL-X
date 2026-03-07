// pages/plan-result/plan-result.js
const app = getApp();

Page({
  data: {
    raceName: '加载中...',
    startTime: '07:00',
    targetHours: 21,
    targetMinutes: 43,
    checkpoints: [],
    K: 1.07
  },

  onLoad(options) {
    this.setData({
      targetHours: options.h || '21',
      targetMinutes: options.m || '43'
    });

    const eventChannel = this.getOpenerEventChannel();
    eventChannel.on('acceptDataFromOpenerPage', (data) => {
      this.setData({ raceName: data.name || '越野赛' });
      this.initData(data.checkpoints);
    });
  },

  // ✨ 1. 数据初始化：加入 DP(换装点) 侦测逻辑
  initData(rawCps) {
    const cps = rawCps.map((cp, i, arr) => {
      const segDist = i === 0 ? 0 : parseFloat((cp.accDist - arr[i-1].accDist).toFixed(2));
      const segGain = i === 0 ? 0 : Math.max(0, cp.accGain - arr[i-1].accGain);
      const segLoss = i === 0 ? 0 : Math.max(0, (cp.accLoss || 0) - (arr[i-1].accLoss || 0));
      
      // 🕵️‍♂️ 侦测换装点
      const originalName = (cp.name || '').toUpperCase();
      const isDropBag = originalName.includes('DP') || originalName.includes('换装');

      // 规范化命名
      let stdName = '';
      if (i === 0) stdName = '起点';
      else if (i === arr.length - 1) stdName = '终点';
      else stdName = `CP${i}`;

      // 休息时间逻辑分流
      let defaultRest = 5;
      if (i === 0 || i === arr.length - 1) defaultRest = 0;
      else if (isDropBag) defaultRest = 30;

      return {
        ...cp,
        name: stdName, 
        isDropBag: isDropBag, 
        segDist,
        segGain,
        segLoss,
        rest: defaultRest, 
        moveMins: 0 
      };
    });
    this.setData({ checkpoints: cps }, () => {
      this.runFatigueEngine(); 
    });
  },

  // 2. 🚀 核心：K=1.07 非线性疲劳引擎
  runFatigueEngine() {
    const { targetHours, targetMinutes, checkpoints, K } = this.data;
    const targetMins = (parseInt(targetHours) || 0) * 60 + (parseInt(targetMinutes) || 0);
    
    let totalED = 0;
    const dataWithED = checkpoints.map(cp => {
      const segED = cp.segDist + (cp.segGain / 100); 
      totalED += segED;
      return { ...cp, segED };
    });

    const totalRest = dataWithED.reduce((sum, cp) => sum + parseInt(cp.rest || 0), 0);
    const movingMins = targetMins - totalRest;

    if (movingMins <= 0) {
      wx.showToast({ title: '目标时间太紧！', icon: 'none' });
      return;
    }

    const a = movingMins / Math.pow(totalED, K);
    let runningED = 0;

    const enginedCps = dataWithED.map((cp, i) => {
      if (i === 0) return { ...cp, moveMins: 0 };
      const prevED = runningED;
      runningED += cp.segED;
      const curMoveMins = Math.round(a * Math.pow(runningED, K) - a * Math.pow(prevED, K));
      return { ...cp, moveMins: curMoveMins };
    });

    this.setData({ checkpoints: enginedCps }, () => {
      this.updateTimeline(); 
    });
  },

  // 3. ⏱️ 时间汇总器
  updateTimeline() {
    let { checkpoints } = this.data;
    let totalComputedMins = 0;

    for (let i = 0; i < checkpoints.length; i++) {
      totalComputedMins += parseInt(checkpoints[i].moveMins || 0);
      totalComputedMins += parseInt(checkpoints[i].rest || 0);
    }

    this.setData({ 
      checkpoints,
      targetHours: Math.floor(totalComputedMins / 60),
      targetMinutes: Math.floor(totalComputedMins % 60)
    });
  },

  // 4. 局部修改触发器
  onManualUpdate(e) {
    const { index, type } = e.currentTarget.dataset;
    const val = parseInt(e.detail.value) || 0;
    let { checkpoints } = this.data;

    if (type === 'rest') checkpoints[index].rest = val;
    else if (type === 'move') checkpoints[index].moveMins = val;
    
    this.setData({ checkpoints }, () => this.updateTimeline());
  },

  // 5. 底部按钮预留方法
  savePlanImage() {
    wx.showToast({ title: '保存图片功能开发中...', icon: 'none' });
  },

  syncToHardware() {
    wx.showToast({ title: '硬件通讯接口预留', icon: 'none' });
  },

  goToSegmentDetail(e) {
    const idx = e.currentTarget.dataset.index;
    wx.navigateTo({ url: `/pages/plan-segment/plan-segment?idx=${idx}` });
  },

  goBack() { wx.navigateBack(); }
});