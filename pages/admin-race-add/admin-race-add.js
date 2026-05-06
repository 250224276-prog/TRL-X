const db = wx.cloud.database();
const app = getApp();

function ensureAdminAccess() {
  if (app.globalData && app.globalData.isLoggedIn && app.globalData.isAdmin) {
    return true;
  }

  wx.showModal({
    title: '无权限访问',
    content: '请先登录指定管理员账号',
    showCancel: false,
    success: () => {
      const pages = getCurrentPages();
      if (pages.length > 1) {
        wx.navigateBack();
      } else {
        wx.switchTab({ url: '/pages/profile/profile' });
      }
    }
  });
  return false;
}

function createEmptyGroup() {
  return {
    dist: '',
    oldDist: '',
    cutoffTime: '',
    cutoffDurationMins: 0,
    groupStartDate: '',
    computedColor: '#FFFFFF',
    startTimes: [],
    detailMapPath: '',
    gpxFilePath: '',
    gpxFileName: '',
    checkpointText: '',
    oldCheckpointText: '',
    oldMapFileId: '',
    oldGpxFileId: '',
    actualDist: '',
    elevation: '',
    hasGpxTrack: false,
    dataSource: 'checkpointText',
    checkpoints: []
  };
}

function getRaceDateParts(dateStr = '') {
  const nums = String(dateStr).match(/\d+/g);
  if (!nums || nums.length < 3) return null;
  const year = Number(nums[0]);
  const month = Number(nums[1]);
  const day = Number(nums[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

function pad2(num) {
  return String(num).padStart(2, '0');
}

function formatIsoDate(year, month, day) {
  if (![year, month, day].every(Number.isFinite)) return '';
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function formatCompactNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function extractDistanceValue(raw = '') {
  const match = String(raw).match(/[\d.]+/);
  return match ? parseFloat(match[0]) : NaN;
}

function extractElevationMeters(raw = '') {
  const match = String(raw || '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

function getTrackFileType(fileName = '') {
  const lower = String(fileName || '').trim().toLowerCase();
  if (lower.endsWith('.gpx')) return 'gpx';
  if (lower.endsWith('.kml')) return 'kml';
  return '';
}

function formatGroupDistanceLabel(value) {
  const text = formatCompactNumber(value);
  return text ? `${text}km` : '';
}

function normalizeGroupDistanceLabel(raw = '') {
  const value = extractDistanceValue(raw);
  return Number.isFinite(value) ? formatGroupDistanceLabel(value) : '';
}

function formatHeaderDistanceValue(value, fallback = '') {
  const text = formatCompactNumber(value);
  if (text) return text;
  const fallbackText = String(fallback || '').replace(/[^\d.]/g, '');
  return fallbackText || '';
}

function formatDistanceKm(value) {
  const text = formatCompactNumber(value);
  return text ? `${text}km` : '';
}

function formatTimeOfDay(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) return '';
  const oneDay = 24 * 60;
  const safeMinutes = ((Math.round(totalMinutes) % oneDay) + oneDay) % oneDay;
  const hour = Math.floor(safeMinutes / 60);
  const minute = safeMinutes % 60;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function formatDurationText(totalMinutes, fallback = '') {
  if (!Number.isFinite(totalMinutes)) {
    return fallback || '--';
  }

  const safeMinutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (safeMinutes === 0) return '0小时';
  if (hours > 0 && minutes > 0) return `${hours}小时${minutes}分钟`;
  if (hours > 0) return `${hours}小时`;
  return `${minutes}分钟`;
}

function parseDurationText(raw, options = {}) {
  const allowEmpty = options.allowEmpty === true;
  const text = String(raw || '').trim();

  if (!text || /^--+$/.test(text)) {
    return allowEmpty ? { minutes: null, label: '--' } : null;
  }

  let match = text.match(/^(\d+)\s*小时(?:\s*(\d+)\s*分钟)?$/);
  if (match) {
    const hours = Number(match[1]);
    const minutes = match[2] ? Number(match[2]) : 0;
    return {
      minutes: (hours * 60) + minutes,
      label: formatDurationText((hours * 60) + minutes)
    };
  }

  match = text.match(/^(\d+)\s*分钟$/);
  if (match) {
    const minutes = Number(match[1]);
    return {
      minutes,
      label: formatDurationText(minutes)
    };
  }

  return null;
}

function buildDateFromParts(year, month, day, hour, minute) {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

function parseDateTimeToken(rawText, raceDate = '', fallbackDate = null) {
  const text = String(rawText || '').trim().replace(/\s+/g, '');
  if (!text) return null;

  const raceParts = getRaceDateParts(raceDate);
  if (!raceParts) return null;

  let year = raceParts.year;
  let month = fallbackDate?.month || raceParts.month;
  let day = fallbackDate?.day || raceParts.day;
  let hour = 0;
  let minute = 0;

  let match = text.match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})(?:日|号)?(?:\s*)?(\d{1,2})(?:[:：点时])(\d{1,2})(?:分)?$/);
  if (match) {
    year = match[1] ? Number(match[1]) : raceParts.year;
    month = Number(match[2]);
    day = Number(match[3]);
    hour = Number(match[4]);
    minute = Number(match[5]);
  } else {
    match = text.match(/^(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})(?:日|号)?(?:\s*)?(\d{1,2})(?:[:：点时])(\d{1,2})(?:分)?$/);
    if (match) {
      year = match[1] ? Number(match[1]) : raceParts.year;
      month = Number(match[2]);
      day = Number(match[3]);
      hour = Number(match[4]);
      minute = Number(match[5]);
    } else {
      match = text.match(/^(\d{1,2})(?:[:：点时])(\d{1,2})(?:分)?$/);
      if (!match) return null;
      hour = Number(match[1]);
      minute = Number(match[2]);
    }
  }

  if ([year, month, day, hour, minute].some(num => !Number.isFinite(num))) return null;

  const raceMidnight = buildDateFromParts(raceParts.year, raceParts.month, raceParts.day, 0, 0);
  const targetDate = buildDateFromParts(year, month, day, hour, minute);

  return {
    year,
    month,
    day,
    hour,
    minute,
    absoluteMinutes: Math.round((targetDate.getTime() - raceMidnight.getTime()) / (60 * 1000)),
    timeText: `${pad2(hour)}:${pad2(minute)}`
  };
}

function formatStartTimesText(startTimes = [], raceDate = '') {
  const raceParts = getRaceDateParts(raceDate);
  const fallbackDate = raceParts ? {
    year: raceParts.year,
    month: raceParts.month,
    day: raceParts.day
  } : null;

  return startTimes.map((time, index) => {
    const parsed = parseDateTimeToken(time, raceDate, fallbackDate);
    if (!parsed) return String(time || '').trim();

    if (index === 0) {
      return `${parsed.month}月${parsed.day}号${pad2(parsed.hour)}点${pad2(parsed.minute)}分`;
    }

    return `${pad2(parsed.hour)}点${pad2(parsed.minute)}分`;
  }).join(', ');
}

function parseStartTimesText(rawText, raceDate = '') {
  const tokens = String(rawText || '')
    .split(/[，,]/)
    .map(token => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new Error('发枪时间不能为空');
  }

  const firstLooseParsed = parseDateTimeToken(tokens[0], raceDate, null);
  if (!firstLooseParsed) {
    throw new Error('第 1 个发枪时间无法识别，请使用“4月11号07点00分”或“07点30分”这种格式');
  }

  const groupStartDate = formatIsoDate(firstLooseParsed.year, firstLooseParsed.month, firstLooseParsed.day) || raceDate || '';
  const firstParsed = parseDateTimeToken(tokens[0], groupStartDate, null);
  if (!firstParsed) {
    throw new Error('第 1 个发枪时间无法识别，请检查发枪日期是否完整');
  }

  let fallbackDate = {
    year: firstParsed.year,
    month: firstParsed.month,
    day: firstParsed.day
  };
  let previousAbsoluteMinutes = null;

  const parsedList = tokens.map((token, index) => {
    const parsed = index === 0
      ? { ...firstParsed }
      : parseDateTimeToken(token, groupStartDate, fallbackDate);

    if (!parsed) {
      throw new Error(`第 ${index + 1} 个发枪时间无法识别，请使用“4月11号07点00分”或“07点30分”这种格式`);
    }

    let absoluteMinutes = parsed.absoluteMinutes;
    while (Number.isFinite(previousAbsoluteMinutes) && absoluteMinutes < previousAbsoluteMinutes) {
      absoluteMinutes += 24 * 60;
    }

    const normalized = {
      ...parsed,
      absoluteMinutes
    };

    fallbackDate = {
      year: normalized.year,
      month: normalized.month,
      day: normalized.day
    };
    previousAbsoluteMinutes = absoluteMinutes;
    return normalized;
  });

  return {
    startTimes: parsedList.map(item => item.timeText),
    firstStartAbsoluteMinutes: parsedList[0].absoluteMinutes,
    hasMultipleStartTimes: parsedList.length > 1,
    groupStartDate
  };
}

function isNoteLine(line = '') {
  return /^\*?\s*注[:：]/.test(String(line).trim());
}

function parseLegacyCheckpointLabel(rawName, index, total) {
  const defaultCpNum = index === 0 ? 'START' : (index === total - 1 ? 'FINISH' : `CP${index}`);
  const label = String(rawName || '').trim();
  if (!label) return { cpNum: defaultCpNum, locName: '' };

  if (label.includes('-')) {
    const parts = label.split('-');
    return {
      cpNum: (parts[0] || defaultCpNum).trim(),
      locName: parts.slice(1).join('-').trim()
    };
  }

  if (label.includes('～')) {
    const parts = label.split('～');
    return {
      cpNum: (parts[0] || defaultCpNum).trim(),
      locName: parts.slice(1).join('～').trim()
    };
  }

  return {
    cpNum: defaultCpNum,
    locName: label
  };
}

function inferStartTimesFromGroup(group = {}, raceDate = '') {
  const startTimes = Array.isArray(group.startTimes) ? group.startTimes.filter(Boolean) : [];
  if (startTimes.length > 0) return startTimes;

  const legacyStartTimes = [group.startTime, group.startTime2].filter(Boolean);
  if (legacyStartTimes.length > 0) return legacyStartTimes;

  if (Array.isArray(group.checkpoints) && group.checkpoints[0]?.absoluteCutoffMinsPreset !== undefined) {
    const startTime = formatTimeOfDay(group.checkpoints[0].absoluteCutoffMinsPreset);
    if (startTime) return [startTime];
  }

  if (Array.isArray(group.checkpoints) && group.checkpoints[0]?.cutoffTime) {
    return [group.checkpoints[0].cutoffTime];
  }

  return ['07:00'];
}

function inferGroupCutoffDuration(group = {}, raceDate = '', startTimes = []) {
  if (Number.isFinite(group.cutoffDurationMins) && group.cutoffDurationMins > 0) {
    return {
      minutes: group.cutoffDurationMins,
      label: formatDurationText(group.cutoffDurationMins)
    };
  }

  const startParser = parseDateTimeToken(startTimes[0], raceDate);
  const startAbs = startParser ? startParser.absoluteMinutes : null;

  if (Array.isArray(group.checkpoints) && group.checkpoints.length > 0) {
    const finish = group.checkpoints[group.checkpoints.length - 1];
    if (Number.isFinite(finish?.absoluteCutoffMinsPreset) && Number.isFinite(startAbs)) {
      const minutes = Math.max(0, finish.absoluteCutoffMinsPreset - startAbs);
      return {
        minutes,
        label: formatDurationText(minutes)
      };
    }
  }

  const parsed = parseDurationText(group.cutoffTime, { allowEmpty: true });
  if (parsed && Number.isFinite(parsed.minutes)) {
    return {
      minutes: parsed.minutes,
      label: parsed.label
    };
  }

  return {
    minutes: 0,
    label: String(group.cutoffTime || '').trim()
  };
}

function serializeCheckpointTextFromGroup(group = {}, raceDate = '') {
  const checkpoints = Array.isArray(group.checkpoints) ? group.checkpoints : [];
  const groupBaseDate = group.groupStartDate || raceDate;
  const startTimes = inferStartTimesFromGroup(group, groupBaseDate);
  const startTimesText = formatStartTimesText(startTimes, groupBaseDate);
  const startParser = parseDateTimeToken(startTimes[0], groupBaseDate);
  const firstStartAbsoluteMinutes = startParser ? startParser.absoluteMinutes : 0;
  const groupCutoff = inferGroupCutoffDuration(group, groupBaseDate, startTimes);
  const headerDistance = formatHeaderDistanceValue(extractDistanceValue(group.dist), group.dist);

  const lines = [
    `组别距离：${headerDistance}`,
    `发枪时间：${startTimesText}`,
    `关门时长：${groupCutoff.label || ''}`
  ];

  checkpoints.forEach((cp, index, arr) => {
    const legacy = parseLegacyCheckpointLabel(cp.name, index, arr.length);
    const cpNum = String(cp.cpNum || legacy.cpNum || '').trim();
    const locName = String(cp.locName || legacy.locName || '').trim();
    const distanceText = formatDistanceKm(cp.accDist);

    let durationText = String(cp.cutoffDurationText || '').trim();
    if (!durationText) {
      if (index === 0) {
        durationText = '0小时';
      } else if (Number.isFinite(cp.absoluteCutoffMinsPreset) && Number.isFinite(firstStartAbsoluteMinutes)) {
        durationText = formatDurationText(cp.absoluteCutoffMinsPreset - firstStartAbsoluteMinutes);
      } else {
        durationText = '--';
      }
    }

    const isDropBag = cp.isDropBag === true || /换装/.test(String(cp.name || '')) || /^DP/i.test(cpNum);
    const cutoffSegment = durationText === '--' ? `${distanceText}--` : `${distanceText}-${durationText}`;
    lines.push(`${cpNum}-${locName}-${cutoffSegment}${isDropBag ? '-换装点' : ''}`);
  });

  if (startTimes.length > 1) {
    lines.push('*注：本组别包含分批起跑，以上关门时长均以第一批起跑时间为基准计算。');
  }

  return lines.join('\n').trim();
}

function parseCheckpointText(checkpointText, raceDate) {
  const lines = String(checkpointText || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  const contentLines = lines.filter(line => !isNoteLine(line));
  if (contentLines.length < 5) {
    throw new Error('站点文本至少需要包含 3 行全局信息和 2 行站点信息');
  }

  const distMatch = contentLines[0].match(/^组别距离[:：]\s*(.+)$/);
  const startMatch = contentLines[1].match(/^发枪时间[:：]\s*(.+)$/);
  const cutoffMatch = contentLines[2].match(/^关门时长[:：]\s*(.+)$/);

  if (!distMatch || !startMatch || !cutoffMatch) {
    throw new Error('站点文本前三行必须依次是：组别距离、发枪时间、关门时长');
  }

  const groupDistanceNumber = extractDistanceValue(distMatch[1]);
  if (!Number.isFinite(groupDistanceNumber)) {
    throw new Error('组别距离无法识别，请使用“组别距离：46”这种格式');
  }

  const startInfo = parseStartTimesText(startMatch[1], raceDate);
  const groupCutoffInfo = parseDurationText(cutoffMatch[1]);
  if (!groupCutoffInfo || !Number.isFinite(groupCutoffInfo.minutes)) {
    throw new Error('关门时长无法识别，请使用“13小时”或“13小时30分钟”这种格式');
  }

  let stationStartIndex = 3;
  let groupGainMeters = NaN;
  let groupLossMeters = NaN;

  while (stationStartIndex < contentLines.length) {
    const metaLine = contentLines[stationStartIndex];
    const gainMatch = metaLine.match(/^(?:爬升|累计爬升|总爬升)[:：]\s*(.+)$/);
    const lossMatch = metaLine.match(/^(?:下降|累计下降|总下降)[:：]\s*(.+)$/);

    if (gainMatch) {
      groupGainMeters = extractElevationMeters(gainMatch[1]);
      stationStartIndex += 1;
      continue;
    }

    if (lossMatch) {
      groupLossMeters = extractElevationMeters(lossMatch[1]);
      stationStartIndex += 1;
      continue;
    }

    break;
  }

  const stationLines = contentLines.slice(stationStartIndex);
  if (stationLines.length < 2) {
    throw new Error('站点文本至少需要包含起点和终点两行站点信息');
  }

  const checkpoints = [];
  let previousDistance = -1;

  stationLines.forEach((line, index) => {
    const sourceLineNumber = stationStartIndex + index + 1;
    let workingLine = line;
    let isDropBag = false;
    if (/-\s*📦\s*换装点$/.test(workingLine) || /-\s*换装点$/.test(workingLine)) {
      isDropBag = true;
      workingLine = workingLine.replace(/-\s*📦\s*换装点$/, '').replace(/-\s*换装点$/, '').trim();
    }

    const match = workingLine.match(/^(.*?)-(.*)-([\d.]+km)(.*)$/);
    if (!match) {
      throw new Error(`第 ${sourceLineNumber} 行格式不正确，请使用“站点编号-地名-所处距离-关门时长-换装点”`);
    }

    const cpNum = String(match[1] || '').trim();
    const locName = String(match[2] || '').trim();
    const distanceKm = extractDistanceValue(match[3]);
    const tail = String(match[4] || '').trim();

    let cutoffToken = '';
    if (!tail || tail === '--' || tail === '-') {
      cutoffToken = '--';
    } else if (tail.startsWith('-')) {
      cutoffToken = tail.slice(1).trim() || '--';
    } else {
      throw new Error(`第 ${sourceLineNumber} 行关门时长格式不正确`);
    }

    if (!cpNum || !locName || !Number.isFinite(distanceKm)) {
      throw new Error(`第 ${sourceLineNumber} 行存在空字段或距离格式错误`);
    }

    if (distanceKm < previousDistance) {
      throw new Error(`第 ${sourceLineNumber} 行距离小于上一站，站点需要按赛道顺序递增`);
    }

    const cutoffInfo = parseDurationText(cutoffToken, { allowEmpty: true });
    if (!cutoffInfo) {
      throw new Error(`第 ${sourceLineNumber} 行关门时长无法识别，请使用“3小时”“10小时30分钟”或“--”`);
    }

    let cutoffDurationMins = cutoffInfo.minutes;
    let cutoffDurationText = cutoffInfo.label;

    if (index === 0) {
      if (cutoffDurationMins === null) {
        cutoffDurationMins = 0;
        cutoffDurationText = '0小时';
      }
      if (cutoffDurationMins !== 0) {
        throw new Error('起点 START 的关门时长必须是 0小时');
      }
    }

    if (index === stationLines.length - 1 && cutoffDurationMins === null) {
      cutoffDurationMins = groupCutoffInfo.minutes;
      cutoffDurationText = groupCutoffInfo.label;
    }

    const absoluteCutoffMinsPreset = Number.isFinite(cutoffDurationMins)
      ? startInfo.firstStartAbsoluteMinutes + cutoffDurationMins
      : null;

    checkpoints.push({
      cpNum,
      locName,
      name: `${cpNum}-${locName}`,
      accDist: Number(distanceKm.toFixed(2)),
      cutoffDurationText,
      cutoffTime: Number.isFinite(absoluteCutoffMinsPreset) ? formatTimeOfDay(absoluteCutoffMinsPreset) : '',
      absoluteCutoffMinsPreset,
      isDropBag,
      rest: index === 0 || index === stationLines.length - 1 ? 0 : (isDropBag ? 30 : 5)
    });

    previousDistance = distanceKm;
  });

  return {
    groupDistanceNumber,
    groupDistanceLabel: formatGroupDistanceLabel(groupDistanceNumber),
    groupStartDate: startInfo.groupStartDate || raceDate || '',
    startTimes: startInfo.startTimes,
    firstStartAbsoluteMinutes: startInfo.firstStartAbsoluteMinutes,
    hasMultipleStartTimes: startInfo.hasMultipleStartTimes,
    groupGainMeters,
    groupLossMeters,
    groupCutoffDurationMins: groupCutoffInfo.minutes,
    groupCutoffDurationText: groupCutoffInfo.label,
    checkpoints
  };
}

function buildTextOnlyGroupMetrics(parsedConfig = {}) {
  const sourceCheckpoints = Array.isArray(parsedConfig.checkpoints) ? parsedConfig.checkpoints : [];
  const checkpoints = sourceCheckpoints.map((cp, index, arr) => {
    const accDist = Number(cp.accDist) || 0;
    const prevDist = index > 0 ? (Number(arr[index - 1].accDist) || 0) : 0;
    const accGain = Number.isFinite(Number(cp.accGain)) ? Number(cp.accGain) : 0;
    const accLoss = Number.isFinite(Number(cp.accLoss)) ? Number(cp.accLoss) : 0;
    const prevGain = index > 0 && Number.isFinite(Number(arr[index - 1].accGain)) ? Number(arr[index - 1].accGain) : 0;
    const prevLoss = index > 0 && Number.isFinite(Number(arr[index - 1].accLoss)) ? Number(arr[index - 1].accLoss) : 0;

    return {
      ...cp,
      accDist: Number(accDist.toFixed(2)),
      accGain: Math.round(accGain),
      accLoss: Math.round(accLoss),
      tempEle: Number.isFinite(Number(cp.tempEle)) ? Number(cp.tempEle) : 0,
      segDist: index === 0 ? 0 : Number(Math.max(0, accDist - prevDist).toFixed(2)),
      segGain: index === 0 ? 0 : Math.round(Math.max(0, accGain - prevGain)),
      segLoss: index === 0 ? 0 : Math.round(Math.max(0, accLoss - prevLoss))
    };
  });

  const lastCheckpoint = checkpoints[checkpoints.length - 1];
  const totalDist = lastCheckpoint && Number.isFinite(Number(lastCheckpoint.accDist))
    ? Number(lastCheckpoint.accDist)
    : parsedConfig.groupDistanceNumber;
  const totalGain = Number.isFinite(Number(parsedConfig.groupGainMeters))
    ? Number(parsedConfig.groupGainMeters)
    : (lastCheckpoint && Number.isFinite(Number(lastCheckpoint.accGain)) ? Number(lastCheckpoint.accGain) : 0);
  const totalLoss = Number.isFinite(Number(parsedConfig.groupLossMeters))
    ? Number(parsedConfig.groupLossMeters)
    : (lastCheckpoint && Number.isFinite(Number(lastCheckpoint.accLoss)) ? Number(lastCheckpoint.accLoss) : 0);

  return {
    actualDist: formatDistanceKm(totalDist) || parsedConfig.groupDistanceLabel || '待补轨迹',
    elevation: `${Math.round(totalGain)}m+ / ${Math.round(totalLoss)}m-`,
    checkpoints
  };
}

Page({
  data: {
    mode: 'create',
    currentRaceId: null,
    oldRaceDate: '',

    raceName: '',
    raceDate: '',
    location: '',
    hasItra: false,
    coverImgPath: '',
    oldCoverFileId: '',

    groups: [createEmptyGroup()]
  },

  onLoad(options) {
    if (!ensureAdminAccess()) return;

    if (options.id) {
      this.setData({ mode: 'edit', currentRaceId: options.id });
      wx.setNavigationBarTitle({ title: '编辑赛事档案' });
      this.loadRaceData(options.id);
    }
  },

  getGroupColor(distStr) {
    if (!distStr) return '#FFFFFF';
    const dist = extractDistanceValue(distStr) || 0;

    if (dist < 30) return '#36E153';
    if (dist < 60) return '#FF9811';
    if (dist < 100) return '#3284FF';
    return '#F94747';
  },

  async loadRaceData(raceId) {
    wx.showLoading({ title: '加载赛事数据...', mask: true });
    try {
      const res = await db.collection('races').doc(raceId).get();
      const race = res.data || {};

      let loadedGroups = (race.groups || []).map(group => {
        const startTimes = inferStartTimesFromGroup(group, race.date || '');
        const checkpointText = String(
          group.checkpointText || serializeCheckpointTextFromGroup(group, group.groupStartDate || race.date || '')
        ).trim();

        return {
          dist: normalizeGroupDistanceLabel(group.dist || ''),
          oldDist: normalizeGroupDistanceLabel(group.dist || ''),
          cutoffTime: group.cutoffTime || '',
          cutoffDurationMins: group.cutoffDurationMins || 0,
          groupStartDate: group.groupStartDate || race.date || '',
          computedColor: this.getGroupColor(group.dist || ''),
          startTimes,
          detailMapPath: group.detailMapImg || '',
          gpxFilePath: group.gpxFileID || '',
          gpxFileName: group.gpxFileID ? '已上传历史轨迹文件 (点击可重传)' : '',
          checkpointText,
          oldCheckpointText: checkpointText,
          oldMapFileId: group.detailMapImg || '',
          oldGpxFileId: group.gpxFileID || '',
          actualDist: group.actualDist || '',
          elevation: group.elevation || '',
          hasGpxTrack: Boolean(group.hasGpxTrack || group.gpxFileID),
          dataSource: group.dataSource || (group.gpxFileID ? 'trackFile' : 'checkpointText'),
          checkpoints: group.checkpoints || []
        };
      });

      if (loadedGroups.length === 0) {
        loadedGroups = [createEmptyGroup()];
      }

      this.setData({
        raceName: race.name || '',
        raceDate: race.date || '',
        oldRaceDate: race.date || '',
        location: race.location || '',
        hasItra: Boolean(race.hasItra),
        coverImgPath: race.coverImg || '',
        oldCoverFileId: race.coverImg || '',
        groups: loadedGroups
      });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '数据读取失败', icon: 'none' });
    }
  },

  goToRaceList() {
    wx.navigateTo({ url: '/pages/admin-race-list/admin-race-list' });
  },

  onDateChange(e) {
    this.setData({ raceDate: e.detail.value });
  },

  onLocationInput(e) {
    this.setData({ location: e.detail.value });
  },

  onItraChange(e) {
    this.setData({ hasItra: e.detail.value });
  },

  onRaceNameInput(e) {
    this.setData({ raceName: e.detail.value });
  },

  chooseCoverImg() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: res => this.setData({ coverImgPath: res.tempFiles[0].tempFilePath })
    });
  },

  addGroup() {
    const groups = [...this.data.groups, createEmptyGroup()];
    this.setData({ groups });
  },

  removeGroup(e) {
    const index = e.currentTarget.dataset.index;
    const groups = [...this.data.groups];
    if (groups.length === 1) {
      return wx.showToast({ title: '至少保留一个组别', icon: 'none' });
    }
    groups.splice(index, 1);
    this.setData({ groups });
  },

  onGroupInput(e) {
    const { index, field } = e.currentTarget.dataset;
    const value = e.detail.value;

    if (field === 'dist') {
      const normalizedDist = normalizeGroupDistanceLabel(value);
      const color = this.getGroupColor(normalizedDist);
      this.setData({
        [`groups[${index}].dist`]: normalizedDist,
        [`groups[${index}].computedColor`]: color
      });
      return;
    }

    this.setData({ [`groups[${index}].${field}`]: value });
  },

  chooseGroupMap(e) {
    const index = e.currentTarget.dataset.index;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      success: res => this.setData({ [`groups[${index}].detailMapPath`]: res.tempFiles[0].tempFilePath })
    });
  },

  chooseGroupGpx(e) {
    const index = e.currentTarget.dataset.index;
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: res => {
        const file = res.tempFiles[0];
        if (!getTrackFileType(file.name)) {
          wx.showToast({ title: '格式错误，只能选 GPX 或 KML 文件', icon: 'none', duration: 2000 });
          return;
        }
        this.setData({
          [`groups[${index}].gpxFilePath`]: file.path,
          [`groups[${index}].gpxFileName`]: file.name
        });
      }
    });
  },

  isTempFile(path) {
    return path && (path.startsWith('wxfile://') || path.startsWith('http://tmp') || path.startsWith('file://'));
  },

  isSavedFileReference(path) {
    if (!path) return false;
    if (path.startsWith('cloud://')) return true;
    if (/^https?:\/\//i.test(path) && !path.startsWith('http://tmp') && !path.startsWith('https://tmp')) {
      return true;
    }
    return false;
  },

  uploadToCloud(localPath, folderName) {
    return new Promise((resolve, reject) => {
      if (!localPath) {
        resolve('');
        return;
      }

      if (this.isSavedFileReference(localPath)) {
        resolve(localPath);
        return;
      }

      if (!this.isTempFile(localPath)) {
        resolve(localPath);
        return;
      }

      const extMatch = localPath.match(/\.[^.]+?$/);
      const ext = extMatch ? extMatch[0] : '.png';
      const cloudPath = `${folderName}/${Date.now()}-${Math.floor(Math.random() * 1000)}${ext}`;

      wx.cloud.uploadFile({
        cloudPath,
        filePath: localPath,
        success: res => resolve(res.fileID),
        fail: err => reject(err)
      });
    });
  },

  uploadJsonPayloadToCloud(payload, folderName = 'admin-payloads') {
    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager();
      const filePath = `${wx.env.USER_DATA_PATH}/race-admin-${Date.now()}-${Math.floor(Math.random() * 1000)}.json`;
      const cloudPath = `${folderName}/${Date.now()}-${Math.floor(Math.random() * 1000)}.json`;
      const json = JSON.stringify(payload);

      fs.writeFile({
        filePath,
        data: json,
        encoding: 'utf8',
        success: () => {
          wx.cloud.uploadFile({
            cloudPath,
            filePath,
            success: (res) => {
              try {
                fs.unlinkSync(filePath);
              } catch (err) {
                console.warn('清理临时赛事数据失败', err);
              }
              resolve(res.fileID);
            },
            fail: (err) => {
              try {
                fs.unlinkSync(filePath);
              } catch (unlinkErr) {
                console.warn('清理临时赛事数据失败', unlinkErr);
              }
              reject(err);
            }
          });
        },
        fail: reject
      });
    });
  },

  isMetadataOnlyEdit(groups = []) {
    if (this.data.mode !== 'edit') return false;
    if (this.isTempFile(this.data.coverImgPath)) return false;

    return groups.every(group => {
      const currentDist = normalizeGroupDistanceLabel(group.dist || '');
      const oldDist = normalizeGroupDistanceLabel(group.oldDist || group.dist || '');
      const checkpointUnchanged = String(group.checkpointText || '').trim() === String(group.oldCheckpointText || '').trim();
      const mapUnchanged = String(group.detailMapPath || '') === String(group.oldMapFileId || '');
      const trackUnchanged = String(group.gpxFilePath || '') === String(group.oldGpxFileId || '');

      return currentDist === oldDist && checkpointUnchanged && mapUnchanged && trackUnchanged;
    });
  },

  buildMetadataOnlyUpdate(groups = []) {
    const {
      raceName,
      raceDate,
      oldRaceDate,
      location,
      hasItra,
      coverImgPath
    } = this.data;

    const updateData = {
      name: raceName,
      location: location || '',
      date: raceDate,
      hasItra: Boolean(hasItra),
      coverImg: coverImgPath,
      tags: groups.map(group => {
        const dist = normalizeGroupDistanceLabel(group.dist || '');
        return {
          dist,
          color: this.getGroupColor(dist)
        };
      }).filter(tag => tag.dist),
      updateTime: db.serverDate()
    };

    groups.forEach((group, index) => {
      if (!group.groupStartDate || group.groupStartDate === oldRaceDate) {
        updateData[`groups.${index}.groupStartDate`] = raceDate;
      }
    });

    return updateData;
  },

  async submitAndIgnite() {
    const {
      mode,
      currentRaceId,
      oldRaceDate,
      raceName,
      raceDate,
      location,
      hasItra,
      coverImgPath,
      groups
    } = this.data;

    if (!raceName || !raceDate) {
      return wx.showToast({ title: '至少填写比赛名称和日期', icon: 'none' });
    }

    if (!coverImgPath) {
      return wx.showToast({ title: '请先上传赛事主封面', icon: 'none' });
    }

    wx.showLoading({ title: mode === 'edit' ? '更新赛事档案...' : '构建赛事档案...', mask: true });

    try {
      if (this.isMetadataOnlyEdit(groups)) {
        await db.collection('races').doc(currentRaceId).update({
          data: this.buildMetadataOnlyUpdate(groups)
        });

        wx.hideLoading();
        wx.showModal({
          title: '更新成功',
          content: '赛事基础信息已保存。',
          showCancel: false,
          success: () => wx.navigateBack()
        });
        return;
      }

      const coverFileID = await this.uploadToCloud(coverImgPath, 'race-covers');
      const dbGroups = [];
      const tags = [];
      const parseJobs = [];

      for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const checkpointText = String(group.checkpointText || '').trim();
        const inputDist = String(group.dist || '').trim();

        if (!checkpointText && !inputDist && !group.gpxFilePath) {
          continue;
        }

        if (!checkpointText) {
          throw new Error(`组别 #${i + 1} 还没有填写站点文本`);
        }

        wx.showLoading({ title: `处理组别 #${i + 1} 数据...`, mask: true });

        let parsedConfig;
        try {
          parsedConfig = parseCheckpointText(checkpointText, raceDate);
        } catch (parseError) {
          const canReuseLegacyGroup = mode === 'edit'
            && raceDate !== oldRaceDate
            && checkpointText === String(group.oldCheckpointText || '').trim()
            && Array.isArray(group.checkpoints)
            && group.checkpoints.length > 0;

          if (!canReuseLegacyGroup) {
            throw parseError;
          }

          const legacyDistLabel = normalizeGroupDistanceLabel(inputDist || group.dist);
          if (!legacyDistLabel) {
            throw parseError;
          }

          const legacyMapFileID = await this.uploadToCloud(group.detailMapPath, 'race-maps');
          const legacyTrackFileID = group.gpxFilePath ? await this.uploadToCloud(group.gpxFilePath, 'gpx-tracks') : '';
          const legacyHexColor = this.getGroupColor(legacyDistLabel);
          const shouldMoveGroupDate = !group.groupStartDate || group.groupStartDate === oldRaceDate;

          tags.push({ dist: legacyDistLabel, color: legacyHexColor });
          dbGroups.push({
            dist: legacyDistLabel,
            cutoffTime: group.cutoffTime || '',
            cutoffDurationMins: group.cutoffDurationMins || 0,
            groupStartDate: shouldMoveGroupDate ? raceDate : group.groupStartDate,
            themeColor: legacyHexColor,
            startTimes: group.startTimes || inferStartTimesFromGroup(group, raceDate),
            startTime: (group.startTimes && group.startTimes[0]) || group.startTime || '07:00',
            startTime2: (group.startTimes && group.startTimes[1]) || group.startTime2 || null,
            detailMapImg: legacyMapFileID,
            gpxFileID: legacyTrackFileID,
            checkpointText,
            checkpoints: group.checkpoints,
            hasGpxTrack: Boolean(legacyTrackFileID),
            dataSource: group.dataSource || (legacyTrackFileID ? 'trackFile' : 'checkpointText'),
            actualDist: group.actualDist || '',
            elevation: group.elevation || ''
          });
          continue;
        }

        const inputDistValue = extractDistanceValue(inputDist);
        if (Number.isFinite(inputDistValue) && Math.abs(inputDistValue - parsedConfig.groupDistanceNumber) > 0.2) {
          throw new Error(`组别 #${i + 1} 的距离输入与站点文本首行“组别距离”不一致`);
        }

        const finalDistLabel = normalizeGroupDistanceLabel(inputDist || parsedConfig.groupDistanceLabel);
        if (!finalDistLabel) {
          throw new Error(`组别 #${i + 1} 缺少距离信息`);
        }

        const mapFileID = await this.uploadToCloud(group.detailMapPath, 'race-maps');
        const gpxFileID = group.gpxFilePath ? await this.uploadToCloud(group.gpxFilePath, 'gpx-tracks') : '';

        const hexColor = this.getGroupColor(finalDistLabel);
        const hasGpxFile = Boolean(gpxFileID);
        const textFallback = buildTextOnlyGroupMetrics(parsedConfig);
        const gpxChanged = hasGpxFile && (this.isTempFile(group.gpxFilePath) || !group.oldGpxFileId || gpxFileID !== group.oldGpxFileId);
        const checkpointTextChanged = checkpointText !== String(group.oldCheckpointText || '').trim();
        const hasExistingCheckpoints = Array.isArray(group.checkpoints) && group.checkpoints.length > 0;
        const needsParse = hasGpxFile && (gpxChanged || checkpointTextChanged || !hasExistingCheckpoints);
        const displayActualDist = needsParse ? '轨迹解析中...' : (hasGpxFile ? (group.actualDist || textFallback.actualDist) : textFallback.actualDist);
        const displayElevation = needsParse ? '轨迹解析中...' : (hasGpxFile ? (group.elevation || textFallback.elevation) : textFallback.elevation);
        const displayCheckpoints = (!hasGpxFile || needsParse || !hasExistingCheckpoints) ? textFallback.checkpoints : group.checkpoints;
        const dataSource = hasGpxFile ? 'trackFile' : 'checkpointText';
        const targetGroupIndex = dbGroups.length;

        if (needsParse) {
          parseJobs.push({
            groupIndex: targetGroupIndex,
            fileID: gpxFileID,
            manualCheckpoints: parsedConfig.checkpoints,
            fallbackElevation: textFallback.elevation
          });
        }

        tags.push({ dist: finalDistLabel, color: hexColor });

        dbGroups.push({
          dist: finalDistLabel,
          cutoffTime: parsedConfig.groupCutoffDurationText,
          cutoffDurationMins: parsedConfig.groupCutoffDurationMins,
          groupStartDate: parsedConfig.groupStartDate || raceDate,
          themeColor: hexColor,
          startTimes: parsedConfig.startTimes,
          startTime: parsedConfig.startTimes[0] || '07:00',
          startTime2: parsedConfig.startTimes[1] || null,
          detailMapImg: mapFileID,
          gpxFileID,
          checkpointText,
          checkpoints: displayCheckpoints,
          hasGpxTrack: hasGpxFile,
          dataSource,
          actualDist: displayActualDist,
          elevation: displayElevation
        });
      }

      if (dbGroups.length === 0) {
        throw new Error('请至少填写一个组别');
      }

      let targetRaceId = currentRaceId;
      const finalData = {
        name: raceName,
        location: location || '',
        date: raceDate,
        hasItra: Boolean(hasItra),
        coverImg: coverFileID,
        tags,
        groups: dbGroups
      };

      wx.showLoading({ title: '提交赛事数据...', mask: true });
      const payloadFileID = await this.uploadJsonPayloadToCloud(finalData);
      const saveRes = await wx.cloud.callFunction({
        name: 'saveRaceAdmin',
        data: {
          mode,
          raceId: targetRaceId,
          payloadFileID
        }
      });

      if (!saveRes || !saveRes.result || saveRes.result.success !== true) {
        throw new Error(
          (saveRes && saveRes.result && (saveRes.result.error || saveRes.result.msg))
          || '赛事保存失败'
        );
      }

      targetRaceId = saveRes.result.raceId || targetRaceId;

      if (parseJobs.length > 0) {
        for (const job of parseJobs) {
          wx.showLoading({ title: `解析 ${dbGroups[job.groupIndex].dist} 轨迹...`, mask: true });
          const parseRes = await wx.cloud.callFunction({
            name: 'syncGpxToDb',
            data: {
              raceDocId: targetRaceId,
              groupIndex: job.groupIndex,
              fileID: job.fileID,
              manualCheckpoints: job.manualCheckpoints,
              fallbackElevation: job.fallbackElevation
            }
          });

          if (!parseRes || !parseRes.result || parseRes.result.success !== true) {
            throw new Error(
              (parseRes && parseRes.result && (parseRes.result.error || parseRes.result.msg))
              || `组别「${dbGroups[job.groupIndex].dist}」轨迹解析失败`
            );
          }
        }
      }

      wx.hideLoading();
      const hasTextOnlyGroups = dbGroups.some(group => !group.gpxFileID);
      const successContent = parseJobs.length > 0
        ? '轨迹和文本站点都已经同步完成，计划页可直接按新规则生成。'
        : (hasTextOnlyGroups
          ? '赛事已保存。未上传轨迹文件的组别会先用站点文本展示关键数据，但暂不能制定计划。'
          : '赛事基础信息已保存。');

      wx.showModal({
        title: mode === 'edit' ? '✅ 更新成功' : '🚀 赛事建档成功',
        content: successContent,
        showCancel: false,
        success: () => wx.navigateBack()
      });
    } catch (error) {
      wx.hideLoading();
      console.error(error);
      const rawMessage = error.message || '网络异常';
      const displayMessage = /FUNCTION_NOT_FOUND|FunctionName parameter could not be found|saveRaceAdmin/i.test(rawMessage)
        ? '完整保存需要先部署 saveRaceAdmin 云函数；如果只是改日期、名称、地点等基础信息，请重新进入页面后直接保存。'
        : rawMessage;
      wx.showModal({
        title: '操作中断',
        content: displayMessage,
        showCancel: false
      });
    }
  },

  goBack() {
    wx.navigateBack();
  }
});
