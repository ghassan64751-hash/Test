const $ = (id) => document.getElementById(id);
const emailForm = $('emailForm'), codeForm = $('codeForm'), msg = $('msg');
let currentEmail = '', timer = null;

function say(text, ok = false) {
  msg.textContent = text || '';
  msg.className = 'msg' + (ok ? ' ok' : '');
}

async function api(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'حدث خطأ، حاول مجدداً');
  return data;
}

function startCooldown(sec = 60) {
  const btn = $('resendBtn');
  clearInterval(timer);
  let left = sec;
  btn.disabled = true;
  btn.textContent = `إعادة الإرسال (${left})`;
  timer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(timer);
      btn.disabled = false;
      btn.textContent = 'إعادة الإرسال';
    } else btn.textContent = `إعادة الإرسال (${left})`;
  }, 1000);
}

async function sendCode() {
  const btn = $('sendBtn');
  btn.disabled = true;
  say('جاري الإرسال...');
  try {
    const r = await api('/api/request-code', { email: currentEmail });
    emailForm.hidden = true;
    codeForm.hidden = false;
    $('sentTo').textContent = currentEmail;
    $('code').value = '';
    $('code').focus();
    startCooldown();
    say(r.dev ? 'وضع التطوير: الرمز يظهر في طرفية الخادم' : 'تم إرسال الرمز', true);
  } catch (e) {
    say(e.message);
  } finally {
    btn.disabled = false;
  }
}

emailForm.addEventListener('submit', (e) => {
  e.preventDefault();
  currentEmail = $('email').value.trim().toLowerCase();
  if (!currentEmail) return say('أدخل البريد الإلكتروني');
  sendCode();
});

$('resendBtn').addEventListener('click', sendCode);
$('changeBtn').addEventListener('click', () => {
  codeForm.hidden = true;
  emailForm.hidden = false;
  clearInterval(timer);
  say('');
});

$('code').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
  if (e.target.value.length === 6) codeForm.requestSubmit();
});

codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('code').value;
  if (code.length !== 6) return say('أدخل الرمز المكوّن من 6 أرقام');
  $('verifyBtn').disabled = true;
  try {
    await api('/api/verify-code', { email: currentEmail, code });
    showWelcome(currentEmail);
  } catch (err) {
    say(err.message);
  } finally {
    $('verifyBtn').disabled = false;
  }
});

function showWelcome(email) {
  emailForm.hidden = true;
  codeForm.hidden = true;
  say('');
  const card = document.querySelector('.card');
  card.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'welcome';
  const h = document.createElement('h1');
  h.textContent = 'أهلاً بك 👋';
  const p = document.createElement('p');
  p.className = 'hint';
  p.textContent = 'تم تسجيل دخولك بالبريد:';
  const b = document.createElement('b');
  b.dir = 'ltr';
  b.textContent = email;
  const out = document.createElement('button');
  out.type = 'submit';
  out.textContent = 'تسجيل الخروج';
  out.style.cssText = 'width:100%;padding:12px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font-size:1rem;cursor:pointer';
  out.onclick = async () => {
    await api('/api/logout');
    location.reload();
  };
  wrap.append(h, p, b, out);
  card.append(wrap);
}

fetch('/api/me').then((r) => (r.ok ? r.json() : null)).then((u) => u && showWelcome(u.email));