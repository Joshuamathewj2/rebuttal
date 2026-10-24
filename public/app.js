const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (n) => `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (p) => `${Math.round(p * 100)}%`;

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { body });
  return body;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 3200);
}

const state = { selected: null, analysis: null, queue: null };

// ------------------------------------------------------------------ tabs ----
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.tab').forEach((s) => (s.hidden = s.id !== `tab-${name}`));
  if (name === 'prevention') renderPrevention();
  if (name === 'insights') renderInsights();
  if (name === 'activity') renderActivity();
}

// ---------------------------------------------------------------- status ----
async function loadStatus() {
  const s = await api('/api/status');
  const ai = s.ai === 'rules' ? 'rules engine (no API key)' : s.ai;
  $('#env').innerHTML = `
    <span class="chip"><b>Merchant</b>${esc(s.merchant.name)}</span>
    <span class="chip"><b>PayPal</b>${esc(s.paypalMode)}</span>
    <span class="chip"><b>AI</b>${esc(ai)}</span>`;
}

// ----------------------------------------------------------------- queue ----
async function loadQueue() {
  const q = await api('/api/disputes');
  state.queue = q;
  const atStake = q.open.reduce((s, r) => s + r.amount, 0);
  const ev = q.open.reduce((s, r) => s + Math.max(0, r.ev), 0);
  const urgent = q.open.filter((r) => r.hoursLeft < 48).length;
  $('#kpis').innerHTML = [
    [q.open.length, 'open disputes'],
    [usd(atStake), 'held in disputes'],
    [usd(ev), 'expected recovery with Rebuttal'],
    [urgent, 'due within 48 hours'],
  ].map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');

  const card = (r) => {
    const tcls = r.hoursLeft < 24 ? 'b-red' : r.hoursLeft < 72 ? 'b-amber' : 'b-grey';
    const pcls = r.pWin >= 0.7 ? 'b-green' : r.pWin >= 0.4 ? 'b-amber' : 'b-red';
    return `<button class="qcard" data-id="${esc(r.dispute_id)}" aria-current="${r.dispute_id === state.selected}">
      <div class="qrow"><span class="qreason">${esc(r.reason_label)}</span><span class="qamt">${usd(r.amount)}</span></div>
      <div class="qmeta">${esc(r.buyer)} - ${esc(r.items)}</div>
      <div class="qfoot">
        <span class="badge ${tcls}">${esc(r.timeLeft)} left</span>
        <span class="badge ${pcls}">${pct(r.pWin)} win</span>
        <span class="badge b-blue">${esc(r.recommendedLabel)}</span>
        ${r.stage !== 'INQUIRY' ? `<span class="badge b-grey">${esc(r.stage.toLowerCase())}</span>` : ''}
      </div>
    </button>`;
  };
  const done = q.other.filter((r) => !r.needsOrder);
  const sent = q.waiting.map((r) => `<button class="qcard" data-id="${esc(r.dispute_id)}" aria-current="${r.dispute_id === state.selected}"><div class="qrow"><span class="qreason">${esc(r.reason_label)}</span><span class="qamt">${usd(r.amount)}</span></div><div class="qmeta">${esc(r.buyer)}</div><div class="qfoot"><span class="badge b-green">${r.status === 'UNDER_REVIEW' ? 'evidence sent - PayPal reviewing' : 'offer sent - waiting on buyer'}</span></div></button>`).join('');
  $('#queue').innerHTML = `<div class="qsection">Needs a decision - most urgent first</div>` + q.open.map(card).join('') +
    (q.open.length ? '' : '<div class="empty">Nothing waiting. Nice.</div>') +
    (sent ? `<div class="qsection">Sent - waiting on PayPal or buyer</div>${sent}` : '') +
    (done.length ? `<div class="qsection">Resolved</div>` + done.map((r) => `<div class="qcard"><div class="qrow"><span class="qreason">${esc(r.reason_label)}</span><span class="qamt">${usd(r.amount)}</span></div><div class="qmeta">${esc(r.buyer)} - ${esc((r.outcome || r.status).toLowerCase().replaceAll('_', ' '))}</div></div>`).join('') : '');
  document.querySelectorAll('.qcard[data-id]').forEach((b) => b.addEventListener('click', () => openCase(b.dataset.id)));
  if (!state.selected && q.open[0]) openCase(q.open[0].dispute_id);
}

// ------------------------------------------------------------------ case ----
async function openCase(id, option) {
  state.selected = id;
  document.querySelectorAll('.qcard[data-id]').forEach((b) => b.setAttribute('aria-current', String(b.dataset.id === id)));
  $('#case').innerHTML = `<div class="loading"><span class="spin"></span>Reading the dispute, gathering evidence and drafting a response...</div>`;
  try {
    const a = await api(`/api/disputes/${encodeURIComponent(id)}/analysis${option ? `?option=${option}` : ''}`);
    if (state.selected !== id) return;
    state.analysis = a;
    renderCase(a);
  } catch (err) {
    $('#case').innerHTML = `<div class="empty">Could not load this dispute: ${esc(err.message)}</div>`;
  }
}

function gauge(p) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const color = p >= 0.7 ? 'var(--green)' : p >= 0.4 ? 'var(--amber)' : 'var(--red)';
  return `<div class="gauge" role="img" aria-label="Estimated win probability ${pct(p)}">
    <svg width="130" height="130" viewBox="0 0 130 130"><circle cx="65" cy="65" r="${r}" fill="none" stroke="#eceae4" stroke-width="11"/>
    <circle cx="65" cy="65" r="${r}" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round" stroke-dasharray="${c * p} ${c}"/></svg>
    <div class="pct"><div><b>${pct(p)}</b><span>est. win chance</span></div></div></div>`;
}

function renderCase(a) {
  const d = a.dispute;
  const urgent = a.hoursLeft < 48;
  const prot = a.protection;
  const pcls = prot.eligible === true ? 'b-green' : prot.eligible === null ? 'b-amber' : 'b-grey';
  const buyerMsgs = (d.messages || []).filter((m) => m.posted_by === 'BUYER');
  const sellerMsgs = (d.messages || []).filter((m) => m.posted_by === 'SELLER');
  const maxW = Math.max(1, ...a.checks.map((c) => Math.abs(c.weight)));
  const resolved = d.status === 'RESOLVED' || d.status === 'UNDER_REVIEW' || d.status === 'WAITING_FOR_BUYER_RESPONSE';

  $('#case').innerHTML = `
    <div class="chead">
      <div>
        <h2>${esc(d.reason_label)} - ${usd(d.amount)}</h2>
        <div class="sub">${esc(d.dispute_id)} - ${esc(d.buyer)} - invoice ${esc(a.order.invoice_id)} - ${esc(d.stage.toLowerCase())} stage</div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
          <span class="badge ${pcls}">Seller Protection: ${esc(prot.label)}</span>
          <span class="badge b-grey">status: ${esc(d.status.toLowerCase().replaceAll('_', ' '))}</span>
        </div>
      </div>
      <div class="right">
        <div class="countdown ${urgent ? 'urgent' : ''}">${esc(d.timeLeft)} left</div>
        <div class="sub">respond by ${new Date(d.due).toLocaleString()}</div>
      </div>
    </div>
    <div class="cbody">
      <div class="col">
        <section>
          <h3>What the buyer says</h3>
          ${buyerMsgs.length ? buyerMsgs.map((m) => `<div class="statement">"${esc(m.content)}"<small>${new Date(m.time_posted).toLocaleDateString()} via PayPal</small></div>`).join('') : `<div class="statement">No statement - raised through the buyer's bank as a chargeback.<small>${esc(a.signals.summary)}</small></div>`}
        </section>

        <section>
          <h3>Verdict</h3>
          <div class="verdict">
            ${gauge(a.pWin)}
            <div>
              <div class="prior">Starts from your own history for this reason: ${a.prior.wins} won / ${a.prior.losses} lost, prior ${pct(a.prior.p)}. Each check below moves the estimate.</div>
            </div>
          </div>
          <ul class="checks" style="margin-top:12px">
            ${a.checks.map((c) => `<li class="${c.status}">
              <span class="ic">${c.status === 'pass' ? '&#10003;' : c.status === 'warn' ? '!' : '&#10005;'}</span>
              <div><div>${esc(c.label)}</div><div class="d">${esc(c.detail)}</div></div>
              <div title="log-odds weight ${c.weight}"><div class="wbar">${c.weight > 0 ? `<i class="pos" style="width:${(c.weight / maxW) * 50}%"></i>` : c.weight < 0 ? `<i class="neg" style="width:${(Math.abs(c.weight) / maxW) * 50}%"></i>` : ''}</div></div>
            </li>`).join('')}
          </ul>
        </section>

        <section>
          <h3>Your options, by expected value</h3>
          <div class="options">
            ${a.economics.options.map((o) => `<button class="opt" data-opt="${o.id}" aria-pressed="${o.id === a.plan.id}">
              <span><span class="t">${esc(o.label)}</span> ${o.id === a.economics.recommended ? '<span class="rec">recommended</span>' : ''}</span>
              <span class="ev ${o.ev < 0 ? 'neg' : ''}">${o.ev >= 0 ? '+' : '-'}${usd(Math.abs(o.ev))}</span>
              <span class="x">${esc(o.detail)}</span>
            </button>`).join('')}
          </div>
        </section>

        ${resolved && (d.evidences?.length || d.offer || sellerMsgs.length) ? `<section><h3>Already sent</h3><div class="result">
          ${d.evidences?.length ? `Evidence submitted (${d.evidences.length} items). ` : ''}${d.offer ? `Offer made: ${usd(d.offer.seller_offered_amount.value)}. ` : ''}${sellerMsgs.length ? 'Buyer messaged.' : ''}
        </div></section>` : ''}

        <section>
          <h3>Response to PayPal <span class="engine">${a.draft.engine === 'rules' ? 'template engine' : 'drafted by ' + esc(a.draft.engine)}</span></h3>
          <div class="ground ${a.grounding.ok ? 'ok' : 'bad'}" id="ground">${groundText(a.grounding.total - a.grounding.failed, a.grounding.total)}</div>
          <div class="response" id="response" style="margin-top:8px">
            ${a.draft.sentences.map((s, i) => sentenceRow(s, i)).join('')}
          </div>
        </section>

        ${a.dispute.stage === 'INQUIRY' ? `<section>
          <h3>Message to the buyer</h3>
          <textarea id="buyerMsg" aria-label="Message to the buyer">${esc(a.draft.buyer_message)}</textarea>
        </section>` : ''}

        <section>
          <h3>On approval, Rebuttal will call PayPal</h3>
          <ol class="actions">
            ${a.actions.map((x, i) => `<li><span class="n">${i + 1}</span><div>${esc(x.label)}<code>${esc(x.endpoint)}</code></div></li>`).join('')}
            ${a.order.fulfillment?.tracking_number && !a.order.fulfillment.uploaded_to_paypal ? `<li><span class="n">${a.actions.length + 1}</span><div>Push ${esc(a.order.fulfillment.carrier)} tracking to PayPal so this can't happen again<code>POST /v1/shipping/trackers-batch</code></div></li>` : ''}
          </ol>
          <div class="approve" style="margin-top:14px">
            <button class="btn" id="approve" ${a.grounding.ok && !resolved ? '' : 'disabled'}>${resolved ? 'Already sent to PayPal' : 'Approve and send to PayPal'}</button>
            <a class="btn ghost" href="/api/disputes/${encodeURIComponent(d.dispute_id)}/packet.pdf?option=${a.plan.id}" target="_blank" rel="noopener">Preview evidence PDF</a>
          </div>
          <div id="result" style="margin-top:12px"></div>
        </section>
      </div>

      <div class="col">
        <section>
          <h3>What Rebuttal noticed</h3>
          <div class="signals">
            <div>${esc(a.signals.summary)}</div>
            ${a.signals.admissions.map((x) => `<div class="sp"><span>Buyer acknowledged receipt: <i>"${esc(x.quote)}"</i></span><span class="badge b-green">strong</span></div>`).join('')}
            ${a.signals.partial_issue?.value ? `<div class="sp"><span>${esc(a.signals.partial_issue.reason)}</span><span class="badge b-blue">partial</span></div>` : ''}
            ${a.signals.damage_claim ? `<div class="sp"><span>Buyer reports damage on arrival.</span><span class="badge b-amber">damage</span></div>` : ''}
            ${a.dispute.reason === 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED' ? `<div class="sp"><span>${esc(a.signals.disclosed_in_listing.reason)}</span><span class="badge ${a.signals.disclosed_in_listing.value ? 'b-green' : 'b-grey'}">listing</span></div>` : ''}
            <div class="engine">signals: ${a.signals.engine === 'rules' ? 'rule-based' : esc(a.signals.engine)}</div>
          </div>
        </section>
        <section>
          <h3>Exhibits from your order records</h3>
          <div class="exhibits">
            ${a.evidence.map((e) => `<div class="ex" id="ex-${e.id}">
              <div class="h"><span class="id">${e.id}</span><b>${esc(e.title)}</b><span class="ty">${esc(e.evidence_type)}</span></div>
              <ul>${e.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
            </div>`).join('')}
          </div>
        </section>
        <section>
          <h3>Time</h3>
          <div class="signals">Doing this by hand takes about ${a.economics.timeSavedMin + 4} minutes (worth ${usd(a.economics.manualCost)} of your time). Here it is a review and one click.</div>
        </section>
      </div>
    </div>`;

  document.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => openCase(d.dispute_id, b.dataset.opt)));
  document.querySelectorAll('.cite[data-ex]').forEach((b) => b.addEventListener('click', () => flashExhibit(b.dataset.ex)));
  document.querySelectorAll('.sent [contenteditable]').forEach((el) => el.addEventListener('input', () => { $('#approve').disabled = resolved; $('#ground').className = 'ground'; $('#ground').textContent = 'Edited - the grounding check runs again when you approve.'; }));
  $('#approve').addEventListener('click', approve);
}

const groundText = (ok, total) => (ok === total
  ? `&#10003; All ${total} statements verified against the cited exhibits`
  : `&#10005; ${total - ok} of ${total} statements make claims the exhibits do not support - edit them before sending`);

