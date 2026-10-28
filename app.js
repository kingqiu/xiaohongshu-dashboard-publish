var allData = [];
var currentData = [];
var currentMeta = null;
var currentSourceId = null;
var chartTrend = null, chartStructure = null;
var currentSortKey = 'engage', currentSortBtn = null;
var refreshStatus = null;
var accountSourceListeners = [];

function escapeHTML(value) {
  return String(value === null || value === undefined ? '' : value).replace(/[&<>"']/g, function(char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

// 仅解析用户提供的公开主页；短链由后端解析并做最终身份核对。
function parseAccountInput(input) {
  var text = String(input || '').trim();
  if (!text) throw new Error('请粘贴账号主页链接。');
  if (text.length > 2048) throw new Error('分享文本过长，请只粘贴主页链接。');
  if (/^[a-f0-9]{24}$/i.test(text)) {
    var uid = text.toLowerCase();
    return { url: 'https://www.xiaohongshu.com/user/profile/' + uid, userId: uid, isShortLink: false };
  }
  var links = text.match(/https?:\/\/[^\s<>"'，。！？、；：（）【】「」]+/gi) || [];
  if (links.length !== 1) throw new Error('请保留一个小红书主页链接，或填写 24 位账号 UID。');
  var raw = links[0].replace(/[)\]}.,;!?]+$/, '');
  // 检查原始 authority，避免 URL 标准化掩盖 userinfo、端口、反斜杠或伪域名。
  var authority = raw.match(/^https?:\/\/([^/?#]+)/i);
  if (!authority || !/^(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)$/i.test(authority[1]) || /[\\\u0000-\u0020\u007f]/.test(raw)) {
    throw new Error('仅支持小红书或 xhslink.com 链接，请检查地址。');
  }
  var url;
  try { url = new URL(raw); } catch (error) { throw new Error('链接格式不正确，请重新复制主页链接。'); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) throw new Error('链接包含不支持的登录信息或端口。');
  url.protocol = 'https:';
  var isShort = /^(?:www\.)?xhslink\.com$/.test(url.hostname);
  var match = url.pathname.match(/^\/user\/profile\/([a-f0-9]{24})\/?$/i);
  if (isShort) {
    if (!/^\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\/?$/i.test(url.pathname)) throw new Error('短链不完整，请重新复制主页分享链接。');
  } else {
    if (!match) throw new Error('请使用账号主页链接，笔记链接不能用于添加账号。');
    url.pathname = '/user/profile/' + match[1].toLowerCase();
  }
  url.hash = '';
  return { url: url.href, userId: isShort ? null : match[1].toLowerCase(), isShortLink: isShort };
}

function validateAccountNickname(value) {
  var nickname = String(value || '').trim();
  if (!nickname) throw new Error('请填写主页上显示的昵称。');
  if (nickname.length > 80 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(String(value))) throw new Error('昵称最多 80 个字符，且不能包含换行。');
  return nickname;
}

function findMonitoredAccount(userId) {
  if (!userId) return null;
  return XHS_SOURCES.find(function(src) {
    var meta = window[src.metaVar] || {};
    return String(meta.source_user_id || src.source_user_id || '').toLowerCase() === userId.toLowerCase();
  }) || null;
}

function githubAccountUrl(destination) {
  // 私有仓库在未登录时返回 404；先登录，再完整返回预填表单或申请列表。
  var login = new URL('https://github.com/login');
  login.searchParams.set('return_to', destination);
  return login.href;
}

function buildAccountIssueUrl(profileUrl, nickname) {
  var url = new URL('https://github.com/kingqiu/xiaohongshu-dashboard/issues/new');
  url.searchParams.set('title', '添加监测账号：' + nickname);
  url.searchParams.set('body', '<!-- xhs-monitor-request:v1 -->\n### 账号主页\n' + profileUrl + '\n\n### 核对昵称\n' + nickname);
  return githubAccountUrl(url.href);
}

function accountProgressUrl(nickname) {
  var url = new URL('https://github.com/kingqiu/xiaohongshu-dashboard/issues');
  url.searchParams.set('q', 'is:issue in:title 添加监测账号：' + nickname);
  return githubAccountUrl(url.href);
}

function monitoredAccountDetails(sourceId) {
  var src = XHS_SOURCES.find(function(source) { return source.id === sourceId; });
  if (!src) return null;
  var meta = window[src.metaVar] || {};
  var userId = String(meta.source_user_id || src.source_user_id || '').toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(userId)) return null;
  var nickname;
  // 移除请求核对已登记名称；主页昵称可能在采集后发生变化，UID 才是身份主键。
  try { nickname = validateAccountNickname(src.label); }
  catch (error) { return null; }
  return {
    sourceId: src.id, userId: userId, nickname: nickname,
    currentNickname: typeof meta.nickname === 'string' ? meta.nickname : '',
    profileUrl: 'https://www.xiaohongshu.com/user/profile/' + userId
  };
}

function buildRemoveAccountIssueUrl(userId, nickname) {
  if (typeof userId !== 'string' || !/^[a-f0-9]{24}$/i.test(userId)) throw new Error('无法确认要移除的账号主页。');
  nickname = validateAccountNickname(nickname);
  var url = new URL('https://github.com/kingqiu/xiaohongshu-dashboard/issues/new');
  var profileUrl = 'https://www.xiaohongshu.com/user/profile/' + userId.toLowerCase();
  url.searchParams.set('title', '移除监测账号：' + nickname);
  url.searchParams.set('body', '<!-- xhs-monitor-remove:v1 -->\n### 账号主页\n' + profileUrl + '\n\n### 核对昵称\n' + nickname);
  return githubAccountUrl(url.href);
}

function removeAccountProgressUrl(nickname) {
  var url = new URL('https://github.com/kingqiu/xiaohongshu-dashboard/issues');
  url.searchParams.set('q', 'is:issue in:title 移除监测账号：' + nickname);
  return githubAccountUrl(url.href);
}

function isValidDataDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  var date = new Date(value + 'T00:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function aiFailureReason(code) {
  var reasons = {
    missing_key: '尚未配置智谱 API 密钥，请维护者完成配置。',
    auth_failed: '智谱服务身份验证失败，请维护者更新有效的 API 密钥。',
    forbidden: '当前密钥没有调用该模型的权限，请维护者检查授权。',
    rate_limited: '智谱服务请求受限，请稍后重试或检查服务额度。',
    service_error: '智谱服务暂时不可用，请稍后重试。',
    invalid_request: '智谱服务未接受模型或请求参数，请维护者检查配置。',
    timeout: '分析请求超时，请稍后重试。',
    network_error: '暂时无法连接智谱服务，请稍后重试。',
    invalid_response: '智谱服务未返回有效的分析文本，请稍后重试。',
    incomplete_tags: '智谱返回的标签不完整或包含无效字段，将在后续刷新中重试。',
    invalid_output: '分析结果未通过数据校验，已保留原有数据。',
    generation_failed: '本次分析生成失败，请维护者查看后台日志。'
  };
  return Object.prototype.hasOwnProperty.call(reasons, code) ? reasons[code] : reasons.generation_failed;
}

function renderAnalysis() {
  var body = document.getElementById('analysis-body');
  var footer = document.getElementById('analysis-freshness');
  if (!body || !footer) return;
  var meta = currentMeta || {};
  var account = refreshStatus && refreshStatus.accounts && refreshStatus.accounts[currentSourceId];
  // 只把同一份采集数据的运行状态与当前页面配对，避免混用旧状态。
  if (account && meta.collected_at && account.collected_at
      && Date.parse(meta.collected_at) !== Date.parse(account.collected_at)) account = null;
  var stage = account && account.stages && account.stages.glm;
  var failed = meta.analysis_status === 'failed' || (stage && stage.status === 'failed');
  var reason = aiFailureReason(meta.analysis_error_code || (stage && stage.error_code));
  var hasAnalysis = typeof meta.analysis === 'string' && meta.analysis.trim()
    && meta.analysis.indexOf('智能分析生成失败') === -1;
  footer.className = 'analysis-footer';
  if (hasAnalysis) {
    body.textContent = meta.analysis;
    var at = meta.analysis_updated_at;
    var time = typeof at === 'string' && isValidDataDate(at.slice(0, 10)) ? Date.parse(at) : NaN;
    footer.textContent = isFinite(time)
      ? '由 AI 基于公开数据生成 · 生成时间：' + new Date(time).toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }) + '（北京时间）'
      : '历史分析，生成时间未记录';
    if (failed) footer.textContent += '；最近更新失败：' + reason + ' 已保留历史分析，下次数据刷新将自动重试。';
    else if (meta.analysis_status !== 'regenerated') footer.textContent += '；历史分析，未按本次采集重算';
    if (failed || meta.analysis_status !== 'regenerated') footer.className += ' is-historical';
  } else {
    body.textContent = failed ? '智能分析生成失败：' + reason : '分析尚未生成。';
    footer.textContent = failed ? '下次数据刷新将自动重试，当前采集数据和指标仍可正常查看。'
      : '下次数据刷新将自动补生成，无需等待互动量变化。';
    if (stage && stage.skip_code === 'disabled' && !failed) footer.textContent = '本次运行未启用智能分析；下次启用分析的数据刷新将自动补生成。';
    footer.className += ' is-historical';
  }
}

function renderDataFreshness(sourceId) {
  var banner = document.getElementById('data-freshness');
  var src = XHS_SOURCES.find(function(s) { return s.id === sourceId; });
  if (!banner || !src) return;

  var account = refreshStatus && refreshStatus.accounts && refreshStatus.accounts[sourceId];
  var successAt = account && account.last_success_at;
  var successTime = typeof successAt === 'string' && isValidDataDate(successAt.slice(0, 10))
    ? Date.parse(successAt) : NaN;
  var history = window[src.metaVar.replace('_META', '_HISTORY')] || [];
  var historyDates = history.map(function(h) { return h.date; }).filter(isValidDataDate).sort();
  var historyDate = historyDates[historyDates.length - 1];
  var asOfTime, message;

  if (isFinite(successTime)) {
    asOfTime = successTime;
    message = '最近成功采集：' + new Date(successTime).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }) + '（北京时间）';
  } else if (historyDate) {
    asOfTime = Date.parse(historyDate + 'T00:00:00+08:00');
    message = '历史快照截至 ' + historyDate + '（精确采集时间未记录）';
  } else {
    asOfTime = NaN;
    message = '尚无可验证的采集时间，请勿按当前数据解读';
  }

  var stale = isFinite(asOfTime) && Date.now() - asOfTime > 8 * 86400000;
  var failed = account && (account.status === 'failed' || account.status === 'failure');
  if (stale) message += '；当前数据已过期';
  if (failed) message += '；最近刷新失败';
  else if (account && (account.status === 'skipped' || account.status === 'skip')) message += '；最近刷新已跳过';
  else if (!account) message += '；最近刷新状态无法确认';

  var invalidDates = (window[src.dataVar] || []).filter(function(d) { return !isValidDataDate(d.date); }).length;
  if (invalidDates) message += '；' + invalidDates + ' 条笔记日期异常，已排除周分组与日期趋势';
  banner.textContent = message;
  banner.className = 'data-freshness' + (stale || failed || !isFinite(asOfTime) || invalidDates ? ' is-warning' : '');
  var removeDialog = document.getElementById('remove-account-dialog');
  if (removeDialog && removeDialog.open && removeDialog.dataset.sourceId === sourceId) {
    document.getElementById('remove-account-collected-at').textContent = message;
  }
}

