const byId = id => document.getElementById(id);
const root = document.documentElement;
const terminal = byId('terminal');
const messages = byId('messages');
const actions = byId('terminal-actions');
const hint = byId('terminal-hint');
const closing = byId('closing');
const soundButton = byId('sound');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const booking = byId('booking');
const checkIn = byId('check-in');
const checkOut = byId('check-out');
const bookingResult = byId('booking-result');

const timers = new Set();
let stage = 0;
let busy = false;
let playerReply = '';
let closingPhase = 0;
let furthest = 0;
let chapter = -1;
let tone = 0;
let lastPaint = -1;
let raf = 0;
let audio = null;
let soundRequested = false;
let soundOn = false;

function write(id, value) {
  if (value !== undefined) byId(id).textContent = value;
}

function after(ms, run) {
  const timer = setTimeout(() => {
    timers.delete(timer);
    run();
  }, ms);
  timers.add(timer);
}

function append(source, text, echo = false) {
  const nearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 48;
  const line = document.createElement('p');
  const prefix = document.createElement('span');
  line.className = 'message';
  if (echo) line.dataset.kind = 'echo';
  prefix.textContent = source;
  line.append(prefix, ` ${text}`);
  messages.append(line);
  if (nearBottom) messages.scrollTop = messages.scrollHeight;
}

function choices(...options) {
  actions.replaceChildren(...options.map(([id, label], index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `button ${index === 0 ? 'button-fill' : 'button-line'}`;
    button.dataset.action = id;
    button.textContent = label;
    return button;
  }));
}

function sequence(frames, finish) {
  busy = true;
  if (actions.contains(document.activeElement)) {
    hint.tabIndex = -1;
    hint.focus({ preventScroll: true });
  }
  for (const button of actions.querySelectorAll('button')) button.disabled = true;
  let elapsed = 0;
  for (const [delay, run] of frames) {
    elapsed += delay;
    after(elapsed, run);
  }
  after(elapsed + 20, () => {
    busy = false;
    finish();
    if (document.activeElement === hint) actions.firstElementChild?.focus({ preventScroll: true });
  });
}

function setStatus({ room, key, lock, guest, status, time, note }) {
  write('room-state', room);
  write('key-state', key);
  write('lock-state', lock);
  write('guest-state', guest);
  write('terminal-status', status);
  write('terminal-clock', time);
  write('terminal-hint', note);
}

function setStage(next) {
  stage = next;
  terminal.dataset.stage = String(next);
  requestRender();
}

function verify() {
  setStatus({ note: '正在从前台读取房卡……' });
  sequence([
    [340, () => {
      setStage(1);
      setStatus({ room: '房卡有效', key: '06 · 住客', lock: '未反锁', guest: '1', time: '22:48:07' });
      append('值班台', '校验通过。请确认房门已关好。');
    }],
    [1000, () => {
      setStatus({ key: '06 · 读到第二张', status: '与前台不同步' });
      append('值班台', '重复房卡。持卡人相同。', true);
      append('门禁', '两张卡分别位于门的两侧。');
    }],
  ], () => {
    setStatus({ note: '门禁请求一次手动确认。' });
    choices(['lock', '反锁房门'], ['knock', '敲门核验']);
  });
}

function checkDoor(fromLock) {
  setStatus({ note: fromLock ? '等待门锁回执……' : '等待门内应答……' });
  sequence([
    [250, () => {
      setStage(2);
      setStatus({ room: '读取到房内信号', guest: '1 / 1', time: '22:48:08' });
      if (fromLock) {
        setStatus({ lock: '已从内侧反锁' });
        append('门禁', '已反锁。操作侧：房内。');
      } else {
        knock(0, .52);
        knock(.26, .34);
        append('门禁', '走廊收到两下敲击。');
      }
    }],
    [830, () => {
      if (fromLock) {
        append('门禁', '网页端记录的操作侧：走廊。', true);
        append('门禁', '门内也执行了一次反锁。');
        knock(0, .4);
      } else {
        knock(0, .42);
        append('门禁', '检测到房内回敲。时间早于走廊敲门 3 秒。', true);
        setStatus({ lock: '已从内侧反锁' });
      }
    }],
  ], () => {
    setStatus({ note: '有一通前台来电。' });
    choices(['call', '接通前台']);
  });
}

function call() {
  setStatus({ note: '正在接通夜间值班员……', time: '03:17:00' });
  sequence([
    [600, () => {
      setStage(3);
      setStatus({ status: '对讲中 · 线路 06', room: '线路占用' });
      append('前台', '终于接了。我刚拨了三次。');
    }],
    [700, () => append('前台', '先别转动门把。告诉我，你从哪一侧接的？')],
  ], () => {
    setStatus({ note: '从以下两句里选一句回复。' });
    choices(['hall', '我在走廊。'], ['inside', '我在房里。']);
    after(13500, () => {
      if (stage !== 3 || busy || document.hidden) return;
      append('前台', '我听见有人吸了一口气。是你吗？');
      knock(0, .22);
    });
  });
}

