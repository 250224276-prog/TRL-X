const app = getApp();
const db = wx.cloud.database();

const {
  generateKmlFromPlan,
  generateGpxFromPlan,
  stringToUtf8ArrayBuffer,
  sendKmlBufferToBle
} = require('../../utils/kml-sender');

const DEFAULT_CURVE_K = 1.07;
const STRATEGY_K_DELTA = 0.14;
const DEFAULT_STRATEGY_SLIDER = Math.max(0, Math.min(100, Math.round(50 - (((DEFAULT_CURVE_K - 1) / STRATEGY_K_DELTA) * 50))));

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createHourOptions() {
  return Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
}

function createDefaultEffortConfig() {
  return {
    base: {
      runHikeThresholdEnabled: false,
      runHikeThreshold: 12
    },
    physiology: {
      altitudeThresholdEnabled: false,
      altitudeThreshold: 1800,
      altitudePenaltyEnabled: false,
      altitudePenalty: 8,
      nightPenaltyEnabled: false,
      nightPenalty: 6,
      nightStartHour: 20,
      nightEndHour: 6
    },
    terrain: {
      uphillSkillEnabled: false,
      uphillSkill: 100,
      downhillSkillEnabled: false,
      downhillSkill: 100
    }
  };
}

const FACTOR_HELP_CONTENT = {
  base: {
    runHikeThreshold: {
      title: '跑走切换阈值',
      content: '表示坡度大到什么程度时，更适合从跑切到快走。阈值越低，系统越容易把陡坡按徒步处理；阈值越高，则会保留更多跑动。'
    }
  },
  physiology: {
    altitudeThreshold: {
      title: '海拔阈值',
      content: '表示从多高开始，系统认为海拔会影响你的发挥。阈值越低，越早开始考虑高海拔影响；阈值越高，说明你对海拔更适应。'
    },
    altitudePenalty: {
      title: '高海拔惩罚',
      content: '表示超过海拔阈值后，每升高一些海拔会放慢多少。数值越高，高海拔路段越保守；如果你有适应经验，可以适当调低。'
    },
    nightPenalty: {
      title: '夜间惩罚',
      content: '用于模拟夜跑时视野、专注力和节奏下降带来的影响。数值越高，夜间时段分配的时间越多；下方还可以自定义夜间窗口，比如 20:00 到次日 06:00。'
    }
  },
  terrain: {
    uphillSkill: {
      title: '上坡能力',
      content: '表示你处理爬升的能力。数值越高，系统越认为你在上坡段不会被拖太多；数值越低，上坡分段会更保守。'
    },
    downhillSkill: {
      title: '下坡能力',
      content: '表示你在下降路段保持效率的能力。数值越高，技术性或长下降会更敢放速度；数值越低，系统会给下坡留更多余量。'
    }
  }
};

const STRATEGY_HELP_INFO = {
  title: '配速策略',
  content: '这里的 K 值控制的是整场比赛的时间分配曲线，不是每公里固定掉速。K=1 更接近按等强距离线性分配；K>1 更偏前快后慢，后程会分到更多时间；K<1 更偏前慢后快，前程会分到更多时间。图里显示的是每个分段的平均等强配速。'
};

const LINKED_EFFORT_FIELDS = {
  physiology: {
    altitudeThreshold: ['altitudePenalty'],
    altitudePenalty: ['altitudeThreshold']
  }
};

function cloneEffortConfig(config = createDefaultEffortConfig()) {
  return JSON.parse(JSON.stringify(config));
}

function normalizeEffortConfig(rawConfig = {}) {
  const defaults = createDefaultEffortConfig();
  const rawBase = rawConfig.base || {};
  const rawPhysiology = rawConfig.physiology || {};
  const rawTerrain = rawConfig.terrain || {};
  const resolveEnabled = (rawGroup, key, fallback = false) => {
    if (typeof rawGroup[key] === 'boolean') return rawGroup[key];
    if (typeof rawGroup.enabled === 'boolean') return rawGroup.enabled;
    return fallback;
  };
  const normalized = {
    base: {
      runHikeThresholdEnabled: resolveEnabled(rawBase, 'runHikeThresholdEnabled', defaults.base.runHikeThresholdEnabled),
      runHikeThreshold: Number.isFinite(Number(rawBase.runHikeThreshold)) ? Number(rawBase.runHikeThreshold) : defaults.base.runHikeThreshold
    },
    physiology: {
      altitudeThresholdEnabled: resolveEnabled(rawPhysiology, 'altitudeThresholdEnabled', defaults.physiology.altitudeThresholdEnabled),
      altitudeThreshold: Number.isFinite(Number(rawPhysiology.altitudeThreshold)) ? Number(rawPhysiology.altitudeThreshold) : defaults.physiology.altitudeThreshold,
      altitudePenaltyEnabled: resolveEnabled(rawPhysiology, 'altitudePenaltyEnabled', defaults.physiology.altitudePenaltyEnabled),
      altitudePenalty: Number.isFinite(Number(rawPhysiology.altitudePenalty)) ? Number(rawPhysiology.altitudePenalty) : defaults.physiology.altitudePenalty,
      nightPenaltyEnabled: resolveEnabled(rawPhysiology, 'nightPenaltyEnabled', defaults.physiology.nightPenaltyEnabled),
      nightPenalty: Number.isFinite(Number(rawPhysiology.nightPenalty)) ? Number(rawPhysiology.nightPenalty) : defaults.physiology.nightPenalty,
      nightStartHour: clamp(Number.isFinite(Number(rawPhysiology.nightStartHour)) ? Number(rawPhysiology.nightStartHour) : defaults.physiology.nightStartHour, 0, 23),
      nightEndHour: clamp(Number.isFinite(Number(rawPhysiology.nightEndHour)) ? Number(rawPhysiology.nightEndHour) : defaults.physiology.nightEndHour, 0, 23)
    },
    terrain: {
      uphillSkillEnabled: resolveEnabled(rawTerrain, 'uphillSkillEnabled', defaults.terrain.uphillSkillEnabled),
      uphillSkill: Number.isFinite(Number(rawTerrain.uphillSkill)) ? Number(rawTerrain.uphillSkill) : defaults.terrain.uphillSkill,
      downhillSkillEnabled: resolveEnabled(rawTerrain, 'downhillSkillEnabled', defaults.terrain.downhillSkillEnabled),
      downhillSkill: Number.isFinite(Number(rawTerrain.downhillSkill)) ? Number(rawTerrain.downhillSkill) : defaults.terrain.downhillSkill
    }
  };
  normalized.physiology.altitudeThresholdEnabled = normalized.physiology.altitudeThresholdEnabled || normalized.physiology.altitudePenaltyEnabled;
  normalized.physiology.altitudePenaltyEnabled = normalized.physiology.altitudeThresholdEnabled;
  return normalized;
}