// ─── 标签体系 2.0：6 大类 15 维映射 ─────────────────────────
var TAG_CATEGORIES = [
  { key: 'content_theme', label: '内容主题', emoji: '🎯', color: '#ff4d6a', cssClass: 'tc-content',
    fields: [
      { key: 'primary_vertical', label: '主垂类' },
      { key: 'sub_direction', label: '内容细分方向' }
    ]},
  { key: 'content_style', label: '内容风格', emoji: '✍️', color: '#4d7fff', cssClass: 'tc-style',
    fields: [
      { key: 'audience_level', label: '受众门槛' },
      { key: 'sentence_pattern', label: '内容句式' },
      { key: 'tone', label: '内容调性' }
    ]},
  { key: 'seeding_traits', label: '种草特征', emoji: '🌱', color: '#4dff88', cssClass: 'tc-seed',
    fields: [
      { key: 'seeding_tendency', label: '种草倾向' },
      { key: 'suitable_ad_type', label: '适合投放类型' }
    ]},
  { key: 'engagement_traits', label: '互动特征', emoji: '📊', color: '#6366f1', cssClass: 'tc-interact',
    fields: [
      { key: 'fan_activity', label: '粉丝活跃度' },
      { key: 'content_burst', label: '内容爆发力' },
      { key: 'seeding_efficiency', label: '种草效率' }
    ]},
  { key: 'account_health', label: '账号健康度', emoji: '💚', color: '#22c55e', cssClass: 'tc-health',
    fields: [
      { key: 'update_freq', label: '更新频率' },
      { key: 'content_verticality', label: '内容垂直度' },
      { key: 'engagement_authenticity', label: '互动真实性' }
    ]},
  { key: 'collab_fit', label: '合作适配度', emoji: '🤝', color: '#f59e0b', cssClass: 'tc-collab',
    fields: [
      { key: 'recommended_scenario', label: '推荐合作场景' },
      { key: 'brand_tone_match', label: '品牌调性匹配' }
    ]}
];

// 安全销毁 Chart.js 图表：同时清理变量引用和 canvas 内部残留引用
function safeDestroyChart(chartRef, canvasId) {
  try {
    if (chartRef) { chartRef.destroy(); }
  } catch(e) { /* destroy 失败时静默处理 */ }
  // 双保险：用 Chart.getChart 清理 canvas 上残留的图表引用
  try {
    var canvas = document.getElementById(canvasId);
    if (canvas) {
      var existing = Chart.getChart(canvas);
      if (existing) { existing.destroy(); }
    }
  } catch(e) { /* 静默处理 */ }
  return null;
}

