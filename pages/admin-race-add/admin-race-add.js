// 页面：赛事控制台，显示赛事编辑表单和 GPX 上传入口
const db = wx.cloud.database();

Page({
  data: {
    mode: 'create', 
    currentRaceId: null,

    raceName: '',
    raceDate: '',
    location: '',
    hasItra: true,
    coverImgPath: '', 
    oldCoverFileId: '',

    groups: [
      {
        dist: '', cutoffTime: '', 
        computedColor: '#FFFFFF', // ✨ 新增：动态计算的颜色
        startTimes: ['07:00'],    // ✨ 新增：动态发枪时间数组
        detailMapPath: '', gpxFilePath: '', gpxFileName: '',
        oldMapFileId: '', oldGpxFileId: '',
        actualDist: '', elevation: '' 
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

  // ✨ 新增：组别颜色智能解析引擎 (与首页保持绝对一致)
  getGroupColor(distStr) {
    if (!distStr) return '#FFFFFF'; 
    let numStr = distStr.replace(/[^\d.]/g, ''); 
    let dist = parseFloat(numStr) || 0;
    
    if (dist < 30) return '#36E153';       // 绿色 (短距离)
    if (dist < 60) return '#FF9811';       // 橙色 (中距离)
    if (dist < 100) return '#3284FF';      // 蓝色 (长距离)
    return '#F94747';                      // 红色 (超长距离 100km+)
  },

  async loadRaceData(raceId) {
    wx.showLoading({ title: '加载赛事数据...', mask: true });
    try {
      const res = await db.collection('races').doc(raceId).get();
      const race = res.data;

      let loadedGroups = race.groups.map(g => {
        // 兼容旧数据的发枪时间
        let stArray = g.startTimes || [];
        if (stArray.length === 0) {
          if (g.startTime) stArray.push(g.startTime);
          if (g.startTime2) stArray.push(g.startTime2);
          if (stArray.length === 0) stArray.push('07:00'); // 兜底
        }

        return {
          dist: g.dist || '',
          computedColor: this.getGroupColor(g.dist || ''), // 自动计算颜色
          cutoffTime: g.cutoffTime || '',
          startTimes: stArray,
          detailMapPath: g.detailMapImg || '', 
          gpxFilePath: g.gpxFileID || '',      
          gpxFileName: g.gpxFileID ? '已上传历史GPX (点击可重传)' : '',
          oldMapFileId: g.detailMapImg || '',
          oldGpxFileId: g.gpxFileID || '',
          actualDist: g.actualDist || '', 
          elevation: g.elevation || '',
          checkpoints: g.checkpoints || []
        };
      });

      if (loadedGroups.length === 0) {
        loadedGroups = [{ dist: '', cutoffTime: '', computedColor: '#FFFFFF', startTimes: ['07:00'], detailMapPath: '', gpxFilePath: '', gpxFileName: '', actualDist: '', elevation: '' }];
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
      computedColor: '#FFFFFF', startTimes: ['07:00'],
      detailMapPath: '', gpxFilePath: '', gpxFileName: '', actualDist: '', elevation: ''
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
    
    // 如果修改的是距离，同时动态触发颜色的计算并更新
    if (field === 'dist') {
      const color = this.getGroupColor(value);
      this.setData({ 
        [`groups[${index}].dist`]: value,
        [`groups[${index}].computedColor`]: color
      });
    } else {
      this.setData({ [`groups[${index}].${field}`]: value });
    }
  },

  // ✨ 动态发枪时间逻辑
  onStartTimeChange(e) {
    const groupIndex = e.currentTarget.dataset.groupIndex;
    const stIndex = e.currentTarget.dataset.stIndex;
    this.setData({
      [`groups[${groupIndex}].startTimes[${stIndex}]`]: e.detail.value
    });
  },

  addStartTime(e) {
    const groupIndex = e.currentTarget.dataset.groupIndex;
    const groups = this.data.groups;
    groups[groupIndex].startTimes.push('07:00');
    this.setData({ groups });
  },

  removeStartTime(e) {
    const groupIndex = e.currentTarget.dataset.groupIndex;
    const stIndex = e.currentTarget.dataset.stIndex;
    const groups = this.data.groups;
    if (groups[groupIndex].startTimes.length <= 1) {
      return wx.showToast({ title: '至少保留一个发枪时间', icon: 'none' });
    }
    groups[groupIndex].startTimes.splice(stIndex, 1);
    this.setData({ groups });
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
      count: 1, 
      type: 'file',
      success: res => {
        const file = res.tempFiles[0];
        if (!file.name.toLowerCase().endsWith('.gpx')) {
          wx.showToast({ title: '格式错误，只能选 GPX 文件', icon: 'none', duration: 2000 });
          return;
        }
        this.setData({
          [`groups[${index}].gpxFilePath`]: file.path,
          [`groups[${index}].gpxFileName`]: file.name
        });
      },
      fail: err => console.log("选择文件失败", err)
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
    const { mode, currentRaceId, raceName, raceDate, location, hasItra, coverImgPath, groups } = this.data;

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
          
          // ✨ 提取我们计算好的动态颜色存入库中
          const hexColor = g.computedColor;
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
            
            // ✨ 保存全新的数组结构，并保留前两个坑位给旧代码兜底
            startTimes: g.startTimes, 
            startTime: g.startTimes[0] || '07:00',
            startTime2: g.startTimes[1] || null, 
            
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
          try {
            await wx.cloud.callFunction({
              name: 'syncGpxToDb',
              data: { raceDocId: targetRaceId, groupIndex: idx, fileID: dbGroups[idx].gpxFileID }
            });
          } catch (e) {
            console.error("解析组别失败:", idx, e);
          }
        }
      }

      wx.hideLoading();
      wx.showModal({
        title: mode === 'edit' ? '✅ 更新成功' : '🚀 赛事建档成功', 
        content: gpxIndexesToParse.length > 0 ? '包含新GPX，云端引擎已完成后台地形雷达图解析。' : '基础信息已保存，后续可随时补传GPX。',
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