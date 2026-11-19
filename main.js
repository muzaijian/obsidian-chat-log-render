'use strict';

const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
  myName: '',
  showAvatar: true
};

const PALETTE = [
  '#5DCAA5', '#378ADD', '#BA7517', '#D4537E', '#7F77DD',
  '#D85A30', '#1D9E75', '#888780', '#B5545B', '#4A8FB5'
];

/* ---------- 时间/消息格式识别 ---------- */

const DATE_REQ = '(?:\\d{4}\\s*[年\\-/.]\\s*)?\\d{1,2}\\s*[月\\-/.]\\s*\\d{1,2}\\s*日?';
const TIME_CORE = '(?:上午|下午|凌晨|傍晚|晚上|中午)?\\s*\\d{1,2}[:：]\\d{2}(?:[:：]\\d{2})?';
const FULL_TIME = '(?:' + DATE_REQ + ')?\\s*' + TIME_CORE;

// 整行只有一个时间：2026年11月19日 9:31 / 11-19 9:31 / 9:31:24
const RE_PURE_TIME = new RegExp('^\\s*' + FULL_TIME + '\\s*$');
// 昵称 + 日期时间 同一行（PC 导出）：木仔建 2026/11/19 9:46:02（必须带日期，避免把正文「进度 9:31」误判）
const RE_NAME_TIME = new RegExp('^\\s*(\\S[^:：]{0,30}?)\\s+(' + DATE_REQ + '\\s*' + TIME_CORE + ')\\s*$');
// [时间] 昵称: 内容：[2026/11/19 9:46:02] 木仔建: 你好
const RE_BRACKET = new RegExp('^\\s*\\[\\s*(' + FULL_TIME + ')\\s*\\]\\s*([^:：]{1,30})[:：]\\s?(.*)$');
// 媒体消息：[图片] xxx.dat
const MEDIA_TYPES = '图片|文件|视频|语音|链接|动画表情|位置|名片|音乐|卡片|转账|红包|聊天记录|合并转发的聊天记录';
const RE_MEDIA = new RegExp('^\\s*\\[(' + MEDIA_TYPES + ')\\]\\s*(.*)$');

/* ---------- 解析：两遍扫描 ----------
 * 第一遍给每个非空行分类：
 *   title(#标题) / syssep(---) / sysline(>提示) / bracket([时间] 昵称: 内容)
 *   nametime(昵称 日期时间) / head(独立时间行=新消息头) / nick(短昵称行) / body(正文)
 * 昵称行识别：短、无冒号、无项目符号、非纯时间，且下一个非空行是纯时间行。
 * 纯时间行的二义性：物理上紧跟在正文后面（无空行隔开）时视为正文里的数据时间戳，
 * 否则视为新消息头。第二遍按分类消费，head 的发言人取 nick 行 / 继承上一条。 */