// 初始化数据源下拉框
(function initSources() {
  var select = document.getElementById('source-select');
  XHS_SOURCES.forEach(function(src) {
    var opt = document.createElement('option');
    opt.value = src.id;
    opt.textContent = src.label;
    select.appendChild(opt);
  });
  select.addEventListener('change', function() {
    loadSource(this.value);
  });
  if (!XHS_SOURCES.length) {
    renderEmptyDashboard();
    return;
  }
  loadSource(XHS_SOURCES[0].id);
  fetch('sources/refresh_status.json?sync=' + Date.now(), { cache: 'no-store' })
    .then(function(response) {
      if (!response.ok) throw new Error('刷新状态不可用');
      return response.json();
    })
    .then(function(status) {
      refreshStatus = status && typeof status.accounts === 'object' ? status : null;
      renderDataFreshness(currentSourceId);
      renderAnalysis();
      renderTagPanel(currentMeta);
    })
    .catch(function() { renderDataFreshness(currentSourceId); });
})();

function updateRemovalAvailability() {
  var button = document.getElementById('remove-account-button');
  if (!button) return;
  button.disabled = !monitoredAccountDetails(currentSourceId);
  button.title = button.disabled && currentSourceId ? '该账号缺少可核对的主页信息，暂时无法移除' : '';
}

function renderEmptyDashboard() {
  currentSourceId = null;
  currentMeta = null;
  allData = [];
  currentData = [];
  chartTrend = safeDestroyChart(chartTrend, 'chart-trend');
  chartStructure = safeDestroyChart(chartStructure, 'chart-structure');
  growthChart = safeDestroyChart(growthChart, 'chart-growth');
  document.getElementById('dashboard-content').hidden = true;
  document.getElementById('empty-state').hidden = false;
  var select = document.getElementById('source-select');
  select.innerHTML = '<option value="">暂无监测账号</option>';
  select.disabled = true;
  updateRemovalAvailability();
}

function loadSource(sourceId) {
  var src = XHS_SOURCES.find(function(s){ return s.id === sourceId; });
  if (!src) {
    if (!XHS_SOURCES.length) renderEmptyDashboard();
    return;
  }

  currentSourceId = sourceId;
  allData = window[src.dataVar] || [];
  currentMeta = window[src.metaVar] || null;
  document.getElementById('dashboard-content').hidden = false;
  document.getElementById('empty-state').hidden = true;
  document.getElementById('source-select').disabled = false;
  updateRemovalAvailability();
  renderDataFreshness(sourceId);

  // 重置周筛选
  currentData = allData;
  rebuildWeekButtons();

  // 重置排序
  currentSortKey = 'engage';
  currentSortBtn = null;

  // 销毁现有图表（使用安全销毁，防止 Chart.js canvas 残留引用）
  chartTrend = safeDestroyChart(chartTrend, 'chart-trend');
  chartStructure = safeDestroyChart(chartStructure, 'chart-structure');
  growthChart = safeDestroyChart(growthChart, 'chart-growth');

  // 渲染前临时显示所有 tab 内容，确保 canvas 有尺寸（Chart.js 在 display:none 时无法获取尺寸）
  var tabIds = ['tab-trend', 'tab-structure', 'tab-growth'];
  var prevDisplay = {};
  tabIds.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) { prevDisplay[id] = el.style.display; el.style.display = ''; }
  });

  try {
    render();
  } finally {
    // 无论 render 是否出错，都要恢复 tab 显示状态（防止布局错乱）
    tabIds.forEach(function(id) {
      var el = document.getElementById(id);
      if (el && prevDisplay[id] !== undefined) el.style.display = prevDisplay[id];
    });
    // 当前激活的 tab 始终显示
    var activeTab = document.querySelector('.chart-tab.active');
    if (activeTab) {
      var tabName = activeTab.getAttribute('onclick').match(/'(\w+)'/)[1];
      var activeEl = document.getElementById('tab-' + tabName);
      if (activeEl) activeEl.style.display = '';
    }
  }
}

function rebuildWeekButtons() {
  var weeks = {};
  allData.forEach(function(d) {
    var wk = isoWeek(d.date);
    if (!wk) return;
    weeks[wk] = (weeks[wk] || 0) + 1;
  });
  var sorted = Object.keys(weeks).sort();
  var container = document.getElementById('week-btns');
  container.innerHTML = '';
  sorted.forEach(function(wk) {
    var btn = document.createElement('button');
    btn.className = 'week-btn';
    btn.textContent = wk + ' (' + weeks[wk] + ')';
    btn.onclick = function() { filterWeek(wk, btn); };
    container.appendChild(btn);
  });
  document.querySelectorAll('.week-btn').forEach(function(b){ b.classList.remove('active'); });
  var allBtn = document.querySelector('.week-bar .week-btn');
  if (allBtn) allBtn.classList.add('active');
}

function isoWeek(dateStr) {
  if (!isValidDataDate(dateStr)) return null;
  var d = new Date(dateStr);
  var jan4 = new Date(d.getFullYear(), 0, 4);
  var startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  var diff = d - startOfWeek1;
  var week = Math.floor(diff / 604800000) + 1;
  var year = d.getFullYear();
  if (week < 1) { year--; week = 52; }
  return year + '-W' + String(week).padStart(2, '0');
}

function filterWeek(wk, btn) {
  document.querySelectorAll('.week-btn').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  currentData = wk ? allData.filter(function(d){ return isoWeek(d.date) === wk; }) : allData;
  render();
}

function fmt(n) {
  if (n === null || n === undefined) return '—';
  return n >= 10000 ? (n/10000).toFixed(1)+'万' : n.toLocaleString();
}

function safeNum(v) {
  return (v !== null && v !== undefined) ? v : 0;
}

// 前端兜底计算指标（针对旧数据没有 save_rate/quality_index/score 的情况）
function ensureMetrics(d) {
  var likes = safeNum(d.likes);
  var saves = safeNum(d.saves);
  var comments = safeNum(d.comments);
  var shares = safeNum(d.shares);
  var total = likes + saves + comments + shares;

  d.engage = total;

  if (d.save_rate === undefined || d.save_rate === null) {
    d.save_rate = total > 0 ? saves / total : 0;
  }
  if (d.quality_index === undefined || d.quality_index === null) {
    d.quality_index = total > 0 ? (comments * 4 + shares * 4 + saves * 1 + likes * 1) / total : 1;
  }
  if (d.score === undefined || d.score === null) {
    if (total === 0) {
      d.score = 0;
    } else {
      var commentRatio = comments / total;
      var shareRatio = shares / total;
      var saveRateScore = Math.min(d.save_rate / 0.3, 1.0) * 100;
      var qualityScore = Math.min(d.quality_index / 3.0, 1.0) * 100;
      var commentScore = Math.min(commentRatio / 0.15, 1.0) * 100;
      var shareScore = Math.min(shareRatio / 0.15, 1.0) * 100;
      d.score = Math.min(Math.round(saveRateScore * 0.30 + qualityScore * 0.30 + commentScore * 0.20 + shareScore * 0.20), 100);
    }
  }
}

