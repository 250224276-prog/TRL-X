const db = wx.cloud.database();

Page({
  data: {
    // ✨ 状态标识：新建还是编辑
    mode: 'create', 
    currentRaceId: null,

    // 赛事全局基础信息
    raceName: '',
    raceDate: '',
    location: '',
    hasItra: true,
    coverImgPath: '', 
    oldCoverFileId: '',

    colorList: ['#36E153', '#FF9811', '#209BFF', '#E53935', '#A220FF', '#FFFFFF'],
    colorNames: ['荧光绿', '品牌橙', '赛博蓝', '竞速红', '暗夜紫', '纯白'],

    groups: [
      {
        dist: '', cutoffTime: '', 
        themeColorIndex: 0, 
        startTime1: '07:00', startTime2: '', 
        detailMapPath: '', gpxFilePath: '', gpxFileName: '',
        oldMapFileId: '', oldGpxFileId: '' 
      }
    ]
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ mode: 'edit', currentRaceId: options.id });
      wx.setNavigationBarTitle({ title: '编辑赛事档案' });
      this.loadRaceData(options.id);
    }
  },

  async loadRaceData(raceId) {
    wx.showLoading({ title: '加载赛事数据...', mask: true });
    try {
      const res = await db.collection('races').doc(raceId).get();
      const race = res.data;

      let loadedGroups = race.groups.map(g => {
        let cIdx = this.data.colorList.indexOf(g.themeColor);
        if (cIdx === -1) cIdx = 0;
        return {
          dist: g.dist || '',
          cutoffTime: g.cutoffTime || '',
          themeColorIndex: cIdx,
          startTime1: g.startTime || '07:00',
          startTime2: g.startTime2 || '',
          detailMapPath: g.detailMapImg || '', 
          gpxFilePath: g.gpxFileID || '',      
          gpxFileName: g.gpxFileID ? '已上传历史GPX (点击可重传)' : '',
          oldMapFileId: g.detailMapImg || '',
          oldGpxFileId: g.gpxFileID || ''
        };
      });

      if (loadedGroups.length === 0) {
        loadedGroups = [{ dist: '', cutoffTime: '', themeColorIndex: 0, startTime1: '07:00', startTime2: '', detailMapPath: '', gpxFilePath: '', gpxFileName: '' }];
      }

      this.setData({
        raceName: race.name,
        raceDate: race.date,
        location: race.location,
        hasItra: race.hasItra,
        coverImgPath: race.coverImg, 
        oldCoverFileId: race.coverImg,
        groups: loadedGroups
      });
      wx.hideLoading();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: '数据读取失败', icon: 'none' });
    }
  },

  // ✨ 跳转到历史赛事库
  goToRaceList() {
    wx.navigateTo({ url: '/pages/admin-race-list/admin-race-list' });
  },

  onDateChange(e) { this.setData({ raceDate: e.detail.value }); },
  onItraChange(e) { this.setData({ hasItra: e.detail.value }); },
  chooseCoverImg() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'],
      success: res => this.setData({ coverImgPath: res.tempFiles[0].tempFilePath })
    });
  },

  addGroup() {
    const newGroups = this.data.groups;
    newGroups.push({
      dist: '', cutoffTime: '', 
      themeColorIndex: 0, startTime1: '07:00', startTime2: '',
      detailMapPath: '', gpxFilePath: '', gpxFileName: ''
    });
    this.setData({ groups: newGroups });
  },

  removeGroup(e) {
    const index = e.currentTarget.dataset.index;
    const newGroups = this.data.groups;
    if (newGroups.length === 1) return wx.showToast({ title: '至少保留一个组别', icon: 'none' });
    newGroups.splice(index, 1);
    this.setData({ groups: newGroups });
  },

  onGroupInput(e) {
    const { index, field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({ [`groups[${index}].${field}`]: value });
  },
  
  chooseGroupMap(e) {
    const index = e.currentTarget.dataset.index;
    wx.chooseMedia({
      count: 1, mediaType: ['image'],
      success: res => this.setData({ [`groups[${index}].detailMapPath`]: res.tempFiles[0].tempFilePath })
    });
  },

  chooseGroupGpx(e) {
    const index = e.currentTarget.dataset.index;
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['.gpx'],
      success: res => {
        this.setData({
          [`groups[${index}].gpxFilePath`]: res.tempFiles[0].path,
          [`groups[${index}].gpxFileName`]: res.tempFiles[0].name
        });
      }
    });
  },

  isTempFile(path) {
    return path && (path.startsWith('wxfile://') || path.startsWith('http://tmp') || path.startsWith('file://'));
  },

  uploadToCloud(localPath, folderName) {
    return new Promise((resolve, reject) => {
      if (!localPath) { resolve(''); return; }
      if (!this.isTempFile(localPath) && localPath.startsWith('cloud://')) {
        resolve(localPath); return; 
      }
      
      const extMatch = localPath.match(/\.[^.]+?$/);
      const ext = extMatch ? extMatch[0] : '.png'; 
      const cloudPath = `${folderName}/${Date.now()}-${Math.floor(Math.random()*1000)}${ext}`;
      
      wx.cloud.uploadFile({
        cloudPath: cloudPath, filePath: localPath,
        success: res => resolve(res.fileID),
        fail: err => reject(err)
      });
    });
  },

  async submitAndIgnite() {
    const { mode, currentRaceId, raceName, raceDate, location, hasItra, coverImgPath, groups, colorList } = this.data;

    if (!raceName || !raceDate) {
      return wx.showToast({ title: '至少填写比赛名称和日期', icon: 'none' });
    }

    wx.showLoading({ title: mode === 'edit' ? '更新赛事档案...' : '构建赛事档案...', mask: true });

    try {
      const coverFileID = await this.uploadToCloud(coverImgPath, 'race-covers');

      let dbGroups = [];
      let tags = [];
      let gpxIndexesToParse = []; 
      
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        
        if (g.dist) {
          wx.showLoading({ title: `处理 ${g.dist} 数据...`, mask: true });
          
          const mapFileID = await this.uploadToCloud(g.detailMapPath, 'race-maps');
          const gpxFileID = await this.uploadToCloud(g.gpxFilePath, 'gpx-tracks');
          const hexColor = colorList[g.themeColorIndex];

          tags.push({ dist: g.dist, color: hexColor });

          let needsParse = false;
          if (gpxFileID && (this.isTempFile(g.gpxFilePath) || !g.oldGpxFileId || gpxFileID !== g.oldGpxFileId)) {
            needsParse = true;
            gpxIndexesToParse.push(i);
          }

          dbGroups.push({
            dist: g.dist,
            actualDist: needsParse ? '排队解析中...' : (g.actualDist || '待上传GPX'), 
            elevation: needsParse ? '排队解析中...' : (g.elevation || '待上传GPX'),  
            cutoffTime: g.cutoffTime || '',
            themeColor: hexColor,
            startTime: g.startTime1,
            startTime2: g.startTime2 || null, 
            detailMapImg: mapFileID,
            gpxFileID: gpxFileID,
            checkpoints: g.checkpoints || [] 
          });
        }
      }

      let targetRaceId = currentRaceId;
      const finalData = {
        name: raceName, location: location, date: raceDate, hasItra: hasItra,
        coverImg: coverFileID, tags: tags, groups: dbGroups,
        updateTime: db.serverDate()
      };

      if (mode === 'create') {
        finalData.createTime = db.serverDate();
        const dbRes = await db.collection('races').add({ data: finalData });
        targetRaceId = dbRes._id;
      } else {
        await db.collection('races').doc(targetRaceId).update({ data: finalData });
      }

      if (gpxIndexesToParse.length > 0) {
        for (let idx of gpxIndexesToParse) {
          wx.showLoading({ title: `引擎解析 ${dbGroups[idx].dist} 轨迹...`, mask: true });
          wx.cloud.callFunction({
            name: 'syncGpxToDb',
            data: { raceDocId: targetRaceId, groupIndex: idx, fileID: dbGroups[idx].gpxFileID }
          }).catch(e => console.error("解析组别失败:", idx, e));
        }
      }

      wx.hideLoading();
      wx.showModal({
        title: mode === 'edit' ? '✅ 更新成功' : '🚀 赛事建档成功', 
        content: gpxIndexesToParse.length > 0 ? '包含新GPX，云端引擎正在后台为您绘制地形雷达图...' : '基础信息已保存，后续可随时补传GPX。',
        showCancel: false, 
        success: () => wx.navigateBack()
      });

    } catch (error) {
      wx.hideLoading();
      console.error(error);
      wx.showModal({ title: '操作中断', content: error.message || '网络异常', showCancel: false });
    }
  },

  goBack() { wx.navigateBack(); }
});