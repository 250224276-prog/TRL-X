const db = wx.cloud.database();

const MAX_CONTEXT_MESSAGES = 8;
const AI_BACKEND_MODE = 'deepseek-api';
const CUSTOM_DEEPSEEK_MODEL = 'deepseek-v4-pro';
const MAX_RACE_CONTEXT_CHARS = 6000;
const MAX_CHECKPOINT_LINES = 8;
const MAX_ATTACH_IMAGES = 3;
const RACE_CATALOG_LIMIT = 100;
const EMPTY_STATE_DESCRIPTION = '结合你上传的赛事与轨迹资料，帮你分析风险、补给、装备和比赛计划。';
const STREAM_INTERVAL_MS = 24;

const SYSTEM_PROMPT = [
  '你是 TRL-X 的 AI 跑山助手。',
  '你擅长越野跑赛事计划、补给策略、装备准备、比赛风险识别和训练建议。',
  '如果系统额外提供了赛事数据库资料，请优先基于这些真实资料进行分析，再给出结论。',
  '如果界面已经选中了某场比赛或某个组别，用户后续即使只说“这场比赛”“这条赛道”“这个组别”，也默认是在问当前已选内容，不要反问是哪场比赛。',
  '回答要具体、清晰、偏实用，不要编造赛事事实；不确定时请提醒用户核对官方信息。',
  '绝对不要输出 Markdown 表格、星号加粗、井号标题、代码块或竖线表格符号。',
  '默认用户要的是结果，不要展示你的分析过程，不要写“我是怎么推断的”这类过程性表达。',
  '不要堆砌过多推测性描述；能直接下结论就直接下结论，不确定的信息单独归到“待核实信息”。',
  '回答默认使用固定结构，除非用户明确要求自由发挥：第一行是一个短主标题；后面使用编号小节，如“1. 完赛判断”“2. 核心风险”“3. 补给建议”“4. 装备建议”“5. 待核实信息”。',
  '每个编号小节必须单独成行，标题后换行再写内容，不要把标题和正文揉成一个大段落。',
  '如果某个小节下还有次级信息，使用“二级标题：内容”格式，例如“配速：前半程保守，后半程稳住关门”。',
  '每个小节控制在 2 到 4 条结果，每条尽量短句，优先给结论，不要长篇铺垫。',
  '请直接用自然中文分段回答，不要输出大段连续长文。'
].join('\n');

const BACKEND_SUBTITLE = {
  'deepseek-api': 'DeepSeek V4 自有 Key'
};

const BACKEND_STATUS_LABEL = {
  pending: '待验证',
  'deepseek-api': '自有 DeepSeek Key'
};

function safeText(value, fallback = '') {
  const text = String(value == null ? '' : value).trim();
  return text || fallback;
}

function clampText(value, maxLength = MAX_RACE_CONTEXT_CHARS) {
  return safeText(value).slice(0, maxLength);
}

function parseRaceDateMs(value) {
  const parts = String(value || '').match(/\d+/g);
  if (!parts || parts.length < 3) return 0;
  const year = Number(parts[0]) || 0;
  const month = Number(parts[1]) || 1;
  const day = Number(parts[2]) || 1;
  return new Date(year, month - 1, day).getTime() || 0;
}

function stripLeadingSectionNo(text = '') {
  return String(text || '').replace(/^\s*(?:\d+|[一二三四五六七八九十]+)[、.．]\s*/g, '').trim();
}

function getErrorMessage(error) {
  if (!error) return '请稍后再试';
  return error.message || String(error);
}

function getBackendStatusText(source, model) {
  const sourceLabel = BACKEND_STATUS_LABEL[source] || BACKEND_STATUS_LABEL.pending;
  return model ? `${sourceLabel} · ${model}` : sourceLabel;
}