function render() {
  var data = currentData;

  // 为每条数据补充指标
  data.forEach(ensureMetrics);

  // KPI 计算
  var totalEngagement = data.reduce(function(s,d){ return s + d.engage; }, 0);
  var avgSaveRate = data.length > 0 ? data.reduce(function(s,d){ return s + d.save_rate; }, 0) / data.length : 0;
  var avgQuality = data.length > 0 ? data.reduce(function(s,d){ return s + d.quality_index; }, 0) / data.length : 0;
  var avgCommentRatio = 0;
  if (data.length > 0) {
    avgCommentRatio = data.reduce(function(s,d){
      return s + (d.engage > 0 ? safeNum(d.comments) / d.engage : 0);
    }, 0) / data.length;
  }
  var avgScore = data.length > 0 ? Math.round(data.reduce(function(s,d){ return s + d.score; }, 0) / data.length) : 0;

  // 优先使用META中的汇总指标（全量视图时）
  if (currentData === allData && currentMeta) {
    if (currentMeta.total_engagement !== undefined) totalEngagement = currentMeta.total_engagement;
    if (currentMeta.avg_save_rate !== undefined) avgSaveRate = currentMeta.avg_save_rate;
    if (currentMeta.avg_quality_index !== undefined) avgQuality = currentMeta.avg_quality_index;
    if (currentMeta.avg_comment_ratio !== undefined) avgCommentRatio = currentMeta.avg_comment_ratio;
    if (currentMeta.avg_score !== undefined) avgScore = currentMeta.avg_score;
  }

  document.getElementById('kpi-engagement').textContent = fmt(totalEngagement);
  document.getElementById('kpi-save-rate').textContent = (avgSaveRate * 100).toFixed(1) + '%';
  document.getElementById('kpi-quality').textContent = avgQuality.toFixed(2);
  document.getElementById('kpi-comment-ratio').textContent = (avgCommentRatio * 100).toFixed(1) + '%';
  document.getElementById('kpi-score').textContent = avgScore;

  // 区块 2：账号基础信息卡片
  renderProfileInfoCard(currentMeta, data.length);

  renderAnalysis();

  // 区块 6：标签体系 2.0
  renderTagPanel(currentMeta);

  // ─── 图表渲染（每个图表独立 try-catch，防止一个失败影响其他） ───

  // 成长趋势折线图
  try {
    renderGrowthChart(currentSourceId);
  } catch(e) {
    console.error('[看板] 成长趋势图渲染失败:', e);
  }

  // 图表1: 互动量趋势（堆叠柱状图）
  try {
    var sorted = data.filter(function(d) { return isValidDataDate(d.date); })
      .sort(function(a,b){ return a.date.localeCompare(b.date); });
    var labels = sorted.map(function(d){ return d.date.slice(5); });

    var trendData = {
      labels: labels,
      datasets: [
        {
          label: '点赞',
          data: sorted.map(function(d){ return safeNum(d.likes); }),
          backgroundColor: '#3b82f6',
          borderRadius: 2
        },
        {
          label: '收藏',
          data: sorted.map(function(d){ return safeNum(d.saves); }),
          backgroundColor: '#22c55e',
          borderRadius: 2
        },
        {
          label: '评论',
          data: sorted.map(function(d){ return safeNum(d.comments); }),
          backgroundColor: '#f97316',
          borderRadius: 2
        },
        {
          label: '分享',
          data: sorted.map(function(d){ return safeNum(d.shares); }),
          backgroundColor: '#a855f7',
          borderRadius: 2
        }
      ]
    };

    // 安全清理 canvas 残留引用后再创建
    chartTrend = safeDestroyChart(chartTrend, 'chart-trend');
    chartTrend = new Chart(document.getElementById('chart-trend'), {
      type: 'bar',
      data: trendData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { color: '#888', font: { size: 10 }, boxWidth: 12, padding: 8 } }
        },
        scales: {
          x: { stacked: true, ticks: { color: '#555', font: { size: 9 }, maxRotation: 45 }, grid: { display: false } },
          y: { stacked: true, ticks: { color: '#555', font: { size: 10 } }, grid: { color: '#1e1e1e' } }
        }
      }
    });
  } catch(e) {
    console.error('[看板] 互动趋势图渲染失败:', e);
  }

  // 图表2: 互动结构分布（饼图）
  try {
    var totalLikes = data.reduce(function(s,d){ return s + safeNum(d.likes); }, 0);
    var totalSaves = data.reduce(function(s,d){ return s + safeNum(d.saves); }, 0);
    var totalComments = data.reduce(function(s,d){ return s + safeNum(d.comments); }, 0);
    var totalShares = data.reduce(function(s,d){ return s + safeNum(d.shares); }, 0);

    var structureData = {
      labels: ['点赞', '收藏', '评论', '分享'],
      datasets: [{
        data: [totalLikes, totalSaves, totalComments, totalShares],
        backgroundColor: ['#3b82f6', '#22c55e', '#f97316', '#a855f7'],
        borderColor: '#0f0f0f',
        borderWidth: 2
      }]
    };

    // 安全清理 canvas 残留引用后再创建
    chartStructure = safeDestroyChart(chartStructure, 'chart-structure');
    chartStructure = new Chart(document.getElementById('chart-structure'), {
      type: 'doughnut',
      data: structureData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right', labels: { color: '#888', font: { size: 11 }, padding: 12 } }
        }
      }
    });
  } catch(e) {
    console.error('[看板] 互动结构图渲染失败:', e);
  }

  // 表格排序（放在最后，确保一定执行）
  sortTable(currentSortKey, currentSortBtn);
}

function sortTable(key, btn) {
  currentSortKey = key;
  currentSortBtn = btn;
  document.querySelectorAll('.sort-btn').forEach(function(b){ b.classList.remove('active'); });
  if (btn) {
    btn.classList.add('active');
  } else {
    document.querySelectorAll('.sort-btn').forEach(function(b){
      if ((key === 'engage' && b.textContent === '互动量') ||
          (key === 'save_rate' && b.textContent === '收藏率') ||
          (key === 'quality_index' && b.textContent === '互动质量') ||
          (key === 'score' && b.textContent === '综合评分')) {
        b.classList.add('active');
        currentSortBtn = b;
      }
    });
  }

  var s = currentData.slice().sort(function(a,b){
    var av = a[key], bv = b[key];
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  });

  document.getElementById('table-body').innerHTML = s.map(function(d, i) {
    var scoreColor = d.score >= 80 ? 'score-high' : d.score >= 60 ? 'score-mid' : 'score-low';

    return '<tr class="' + (i < 3 ? 'top-row' : '') + '">'
      + '<td style="color:#555">' + (i+1) + '</td>'
      + '<td class="note-title">' + escapeHTML(d.title) + '</td>'
      + '<td class="num">' + escapeHTML(fmt(d.likes)) + '</td>'
      + '<td class="num">' + escapeHTML(fmt(d.saves)) + '</td>'
      + '<td class="num">' + escapeHTML(fmt(d.comments)) + '</td>'
      + '<td class="num">' + escapeHTML(fmt(d.shares)) + '</td>'
      + '<td class="num">' + (d.save_rate * 100).toFixed(1) + '%</td>'
      + '<td class="num">' + d.quality_index.toFixed(2) + '</td>'
      + '<td class="num ' + scoreColor + '">' + escapeHTML(d.score) + '</td>'
      + '<td style="color:#555">' + escapeHTML(d.date) + '</td>'
      + '</tr>';
  }).join('');
}