function sentenceRow(s, i) {
  return `<div class="sent ${s.grounded === false ? 'bad' : ''}" data-i="${i}">
    <div contenteditable="true" spellcheck="true">${esc(s.text)}</div>
    <div class="cites">${s.cites.map((c) => c === 'PLAN' ? '<span class="cite plan">offer</span>' : `<button class="cite" data-ex="${esc(c)}" title="Show exhibit ${esc(c)}">${esc(c)}</button>`).join('')}</div>
    ${s.issues?.length ? `<div class="issues">${s.issues.map(esc).join('; ')}</div>` : ''}
  </div>`;
}

function flashExhibit(id) {
  const el = $(`#ex-${CSS.escape(id)}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1400);
}

async function approve() {
  const a = state.analysis;
  const btn = $('#approve');
  btn.disabled = true;
  btn.textContent = 'Sending...';
  const sentences = [...document.querySelectorAll('.sent')].map((row) => ({
    text: row.querySelector('[contenteditable]').innerText.trim(),
    cites: a.draft.sentences[Number(row.dataset.i)].cites,
  })).filter((s) => s.text);
  const body = { option: a.plan.id, sentences };
  const msg = $('#buyerMsg');
  if (msg) body.buyer_message = msg.value;
  try {
    const r = await api(`/api/disputes/${encodeURIComponent(a.dispute.dispute_id)}/execute`, { method: 'POST', body: JSON.stringify(body) });
    $('#result').innerHTML = `<div class="result ${r.ok ? '' : 'err'}"><b>${r.ok ? 'Sent to PayPal' : 'Partly failed'}</b><ul>${r.results.map((x) => `<li>${x.ok ? '&#10003;' : '&#10005;'} ${esc(x.label)} <code>${esc(x.endpoint)}</code>${x.error ? ` - ${esc(x.error)}` : ''}</li>`).join('')}</ul></div>`;
    btn.textContent = 'Sent';
    toast(r.ok ? 'Response submitted to PayPal' : 'Some PayPal calls failed - see details');
    state.selected = a.dispute.dispute_id;
    loadQueue();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Approve and send to PayPal';
    if (err.body?.sentences) {
      for (const bad of err.body.sentences) {
        const row = [...document.querySelectorAll('.sent')].find((r) => r.querySelector('[contenteditable]').innerText.trim() === bad.text);
        if (row) {
          row.classList.add('bad');
          row.querySelector('.issues')?.remove();
          row.insertAdjacentHTML('beforeend', `<div class="issues">${bad.issues.map(esc).join('; ')}</div>`);
        }
      }
      $('#ground').className = 'ground bad';
      $('#ground').innerHTML = `&#10005; Blocked: ${err.body.sentences.length} statement(s) are not supported by the exhibits they cite`;
    }
    toast(err.message);
  }
}

