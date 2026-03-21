// 页面：比赛详情，显示组别信息并提供生成计划入口
const db = wx.cloud.database();
const _ = db.command; 

Page({
  data: {
    currentTab: 'detail',
    currentGroupIndex: 0,
    raceInfo: null, 
    // 记录用户输入的时间
    targetHours: '',
    targetMinutes: '',
    // 记录当前选中的是哪一个发枪时间下标
    selectedStartTimeIndex: 0
  },

  onLoad(options) {
    const targetId = options.id;
    console.log("详情页准备向云端请求赛事ID：", targetId);

    wx.showLoading({ title: '加载详情中...', mask: true });

    db.collection('races').where(_.or([
      { id: targetId },
      { _id: targetId }
    ])).get({
      success: res => {
        wx.hideLoading();
        if (res.data && res.data.length > 0) {
          let race = res.data[0];

          // ✨ 核心升级：数据洗牌，兼容旧格式，生成无限发枪时间阵列
          if (race.groups && race.groups.length > 0) {
            race.groups = race.groups.map(g => {
              let st = g.startTimes;
              // 如果旧数据没有 startTimes 数组，手动用旧字段帮它组装
              if (!st || !Array.isArray(st) || st.length === 0) {
                st = [g.startTime, g.startTime2].filter(t => t);
                if (st.length === 0) st = ['07:00']; 
              }
              g.startTimes = st;
              g.displayStartTimesStr = st.join(' / '); // 拼接用于关键数据展示
              return g;
            });
          }

          this.setData({
            raceInfo: race, 
            currentGroupIndex: 0,
            selectedStartTimeIndex: 0 
          });

          // ✨ 初始化：自动为第一个组别计算预测完赛时间
          this.setDefaultTimeForGroup(0);

        } else {
          wx.showToast({ title: '赛事不存在', icon: 'none' });
        }
      },
      fail: err => {
        wx.hideLoading();
        wx.showToast({ title: '网络异常', icon: 'none' });
      }
    });
  },

  // ✨ 新增引擎：根据关门时间智能推算安全完赛时间
  setDefaultTimeForGroup(groupIndex) {
    const group = this.data.raceInfo.groups[groupIndex];
    if (!group || !group.cutoffTime) {
      this.setData({ targetHours: '', targetMinutes: '' });
      return;
    }

    // 提取数字（比如把 "14.5小时" 提取出 14.5）
    let cutoffHours = parseFloat(group.cutoffTime.replace(/[^\d.]/g, ''));
    if (isNaN(cutoffHours) || cutoffHours <= 0) {
      this.setData({ targetHours: '', targetMinutes: '' });
      return;
    }

    let targetHoursFloat = cutoffHours;

    // ✨ 完赛安全线算法阶梯：
    if (cutoffHours <= 10) {
      targetHoursFloat -= 1;
    } else if (cutoffHours <= 20) {
      targetHoursFloat -= 3;
    } else if (cutoffHours <= 30) {
      targetHoursFloat -= 5;
    } else if (cutoffHours <= 40) {
      targetHoursFloat -= 7;
    } else {
      targetHoursFloat -= 9;
    }

    // 极高配速或超短关门时间兜底保护
    if (targetHoursFloat <= 0) targetHoursFloat = cutoffHours * 0.8; 

    let h = Math.floor(targetHoursFloat);
    let m = Math.round((targetHoursFloat - h) * 60);
    if (m === 60) { h += 1; m = 0; }

    // 补零处理（例如 0 -> 00）
    let mStr = m === 0 ? '00' : String(m);

    this.setData({
      targetHours: String(h),
      targetMinutes: mStr
    });
  },

  goBack() { wx.navigateBack(); },

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
    // ✨ 切换组别后重新计算对应组别的预期时间
    this.setDefaultTimeForGroup(index);
  },

  selectStartTime(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ selectedStartTimeIndex: index });
  },

  inputHours(e) { this.setData({ targetHours: e.detail.value }); },
  inputMinutes(e) { this.setData({ targetMinutes: e.detail.value }); },

  generatePlan() {
    const { targetHours, targetMinutes, raceInfo, currentGroupIndex, selectedStartTimeIndex } = this.data;
    
    if (!targetHours && !targetMinutes) {
      wx.showToast({ title: '请输入完赛时间', icon: 'none' });
      return;
    }

    if (!raceInfo || !raceInfo.groups || raceInfo.groups.length === 0) return;
    const currentGroup = raceInfo.groups[currentGroupIndex];

    if (!currentGroup.checkpoints || currentGroup.checkpoints.length === 0) {
      wx.showToast({ title: '该组别暂无轨迹数据', icon: 'none' });
      return;
    }

    // ✨ 根据当前选择的下标读取多维数组里的发枪时间
    const selectedTime = currentGroup.startTimes[selectedStartTimeIndex] || '07:00';
    this.executeJump(selectedTime);
  },

  executeJump(selectedStartTime) {
    const { targetHours, targetMinutes, raceInfo, currentGroupIndex } = this.data;
    const currentGroup = raceInfo.groups[currentGroupIndex];
    
    const h = targetHours || '0';
    const m = targetMinutes || '0';

    wx.showLoading({ title: '极速生成中...', mask: true });

    setTimeout(() => {
      wx.hideLoading();

      const draftData = {
        raceId: raceInfo._id,
        raceDate: raceInfo.date,
        groupDist: currentGroup.dist,
        name: `${raceInfo.name || 'AST越野赛'} - ${currentGroup.dist}`, 
        checkpoints: currentGroup.checkpoints,
        actualDist: currentGroup.actualDist, 
        elevation: currentGroup.elevation,  
        startTime: selectedStartTime,        
        availableStartTimes: currentGroup.startTimes // ✨ 传递无限发枪时间数组给排盘页面
      };

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