// ─── 区块 2：账号基础信息卡片渲染 ───────────────────────────────
function renderProfileInfoCard(meta, noteCount) {
  var container = document.getElementById('profile-info-card');
  if (!container) return;

  if (!meta || !meta.nickname) {
    container.innerHTML = '<p style="font-size:13px;color:#666;margin-bottom:16px">共 ' + escapeHTML(noteCount) + ' 篇笔记</p>';
    return;
  }

  var avatarChar = String(meta.nickname).charAt(0);
  var t = meta.profile_tags || {};

  var html = '<div class="profile-info-card">'
    + '<div class="profile-main">'
    + '<div class="profile-left">'
    + '<div class="avatar">' + escapeHTML(avatarChar) + '</div>'
    + '<div class="profile-info">'
    + '<h2>' + escapeHTML(meta.nickname) + '</h2>'
    + '<div class="profile-meta-row">';

  if (meta.xhs_id) html += '<span>小红书号 ' + escapeHTML(meta.xhs_id) + '</span>';
  if (meta.location) html += '<span>IP属地 ' + escapeHTML(meta.location) + '</span>';

  html += '</div>';

  if (meta.bio) html += '<div class="profile-bio">' + escapeHTML(meta.bio) + '</div>';

  html += '</div></div>'  // close .profile-info, .profile-left
    + '<div class="profile-stats">';

  var stats = [
    { num: meta.followers, label: '粉丝', accent: true },
    { num: meta.following, label: '关注', accent: false },
    { num: meta.total_likes_and_saves || meta.total_likes, label: '获赞与收藏', accent: true },
    { num: meta.notes_count, label: '笔记', accent: false }
  ];

  stats.forEach(function(s) {
    if (s.num === undefined || s.num === null) return;
    html += '<div class="profile-stat-item">'
      + '<div class="profile-stat-num' + (s.accent ? ' accent' : '') + '">' + escapeHTML(fmt(s.num)) + '</div>'
      + '<div class="profile-stat-label">' + s.label + '</div>'
      + '</div>';
  });

  html += '</div></div>';  // close .profile-stats, .profile-main

  // 底部胶囊标签
  if (t.follower_tier || t.content_format) {
    html += '<div class="profile-badges">';
    if (t.follower_tier) {
      html += '<span class="pbadge pbadge-tier">🧑 ' + escapeHTML(t.follower_tier);
      if (meta.followers !== undefined && meta.followers !== null) {
        if (meta.followers < 1000) html += ' &lt;1k粉';
        else if (meta.followers < 10000) html += ' ' + escapeHTML(fmt(meta.followers)) + '粉';
        else html += ' ' + escapeHTML(fmt(meta.followers)) + '粉';
      }
      html += '</span>';
    }
    if (t.content_format) {
      html += '<span class="pbadge pbadge-format">📄 ' + escapeHTML(t.content_format) + '</span>';
    }
    html += '</div>';
  }

  html += '</div>';  // close .profile-info-card
  container.innerHTML = html;
}

// ─── 区块 6：标签体系 2.0 渲染 ──────────────────────────────────
function isV2Tags(tags) {
  // v2.0 的 profile_tags 含有 content_theme 对象
  return tags && typeof tags.content_theme === 'object' && tags.content_theme !== null;
}

function usableTag(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 120
    && ['未知', 'null', 'none', 'undefined', '待生成', '未生成', '暂无'].indexOf(value.trim().toLowerCase()) === -1;
}

function tagTime(value) {
  if (typeof value !== 'string' || !isValidDataDate(value.slice(0, 10)) || !isFinite(Date.parse(value))) return '';
  return new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric',
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + '（北京时间）';
}

function renderTagPanel(meta) {
  var container = document.getElementById('tag-panel');
  if (!container) return;

  if (!meta) {
    container.innerHTML = '';
    return;
  }

  var t = meta.profile_tags || {};

  // v1.0 降级显示
  if (meta.profile_tags && !isV2Tags(t) && typeof t.primary_vertical === 'string') {
    renderTagPanelV1Fallback(container, t);
    return;
  }

  // v2.0 标签体系
  var colorMap = {
    content_theme: '#ff4466',
    content_style: '#5b8def',
    seeding_traits: '#34d399',
    engagement_traits: '#a78bfa',
    account_health: '#10b981',
    collab_fit: '#fbbf24'
  };

  var filled = 0, aiFilled = 0;
  TAG_CATEGORIES.forEach(function(cat) {
    cat.fields.forEach(function(field) {
      if (usableTag((t[cat.key] || {})[field.key])) {
        filled++;
        if (cat.key !== 'engagement_traits' && cat.key !== 'account_health') aiFilled++;
      }
    });
  });
  var account = refreshStatus && refreshStatus.accounts && refreshStatus.accounts[currentSourceId];
  if (account && meta.collected_at && account.collected_at
      && Date.parse(meta.collected_at) !== Date.parse(account.collected_at)) account = null;
  var stage = account && account.stages && account.stages.tags;
  var failed = t.glm_status === 'failed' || (stage && stage.status === 'failed');
  var pending = aiFilled < 9;

  var html = '<div class="tag-panel">'
    + '<div class="tag-panel-heading">🏷️ 账号画像标签 · 6 大维度 15 项指标</div>'
    + '<div class="tag-panel-sub">已生成 ' + filled + '/15 项 · AI 标签 ' + aiFilled + '/9 项，量化标签 ' + (filled - aiFilled) + '/6 项</div>'
    + '<div class="tag-grid">';

  TAG_CATEGORIES.forEach(function(cat) {
    var catData = t[cat.key] || {};

    html += '<div class="tag-grid-row ' + cat.cssClass + '">';
    html += '<div class="tag-cat ' + cat.cssClass + '">'
      + '<span class="tag-cat-dot" style="background:' + (colorMap[cat.key] || cat.color) + '"></span> '
      + cat.emoji + ' ' + cat.label
      + '</div>';

    // 每个类别最多 3 组字段，Grid 有 3 组 attr-name + val 列
    var maxFields = 3;
    for (var i = 0; i < maxFields; i++) {
      if (i < cat.fields.length) {
        var field = cat.fields[i];
        var val = catData[field.key];
        html += '<div class="tag-attr-name">' + field.label + '</div>';
        html += '<div class="tag-val">';
        if (usableTag(val)) {
          html += '<span class="tag-pill">' + escapeHTML(val) + '</span>';
        } else {
          html += '<span class="tag-empty">待生成</span>';
        }
        html += '</div>';
      } else {
        // 空占位
        html += '<div class="tag-attr-name"></div><div class="tag-val"></div>';
      }
    }

    html += '</div>';  // close .tag-grid-row
  });

  html += '</div>';  // close .tag-grid

  var quantified = tagTime(t.quantified_at);
  var generated = tagTime(t.glm_updated_at);
  var footer = '量化标签更新：' + (quantified || t.tagged_at || '时间未记录');
  footer += ' · AI 标签：' + (generated ? '生成于 ' + generated : aiFilled ? '保留历史结果，生成时间未记录' : '尚未生成');
  html += '<div class="tag-footer">' + escapeHTML(footer) + '</div>';
  if (failed || pending) {
    var notice = failed ? 'AI 标签生成失败：' + aiFailureReason(t.glm_error_code || (stage && stage.error_code))
      : 'AI 标签尚未完整生成。';
    notice += ' 已保留已有标签；' + (stage && stage.skip_code === 'disabled'
      ? '下次启用 AI 的数据刷新将自动重试。' : '下次数据刷新将自动补生成或重试。');
    html += '<div class="tag-status" role="status">' + escapeHTML(notice) + '</div>';
  }
  html += '</div>';  // close .tag-panel
  container.innerHTML = html;
}