// ------------------------------------------------------------ prevention ----
async function renderPrevention() {
  const p = await api('/api/prevention');
  $('#tab-prevention').innerHTML = `
    <div class="panel">
      <h2>Stop the next dispute</h2>
      <p class="lead">Most "item not received" disputes are lost because PayPal never saw the tracking number. Rebuttal pushes tracking from your store to PayPal through the Tracking API, and flags orders that are outside Seller Protection before a buyer complains.</p>
      <h3>Shipped orders PayPal has no tracking for (${p.untracked.length})</h3>
      ${p.untracked.length ? `<table><thead><tr><th>Invoice</th><th>Buyer</th><th>Carrier</th><th>Tracking</th><th>Status</th><th>Amount</th></tr></thead><tbody>
        ${p.untracked.map((u) => `<tr><td>${esc(u.invoice_id)}</td><td>${esc(u.buyer)}</td><td>${esc(u.carrier)}</td><td class="num">${esc(u.tracking_number)}</td><td>${esc(u.status.toLowerCase())}</td><td class="num">${usd(u.amount)}</td></tr>`).join('')}
      </tbody></table>
      <div style="margin-top:14px"><button class="btn" id="sync">Push ${p.untracked.length} tracking number${p.untracked.length > 1 ? 's' : ''} to PayPal</button></div>` : '<p>All shipped orders have tracking on PayPal.</p>'}
    </div>
    <div class="panel">
      <h3>High-value orders shipped without signature confirmation (${p.unsigned.length})</h3>
      <p class="lead">PayPal Seller Protection requires signature confirmation for orders of $750 or more. Without it, a "not received" claim is decided against you even with delivery tracking.</p>
      ${p.unsigned.length ? `<table><thead><tr><th>Invoice</th><th>Buyer</th><th>Amount</th></tr></thead><tbody>${p.unsigned.map((u) => `<tr><td>${esc(u.invoice_id)}</td><td>${esc(u.buyer)}</td><td class="num">${usd(u.amount)}</td></tr>`).join('')}</tbody></table>` : '<p>None.</p>'}
    </div>`;
  $('#sync')?.addEventListener('click', async () => {
    const r = await api('/api/prevention/sync', { method: 'POST' });
    toast(`Pushed ${r.pushed} tracking number(s) to PayPal`);
    renderPrevention();
  });
}

