// 页面：历史赛事库，显示赛事列表并提供编辑删除入口
const db = wx.cloud.database();

Page({
  data: {
    raceList: [],
    loading: true // 防止数据还没拉取回来时，屏幕闪烁“暂无赛事”
  },

  // ✨ 只要页面显示，就去拉取最新数据（保证列表永远是最新的）
  onShow() {
    this.fetchRaces();
  },

  async fetchRaces() {
    wx.showLoading({ title: '加载赛事库...', mask: true });
    this.setData({ loading: true });
    
    try {
      // 按照创建时间倒序排列 (最新的赛事排在最上面)
      const res = await db.collection('races').orderBy('createTime', 'desc').get();
      
      this.setData({ 
        raceList: res.data, 
        loading: false 
      });
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
      console.error('获取赛事列表报错:', e);
    }
  },

  // ✨ 核心逻辑：点击卡片，带着 ID 跳进你的控制台编辑模式！
  goToEdit(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/admin-race-add/admin-race-add?id=${id}`
    });
  },

  // ✨ 删除赛事的二次确认逻辑
  deleteRace(e) {
    const { id, name } = e.currentTarget.dataset;
    
    wx.showModal({
      title: '高危操作',
      content: `确定要永久删除「${name}」吗？此操作不可恢复！`,
      confirmColor: '#E53935',
      confirmText: '确认删除',
      success: async (res) => {
        if (res.confirm) {
          wx.showLoading({ title: '销毁数据中...', mask: true });
          try {
            // 从数据库中移除
            await db.collection('races').doc(id).remove();
            wx.hideLoading();
            wx.showToast({ title: '已成功删除', icon: 'success' });
            
            // 重新拉取一次列表刷新 UI
            this.fetchRaces();
          } catch (err) {
            wx.hideLoading();
            wx.showToast({ title: '删除失败', icon: 'none' });
            console.error('删除报错:', err);
          }
        }
      }
    });
  },

  goBack() { 
    wx.navigateBack(); 
  }
});