// v1.0 降级显示（旧数据格式兼容）
function renderTagPanelV1Fallback(container, t) {
  var html = '<div class="tag-panel">'
    + '<div class="tag-panel-heading">🏷️ 账号画像</div>'
    + '<div class="tag-panel-sub">标签体系 v1.0 — 后续升级后将自动展示 6 维 15 项标签</div>'
    + '<div class="tag-v1-fallback" style="display:flex;flex-wrap:wrap;gap:8px">';

  var tagDefs = [
    { key: 'follower_tier',       label: '量级',   icon: '👥' },
    { key: 'primary_vertical',    label: '主垂类', icon: '📌' },
    { key: 'secondary_vertical',  label: '次垂类', icon: '📎' },
    { key: 'content_style',       label: '风格',   icon: '✍️' },
    { key: 'content_consistency', label: '垂直度', icon: '🎯' },
    { key: 'engagement_quality',  label: '互动质量', icon: '⚡' },
    { key: 'content_format',      label: '形式',   icon: '📄' },
    { key: 'commercial_stage',    label: '阶段',   icon: '📈' },
  ];

  tagDefs.forEach(function(def) {
    var val = t[def.key];
    if (!val || val === '未知' || val === 'null') return;
    html += '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:500;white-space:nowrap;background:rgba(100,100,100,0.15);color:#9ca3af;border:1px solid #444">'
          + def.icon + ' ' + def.label + '：' + escapeHTML(val)
          + '</span>';
  });

  html += '</div>';  // close .tag-v1-fallback
  html += '<div class="tag-footer">打标时间：' + escapeHTML(t.tagged_at || '未知') + ' · 由 GLM + 量化指标自动生成（v1.0）</div>';
  html += '</div>';  // close .tag-panel
  container.innerHTML = html;
}

// ─── Tab 切换 ────────────────────────────────────────────────
function switchChartTab(tab, btn) {
  document.querySelectorAll('.chart-tab').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  ['growth','trend','structure'].forEach(function(t) {
    document.getElementById('tab-' + t).style.display = (t === tab) ? '' : 'none';
  });
  // 切换到该 Tab 后强制触发图表 resize，解决 display:none 时尺寸为0导致渲染空白的问题
  setTimeout(function() {
    if (tab === 'trend' && chartTrend) chartTrend.resize();
    if (tab === 'structure' && chartStructure) chartStructure.resize();
    if (tab === 'growth' && growthChart) growthChart.resize();
  }, 50);
}

// ─── 成长趋势折线图 ──────────────────────────────────────────
var growthChart = null;