// -------------------------------------------------------------- insights ----
async function renderInsights() {
  const i = await api('/api/insights');
  const maxLoss = Math.max(1, ...i.lossCauses.map((c) => c.amount));
  $('#tab-insights').innerHTML = `
    <div class="panel">
      <h2>Where you lose money</h2>
      <p class="lead">From your closed disputes. These outcomes also calibrate the win estimates, so the numbers reflect your store rather than an industry average.</p>
      <div class="bars">
        ${i.lossCauses.map((c) => `<div class="bar"><span>${esc(c.cause)}</span><div class="track"><i style="width:${(c.amount / maxLoss) * 100}%;background:var(--red)"></i></div><span class="num">${usd(c.amount)}</span></div>`).join('')}
      </div>
    </div>
    <div class="panel">
      <h3>Record by reason</h3>
      <div class="bars">
        ${i.byReason.map((r) => {
          const n = r.won + r.lost + r.settled;
          return `<div class="bar"><span>${esc(r.label)}</span><div class="track">
            <i style="width:${(r.won / n) * 100}%;background:var(--green)" title="won"></i>
            <i style="width:${(r.settled / n) * 100}%;background:var(--amber)" title="settled"></i>
            <i style="width:${(r.lost / n) * 100}%;background:var(--red)" title="lost"></i></div>
            <span class="num">${r.won}W ${r.settled}S ${r.lost}L</span></div>`;
        }).join('')}
      </div>
    </div>
    <div class="panel"><h3>This session</h3><p>${i.session.handled} dispute(s) handled, ${usd(i.session.expectedRecovered)} expected recovery.</p></div>`;
}

