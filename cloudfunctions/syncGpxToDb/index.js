const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

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
  const { raceDocId, groupIndex, fileID } = event;
  if (!raceDocId || groupIndex === undefined || !fileID) return { success: false, msg: "缺少核心参数" };

  try {
    const res = await cloud.downloadFile({ fileID: fileID });
    const xml = res.fileContent.toString('utf-8');

    const trkpts = [];
    const trkptRegex = /<trkpt lat="([\d.-]+)" lon="([\d.-]+)">([\s\S]*?)<\/trkpt>/g;
    
    let totalDistM = 0, totalGain = 0, totalLoss = 0, altAccGain = 0, altAccLoss = 0, anchorPt = null;
    let match;

    while ((match = trkptRegex.exec(xml)) !== null) {
      const lat = parseFloat(match[1]), lon = parseFloat(match[2]);
      const eleMatch = match[3].match(/<ele>([\d.-]+)<\/ele>/i);
      const ele = eleMatch ? parseFloat(eleMatch[1]) : null;

      if (trkpts.length > 0) {
        const prev = trkpts[trkpts.length - 1];
        if (!anchorPt) anchorPt = prev;
        const dist2D = haversineMeters(anchorPt.lat, anchorPt.lon, lat, lon);
        if (dist2D >= 2.0) {
          let diff = (ele !== null && anchorPt.ele !== null) ? (ele - anchorPt.ele) : 0;
          if (dist2D > 0 && Math.abs(diff) / dist2D > 0.5) diff = dist2D * 0.5 * Math.sign(diff);
          totalDistM += Math.sqrt(Math.pow(dist2D, 2) + Math.pow(diff, 2)); 
          anchorPt = { lat, lon, ele }; 
        }
        if (ele !== null && prev.ele !== null) {
          const diffAlt = ele - prev.ele;
          if (diffAlt > 0) {
            altAccGain += diffAlt;
            if (altAccGain >= 3.0) { totalGain += altAccGain; altAccGain = 0; }
            altAccLoss = 0;
          } else if (diffAlt < 0) {
            altAccLoss += Math.abs(diffAlt);
            if (altAccLoss >= 3.0) { totalLoss += altAccLoss; altAccLoss = 0; }
            altAccGain = 0;
          }
        }
      }
      trkpts.push({ lat, lon, ele, accDist: totalDistM / 1000, accGain: totalGain, accLoss: totalLoss });
    }

    let elevationsAll = trkpts.map(p => p.ele).filter(e => e !== null);
    let globalMinE = elevationsAll.length > 0 ? Math.min(...elevationsAll) : 0;
    let globalMaxE = elevationsAll.length > 0 ? Math.max(...elevationsAll) : 100;
    let globalRange = globalMaxE - globalMinE || 1;

    let cpsRaw = [];
    const wptRegex = /<wpt lat="([\d.-]+)" lon="([\d.-]+)">([\s\S]*?)<\/wpt>/g;
    let wptMatch;
    
    function getLogicalOrder(name) {
      const upper = name.toUpperCase();
      if (['水站', '补水', '医疗', '危险'].some(w => upper.includes(w))) return -1;
      if (upper.includes('起点') || upper.includes('START')) return 0;
      if (upper.includes('终点') || upper.includes('FINISH')) return 99999;
      const m1 = upper.match(/(?:CP|DP|换装)\s*(\d+)/);
      if (m1) return parseInt(m1[1]);
      const m2 = upper.match(/(?:第)?\s*(\d+)\s*(?:号|个)?(?:CP|DP|换装|站点)/);
      return m2 ? parseInt(m2[1]) : -1;
    }

    while ((wptMatch = wptRegex.exec(xml)) !== null) {
      const nameMatch = wptMatch[3].match(/<name>([\s\S]*?)<\/name>/i);
      const eleMatch = wptMatch[3].match(/<ele>([\d.-]+)<\/ele>/i);
      cpsRaw.push({
        name: nameMatch ? nameMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : "未知点",
        lat: parseFloat(wptMatch[1]), lon: parseFloat(wptMatch[2]),
        wptEle: eleMatch ? parseFloat(eleMatch[1]) : null,
        order: getLogicalOrder(nameMatch ? nameMatch[1] : "")
      });
    }

    let seqWpts = cpsRaw.filter(cp => cp.order !== -1).sort((a, b) => a.order - b.order);
    let cps = [], lastTrackIdx = 0;

    for (let i = 0; i < seqWpts.length; i++) {
      const cp = seqWpts[i];
      let minDist = Infinity, targetIdx = lastTrackIdx;
      let startIndex = Math.max(0, lastTrackIdx - 500);

      if (i > 0 && haversineMeters(cp.lat, cp.lon, seqWpts[i - 1].lat, seqWpts[i - 1].lon) < 200) { 
        let leaveIdx = lastTrackIdx;
        while (leaveIdx < trkpts.length && haversineMeters(trkpts[leaveIdx].lat, trkpts[leaveIdx].lon, seqWpts[i - 1].lat, seqWpts[i - 1].lon) <= 300) leaveIdx++;
        startIndex = leaveIdx; 
      }

      for (let j = startIndex; j < trkpts.length; j++) {
        const d = haversineMeters(cp.lat, cp.lon, trkpts[j].lat, trkpts[j].lon);
        if (d < minDist) { minDist = d; targetIdx = j; } 
        else if (minDist < 200 && d > minDist + 20) break;
      }
      
      // ==========================================
      // ✨ 双擎驱动：同时生成 Canvas 数据和 SVG 图片
      // ==========================================
      let rawPoints = []; 
      let svgData = "";
      
      if (i > 0 && targetIdx > lastTrackIdx) {
        let segmentPts = trkpts.slice(lastTrackIdx, targetIdx + 1);
        
        let step = Math.max(1, Math.floor(segmentPts.length / 120));
        for (let k = 0; k < segmentPts.length; k += step) {
          const pt = segmentPts[k];
          if (pt.ele !== null) {
            rawPoints.push({ d: parseFloat(pt.accDist.toFixed(2)), e: Math.round(pt.ele) });
          }
        }
        const lastPt = segmentPts[segmentPts.length - 1];
        if (lastPt.ele !== null && rawPoints[rawPoints.length - 1].d !== parseFloat(lastPt.accDist.toFixed(2))) {
           rawPoints.push({ d: parseFloat(lastPt.accDist.toFixed(2)), e: Math.round(lastPt.ele) });
        }

        let elevations = segmentPts.map(p => p.ele).filter(e => e !== null);
        if (elevations.length > 1) {
          let svgStep = Math.max(1, Math.floor(elevations.length / 30));
          let sampled = elevations.filter((_, idx) => idx % svgStep === 0);
          if (sampled[sampled.length - 1] !== elevations[elevations.length - 1]) sampled.push(elevations[elevations.length - 1]);

          let pointsStr = sampled.map((e, idx) => {
            let x = (idx / (sampled.length - 1)) * 100;
            let y = 40 - ((e - globalMinE) / globalRange) * 40; 
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          }).join(' L');

          let linePath = `M${pointsStr}`; 
          let fillPath = `M${pointsStr} L100,40 L0,40 Z`; 

          let rawSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" preserveAspectRatio="none">
                          <defs>
                            <linearGradient id="elevationGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                              <stop offset="0%" stop-color="#FF9849" stop-opacity="0.4" />
                              <stop offset="100%" stop-color="#FF9849" stop-opacity="0.05" />
                            </linearGradient>
                          </defs>
                          <path d="${fillPath}" fill="url(#elevationGradient)" stroke="none" />
                          <path d="${linePath}" fill="none" stroke="#FF9849" stroke-width="1.5" />
                        </svg>`;
          let base64Svg = Buffer.from(rawSvg).toString('base64');
          svgData = "data:image/svg+xml;base64," + base64Svg;
        }
      }

      lastTrackIdx = targetIdx; 
      const matched = trkpts[targetIdx] || { accDist: 0, accGain: 0, accLoss: 0 };
      
      // ✨ 核心逻辑：从名字中提取关门时间，并还原纯净名字
      let rawName = cp.name || '';
      let extractedCutoff = "";
      // 匹配末尾形如 "-16:00" 或 "-9:30" 的格式
      let timeMatch = rawName.match(/-(\d{1,2}:\d{2})$/);
      if (timeMatch) {
        extractedCutoff = timeMatch[1];
        rawName = rawName.replace(/-(\d{1,2}:\d{2})$/, ''); // 剔除时间部分
      }

      const originalNameUpper = rawName.toUpperCase();
      const isDropBag = originalNameUpper.includes('DP') || originalNameUpper.includes('换装');
      let defaultRest = (i === 0 || i === seqWpts.length - 1) ? 0 : (isDropBag ? 30 : 5);

      cps.push({
        name: rawName, // 存入纯净版名字 (比如: CP1-大热换倒)
        accDist: parseFloat(matched.accDist.toFixed(2)),
        accGain: Math.round(matched.accGain),
        accLoss: Math.round(matched.accLoss),
        tempEle: cp.wptEle,
        svgProfile: svgData,    
        rawPoints: rawPoints,   
        isDropBag: isDropBag,
        rest: defaultRest,   
        cutoffTime: extractedCutoff // ✨ 将提取到的关门时间存入数据库
      });
    }

    if (cps.length > 1 && cps[cps.length - 1].accGain === 0) {
      let mGain = 0, mLoss = 0;
      for (let i = 1; i < cps.length; i++) {
        const d = (cps[i].tempEle || 0) - (cps[i-1].tempEle || 0);
        if (d > 0) mGain += d; else mLoss += Math.abs(d);
        cps[i].accGain = Math.round(mGain); cps[i].accLoss = Math.round(mLoss);
      }
    }

    for (let i = 0; i < cps.length; i++) {
      if (i === 0) {
        cps[i].segDist = 0;
        cps[i].segGain = 0;
        cps[i].segLoss = 0;
      } else {
        cps[i].segDist = parseFloat((cps[i].accDist - cps[i-1].accDist).toFixed(2));
        cps[i].segGain = Math.max(0, cps[i].accGain - cps[i-1].accGain);
        cps[i].segLoss = Math.max(0, cps[i].accLoss - cps[i-1].accLoss);
      }
    }

    const finalActualDist = (totalDistM / 1000).toFixed(1) + 'km';
    const finalElevation = `${Math.round(totalGain)}m+ / ${Math.round(totalLoss)}m-`;

    const updatePathCps = `groups.${groupIndex}.checkpoints`;
    const updatePathDist = `groups.${groupIndex}.actualDist`;
    const updatePathEle = `groups.${groupIndex}.elevation`;

    await db.collection('races').doc(raceDocId).update({ 
      data: { 
        [updatePathCps]: cps,
        [updatePathDist]: finalActualDist,
        [updatePathEle]: finalElevation
      } 
    });

    return { success: true, msg: `✅ 解析完成，距离 ${finalActualDist}，爬降 ${finalElevation}` };
  } catch (error) { return { success: false, error: error.message }; }
}