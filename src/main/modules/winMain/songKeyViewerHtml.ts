/**
 * 独立基调窗口的 HTML 内容生成器。
 * 包含完整的交互逻辑、样式与主题变量注入支持。
 */
export const getSongKeyViewerHtml = (): string => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>歌曲基调设置</title>
  <style id="injectedThemeStyle"></style>
  <style>
    :root {
      --color-primary: #336e7b;
      --color-primary-alpha-900: rgba(51, 110, 123, 0.1);
      --color-primary-alpha-400: rgba(51, 110, 123, 0.6);
      --color-primary-light-900-alpha-200: rgba(228, 236, 237, 0.8);
      --color-primary-light-900-alpha-300: rgba(228, 236, 237, 0.7);
      --color-primary-light-800-alpha-300: rgba(221, 231, 233, 0.7);
      --color-primary-light-800-alpha-400: rgba(221, 231, 233, 0.6);
      --color-primary-light-800-alpha-500: rgba(221, 231, 233, 0.5);
      --color-content-background: #ffffff;
      --color-main-background: #f4f7f9;
      --color-font: #222222;
      --color-font-label: #888888;
      --color-btn-close: #fab4a0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      user-select: none;
    }
    body {
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", sans-serif;
      background-color: var(--color-content-background);
      color: var(--color-font);
      display: flex;
      flex-direction: column;
    }
    .titlebar {
      -webkit-app-region: drag;
      height: 38px;
      flex: none;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      background-color: var(--color-main-background);
      border-bottom: 1px solid var(--color-primary-light-900-alpha-300);
    }
    .titlebar-title {
      font-size: 13px;
      font-weight: bold;
      color: var(--color-font);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .titlebar-actions {
      -webkit-app-region: no-drag;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .action-btn {
      border: none;
      background: transparent;
      width: 26px;
      height: 26px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      color: var(--color-font-label);
      transition: all .15s;
    }
    .action-btn:hover {
      background-color: var(--color-primary-light-800-alpha-300);
      color: var(--color-primary);
    }
    .action-btn.active {
      color: var(--color-primary);
      background-color: var(--color-primary-light-900-alpha-300);
    }
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 12px 18px;
    }
    .song-info {
      margin-bottom: 8px;
    }
    .song-name {
      font-size: 14px;
      font-weight: bold;
      color: var(--color-font);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .song-singer {
      font-size: 12px;
      color: var(--color-font-label);
      margin-top: 2px;
    }
    .badge-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      font-size: 12px;
      line-height: 1;
    }
    .current-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      color: var(--color-primary);
      background-color: var(--color-primary-light-900-alpha-200);
      border: 1px solid var(--color-primary-alpha-400);
      line-height: 1;
    }
    .source-tag {
      font-size: 10px;
      padding: 1px 5px;
      border-radius: 2px;
      font-weight: normal;
      background: var(--color-primary-alpha-900);
      line-height: 1.3;
      display: inline-flex;
      align-items: center;
    }
    .speed-note {
      margin: 6px 0 10px;
      font-size: 11px;
      line-height: 1.5;
      color: var(--color-font-label);
      background-color: var(--color-primary-light-900-alpha-200);
      border-radius: 4px;
      padding: 6px 8px;
    }
    .mode-switch {
      display: flex;
      gap: 6px;
      margin-bottom: 10px;
      padding: 3px;
      border-radius: 5px;
      background-color: var(--color-primary-light-900-alpha-300);
    }
    .mode-btn {
      flex: 1;
      height: 26px;
      border: none;
      border-radius: 4px;
      font-size: 12px;
      color: var(--color-font-label);
      background-color: transparent;
      cursor: pointer;
      transition: all .15s ease;
    }
    .mode-btn.active {
      color: var(--color-primary);
      background-color: var(--color-content-background);
      box-shadow: 0 1px 2px rgba(0,0,0,.12);
      font-weight: bold;
    }
    .section-label {
      font-size: 12px;
      color: var(--color-font-label);
      margin-bottom: 6px;
    }
    .segment-list {
      max-height: 110px;
      overflow-y: auto;
      border-radius: 5px;
      background-color: var(--color-primary-light-900-alpha-300);
      margin-bottom: 6px;
    }
    .segment-row {
      display: flex;
      align-items: center;
      height: 28px;
      padding: 0 8px;
      font-size: 12px;
      cursor: pointer;
      border-left: 2px solid transparent;
      transition: background-color .15s ease;
    }
    .segment-row:hover {
      background-color: var(--color-primary-light-800-alpha-300);
    }
    .segment-row.active {
      border-left-color: var(--color-primary);
      background-color: var(--color-primary-light-800-alpha-400);
      color: var(--color-primary);
    }
    .segment-row.playing:not(.active) {
      background-color: var(--color-primary-light-900-alpha-200);
      border-left-color: var(--color-primary-alpha-400);
    }
    .playing-indicator {
      font-size: 9px;
      color: var(--color-primary);
      margin-right: 4px;
      flex: none;
    }
    .segment-time {
      width: 48px;
      flex: none;
      font-variant-numeric: tabular-nums;
      color: var(--color-font-label);
    }
    .segment-row.active .segment-time {
      color: var(--color-primary);
      font-weight: bold;
    }
    .segment-time-input {
      width: 48px;
      flex: none;
      height: 20px;
      padding: 0 4px;
      border: 1px solid var(--color-primary);
      border-radius: 3px;
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      color: var(--color-font);
      background-color: var(--color-content-background);
      outline: none;
    }
    .segment-key {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .segment-remove {
      flex: none;
      width: 20px;
      height: 20px;
      border: none;
      border-radius: 3px;
      font-size: 14px;
      color: var(--color-font-label);
      background-color: transparent;
      cursor: pointer;
    }
    .segment-remove:hover {
      color: var(--color-btn-close);
      background-color: var(--color-primary-light-800-alpha-500);
    }
    .small-btn {
      padding: 3px 10px;
      border: 1px dashed var(--color-primary-alpha-400);
      border-radius: 4px;
      font-size: 11px;
      color: var(--color-primary);
      background-color: transparent;
      cursor: pointer;
      transition: all .15s ease;
      margin-bottom: 8px;
    }
    .small-btn:hover:not(:disabled) {
      background-color: var(--color-primary-light-800-alpha-300);
    }
    .small-btn:disabled {
      cursor: default;
      color: var(--color-font-label);
      border-color: var(--color-primary-light-200-alpha-500);
      opacity: .75;
    }
    .note-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 5px;
      margin-bottom: 10px;
    }
    .note-btn {
      height: 28px;
      border: 1px solid var(--color-primary-light-900-alpha-300);
      border-radius: 4px;
      background-color: var(--color-main-background);
      color: var(--color-font);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all .15s ease;
    }
    .note-btn:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }
    .note-btn.active {
      background-color: var(--color-primary);
      border-color: var(--color-primary);
      color: #fff;
      font-weight: bold;
    }
    .scale-row {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
    }
    .scale-btn {
      flex: 1;
      height: 28px;
      border: 1px solid var(--color-primary-light-900-alpha-300);
      border-radius: 4px;
      background-color: var(--color-main-background);
      color: var(--color-font);
      font-size: 12px;
      cursor: pointer;
      transition: all .15s ease;
    }
    .scale-btn:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }
    .scale-btn.active {
      background-color: var(--color-primary);
      border-color: var(--color-primary);
      color: #fff;
      font-weight: bold;
    }
    .footer {
      flex: none;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 12px 20px;
      background-color: var(--color-content-background);
      border-top: 1px solid var(--color-primary-light-900-alpha-300);
    }
    .btn {
      padding: 6px 14px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      border: none;
      transition: all .15s ease;
    }
    .btn-primary {
      background-color: var(--color-primary);
      color: #fff;
      font-weight: bold;
    }
    .btn-primary:hover {
      opacity: .9;
    }
    .btn-secondary {
      background-color: var(--color-primary-light-900-alpha-300);
      color: var(--color-font);
    }
    .btn-secondary:hover {
      background-color: var(--color-primary-light-800-alpha-300);
    }
    .analyzing-box {
      padding: 8px 10px;
      border-radius: 4px;
      font-size: 12px;
      color: var(--color-primary);
      background-color: var(--color-primary-light-800-alpha-300);
      margin-bottom: 12px;
    }
  </style>