// -------------------------------------------------------------- activity ----
async function renderActivity() {
  const [audit, calls] = await Promise.all([api('/api/audit'), api('/api/paypal-calls').catch(() => [])]);
  $('#tab-activity').innerHTML = `
    <div class="panel">
      <h2>Audit trail</h2>
      <p class="lead">Every action Rebuttal took on PayPal, with the estimate it was based on.</p>
      ${audit.length ? `<table><thead><tr><th>Time</th><th>Dispute</th><th>Plan</th><th>Est. win</th><th>Calls</th></tr></thead><tbody>
        ${audit.map((e) => `<tr><td>${new Date(e.at).toLocaleTimeString()}</td><td>${esc(e.dispute_id || '-')}</td><td>${esc(e.plan)}</td><td class="num">${e.pWin != null ? pct(e.pWin) : '-'}</td><td>${e.results.map((r) => `${r.ok ? '&#10003;' : '&#10005;'} ${esc(r.label)}`).join('<br>')}</td></tr>`).join('')}
      </tbody></table>` : '<p>No actions yet.</p>'}
    </div>
    ${calls.length ? `<div class="panel"><h3>PayPal API calls (mock mode log)</h3><table><tbody>${calls.map((c) => `<tr><td class="num">${new Date(c.at).toLocaleTimeString()}</td><td class="num">${esc(c.method)}</td><td class="num">${esc(c.path)}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

loadStatus();
loadQueue();
