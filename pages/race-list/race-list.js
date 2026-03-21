// 页面：全部比赛，显示赛事搜索、筛选和分组列表
const db = wx.cloud.database();

Page({
  data: {
    statusBarHeight: 20,
    allRaces: [],       
    groupedRaces: [],   
    searchKeyword: '',  

    // ✨ 新增：时间分流 Tab，默认显示未来赛事
    timeTab: 'future', // 'future' | 'past'

    // 筛选面板相关状态
    showFilter: false,
    activeFilterCount: 0, 
    
    // 地区展示文案，单独拎出来维护
    regionDisplayText: '', 

    // 用户的选择暂存区
    filterOptions: {
      itra: 'all',       
      distance: 'all',   
      region: [],        
      startDate: '',     
      endDate: '',
      sort: 'asc'        
    }
  },

  onLoad(options) {
    const sysInfo = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sysInfo.statusBarHeight });

    this.fetchCloudRaces();
  },

  fetchCloudRaces() {
    wx.showLoading({ title: '加载赛事中...', mask: true });

    db.collection('races').get({
      success: res => {
        let races = res.data;
        
        races.forEach(race => {
          race.timeMs = this.parseTime(race.date);
        });

        // 默认按时间从近到远排序
        races.sort((a, b) => a.timeMs - b.timeMs);

        this.setData({ allRaces: races }, () => {
          this.applyFilters();
          wx.hideLoading();
        });
      },
      fail: err => {
        console.error("❌ 列表页拉取失败：", err);
        wx.hideLoading();
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    });
  },

  parseTime(dateStr) {
    if (!dateStr) return 0;
    const nums = dateStr.match(/\d+/g); 
    if (nums && nums.length >= 3) {
      return new Date(nums[0], nums[1] - 1, nums[2]).getTime();
    }
    return 0; 
  },

  // ==========================================
  // ✨ 核心过滤引擎 (注入时间分流)
  // ==========================================
  applyFilters() {
    const { allRaces, searchKeyword, filterOptions, timeTab } = this.data;
    let filteredList = [...allRaces];
    const nowMs = new Date().setHours(0, 0, 0, 0); // 获取今天凌晨0点作为分界线

    // 0. ✨ 核心分流：先区分未来与历史
    filteredList = filteredList.filter(race => {
      if (timeTab === 'future') {
        return race.timeMs >= nowMs; // 今天及以后
      } else {
        return race.timeMs < nowMs;  // 昨天及以前
      }
    });

    // 1. 过滤搜索词 (此时搜索已经只会查当前 Tab 下的比赛了)
    if (searchKeyword.trim() !== '') {
      const kw = searchKeyword.trim().toLowerCase();
      filteredList = filteredList.filter(race => {
        const nameMatch = (race.name || '').toLowerCase().includes(kw);
        const locMatch = (race.location || '').toLowerCase().includes(kw);
        return nameMatch || locMatch;
      });
    }

    // 2. 过滤 ITRA
    if (filterOptions.itra === 'yes') {
      filteredList = filteredList.filter(race => race.hasItra === true);
    }

    // 3. 过滤 地区 (处理 "全部" 逻辑)
    if (filterOptions.region && filterOptions.region.length > 0 && filterOptions.region[0] !== '全部') {
      const prov = filterOptions.region[0].replace(/省|市|自治区/g, ''); 
      const city = filterOptions.region[1] === '全部' ? '' : filterOptions.region[1].replace(/市|自治州|地区/g, '');
      const dist = filterOptions.region[2] === '全部' ? '' : filterOptions.region[2].replace(/区|县|市/g, '');
      
      filteredList = filteredList.filter(race => {
        const loc = race.location || '';
        if (dist) return loc.includes(dist);
        if (city) return loc.includes(city);
        return loc.includes(prov);
      });
    }

    // 4. 过滤 距离 (精准匹配 >= 100)
    if (filterOptions.distance !== 'all') {
      filteredList = filteredList.filter(race => {
        if (!race.tags || race.tags.length === 0) return false;
        
        return race.tags.some(tag => {
          let numStr = tag.dist.replace(/[^\d]/g, ''); 
          let distVal = parseInt(numStr) || 0;

          if (filterOptions.distance === '0-30') return distVal < 30;
          if (filterOptions.distance === '30-60') return distVal >= 30 && distVal < 60;
          if (filterOptions.distance === '60-100') return distVal >= 60 && distVal < 100;
          if (filterOptions.distance === '100+') return distVal >= 100; // 包含 100km
          return false;
        });
      });
    }

    // 5. 过滤 自定义时间范围
    if (filterOptions.startDate) {
      let startMs = new Date(filterOptions.startDate).setHours(0, 0, 0, 0);
      filteredList = filteredList.filter(race => race.timeMs >= startMs);
    }
    if (filterOptions.endDate) {
      let endMs = new Date(filterOptions.endDate).setHours(23, 59, 59, 999);
      filteredList = filteredList.filter(race => race.timeMs <= endMs);
    }

    // 6. 全局排序控制
    if (filterOptions.sort === 'asc') {
      filteredList.sort((a, b) => a.timeMs - b.timeMs); // 近到远
    } else {
      filteredList.sort((a, b) => b.timeMs - a.timeMs); // 远到近
    }

    // 将过滤后的数据送去分组渲染
    this.groupAndRenderRaces(filteredList);
  },

  groupAndRenderRaces(list) {
    let groups = {};

    list.forEach(race => {
      const dateObj = new Date(race.timeMs);
      const year = dateObj.getFullYear();
      const month = dateObj.getMonth() + 1;
      
      const groupKey = `${year}-${month}`;

      if (!groups[groupKey]) {
        groups[groupKey] = {
           monthStr: `${month}月`,
           yearStr: `${year}`,
           races: []
        };
      }
      groups[groupKey].races.push(race);
    });

    let groupedArray = [];
    for (let key in groups) {
      groupedArray.push({
        monthStr: groups[key].monthStr,
        yearStr: groups[key].yearStr,
        races: groups[key].races,
        groupTimeMs: groups[key].races[0].timeMs 
      });
    }

    // 组标题跟着用户的排序要求一起翻转
    if (this.data.filterOptions.sort === 'asc') {
      groupedArray.sort((a, b) => a.groupTimeMs - b.groupTimeMs);
    } else {
      groupedArray.sort((a, b) => b.groupTimeMs - a.groupTimeMs);
    }

    this.setData({ groupedRaces: groupedArray });
  },

  // ==========================================
  // 面板与交互事件
  // ==========================================
  
  // ✨ 切换未来/历史 Tab
  switchTimeTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (this.data.timeTab === tab) return;

    // 智能化：看未来赛事默认“从近到远(asc)”，看历史赛事默认“从远到近(desc)”
    const autoSort = tab === 'future' ? 'asc' : 'desc';

    this.setData({ 
      timeTab: tab,
      'filterOptions.sort': autoSort
    }, () => {
      this.applyFilters();
    });
  },

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value }, () => this.applyFilters());
  },
  clearSearch() {
    this.setData({ searchKeyword: '' }, () => this.applyFilters());
  },

  openFilterPanel() { this.setData({ showFilter: true }); },
  closeFilterPanel() { this.setData({ showFilter: false }); },
  preventTouchMove() { return; },

  selectItra(e) { this.setData({ 'filterOptions.itra': e.currentTarget.dataset.val }); },
  selectDist(e) { this.setData({ 'filterOptions.distance': e.currentTarget.dataset.val }); },
  selectSort(e) { this.setData({ 'filterOptions.sort': e.currentTarget.dataset.val }); }, 
  
  onRegionChange(e) { 
    const val = e.detail.value;
    let displayText = '';

    if (val[0] === '全部') {
      displayText = '全国';
    } else if (val[1] === '全部') {
      displayText = val[0]; 
    } else if (val[2] === '全部') {
      displayText = `${val[0]} ${val[1]}`; 
    } else {
      displayText = `${val[0]} ${val[1]} ${val[2]}`; 
    }

    this.setData({ 
      'filterOptions.region': val,
      regionDisplayText: displayText
    }); 
  },
  
  onStartDateChange(e) { this.setData({ 'filterOptions.startDate': e.detail.value }); },
  onEndDateChange(e) { this.setData({ 'filterOptions.endDate': e.detail.value }); },

  resetFilters() {
    this.setData({
      filterOptions: { 
        itra: 'all', distance: 'all', region: [], 
        startDate: '', endDate: '', 
        sort: this.data.timeTab === 'future' ? 'asc' : 'desc' // 重置时保留智能排序
      },
      regionDisplayText: ''
    });
  },

  confirmFilters() {
    let count = 0;
    const opt = this.data.filterOptions;
    if (opt.itra !== 'all') count++;
    if (opt.distance !== 'all') count++;
    if (opt.region.length > 0 && opt.region[0] !== '全部') count++;
    if (opt.startDate || opt.endDate) count++;
    
    // 只有当用户主动选择的排序和智能默认排序不一致时，才亮起筛选红点
    const defaultSort = this.data.timeTab === 'future' ? 'asc' : 'desc';
    if (opt.sort !== defaultSort) count++;

    this.setData({ 
      showFilter: false,
      activeFilterCount: count
    }, () => {
      this.applyFilters();
    });
  },

  goBack() { wx.navigateBack(); },
  goToDetail(e) {
    wx.navigateTo({ url: `/pages/race-detail/race-detail?id=${e.currentTarget.dataset.id}` });
  }
});