// 获取云端数据库引用
const db = wx.cloud.database();

Page({
  data: {
    raceList: []
  },

  onLoad(options) {
    this.fetchCloudRaces();
  },

  // 核心拉取数据的函数
  fetchCloudRaces() {
    wx.showLoading({ title: '加载赛事中...', mask: true });

    db.collection('races').get({
      success: res => {
        // 按时间早晚排序
        let sortedRaces = res.data.sort((a, b) => {
          const parseTime = (dateStr) => {
            if (!dateStr) return 0;
            const nums = dateStr.match(/\d+/g); 
            if (nums && nums.length >= 3) {
              return new Date(nums[0], nums[1] - 1, nums[2]).getTime();
            }
            return 0; 
          };
          return parseTime(a.date) - parseTime(b.date);
        });

        this.setData({ raceList: sortedRaces });
        wx.hideLoading();
      },
      fail: err => {
        console.error("❌ 列表页拉取失败：", err);
        wx.hideLoading();
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    });
  },

  goBack() {
    wx.navigateBack();
  },

  // 点击卡片进入详情页
  goToDetail(e) {
    const raceId = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/race-detail/race-detail?id=${raceId}`
    });
  }
})