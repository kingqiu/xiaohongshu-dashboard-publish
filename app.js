var allData = [];
var currentData = [];
var currentMeta = null;
var chartTrend = null, chartStructure = null;
var currentSortKey = 'engage', currentSortBtn = null;

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

  allData = window[src.dataVar];
  currentMeta = window[src.metaVar] || null;

  // 重置周筛选
  currentData = allData;
  rebuildWeekButtons();

  // 重置排序
  currentSortKey = 'engage';
  currentSortBtn = null;

  // 销毁现有图表
  if (chartTrend) { chartTrend.destroy(); chartTrend = null; }
  if (chartStructure) { chartStructure.destroy(); chartStructure = null; }

  render();
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

  // 副标题
  var subtitleText = '共 ' + data.length + ' 篇笔记';
  if (currentMeta && currentMeta.nickname) {
    subtitleText = currentMeta.nickname + ' · ' + subtitleText;
    if (currentMeta.followers) {
      subtitleText += ' · 粉丝 ' + fmt(currentMeta.followers);
    }
  }
  document.getElementById('subtitle').textContent = subtitleText;

  // 智能分析
  var analysisBody = document.getElementById('analysis-body');
  if (currentMeta && currentMeta.analysis) {
    analysisBody.textContent = currentMeta.analysis;
  } else {
    analysisBody.textContent = '暂无分析数据';
  }

  // 账号画像标签
  renderProfileTags(currentMeta);

  // 图表1: 互动量趋势（堆叠柱状图）
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

  if (chartTrend) {
    chartTrend.data = trendData;
    chartTrend.update();
  } else {
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
  }

  // 图表2: 互动结构分布（饼图）
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

  if (chartStructure) {
    chartStructure.data = structureData;
    chartStructure.update();
  } else {
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
  }

  // 表格排序
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

// ─── 账号画像标签渲染 ─────────────────────────────────────────
function renderProfileTags(meta) {
  var card = document.getElementById('profile-card');
  var container = document.getElementById('profile-tags');
  var footer = document.getElementById('profile-footer');

  if (!meta || !meta.profile_tags) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';
  var t = meta.profile_tags;

  // 标签配置：[维度key, 显示名, css类前缀, emoji]
  var tagDefs = [
    { key: 'follower_tier',       label: '量级',   cls: 'tier-' + t.follower_tier,           icon: '👥' },
    { key: 'primary_vertical',    label: '主垂类', cls: 'vertical',                          icon: '📌' },
    { key: 'secondary_vertical',  label: '次垂类', cls: 'vertical',                          icon: '📎' },
    { key: 'content_style',       label: '风格',   cls: 'style',                             icon: '✍️' },
    { key: 'content_consistency', label: '垂直度', cls: 'consistency-' + t.content_consistency, icon: '🎯' },
    { key: 'engagement_quality',  label: '互动质量', cls: 'quality-' + t.engagement_quality,  icon: '⚡' },
    { key: 'content_format',      label: '形式',   cls: 'format',                            icon: '📄' },
    { key: 'commercial_stage',    label: '阶段',   cls: 'stage',                             icon: '📈' },
  ];

  var html = '';
  tagDefs.forEach(function(def) {
    var val = t[def.key];
    if (!val || val === '未知' || val === 'null') return;
    html += '<span class="tag-badge ' + def.cls + '">'
          + def.icon + ' ' + def.label + '：' + val
          + '</span>';
  });

  container.innerHTML = html;
  footer.textContent = '打标时间：' + (t.tagged_at || '未知') + '  ·  由 GLM + 量化指标自动生成';
}
