const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const ALT_THRESHOLD = 3.0;
const DIST_THRESHOLD = 2.0;
const MAX_GRADIENT = 0.5;

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function extractNumericTagValue(xmlChunk = '', tagName = 'ele') {
  const regex = new RegExp(`<${tagName}[^>]*>\\s*([+-]?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)\\s*<\\/${tagName}>`, 'i');
  const match = String(xmlChunk || '').match(regex);
  return match ? parseFloat(match[1]) : null;
}

function extractAttrNumber(attrChunk = '', attrName = 'lat') {
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*(['"])([^'"]+)\\1`, 'i');
  const match = String(attrChunk || '').match(regex);
  return match ? parseFloat(match[2]) : NaN;
}

function decodeXmlText(text = '') {
  return String(text || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&amp;/g, '&')
    .trim();
}

function parseCoordinateToken(token = '') {
  const parts = String(token || '').trim().split(',');
  if (parts.length < 2) return null;

  const lon = parseFloat(parts[0]);
  const lat = parseFloat(parts[1]);
  const ele = parts.length >= 3 ? parseFloat(parts[2]) : null;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    ele: Number.isFinite(ele) ? ele : null
  };
}

function parseCoordinateBlock(coordData = '') {
  return String(coordData || '')
    .trim()
    .split(/\s+/)
    .map(parseCoordinateToken)
    .filter(Boolean);
}

function parseGxCoordToken(token = '') {
  const parts = String(token || '').trim().split(/\s+/);
  if (parts.length < 2) return null;

  const lon = parseFloat(parts[0]);
  const lat = parseFloat(parts[1]);
  const ele = parts.length >= 3 ? parseFloat(parts[2]) : null;

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    ele: Number.isFinite(ele) ? ele : null
  };
}

function estimateTrackLength(points = []) {
  if (!Array.isArray(points) || points.length < 2) return 0;

  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += haversineMeters(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon);
  }
  return length;
}

function pickBestSegment(segments = []) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  let best = [];
  let bestScore = -1;

  segments.forEach((segment) => {
    const score = estimateTrackLength(segment) + (segment.length * 0.1);
    if (score > bestScore) {
      bestScore = score;
      best = segment;
    }
  });

  return best;
}

function detectTrackFormat(xml = '') {
  const text = String(xml || '');
  if (/<trkpt\b/i.test(text) || /<gpx\b/i.test(text)) return 'gpx';
  if (/<gx:Track\b/i.test(text) || /<LineString\b/i.test(text) || /<kml\b/i.test(text)) return 'kml';
  return 'unknown';
}

