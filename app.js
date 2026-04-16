var allData = [];
var currentData = [];
var currentMeta = null;
var currentSourceId = null;
var chartTrend = null, chartStructure = null;
var currentSortKey = 'engage', currentSortBtn = null;

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
  loadSource(XHS_SOURCES[0].id);
})();

function loadSource(sourceId) {
  var src = XHS_SOURCES.find(function(s){ return s.id === sourceId; });
  if (!src) return;

  currentSourceId = sourceId;
  allData = window[src.dataVar];
  currentMeta = window[src.metaVar] || null;

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

  // 智能分析
  var analysisBody = document.getElementById('analysis-body');
  if (currentMeta && currentMeta.analysis) {
    analysisBody.textContent = currentMeta.analysis;
  } else {
    analysisBody.textContent = '暂无分析数据';
  }

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
    var sorted = data.slice().sort(function(a,b){ return a.date.localeCompare(b.date); });
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
      + '<td class="note-title">' + d.title + '</td>'
      + '<td class="num">' + fmt(d.likes) + '</td>'
      + '<td class="num">' + fmt(d.saves) + '</td>'
      + '<td class="num">' + fmt(d.comments) + '</td>'
      + '<td class="num">' + fmt(d.shares) + '</td>'
      + '<td class="num">' + (d.save_rate * 100).toFixed(1) + '%</td>'
      + '<td class="num">' + d.quality_index.toFixed(2) + '</td>'
      + '<td class="num ' + scoreColor + '">' + d.score + '</td>'
      + '<td style="color:#555">' + d.date + '</td>'
      + '</tr>';
  }).join('');
}

// ─── 区块 2：账号基础信息卡片渲染 ───────────────────────────────
function renderProfileInfoCard(meta, noteCount) {
  var container = document.getElementById('profile-info-card');
  if (!container) return;

  if (!meta || !meta.nickname) {
    container.innerHTML = '<p style="font-size:13px;color:#666;margin-bottom:16px">共 ' + noteCount + ' 篇笔记</p>';
    return;
  }

  var avatarChar = meta.nickname.charAt(0);
  var t = meta.profile_tags || {};

  var html = '<div class="profile-info-card">'
    + '<div class="profile-main">'
    + '<div class="profile-left">'
    + '<div class="avatar">' + avatarChar + '</div>'
    + '<div class="profile-info">'
    + '<h2>' + meta.nickname + '</h2>'
    + '<div class="profile-meta-row">';

  if (meta.xhs_id) html += '<span>小红书号 ' + meta.xhs_id + '</span>';
  if (meta.location) html += '<span>IP属地 ' + meta.location + '</span>';

  html += '</div>';

  if (meta.bio) html += '<div class="profile-bio">' + meta.bio + '</div>';

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
      + '<div class="profile-stat-num' + (s.accent ? ' accent' : '') + '">' + fmt(s.num) + '</div>'
      + '<div class="profile-stat-label">' + s.label + '</div>'
      + '</div>';
  });

  html += '</div></div>';  // close .profile-stats, .profile-main

  // 底部胶囊标签
  if (t.follower_tier || t.content_format) {
    html += '<div class="profile-badges">';
    if (t.follower_tier) {
      html += '<span class="pbadge pbadge-tier">🧑 ' + t.follower_tier;
      if (meta.followers !== undefined && meta.followers !== null) {
        if (meta.followers < 1000) html += ' <1k粉';
        else if (meta.followers < 10000) html += ' ' + fmt(meta.followers) + '粉';
        else html += ' ' + fmt(meta.followers) + '粉';
      }
      html += '</span>';
    }
    if (t.content_format) {
      html += '<span class="pbadge pbadge-format">📄 ' + t.content_format + '</span>';
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

function renderTagPanel(meta) {
  var container = document.getElementById('tag-panel');
  if (!container) return;

  if (!meta || !meta.profile_tags) {
    container.innerHTML = '';
    return;
  }

  var t = meta.profile_tags;

  // v1.0 降级显示
  if (!isV2Tags(t)) {
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

  var html = '<div class="tag-panel">'
    + '<div class="tag-panel-heading">🏷️ 账号画像标签 · 6 大维度 15 项指标</div>'
    + '<div class="tag-panel-sub">基于内容语义分析 + 量化指标自动生成的多维标签画像</div>'
    + '<div class="tag-grid">';

  TAG_CATEGORIES.forEach(function(cat) {
    var catData = t[cat.key];
    if (!catData || typeof catData !== 'object') return;

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
        if (val && val !== '未知' && val !== 'null') {
          html += '<span class="tag-pill">' + val + '</span>';
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

  // 打标时间
  html += '<div class="tag-footer">打标时间：' + (t.tagged_at || '未知') + ' · 由 GLM + 量化指标自动生成（v2.0）</div>';
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
          + def.icon + ' ' + def.label + '：' + val
          + '</span>';
  });

  html += '</div>';  // close .tag-v1-fallback
  html += '<div class="tag-footer">打标时间：' + (t.tagged_at || '未知') + ' · 由 GLM + 量化指标自动生成（v1.0）</div>';
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

  var ctx = document.getElementById('chart-growth');
  if (!ctx) return;

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

  // 只有一条数据时提示
  if (history.length === 1) {
    var singleInfo = series.map(function(s) {
      return s.label + ': ' + history[0][s.key];
    }).join('　');
    document.getElementById('growth-legend').innerHTML =
      '<div style="color:#555;font-size:12px;text-align:center;width:100%">当前仅有起点数据（' + history[0].date + '）· ' + singleInfo + '<br>每周刷新后将展示成长曲线</div>';
  } else {
    document.getElementById('growth-legend').innerHTML = '';
  }

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
