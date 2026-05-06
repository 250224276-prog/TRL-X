const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

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

function stripTrackExtension(fileName = '') {
  return String(fileName || '').replace(/\.(gpx|kml)$/i, '');
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
  const blacklist = [
    '水站', '补水', 'WP', 'SP',
    '医疗', '救援', '急救', '厕所', 'WC', 'TOILET',
    '岔路', '路口', '左转', '右转', '危险', '注意',
    '摄影', '拍照', '风景', '观景',
    '临时', '测试', '备用', '打卡墙'
  ];

  if (blacklist.some(word => upper.includes(word))) return -1;
  if (upper.includes('起点') || upper.includes('START') || upper === 'S') return 0;
  if (upper.includes('终点') || upper.includes('FINISH') || upper === 'F') return 99999;

  const match1 = upper.match(/(?:CP|DP|换装)\s*(\d+)/);
  if (match1) return parseInt(match1[1], 10);

  const match2 = upper.match(/第\s*(\d+)\s*(?:个|号)?\s*(?:CP|DP|换装|打卡点|站点)/);
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

exports.main = async (event) => {
  const { fileID, fileName } = event;
  if (!fileID) {
    return { success: false, msg: '缺少核心参数' };
  }

  try {
    const res = await cloud.downloadFile({ fileID });
    const xml = res.fileContent.toString('utf-8');
    const format = detectTrackFormat(xml);
    const trackSourcePoints = extractTrackPoints(xml, format);
    const { trkpts, totalDistM, totalGain, totalLoss } = buildTrackStats(trackSourcePoints);

    if (trkpts.length < 2) {
      throw new Error('轨迹文件未识别到有效轨迹点，请确认上传的是标准 GPX 或 KML 轨迹文件');
    }

    const cpsRaw = extractWaypoints(xml, format);
    const seqWpts = cpsRaw.filter(cp => cp.order !== -1).sort((a, b) => a.order - b.order);
    const cps = [];
    let lastTrackIdx = 0;

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
        const dist = haversineMeters(cp.lat, cp.lon, trkpts[j].lat, trkpts[j].lon);
        if (dist < minDist) {
          minDist = dist;
          targetIdx = j;
        } else if (minDist < 200 && dist > minDist + 20) {
          break;
        }
      }

      if (minDist > 1000) {
        minDist = Infinity;
        for (let j = 0; j < trkpts.length; j++) {
          const dist = haversineMeters(cp.lat, cp.lon, trkpts[j].lat, trkpts[j].lon);
          if (dist < minDist) {
            minDist = dist;
            targetIdx = j;
          }
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
        rest: 5,
        cutoffH: 0,
        cutoffM: 0
      });
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

    return {
      success: true,
      draft: {
        name: stripTrackExtension(fileName || `${format || 'track'}-route`),
        checkpoints: cps,
        actualDistKm: parseFloat((totalDistM / 1000).toFixed(2)),
        totalGain: Math.round(totalGain),
        totalLoss: Math.round(totalLoss)
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
