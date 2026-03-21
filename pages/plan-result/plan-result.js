const app = getApp();
const db = wx.cloud.database();

const {
  generateKmlFromPlan,
  generateGpxFromPlan,
  stringToUtf8ArrayBuffer,
  sendKmlBufferToBle
} = require('../../utils/kml-sender');

Page({
  data: {
    raceId: '',
    raceDate: '',
    groupDist: '',

    raceName: '加载中...',
    pureRaceName: '加载中...', 
    groupColor: '#FFFFFF',   

    startTime: '07:00',
    availableStartTimes: [], 
    
    targetHours: 21,
    targetMinutes: 43,
    timeRange: [[], []],
    timeIndex: [21, 43],
    restRange: [],
    restIndex: 4, 
    globalRestMins: 5,

    nutritionRange: [],
    nutritionIndex: 29, 
    nutritionVal: '30m', 

    checkpoints: [],
    blePlanPayload: null,
    K: 1.07,
    showDetail: false,
    detailCurrent: 0,
    detailCpName: '',
    
    isScrollTop: true,
    chartReady: {},

    showConnectModal: false, 
    showSuccessModal: false, 
    successModalTitle: '',
    
    hasUnsavedChanges: false,
    showUnsavedModal: false
  },

  onShow() {
    if (this.pendingSync && app.globalData && app.globalData.isConnected) {
      this.pendingSync = false;
      setTimeout(() => {
        this.executeSyncAnimation();
      }, 500);
    }
  },

  setUnsavedChanges(isDirty) {
    if (this.data.hasUnsavedChanges !== isDirty) {
      this.setData({ hasUnsavedChanges: isDirty });
      if (isDirty) {
        if (wx.enableAlertBeforeUnload) {
          wx.enableAlertBeforeUnload({ message: '当前专属计划尚未保存，直接退出将丢失修改。' });
        }
      } else {
        if (wx.disableAlertBeforeUnload) {
          wx.disableAlertBeforeUnload();
        }
      }
    }
  },

  getGroupColor(distStr) {
    if (!distStr) return '#36E153';
    let numStr = distStr.replace(/[^\d.]/g, ''); 
    let dist = parseFloat(numStr) || 0;
    if (dist < 30) return '#36E153';       
    if (dist < 60) return '#FF9811';       
    if (dist < 100) return '#3284FF';      
    return '#F94747';                      
  },

  formatPace(min) {
    if (!min || min <= 0 || !isFinite(min)) return "-'--\"/km";
    const m = Math.floor(min);
    const s = Math.round((min - m) * 60);
    return `${m}'${s < 10 ? '0'+s : s}"/km`;
  },

  formatPaceShort(min) {
    if (!min || min <= 0 || !isFinite(min)) return "-'--\"";
    const m = Math.floor(min);
    const s = Math.round((min - m) * 60);
    return `${m}'${s < 10 ? '0'+s : s}"`;
  },

  goToSegmentDetail(e) {
    const index = e.currentTarget.dataset.index;
    if (index === 0) return; 
    this.setData({ showDetail: true, detailCurrent: index - 1 }, () => {
      setTimeout(() => {
        this.initCanvasChart(index);
      }, 150);
    });
  },

  closeDetail() { this.setData({ showDetail: false }); },

  onDetailSwiperChange(e) { 
    const current = e.detail.current;
    this.setData({ detailCurrent: current }, () => {
      this.initCanvasChart(current + 1); 
    }); 
  },

  preventTouchMove() { return; },

  onScroll(e) {
    this.setData({ isScrollTop: e.detail.scrollTop <= 5 });
  },

  onTouchStart(e) {
    this.startY = e.touches[0].clientY;
  },

  onTouchEnd(e) {
    const endY = e.changedTouches[0].clientY;
    const type = e.currentTarget.dataset.type;

    if (endY - this.startY > 50) { 
      if (type === 'dragArea') {
        this.closeDetail();
      } else if (type === 'scrollView' && this.data.isScrollTop) {
        this.closeDetail();
      }
    }
  },

  initCanvasChart(cpIndex) {
    if (!this.data.showDetail) return;
    const cpData = this.data.checkpoints[cpIndex];
    if (!cpData) return;

    const query = wx.createSelectorQuery();
    query.select(`#elevChart_${cpIndex}`).fields({ node: true, size: true }).exec((res) => {
      if (!res[0] || !res[0].node) return;
      
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio;
      
      canvas.width = res[0].width * dpr;
      canvas.height = res[0].height * dpr;
      ctx.scale(dpr, dpr);

      const points = this.generateMockPoints(cpData);

      this.currentChart = { 
        ctx, canvas, width: res[0].width, height: res[0].height, points, cpData 
      };

      this.setData({ [`chartReady.${cpIndex}`]: true });
      this.drawChartBase(null); 
    });
  },

  generateMockPoints(cp) {
    if (cp.rawPoints && cp.rawPoints.length > 0) return cp.rawPoints; 
    let pts = [];
    const steps = 100;
    const startDist = cp.accDist - cp.segDist;
    const distStep = cp.segDist / steps;
    const eleDiff = cp.endEle - cp.startEle;

    for(let i=0; i<=steps; i++) {
      let d = startDist + (distStep * i);
      let noise = Math.sin(i * 0.5) * (cp.segGain * 0.2) * Math.random();
      let e = cp.startEle + eleDiff * (i/steps) + noise;
      e = Math.max(0, e); 
      pts.push({ d: parseFloat(d.toFixed(2)), e: Math.round(e) });
    }
    return pts;
  },

  drawChartBase(touchX) {
    if (!this.currentChart) return;
    const { ctx, width, height, points } = this.currentChart;

    const padding = { top: 20, bottom: 20, left: 0, right: 0 };
    const drawW = width;
    const drawH = height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, width, height);

    let minD = points[0].d, maxD = points[points.length-1].d;
    let minE = Math.min(...points.map(p => p.e));
    let maxE = Math.max(...points.map(p => p.e));
    
    minE = Math.max(0, Math.floor(minE / 100) * 100);
    maxE = Math.ceil(maxE / 100) * 100;
    if (maxE === minE) maxE += 100;

    const getX = (d) => ((d - minD) / (maxD - minD)) * drawW;
    const getY = (e) => padding.top + drawH - ((e - minE) / (maxE - minE)) * drawH;

    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';

    const yStep = maxE - minE > 500 ? 200 : 100;
    for(let ele = minE; ele <= maxE; ele += yStep) {
      let py = getY(ele);
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.stroke();
      
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.textAlign = 'right'; 
      ctx.textBaseline = 'middle'; 
      ctx.fillText(ele, width - 4, py);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    let startD_int = Math.ceil(minD);
    for(let d = startD_int; d <= maxD; d += 1) {
      let px = getX(d);
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height - padding.bottom);
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(d, px, height - padding.bottom + 4);
    }

    ctx.beginPath();
    ctx.moveTo(getX(points[0].d), getY(points[0].e));
    points.forEach(p => ctx.lineTo(getX(p.d), getY(p.e)));
    const grd = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
    grd.addColorStop(0, 'rgba(255, 170, 22, 0.4)');
    grd.addColorStop(1, 'rgba(255, 170, 22, 0.0)');
    ctx.lineTo(getX(points[points.length-1].d), height - padding.bottom);
    ctx.lineTo(getX(points[0].d), height - padding.bottom);
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(getX(points[0].d), getY(points[0].e));
    points.forEach(p => ctx.lineTo(getX(p.d), getY(p.e)));
    ctx.strokeStyle = '#FFAA16';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (touchX !== null && touchX >= 0 && touchX <= width) {
      let closestPoint = points[0];
      let minDiff = Infinity;
      points.forEach(p => {
        let px = getX(p.d);
        if (Math.abs(px - touchX) < minDiff) {
          minDiff = Math.abs(px - touchX);
          closestPoint = p;
        }
      });

      let focusX = getX(closestPoint.d);
      let focusY = getY(closestPoint.e);

      ctx.beginPath();
      ctx.moveTo(focusX, 0);
      ctx.lineTo(focusX, height - padding.bottom);
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(focusX, focusY, 4, 0, 2 * Math.PI);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.strokeStyle = '#FFAA16';
      ctx.lineWidth = 2;
      ctx.stroke();

      const tipW = 86;
      const tipH = 46; 
      let tipX = focusX - tipW / 2;
      let tipY = focusY - tipH - 12;
      
      if (tipX < 2) tipX = 2;
      if (tipX + tipW > width - 2) tipX = width - tipW - 2;
      if (tipY < 2) tipY = focusY + 15;

      const r = tipH / 2; 

      ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 4;

      ctx.beginPath();
      ctx.moveTo(tipX + r, tipY);
      ctx.lineTo(tipX + tipW - r, tipY);
      ctx.arcTo(tipX + tipW, tipY, tipX + tipW, tipY + r, r);
      ctx.lineTo(tipX + tipW, tipY + tipH - r);
      ctx.arcTo(tipX + tipW, tipY + tipH, tipX + tipW - r, tipY + tipH, r);
      ctx.lineTo(tipX + r, tipY + tipH);
      ctx.arcTo(tipX, tipY + tipH, tipX, tipY + tipH - r, r);
      ctx.lineTo(tipX, tipY + r);
      ctx.arcTo(tipX, tipY, tipX + r, tipY, r);
      ctx.closePath();

      ctx.fillStyle = 'rgba(30, 30, 32, 0.85)';
      ctx.fill();

      ctx.shadowColor = 'transparent';

      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.stroke();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${closestPoint.d}km`, tipX + tipW/2, tipY + 15);
      
      ctx.fillStyle = '#FFAA16';
      ctx.fillText(`${closestPoint.e}m`, tipX + tipW/2, tipY + 31);
    }
  },

  onChartTouch(e) {
    if (!e.touches || e.touches.length === 0) return;
    let touch = e.touches[0];
    let x = 0;
    
    if (touch.x !== undefined) {
      x = touch.x; 
    } else {
      const sysInfo = wx.getSystemInfoSync();
      const paddingLeftPx = 40 * (sysInfo.windowWidth / 750);
      x = touch.clientX - paddingLeftPx;
    }
    
    this.drawChartBase(x);
  },

  onChartTouchEnd() {
    this.drawChartBase(null);
  },

  onLoad(options) {
    const hours = []; const mins = [];
    for(let i=0; i<=100; i++) hours.push(i + 'h');
    for(let i=0; i<60; i++) mins.push(i + 'm');
    const rests = [];
    for(let i=1; i<=30; i++) rests.push(i + 'm');
    
    const nutritions = [];
    for(let i=1; i<=30; i++) nutritions.push(i + 'm');
    nutritions.push('关闭'); 
    for(let i=31; i<=90; i++) nutritions.push(i + 'm');

    let h = parseInt(options.h);
    let m = parseInt(options.m);
    let finalH = isNaN(h) ? 21 : h;
    let finalM = isNaN(m) ? (isNaN(h) ? 43 : 0) : m; 

    this.setData({
      targetHours: finalH, 
      targetMinutes: finalM,
      timeRange: [hours, mins], 
      timeIndex: [finalH, finalM],
      restRange: rests, 
      restIndex: 4,
      nutritionRange: nutritions, 
      nutritionVal: '30m',   
      nutritionIndex: 29     
    });

    const eventChannel = this.getOpenerEventChannel();
    let hasReceivedDataFromOpener = false;

    if(eventChannel && eventChannel.on) {
      eventChannel.on('acceptDataFromOpenerPage', (data) => {
        hasReceivedDataFromOpener = true; 
        
        if (data.targetHours !== undefined && data.targetHours !== null) finalH = parseInt(data.targetHours);
        if (data.targetMinutes !== undefined && data.targetMinutes !== null) finalM = parseInt(data.targetMinutes);

        let pureName = data.name || '越野赛';
        if (data.groupDist && pureName.includes(data.groupDist)) {
          pureName = pureName.replace(` - ${data.groupDist}`, '').replace(data.groupDist, '').trim();
        }
        let groupColor = this.getGroupColor(data.groupDist);

        const availableTimes = data.availableStartTimes || [data.startTime || '07:00'];
        this.setData({ 
          raceId: data.raceId || '',
          raceDate: data.raceDate || '',
          groupDist: data.groupDist || '',
          raceName: data.name || '越野赛', 
          pureRaceName: pureName,
          groupColor: groupColor,
          startTime: data.startTime || '07:00',
          availableStartTimes: availableTimes,
          targetHours: finalH,
          targetMinutes: finalM,
          timeIndex: [finalH, finalM]
        });
        this.initData(data.checkpoints);
        this.setUnsavedChanges(true); 
      });
    }

    setTimeout(() => {
      if (!hasReceivedDataFromOpener && options.id) {
        wx.showLoading({ title: '加载计划中...', mask: true });
        
        db.collection('user_plans').doc(options.id).get({
          success: res => {
            wx.hideLoading();
            const planData = res.data;
            
            let dbNutritionVal = planData.nutritionVal || '30m';
            let dbNutritionIndex = nutritions.indexOf(dbNutritionVal);
            if (dbNutritionIndex === -1) dbNutritionIndex = 29;

            let pureName = planData.raceName || '越野赛';
            if (planData.groupDist && pureName.includes(planData.groupDist)) {
              pureName = pureName.replace(` - ${planData.groupDist}`, '').replace(planData.groupDist, '').trim();
            }
            let groupColor = this.getGroupColor(planData.groupDist);

            this.setData({
              raceId: planData.raceId || '',
              raceDate: planData.raceDate || '',
              groupDist: planData.groupDist || '',
              raceName: planData.raceName || '越野赛',
              pureRaceName: pureName,
              groupColor: groupColor,
              startTime: planData.startTime || '07:00',
              availableStartTimes: planData.availableStartTimes || [planData.startTime || '07:00'],
              targetHours: planData.targetHours,
              targetMinutes: planData.targetMinutes,
              timeIndex: [planData.targetHours, planData.targetMinutes],
              nutritionVal: dbNutritionVal,
              nutritionIndex: dbNutritionIndex
            });
            
            this.initData(planData.checkpoints);
            this.setUnsavedChanges(false); 
          },
          fail: err => {
            wx.hideLoading();
            console.error("加载云端计划失败：", err);
            wx.showToast({ title: '获取计划失败', icon: 'none' });
          }
        });
      }
    }, 100); 
  },

  onNutritionChange(e) {
    const index = e.detail.value;
    const val = this.data.nutritionRange[index];
    this.setData({ nutritionIndex: index, nutritionVal: val });
    this.setUnsavedChanges(true); 
  },

  onTimeChange(e) {
    const val = e.detail.value;
    this.setData({ timeIndex: val, targetHours: val[0], targetMinutes: val[1] }, () => this.runFatigueEngine());
    this.setUnsavedChanges(true); 
  },
  
  onStartChange(e) {
    const newStartTime = this.data.availableStartTimes[e.detail.value];
    this.setData({ startTime: newStartTime }, () => this.updateTimesAndPaces(false));
    this.setUnsavedChanges(true); 
  },
  
  onRestChange(e) {
    const val = parseInt(e.detail.value) + 1; 
    let cps = this.data.checkpoints;
    cps.forEach((cp, i) => { if (i > 0 && i < cps.length - 1 && !cp.isDropBag) cp.rest = val; });
    this.setData({ globalRestMins: val, restIndex: e.detail.value, checkpoints: cps }, () => this.runFatigueEngine());
    this.setUnsavedChanges(true); 
  },

  onManualUpdate(e) {
    const { index, type } = e.currentTarget.dataset;
    const val = parseInt(e.detail.value) || 0;
    let { checkpoints } = this.data;
    if (type === 'rest') checkpoints[index].rest = val;
    else if (type === 'move') checkpoints[index].moveMins = val;
    this.setData({ checkpoints }, () => this.updateTimesAndPaces(true));
    this.setUnsavedChanges(true); 
  },

  onMemoInput(e) {
    const index = e.currentTarget.dataset.index;
    const val = e.detail.value;
    this.setData({ [`checkpoints[${index}].memo`]: val });
    this.setUnsavedChanges(true); 
  },

  initData(rawCps) {
    const cps = rawCps.map((cp, i, arr) => {
      const segDist = i === 0 ? 0 : parseFloat((cp.accDist - arr[i-1].accDist).toFixed(2));
      const segGain = i === 0 ? 0 : Math.max(0, cp.accGain - arr[i-1].accGain);
      const segLoss = i === 0 ? 0 : Math.max(0, (cp.accLoss || 0) - (arr[i-1].accLoss || 0));
      const isDropBag = (cp.name || '').toUpperCase().includes('DP') || (cp.name || '').includes('换装');
      let defaultRest = (i === 0 || i === arr.length - 1) ? 0 : (isDropBag ? 30 : this.data.globalRestMins);
      
      let cpNum = i === 0 ? '起点' : (i === arr.length - 1 ? '终点' : `CP${i}`);
      let locName = cp.name || '';
      
      let segCutoffMins = null;
      let cutoffTime = cp.cutoffTime || '';

      if (locName.includes('-')) {
        let parts = locName.split('-');
        cpNum = parts[0] || cpNum;
        let lastPart = parts[parts.length - 1].trim();
        if (/^\d+$/.test(lastPart)) {
          segCutoffMins = parseInt(lastPart, 10);
          locName = parts.slice(1, parts.length - 1).join('-');
        } else if (/^\d{1,2}:\d{2}$/.test(lastPart)) {
          cutoffTime = lastPart;
          locName = parts.slice(1, parts.length - 1).join('-');
        } else {
          locName = parts.slice(1).join('-');
        }
      } else if (locName.includes('～')) {
        let parts = locName.split('～');
        cpNum = parts[0] || cpNum;
        locName = parts[1] || '';
      }

      return { 
        ...cp, 
        cpNum, 
        locName, 
        isDropBag, 
        segDist, 
        segGain, 
        segLoss, 
        rest: defaultRest, 
        moveMins: 0,
        startEle: i > 0 ? Math.round(arr[i-1].tempEle || 0) : 0,
        endEle: Math.round(cp.tempEle || 0),
        segCutoffMins: segCutoffMins, 
        cutoffTime: cutoffTime,
        memo: cp.memo || ''
      };
    });
    this.setData({ checkpoints: cps }, () => { this.runFatigueEngine(); });
  },

  runFatigueEngine() {
    const { targetHours, targetMinutes, checkpoints, K } = this.data;
    const targetMins = (parseInt(targetHours) || 0) * 60 + (parseInt(targetMinutes) || 0);
    let totalED = 0;
    
    checkpoints.forEach(cp => {
      cp.segED = cp.segDist + (cp.segGain / 100); 
      totalED += cp.segED;
    });
    
    const totalRest = checkpoints.reduce((sum, cp) => sum + parseInt(cp.rest || 0), 0);
    const movingMins = targetMins - totalRest;
    if (movingMins <= 0) return;

    const a = movingMins / Math.pow(totalED, K);
    let runningED = 0;
    let runningAccumulatedMins = 0;

    checkpoints.forEach((cp, i) => {
      if (i === 0) { cp.moveMins = 0; return; }
      runningED += cp.segED;
      
      let exactMinsSoFar = a * Math.pow(runningED, K);
      let roundedMinsSoFar = Math.round(exactMinsSoFar);
      
      cp.moveMins = roundedMinsSoFar - runningAccumulatedMins;
      runningAccumulatedMins = roundedMinsSoFar;
    });
    
    this.setData({ checkpoints }, () => { this.updateTimesAndPaces(false); });
  },

  formatTime(minsTotal) {
    let m = Math.round(minsTotal) % 60;
    let h = Math.floor(minsTotal / 60) % 24;
    let days = Math.floor(minsTotal / (60 * 24));
    let hh = h.toString().padStart(2, '0');
    let mm = m.toString().padStart(2, '0');
    return `${hh}:${mm}${days > 0 ? ` (+${days})` : ''}`;
  },

  getRaceDateParts(dateStr = this.data.raceDate) {
    const nums = (dateStr || '').match(/\d+/g);
    if (!nums || nums.length < 3) return null;
    const year = Number(nums[0]);
    const month = Number(nums[1]);
    const day = Number(nums[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    return { year, month, day };
  },

  formatBeijingDateTime(absoluteMinutes, raceDate = this.data.raceDate) {
    if (!Number.isFinite(absoluteMinutes)) return '';
    const parts = this.getRaceDateParts(raceDate);
    if (!parts) return '';
    const utcMsAtBeijingMidnight = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0) - (8 * 60 * 60 * 1000);
    const utcMs = utcMsAtBeijingMidnight + (Math.round(absoluteMinutes) * 60 * 1000);
    const beijingDate = new Date(utcMs + (8 * 60 * 60 * 1000));
    const yyyy = beijingDate.getUTCFullYear();
    const mm = String(beijingDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(beijingDate.getUTCDate()).padStart(2, '0');
    const hh = String(beijingDate.getUTCHours()).padStart(2, '0');
    const mi = String(beijingDate.getUTCMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  },

  getBleSegmentName(cp, index) {
    const cpNum = (cp.cpNum || `CP${index + 1}`).trim();
    const locName = (cp.locName || '').trim();
    const rawName = (cp.name || '').trim();
    if (cpNum && locName) return `${cpNum} - ${locName}`;
    if (rawName) return rawName;
    return cpNum;
  },

  getBleCutoffTimeBjt(cp, raceDate = this.data.raceDate) {
    if (Number.isFinite(cp.absoluteCutoffMins)) return this.formatBeijingDateTime(cp.absoluteCutoffMins, raceDate);
    if (!cp.cutoffTime || cp.cutoffTime === '--:--') return '';
    const [h, m] = cp.cutoffTime.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
    return this.formatBeijingDateTime((h * 60) + m, raceDate);
  },

  saveLocalPlanSnapshot(checkpoints = this.data.checkpoints) {
    const snapshot = {
      raceId: this.data.raceId || '',
      raceDate: this.data.raceDate || '',
      raceName: this.data.raceName || '',
      groupDist: this.data.groupDist || '',
      startTime: this.data.startTime || '07:00',
      targetHours: this.data.targetHours,
      targetMinutes: this.data.targetMinutes,
      nutritionVal: this.data.nutritionVal, 
      nutritionIndex: this.data.nutritionIndex, 
      checkpoints: (Array.isArray(checkpoints) ? checkpoints : []).map(cp => ({ ...cp }))
    };
    this.localPlanSnapshot = snapshot;
    return snapshot;
  },

  getBleSourcePlan(sourcePlan = null) {
    if (sourcePlan && Array.isArray(sourcePlan.checkpoints)) return sourcePlan;
    if (this.localPlanSnapshot && Array.isArray(this.localPlanSnapshot.checkpoints)) return this.localPlanSnapshot;
    return this.saveLocalPlanSnapshot(this.data.checkpoints);
  },

  buildBlePlanPayload(sourcePlan = null) {
    const plan = this.getBleSourcePlan(sourcePlan);
    const segments = (Array.isArray(plan.checkpoints) ? plan.checkpoints : [])
      .slice(1)
      .map((cp, index) => ({
        segmentIndex: index + 1,
        segmentName: this.getBleSegmentName(cp, index),
        arrivalTimeBjt: this.formatBeijingDateTime(cp.arrAbsoluteMins, plan.raceDate),
        cutoffTimeBjt: this.getBleCutoffTimeBjt(cp, plan.raceDate),
        restMin: parseInt(cp.rest, 10) || 0
      }));

    const payload = {
      ver: 2,
      raceDate: plan.raceDate || '',
      raceName: plan.raceName || '',
      nutritionAlert: plan.nutritionVal === '关闭' ? 0 : parseInt(plan.nutritionVal), 
      segmentCount: segments.length,
      segments
    };
    this.localPlanSnapshot = plan;
    this.blePlanPayload = payload;
    return payload;
  },

  updateTimesAndPaces(updateTotals = false) {
    let { checkpoints, startTime } = this.data;
    let [startH, startM] = startTime.split(':').map(Number);
    let startMins = startH * 60 + startM;
    let currentMinutes = startMins;
    let totalMinsForGlobal = 0;
    
    let lastCutoffMins = startMins; 
    let runningCutoffMins = startMins;

    const newCps = checkpoints.map((cp, i, arr) => {
      if (i === 0) {
        cp.arrAbsoluteMins = currentMinutes;
        cp.depAbsoluteMins = currentMinutes;
        cp.arrTime = this.formatTime(currentMinutes);
        cp.depTime = this.formatTime(currentMinutes);
        cp.pace = "-'--\""; cp.eqPace = "-'--\""; cp.eqPaceShort = "-'--\""; cp.eqDist = "0.00";
        cp.isOvertime = false;
        cp.displayCutoffTime = cp.cutoffTime || '--:--';
        return cp;
      }

      currentMinutes += cp.moveMins;
      cp.arrAbsoluteMins = currentMinutes;
      cp.arrTime = this.formatTime(currentMinutes); 
      
      if (cp.segCutoffMins !== null && cp.segCutoffMins !== undefined) {
        runningCutoffMins += cp.segCutoffMins;
        cp.absoluteCutoffMins = runningCutoffMins;
        cp.displayCutoffTime = this.formatTime(runningCutoffMins);
        lastCutoffMins = runningCutoffMins;
      } 
      else if (cp.cutoffTime && cp.cutoffTime !== '--:--') {
        let [cH, cM] = cp.cutoffTime.split(':').map(Number);
        let cMins = cH * 60 + cM;
        while (cMins < lastCutoffMins) cMins += 24 * 60;
        cp.absoluteCutoffMins = cMins;
        lastCutoffMins = cMins; 
        runningCutoffMins = cMins; 
        cp.displayCutoffTime = this.formatTime(cMins); 
      } else {
        cp.absoluteCutoffMins = null;
        cp.displayCutoffTime = '--:--';
      }

      cp.isOvertime = Number.isFinite(cp.absoluteCutoffMins) ? (currentMinutes > cp.absoluteCutoffMins) : false;

      if (i < arr.length - 1) {
        currentMinutes += cp.rest;
        cp.depAbsoluteMins = currentMinutes;
        cp.depTime = this.formatTime(currentMinutes);
      } else {
        cp.depAbsoluteMins = cp.arrAbsoluteMins;
        cp.depTime = cp.arrTime;
      }

      totalMinsForGlobal += cp.moveMins + (cp.rest || 0);

      const eqDist = (cp.segDist + (cp.segGain / 100)).toFixed(2);
      cp.eqDist = eqDist;
      cp.pace = cp.segDist > 0 ? this.formatPace(cp.moveMins / cp.segDist) : "-'--\"";
      cp.eqPace = eqDist > 0 ? this.formatPace(cp.moveMins / eqDist) : "-'--\"";
      
      cp.eqPaceShort = eqDist > 0 ? this.formatPaceShort(cp.moveMins / eqDist) : "-'--\"";
      
      return cp;
    });

    let updatePayload = { checkpoints: newCps };
    if (updateTotals) {
      updatePayload.targetHours = Math.floor(totalMinsForGlobal / 60);
      updatePayload.targetMinutes = totalMinsForGlobal % 60;
    }
    const localPlanSnapshot = this.saveLocalPlanSnapshot(newCps);
    updatePayload.blePlanPayload = this.buildBlePlanPayload(localPlanSnapshot);
    this.setData(updatePayload);
  },

  drawNativeElevationChart(ctx, cpData, chartX, chartY, chartW, chartH, globalMinE, globalMaxE) {
    const points = this.generateMockPoints(cpData);
    if (!points || points.length === 0) return;

    let minD = points[0].d, maxD = points[points.length-1].d;
    let minE = globalMinE;
    let maxE = globalMaxE;
    
    if (maxE - minE < 100) { maxE += 50; minE = Math.max(0, minE - 50); }

    const getX = (d) => chartX + ((d - minD) / (maxD - minD)) * chartW;
    const getY = (e) => chartY + chartH - ((e - minE) / (maxE - minE)) * chartH;

    ctx.beginPath();
    ctx.moveTo(getX(points[0].d), getY(points[0].e));
    points.forEach(p => ctx.lineTo(getX(p.d), getY(p.e)));
    ctx.lineTo(getX(points[points.length-1].d), chartY + chartH);
    ctx.lineTo(getX(points[0].d), chartY + chartH);
    
    const grd = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
    grd.addColorStop(0, 'rgba(255, 170, 22, 0.4)');
    grd.addColorStop(1, 'rgba(255, 170, 22, 0.0)');
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(getX(points[0].d), getY(points[0].e));
    points.forEach(p => ctx.lineTo(getX(p.d), getY(p.e)));
    ctx.strokeStyle = '#FFAA16';
    ctx.lineWidth = 2; 
    ctx.stroke();
  },

  async savePlanImage() {
    wx.showLoading({ title: '正在生成高清长图...', mask: true });
    try {
      const setting = await wx.getSetting();
      if (setting.authSetting['scope.writePhotosAlbum'] === false) {
        wx.hideLoading();
        return wx.showModal({
          title: '需要权限',
          content: '请授权保存图片到相册，否则无法下载',
          success: res => { if (res.confirm) wx.openSetting(); }
        });
      }

      const query = wx.createSelectorQuery();
      query.select('#shareCanvas').fields({ node: true, size: true }).exec(async (res) => {
        if (!res[0] || !res[0].node) {
          wx.hideLoading();
          return wx.showToast({ title: '画板初始化失败', icon: 'none' });
        }
        
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        
        const W = 1080; 
        const headerH = 430; 
        const rowH = 170; 
        const footerH = 450;
        
        const { targetHours, targetMinutes, startTime, checkpoints, pureRaceName, raceName, groupDist, groupColor } = this.data;
        
        const H = headerH + ((checkpoints.length - 1) * rowH) + footerH;
        canvas.width = W;
        canvas.height = H;
        
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, W, H);
        
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        ctx.fillStyle = '#FF9811';
        ctx.font = 'bold 48px Inter';
        ctx.fillText('TRL-X', 80, 80);
        
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 70px Inter';
        let displayRaceName = pureRaceName || raceName;
        if(displayRaceName.length > 14) displayRaceName = displayRaceName.substring(0, 13) + '...';
        ctx.fillText(displayRaceName, 80, 160);
        
        if (groupDist) {
          let nameWidth = ctx.measureText(displayRaceName).width;
          let capsuleX = 80 + nameWidth + 24;
          let capsuleY = 165;
          ctx.font = 'bold 36px Inter';
          let distWidth = ctx.measureText(groupDist).width;
          let capsuleW = distWidth + 40;
          let capsuleH = 56;
          
          ctx.fillStyle = groupColor || '#36E153';
          
          let r = 16, x = capsuleX, y = capsuleY, w = capsuleW, h = capsuleH;
          ctx.beginPath();
          ctx.moveTo(x + r, y);
          ctx.lineTo(x + w - r, y);
          ctx.arcTo(x + w, y, x + w, y + r, r);
          ctx.lineTo(x + w, y + h - r);
          ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
          ctx.lineTo(x + r, y + h);
          ctx.arcTo(x, y + h, x, y + h - r, r);
          ctx.lineTo(x, y + r);
          ctx.arcTo(x, y, x + r, y, r);
          ctx.fill();
          
          ctx.fillStyle = '#000000';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(groupDist, capsuleX + capsuleW / 2, capsuleY + capsuleH / 2 + 2);
          
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
        }
        
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '36px sans-serif';
        ctx.fillText(`计划用时: ${targetHours}h ${targetMinutes}m   |   发枪时间: ${startTime}`, 80, 260);

        // ✨ 让表头文字(340)向下更贴近白线(380)
        let listHeaderCenterY = 340; 
        
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '28px sans-serif';
        
        const col1X = 140;
        const col2X = 310;
        const col3X = 470;
        const col4X = 680;
        const col5X = 930;

        ctx.fillText('地点', col1X, listHeaderCenterY);
        ctx.fillText('海拔图', col4X, listHeaderCenterY);
        ctx.fillText('赛道信息', col5X, listHeaderCenterY);

        ctx.textBaseline = 'top';
        ctx.fillText('计划用时(m)', col2X, listHeaderCenterY - 18);
        ctx.fillText('休息(m)', col3X, listHeaderCenterY - 18);
        
        ctx.font = '22px sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('(平均等强)', col2X, listHeaderCenterY + 12);
        ctx.fillText('(到达时间)', col3X, listHeaderCenterY + 12);
        
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        // ✨ 白线上移到 380 坐标位置，让文字与白线的间距变小
        ctx.moveTo(80, headerH - 10); 
        ctx.lineTo(W - 80, headerH - 10);
        ctx.stroke();

        const drawImg = (src, x, y, w, h) => {
          return new Promise((resolve) => {
            if (!src) return resolve();
            const img = canvas.createImage();
            img.src = src;
            img.onload = () => {
              ctx.drawImage(img, x, y, w, h);
              resolve();
            };
            img.onerror = () => { resolve(); };
          });
        };
        
        let globalMinE = Infinity;
        let globalMaxE = -Infinity;
        checkpoints.forEach(cp => {
          const pts = this.generateMockPoints(cp);
          if (pts && pts.length > 0) {
             const min = Math.min(...pts.map(p => p.e));
             const max = Math.max(...pts.map(p => p.e));
             if (min < globalMinE) globalMinE = min;
             if (max > globalMaxE) globalMaxE = max;
          }
        });
        if (globalMinE === Infinity) globalMinE = 0;
        if (globalMaxE === -Infinity) globalMaxE = 1000;

        let currentY = headerH;
        
        for (let i = 1; i < checkpoints.length; i++) {
          const cp = checkpoints[i];
          const yCenter = currentY + ((i - 1) * rowH) + (rowH / 2);
          
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          let hasSub = cp.isDropBag || (cp.displayCutoffTime && cp.displayCutoffTime !== '--:--');
          let mainY = hasSub ? yCenter - 18 : yCenter;
          
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 50px Inter';
          ctx.fillText(cp.cpNum, col1X, mainY); 
          
          let subY = yCenter + 22;
          if (cp.isDropBag) {
             ctx.fillStyle = 'rgba(255,255,255,0.4)';
             ctx.font = '28px sans-serif';
             ctx.fillText('换装点', col1X, subY);
             subY += 34; 
          }
          
          if (cp.displayCutoffTime && cp.displayCutoffTime !== '--:--') {
             ctx.fillStyle = 'rgba(255,255,255,0.4)';
             ctx.font = '24px sans-serif';
             ctx.fillText(`${cp.displayCutoffTime}关门`, col1X, subY);
          }
          
          ctx.fillStyle = '#FFAA16';
          ctx.font = 'bold 45px Inter';
          ctx.fillText((cp.moveMins || 0).toString(), col2X, yCenter - 18); 
          
          ctx.fillStyle = 'rgba(255,255,255,0.5)';
          ctx.font = '24px sans-serif';
          ctx.fillText(`(${cp.eqPaceShort})`, col2X, yCenter + 26);

          if (i < checkpoints.length - 1) {
            ctx.fillStyle = '#3284FF';
            ctx.font = 'bold 45px Inter';
            ctx.fillText((cp.rest || 0).toString(), col3X, yCenter - 18); 
          }
          ctx.fillStyle = cp.isOvertime ? '#F94747' : 'rgba(255,255,255,0.5)';
          ctx.font = '24px sans-serif';
          ctx.fillText(`(${cp.arrTime})`, col3X, yCenter + 26);

          this.drawNativeElevationChart(ctx, cp, col4X - 100, yCenter - 45, 200, 90, globalMinE, globalMaxE);
          
          ctx.fillStyle = '#FFFFFF';
          ctx.font = 'bold 45px Inter';
          ctx.fillText(cp.segDist + ' KM', col5X, yCenter - 18);
          
          ctx.font = 'bold 32px Inter';
          ctx.fillStyle = '#F94747'; 
          ctx.fillText('+' + cp.segGain, col5X - 50, yCenter + 26); 
          ctx.fillStyle = '#5CF947'; 
          ctx.fillText('-' + cp.segLoss, col5X + 50, yCenter + 26);
          
          ctx.strokeStyle = 'rgba(255,255,255,0.1)';
          ctx.beginPath();
          let lineY = currentY + i * rowH;
          ctx.moveTo(80, lineY);
          ctx.lineTo(W - 80, lineY);
          ctx.stroke();
        }
        
        const footerY = currentY + ((checkpoints.length - 1) * rowH);
        
        await drawImg('/images/qrcode.png', (W - 220) / 2, footerY + 80, 220, 220);
        
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '30px sans-serif';
        ctx.fillText('长按扫码，定制你的专属越野跑计划', W / 2, footerY + 340);
        
        wx.canvasToTempFilePath({
          canvas: canvas,
          width: W,
          height: H,
          destWidth: W,
          destHeight: H,
          success: (tempRes) => {
            wx.saveImageToPhotosAlbum({
              filePath: tempRes.tempFilePath,
              success: () => {
                wx.hideLoading();
                wx.showToast({ title: '已存入系统相册', icon: 'success' });
              },
              fail: () => {
                wx.hideLoading();
                wx.showToast({ title: '取消保存', icon: 'none' });
              }
            });
          },
          fail: (err) => {
             console.error(err);
             wx.hideLoading();
             wx.showToast({ title: '图片生成失败', icon: 'none' });
          }
        });
      });
    } catch (e) {
      wx.hideLoading();
      console.error("整体流程报错:", e);
      wx.showToast({ title: '操作出错', icon: 'none' });
    }
  },

  async uploadPlanToCloud() {
    wx.showLoading({ title: '安全加密上传中...', mask: true });
    
    const localPlanSnapshot = this.saveLocalPlanSnapshot(this.data.checkpoints);
    const {
      raceId, raceName, groupDist, raceDate,
      startTime, targetHours, targetMinutes,
      nutritionVal, nutritionIndex, checkpoints
    } = localPlanSnapshot;

    let raceDateMs = 0;
    if (raceDate) {
      const nums = raceDate.match(/\d+/g);
      if (nums && nums.length >= 3) {
        raceDateMs = new Date(nums[0], nums[1] - 1, nums[2]).getTime();
      }
    }

    const planData = {
      raceId, raceName, groupDist, raceDate, raceDateMs,
      startTime, targetHours, targetMinutes, 
      nutritionVal, nutritionIndex,  
      checkpoints, updateTime: db.serverDate()
    };

    try {
      const { data: existPlans } = await db.collection('user_plans').where({
        raceId: raceId,
        groupDist: groupDist
      }).get();

      if (existPlans.length > 0) {
        await db.collection('user_plans').doc(existPlans[0]._id).update({ data: planData });
      } else {
        planData.createTime = db.serverDate();
        await db.collection('user_plans').add({ data: planData });
      }

      wx.hideLoading();
      this.setUnsavedChanges(false); 
      return true; 
    } catch (err) {
      console.error("☁️ 云端保存失败:", err);
      wx.hideLoading();
      wx.showToast({ title: '网络异常，保存失败', icon: 'none' });
      return false; 
    }
  },

  syncToHardware() {
    const isConnected = app.globalData && app.globalData.isConnected;

    if (isConnected) {
      this.executeSyncAnimation();
    } else {
      this.setData({ showConnectModal: true });
    }
  },

  async modalLocalSave() {
    this.setData({ showConnectModal: false });
    const success = await this.uploadPlanToCloud();
    if (success) {
      this.setupSuccessModal('计划已存入云端');
    }
  },

  modalGoConnect() {
    this.pendingSync = true;
    this.setData({ showConnectModal: false });
    wx.navigateTo({ url: '/pages/ble-connect/ble-connect' });
  },

  modalBackToHome() {
    this.setData({ showSuccessModal: false });
    wx.reLaunch({ url: '/pages/index/index' });
  },

  async executeSyncAnimation() {
    let payloadForBleLog = null;
    const uploadSuccess = await this.uploadPlanToCloud();
    payloadForBleLog = this.buildBlePlanPayload();

    wx.showLoading({ title: '正在打包路书...', mask: true });

    try {
      const jsonContent = JSON.stringify(payloadForBleLog);
      const jsonBuffer = stringToUtf8ArrayBuffer(jsonContent);

      wx.hideLoading();

      if (!app.globalData.isConnected || !app.globalData.connectedDeviceId) {
        wx.showToast({ title: '设备未连接', icon: 'none' });
        return;
      }

      wx.showLoading({ title: '蓝牙传输中...', mask: true });

      await sendKmlBufferToBle(jsonBuffer, {
        deviceId: app.globalData.connectedDeviceId,
        chunkSize: 230,
        writeDelayMs: 20,
        onProgress: (progress) => {
          wx.showLoading({
            title: `传输中 ${progress.percent}%`,
            mask: true
          });
        }
      });

      wx.hideLoading();
      this.setupSuccessModal('同步手表成功');

    } catch (err) {
      wx.hideLoading();
      wx.showModal({
        title: '同步失败',
        content: err.message || '请检查设备连接后重试',
        showCancel: false
      });
    }
  },

  setupSuccessModal(titleText) {
    this.setData({ 
      successModalTitle: titleText,
      showSuccessModal: true
    });
  },

  goBack() { 
    if (this.data.hasUnsavedChanges) {
      this.setData({ showUnsavedModal: true });
    } else {
      wx.navigateBack(); 
    }
  },

  modalDiscardAndExit() {
    this.setData({ showUnsavedModal: false });
    this.setUnsavedChanges(false);
    wx.navigateBack();
  },

  modalSaveAndSync() {
    this.setData({ showUnsavedModal: false });
    this.syncToHardware();
  }
});