function isNickCandidate(line, nextIsTime) {
  const s = String(line || '').trim();
  if (!s) return false;
  const chars = Array.from(s);
  if (chars.length > 25) return false;
  if (RE_PURE_TIME.test(s) || RE_NAME_TIME.test(s) || RE_BRACKET.test(s)) return false;
  if (/[:：]/.test(s)) return false;
  if (/^[●○■□◆#>\-*—=·\[\(（【]/.test(s)) return false;
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(s)) return false;
  return nextIsTime;
}

function parseChat(raw) {
  const lines = String(raw || '').replace(/\r/g, '').split('\n');
  const messages = [];
  const kinds = new Array(lines.length).fill(null);
  let title = null;

  function nextNonEmpty(idx) {
    let j = idx + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    return j < lines.length ? j : -1;
  }

  function prevNonEmpty(idx) {
    let j = idx - 1;
    while (j >= 0 && !lines[j].trim()) j--;
    return j;
  }

  let first = true;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/\s+$/, '').trim();
    if (!t) continue;

    if (first && /^#{1,3}\s+\S/.test(t)) {
      kinds[i] = 'title';
      title = t.replace(/^#{1,3}\s+/, '');
      first = false;
      continue;
    }
    first = false;

    if (/^(-{3,}|={3,}|─{2,}|—{2,}|\*{3,})$/.test(t)) {
      kinds[i] = 'syssep';
      continue;
    }
    if (/^>\s?/.test(lines[i].replace(/\s+$/, ''))) {
      kinds[i] = 'sysline';
      continue;
    }
    if (RE_BRACKET.test(t)) {
      kinds[i] = 'bracket';
      continue;
    }
    if (RE_NAME_TIME.test(t)) {
      kinds[i] = 'nametime';
      continue;
    }
    if (RE_PURE_TIME.test(t)) {
      const physicallyAdjacentBody = i > 0 && lines[i - 1].trim() && kinds[i - 1] === 'body';
      kinds[i] = physicallyAdjacentBody ? 'body' : 'head';
      continue;
    }
    const nj = nextNonEmpty(i);
    const nextIsTime = nj >= 0 && RE_PURE_TIME.test(lines[nj].trim());
    kinds[i] = isNickCandidate(t, nextIsTime) ? 'nick' : 'body';
  }

  /* 第二遍：消费 */
  const HEAD_KINDS = ['title', 'sysline', 'syssep', 'bracket', 'nametime', 'head'];
  let cur = null;
  let lastSpeaker = null;

  function pushCur() {
    if (!cur) return;
    const content = cur.content.join('\n').trim();
    if (content.length) {
      messages.push({ speaker: cur.speaker, time: cur.time, content: content });
    }
    lastSpeaker = cur.speaker;
    cur = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\s+$/, '');
    const t = raw.trim();
    const kind = kinds[i];
    if (!t || kind === 'title' || kind === 'nick') continue;

    if (kind === 'syssep') {
      pushCur();
      messages.push({ system: true, text: '' });
      continue;
    }
    if (kind === 'sysline') {
      pushCur();
      messages.push({ system: true, text: t.replace(/^>\s?/, '') });
      continue;
    }
    if (kind === 'bracket') {
      pushCur();
      const m = t.match(RE_BRACKET);
      cur = { speaker: m[2].trim(), time: m[1].replace(/\s+/g, ' ').trim(), content: m[3] && m[3].trim() ? [m[3]] : [] };
      continue;
    }
    if (kind === 'nametime') {
      pushCur();
      const m = t.match(RE_NAME_TIME);
      cur = { speaker: m[1].trim(), time: m[2].replace(/\s+/g, ' ').trim(), content: [] };
      continue;
    }
    if (kind === 'head') {
      const q = prevNonEmpty(i);
      let speaker = null;
      if (q >= 0) {
        if (kinds[q] === 'nick') {
          speaker = lines[q].trim();
        } else if (kinds[q] === 'body') {
          // 上一非空行是正文：有进行中的消息→同人连续发言；没有→它是未消费的孤立昵称行
          speaker = cur ? cur.speaker : lines[q].trim();
        } else if (HEAD_KINDS.includes(kinds[q])) {
          speaker = cur ? cur.speaker : lastSpeaker;
        }
      }
      pushCur();
      cur = { speaker: speaker || '未知', time: t, content: [] };
      continue;
    }

    // body
    if (cur) {
      cur.content.push(raw);
    }
  }
  pushCur();
  return { title: title, messages: messages };
}

function looksLikeMedia(content) {
  const m = String(content).match(RE_MEDIA);
  if (!m) return null;
  return { type: m[1], name: (m[2] || '').trim() };
}

function extractDate(time) {
  const m = String(time).match(/(\d{4})?\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/);
  if (!m) return null;
  const year = m[1] || '';
  return (year ? year + '年' : '') + m[2] + '月' + m[3] + '日';
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function avatarColor(name) {
  return PALETTE[hashCode(name) % PALETTE.length];
}

function avatarChar(name) {
  const arr = Array.from(String(name).trim());
  return arr.length ? arr[0].toUpperCase() : '?';
}

/* ---------- 渲染 ---------- */

const ICONS = {
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5-6 6-2.5-2.5L3 18"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 13h6M9 17h6"/></svg>'
};

function mediaIcon(type) {
  if (type === '图片' || type === '动画表情' || type === '位置') return ICONS.image;
  return ICONS.file;
}

/* 气泡内的图片/嵌入语法识别：
 * ![](path) / ![alt](path)   — 标准 Markdown 图片
 * ![[name.png]]              — Obsidian 嵌入（可带 #数字 裁剪后缀）
 * 返回按出现顺序切分的段落数组：{type:'text',text} | {type:'img',src,alt} | {type:'embed',src} */
const RE_MD_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const RE_OBS_EMBED = /!\[\[([^\]|]+?)(?:\|\d+)?\]\]/g;