function svgToDataUri(svgText = '') {
  const utf8 = unescape(encodeURIComponent(String(svgText || '')));
  const bytes = new Uint8Array(utf8.length);
  for (let i = 0; i < utf8.length; i++) {
    bytes[i] = utf8.charCodeAt(i);
  }
  return `data:image/svg+xml;base64,${wx.arrayBufferToBase64(bytes.buffer)}`;
}

function hexToRgba(hex = '#FFFFFF', alpha = 1) {
  const safeHex = String(hex).replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(safeHex)) {
    return `rgba(255,255,255,${alpha})`;
  }
  const r = parseInt(safeHex.slice(0, 2), 16);
  const g = parseInt(safeHex.slice(2, 4), 16);
  const b = parseInt(safeHex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

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
    hourOptions: createHourOptions(),

    showEffortPanel: false,
    paceStrategySlider: DEFAULT_STRATEGY_SLIDER,
    strategyModeLabel: '前快后慢',
    strategyModeDetail: `K=${DEFAULT_CURVE_K.toFixed(2)} | 当前默认底模`,
    strategyFastestPace: "--'--\"",
    strategySlowestPace: "--'--\"",
    paceStrategyChartSvg: '',
    effortConfig: createDefaultEffortConfig(),

    checkpoints: [],
    blePlanPayload: null,
    K: 1.07,
    showDetail: false,
    detailCurrent: 0,
    detailCpName: '',
    detailGradeMode: false,
    
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

  getStrategyKValue(slider = this.data.paceStrategySlider) {
    const normalized = clamp((50 - Number(slider)) / 50, -1, 1);
    return 1 + (normalized * STRATEGY_K_DELTA);
  },

  getStrategyModeLabel(slider = this.data.paceStrategySlider) {
    const kValue = this.getStrategyKValue(slider);
    if (kValue > 1.015) return '前快后慢';
    if (kValue < 0.985) return '前慢后快';
    return '全程匀速';
  },

  buildStrategyModeDetail(slider = this.data.paceStrategySlider) {
    const kValue = this.getStrategyKValue(slider);
    const deltaFromLinear = kValue - 1;
    const deltaFromDefault = kValue - DEFAULT_CURVE_K;
    if (Math.abs(deltaFromLinear) < 0.015) {
      return `K=${kValue.toFixed(2)} | 按等效距离线性分配`;
    }
    if (Math.abs(deltaFromDefault) < 0.015) {
      return `K=${kValue.toFixed(2)} | 与当前默认算法接近`;
    }
    if (kValue > 1) {
      return `K=${kValue.toFixed(2)} | 后程分配更多时间`;
    }
    return `K=${kValue.toFixed(2)} | 后程更主动更紧凑`;
  },

  estimateArrivalTimes(checkpoints, movePlan, startMins) {
    const arrivals = [];
    let currentMinutes = startMins;
    arrivals[0] = currentMinutes;
    for (let i = 1; i < checkpoints.length; i++) {
      currentMinutes += movePlan[i] || 0;
      arrivals[i] = currentMinutes;
      if (i < checkpoints.length - 1) {
        currentMinutes += parseInt(checkpoints[i].rest || 0, 10) || 0;
      }
    }
    return arrivals;
  },

  smoothStrategyBaseWeights(baseMoveWeights = [], checkpoints = [], curveK = 1) {
    if (!Array.isArray(baseMoveWeights) || !Array.isArray(checkpoints)) return baseMoveWeights;
    const kNorm = clamp(Math.abs((Number(curveK) || 1) - 1) / STRATEGY_K_DELTA, 0, 1);
    if (kNorm < 0.05) return baseMoveWeights;

    const active = [];
    for (let i = 1; i < checkpoints.length; i++) {
      const segED = Math.max(0.01, Number(checkpoints[i]?.segED) || 0.01);
      const weight = Math.max(0.01, Number(baseMoveWeights[i]) || 0.01);
      active.push({ index: i, segED, weight, bias: weight / segED });
    }
    if (active.length < 2) return baseMoveWeights;

    const blend = 0.12 + (kNorm * 0.26);
    const maxNeighborRatio = 1.22 - (kNorm * 0.10);
    const smoothedBias = active.map((item, index) => {
      const prev = active[Math.max(0, index - 1)].bias;
      const curr = item.bias;
      const next = active[Math.min(active.length - 1, index + 1)].bias;
      const neighborAvg = index === 0
        ? ((curr * 2) + next) / 3
        : (index === active.length - 1 ? ((prev + (curr * 2)) / 3) : ((prev + (curr * 2) + next) / 4));
      return (curr * (1 - blend)) + (neighborAvg * blend);
    });

    for (let i = 1; i < smoothedBias.length; i++) {
      smoothedBias[i] = clamp(smoothedBias[i], smoothedBias[i - 1] / maxNeighborRatio, smoothedBias[i - 1] * maxNeighborRatio);
    }
    for (let i = smoothedBias.length - 2; i >= 0; i--) {
      smoothedBias[i] = clamp(smoothedBias[i], smoothedBias[i + 1] / maxNeighborRatio, smoothedBias[i + 1] * maxNeighborRatio);
    }

    const result = [...baseMoveWeights];
    active.forEach((item, index) => {
      result[item.index] = Math.max(0.01, item.segED * smoothedBias[index]);
    });
    return result;
  },

  isHourWithinWindow(hour, startHour, endHour) {
    if (!Number.isFinite(hour)) return false;
    if (startHour === endHour) return true;
    if (startHour < endHour) return hour >= startHour && hour < endHour;
    return hour >= startHour || hour < endHour;
  },

  distributeRoundedMinutes(weights, totalMinutes) {
    const result = new Array(weights.length).fill(0);
    const indices = [];
    let weightSum = 0;

    weights.forEach((weight, index) => {
      if (index === 0) return;
      const safeWeight = Math.max(0, Number(weight) || 0);
      result[index] = 0;
      indices.push(index);
      weightSum += safeWeight;
    });

    if (indices.length === 0) return result;
    if (weightSum <= 0) {
      const evenShare = Math.floor(totalMinutes / indices.length);
      let remainder = totalMinutes - (evenShare * indices.length);
      indices.forEach(index => { result[index] = evenShare; });
      for (let i = 0; i < remainder; i++) result[indices[i % indices.length]] += 1;
      return result;
    }

    let allocated = 0;
    const remainders = [];
    indices.forEach(index => {
      const exact = totalMinutes * (Math.max(0, Number(weights[index]) || 0) / weightSum);
      const whole = Math.floor(exact);
      result[index] = whole;
      allocated += whole;
      remainders.push({ index, remainder: exact - whole });
    });

    remainders.sort((a, b) => b.remainder - a.remainder);
    let leftover = totalMinutes - allocated;
    for (let i = 0; i < leftover; i++) {
      result[remainders[i % remainders.length].index] += 1;
    }

    return result;
  },

  collectStrategySegments(checkpoints = [], movePlan = null) {
    const segments = [];
    let totalMove = 0;
    let totalEqDist = 0;
    let runningDist = 0;

    for (let i = 1; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const segDist = Number(cp.segDist) || 0;
      if (segDist <= 0) continue;
      const moveMins = movePlan ? (Number(movePlan[i]) || 0) : (Number(cp.moveMins) || 0);
      const eqDist = Math.max(0.01, Number(cp.eqDist) || (segDist + ((Number(cp.segGain) || 0) / 100)));
      const eqPace = moveMins / eqDist;
      const distStart = runningDist;
      runningDist += segDist;
      totalMove += moveMins;
      totalEqDist += eqDist;
      segments.push({
        distStart,
        distEnd: runningDist,
        segDist,
        eqPace: Math.max(0.01, eqPace)
      });
    }

    return {
      segments,
      avgEqPace: totalEqDist > 0 ? (totalMove / totalEqDist) : 0,
      fastest: segments.length > 0 ? Math.min(...segments.map(item => item.eqPace)) : 0,
      slowest: segments.length > 0 ? Math.max(...segments.map(item => item.eqPace)) : 0,
      totalDist: runningDist
    };
  },

  buildStrategyPreviewMovePlan(checkpoints = [], slider = this.data.paceStrategySlider) {
    if (!Array.isArray(checkpoints) || checkpoints.length <= 1) return null;

    const targetMins = ((parseInt(this.data.targetHours, 10) || 0) * 60) + (parseInt(this.data.targetMinutes, 10) || 0);
    const totalRest = checkpoints.reduce((sum, cp) => sum + (parseInt(cp.rest || 0, 10) || 0), 0);
    const movingMins = targetMins - totalRest;
    if (movingMins <= 0) return null;

    const virtualCheckpoints = checkpoints.map(cp => ({ ...cp }));
    let totalED = 0;
    let activeSegments = 0;

    virtualCheckpoints.forEach((cp) => {
      cp.segED = (Number(cp.segDist) || 0) + ((Number(cp.segGain) || 0) / 100);
      totalED += cp.segED;
      if ((Number(cp.segED) || 0) > 0) activeSegments += 1;
    });

    if (totalED <= 0 || activeSegments <= 0) return null;

    const curveK = this.getStrategyKValue(slider);
    const avgSegED = totalED / activeSegments;
    const curveAnchorED = Math.max(1, avgSegED * 0.85, totalED * 0.06);
    const curveBase = Math.pow(curveAnchorED, curveK);
    const curveSpan = Math.pow(totalED + curveAnchorED, curveK) - curveBase;
    let runningED = 0;
    let previousExactMins = 0;
    const baseMoveWeights = virtualCheckpoints.map(() => 0);

    virtualCheckpoints.forEach((cp, index) => {
      if (index === 0) return;
      runningED += cp.segED;
      const exactMinsSoFar = curveSpan > 0
        ? movingMins * ((Math.pow(runningED + curveAnchorED, curveK) - curveBase) / curveSpan)
        : (movingMins * (runningED / Math.max(0.01, totalED)));
      baseMoveWeights[index] = Math.max(0.01, exactMinsSoFar - previousExactMins);
      previousExactMins = exactMinsSoFar;
    });

    const smoothedBaseWeights = this.smoothStrategyBaseWeights(baseMoveWeights, virtualCheckpoints, curveK);
    const baseMoveMins = this.distributeRoundedMinutes(smoothedBaseWeights, movingMins);
    const [startH, startM] = String(this.data.startTime || '07:00').split(':').map(Number);
    const startMins = ((startH || 0) * 60) + (startM || 0);
    return this.applyAdvancedPacingModel(baseMoveMins, virtualCheckpoints, movingMins, startMins);
  },

  getFixedStrategyAxisBounds(checkpoints = []) {
    const maxKMovePlan = this.buildStrategyPreviewMovePlan(checkpoints, 0);
    const minKMovePlan = this.buildStrategyPreviewMovePlan(checkpoints, 100);
    const maxKMetrics = maxKMovePlan ? this.collectStrategySegments(checkpoints, maxKMovePlan) : null;
    const minKMetrics = minKMovePlan ? this.collectStrategySegments(checkpoints, minKMovePlan) : null;
    const candidateFast = [
      maxKMetrics && maxKMetrics.fastest,
      minKMetrics && minKMetrics.fastest
    ].filter(value => Number.isFinite(value) && value > 0);
    const candidateSlow = [
      maxKMetrics && maxKMetrics.slowest,
      minKMetrics && minKMetrics.slowest
    ].filter(value => Number.isFinite(value) && value > 0);
    const fixedFast = candidateFast.length ? Math.min(...candidateFast) : 0;
    const fixedSlow = candidateSlow.length ? Math.max(...candidateSlow) : 0;
    if (!(fixedFast > 0) || !(fixedSlow > 0) || fixedSlow <= fixedFast) return null;
    return {
      yMin: Math.max(1.5, fixedFast - 0.45),
      yMax: fixedSlow + 0.55
    };
  },

  buildPaceStrategyVisual(checkpoints = this.data.checkpoints) {
    const { segments, avgEqPace, fastest, slowest, totalDist } = this.collectStrategySegments(checkpoints);
    const axisBounds = this.getFixedStrategyAxisBounds(checkpoints);

    return {
      strategyModeLabel: this.getStrategyModeLabel(),
      strategyModeDetail: this.buildStrategyModeDetail(),
      strategyFastestPace: fastest > 0 ? this.formatPaceShort(fastest) : "-'--\"",
      strategySlowestPace: slowest > 0 ? this.formatPaceShort(slowest) : "-'--\"",
      paceStrategyChartSvg: this.buildPaceStrategyChartSvg(segments, avgEqPace, fastest, slowest, totalDist, axisBounds)
    };
  },

  buildPaceStrategyChartSvg(segments = [], avgPace = 0, fastest = 0, slowest = 0, totalDist = 0, axisBounds = null) {
    const width = 680;
    const height = 340;
    const padLeft = 74;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 56;
    const chartW = width - padLeft - padRight;
    const chartH = height - padTop - padBottom;

    const safeAvg = avgPace > 0 ? avgPace : 6;
    const safeFast = fastest > 0 ? fastest : safeAvg * 0.95;
    const safeSlow = slowest > 0 ? slowest : safeAvg * 1.05;
    const yMin = axisBounds && Number.isFinite(axisBounds.yMin) ? axisBounds.yMin : Math.max(1.5, safeFast - 0.45);
    const yMax = axisBounds && Number.isFinite(axisBounds.yMax) ? axisBounds.yMax : (safeSlow + 0.55);
    const yRange = Math.max(0.5, yMax - yMin);
    const total = totalDist > 0 ? totalDist : 10;

    const paceToY = pace => padTop + ((pace - yMin) / yRange) * chartH;
    const distToX = dist => padLeft + ((dist / total) * chartW);
    const baselineY = paceToY(safeAvg);

    let linePath = '';
    if (segments.length > 0) {
      const firstY = paceToY(segments[0].eqPace);
      linePath = `M ${padLeft.toFixed(1)} ${firstY.toFixed(1)}`;
      segments.forEach((segment, index) => {
        const xEnd = distToX(segment.distEnd);
        const currentY = paceToY(segment.eqPace);
        linePath += ` L ${xEnd.toFixed(1)} ${currentY.toFixed(1)}`;
        if (index < segments.length - 1) {
          const nextY = paceToY(segments[index + 1].eqPace);
          linePath += ` L ${xEnd.toFixed(1)} ${nextY.toFixed(1)}`;
        }
      });
    } else {
      linePath = `M ${padLeft.toFixed(1)} ${baselineY.toFixed(1)} L ${(padLeft + chartW).toFixed(1)} ${baselineY.toFixed(1)}`;
    }

    const gridYs = [0, 0.33, 0.66, 1].map(step => padTop + (chartH * step));
    const yLabels = [
      this.formatPaceShort(yMin),
      this.formatPaceShort(yMin + (yRange * 0.33)),
      this.formatPaceShort(yMin + (yRange * 0.66)),
      this.formatPaceShort(yMax)
    ];
    const xLabels = [0, total / 3, (total * 2) / 3, total].map(value => {
      const compact = value.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
      return compact;
    });
    const xPositions = [0, total / 3, (total * 2) / 3, total].map(distToX);

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
        <rect x="0" y="0" width="${width}" height="${height}" rx="0" fill="transparent" />
        <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + chartH}" stroke="rgba(255,255,255,0.14)" stroke-width="1.5" />
        <line x1="${padLeft}" y1="${padTop + chartH}" x2="${width - padRight}" y2="${padTop + chartH}" stroke="rgba(255,255,255,0.14)" stroke-width="1.5" />
        ${gridYs.map(y => `<line x1="${padLeft}" y1="${y.toFixed(1)}" x2="${width - padRight}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.12)" stroke-width="1" />`).join('')}
        <line x1="${padLeft}" y1="${baselineY.toFixed(1)}" x2="${width - padRight}" y2="${baselineY.toFixed(1)}" stroke="#D45A57" stroke-width="2" stroke-dasharray="10 8" />
        <path d="${linePath}" fill="none" stroke="#34C759" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" />
        <text x="${padLeft}" y="14" fill="rgba(255,255,255,0.42)" font-size="18">等强配速</text>
        ${yLabels.map((label, index) => `<text x="${padLeft - 16}" y="${gridYs[index].toFixed(1)}" fill="rgba(255,255,255,0.45)" font-size="20" text-anchor="end" dominant-baseline="middle">${label}</text>`).join('')}
        ${xLabels.map((label, index) => `<text x="${xPositions[index].toFixed(1)}" y="${height - 18}" fill="rgba(255,255,255,0.45)" font-size="20" text-anchor="middle">${label}</text>`).join('')}
      </svg>
    `.trim();
    return svgToDataUri(svg);
  },

  toggleEffortPanel() {
    this.setData({ showEffortPanel: !this.data.showEffortPanel });
  },

  resetPaceStrategy() {
    this.setData({ paceStrategySlider: DEFAULT_STRATEGY_SLIDER }, () => {
      this.runFatigueEngine();
      this.setUnsavedChanges(true);
    });
  },

  onStrategySliderChange(e) {
    const value = Number(e.detail.value);
    this.setData({ paceStrategySlider: value }, () => {
      this.runFatigueEngine();
      this.setUnsavedChanges(true);
    });
  },

  onStrategySliderChanging(e) {
    const value = Number(e.detail.value);
    if (value === this.data.paceStrategySlider) return;
    this.setData({ paceStrategySlider: value }, () => {
      this.runFatigueEngine();
      this.setUnsavedChanges(true);
    });
  },

  onEffortSwitch(e) {
    const { group, field } = e.currentTarget.dataset;
    if (!group || !field) return;
    const value = !!e.detail.value;
    const updatePayload = {
      [`effortConfig.${group}.${field}Enabled`]: value
    };
    const linkedFields = (LINKED_EFFORT_FIELDS[group] && LINKED_EFFORT_FIELDS[group][field]) || [];
    linkedFields.forEach(linkedField => {
      updatePayload[`effortConfig.${group}.${linkedField}Enabled`] = value;
    });
    this.setData(updatePayload, () => {
      this.runFatigueEngine();
      this.setUnsavedChanges(true);
    });
  },

  onEffortSliderChange(e) {
    const { group, field } = e.currentTarget.dataset;
    const value = Number(e.detail.value);
    this.setData({ [`effortConfig.${group}.${field}`]: value }, () => {
      this.runFatigueEngine();
      this.setUnsavedChanges(true);
    });
  },

  onNightWindowChange(e) {
    const { field } = e.currentTarget.dataset;
    const value = clamp(Number(e.detail.value), 0, 23);
    this.setData({ [`effortConfig.physiology.${field}`]: value }, () => {
      this.runFatigueEngine();
      this.setUnsavedChanges(true);
    });
  },

  showFactorHelp(e) {
    const { group, field } = e.currentTarget.dataset;
    const info = FACTOR_HELP_CONTENT[group] && FACTOR_HELP_CONTENT[group][field];
    if (!info) return;
    wx.showModal({
      title: info.title,
      content: info.content,
      showCancel: false,
      confirmText: '我知道了',
      confirmColor: '#FF9811'
    });
  },

  showStrategyHelp() {
    wx.showModal({
      title: STRATEGY_HELP_INFO.title,
      content: STRATEGY_HELP_INFO.content,
      showCancel: false,
      confirmText: '我知道了',
      confirmColor: '#FF9811'
    });
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

  toggleDetailGradeMode() {
    this.setData({ detailGradeMode: !this.data.detailGradeMode }, () => {
      this.drawChartBase(null);
    });
  },

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

    const query = wx.createSelectorQuery().in(this);
    query.select(`#elevChart_${cpIndex}`).fields({ node: true, size: true }).exec((res) => {
      if (!res[0] || !res[0].node) return;
      
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio;
      
      canvas.width = res[0].width * dpr;
      canvas.height = res[0].height * dpr;
      ctx.scale(dpr, dpr);

      const points = this.generateMockPoints(cpData);
      if (!Array.isArray(points) || points.length < 2) return;

      this.currentChart = { 
        ctx, canvas, width: res[0].width, height: res[0].height, points, cpData 
      };

      this.setData({ [`chartReady.${cpIndex}`]: true });
      this.drawChartBase(null); 
    });
  },

  buildInlineSvgProfile(points = []) {
    if (!Array.isArray(points) || points.length < 2) return '';

    const sampled = [];
    const step = Math.max(1, Math.floor(points.length / 30));
    for (let i = 0; i < points.length; i += step) {
      sampled.push(points[i]);
    }
    if (sampled[sampled.length - 1] !== points[points.length - 1]) {
      sampled.push(points[points.length - 1]);
    }

    const distances = sampled.map(point => Number(point.d)).filter(value => Number.isFinite(value));
    const elevations = sampled.map(point => Number(point.e)).filter(value => Number.isFinite(value));
    if (distances.length < 2 || elevations.length < 2) return '';

    const minD = Math.min(...distances);
    const maxD = Math.max(...distances);
    const minE = Math.min(...elevations);
    const maxE = Math.max(...elevations);
    const distRange = Math.max(0.01, maxD - minD);
    const elevRange = Math.max(1, maxE - minE);

    const pointsStr = sampled.map(point => {
      const x = ((Number(point.d) - minD) / distRange) * 100;
      const y = 40 - (((Number(point.e) - minE) / elevRange) * 40);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' L');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" preserveAspectRatio="none"><defs><linearGradient id="elevationGradient" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#FF9849" stop-opacity="0.4" /><stop offset="100%" stop-color="#FF9849" stop-opacity="0.05" /></linearGradient></defs><path d="M${pointsStr} L100,40 L0,40 Z" fill="url(#elevationGradient)" stroke="none" /><path d="M${pointsStr}" fill="none" stroke="#FF9849" stroke-width="1.5" /></svg>`;
    return svgToDataUri(svg);
  },

  generateMockPoints(cp) {
    if (Array.isArray(cp.rawPoints) && cp.rawPoints.length > 1) return cp.rawPoints;

    const pts = [];
    const segDist = Math.max(0.01, Number(cp.segDist) || 0.01);
    const steps = Math.max(24, Math.min(120, Math.round(segDist * 10)));
    const startDist = Number(cp.accDist || 0) - segDist;
    const distStep = segDist / steps;
    const startEle = Number.isFinite(cp.startEle) ? cp.startEle : Math.round(cp.tempEle || 0);
    const endEle = Number.isFinite(cp.endEle) ? cp.endEle : startEle;
    const eleDiff = endEle - startEle;
    const segGain = Number(cp.segGain) || Math.max(0, eleDiff);
    const segLoss = Number(cp.segLoss) || Math.max(0, -eleDiff);
    const waveAmplitude = Math.max(segGain, segLoss, Math.abs(eleDiff)) * 0.18;

    for (let i = 0; i <= steps; i++) {
      const progress = i / steps;
      const d = startDist + (distStep * i);
      const baseEle = startEle + (eleDiff * progress);
      const undulation = Math.sin(progress * Math.PI * 2) * waveAmplitude * (1 - Math.abs((progress * 2) - 1) * 0.35);
      const shoulder = Math.sin(progress * Math.PI) * Math.max(segGain - segLoss, 0) * 0.08;
      const e = Math.max(0, baseEle + undulation + shoulder);
      pts.push({ d: parseFloat(d.toFixed(2)), e: Math.round(e) });
    }

    if (pts.length >= 2 && pts[pts.length - 1].d <= pts[0].d) {
      pts[pts.length - 1].d = parseFloat((pts[0].d + 0.01).toFixed(2));
    }

    return pts;
  },

  getGradeAngleAtIndex(points = [], index = 0, sampleMeters = 120) {
    if (!Array.isArray(points) || points.length < 2) return 0;
    const safeIndex = clamp(index, 0, points.length - 1);
    const current = points[safeIndex];
    if (!current) return 0;

    const halfWindowKm = Math.max(0.02, sampleMeters / 2000);
    let leftIndex = safeIndex;
    let rightIndex = safeIndex;

    while (leftIndex > 0 && ((Number(current.d) - Number(points[leftIndex].d)) < halfWindowKm)) {
      leftIndex--;
    }
    while (rightIndex < points.length - 1 && ((Number(points[rightIndex].d) - Number(current.d)) < halfWindowKm)) {
      rightIndex++;
    }

    if (leftIndex === rightIndex) {
      if (safeIndex > 0) leftIndex = safeIndex - 1;
      if (safeIndex < points.length - 1) rightIndex = safeIndex + 1;
    }

    const left = points[leftIndex];
    const right = points[rightIndex];
    const distMeters = Math.max(1, (Number(right.d) - Number(left.d)) * 1000);
    const elevDiff = Number(right.e) - Number(left.e);
    const angle = Math.atan(elevDiff / distMeters) * (180 / Math.PI);
    return Number.isFinite(angle) ? angle : 0;
  },

  formatGradeAngle(value = 0) {
    if (!Number.isFinite(value)) return '--';
    const rounded = Math.round(value * 10) / 10;
    const sign = rounded > 0 ? '+' : '';
    return `${sign}${rounded.toFixed(1)}°`;
  },

  getGradeColor(value = 0) {
    const absAngle = Math.abs(Number(value) || 0);
    if (absAngle <= 5) return '#5CF947';
    if (absAngle <= 15) return '#FF9811';
    if (absAngle <= 25) return '#F94747';
    return '#8B0000';
  },

  getGradeColorByBucket(bucket = '') {
    if (bucket === 'easy') return '#5CF947';
    if (bucket === 'moderate') return '#FF9811';
    if (bucket === 'steep') return '#F94747';
    if (bucket === 'extreme') return '#8B0000';
    return '#5CF947';
  },

  getGradeBucket(value = 0, previousBucket = '') {
    const absAngle = Math.abs(Number(value) || 0);
    const hysteresis = 1.2;
    if (previousBucket === 'easy' && absAngle <= (5 + hysteresis)) return 'easy';
    if (previousBucket === 'moderate') {
      if (absAngle < (5 - hysteresis)) return 'easy';
      if (absAngle <= (15 + hysteresis)) return 'moderate';
    }
    if (previousBucket === 'steep') {
      if (absAngle < (15 - hysteresis)) {
        return absAngle <= 5 ? 'easy' : 'moderate';
      }
      if (absAngle <= (25 + hysteresis)) return 'steep';
    }
    if (previousBucket === 'extreme' && absAngle >= (25 - hysteresis)) return 'extreme';

    if (absAngle <= 5) return 'easy';
    if (absAngle <= 15) return 'moderate';
    if (absAngle <= 25) return 'steep';
    return 'extreme';
  },

  getGradeOverlaySegments(points = [], options = {}) {
    if (!Array.isArray(points) || points.length < 2) return [];
    const pxPerKm = Math.max(1, Number(options.pxPerKm) || 1);
    const minSegmentPx = Math.max(2, Number(options.minSegmentPx) || 2);
    const sampleMeters = Math.max(30, Number(options.sampleMeters) || 90);
    const rawSegments = [];
    let previousBucket = '';
    for (let i = 1; i < points.length; i++) {
      const start = points[i - 1];
      const end = points[i];
      const angle = this.getGradeAngleAtIndex(points, i, sampleMeters);
      const distKm = Math.max(0.001, Number(end.d) - Number(start.d));
      const bucket = this.getGradeBucket(angle, previousBucket);
      previousBucket = bucket;
      rawSegments.push({
        startIndex: i - 1,
        endIndex: i,
        start,
        end,
        angle,
        bucket,
        distKm
      });
    }
    if (rawSegments.length === 0) return [];

    const merged = [];
    const updateMergedSegment = (target, addition, mode = 'append') => {
      const combinedDist = target.distKm + addition.distKm;
      if (mode === 'append') {
        target.endIndex = addition.endIndex;
        target.end = addition.end;
      } else {
        target.startIndex = addition.startIndex;
        target.start = addition.start;
      }
      target.angle = ((target.angle * target.distKm) + (addition.angle * addition.distKm)) / Math.max(0.001, combinedDist);
      target.distKm = combinedDist;
    };
    rawSegments.forEach((segment) => {
      const prev = merged[merged.length - 1];
      if (prev && prev.bucket === segment.bucket) {
        updateMergedSegment(prev, segment, 'append');
        return;
      }
      merged.push({ ...segment });
    });

    const getSegmentWidthPx = segment => Math.max(0.5, (segment.distKm || 0) * pxPerKm);
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < merged.length; i++) {
        const segment = merged[i];
        if (getSegmentWidthPx(segment) >= minSegmentPx) continue;

        const prev = merged[i - 1];
        const next = merged[i + 1];

        if (prev && next && prev.bucket === next.bucket) {
          updateMergedSegment(prev, segment, 'append');
          updateMergedSegment(prev, next, 'append');
          merged.splice(i, 2);
          changed = true;
          break;
        }

        if (prev && next) {
          const target = getSegmentWidthPx(prev) >= getSegmentWidthPx(next) ? prev : next;
          if (target === prev) {
            updateMergedSegment(prev, segment, 'append');
          } else {
            updateMergedSegment(next, segment, 'prepend');
          }
          merged.splice(i, 1);
          changed = true;
          break;
        }

        if (prev) {
          updateMergedSegment(prev, segment, 'append');
          merged.splice(i, 1);
          changed = true;
          break;
        }

        if (next) {
          updateMergedSegment(next, segment, 'prepend');
          merged.splice(i, 1);
          changed = true;
          break;
        }
      }
    }

    return merged;
  },

  traceElevationLinePath(ctx, points, getX, getY) {
    if (!Array.isArray(points) || points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(getX(points[0].d), getY(points[0].e));
    points.slice(1).forEach((point) => {
      ctx.lineTo(getX(point.d), getY(point.e));
    });
  },

  traceElevationFillPath(ctx, points, getX, getY, bottomY) {
    if (!Array.isArray(points) || points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(getX(points[0].d), bottomY);
    points.forEach((point) => {
      ctx.lineTo(getX(point.d), getY(point.e));
    });
    ctx.lineTo(getX(points[points.length - 1].d), bottomY);
    ctx.closePath();
  },

  drawChartBase(touchX) {
    if (!this.currentChart) return;
    const { ctx, width, height, points } = this.currentChart;
    if (!Array.isArray(points) || points.length < 2) return;
    const showGrade = !!this.data.detailGradeMode;

    const padding = { top: 20, bottom: 20, left: 0, right: 0 };
    const drawW = width;
    const drawH = height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, width, height);

    let minD = points[0].d, maxD = points[points.length-1].d;
    let minE = Math.min(...points.map(p => p.e));
    let maxE = Math.max(...points.map(p => p.e));
    const distRange = Math.max(0.01, maxD - minD);
    
    const baseRange = Math.max(1, maxE - minE);
    const elevPadding = Math.max(8, baseRange * 0.18);
    minE = Math.max(0, minE - elevPadding);
    maxE = maxE + elevPadding;
    if (maxE <= minE) maxE = minE + 20;

    const getX = (d) => ((d - minD) / distRange) * drawW;
    const getY = (e) => padding.top + drawH - ((e - minE) / (maxE - minE)) * drawH;

    ctx.lineWidth = 1;
    ctx.font = '10px sans-serif';

    const visibleRange = maxE - minE;
    const yStep = visibleRange > 800 ? 200 : (visibleRange > 300 ? 100 : 50);
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
      ctx.fillText(Math.round(ele), width - 4, py);
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

    if (showGrade) {
      const overlaySegments = this.getGradeOverlaySegments(points, {
        pxPerKm: drawW / distRange,
        sampleMeters: 90,
        minSegmentPx: 2
      });
      overlaySegments.forEach(({ startIndex, endIndex, angle, bucket }) => {
        const color = this.getGradeColorByBucket(bucket || this.getGradeBucket(angle));
        const segmentPoints = points.slice(startIndex, endIndex + 1);
        if (segmentPoints.length < 2) return;
        const firstPoint = segmentPoints[0];
        const lastPoint = segmentPoints[segmentPoints.length - 1];

        ctx.beginPath();
        ctx.moveTo(getX(firstPoint.d), height - padding.bottom);
        segmentPoints.forEach((point) => {
          ctx.lineTo(getX(point.d), getY(point.e));
        });
        ctx.lineTo(getX(lastPoint.d), height - padding.bottom);
        ctx.closePath();
        const segmentGradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
        segmentGradient.addColorStop(0, hexToRgba(color, 0.20));
        segmentGradient.addColorStop(1, hexToRgba(color, 0.05));
        ctx.fillStyle = segmentGradient;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(getX(firstPoint.d), getY(firstPoint.e));
        segmentPoints.slice(1).forEach((point) => {
          ctx.lineTo(getX(point.d), getY(point.e));
        });
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'butt';
        ctx.stroke();
      });
    } else {
      this.traceElevationFillPath(ctx, points, getX, getY, height - padding.bottom);
      const grd = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom);
      grd.addColorStop(0, 'rgba(255, 170, 22, 0.4)');
      grd.addColorStop(1, 'rgba(255, 170, 22, 0.0)');
      ctx.fillStyle = grd;
      ctx.fill();

      this.traceElevationLinePath(ctx, points, getX, getY);
      ctx.strokeStyle = '#FFAA16';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    if (touchX !== null && touchX >= 0 && touchX <= width) {
      let closestPoint = points[0];
      let closestIndex = 0;
      let minDiff = Infinity;
      points.forEach((p, index) => {
        let px = getX(p.d);
        if (Math.abs(px - touchX) < minDiff) {
          minDiff = Math.abs(px - touchX);
          closestPoint = p;
          closestIndex = index;
        }
      });

      let focusX = getX(closestPoint.d);
      let focusY = getY(closestPoint.e);
      const focusGradeAngle = showGrade
        ? this.getGradeAngleAtIndex(points, closestIndex, 90)
        : this.getGradeAngleAtIndex(points, closestIndex);

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
      ctx.strokeStyle = showGrade ? this.getGradeColor(focusGradeAngle) : '#FFAA16';
      ctx.lineWidth = 2;
      ctx.stroke();

      const tipW = showGrade ? 96 : 86;
      const tipH = showGrade ? 62 : 46;
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

      if (showGrade) {
        ctx.fillStyle = this.getGradeColor(focusGradeAngle);
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(this.formatGradeAngle(focusGradeAngle), tipX + tipW / 2, tipY + 48);
      }
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
        const savedStrategySlider = Number(data.paceStrategySlider);
        const savedEffortConfig = normalizeEffortConfig(data.effortConfig || {});
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
          timeIndex: [finalH, finalM],
          paceStrategySlider: Number.isFinite(savedStrategySlider) ? savedStrategySlider : DEFAULT_STRATEGY_SLIDER,
          effortConfig: savedEffortConfig
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
            const savedEffortConfig = normalizeEffortConfig(planData.effortConfig || {});
            const savedStrategySlider = Number(planData.paceStrategySlider);

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
              nutritionIndex: dbNutritionIndex,
              paceStrategySlider: Number.isFinite(savedStrategySlider) ? savedStrategySlider : DEFAULT_STRATEGY_SLIDER,
              effortConfig: savedEffortConfig
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
      const explicitCpNum = String(cp.cpNum || '').trim();
      const explicitLocName = String(cp.locName || '').trim();
      const isDropBag = cp.isDropBag === true || (cp.name || '').toUpperCase().includes('DP') || (cp.name || '').includes('换装');
      let defaultRest = (i === 0 || i === arr.length - 1) ? 0 : (isDropBag ? 30 : this.data.globalRestMins);

      let cpNum = explicitCpNum || (i === 0 ? '起点' : (i === arr.length - 1 ? '终点' : `CP${i}`));
      let locName = explicitLocName || cp.name || '';
      const startEle = i > 0 ? Math.round(arr[i-1].tempEle || 0) : Math.round(cp.tempEle || 0) || 0;
      const endEle = Math.round(cp.tempEle || 0);

      let segCutoffMins = null;
      let cutoffTime = cp.cutoffTime || '';
      let absoluteCutoffMinsPreset = Number.isFinite(cp.absoluteCutoffMinsPreset) ? cp.absoluteCutoffMinsPreset : null;

      if ((!explicitCpNum || !explicitLocName) && locName.includes('-')) {
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
      } else if ((!explicitCpNum || !explicitLocName) && locName.includes('～')) {
        let parts = locName.split('～');
        cpNum = parts[0] || cpNum;
        locName = parts[1] || '';
      }

      const fallbackRawPoints = this.generateMockPoints({
        ...cp,
        segDist,
        segGain,
        segLoss,
        startEle,
        endEle
      });
      const rawPoints = Array.isArray(cp.rawPoints) && cp.rawPoints.length > 1 ? cp.rawPoints : fallbackRawPoints;
      const svgProfile = cp.svgProfile || this.buildInlineSvgProfile(rawPoints);

      return { 
        ...cp, 
        cpNum, 
        locName, 
        isDropBag, 
        segDist, 
        segGain, 
        segLoss, 
        svgProfile,
        rawPoints,
        rest: defaultRest, 
        moveMins: 0,
        startEle,
        endEle,
        segCutoffMins: segCutoffMins, 
        cutoffTime: cutoffTime,
        cutoffDateText: cp.cutoffDateText || '',
        absoluteCutoffMinsPreset: absoluteCutoffMinsPreset,
        memo: cp.memo || ''
      };
    });
    this.setData({ checkpoints: cps }, () => { this.runFatigueEngine(); });
  },

  applyAdvancedPacingModel(baseMoveMins, checkpoints, movingMins, startMins) {
    const effortConfig = normalizeEffortConfig(this.data.effortConfig);
    const hasAdvancedGroups =
      effortConfig.base.runHikeThresholdEnabled ||
      effortConfig.physiology.altitudePenaltyEnabled ||
      effortConfig.physiology.nightPenaltyEnabled ||
      effortConfig.terrain.uphillSkillEnabled ||
      effortConfig.terrain.downhillSkillEnabled;

    if (!hasAdvancedGroups) {
      return baseMoveMins;
    }

    const totalDist = Number(checkpoints[checkpoints.length - 1]?.accDist) || checkpoints.reduce((sum, cp) => sum + (Number(cp.segDist) || 0), 0);
    const baseArrivals = this.estimateArrivalTimes(checkpoints, baseMoveMins, startMins);

    const weights = baseMoveMins.map((baseMove, index) => {
      if (index === 0) return 0;

      const cp = checkpoints[index];
      const segDist = Math.max(0.01, Number(cp.segDist) || 0.01);
      const segGain = Math.max(0, Number(cp.segGain) || 0);
      const segLoss = Math.max(0, Number(cp.segLoss) || 0);
      const avgGrade = segGain / (segDist * 10);
      const avgEle = ((Number(cp.startEle) || 0) + (Number(cp.endEle) || 0)) / 2;
      const totalVertical = Math.max(1, segGain + segLoss);
      const uphillShare = segGain / totalVertical;
      const downhillShare = segLoss / totalVertical;
      const arrivalHour = Number.isFinite(baseArrivals[index]) ? (((Math.floor(baseArrivals[index] / 60) % 24) + 24) % 24) : null;
      const runHikeThreshold = effortConfig.base.runHikeThresholdEnabled ? (Number(effortConfig.base.runHikeThreshold) || 12) : 12;
      const altitudeThreshold = effortConfig.physiology.altitudeThresholdEnabled ? (Number(effortConfig.physiology.altitudeThreshold) || 1800) : 1800;
      const altitudePenalty = effortConfig.physiology.altitudePenaltyEnabled ? (Number(effortConfig.physiology.altitudePenalty) || 0) : 0;
      const nightPenalty = effortConfig.physiology.nightPenaltyEnabled ? (Number(effortConfig.physiology.nightPenalty) || 0) : 0;
      const nightStartHour = clamp(Number(effortConfig.physiology.nightStartHour), 0, 23);
      const nightEndHour = clamp(Number(effortConfig.physiology.nightEndHour), 0, 23);
      const uphillSkill = effortConfig.terrain.uphillSkillEnabled ? (Number(effortConfig.terrain.uphillSkill) || 100) : 100;
      const downhillSkill = effortConfig.terrain.downhillSkillEnabled ? (Number(effortConfig.terrain.downhillSkill) || 100) : 100;

      let factor = 1;

      if (effortConfig.base.runHikeThresholdEnabled) {
        const hikeExcess = Math.max(0, avgGrade - runHikeThreshold);
        factor *= 1 + clamp(hikeExcess * 0.012, 0, 0.22);
      }

      if (altitudePenalty > 0 && avgEle > altitudeThreshold) {
        factor *= 1 + ((((avgEle - altitudeThreshold) / 1000) * altitudePenalty) / 100);
      }

      if (nightPenalty > 0 && this.isHourWithinWindow(arrivalHour, nightStartHour, nightEndHour)) {
        factor *= 1 + (nightPenalty / 100);
      }
      if (uphillSkill !== 100) {
        factor *= 1 - (uphillShare * ((uphillSkill - 100) / 100) * 0.32);
      }
      if (downhillSkill !== 100) {
        factor *= 1 - (downhillShare * ((downhillSkill - 100) / 100) * 0.28);
      }

      return Math.max(0.1, (Number(baseMove) || 0.1) * clamp(factor, 0.45, 1.9));
    });

    return this.distributeRoundedMinutes(weights, movingMins);
  },

  runFatigueEngine() {
    const { targetHours, targetMinutes, checkpoints, K } = this.data;
    const targetMins = (parseInt(targetHours) || 0) * 60 + (parseInt(targetMinutes) || 0);
    let totalED = 0;
    let activeSegments = 0;
    
    checkpoints.forEach(cp => {
      cp.segED = cp.segDist + (cp.segGain / 100); 
      totalED += cp.segED;
      if ((Number(cp.segED) || 0) > 0) activeSegments += 1;
    });
    
    const totalRest = checkpoints.reduce((sum, cp) => sum + parseInt(cp.rest || 0), 0);
    const movingMins = targetMins - totalRest;
    if (movingMins <= 0) return;

    const strategyK = this.getStrategyKValue();
    const curveK = Number.isFinite(strategyK) ? strategyK : (Number(K) || DEFAULT_CURVE_K);
    const avgSegED = activeSegments > 0 ? (totalED / activeSegments) : totalED;
    // Shift the curve origin slightly right so extreme K values don't over-amplify the first segment.
    const curveAnchorED = Math.max(1, avgSegED * 0.85, totalED * 0.06);
    const curveBase = Math.pow(curveAnchorED, curveK);
    const curveSpan = Math.pow(totalED + curveAnchorED, curveK) - curveBase;
    let runningED = 0;
    let previousExactMins = 0;
    const baseMoveWeights = checkpoints.map(() => 0);

    checkpoints.forEach((cp, i) => {
      if (i === 0) { baseMoveWeights[i] = 0; return; }
      runningED += cp.segED;

      const exactMinsSoFar = curveSpan > 0
        ? movingMins * ((Math.pow(runningED + curveAnchorED, curveK) - curveBase) / curveSpan)
        : (movingMins * (runningED / Math.max(0.01, totalED)));
      baseMoveWeights[i] = Math.max(0.01, exactMinsSoFar - previousExactMins);
      previousExactMins = exactMinsSoFar;
    });

    const smoothedBaseWeights = this.smoothStrategyBaseWeights(baseMoveWeights, checkpoints, curveK);
    const baseMoveMins = this.distributeRoundedMinutes(smoothedBaseWeights, movingMins);

    let [startH, startM] = (this.data.startTime || '07:00').split(':').map(Number);
    const startMins = (startH * 60) + startM;
    const finalMovePlan = this.applyAdvancedPacingModel(baseMoveMins, checkpoints, movingMins, startMins);
    checkpoints.forEach((cp, index) => {
      cp.moveMins = finalMovePlan[index] || 0;
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
      availableStartTimes: Array.isArray(this.data.availableStartTimes) ? [...this.data.availableStartTimes] : [],
      targetHours: this.data.targetHours,
      targetMinutes: this.data.targetMinutes,
      paceStrategySlider: this.data.paceStrategySlider,
      effortConfig: cloneEffortConfig(this.data.effortConfig),
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
    let [startH, startM] = String(startTime || '07:00').split(':').map(Number);
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
        cp.absoluteCutoffMins = Number.isFinite(cp.absoluteCutoffMinsPreset) ? cp.absoluteCutoffMinsPreset : null;
        cp.displayCutoffTime = Number.isFinite(cp.absoluteCutoffMins)
          ? this.formatTime(cp.absoluteCutoffMins)
          : (cp.cutoffTime || '--:--');
        return cp;
      }

      currentMinutes += cp.moveMins;
      cp.arrAbsoluteMins = currentMinutes;
      cp.arrTime = this.formatTime(currentMinutes); 
      
      if (Number.isFinite(cp.absoluteCutoffMinsPreset)) {
        cp.absoluteCutoffMins = cp.absoluteCutoffMinsPreset;
        cp.displayCutoffTime = this.formatTime(cp.absoluteCutoffMinsPreset);
        lastCutoffMins = cp.absoluteCutoffMinsPreset;
        runningCutoffMins = cp.absoluteCutoffMinsPreset;
      }
      else if (cp.segCutoffMins !== null && cp.segCutoffMins !== undefined) {
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
    Object.assign(updatePayload, this.buildPaceStrategyVisual(newCps));
    const localPlanSnapshot = this.saveLocalPlanSnapshot(newCps);
    updatePayload.blePlanPayload = this.buildBlePlanPayload(localPlanSnapshot);
    this.setData(updatePayload);
  },

  drawNativeElevationChart(ctx, cpData, chartX, chartY, chartW, chartH, globalMinE, globalMaxE) {
    const points = this.generateMockPoints(cpData);
    if (!points || points.length === 0) return;

    let minD = points[0].d, maxD = points[points.length-1].d;
    let minE = Math.min(...points.map(p => p.e));
    let maxE = Math.max(...points.map(p => p.e));
    const distRange = Math.max(0.01, maxD - minD);
    const baseRange = Math.max(1, maxE - minE);
    const elevPadding = Math.max(8, baseRange * 0.18);
    minE = Math.max(0, minE - elevPadding);
    maxE = maxE + elevPadding;
    if (maxE <= minE) maxE = minE + 20;

    const getX = (d) => chartX + ((d - minD) / distRange) * chartW;
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
      startTime, availableStartTimes, targetHours, targetMinutes,
      paceStrategySlider, effortConfig,
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
      startTime, availableStartTimes, targetHours, targetMinutes,
      paceStrategySlider, effortConfig,
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
