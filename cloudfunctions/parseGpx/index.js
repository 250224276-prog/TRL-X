const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 高性能 Haversine 算法 (单位: 米)
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

exports.main = async (event, context) => {
  const { fileID, fileName } = event;
  if (!fileID) return { success: false, msg: "缺少核心参数" };

  try {
    const res = await cloud.downloadFile({ fileID: fileID });
    const xml = res.fileContent.toString('utf-8');

    // ==========================================
    // 步骤 1：解析所有轨迹点并计算 3D 距离与双向爬降
    // ==========================================
    const trkpts = [];
    const trkptRegex = /<trkpt lat="([\d.-]+)" lon="([\d.-]+)">([\s\S]*?)<\/trkpt>/g;
    
    let totalDistM = 0, totalGain = 0, totalLoss = 0;
    let altAccGain = 0, altAccLoss = 0;
    let anchorPt = null;
    const ALT_THRESHOLD = 3.0;  
    const DIST_THRESHOLD = 2.0; 
    const MAX_GRADIENT = 0.5;   

    let match;
    while ((match = trkptRegex.exec(xml)) !== null) {
      const lat = parseFloat(match[1]), lon = parseFloat(match[2]);
      if (isNaN(lat) || isNaN(lon) || (lat === 0 && lon === 0)) continue;

      const inner = match[3];
      const eleMatch = inner.match(/<ele>([\d.-]+)<\/ele>/i);
      const ele = eleMatch ? parseFloat(eleMatch[1]) : null;

      if (trkpts.length > 0) {
        const prev = trkpts[trkpts.length - 1];
        if (!anchorPt) anchorPt = prev;

        const dist2D = haversineMeters(anchorPt.lat, anchorPt.lon, lat, lon);
        if (dist2D >= DIST_THRESHOLD) {
          let diff = (ele !== null && anchorPt.ele !== null) ? (ele - anchorPt.ele) : 0;
          if (dist2D > 0 && Math.abs(diff) / dist2D > MAX_GRADIENT) {
            diff = dist2D * MAX_GRADIENT * Math.sign(diff);
          }
          totalDistM += Math.sqrt(Math.pow(dist2D, 2) + Math.pow(diff, 2)); 
          anchorPt = { lat, lon, ele }; 
        }

        if (ele !== null && prev.ele !== null) {
          const diffAlt = ele - prev.ele;
          if (diffAlt > 0) {
            altAccGain += diffAlt;
            if (altAccGain >= ALT_THRESHOLD) { totalGain += altAccGain; altAccGain = 0; }
            altAccLoss = 0;
          } else if (diffAlt < 0) {
            altAccLoss += Math.abs(diffAlt);
            if (altAccLoss >= ALT_THRESHOLD) { totalLoss += altAccLoss; altAccLoss = 0; }
            altAccGain = 0;
          }
        }
      }
      trkpts.push({ lat, lon, ele, accDist: totalDistM / 1000, accGain: totalGain, accLoss: totalLoss });
    }

    // ==========================================
    // 步骤 2：提取 WPT 点，启动【黑名单过滤】机制
    // ==========================================
    let cpsRaw = [];
    const wptRegex = /<wpt lat="([\d.-]+)" lon="([\d.-]+)">([\s\S]*?)<\/wpt>/g;
    let wptMatch;
    
    // ✨ 核心鉴别器：提取逻辑序号 + 脏数据黑名单 (已放行换装点 DP)
    function getLogicalOrder(name) {
      const upper = name.toUpperCase();
      
      // 🚨 终极黑名单：只杀纯水站、医疗点等，保留 DP/换装
      const blacklist = [
        '水站', '补水', 'WP', 'SP', // 纯补给杂点 (DP已被释放)
        '医疗', '救援', '急救', '厕所', 'WC', 'TOILET', // 设施保障
        '岔路', '路口', '左转', '右转', '危险', '注意', // 导航预警
        '摄影', '拍照', '风景', '观景', // 赛道气氛
        '临时', '测试', '备用', '打卡垫' // 组委会暗桩
      ];
      // 如果触发黑名单，直接干掉
      if (blacklist.some(word => upper.includes(word))) return -1;

      // 判定起终点
      if (upper.includes('起点') || upper.includes('START') || upper === 'S') return 0;
      if (upper.includes('终点') || upper.includes('FINISH') || upper === 'F') return 99999;
      
      // ✨ 允许捕获 CP 和 DP(换装点) 的序号
      const match = upper.match(/(?:CP|DP|换装)\s*(\d+)/);
      if (match) return parseInt(match[1]);
      
      const match2 = upper.match(/(?:第)?\s*(\d+)\s*(?:号|个)?(?:CP|DP|换装|打卡点|站点)/);
      if (match2) return parseInt(match2[1]);
      
      return -1; // 其他乱七八糟的名字一律不排入主干
    }

    while ((wptMatch = wptRegex.exec(xml)) !== null) {
      const lat = parseFloat(wptMatch[1]), lon = parseFloat(wptMatch[2]);
      const inner = wptMatch[3];
      const nameMatch = inner.match(/<name>([\s\S]*?)<\/name>/i);
      const eleMatch = inner.match(/<ele>([\d.-]+)<\/ele>/i);
      
      const name = nameMatch ? nameMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : "未知点";
      const wptEle = eleMatch ? parseFloat(eleMatch[1]) : null;
      
      cpsRaw.push({ name, lat, lon, wptEle, order: getLogicalOrder(name) });
    }

    // 过滤掉所有被黑名单干掉的非官方点
    let seqWpts = cpsRaw.filter(cp => cp.order !== -1);
    seqWpts.sort((a, b) => a.order - b.order);

    let cps = [];
    let lastTrackIdx = 0;

    // 滑窗对齐
    for (let i = 0; i < seqWpts.length; i++) {
      const cp = seqWpts[i];
      let minDist = Infinity;
      let targetIdx = lastTrackIdx;
      let startIndex = Math.max(0, lastTrackIdx - 500);

      if (i > 0) {
        const prevCp = seqWpts[i - 1];
        if (haversineMeters(cp.lat, cp.lon, prevCp.lat, prevCp.lon) < 200) { 
          let leaveIdx = lastTrackIdx;
          while (leaveIdx < trkpts.length) {
            if (haversineMeters(trkpts[leaveIdx].lat, trkpts[leaveIdx].lon, prevCp.lat, prevCp.lon) > 300) break;
            leaveIdx++;
          }
          startIndex = leaveIdx; 
        }
      }

      for (let j = startIndex; j < trkpts.length; j++) {
        const d = haversineMeters(cp.lat, cp.lon, trkpts[j].lat, trkpts[j].lon);
        if (d < minDist) { minDist = d; targetIdx = j; } 
        else if (minDist < 200 && d > minDist + 20) break;
      }

      if (minDist > 1000) {
        minDist = Infinity;
        for (let j = 0; j < trkpts.length; j++) {
          const d = haversineMeters(cp.lat, cp.lon, trkpts[j].lat, trkpts[j].lon);
          if (d < minDist) { minDist = d; targetIdx = j; }
        }
      }

      lastTrackIdx = targetIdx; 

      const matched = trkpts[targetIdx] || { accDist: 0, accGain: 0, accLoss: 0 };
      cps.push({
        name: cp.name,
        accDist: parseFloat(matched.accDist.toFixed(2)),
        accGain: Math.round(matched.accGain),
        accLoss: Math.round(matched.accLoss),
        tempEle: cp.wptEle,
        rest: 5, cutoffH: 0, cutoffM: 0
      });
    }

    if (cps.length > 1 && cps[cps.length - 1].accGain === 0) {
      let mGain = 0, mLoss = 0;
      for (let i = 1; i < cps.length; i++) {
        const d = (cps[i].tempEle || 0) - (cps[i-1].tempEle || 0);
        if (d > 0) mGain += d; else mLoss += Math.abs(d);
        cps[i].accGain = Math.round(mGain);
        cps[i].accLoss = Math.round(mLoss);
      }
    }

    const finalDist = cps.length > 0 ? cps[cps.length - 1].accDist : (totalDistM/1000).toFixed(2);
    const finalGain = cps.length > 0 ? cps[cps.length - 1].accGain : Math.round(totalGain);

    return {
      success: true,
      draft: {
        name: fileName.replace('.gpx', ''),
        checkpoints: cps
      }
    };
  } catch (error) { return { success: false, error: error.message }; }
}