function reply(text) {
  playerReply = text;
  append('你', text);
  setStatus({ note: '等待值班员确认位置……' });
  sequence([
    [770, () => {
      setStage(4);
      append('房内对讲', text, true);
      setStatus({ guest: '同一人 · 2 处', time: '03:16:59' });
      knock(0, .27);
    }],
    [930, () => append('前台', '这句我听见两遍。第二遍离话筒更近。')],
    [550, () => append('前台', '把听筒放回去。慢一点。')],
  ], () => {
    setStatus({ note: '对讲仍在录音。' });
    choices(['hang', '结束通话']);
  });
}

function hang() {
  setStatus({ note: '正在断开线路……' });
  sequence([
    [400, () => {
      setStage(5);
      setStatus({ status: '线路已断开', room: '站点未响应', lock: '不可读', time: '03:17:00' });
      append('值班台', '通话已结束。');
    }],
    [1100, () => {
      setStatus({ status: '房内话筒仍开启' });
      append('房内对讲', `${playerReply} 你先挂。`, true);
      knock(0, .38);
      knock(.49, .21);
    }],
  ], () => {
    setStatus({ note: '可以退回刚才使用的那张房卡。' });
    choices(['leave', '退回房卡']);
  });
}

function leave() {
  setStatus({ note: '正在同步退房记录……' });
  sequence([
    [470, () => {
      setStage(6);
      setStatus({ room: '已退房', key: '退回 1 / 读取 2', guest: '1', lock: '在房内反锁', time: '03:17:01' });
      append('值班台', '房卡已退回。');
    }],
    [1150, () => {
      setStatus({ status: '房内线路恢复' });
      append('房内对讲', '也替我退一下。', true);
      updateClosing(3);
    }],
  ], () => {
    setStatus({ note: '一张房卡仍在房内。' });
    choices(['record', '查看交接记录']);
  });
}

const behavior = {
  verify,
  lock: () => checkDoor(true),
  knock: () => checkDoor(false),
  call,
  hall: () => reply('我在走廊。'),
  inside: () => reply('我在房里。'),
  hang,
  leave,
  record: () => {
    closing.scrollIntoView();
    byId('closing-title').tabIndex = -1;
    byId('closing-title').focus({ preventScroll: true });
  },
};

actions.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button && !busy) behavior[button.dataset.action]?.();
});

function updateClosing(next) {
  closingPhase = next;
  const records = [
    ['夜间交接记录', '房卡归还后，请离开。', '前台将在下一次同步时更新客房状态。', '返回自助值班台'],
    ['夜间交接记录 · 同步中', '06 号房已退房。', '最后一张房卡于 03:17 退回。', '检查门禁记录'],
    ['夜间交接记录 · 收到补录', '门内仍然有人。', '同一张房卡于 03:16 从房内签收。', '回到值班台核对'],
    ['夜间交接记录 · 有一条未读', '你的那张退回了。', '另一张房卡仍被握在房内。对讲机在它手边。', '回到值班台'],
  ];
  const [label, title, copy, link] = records[next];
  write('closing-label', label);
  write('closing-title', title);
  write('closing-copy', copy);
  write('closing-link', link);
}

const closingObserver = new IntersectionObserver(entries => {
  if (closingPhase || !entries.some(entry => entry.isIntersecting)) return;
  updateClosing(1);
  after(1650, () => {
    if (closingPhase === 1) updateClosing(2);
  });
}, { threshold: .47 });
closingObserver.observe(closing);

const siteCopy = [
  ['前台在线', '入住 15:00 · 退房 11:00', '01–16', '刷房卡进入', '住客楼层导览', '客房朝向湖面。前台位于走廊西侧。', '房门只能从房内反锁。如需协助，请使用前台对讲。', '离开客房后，在自助服务页退回房卡。系统会同步更新在住人数。', '入住指南 · 北岸地图'],
  ['夜间值班', '入住 15:00 · 退房 11:00', '01–16', '请确认房门合拢', '住客楼层导览', '客房朝向湖面。从 06 号房出门，请向左走。', '房门只能从房内反锁。如需协助，请使用前台对讲。', '离开客房后，在自助服务页退回房卡。系统会同步更新在住人数。', '入住指南 · 北岸地图'],
  ['夜间值班 · 回执延迟', '入住 15:00 · 退房 11:00', '01–16 / 16', '终端未收到回执', '自动同步地图', '06 号房的上一次开门记录来自房内。', '房门只能从房内反锁。如在走廊听见反锁声，请先核对操作侧。', '退回房卡后请核对在住人数。两份记录有时会慢几秒。', '北岸地图 · 等待同步'],
  ['夜间值班 · 有一通来电', '退房状态尚未同步', '01–16 / 17', '请保留房卡', '正同步另一张地图', '走廊顶端的标记已经移入 06 号房。', '房内房外都显示“已反锁”。如果两边都有人说话，只回复一次。', '每人归还一张房卡。请确认门内外各有几个人。', '北岸地图 · 回执早于请求'],
];

