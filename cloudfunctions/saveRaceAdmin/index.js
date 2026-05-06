const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

function cleanRaceData(raw = {}) {
  return {
    name: String(raw.name || '').trim(),
    location: raw.location || '',
    date: String(raw.date || '').trim(),
    hasItra: Boolean(raw.hasItra),
    coverImg: raw.coverImg || '',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    groups: Array.isArray(raw.groups) ? raw.groups : []
  };
}

async function loadRaceDataFromEvent(event = {}) {
  if (!event.payloadFileID) {
    return cleanRaceData(event.raceData || {});
  }

  const res = await cloud.downloadFile({ fileID: event.payloadFileID });
  const jsonText = res.fileContent.toString('utf8');

  try {
    await cloud.deleteFile({ fileList: [event.payloadFileID] });
  } catch (err) {
    console.warn('清理临时赛事数据失败', err);
  }

  return cleanRaceData(JSON.parse(jsonText));
}

exports.main = async (event) => {
  const mode = event.mode === 'edit' ? 'edit' : 'create';
  const raceId = String(event.raceId || '').trim();

  try {
    const raceData = await loadRaceDataFromEvent(event);

    if (!raceData.name || !raceData.date) {
      return { success: false, error: '至少填写比赛名称和日期' };
    }

    if (!raceData.coverImg) {
      return { success: false, error: '请先上传赛事主封面' };
    }

    if (!raceData.groups.length) {
      return { success: false, error: '请至少填写一个组别' };
    }

    const data = {
      ...raceData,
      updateTime: db.serverDate()
    };

    if (mode === 'edit') {
      if (!raceId) {
        return { success: false, error: '缺少赛事 ID' };
      }

      await db.collection('races').doc(raceId).update({ data });
      return { success: true, raceId };
    }

    data.createTime = db.serverDate();
    const res = await db.collection('races').add({ data });
    return { success: true, raceId: res._id };
  } catch (error) {
    return { success: false, error: error.message || '赛事保存失败' };
  }
};