function splitImageSegments(content) {
  const s = String(content);
  const marks = [];
  let m;
  RE_MD_IMAGE.lastIndex = 0;
  while ((m = RE_MD_IMAGE.exec(s)) !== null) {
    marks.push({ start: m.index, end: m.index + m[0].length, kind: 'img', alt: m[1], src: m[2] });
  }
  RE_OBS_EMBED.lastIndex = 0;
  while ((m = RE_OBS_EMBED.exec(s)) !== null) {
    marks.push({ start: m.index, end: m.index + m[0].length, kind: 'embed', src: m[1].trim() });
  }
  if (!marks.length) return null;
  marks.sort((a, b) => a.start - b.start);
  const segments = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue; // 跳过重叠匹配
    if (mark.start > cursor) {
      const text = s.slice(cursor, mark.start).trim();
      if (text) segments.push({ type: 'text', text: text });
    }
    segments.push(mark.kind === 'img'
      ? { type: 'img', src: mark.src, alt: mark.alt }
      : { type: 'embed', src: mark.src });
    cursor = mark.end;
  }
  if (cursor < s.length) {
    const text = s.slice(cursor).trim();
    if (text) segments.push({ type: 'text', text: text });
  }
  return segments;
}

function renderChat(container, parsed, settings, app, ctx) {
  const chat = document.createElement('div');
  chat.addClass('wcr-chat');
  if (!settings.showAvatar) chat.addClass('wcr-no-avatar');

  if (parsed.title) {
    const t = document.createElement('div');
    t.addClass('wcr-title');
    t.textContent = parsed.title;
    chat.appendChild(t);
  }

  let lastDate = null;
  let firstMsg = true;

  for (const m of parsed.messages) {
    if (m.system) {
      const s = document.createElement('div');
      s.addClass('wcr-system');
      s.textContent = m.text || '─────────────────';
      chat.appendChild(s);
      continue;
    }

    const date = extractDate(m.time);
    if (date && (firstMsg || date !== lastDate)) {
      const d = document.createElement('div');
      d.addClass('wcr-time-divider');
      d.textContent = date;
      chat.appendChild(d);
      lastDate = date;
    }
    firstMsg = false;

    const isRight = settings.myName && m.speaker === settings.myName;

    const msg = document.createElement('div');
    msg.addClass('wcr-msg');
    if (isRight) msg.addClass('wcr-right');

    const avatar = document.createElement('div');
    avatar.addClass('wcr-avatar');
    avatar.style.backgroundColor = avatarColor(m.speaker);
    avatar.textContent = avatarChar(m.speaker);
    msg.appendChild(avatar);

    const body = document.createElement('div');
    body.addClass('wcr-body');

    const meta = document.createElement('div');
    meta.addClass('wcr-meta');
    const nameEl = document.createElement('span');
    nameEl.addClass('wcr-name');
    nameEl.textContent = m.speaker;
    const timeEl = document.createElement('span');
    timeEl.addClass('wcr-time');
    // 时间里已含日期时，日期部分由分隔线展示，气泡处只留时刻
    let showTime = m.time;
    if (date) {
      showTime = m.time.replace(/^.*日\s*/, '').trim() || m.time;
    }
    timeEl.textContent = showTime;
    meta.appendChild(nameEl);
    meta.appendChild(timeEl);
    body.appendChild(meta);

    const bubble = document.createElement('div');
    bubble.addClass('wcr-bubble');

    const media = looksLikeMedia(m.content);
    const segments = splitImageSegments(m.content);

    if (media && !(segments && segments.some(function (s) { return s.type !== 'text'; }))) {
      // 纯媒体占位行（[图片] xxx），且不含真实图片语法
      const mv = document.createElement('div');
      mv.addClass('wcr-media');
      const ic = document.createElement('span');
      ic.addClass('wcr-media-icon');
      ic.innerHTML = mediaIcon(media.type);
      mv.appendChild(ic);
      const label = document.createElement('span');
      label.addClass('wcr-media-label');
      label.textContent = media.name ? media.type + '：' + media.name : media.type;
      mv.appendChild(label);
      bubble.appendChild(mv);
      bubble.addClass('wcr-bubble-media');
    } else if (segments) {
      // 含 ![](...) 或 ![[...]]：按段落渲染，图片解析库内路径显示真图
      bubble.addClass('wcr-bubble-media');
      for (const seg of segments) {
        if (seg.type === 'text') {
          const p = document.createElement('div');
          p.textContent = seg.text;
          bubble.appendChild(p);
        } else {
          let src = seg.type === 'embed' ? seg.src : decodeURIComponent(seg.src);
          // Obsidian 嵌入的裁剪后缀（图片.png#500）不属于文件名，解析前去掉
          const lookupPath = src.split('#')[0].trim();
          const img = document.createElement('img');
          img.addClass('wcr-image');
          img.alt = seg.alt || '';
          let resolved = null;
          try {
            if (app) {
              // ① 按库内链接路径解析（附件/xxx.png 或纯文件名）
              let file = app.metadataCache.getFirstLinkpathDest(lookupPath, '');
              // ② 失败且像相对路径（../ 或 ./）→ 按代码块所在笔记解析相对路径
              if (!file && /^[.]{1,2}\//.test(lookupPath) && ctx && ctx.sourcePath) {
                const parts = lookupPath.split('/');
                const baseParts = ctx.sourcePath.split('/');
                baseParts.pop();
                for (const part of parts) {
                  if (part === '.') continue;
                  else if (part === '..') baseParts.pop();
                  else baseParts.push(part);
                }
                file = app.metadataCache.getFirstLinkpathDest(baseParts.join('/'), '');
              }
              // ③ 再退一步：仅按文件名全库匹配
              if (!file) {
                const fileName = lookupPath.split('/').pop();
                file = app.metadataCache.getFirstLinkpathDest(fileName, '');
              }
              if (file) resolved = app.vault.getResourcePath(file);
            }
          } catch (e) { /* 解析失败则回落到原始 src */ }
          img.src = resolved || src;
          bubble.appendChild(img);
        }
      }
    } else {
      bubble.textContent = m.content;
    }

    body.appendChild(bubble);
    msg.appendChild(body);
    chat.appendChild(msg);
  }

  container.appendChild(chat);
}