function changeCopy(next) {
  if (chapter === next) return;
  chapter = next;
  const ids = ['header-status', 'header-hours', 'room-count', 'room-policy', 'floor-stamp', 'floor-note', 'door-answer', 'checkout-answer', 'map-edition'];
  ids.forEach((id, index) => write(id, siteCopy[next][index]));
}

const canvas = byId('lake-map');
const map = canvas.getContext('2d');
const grain = Array.from({ length: 520 }, (_, index) => [
  (Math.sin(index * 77.73) + 1) * canvas.width * .499,
  (Math.sin(index * 19.12) + 1) * canvas.height * .499,
]);

function paintMap(amount) {
  if (!map) return;
  const { width, height } = canvas;
  const coast = x => 208 + Math.sin(x * .009 + 1.2) * 43 + Math.sin(x * .022) * 19 + Math.sin(x * .039) * 7;
  const trace = (curve, start = 0) => {
    map.beginPath();
    map.moveTo(start, curve(start));
    for (let x = start + 4; x <= width; x += 4) map.lineTo(x, curve(x));
  };

  map.fillStyle = '#334b38';
  map.fillRect(0, 0, width, height);
  trace(coast);
  map.lineTo(width, height);
  map.lineTo(0, height);
  map.closePath();
  const lake = map.createLinearGradient(0, 180, width, height);
  lake.addColorStop(0, '#203b36');
  lake.addColorStop(1, '#142e2c');
  map.fillStyle = lake;
  map.fill();

  map.lineWidth = 1;
  for (let index = 0; index < 21; index++) {
    trace(x => coast(x) - (index + 1) * 11 + Math.sin(x * .017 + index * .19) * (4 + index * .55));
    map.strokeStyle = index % 4 === 0 ? '#bdc48f69' : '#bac48d3b';
    map.stroke();
  }
  for (let index = 0; index < 12; index++) {
    trace(x => coast(x) + 9 + index * 17 + Math.sin(x * .011 + index * .39) * (1 + index * 2.2));
    map.strokeStyle = index % 3 === 0 ? '#93b2a35c' : '#79a59635';
    map.stroke();
  }
  trace(coast);
  map.strokeStyle = '#c2c998a0';
  map.stroke();

  map.beginPath();
  for (let x = 32; x < width; x += 50) { map.moveTo(x, 0); map.lineTo(x, height); }
  for (let y = 36; y < height; y += 50) { map.moveTo(0, y); map.lineTo(width, y); }
  map.strokeStyle = '#d5ded325';
  map.stroke();
  map.fillStyle = '#eeeed34d';
  for (const [x, y] of grain) map.fillRect(x, y, 1, 1);

  map.setLineDash([5, 5]);
  map.beginPath();
  map.moveTo(20, 113);
  map.bezierCurveTo(100, 107, 120, 198, 234, 187);
  map.bezierCurveTo(340, 168, 338, 70, 558, 93);
  map.strokeStyle = '#e1c88ca5';
  map.stroke();
  map.setLineDash([]);
  map.fillStyle = '#ced39c';
  map.fillRect(220, 186, 23, 7);
  map.fillRect(231, 194, 12, 4);
  if (amount > .08) {
    map.fillStyle = `rgba(201, 205, 151, ${amount * .57})`;
    map.fillRect(232 + amount * 9, 201 + amount * 22, 14, 4);
  }
  map.fillStyle = `rgba(45, 42, 26, ${amount * .46})`;
  map.fillRect(0, 0, width, height);
}

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

function render() {
  raf = 0;
  const scroll = clamp(scrollY / Math.max(1, root.scrollHeight - innerHeight));
  furthest = Math.max(furthest, scroll);
  const target = clamp(Math.max(scroll * .87, stage * .15) + Math.max(0, .22 * (scroll - .08)));
  tone = reducedMotion.matches ? target : tone + (target - tone) * .12;
  if (Math.abs(tone - target) < .001) tone = target;
  root.style.setProperty('--decay', `${(tone * 100).toFixed(2)}%`);
  root.style.setProperty('--drift', `${(tone * 13).toFixed(1)}px`);
  const memory = Math.max(furthest, stage * .17);
  changeCopy(memory > .75 ? 3 : memory > .46 ? 2 : memory > .20 ? 1 : 0);
  if (lastPaint < 0 || (Math.abs(tone - lastPaint) > .025 && canvas.getBoundingClientRect().bottom > 0)) {
    paintMap(tone);
    lastPaint = tone;
  }
  if (tone !== target) requestRender();
}