function extractTrackPoints(xml = '', format = 'unknown') {
  if (format === 'gpx') {
    const points = [];
    const trkptRegex = /<trkpt\b([^>]*?)(?:>([\s\S]*?)<\/trkpt>|\s*\/>)/gi;
    let match;

    while ((match = trkptRegex.exec(xml)) !== null) {
      const attrChunk = match[1] || '';
      const inner = match[2] || '';
      const lat = extractAttrNumber(attrChunk, 'lat');
      const lon = extractAttrNumber(attrChunk, 'lon');
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;

      points.push({
        lat,
        lon,
        ele: extractNumericTagValue(inner, 'ele')
      });
    }

    return points;
  }

  const gxSegments = [];
  const gxTrackRegex = /<gx:Track\b[\s\S]*?<\/gx:Track>/gi;
  let gxTrackMatch;

  while ((gxTrackMatch = gxTrackRegex.exec(xml)) !== null) {
    const segment = [];
    const gxCoordRegex = /<gx:coord>\s*([^<]+?)\s*<\/gx:coord>/gi;
    let gxCoordMatch;

    while ((gxCoordMatch = gxCoordRegex.exec(gxTrackMatch[0])) !== null) {
      const point = parseGxCoordToken(gxCoordMatch[1]);
      if (point) segment.push(point);
    }

    if (segment.length > 1) gxSegments.push(segment);
  }

  if (gxSegments.length > 0) {
    return pickBestSegment(gxSegments);
  }

  const lineSegments = [];
  const lineRegex = /<LineString\b[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>[\s\S]*?<\/LineString>/gi;
  let lineMatch;

  while ((lineMatch = lineRegex.exec(xml)) !== null) {
    const points = parseCoordinateBlock(lineMatch[1]);
    if (points.length > 1) lineSegments.push(points);
  }

  return pickBestSegment(lineSegments);
}

function getLogicalOrder(name = '') {
  const upper = String(name || '').toUpperCase();
  if (['水站', '补水', '医疗', '危险'].some(word => upper.includes(word))) return -1;
  if (upper.includes('起点') || upper.includes('START')) return 0;
  if (upper.includes('终点') || upper.includes('FINISH')) return 99999;

  const match1 = upper.match(/(?:CP|DP|换装)\s*(\d+)/);
  if (match1) return parseInt(match1[1], 10);

  const match2 = upper.match(/第\s*(\d+)\s*(?:个|号)?\s*(?:CP|DP|换装|站点)/);
  return match2 ? parseInt(match2[1], 10) : -1;
}

function extractWaypoints(xml = '', format = 'unknown') {
  const waypoints = [];

  if (format === 'gpx') {
    const wptRegex = /<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/gi;
    let match;

    while ((match = wptRegex.exec(xml)) !== null) {
      const lat = extractAttrNumber(match[1], 'lat');
      const lon = extractAttrNumber(match[1], 'lon');
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const inner = match[2] || '';
      const rawNameMatch = inner.match(/<name[^>]*>([\s\S]*?)<\/name>/i);
      const name = decodeXmlText(rawNameMatch ? rawNameMatch[1] : '未知点');

      waypoints.push({
        name,
        lat,
        lon,
        wptEle: extractNumericTagValue(inner, 'ele'),
        order: getLogicalOrder(name)
      });
    }

    return waypoints;
  }

  const placemarkRegex = /<Placemark\b[\s\S]*?<\/Placemark>/gi;
  let placemarkMatch;

  while ((placemarkMatch = placemarkRegex.exec(xml)) !== null) {
    const placemark = placemarkMatch[0];
    if (!/<Point\b/i.test(placemark)) continue;

    const nameMatch = placemark.match(/<name[^>]*>([\s\S]*?)<\/name>/i);
    const pointMatch = placemark.match(/<Point\b[\s\S]*?<coordinates[^>]*>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Point>/i);
    if (!pointMatch) continue;

    const point = parseCoordinateToken(pointMatch[1]);
    if (!point) continue;

    const name = decodeXmlText(nameMatch ? nameMatch[1] : '未知点');
    waypoints.push({
      name,
      lat: point.lat,
      lon: point.lon,
      wptEle: point.ele,
      order: getLogicalOrder(name)
    });
  }

  return waypoints;
}

function buildTrackStats(sourcePoints = []) {
  const trkpts = [];
  let totalDistM = 0;
  let totalGain = 0;
  let totalLoss = 0;
  let altAccGain = 0;
  let altAccLoss = 0;
  let anchorPt = null;
  let elevationSampleCount = 0;

  sourcePoints.forEach((point) => {
    const lat = Number(point.lat);
    const lon = Number(point.lon);
    const ele = Number.isFinite(Number(point.ele)) ? Number(point.ele) : null;

    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;
    if (ele !== null) elevationSampleCount += 1;

    if (trkpts.length > 0) {
      const prev = trkpts[trkpts.length - 1];
      if (!anchorPt) anchorPt = prev;

      const dist2D = haversineMeters(anchorPt.lat, anchorPt.lon, lat, lon);
      if (dist2D >= DIST_THRESHOLD) {
        let diff = (ele !== null && anchorPt.ele !== null) ? (ele - anchorPt.ele) : 0;
        if (dist2D > 0 && Math.abs(diff) / dist2D > MAX_GRADIENT) {
          diff = dist2D * MAX_GRADIENT * Math.sign(diff);
        }
        totalDistM += Math.sqrt((dist2D ** 2) + (diff ** 2));
        anchorPt = { lat, lon, ele };
      }

      if (ele !== null && prev.ele !== null) {
        const diffAlt = ele - prev.ele;
        if (diffAlt > 0) {
          altAccGain += diffAlt;
          if (altAccGain >= ALT_THRESHOLD) {
            totalGain += altAccGain;
            altAccGain = 0;
          }
          altAccLoss = 0;
        } else if (diffAlt < 0) {
          altAccLoss += Math.abs(diffAlt);
          if (altAccLoss >= ALT_THRESHOLD) {
            totalLoss += altAccLoss;
            altAccLoss = 0;
          }
          altAccGain = 0;
        }
      }
    }

    trkpts.push({
      lat,
      lon,
      ele,
      accDist: totalDistM / 1000,
      accGain: totalGain,
      accLoss: totalLoss
    });
  });

  return {
    trkpts,
    totalDistM,
    totalGain,
    totalLoss,
    hasElevationData: elevationSampleCount >= 2
  };
}

function buildSvgProfile(segmentPts) {
  if (!Array.isArray(segmentPts) || segmentPts.length === 0) return '';

  const elevations = segmentPts.map(point => point.ele).filter(ele => ele !== null);
  if (elevations.length <= 1) return '';

  const localMinE = Math.min(...elevations);
  const localMaxE = Math.max(...elevations);
  const localRange = Math.max(1, localMaxE - localMinE);

  const svgStep = Math.max(1, Math.floor(elevations.length / 30));
  const sampled = elevations.filter((_, idx) => idx % svgStep === 0);
  if (sampled[sampled.length - 1] !== elevations[elevations.length - 1]) {
    sampled.push(elevations[elevations.length - 1]);
  }

  const pointsStr = sampled.map((ele, idx) => {
    const x = sampled.length <= 1 ? 0 : (idx / (sampled.length - 1)) * 100;
    const y = 40 - ((ele - localMinE) / localRange) * 40;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' L');

  const linePath = `M${pointsStr}`;
  const fillPath = `M${pointsStr} L100,40 L0,40 Z`;
  const rawSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="elevationGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stop-color="#FF9849" stop-opacity="0.4" />
                        <stop offset="100%" stop-color="#FF9849" stop-opacity="0.05" />
                      </linearGradient>
                    </defs>
                    <path d="${fillPath}" fill="url(#elevationGradient)" stroke="none" />
                    <path d="${linePath}" fill="none" stroke="#FF9849" stroke-width="1.5" />
                  </svg>`;

  return 'data:image/svg+xml;base64,' + Buffer.from(rawSvg).toString('base64');
}

function buildRawPoints(segmentPts, manualStartDist, manualEndDist) {
  if (!Array.isArray(segmentPts) || segmentPts.length === 0) return [];

  const step = Math.max(1, Math.floor(segmentPts.length / 120));
  const startTrackDist = segmentPts[0].accDist || 0;
  const endTrackDist = segmentPts[segmentPts.length - 1].accDist || startTrackDist;
  const trackRange = endTrackDist - startTrackDist;
  const manualRange = (manualEndDist || 0) - (manualStartDist || 0);
  const rawPoints = [];

  for (let i = 0; i < segmentPts.length; i += step) {
    const point = segmentPts[i];
    if (point.ele === null) continue;

    const progress = trackRange > 0 ? ((point.accDist || 0) - startTrackDist) / trackRange : 0;
    const mappedDist = manualStartDist + (manualRange * progress);
    rawPoints.push({
      d: parseFloat(mappedDist.toFixed(2)),
      e: Math.round(point.ele)
    });
  }

  const lastPoint = segmentPts[segmentPts.length - 1];
  if (lastPoint && lastPoint.ele !== null) {
    const finalDist = parseFloat((manualEndDist || 0).toFixed(2));
    if (!rawPoints.length || rawPoints[rawPoints.length - 1].d !== finalDist) {
      rawPoints.push({ d: finalDist, e: Math.round(lastPoint.ele) });
    }
  }

  return rawPoints;
}

function findNearestTrackIndexByDistance(trkpts, targetDist, startIndex = 0) {
  if (!Array.isArray(trkpts) || trkpts.length === 0) return 0;

  let bestIndex = Math.min(startIndex, trkpts.length - 1);
  let bestDiff = Infinity;

  for (let i = Math.max(0, startIndex); i < trkpts.length; i++) {
    const diff = Math.abs((trkpts[i].accDist || 0) - targetDist);
    if (diff <= bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    } else if ((trkpts[i].accDist || 0) > targetDist && diff > bestDiff) {
      break;
    }
  }

  return bestIndex;
}

function getSegmentPoints(trkpts, startIndex, endIndex) {
  if (!Array.isArray(trkpts) || trkpts.length === 0) return [];

  let safeStart = Math.max(0, Math.min(startIndex, trkpts.length - 1));
  let safeEnd = Math.max(0, Math.min(endIndex, trkpts.length - 1));

  if (safeEnd < safeStart) {
    safeEnd = safeStart;
  }

  if (safeEnd === safeStart && safeEnd < trkpts.length - 1) {
    safeEnd += 1;
  } else if (safeEnd === safeStart && safeStart > 0) {
    safeStart -= 1;
  }

  return trkpts.slice(safeStart, safeEnd + 1);
}

function buildCheckpointsFromManual(trkpts, manualCheckpoints) {
  if (!Array.isArray(manualCheckpoints) || manualCheckpoints.length === 0) return [];

  const actualTotalDist = trkpts.length > 0 ? (trkpts[trkpts.length - 1].accDist || 0) : 0;
  const manualTotalDist = manualCheckpoints[manualCheckpoints.length - 1].accDist || 0;
  let lastTrackIdx = 0;

  return manualCheckpoints.map((manualCp, index, arr) => {
    let targetTrackIdx = 0;

    if (index === 0) {
      targetTrackIdx = 0;
    } else if (index === arr.length - 1) {
      targetTrackIdx = Math.max(0, trkpts.length - 1);
    } else {
      const targetTrackDist = manualTotalDist > 0
        ? (manualCp.accDist / manualTotalDist) * actualTotalDist
        : manualCp.accDist;
      targetTrackIdx = findNearestTrackIndexByDistance(trkpts, targetTrackDist, lastTrackIdx);
    }

    const segmentPts = index > 0
      ? getSegmentPoints(trkpts, lastTrackIdx, targetTrackIdx)
      : [];

    const previousManualDist = index > 0 ? (arr[index - 1].accDist || 0) : 0;
    const matched = trkpts[targetTrackIdx] || { accGain: 0, accLoss: 0, ele: null };

    const checkpoint = {
      name: `${manualCp.cpNum}-${manualCp.locName}`,
      cpNum: manualCp.cpNum,
      locName: manualCp.locName,
      accDist: parseFloat(Number(manualCp.accDist || 0).toFixed(2)),
      accGain: Math.round(matched.accGain || 0),
      accLoss: Math.round(matched.accLoss || 0),
      tempEle: matched.ele !== null ? matched.ele : null,
      svgProfile: buildSvgProfile(segmentPts),
      rawPoints: buildRawPoints(segmentPts, previousManualDist, manualCp.accDist || 0),
      isDropBag: manualCp.isDropBag === true,
      rest: index === 0 || index === arr.length - 1 ? 0 : (manualCp.isDropBag ? 30 : 5),
      cutoffDurationText: manualCp.cutoffDurationText || '',
      cutoffTime: manualCp.cutoffTime || '',
      cutoffDateText: manualCp.cutoffDateText || '',
      absoluteCutoffMinsPreset: Number.isFinite(manualCp.absoluteCutoffMinsPreset)
        ? manualCp.absoluteCutoffMinsPreset
        : null
    };

    lastTrackIdx = targetTrackIdx;
    return checkpoint;
  });
}

function buildCheckpointsFromWaypoints(waypoints, trkpts) {
  if (!Array.isArray(waypoints) || waypoints.length === 0) return [];

  const seqWpts = waypoints.filter(cp => cp.order !== -1).sort((a, b) => a.order - b.order);
  const cps = [];
  let lastTrackIdx = 0;

  for (let i = 0; i < seqWpts.length; i++) {
    const cp = seqWpts[i];
    let minDist = Infinity;
    let targetIdx = lastTrackIdx;
    let startIndex = Math.max(0, lastTrackIdx - 500);

    if (i > 0 && haversineMeters(cp.lat, cp.lon, seqWpts[i - 1].lat, seqWpts[i - 1].lon) < 200) {
      let leaveIdx = lastTrackIdx;
      while (leaveIdx < trkpts.length &&
        haversineMeters(trkpts[leaveIdx].lat, trkpts[leaveIdx].lon, seqWpts[i - 1].lat, seqWpts[i - 1].lon) <= 300) {
        leaveIdx++;
      }
      startIndex = leaveIdx;
    }

    for (let j = startIndex; j < trkpts.length; j++) {
      const dist = haversineMeters(cp.lat, cp.lon, trkpts[j].lat, trkpts[j].lon);
      if (dist < minDist) {
        minDist = dist;
        targetIdx = j;
      } else if (minDist < 200 && dist > minDist + 20) {
        break;
      }
    }

    const segmentPts = i > 0 && targetIdx > lastTrackIdx ? trkpts.slice(lastTrackIdx, targetIdx + 1) : [];
    const matched = trkpts[targetIdx] || { accDist: 0, accGain: 0, accLoss: 0 };

    let rawName = cp.name || '';
    let extractedCutoff = '';
    const timeMatch = rawName.match(/-(\d{1,2}:\d{2})$/);
    if (timeMatch) {
      extractedCutoff = timeMatch[1];
      rawName = rawName.replace(/-(\d{1,2}:\d{2})$/, '');
    }

    const upper = rawName.toUpperCase();
    const isDropBag = upper.includes('DP') || upper.includes('换装');

    cps.push({
      name: rawName,
      accDist: parseFloat((matched.accDist || 0).toFixed(2)),
      accGain: Math.round(matched.accGain || 0),
      accLoss: Math.round(matched.accLoss || 0),
      tempEle: cp.wptEle,
      svgProfile: buildSvgProfile(segmentPts),
      rawPoints: buildRawPoints(segmentPts, i > 0 ? cps[i - 1].accDist : 0, matched.accDist || 0),
      isDropBag,
      rest: i === 0 || i === seqWpts.length - 1 ? 0 : (isDropBag ? 30 : 5),
      cutoffTime: extractedCutoff
    });

    lastTrackIdx = targetIdx;
  }

  return cps;
}

exports.main = async (event) => {
  const { raceDocId, groupIndex, fileID, manualCheckpoints, fallbackElevation } = event;
  if (!raceDocId || groupIndex === undefined || !fileID) {
    return { success: false, msg: '缺少核心参数' };
  }

  try {
    const res = await cloud.downloadFile({ fileID });
    const xml = res.fileContent.toString('utf-8');
    const format = detectTrackFormat(xml);
    const trackSourcePoints = extractTrackPoints(xml, format);
    const { trkpts, totalDistM, totalGain, totalLoss, hasElevationData } = buildTrackStats(trackSourcePoints);

    if (trkpts.length < 2) {
      throw new Error('轨迹文件未识别到有效轨迹点，请确认上传的是标准 GPX 或 KML 轨迹文件');
    }

    const waypoints = extractWaypoints(xml, format);
    let cps = [];

    if (Array.isArray(manualCheckpoints) && manualCheckpoints.length > 0) {
      cps = buildCheckpointsFromManual(trkpts, manualCheckpoints);
    } else {
      cps = buildCheckpointsFromWaypoints(waypoints, trkpts);
    }

    if (cps.length > 1 && cps[cps.length - 1].accGain === 0) {
      let mockGain = 0;
      let mockLoss = 0;
      for (let i = 1; i < cps.length; i++) {
        const diff = (cps[i].tempEle || 0) - (cps[i - 1].tempEle || 0);
        if (diff > 0) mockGain += diff;
        else mockLoss += Math.abs(diff);
        cps[i].accGain = Math.round(mockGain);
        cps[i].accLoss = Math.round(mockLoss);
      }
    }

    for (let i = 0; i < cps.length; i++) {
      if (i === 0) {
        cps[i].segDist = 0;
        cps[i].segGain = 0;
        cps[i].segLoss = 0;
      } else {
        cps[i].segDist = parseFloat((cps[i].accDist - cps[i - 1].accDist).toFixed(2));
        cps[i].segGain = Math.max(0, cps[i].accGain - cps[i - 1].accGain);
        cps[i].segLoss = Math.max(0, cps[i].accLoss - cps[i - 1].accLoss);
      }
    }

    const finalActualDist = `${(totalDistM / 1000).toFixed(1)}km`;
    const finalElevation = hasElevationData
      ? `${Math.round(totalGain)}m+ / ${Math.round(totalLoss)}m-`
      : (String(fallbackElevation || '').trim() || `${Math.round(totalGain)}m+ / ${Math.round(totalLoss)}m-`);

    await db.collection('races').doc(raceDocId).update({
      data: {
        [`groups.${groupIndex}.checkpoints`]: cps,
        [`groups.${groupIndex}.actualDist`]: finalActualDist,
        [`groups.${groupIndex}.elevation`]: finalElevation,
        [`groups.${groupIndex}.hasGpxTrack`]: true,
        [`groups.${groupIndex}.dataSource`]: 'trackFile'
      }
    });

    return {
      success: true,
      msg: `解析完成，距离 ${finalActualDist}，爬升 ${finalElevation}`
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