function renderGrowthChart(sourceId) {
  // 找到对应的 history 变量
  var src = XHS_SOURCES.find(function(s) { return s.id === sourceId; });
  if (!src) return;

  var histVar = src.metaVar.replace('_META', '_HISTORY');  // e.g. LIANGKEBAN_HISTORY
  var history = window[histVar];
  if (history) history = history.filter(function(h) { return isValidDataDate(h.date); });

  var ctx = document.getElementById('chart-growth');
  if (!ctx) return;

  var notice = document.getElementById('growth-notice');
  if (notice) {
    var singleDay = history && history.length === 1;
    notice.hidden = !singleDay;
    notice.textContent = singleDay
      ? '当前仅有 1 天数据（' + history[0].date + '），图中圆点为首日快照。至少积累 2 个不同日期的数据后，才会显示成长曲线；同一天刷新不会增加时间点。'
      : '';
  }

  growthChart = safeDestroyChart(growthChart, 'chart-growth');

  if (!history || history.length === 0) {
    ctx.parentNode.innerHTML = '<div style="color:#555;font-size:13px;text-align:center;padding:60px 0">暂无历史数据，下次刷新后开始记录</div>';
    document.getElementById('growth-legend').innerHTML = '';
    return;
  }

  var labels = history.map(function(h) { return h.date; });

  // 4条折线，每条单独归一化（显示相对变化趋势，避免数量级差异）
  var series = [
    { key: 'fans',      label: '粉丝数',    color: '#3b82f6' },
    { key: 'liked',     label: '累计获赞',   color: '#f59e0b' },
    { key: 'collected', label: '累计收藏',   color: '#10b981' },
    { key: 'notes',     label: '笔记总数',   color: '#a855f7' },
  ];

  var datasets = series.map(function(s) {
    var values = history.map(function(h) { return h[s.key] || 0; });
    return {
      label: s.label,
      data: values,
      borderColor: s.color,
      backgroundColor: s.color + '22',
      borderWidth: 2,
      pointRadius: history.length === 1 ? 5 : 3,
      pointHoverRadius: 6,
      tension: 0.3,
      fill: false,
      yAxisID: s.key === 'notes' ? 'y2' : 'y1',  // 笔记数用右轴，其他用左轴
    };
  });

  growthChart = new Chart(ctx, {
    type: 'line',
    data: { labels: labels, datasets: datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },  // 用自定义图例
        tooltip: {
          backgroundColor: '#1e1e1e',
          borderColor: '#333',
          borderWidth: 1,
          titleColor: '#ccc',
          bodyColor: '#aaa',
          callbacks: {
            label: function(ctx) {
              return ctx.dataset.label + ': ' + ctx.parsed.y.toLocaleString();
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: '#555', font: { size: 11 }, maxTicksLimit: 8 },
          grid: { color: '#1e1e1e' }
        },
        y1: {
          type: 'linear', position: 'left',
          ticks: { color: '#555', font: { size: 11 },
            callback: function(v) { return v >= 10000 ? (v/10000).toFixed(1)+'w' : v; }
          },
          grid: { color: '#1e1e1e' }
        },
        y2: {
          type: 'linear', position: 'right',
          ticks: { color: '#a855f7', font: { size: 11 } },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });

  // 渲染自定义图例
  var legendHtml = series.map(function(s) {
    return '<div class="growth-legend-item">'
      + '<div class="growth-legend-dot" style="background:' + s.color + '"></div>'
      + s.label + '</div>';
  }).join('');
  document.getElementById('growth-legend').innerHTML = legendHtml;
}

// ─── 添加监测账号：只准备请求，GitHub 页面由用户最终确认提交 ───
(function initAccountManager() {
  var dialog = document.getElementById('account-dialog');
  var trigger = document.getElementById('add-account-button');
  if (!dialog || !trigger) return;
  var homepage = document.getElementById('account-homepage');
  var nicknameInput = document.getElementById('account-nickname');
  var confirmation = document.getElementById('account-confirm');
  var submit = document.getElementById('account-submit');
  var profileLink = document.getElementById('account-profile-link');
  var storageKey = 'xhs-pending-account-v1';
  var parsed = null;
  var duplicate = null;

  function showPending(pending) {
    var banner = document.getElementById('account-pending');
    var completed = pending && findMonitoredAccount(pending.userId);
    // 分享短链尚无 UID：只认提交后新增、昵称唯一且已有验证数据的账号。
    if (pending && !pending.userId && Array.isArray(pending.knownSourceIds)) {
      var matches = XHS_SOURCES.filter(function(src) {
        return pending.knownSourceIds.indexOf(src.id) === -1 && src.label === pending.nickname
          && monitoredAccountDetails(src.id);
      });
      completed = matches.length === 1;
    }
    if (!pending || completed) {
      banner.hidden = true;
      if (pending) {
        try { localStorage.removeItem(storageKey); } catch (error) { /* 存储不可用不影响添加 */ }
      }
      return;
    }
    document.getElementById('account-pending-text').textContent = '“' + pending.nickname + '” 尚未确认结果，发布完成后会自动更新账号列表。';
    document.getElementById('account-progress-link').href = accountProgressUrl(pending.nickname);
    banner.hidden = false;
  }

  function update(showErrors) {
    var errorMessage = '';
    var nickname = '';
    parsed = null;
    duplicate = null;
    try { parsed = parseAccountInput(homepage.value); }
    catch (error) { if (homepage.value.trim() || showErrors) errorMessage = error.message; }
    homepage.setAttribute('aria-invalid', homepage.value.trim() && !parsed ? 'true' : 'false');
    try { nickname = validateAccountNickname(nicknameInput.value); }
    catch (error) { if (!errorMessage && (nicknameInput.value || showErrors)) errorMessage = error.message; }
    nicknameInput.setAttribute('aria-invalid', nicknameInput.value && !nickname ? 'true' : 'false');

    if (parsed) duplicate = findMonitoredAccount(parsed.userId);
    document.getElementById('account-review').hidden = !parsed;
    document.getElementById('account-duplicate').hidden = !duplicate;
    document.getElementById('account-confirm-label').hidden = !!duplicate;
    if (parsed) {
      profileLink.href = parsed.url;
      document.getElementById('account-profile-detail').textContent = parsed.isShortLink
        ? '这是分享短链。打开后请确认进入目标账号主页；提交后会再次核对。'
        : '请核对主页名称，并确认填写的昵称与主页一致。';
    } else {
      profileLink.removeAttribute('href');
    }
    if (duplicate) {
      document.getElementById('account-duplicate-text').textContent = '“' + duplicate.label + '” 已在监测，无需重复添加。';
      errorMessage = '';
    }
    document.getElementById('account-validation').textContent = errorMessage;
    var ready = parsed && nickname && confirmation.checked && !duplicate;
    submit.hidden = !!duplicate;
    submit.setAttribute('aria-disabled', ready ? 'false' : 'true');
    submit.tabIndex = ready ? 0 : -1;
    if (ready) submit.href = buildAccountIssueUrl(parsed.url, nickname);
    else submit.removeAttribute('href');
    return ready ? { userId: parsed.userId, nickname: nickname } : null;
  }

  function closeDialog() { dialog.close(); }
  trigger.addEventListener('click', function() {
    update(false);
    dialog.showModal();
    document.body.classList.add('account-modal-open');
    homepage.focus();
  });
  document.getElementById('empty-add-account-button').addEventListener('click', function() { trigger.click(); });
  document.getElementById('account-dialog-close').addEventListener('click', closeDialog);
  document.getElementById('account-cancel').addEventListener('click', closeDialog);
  dialog.addEventListener('close', function() {
    document.body.classList.remove('account-modal-open');
    trigger.focus();
  });
  [homepage, nicknameInput].forEach(function(input) {
    input.addEventListener('input', function() { confirmation.checked = false; update(false); });
  });
  confirmation.addEventListener('change', function() { update(false); });
  document.getElementById('account-switch').addEventListener('click', function() {
    if (!duplicate) return;
    document.getElementById('source-select').value = duplicate.id;
    loadSource(duplicate.id);
    closeDialog();
  });
  document.getElementById('account-form').addEventListener('submit', function(event) {
    event.preventDefault();
    if (update(true)) submit.click();
    else if (!parsed) homepage.focus();
    else if (!nicknameInput.value.trim()) nicknameInput.focus();
    else confirmation.focus();
  });
  submit.addEventListener('click', function(event) {
    var pending = update(true);
    if (!pending) { event.preventDefault(); return; }
    if (!pending.userId) pending.knownSourceIds = XHS_SOURCES.map(function(src) { return src.id; });
    // 仅保存待添加 UID 和昵称；打开预填页不代表请求已提交。
    try { localStorage.setItem(storageKey, JSON.stringify(pending)); } catch (error) { /* 可继续使用 */ }
    showPending(pending);
    closeDialog();
  });

  document.getElementById('account-pending-dismiss').addEventListener('click', function() {
    try { localStorage.removeItem(storageKey); } catch (error) { /* 仍可关闭当前提示 */ }
    document.getElementById('account-pending').hidden = true;
  });

  try {
    var pending = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (pending && (pending.userId === null || /^[a-f0-9]{24}$/.test(pending.userId))) {
      pending.nickname = validateAccountNickname(pending.nickname);
      showPending(pending);
    }
  } catch (error) { /* 忽略过期或不可用的本地草稿 */ }
  accountSourceListeners.push(function() {
    try { showPending(JSON.parse(localStorage.getItem(storageKey) || 'null')); }
    catch (error) { /* 存储不可用不影响账号列表 */ }
    if (dialog.open) update(false);
  });
})();

// ─── 移除监测账号：固定核对对象，打开申请不会改变当前列表 ───
(function initRemoveAccountManager() {
  var dialog = document.getElementById('remove-account-dialog');
  var trigger = document.getElementById('remove-account-button');
  if (!dialog || !trigger) return;
  var confirmation = document.getElementById('remove-account-confirm');
  var submit = document.getElementById('remove-account-submit');
  var storageKey = 'xhs-pending-removal-v1';
  var removalAccount = null;

  function showPending(pending) {
    var banner = document.getElementById('remove-account-pending');
    if (!pending || !findMonitoredAccount(pending.userId)) {
      banner.hidden = true;
      if (pending) {
        try { localStorage.removeItem(storageKey); } catch (error) { /* 存储不可用不影响看板 */ }
      }
      return;
    }
    document.getElementById('remove-account-pending-text').textContent = '“' + pending.nickname + '” 的移除申请尚未确认结果。';
    document.getElementById('remove-account-progress-link').href = removeAccountProgressUrl(pending.nickname);
    banner.hidden = false;
  }

  function updateConfirmation() {
    var current = monitoredAccountDetails(currentSourceId);
    var sameAccount = removalAccount && current && removalAccount.sourceId === current.sourceId
      && removalAccount.userId === current.userId && removalAccount.nickname === current.nickname;
    var ready = !!(sameAccount && confirmation.checked);
    document.getElementById('remove-account-validation').textContent = sameAccount ? '' : '当前账号已变化，请关闭后重新确认。';
    submit.setAttribute('aria-disabled', ready ? 'false' : 'true');
    submit.tabIndex = ready ? 0 : -1;
    if (ready) submit.href = buildRemoveAccountIssueUrl(removalAccount.userId, removalAccount.nickname);
    else submit.removeAttribute('href');
    return ready;
  }

  function closeDialog() { dialog.close(); }
  trigger.addEventListener('click', function() {
    removalAccount = monitoredAccountDetails(currentSourceId);
    if (!removalAccount) { updateRemovalAvailability(); return; }
    dialog.dataset.sourceId = removalAccount.sourceId;
    document.getElementById('remove-account-name').textContent = removalAccount.nickname;
    var currentName = document.getElementById('remove-account-current-name');
    currentName.hidden = !removalAccount.currentNickname || removalAccount.currentNickname === removalAccount.nickname;
    currentName.textContent = currentName.hidden ? '' : '当前主页昵称：' + removalAccount.currentNickname;
    document.getElementById('remove-account-profile').href = removalAccount.profileUrl;
    document.getElementById('remove-account-homepage').textContent = removalAccount.profileUrl;
    document.getElementById('remove-account-collected-at').textContent = document.getElementById('data-freshness').textContent;
    document.getElementById('remove-account-confirm-text').textContent = '我确认移除“' + removalAccount.nickname + '”这一个账号';
    confirmation.checked = false;
    updateConfirmation();
    dialog.showModal();
    document.body.classList.add('account-modal-open');
    document.getElementById('remove-account-cancel').focus();
  });
  confirmation.addEventListener('change', updateConfirmation);
  document.getElementById('remove-account-dialog-close').addEventListener('click', closeDialog);
  document.getElementById('remove-account-cancel').addEventListener('click', closeDialog);
  dialog.addEventListener('close', function() {
    document.body.classList.remove('account-modal-open');
    (trigger.disabled ? document.getElementById('add-account-button') : trigger).focus();
  });
  submit.addEventListener('click', function(event) {
    if (!updateConfirmation()) { event.preventDefault(); return; }
    var pending = { userId: removalAccount.userId, nickname: removalAccount.nickname };
    try { localStorage.setItem(storageKey, JSON.stringify(pending)); } catch (error) { /* 可继续使用 */ }
    showPending(pending);
    closeDialog();
  });
  document.getElementById('remove-account-pending-dismiss').addEventListener('click', function() {
    try { localStorage.removeItem(storageKey); } catch (error) { /* 仍可关闭当前提示 */ }
    document.getElementById('remove-account-pending').hidden = true;
  });

  try {
    var pending = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (pending && typeof pending.userId === 'string' && /^[a-f0-9]{24}$/.test(pending.userId)) {
      showPending({ userId: pending.userId, nickname: validateAccountNickname(pending.nickname) });
    }
  } catch (error) { /* 忽略过期或不可用的本地草稿 */ }
  accountSourceListeners.push(function() {
    try { showPending(JSON.parse(localStorage.getItem(storageKey) || 'null')); }
    catch (error) { /* 存储不可用不影响账号列表 */ }
    if (dialog.open) updateConfirmation();
  });
})();

// 已打开的页面也会同步发布结果；只请求静态文件，不触发采集或修改账号。
(function initAccountSourceSync() {
  var inFlight = false;
  var sequence = 0;
  var pendingStatusIds = new Set();

  function freshUrl(path) {
    return path + '?sync=' + Date.now() + '-' + (++sequence);
  }

  function fetchFresh(path, read) {
    var controller = new AbortController();
    var timer = setTimeout(function() { controller.abort(); }, 10000);
    return fetch(freshUrl(path), { cache: 'no-store', signal: controller.signal })
      .then(function(response) {
        if (!response.ok) throw new Error('发布文件暂不可用');
        return response[read]();
      }).finally(function() { clearTimeout(timer); });
  }

  function parseRegistry(text) {
    // 注册表由 add_account.py 生成 JSON；只解析数据，绝不 eval 远端文本。
    var match = text.match(/^\s*var\s+XHS_SOURCES\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
    if (!match) throw new Error('账号列表格式异常');
    var sources = JSON.parse(match[1]);
    var ids = new Set(), variables = new Set();
    sources.forEach(function(src) {
      if (!src || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(src.id) || typeof src.label !== 'string'
          || !/^[A-Za-z_][A-Za-z0-9_]*_DATA$/.test(src.dataVar)
          || src.metaVar !== src.dataVar.replace(/_DATA$/, '_META')
          || ids.has(src.id) || variables.has(src.dataVar)) throw new Error('账号列表内容异常');
      ids.add(src.id);
      variables.add(src.dataVar);
    });
    return sources;
  }

  function loadScript(path) {
    return new Promise(function(resolve, reject) {
      var script = document.createElement('script');
      var timer = setTimeout(function() { finish(new Error('账号数据加载超时')); }, 10000);
      function finish(error) {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        script.remove();
        if (error) reject(error); else resolve();
      }
      script.onload = function() { finish(); };
      script.onerror = function() { finish(new Error('账号数据尚未部署完成')); };
      script.src = freshUrl(path);
      document.head.appendChild(script);
    });
  }

  function isLoaded(src) {
    return Array.isArray(window[src.dataVar]) && window[src.metaVar]
      && Array.isArray(window[src.metaVar.replace(/_META$/, '_HISTORY')]);
  }

  function ensureLoaded(src) {
    if (isLoaded(src)) return Promise.resolve();
    pendingStatusIds.add(src.id);
    return Promise.all([
      loadScript('sources/' + src.id + '_data.js'),
      loadScript('sources/' + src.id + '_history.js')
    ]).then(function() {
      if (!isLoaded(src)) throw new Error('账号数据不完整');
    });
  }

  function applySources(sources) {
    var changed = JSON.stringify(sources) !== JSON.stringify(XHS_SOURCES);
    var current = sources.find(function(src) { return src.id === currentSourceId; });
    var needsRender = !current || allData !== window[current.dataVar] || currentMeta !== window[current.metaVar];
    // 等所有新账号数据加载完再替换列表，避免部署过程中出现空白账号。
    XHS_SOURCES = sources;
    if (changed) {
      var select = document.getElementById('source-select');
      select.innerHTML = '';
      sources.forEach(function(src) {
        var option = document.createElement('option');
        option.value = src.id;
        option.textContent = src.label;
        select.appendChild(option);
      });
      select.disabled = !sources.length;
      select.value = current ? current.id : (sources[0] ? sources[0].id : '');
    }
    if (needsRender) {
      if (sources.length) loadSource(current ? current.id : sources[0].id);
      else renderEmptyDashboard();
    }
    accountSourceListeners.forEach(function(listener) { listener(); });
  }

  function check() {
    if (inFlight || document.hidden) return;
    inFlight = true;
    fetchFresh('sources/registry.js', 'text')
      .then(parseRegistry)
      .then(function(sources) {
        return Promise.all(sources.map(ensureLoaded)).then(function() { applySources(sources); });
      })
      .then(function() {
        if (!pendingStatusIds.size) return;
        return fetchFresh('sources/refresh_status.json', 'json').then(function(status) {
          if (!status || !status.accounts) return;
          if (!refreshStatus) refreshStatus = { accounts: {} };
          // 只更新刚加载的数据对应的时间，不能把旧账号数据标成最新采集。
          pendingStatusIds.forEach(function(id) {
            if (status.accounts[id]) {
              refreshStatus.accounts[id] = status.accounts[id];
              pendingStatusIds.delete(id);
            }
          });
          renderDataFreshness(currentSourceId);
          renderAnalysis();
          renderTagPanel(currentMeta);
        });
      })
      .catch(function() { /* 网络或部署暂未就绪：保留现有内容，下一次检查重试。 */ })
      .finally(function() { inFlight = false; });
  }

  window.addEventListener('focus', check);
  window.addEventListener('pageshow', check);
  window.addEventListener('online', check);
  window.addEventListener('storage', function(event) {
    if (event.key === 'xhs-pending-account-v1' || event.key === 'xhs-pending-removal-v1') check();
  });
  document.addEventListener('visibilitychange', check);
  setInterval(check, 15000);
  check();
})();