function sanitizeAssistantReply(content) {
  let text = String(content || '');
  if (!text) return '';

  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/```[\s\S]*?```/g, (match) => match.replace(/```/g, '').trim());
  text = text.replace(/`([^`]+)`/g, '$1');

  const lines = text.split('\n').map((line) => {
    let nextLine = line.trimEnd();

    if (/^\s*\|?[\-:\s|]{3,}\|?\s*$/.test(nextLine)) {
      return '';
    }

    nextLine = nextLine.replace(/^\s{0,3}#{1,6}\s*/g, '');
    nextLine = nextLine.replace(/^\s*>\s*/g, '');
    nextLine = nextLine.replace(/\*\*([^*]+)\*\*/g, '$1');
    nextLine = nextLine.replace(/__([^_]+)__/g, '$1');
    nextLine = nextLine.replace(/\*([^*\n]+)\*/g, '$1');
    nextLine = nextLine.replace(/_([^_\n]+)_/g, '$1');

    if (nextLine.includes('|')) {
      nextLine = nextLine
        .replace(/^\s*\|\s*/g, '')
        .replace(/\s*\|\s*$/g, '')
        .replace(/\s*\|\s*/g, '  ·  ');
    }

    nextLine = nextLine.replace(/^\s*[-*]\s+/g, '• ');
    nextLine = nextLine.replace(/^\s*\d+\.\s+/g, (match) => `${match.trim()} `);
    return nextLine;
  });

  text = lines.join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]{2,}/g, ' ');
  return text.trim();
}

function createMessageBlock(type, text, index, extra = {}) {
  return {
    id: `block-${index}-${type}`,
    type,
    text,
    ...extra
  };
}

function splitLongBodyText(text = '') {
  const normalized = String(text || '')
    .replace(/\n+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (!normalized) return [];
  if (normalized.length <= 72) return [normalized];

  const sentences = normalized.match(/[^。！？；!?;]+[。！？；!?;]?/g) || [normalized];
  const parts = [];
  let current = '';
  let sentenceCount = 0;

  sentences.forEach((sentence) => {
    const cleanSentence = sentence.trim();
    if (!cleanSentence) return;

    const nextLength = (current + cleanSentence).length;
    if (current && (nextLength > 72 || sentenceCount >= 2)) {
      parts.push(current.trim());
      current = cleanSentence;
      sentenceCount = 1;
      return;
    }

    current += cleanSentence;
    sentenceCount += 1;
  });

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts.length ? parts : [normalized];
}

function buildAssistantBlocks(content = '') {
  const source = String(content || '').replace(/\r\n/g, '\n').trim();
  if (!source) return [];

  const paragraphs = source
    .split(/\n{2,}/)
    .map(item => item.trim())
    .filter(Boolean);

  const blocks = [];

  paragraphs.forEach((paragraph, paragraphIndex) => {
    const lines = paragraph
      .split('\n')
      .map(item => item.trim())
      .filter(Boolean);

    if (!lines.length) return;

    if (lines.length > 1 && lines[0].length <= 18 && !/[。！？：:]/.test(lines[0])) {
      blocks.push(createMessageBlock('section', lines[0], `${paragraphIndex}-0`));
      const restText = lines.slice(1).join('\n').trim();
      if (restText) {
        splitLongBodyText(restText).forEach((piece, pieceIndex) => {
          blocks.push(createMessageBlock('body', piece, `${paragraphIndex}-1-${pieceIndex}`));
        });
      }
      return;
    }

    const text = lines.join('\n').trim();
    const bulletMatch = text.match(/^[•·▪◦-]\s*(.+)$/);
    if (bulletMatch) {
      blocks.push(createMessageBlock('bullet', bulletMatch[1].trim(), paragraphIndex));
      return;
    }

    const numberedLabelMatch = text.match(/^((?:\d+|[一二三四五六七八九十]+)[、.．])\s*([^：:\n]{2,24})[：:]\s*([\s\S]+)$/);
    if (numberedLabelMatch) {
      blocks.push(createMessageBlock('section', `${numberedLabelMatch[1]} ${numberedLabelMatch[2]}`.trim(), `${paragraphIndex}-section`));
      splitLongBodyText(numberedLabelMatch[3].trim()).forEach((piece, pieceIndex) => {
        blocks.push(createMessageBlock('body', piece, `${paragraphIndex}-section-body-${pieceIndex}`));
      });
      return;
    }

    const sectionMatch = text.match(/^([一二三四五六七八九十]+[、.．]|[0-9]+[、.．]|[（(]?[一二三四五六七八九十0-9]+[）)])\s*(.+)$/);
    if (sectionMatch && sectionMatch[2].length <= 20) {
      blocks.push(createMessageBlock('section', `${sectionMatch[1]} ${sectionMatch[2]}`.trim(), paragraphIndex));
      return;
    }

    const labelMatch = text.match(/^([^：:\n]{2,20})[：:]\s*([\s\S]+)$/);
    if (labelMatch) {
      blocks.push(createMessageBlock('label', labelMatch[2].trim(), `${paragraphIndex}-label`, {
        label: labelMatch[1].trim()
      }));
      return;
    }

    if (paragraphIndex === 0 && text.length <= 20 && !/[。！？]/.test(text)) {
      blocks.push(createMessageBlock('title', text, paragraphIndex));
      return;
    }

    if (text.length <= 18 && !/[。！？]/.test(text)) {
      blocks.push(createMessageBlock('section', text, paragraphIndex));
      return;
    }

    splitLongBodyText(text).forEach((piece, pieceIndex) => {
      blocks.push(createMessageBlock('body', piece, `${paragraphIndex}-${pieceIndex}`));
    });
  });

  return blocks.length ? blocks : [createMessageBlock('body', source, 0)];
}

function buildAssistantGroups(blocks = []) {
  const groups = [];
  let currentGroup = null;
  let sectionCount = 0;
  let subSectionCount = 0;

  const pushCurrentGroup = () => {
    if (!currentGroup) return;
    groups.push({
      ...currentGroup,
      id: currentGroup.id || `group-${groups.length}`
    });
    currentGroup = null;
  };

  blocks.forEach((block, index) => {
    if (!block) return;

    if (block.type === 'title' || block.type === 'section') {
      pushCurrentGroup();
      if (block.type === 'section') {
        sectionCount += 1;
        subSectionCount = 0;
      }
      currentGroup = {
        id: `group-${index}-${block.type}`,
        level: block.type,
        heading: block.type === 'section' ? stripLeadingSectionNo(block.text) : block.text,
        headingPrefix: block.type === 'section' ? `${sectionCount}.` : '',
        items: []
      };
      return;
    }

    if (block.type === 'label') {
      pushCurrentGroup();
      if (sectionCount <= 0) {
        sectionCount += 1;
        subSectionCount = 0;
      } else {
        subSectionCount += 1;
      }
      currentGroup = {
        id: `group-${index}-label`,
        level: 'label',
        heading: block.label,
        headingPrefix: subSectionCount > 0 ? `${sectionCount}.${subSectionCount}` : `${sectionCount}.`,
        items: [createMessageBlock('body', block.text, `${index}-label-body`)]
      };
      return;
    }

    if (!currentGroup) {
      currentGroup = {
        id: `group-${index}-body`,
        level: 'body',
        heading: '',
        items: []
      };
    }

    currentGroup.items.push(block);
  });

  pushCurrentGroup();
  return groups;
}

function buildMessageBlocks(role, content = '') {
  const text = String(content || '');
  if (role === 'assistant') {
    return buildAssistantBlocks(text);
  }
  return [createMessageBlock('body', text, 0)];
}

function createMessage(role, content) {
  const blocks = buildMessageBlocks(role, content);
  return {
    id: `${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    role,
    content,
    blocks,
    groups: role === 'assistant' ? buildAssistantGroups(blocks) : []
  };
}

function formatGroupLabel(group = {}, index = 0) {
  return safeText(group.dist, `组别 ${index + 1}`);
}

function formatStartTimes(group = {}) {
  const startTimes = Array.isArray(group.startTimes) && group.startTimes.length > 0
    ? group.startTimes
    : [group.startTime, group.startTime2].filter(Boolean);
  return startTimes.length > 0 ? startTimes.join(' / ') : '--';
}

function formatCompactNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '';
  return num.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function formatDistanceKm(value) {
  const text = formatCompactNumber(value);
  return text ? `${text}km` : '--';
}

function summarizeSegmentInsights(checkpoints = []) {
  let longestSegment = null;
  let biggestClimb = null;
  let biggestDescent = null;
  const dropBags = [];

  checkpoints.forEach((cp, index) => {
    const segDist = Number(cp.segDist) || 0;
    const segGain = Number(cp.segGain) || 0;
    const segLoss = Number(cp.segLoss) || 0;
    const cpLabel = safeText(cp.cpNum || cp.name, `CP${index}`);
    const locName = safeText(cp.locName, '');
    const label = locName ? `${cpLabel} ${locName}` : cpLabel;

    if (segDist > (longestSegment?.value || 0)) longestSegment = { value: segDist, label };
    if (segGain > (biggestClimb?.value || 0)) biggestClimb = { value: segGain, label };
    if (segLoss > (biggestDescent?.value || 0)) biggestDescent = { value: segLoss, label };
    if (cp.isDropBag) dropBags.push(label);
  });

  const lines = [];
  if (longestSegment) lines.push(`最长分段：${longestSegment.label}，约 ${formatDistanceKm(longestSegment.value)}`);
  if (biggestClimb) lines.push(`最大单段爬升：${biggestClimb.label}，约 +${Math.round(biggestClimb.value)}m`);
  if (biggestDescent) lines.push(`最大单段下降：${biggestDescent.label}，约 -${Math.round(biggestDescent.value)}m`);
  if (dropBags.length > 0) lines.push(`换装点：${dropBags.join('、')}`);
  return lines;
}

function buildCheckpointLines(checkpoints = []) {
  const lines = checkpoints.slice(0, MAX_CHECKPOINT_LINES).map((cp, index) => {
    const cpLabel = safeText(cp.cpNum || cp.name, `CP${index}`);
    const locName = safeText(cp.locName, '');
    const accDist = formatDistanceKm(Number(cp.accDist) || 0);
    const segDist = formatDistanceKm(Number(cp.segDist) || 0);
    const segGain = Math.round(Number(cp.segGain) || 0);
    const segLoss = Math.round(Number(cp.segLoss) || 0);
    const cutoffText = safeText(cp.cutoffTime || cp.displayCutoffTime, '--:--');
    const rest = Math.max(0, Number(cp.rest) || 0);
    const optionalTags = [];
    if (cp.isDropBag) optionalTags.push('换装');
    if (rest > 0) optionalTags.push(`停留${rest}m`);
    const tagText = optionalTags.length ? ` | ${optionalTags.join(' / ')}` : '';
    return `- ${cpLabel}${locName ? ` ${locName}` : ''} | 累计${accDist} | 分段${segDist} | +${segGain}/-${segLoss} | 关门${cutoffText}${tagText}`;
  });

  if (checkpoints.length > MAX_CHECKPOINT_LINES) {
    lines.push(`- 其余站点已省略，共 ${checkpoints.length} 个站点`);
  }

  return lines;
}

function buildSelectedContextLabel(raceName = '', groupLabel = '') {
  const safeRaceName = safeText(raceName, '未绑定比赛');
  const safeGroupLabel = safeText(groupLabel);
  return safeGroupLabel && safeGroupLabel !== '全部组别'
    ? `${safeRaceName} · ${safeGroupLabel}`
    : safeRaceName;
}

function buildSelectionBindingText(raceName = '', groupLabel = '') {
  const selectedLabel = buildSelectedContextLabel(raceName, groupLabel);
  return `【已选上下文】当前问题默认指向「${selectedLabel}」，不要再追问是哪场比赛。`;
}

function buildRaceOverviewText(race = {}, groupIndex = -1) {
  const groups = Array.isArray(race.groups) ? race.groups : [];
  const selectedGroup = Number.isInteger(groupIndex) && groupIndex >= 0 && groups[groupIndex] ? groups[groupIndex] : null;
  const lines = [
    `赛事名称：${safeText(race.name, '未命名赛事')}`,
    `比赛日期：${safeText(race.date, '--')}`,
    `举办地点：${safeText(race.location, '未填写')}`,
    `ITRA认证：${race.hasItra ? '是' : '否'}`
  ];

  if (selectedGroup) {
    lines.push(
      `当前组别：${formatGroupLabel(selectedGroup, groupIndex)} | 发枪 ${formatStartTimes(selectedGroup)} | 距离 ${safeText(selectedGroup.actualDist, '待补轨迹')} | 爬升下降 ${safeText(selectedGroup.elevation, '待补轨迹')} | 关门 ${safeText(selectedGroup.cutoffTime, '--')}`
    );
  } else {
    const compactGroups = groups.slice(0, 5).map((group, index) => `${formatGroupLabel(group, index)}(${safeText(group.cutoffTime, '--')})`);
    lines.push(`组别：${compactGroups.join('、') || '暂无组别'}`);
  }

  return lines.join('\n');
}

function buildRaceContextText(race = {}, groupIndex = -1) {
  const groups = Array.isArray(race.groups) ? race.groups : [];
  const raceName = safeText(race.name, '未命名赛事');
  const selectedGroup = Number.isInteger(groupIndex) && groupIndex >= 0 && groups[groupIndex] ? groups[groupIndex] : null;
  const selectedGroupLabel = selectedGroup ? formatGroupLabel(selectedGroup, groupIndex) : '全部组别';

  const lines = [
    '以下是后台赛事资料，请严格基于这些资料分析。',
    buildSelectionBindingText(raceName, selectedGroupLabel),
    buildRaceOverviewText(race, groupIndex)
  ];

  if (selectedGroup) {
    const checkpoints = Array.isArray(selectedGroup.checkpoints) ? selectedGroup.checkpoints : [];
    lines.push('');
    lines.push('组别重点：');
    lines.push(`轨迹状态：${selectedGroup.hasGpxTrack ? '已上传轨迹' : '仅站点文本'}`);
    lines.push(`站点数量：${checkpoints.length}`);

    summarizeSegmentInsights(checkpoints).forEach(line => lines.push(line));

    if (checkpoints.length > 0) {
      lines.push(`站点摘要（前${Math.min(checkpoints.length, MAX_CHECKPOINT_LINES)}个）：`);
      buildCheckpointLines(checkpoints).forEach(line => lines.push(line));
    }
  } else if (groups.length > 0) {
    lines.push('');
    lines.push('当前是整场赛事视角，若用户没指定组别，优先从全局角度回答。');
  }

  return clampText(lines.filter(Boolean).join('\n'));
}

function buildAllRacesOverviewText(races = []) {
  const lines = [
    '以下是后台已上传比赛的目录摘要。',
    '若界面未锁定比赛，可先基于这个目录判断用户在问哪一场。'
  ];

  races.slice(0, 20).forEach((race) => {
    const groups = Array.isArray(race.groups) ? race.groups : [];
    const groupSummary = groups.length > 0
      ? groups.map((group, index) => formatGroupLabel(group, index)).join('、')
      : '暂无组别';
    lines.push(`- ${safeText(race.name, '未命名赛事')} | ${safeText(race.date, '--')} | ${safeText(race.location, '未填写地点')} | 组别：${groupSummary}`);
  });

  return clampText(lines.join('\n'));
}

function buildConversationMessages(messages = [], bindingText = '', selectedImageCount = 0) {
  const nextMessages = (Array.isArray(messages) ? messages : []).map(item => ({
    role: item.role,
    content: item.content
  }));

  const lastUserIndex = [...nextMessages].reverse().findIndex(item => item.role === 'user');
  if (lastUserIndex < 0) return nextMessages;

  const actualIndex = nextMessages.length - 1 - lastUserIndex;
  const prefixes = [];

  if (safeText(bindingText)) {
    prefixes.push(bindingText);
  }

  if (selectedImageCount > 0) {
    prefixes.push(`【图片附件】用户本轮附加了 ${selectedImageCount} 张图片。当前版本尚未启用自动读图，请不要假装看到了图片内容；如果回答依赖图片细节，请明确要求用户补充文字描述。`);
  }

  if (prefixes.length > 0) {
    nextMessages[actualIndex] = {
      ...nextMessages[actualIndex],
      content: `${prefixes.join('\n')}\n【用户问题】${nextMessages[actualIndex].content}`
    };
  }

  return nextMessages;
}

Page({
  data: {
    inputValue: '',
    loading: false,
    streaming: false,
    contextLoading: false,
    catalogLoading: false,
    catalogLoaded: false,
    catalogLoadError: '',
    keyboardHeight: 0,
    composerWrapStyle: '',
    composerBackdropStyle: '',
    messageListStyle: '',
    showQuickActions: false,
    showContextSheet: false,
    scrollIntoView: 'chat-bottom',
    backendSubtitle: BACKEND_SUBTITLE[AI_BACKEND_MODE] || BACKEND_SUBTITLE.auto,
    backendStatusText: getBackendStatusText('pending'),
    raceOptions: [],
    selectedRaceIndex: 0,
    selectedRaceId: '',
    selectedRaceLabel: '全部比赛概览',
    selectedRaceName: '',
    groupOptions: [{ label: '全部组别', value: -1 }],
    selectedGroupIndex: 0,
    selectedGroupValue: -1,
    selectedGroupLabel: '全部组别',
    selectedContextLabel: '',
    selectionBindingText: '',
    raceContextText: '',
    selectedImages: [],
    emptyStateDescription: EMPTY_STATE_DESCRIPTION,
    messages: []
  },

  onLoad(options = {}) {
    this.pendingRaceId = safeText(options.raceId);
    const groupIndex = Number(options.groupIndex);
    this.pendingGroupIndex = Number.isInteger(groupIndex) ? groupIndex : -1;
    this.raceDocCache = Object.create(null);
    this.catalogPromise = null;
    this.replyStreamTimer = null;
    this.loadRaceCatalog();
  },

  onUnload() {
    this.clearReplyStreamTimer();
  },

  onHide() {
    this.clearReplyStreamTimer();
  },

  async loadRaceCatalog(options = {}) {
    const { force = false, silent = false } = options;
    if (this.catalogPromise) return this.catalogPromise;
    if (!force && this.data.catalogLoaded && this.data.raceOptions.length) {
      return this.data.raceOptions;
    }

    this.setData({
      contextLoading: true,
      catalogLoading: true,
      catalogLoadError: ''
    });

    this.catalogPromise = (async () => {
    try {
      const res = await db.collection('races').limit(RACE_CATALOG_LIMIT).get();
      const remoteRaces = Array.isArray(res.data) ? res.data : [];
      remoteRaces.sort((a, b) => parseRaceDateMs(b.date) - parseRaceDateMs(a.date));
      const raceOptions = [{
        id: '',
        label: '全部比赛概览',
        name: '',
        groups: [],
        summary: null
      }].concat(remoteRaces.map((race) => ({
        id: race._id,
        label: `${safeText(race.name, '未命名赛事')} · ${safeText(race.date, '--')}`,
        name: safeText(race.name, '未命名赛事'),
        groups: Array.isArray(race.groups) ? race.groups.map((group, index) => ({
          label: formatGroupLabel(group, index),
          value: index
        })) : [],
        summary: {
          name: race.name,
          date: race.date,
          location: race.location,
          hasItra: race.hasItra,
          groups: race.groups || []
        }
      })));

      let selectedRaceIndex = 0;
      if (this.pendingRaceId) {
        const matchedIndex = raceOptions.findIndex(item => item.id === this.pendingRaceId);
        if (matchedIndex >= 0) selectedRaceIndex = matchedIndex;
      }

      const selectionState = this.buildSelectionState(raceOptions, selectedRaceIndex, this.pendingGroupIndex);
      this.setData({
        catalogLoading: false,
        catalogLoaded: true,
        catalogLoadError: '',
        raceOptions,
        ...selectionState
      });

      await this.refreshRaceContext();
      return raceOptions;
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      console.error('loadRaceCatalog failed:', error);
      this.setData({
        contextLoading: false,
        catalogLoading: false,
        catalogLoaded: false,
        catalogLoadError: errorMessage,
        raceContextText: '',
        selectedContextLabel: '',
        selectionBindingText: ''
      });
      if (!silent) {
        wx.showToast({ title: '赛事目录加载失败', icon: 'none' });
      }
      throw error;
    } finally {
      this.catalogPromise = null;
    }
    })();

    return this.catalogPromise;
  },

  buildSelectionState(raceOptions = [], selectedRaceIndex = 0, preferredGroupValue = -1) {
    const safeRaceIndex = Math.max(0, Math.min(selectedRaceIndex, Math.max(0, raceOptions.length - 1)));
    const selectedRace = raceOptions[safeRaceIndex] || raceOptions[0] || { id: '', label: '全部比赛概览', name: '', groups: [] };
    const groupOptions = [{ label: '全部组别', value: -1 }].concat(Array.isArray(selectedRace.groups) ? selectedRace.groups : []);
    const matchedGroupIndex = groupOptions.findIndex(item => item.value === preferredGroupValue);
    const safeGroupIndex = matchedGroupIndex >= 0 ? matchedGroupIndex : 0;
    const selectedGroup = groupOptions[safeGroupIndex] || groupOptions[0];
    const selectedRaceName = selectedRace.name || '';
    const selectedContextLabel = selectedRace.id
      ? buildSelectedContextLabel(selectedRaceName, selectedGroup.label)
      : '';

    return {
      selectedRaceIndex: safeRaceIndex,
      selectedRaceId: selectedRace.id || '',
      selectedRaceLabel: selectedRace.label || '全部比赛概览',
      selectedRaceName,
      groupOptions,
      selectedGroupIndex: safeGroupIndex,
      selectedGroupValue: selectedGroup.value,
      selectedGroupLabel: selectedGroup.label,
      selectedContextLabel,
      selectionBindingText: selectedRace.id ? buildSelectionBindingText(selectedRaceName, selectedGroup.label) : ''
    };
  },

  async getRaceDoc(raceId) {
    if (!raceId) return null;
    if (this.raceDocCache[raceId]) return this.raceDocCache[raceId];

    const res = await db.collection('races').doc(raceId).get();
    const race = res.data || null;
    if (race) {
      this.raceDocCache[raceId] = race;
    }
    return race;
  },

  async refreshRaceContext() {
    const { selectedRaceId, selectedGroupValue, raceOptions } = this.data;
    this.setData({ contextLoading: true });

    try {
      if (!selectedRaceId) {
        const overviewText = buildAllRacesOverviewText(
          raceOptions
            .filter(item => item.id && item.summary)
            .map(item => item.summary)
        );

        this.setData({
          contextLoading: false,
          raceContextText: overviewText,
          selectedContextLabel: '',
          selectionBindingText: ''
        });
        return;
      }

      const race = await this.getRaceDoc(selectedRaceId);
      if (!race) {
        throw new Error('未找到所选赛事资料');
      }

      const groupText = selectedGroupValue >= 0 && Array.isArray(race.groups) && race.groups[selectedGroupValue]
        ? formatGroupLabel(race.groups[selectedGroupValue], selectedGroupValue)
        : '全部组别';

      this.setData({
        contextLoading: false,
        raceContextText: buildRaceContextText(race, selectedGroupValue),
        selectedContextLabel: buildSelectedContextLabel(race.name, groupText),
        selectionBindingText: buildSelectionBindingText(race.name, groupText)
      });
    } catch (error) {
      this.setData({
        contextLoading: false,
        raceContextText: '',
        selectedContextLabel: '',
        selectionBindingText: ''
      });
      wx.showToast({ title: getErrorMessage(error), icon: 'none' });
    }
  },

  noop() {},

  toggleQuickActions() {
    this.setData({
      showQuickActions: !this.data.showQuickActions,
      showContextSheet: false
    });
  },

  closeQuickActions() {
    if (this.data.showQuickActions) {
      this.setData({ showQuickActions: false });
    }
  },

  closeContextSheet() {
    if (this.data.showContextSheet) {
      this.setData({ showContextSheet: false });
    }
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  onInputFocus() {
    this.closeQuickActions();
    this.scrollToBottom();
  },

  onInputBlur() {
    this.updateKeyboardLayout(0);
  },

  onKeyboardHeightChange(e) {
    const height = Number(e.detail && e.detail.height) || 0;
    this.updateKeyboardLayout(height);
  },

  updateKeyboardLayout(height = 0) {
    const keyboardHeight = Math.max(0, Math.round(Number(height) || 0));

    if (!keyboardHeight) {
      this.setData({
        keyboardHeight: 0,
        composerWrapStyle: '',
        composerBackdropStyle: '',
        messageListStyle: ''
      }, () => this.scrollToBottom());
      return;
    }

    const composerOffset = keyboardHeight + 12;
    const backdropHeight = keyboardHeight + 164;
    const messageListPadding = keyboardHeight + 232;

    this.setData({
      keyboardHeight,
      composerWrapStyle: `bottom:${composerOffset}px;`,
      composerBackdropStyle: `height:${backdropHeight}px;`,
      messageListStyle: `padding-bottom:${messageListPadding}px;`
    }, () => this.scrollToBottom());
  },

  scrollToBottom() {
    this.setData({ scrollIntoView: 'chat-bottom' });
  },

  clearReplyStreamTimer() {
    if (this.replyStreamTimer) {
      clearTimeout(this.replyStreamTimer);
      this.replyStreamTimer = null;
    }
  },

  getReplyStreamChunkSize(reply = '') {
    const total = Array.from(String(reply || '')).length;
    if (total > 1200) return 12;
    if (total > 800) return 9;
    if (total > 500) return 7;
    if (total > 260) return 5;
    if (total > 120) return 3;
    return 2;
  },

  streamAssistantReply(baseMessages = [], reply = '', backendStatusText = '') {
    this.clearReplyStreamTimer();

    const fullReply = String(reply || '');
    const chars = Array.from(fullReply);
    const chunkSize = this.getReplyStreamChunkSize(fullReply);
    const assistantMessage = {
      ...createMessage('assistant', ''),
      streaming: true
    };

    if (!chars.length) {
      this.setData({
        messages: [...baseMessages, createMessage('assistant', 'DeepSeek V4 暂时没有返回可展示的内容。')],
        loading: false,
        streaming: false,
        backendStatusText,
        selectedImages: []
      }, () => this.scrollToBottom());
      return;
    }

    let cursor = 0;
    let tick = 0;

    const step = () => {
      cursor = Math.min(chars.length, cursor + chunkSize);
      const done = cursor >= chars.length;
      const nextMessage = {
        ...createMessage('assistant', chars.slice(0, cursor).join('')),
        id: assistantMessage.id,
        content: chars.slice(0, cursor).join(''),
        streaming: !done
      };

      this.setData({
        messages: [...baseMessages, nextMessage],
        loading: false,
        streaming: !done,
        backendStatusText,
        selectedImages: done ? [] : this.data.selectedImages
      }, () => {
        if (tick % 2 === 0 || done) {
          this.scrollToBottom();
        }

        if (done) {
          this.clearReplyStreamTimer();
          return;
        }

        tick += 1;
        this.replyStreamTimer = setTimeout(step, STREAM_INTERVAL_MS);
      });
    };

    this.setData({
      loading: false,
      streaming: true,
      backendStatusText
    }, () => step());
  },

  goBack() {
    wx.navigateBack();
  },

  async openRaceSelector() {
    this.closeQuickActions();

    if (this.data.catalogLoading) {
      wx.showLoading({ title: '加载赛事目录...', mask: true });
      try {
        await this.loadRaceCatalog();
      } catch (error) {
        console.error('openRaceSelector waiting load failed:', error);
      } finally {
        wx.hideLoading();
      }
    }

    if (!this.data.catalogLoaded || !(this.data.raceOptions || []).length) {
      wx.showLoading({ title: '加载赛事目录...', mask: true });
      try {
        await this.loadRaceCatalog({ force: true, silent: true });
      } catch (error) {
        console.error('openRaceSelector retry failed:', error);
        wx.hideLoading();
        wx.showToast({
          title: this.data.catalogLoadError ? '赛事目录加载失败，请重试' : '赛事目录暂不可用',
          icon: 'none'
        });
        return;
      }
      wx.hideLoading();
    }

    const raceOptions = this.data.raceOptions || [];
    if (!raceOptions.length) {
      wx.showToast({ title: '赛事目录尚未加载完成', icon: 'none' });
      return;
    }
    this.setData({ showContextSheet: true });
  },

  openGroupSelector() {
    if (!this.data.selectedRaceId) {
      wx.showToast({ title: '请先选择比赛', icon: 'none' });
      return;
    }
    this.setData({ showContextSheet: true });
  },

  async selectRaceOption(e) {
    const nextIndex = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(nextIndex) || nextIndex < 0) return;

    const nextRace = this.data.raceOptions[nextIndex];
    const nextPreferredGroup = nextRace && nextRace.id === this.data.selectedRaceId
      ? this.data.selectedGroupValue
      : -1;
    const selectionState = this.buildSelectionState(this.data.raceOptions, nextIndex, nextPreferredGroup);

    this.setData(selectionState);
    await this.refreshRaceContext();
  },

  async selectGroupOption(e) {
    const nextIndex = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(nextIndex) || nextIndex < 0) return;

    const selectedGroup = this.data.groupOptions[nextIndex] || this.data.groupOptions[0];
    this.setData({
      selectedGroupIndex: nextIndex,
      selectedGroupValue: selectedGroup.value,
      selectedGroupLabel: selectedGroup.label,
      selectedContextLabel: buildSelectedContextLabel(this.data.selectedRaceName, selectedGroup.label),
      selectionBindingText: buildSelectionBindingText(this.data.selectedRaceName, selectedGroup.label)
    });
    await this.refreshRaceContext();
  },

  confirmContextSelection() {
    this.setData({ showContextSheet: false });
  },

  clearRaceContext() {
    this.closeQuickActions();
    const selectionState = this.buildSelectionState(this.data.raceOptions, 0, -1);
    this.setData({
      ...selectionState,
      showContextSheet: false
    }, () => {
      this.refreshRaceContext();
    });
  },

  chooseImageFromMenu() {
    this.closeQuickActions();
    const remain = MAX_ATTACH_IMAGES - this.data.selectedImages.length;
    if (remain <= 0) {
      wx.showToast({ title: `最多添加 ${MAX_ATTACH_IMAGES} 张图片`, icon: 'none' });
      return;
    }

    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      success: (res) => {
        const files = Array.isArray(res.tempFiles) ? res.tempFiles : [];
        const nextImages = this.data.selectedImages.concat(files.map((file, index) => ({
          id: `${Date.now()}-${index}-${Math.floor(Math.random() * 1000)}`,
          path: file.tempFilePath
        }))).slice(0, MAX_ATTACH_IMAGES);

        this.setData({ selectedImages: nextImages });
      }
    });
  },

  removeSelectedImage(e) {
    const index = Number(e.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0) return;
    const nextImages = [...this.data.selectedImages];
    nextImages.splice(index, 1);
    this.setData({ selectedImages: nextImages });
  },

  getDeepSeekApiReply(messages, raceContextText = '') {
    return wx.cloud.callFunction({
      name: 'deepseekChat',
      data: {
        model: CUSTOM_DEEPSEEK_MODEL,
        systemPrompt: SYSTEM_PROMPT,
        raceContextText: clampText(raceContextText),
        messages
      }
    }).then((res) => {
      console.log('DeepSeek API response:', res);
      const result = res && res.result ? res.result : {};

      if (!result.success) {
        throw new Error(result.error || 'DeepSeek API 暂时没有返回内容');
      }

      if (!result.reply) {
        throw new Error('DeepSeek API 暂时没有返回内容');
      }

      return {
        reply: result.reply,
        source: 'deepseek-api',
        model: result.model || CUSTOM_DEEPSEEK_MODEL
      };
    });
  },

  async getPreferredReply(messages, raceContextText = '') {
    return this.getDeepSeekApiReply(messages, raceContextText);
  },

  async sendMessage() {
    const content = safeText(this.data.inputValue);
    if (!content || this.data.loading || this.data.streaming) return;

    if (this.data.contextLoading) {
      wx.showToast({ title: '赛事资料仍在读取中', icon: 'none' });
      return;
    }

    const userMessage = createMessage('user', content);
    const nextMessages = [...this.data.messages, userMessage];
    const selectedImageCount = this.data.selectedImages.length;

    this.setData({
      inputValue: '',
      loading: true,
      showQuickActions: false,
      messages: nextMessages
    }, () => this.scrollToBottom());

    try {
      const contextMessages = nextMessages
        .filter(item => item.role === 'user' || item.role === 'assistant')
        .slice(-MAX_CONTEXT_MESSAGES)
        .map(item => ({
          role: item.role,
          content: item.content
        }));

      const boundMessages = buildConversationMessages(
        contextMessages,
        this.data.selectionBindingText,
        selectedImageCount
      );

      const result = await this.getPreferredReply(boundMessages, this.data.raceContextText);
      const cleanReply = sanitizeAssistantReply(result.reply);
      this.streamAssistantReply(
        nextMessages,
        cleanReply,
        getBackendStatusText(result.source, result.model)
      );
    } catch (error) {
      this.clearReplyStreamTimer();
      this.setData({
        messages: [
          ...nextMessages,
          createMessage('assistant', `连接 DeepSeek V4 失败：${getErrorMessage(error)}`)
        ],
        loading: false,
        streaming: false,
        backendStatusText: getBackendStatusText('pending')
      }, () => this.scrollToBottom());
    }
  }
});
