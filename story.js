const guestbook = document.querySelector('#guestbook');
const archive = document.querySelector('#archive');
const passage = document.querySelector('#passage');
const camera = passage.querySelector('.camera');
const cameraMessage = document.querySelector('#camera-message');
const timecode = document.querySelector('#timecode');
const finale = document.querySelector('#finale');
const finalScreen = document.querySelector('#final-screen');
const finalStatus = document.querySelector('#final-status');
const finalLine = document.querySelector('#final-line');
const soundButton = document.querySelector('#sound');
const soundLabel = document.querySelector('#sound-label');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const cameraCues = [
  [0, '灯还亮着。', '03:17:00'],
  [.29, '走廊尽头有人。', '03:17:00'],
  [.58, '它没有走。', '03:17:00'],
  [.79, '是镜头在靠近。', '03:17:01'],
  [.94, '17 号房 · 门已打开', '––:––:––'],
];

const finalCues = [
  [0, 'CAM 17 / 门外', '请勿开门。'],
  [.25, 'CAM 17 / 门内', '门是从里面开的。'],
  [.52, 'CAM 17 / 门内', '它在看你。'],
  [.8, 'CAM 17 / 信号丢失', '你还在里面。'],
];

let framePending = false;
let lastCameraCue;
let lastFinalCue;
let audio = null;
let soundOn = false;
let soundRequested = false;
let hasStung = false;

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function progress(section, screen) {
  return clamp(-section.getBoundingClientRect().top / Math.max(1, section.offsetHeight - screen.offsetHeight));
}

function cueAt(cues, position) {
  return cues.findLast(([threshold]) => position >= threshold);
}

function render() {
  framePending = false;
  const archiveTop = archive.getBoundingClientRect().top;
  const guestbookTop = guestbook.getBoundingClientRect().top;
  const look = progress(passage, camera);
  const reveal = progress(finale, finalScreen);
  const steady = reducedMotion.matches;
  const archiveVisible = archiveTop < innerHeight * .75;
  const corridorCue = cueAt(cameraCues, look);
  const roomCue = cueAt(finalCues, reveal);

  guestbook.classList.toggle('is-odd', guestbookTop < innerHeight * .34);
  soundButton.hidden = !archiveVisible;

  if (lastCameraCue !== corridorCue) {
    cameraMessage.textContent = corridorCue[1];
    timecode.textContent = corridorCue[2];
    lastCameraCue = corridorCue;
  }
  if (lastFinalCue !== roomCue) {
    finalStatus.textContent = roomCue[1];
    finalLine.textContent = roomCue[2];
    lastFinalCue = roomCue;
  }

  const cut = !steady && reveal >= .51 && reveal < .555;
  const cameraFault = !steady && look >= .82 && look < .88;
  camera.style.setProperty('--zoom', (1 + look * 1.06).toFixed(3));
  camera.style.setProperty('--camera-light', cameraFault ? '.42' : (.91 - look * .24).toFixed(3));
  camera.style.setProperty('--shake', cameraFault ? '-9px' : '0px');
  finalScreen.style.setProperty('--face', clamp((reveal - .45) / .105).toFixed(3));
  finalScreen.style.setProperty('--door', (1 - clamp((reveal - .32) / .23)).toFixed(3));
  finalScreen.style.setProperty('--approach', (1 + clamp((reveal - .48) / .52) * .35).toFixed(3));
  finalScreen.style.setProperty('--signal', cut ? '.78' : '.20');
  finalScreen.style.setProperty('--light', cut ? '.55' : (.92 + reveal * .22).toFixed(3));
  finalScreen.style.setProperty('--drift', cut ? '14px' : '0px');
  finalScreen.classList.toggle('signal-loss', cut);

  if (audio) {
    const now = audio.context.currentTime;
    const intensity = soundOn && archiveVisible && !document.hidden ? .035 + look * .04 + reveal * .012 : 0;
    audio.volume.gain.setTargetAtTime(intensity, now, .2);
    audio.hum.frequency.setTargetAtTime(45 - look * 9 + reveal * 9, now, .25);
    audio.noiseFilter.frequency.setTargetAtTime(110 + look * 470 + reveal * 210, now, .25);
    if (soundOn && archiveVisible && !document.hidden && reveal >= .52 && reveal < .72 && !hasStung) {
      playRattle(audio);
      hasStung = true;
    } else if (reveal < .33) {
      hasStung = false;
    }
  }
}

function requestRender() {
  if (framePending) return;
  framePending = true;
  requestAnimationFrame(render);
}

function createAudio() {
  const context = new AudioContext();
  const volume = context.createGain();
  volume.gain.value = 0;
  volume.connect(context.destination);

  const hum = context.createOscillator();
  hum.type = 'triangle';
  hum.frequency.value = 45;
  hum.connect(volume);
  hum.start();

  const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
  const noise = context.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const noiseFilter = context.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 110;
  noiseFilter.Q.value = .7;
  noise.connect(noiseFilter).connect(volume);
  noise.start();

  const rattle = context.createGain();
  rattle.gain.value = 0;
  noise.connect(rattle).connect(volume);
  return { context, volume, hum, noiseFilter, rattle };
}

function playRattle({ context, rattle }) {
  const now = context.currentTime;
  rattle.gain.cancelScheduledValues(now);
  rattle.gain.setValueAtTime(.001, now);
  rattle.gain.linearRampToValueAtTime(.7, now + .025);
  rattle.gain.exponentialRampToValueAtTime(.001, now + .7);
}

function setSound(next) {
  soundOn = next;
  soundButton.setAttribute('aria-pressed', String(next));
  soundLabel.textContent = next ? '关闭环境声' : '开启环境声';
  requestRender();
}

if (!window.AudioContext) soundButton.remove();
soundButton.addEventListener('click', async () => {
  soundRequested = !soundRequested;
  if (!soundRequested) {
    setSound(false);
    return;
  }
  try {
    audio ??= createAudio();
    await audio.context.resume();
    if (soundRequested) setSound(true);
  } catch {
    soundRequested = false;
    setSound(false);
    soundLabel.textContent = '重试开启环境声';
  }
});

const booking = document.querySelector('#booking');
const bookingForm = document.querySelector('#booking-form');
const bookingResult = document.querySelector('#booking-result');
const checkIn = document.querySelector('#check-in');
const checkOut = document.querySelector('#check-out');

function dateValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function updateDates() {
  const tomorrow = new Date(`${checkIn.value || checkIn.min}T12:00:00`);
  tomorrow.setDate(tomorrow.getDate() + 1);
  checkOut.min = dateValue(tomorrow);
  if (!checkOut.value || checkOut.value < checkOut.min) checkOut.value = checkOut.min;
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
bookingForm.addEventListener('submit', event => {
  event.preventDefault();
  bookingResult.hidden = false;
});
document.querySelector('#close-booking').addEventListener('click', () => booking.close());
document.querySelector('#open-record').addEventListener('click', () => booking.close());
booking.addEventListener('click', event => {
  if (event.target === booking) booking.close();
});

document.querySelector('#rewind').addEventListener('click', () => {
  soundRequested = false;
  setSound(false);
  history.replaceState(null, '', location.pathname + location.search);
  window.scrollTo({ top: 0, behavior: 'instant' });
  document.querySelector('.brand').focus({ preventScroll: true });
});

window.addEventListener('scroll', requestRender, { passive: true });
window.addEventListener('resize', requestRender);
window.addEventListener('pageshow', requestRender);
document.addEventListener('visibilitychange', requestRender);
reducedMotion.addEventListener('change', requestRender);
render();
