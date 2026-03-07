// pages/race-detail/race-detail.js
// 获取全局云端数据库引用
const db = wx.cloud.database();

Page({
  data: {
    currentTab: 'detail',
    currentGroupIndex: 0,
    raceInfo: null, 
    // 记录用户输入的时间
    targetHours: '',
    targetMinutes: ''
  },

  // 页面加载时，去云端查找对应的比赛数据
  onLoad(options) {
    const targetId = options.id;
    console.log("详情页准备向云端请求赛事ID：", targetId);

    wx.showLoading({ title: '加载详情中...', mask: true });

    // 去云端数据库 races 集合里，精准查找 id 匹配的那一条
    db.collection('races').where({
      id: targetId
    }).get({
      success: res => {
        wx.hideLoading();
        // 如果云端返回了数据数组，并且里面有值
        if (res.data && res.data.length > 0) {
          console.log("☁️ 详情页获取云端数据成功：", res.data[0]);
          this.setData({
            raceInfo: res.data[0], // 取出匹配到的第一场比赛并渲染
            currentGroupIndex: 0 
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
    this.setData({ currentGroupIndex: index });
  },

  inputHours(e) {
    this.setData({ targetHours: e.detail.value });
  },

  inputMinutes(e) {
    this.setData({ targetMinutes: e.detail.value });
  },

  // ✨ 极速版核心修改：不再呼叫云端引擎，直接从 raceInfo 里提取已存好的 CP 点数据
  generatePlan() {
    const { targetHours, targetMinutes, raceInfo, currentGroupIndex } = this.data;
    
    if (!targetHours && !targetMinutes) {
      wx.showToast({ title: '请输入完赛时间', icon: 'none' });
      return;
    }

    if (!raceInfo || !raceInfo.groups || raceInfo.groups.length === 0) return;

    // 获取当前选中的组别数据（比如 12km 或 168km）
    const currentGroup = raceInfo.groups[currentGroupIndex];

    // 🚨 关键拦截：检查数据库里这个组别到底有没有存入解析好的 checkpoints 数据？
    if (!currentGroup.checkpoints || currentGroup.checkpoints.length === 0) {
      wx.showToast({ title: '该组别暂无轨迹数据', icon: 'none' });
      return;
    }

    // 处理空值
    const h = targetHours || '0';
    const m = targetMinutes || '0';

    // 假装思考 300 毫秒，给用户一个“引擎正在启动”的丝滑心理暗示
    wx.showLoading({ title: '极速生成中...', mask: true });

    setTimeout(() => {
      wx.hideLoading();

      // 组装数据包裹，伪装成之前 V8 引擎吐出来的格式
      const draftData = {
        name: `${raceInfo.title || '越野赛'} - ${currentGroup.dist}`, 
        checkpoints: currentGroup.checkpoints
      };

      console.log("🚀 极速读取本地组别数据成功，瞬间跃迁！", draftData);

      // 带着数据直接跳跃！
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
})