</head>
<body>
  <div class="titlebar">
    <div class="titlebar-title">
      <span>🎵</span>
      <span>歌曲基调</span>
    </div>
    <div class="titlebar-actions">
      <button type="button" class="action-btn" id="pinBtn" title="置顶窗口">📌</button>
      <button type="button" class="action-btn" id="closeBtn" title="关闭">✕</button>
    </div>
  </div>

  <div class="content">
    <div class="song-info">
      <div class="song-name" id="songName">等待播放…</div>
      <div class="song-singer" id="songSinger"></div>
    </div>

    <div class="badge-row">
      <span>当前基调：</span>
      <span class="current-badge" id="currentBadge">
        <span id="keyLabel">未识别</span>
        <span class="source-tag" id="sourceTag">无</span>
      </span>
    </div>

    <div id="analyzingBox" class="analyzing-box" style="display:none;">
      正在分析这首歌的基调，结果出来后会自动更新…
    </div>

    <div class="mode-switch">
      <button type="button" class="mode-btn active" id="modeWhole">整首统一</button>
      <button type="button" class="mode-btn" id="modeSegments">分段设置</button>
    </div>

    <div id="segmentSection" style="display:none;">
      <div class="section-label">时间段（点选后改调，双击时间可改时刻）：</div>
      <div class="segment-list" id="segmentList"></div>
      <button type="button" class="small-btn" id="addSegBtn">＋ 在当前位置 0:00 新增一段</button>
    </div>

    <div class="section-label" id="noteGridLabel">选择主音 (Key)：</div>
    <div class="note-grid" id="noteGrid"></div>

    <div class="section-label" id="scaleRowLabel">选择调式 (Scale)：</div>
    <div class="scale-row">
      <button type="button" class="scale-btn active" id="scaleMajor">大调 (Major / 1=X)</button>
      <button type="button" class="scale-btn" id="scaleMinor">小调 (Minor / 6=X)</button>
    </div>

    <div class="section-label" style="display:flex; justify-content:space-between; align-items:center; margin-top:14px;">
      <span>电音深度 / 速度 (Retune Speed)：</span>
      <span id="speedVal" style="font-weight:bold; color:var(--color-primary); font-variant-numeric:tabular-nums;">20</span>
    </div>
    <div id="speedNote" class="speed-note" style="display:none;">
      macOS 上宿主不允许外部程序直接改插件参数，此值需在机架里设定一次后固定（基调与转调仍全自动跟播）。
    </div>
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:14px;">
      <input type="range" id="speedSlider" min="0" max="100" step="1" value="20" style="width:100%; height:4px; accent-color:var(--color-primary); cursor:pointer;" title="0为最硬电音瞬吸附，20为流行微调(默认推荐)，50~100为自然慢速" />
      <div style="display:flex; gap:6px;">
        <button type="button" class="quick-speed-btn" data-speed="0" style="flex:1; padding:3px 0; font-size:11px; border:1px solid var(--color-primary-light-800-alpha-400); background:transparent; color:var(--color-font-label); border-radius:3px; cursor:pointer;">0 强电音</button>
        <button type="button" class="quick-speed-btn active" data-speed="20" style="flex:1; padding:3px 0; font-size:11px; border:1px solid var(--color-primary); background:var(--color-primary); color:#fff; border-radius:3px; cursor:pointer; font-weight:bold;">20 流行</button>
        <button type="button" class="quick-speed-btn" data-speed="50" style="flex:1; padding:3px 0; font-size:11px; border:1px solid var(--color-primary-light-800-alpha-400); background:transparent; color:var(--color-font-label); border-radius:3px; cursor:pointer;">50 自然</button>
      </div>
    </div>
  </div>

  <div class="footer">
    <div style="flex: 1; display: flex; align-items: center;">
      <label style="display:inline-flex; align-items:center; gap:6px; font-size:11px; cursor:pointer; color:var(--color-font-label);" title="全局设置：开启后对所有歌曲生效，任何正在播放或切换的歌曲，其调性与实时转调都会自动同步给系统内挂载的 Auto-Tune 电音插件">
        <input type="checkbox" id="syncPluginCheck" style="cursor:pointer;" />
        <span>全局同步机架 (Auto-Tune)</span>
      </label>
    </div>
    <button type="button" class="btn btn-secondary" id="reanalyzeBtn">重新分析</button>
    <button type="button" class="btn btn-secondary" id="resetBtn" style="display:none;">恢复自动识别</button>
    <button type="button" class="btn btn-primary" id="saveBtn">保存并应用</button>
  </div>

  <script>
    const electron = typeof require !== 'undefined' ? require('electron') : null;
    const ipcRenderer = electron ? electron.ipcRenderer : null;

    const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const NOTE_LABELS = {
      'C': 'C', 'C#': 'C#/Db', 'D': 'D', 'D#': 'D#/Eb',
      'E': 'E', 'F': 'F', 'F#': 'F#/Gb', 'G': 'G',
      'G#': 'G#/Ab', 'A': 'A', 'A#': 'A#/Bb', 'B': 'B'
    };

    let isPinned = true;
    let mode = 'whole';
    let selectedKey = 'C';
    let selectedScale = 'major';
    let segments = [{ at: 0, key: 'C', scale: 'major' }];
    let selectedSegmentIndex = 0;
    let editingSegmentIndex = -1;
    let touched = false;
    let userSelectedSegment = false;
    let currentData = null;
    let currentSongId = '';

    function sendInstantAudition() {
      if (ipcRenderer) {
        ipcRenderer.send('song_key_window_instant_audition', {
          key: selectedKey,
          scale: selectedScale,
          label: formatKeyLabel(selectedKey, selectedScale)
        });
      }
    }

    function applyThemeCss(css) {
      if (!css) return;
      let el = document.getElementById('injectedThemeStyle');
      if (el) el.textContent = css;
    }

    function formatTime(sec) {
      const s = Math.max(0, Math.floor(sec || 0));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    function parseTime(str) {
      const t = String(str || '').trim();
      const m = /^(\\d+):([0-5]?\\d)$/.exec(t);
      if (m) return Number(m[1]) * 60 + Number(m[2]);
      const plain = /^(\\d+)$/.exec(t);
      if (plain) return Number(plain[1]);
      return null;
    }

    function formatKeyLabel(key, scale) {
      return scale === 'minor' ? (key + 'm 小调') : ('1=' + key + ' 大调');
    }

    // 初始化音名按钮
    const noteGrid = document.getElementById('noteGrid');
    NOTES.forEach(note => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'note-btn' + (note === selectedKey ? ' active' : '');
      btn.textContent = NOTE_LABELS[note];
      btn.onclick = () => {
        touched = true;
        selectedKey = note;
        updateNoteSelection();
        if (mode === 'segments' && segments[selectedSegmentIndex]) {
          segments[selectedSegmentIndex].key = note;
          renderSegments();
        }
        sendInstantAudition();
      };
      noteGrid.appendChild(btn);
    });

    function updateNoteSelection() {
      const buttons = noteGrid.querySelectorAll('.note-btn');
      NOTES.forEach((n, idx) => {
        buttons[idx].classList.toggle('active', n === selectedKey);
      });
      document.getElementById('scaleMajor').classList.toggle('active', selectedScale === 'major');
      document.getElementById('scaleMinor').classList.toggle('active', selectedScale === 'minor');
    }

    document.getElementById('scaleMajor').onclick = () => {
      touched = true;
      selectedScale = 'major';
      updateNoteSelection();
      if (mode === 'segments' && segments[selectedSegmentIndex]) {
        segments[selectedSegmentIndex].scale = 'major';
        renderSegments();
      }
      sendInstantAudition();
    };

    document.getElementById('scaleMinor').onclick = () => {
      touched = true;
      selectedScale = 'minor';
      updateNoteSelection();
      if (mode === 'segments' && segments[selectedSegmentIndex]) {
        segments[selectedSegmentIndex].scale = 'minor';
        renderSegments();
      }
      sendInstantAudition();
    };

    function switchMode(newMode) {
      touched = true;
      mode = newMode;
      document.getElementById('modeWhole').classList.toggle('active', mode === 'whole');
      document.getElementById('modeSegments').classList.toggle('active', mode === 'segments');
      document.getElementById('segmentSection').style.display = mode === 'segments' ? 'block' : 'none';
      document.getElementById('noteGridLabel').textContent = mode === 'whole' ? '选择主音 (Key)：' : ('第 ' + (selectedSegmentIndex + 1) + ' 段主音：');
      document.getElementById('scaleRowLabel').textContent = mode === 'whole' ? '选择调式 (Scale)：' : ('第 ' + (selectedSegmentIndex + 1) + ' 段调式：');
      if (mode === 'segments' && segments[selectedSegmentIndex]) {
        selectedKey = segments[selectedSegmentIndex].key;
        selectedScale = segments[selectedSegmentIndex].scale;
        updateNoteSelection();
        renderSegments();
      }
    }

    document.getElementById('modeWhole').onclick = () => switchMode('whole');
    document.getElementById('modeSegments').onclick = () => switchMode('segments');

    function renderSegments() {
      const listEl = document.getElementById('segmentList');
      listEl.innerHTML = '';
      const curPos = currentData ? Math.floor(currentData.playbackSeconds || 0) : 0;
      let curPlayingIdx = 0;
      for (let i = 0; i < segments.length; i++) {
        if (segments[i].at <= curPos) curPlayingIdx = i;
        else break;
      }

      segments.forEach((seg, idx) => {
        const isPlaying = idx === curPlayingIdx;
        const row = document.createElement('div');
        row.className = 'segment-row' + (idx === selectedSegmentIndex ? ' active' : '') + (isPlaying ? ' playing' : '');
        row.onclick = () => {
          userSelectedSegment = true;
          selectedSegmentIndex = idx;
          selectedKey = seg.key;
          selectedScale = seg.scale;
          updateNoteSelection();
          renderSegments();
          document.getElementById('noteGridLabel').textContent = '第 ' + (idx + 1) + ' 段主音：';
          document.getElementById('scaleRowLabel').textContent = '第 ' + (idx + 1) + ' 段调式：';
          sendInstantAudition();
        };

        if (isPlaying) {
          const dot = document.createElement('span');
          dot.className = 'playing-indicator';
          dot.textContent = '▶';
          dot.title = '当前播放进度';
          row.appendChild(dot);
        }

        if (editingSegmentIndex === idx) {
          const input = document.createElement('input');
          input.className = 'segment-time-input';
          input.value = formatTime(seg.at);
          input.onclick = (e) => e.stopPropagation();
          input.onkeydown = (e) => {
            if (e.key === 'Enter') {
              const parsed = parseTime(input.value);
              if (parsed != null) {
                seg.at = idx === 0 ? 0 : parsed;
                segments.sort((a, b) => a.at - b.at);
              }
              editingSegmentIndex = -1;
              renderSegments();
            } else if (e.key === 'Escape') {
              editingSegmentIndex = -1;
              renderSegments();
            }
          };
          input.onblur = () => {
            const parsed = parseTime(input.value);
            if (parsed != null) {
              seg.at = idx === 0 ? 0 : parsed;
              segments.sort((a, b) => a.at - b.at);
            }
            editingSegmentIndex = -1;
            renderSegments();
          };
          row.appendChild(input);
          setTimeout(() => { input.focus(); input.select(); }, 50);
        } else {
          const timeSpan = document.createElement('span');
          timeSpan.className = 'segment-time';
          timeSpan.textContent = formatTime(seg.at);
          row.appendChild(timeSpan);
        }

        row.ondblclick = (e) => {
          e.stopPropagation();
          touched = true;
          editingSegmentIndex = idx;
          renderSegments();
        };

        const keySpan = document.createElement('span');
        keySpan.className = 'segment-key';
        keySpan.textContent = formatKeyLabel(seg.key, seg.scale);
        row.appendChild(keySpan);

        if (segments.length > 1) {
          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'segment-remove';
          removeBtn.textContent = '×';
          removeBtn.title = '删除这一段';
          removeBtn.onclick = (e) => {
            e.stopPropagation();
            touched = true;
            segments.splice(idx, 1);
            if (segments.length) segments[0].at = 0;
            selectedSegmentIndex = Math.min(idx, segments.length - 1);
            renderSegments();
          };
          row.appendChild(removeBtn);
        }

        listEl.appendChild(row);
      });

      // 更新添加按钮状态
      const addBtn = document.getElementById('addSegBtn');
      const exists = segments.some(s => s.at === curPos);
      addBtn.disabled = exists;
      addBtn.textContent = exists ? ('当前位置 ' + formatTime(curPos) + ' 已是分段起点') : ('＋ 在当前位置 ' + formatTime(curPos) + ' 新增一段');
    }

    document.getElementById('addSegBtn').onclick = () => {
      touched = true;
      const curPos = currentData ? Math.floor(currentData.playbackSeconds || 0) : 0;
      if (segments.some(s => s.at === curPos)) return;
      segments.push({ at: curPos, key: selectedKey, scale: selectedScale });
      segments.sort((a, b) => a.at - b.at);
      selectedSegmentIndex = segments.findIndex(s => s.at === curPos);
      renderSegments();
    };

    document.getElementById('pinBtn').onclick = () => {
      isPinned = !isPinned;
      document.getElementById('pinBtn').classList.toggle('active', isPinned);
      if (ipcRenderer) ipcRenderer.send('song_key_window_pin_action', isPinned);
    };

    document.getElementById('closeBtn').onclick = () => {
      try {
        if (ipcRenderer) ipcRenderer.send('winMain_close_song_key_window');
      } catch (e) {}
      try {
        window.close();
      } catch (e) {}
    };

    document.getElementById('saveBtn').onclick = () => {
      if (!currentData || !currentData.name) return;
      if (ipcRenderer) {
        ipcRenderer.send('winMain_song_key_window_save_action', {
          name: currentData.name,
          singer: currentData.singer,
          mode,
          key: selectedKey,
          scale: selectedScale,
          segments: segments.map(s => ({ ...s }))
        });
      }
    };

    document.getElementById('reanalyzeBtn').onclick = () => {
      if (!currentData || !currentData.name) return;
      if (ipcRenderer) {
        ipcRenderer.send('winMain_song_key_window_reanalyze_action', {
          name: currentData.name,
          singer: currentData.singer
        });
      }
    };

    document.getElementById('resetBtn').onclick = () => {
      if (!currentData || !currentData.name) return;
      if (ipcRenderer) {
        ipcRenderer.send('winMain_song_key_window_reset_action', {
          name: currentData.name,
          singer: currentData.singer
        });
      }
    };

    document.getElementById('syncPluginCheck').onchange = function() {
      if (ipcRenderer) {
        ipcRenderer.send('winMain_song_key_window_toggle_plugin_sync', this.checked);
      }
    };

    function updateSpeedUi(speed) {
      document.getElementById('speedVal').textContent = String(speed);
      document.getElementById('speedSlider').value = String(speed);
      document.querySelectorAll('.quick-speed-btn').forEach(btn => {
        const s = Number(btn.getAttribute('data-speed'));
        const isActive = s === speed;
        btn.style.color = isActive ? '#fff' : 'var(--color-font-label)';
        btn.style.backgroundColor = isActive ? 'var(--color-primary)' : 'transparent';
        btn.style.borderColor = isActive ? 'var(--color-primary)' : 'var(--color-primary-light-800-alpha-400)';
        btn.style.fontWeight = isActive ? 'bold' : 'normal';
      });
    }

    document.getElementById('speedSlider').oninput = function() {
      const sp = Number(this.value);
      updateSpeedUi(sp);
      if (ipcRenderer) ipcRenderer.send('winMain_song_key_window_set_retune_speed', sp);
    };

    document.querySelectorAll('.quick-speed-btn').forEach(btn => {
      btn.onclick = function() {
        const sp = Number(this.getAttribute('data-speed'));
        updateSpeedUi(sp);
        if (ipcRenderer) ipcRenderer.send('winMain_song_key_window_set_retune_speed', sp);
      };
    });

    window.syncSongKeyData = function(data) {
      currentData = data;
      if (!data) return;
      if (data.themeCss) applyThemeCss(data.themeCss);

      const songId = (data.name || '') + '__' + (data.singer || '');
      const songChanged = Boolean(songId && songId !== currentSongId);
      if (songChanged) {
        currentSongId = songId;
        touched = false;
        userSelectedSegment = false;
        editingSegmentIndex = -1;
      }

      document.getElementById('songName').textContent = data.name || '等待播放…';
      document.getElementById('songSinger').textContent = data.singer ? ('- ' + data.singer) : '';

      const keyLabel = data.currentKey?.label || (data.isKeyAnalyzing ? '分析中…' : '未识别');
      document.getElementById('keyLabel').textContent = keyLabel;

      const sourceMap = { user: '已记忆', database: '经典谱库', analysis: '音频分析' };
      const source = data.songKeyInfo?.source;
      const sourceTag = document.getElementById('sourceTag');
      if (source && sourceMap[source]) {
        sourceTag.style.display = 'inline-block';
        sourceTag.textContent = sourceMap[source];
      } else {
        sourceTag.style.display = data.isKeyAnalyzing ? 'inline-block' : 'none';
        sourceTag.textContent = data.isKeyAnalyzing ? '分析中' : '';
      }

      document.getElementById('analyzingBox').style.display = (data.isKeyAnalyzing && !data.currentKey) ? 'block' : 'none';
      document.getElementById('resetBtn').style.display = (source === 'user') ? 'inline-block' : 'none';

      if (data.isPluginSyncEnabled !== undefined) {
        document.getElementById('syncPluginCheck').checked = Boolean(data.isPluginSyncEnabled);
      }

      if (typeof data.retuneSpeed === 'number') {
        updateSpeedUi(data.retuneSpeed);
      }
      if (data.retuneSpeedAuto !== undefined) {
        document.getElementById('speedNote').style.display = data.retuneSpeedAuto ? 'none' : 'block';
      }

      // 歌曲切换时初始灌入数据
      if (songChanged && data.songKeyInfo) {
        const info = data.songKeyInfo;
        selectedKey = info.key || 'C';
        selectedScale = info.scale || 'major';
        if (info.timeline && info.timeline.length) {
          segments = info.timeline.map(s => ({ at: s.at, key: s.key, scale: s.scale }));
          if (info.timeline.length > 1 && info.source !== 'user') {
            mode = 'segments';
            document.getElementById('modeWhole').classList.remove('active');
            document.getElementById('modeSegments').classList.add('active');
            document.getElementById('segmentSection').style.display = 'block';
          }
        } else {
          segments = [{ at: 0, key: selectedKey, scale: selectedScale }];
        }
        // 初始定位到当前播放段落
        const curPos = Math.floor(data.playbackSeconds || 0);
        let curIdx = 0;
        for (let i = 0; i < segments.length; i++) {
          if (segments[i].at <= curPos) curIdx = i;
          else break;
        }
        selectedSegmentIndex = curIdx;
        if (segments[curIdx]) {
          selectedKey = segments[curIdx].key;
          selectedScale = segments[curIdx].scale;
        }
        updateNoteSelection();
        renderSegments();
      } else if (songChanged && !data.songKeyInfo && !data.isKeyAnalyzing) {
        selectedKey = 'C';
        selectedScale = 'major';
        segments = [{ at: 0, key: 'C', scale: 'major' }];
        updateNoteSelection();
        renderSegments();
      } else {
        // 播放中进度刷新（每500ms）：焦点实时跟随播放进度动态切换
        if (!userSelectedSegment && !touched) {
          if (segments.length > 1) {
            const curPos = Math.floor(data.playbackSeconds || 0);
            let curIdx = 0;
            for (let i = 0; i < segments.length; i++) {
              if (segments[i].at <= curPos) curIdx = i;
              else break;
            }
            if (curIdx !== selectedSegmentIndex) {
              selectedSegmentIndex = curIdx;
              if (segments[curIdx]) {
                selectedKey = segments[curIdx].key;
                selectedScale = segments[curIdx].scale;
                updateNoteSelection();
              }
            }
          } else if (data.currentKey) {
            selectedKey = data.currentKey.key || selectedKey;
            selectedScale = data.currentKey.scale || selectedScale;
            updateNoteSelection();
          }
        }
        renderSegments();
      }
    };
  </script>
</body>
</html>`