function requestRender() {
  if (!raf) raf = requestAnimationFrame(render);
}

function createAudio() {
  const context = new AudioContext();
  const master = context.createGain();
  master.gain.value = 0;
  master.connect(context.destination);
  const drone = context.createOscillator();
  drone.type = 'triangle';
  drone.frequency.value = 48;
  const droneGain = context.createGain();
  droneGain.gain.value = .14;
  drone.connect(droneGain).connect(master);
  drone.start();
  const buffer = context.createBuffer(1, Math.round(context.sampleRate * .28), context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) {
    const time = index / context.sampleRate;
    samples[index] = (.74 * Math.sin(time * 2 * Math.PI * 114) + .26 * (2 * Math.random() - 1)) * Math.exp(-time * 44);
  }
  return { context, master, buffer };
}

function soundLevel() {
  if (!audio) return;
  audio.master.gain.setTargetAtTime(soundOn && !document.hidden ? .14 : 0, audio.context.currentTime, .12);
}

function knock(delay, strength) {
  if (!soundOn || document.hidden || !audio) return;
  const hit = audio.context.createBufferSource();
  hit.buffer = audio.buffer;
  const gain = audio.context.createGain();
  gain.gain.value = strength;
  hit.connect(gain).connect(audio.master);
  hit.start(audio.context.currentTime + delay);
}

function setSound(next) {
  soundOn = next;
  soundButton.setAttribute('aria-pressed', String(next));
  soundButton.textContent = next ? '关闭环境声' : '开启环境声';
  soundLevel();
}

soundButton.hidden = !window.AudioContext;
soundButton.addEventListener('click', async () => {
  soundRequested = !soundRequested;
  if (!soundRequested) return setSound(false);
  try {
    audio ??= createAudio();
    await audio.context.resume();
    if (soundRequested) setSound(true);
  } catch {
    soundRequested = false;
    setSound(false);
    soundButton.textContent = '重试开启环境声';
  }
});

function dateValue(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function updateDates() {
  const tomorrow = new Date(`${checkIn.value || checkIn.min}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  checkOut.min = dateValue(tomorrow);
  if (checkOut.value < checkOut.min) checkOut.value = checkOut.min;
  bookingResult.hidden = true;
}

for (const button of document.querySelectorAll('.js-book')) {
  button.addEventListener('click', () => {
    checkIn.min = dateValue(new Date());
    if (checkIn.value < checkIn.min) checkIn.value = checkIn.min;
    updateDates();
    booking.showModal();
  });
}
checkIn.addEventListener('change', updateDates);
checkOut.addEventListener('change', () => { bookingResult.hidden = true; });
byId('booking-form').addEventListener('submit', event => {
  event.preventDefault();
  write('booking-message', stage === 6 ? '06 号房已退房，但仍显示在住。请向前台查询。' : '北翼 06 号房可用。值班台已收到你的演示房卡。');
  if (!stage && !busy) setStatus({ key: '06 · 待校验', note: '预订已读取，请核对房卡。' });
  bookingResult.hidden = false;
});
byId('close-booking').addEventListener('click', () => booking.close());
byId('open-desk').addEventListener('click', () => booking.close());
booking.addEventListener('click', event => {
  if (event.target === booking) booking.close();
});

byId('reset').addEventListener('click', () => {
  for (const timer of timers) clearTimeout(timer);
  timers.clear();
  busy = false;
  playerReply = '';
  furthest = 0;
  tone = 0;
  lastPaint = -1;
  soundRequested = false;
  setSound(false);
  setStage(0);
  setStatus({ room: '待校验', key: '未读取', lock: '等待查询', guest: '—', status: '服务可用', time: '22:48:06', note: '演示房卡会自动读取。' });
  messages.replaceChildren();
  append('值班台', '请校验房卡以继续。');
  choices(['verify', '校验房卡']);
  updateClosing(0);
  byId('door-question').open = false;
  byId('checkout-question').open = false;
  bookingResult.hidden = true;
  history.replaceState(null, '', location.pathname + location.search);
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.querySelector('.brand').focus({ preventScroll: true });
  requestRender();
});

window.addEventListener('scroll', requestRender, { passive: true });
window.addEventListener('resize', requestRender);
window.addEventListener('pageshow', requestRender);
document.addEventListener('visibilitychange', soundLevel);
reducedMotion.addEventListener('change', requestRender);
requestRender();