/* ---------- 插件主体 ---------- */

class WCRSettingTab extends obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const containerEl = this.containerEl;
    containerEl.empty();

    new obsidian.Setting(containerEl)
      .setName('靠右显示的昵称')
      .setDesc('填写聊天记录中代表「我」的昵称，该昵称的消息以绿色气泡靠右显示；留空则全部靠左。')
      .addText((text) => {
        text.setPlaceholder('例如：木仔建');
        text.setValue(this.plugin.settings.myName);
        text.onChange(async (value) => {
          this.plugin.settings.myName = value.trim();
          await this.plugin.saveSettings();
          this.app.workspace.trigger('wcr-refresh');
        });
      });

    new obsidian.Setting(containerEl)
      .setName('显示头像')
      .setDesc('关闭后消息只显示昵称和气泡，不渲染头像块。')
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showAvatar);
        toggle.onChange(async (value) => {
          this.plugin.settings.showAvatar = value;
          await this.plugin.saveSettings();
        });
      });
  }
}

class WCRPlugin extends obsidian.Plugin {
  async onload() {
    await this.loadSettings();

    const processor = (source, el, ctx) => {
      renderChat(el, parseChat(source), this.settings, this.app, ctx);
    };
    for (const lang of ['chat', 'chatlog', 'wechat', '微信']) {
      this.registerMarkdownCodeBlockProcessor(lang, processor);
    }

    this.addSettingTab(new WCRSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

module.exports = WCRPlugin;
