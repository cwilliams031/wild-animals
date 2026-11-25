/* Field Check cards: deck + card display, shared by the card viewer and the board game.
 *
 *   const data = await FieldCards.load();            // fetches questions.json + maps.json (same folder)
 *   const deck = FieldCards.createDeck(data, saved);  // saved = an earlier deck.save(), or nothing for a fresh game
 *   const card = deck.draw('desert', 'tf');           // type: 'mc' dark square, 'tf' medium, 'fb' light
 *   FieldCards.render(el, card, data, { onResult: correct => { deck.answer(card, correct); ... } });
 *   Light squares also deal "Guess this animal" picture cards (type 'pic', 5 per habitat) about 1 time in 4
 *   while any are left; they are answered like fill in the blank. deck.draw('ocean', 'pic') draws one directly.
 *   const final = deck.drawAny('ocean');              // final question: random type from the habitat the others picked
 *   FieldCards.render(el, final, data, { final: true, onResult: ... });
 *
 * Rules: a correct answer takes the card out of the deck; a wrong answer leaves it in (shuffled back).
 * The draw avoids the same animal twice in a row in a habitat when it can. Nothing is stored by this
 * module: the game keeps deck.save() with its own save data. Needs the Fredoka + Nunito Sans fonts
 * (added to the page automatically if missing).
 */
(function (root) {
  'use strict';
  const BIOMES = ['forest', 'desert', 'savanna', 'rainforest', 'steppe', 'freshwater', 'ocean', 'reef', 'arctic'];
  const TYPES = ['mc', 'tf', 'fb'];
  const TYPE_NAMES = { mc: 'Multiple choice', tf: 'True or false', fb: 'Fill in the blank', pic: 'Guess this animal' };
  const SQUARE_NAMES = { mc: 'Dark square', tf: 'Medium square', fb: 'Light square', pic: 'Light square' };
  const PIC_CHANCE = 0.25;   /* on a light square, how often a picture card comes up while any are left */
  const SQ = t => t === 'pic' ? 'fb' : t;   /* picture cards use the light square's shade */
  /* Square and card-frame colors per habitat: dark = multiple choice, medium = true or false, light = fill in the blank. */
  const SHADES = {
    forest: ['#265C19', '#50A136', '#ADDC96'], desert: ['#8A3A12', '#E07D38', '#F7C597'], savanna: ['#7A5200', '#DFA41E', '#F6D886'],
    rainforest: ['#075C3E', '#1BB07C', '#97E3C4'], steppe: ['#4F5A14', '#97A534', '#D3DB93'], freshwater: ['#005B66', '#00A9BA', '#96DEE9'],
    ocean: ['#163F7A', '#3C80D6', '#A6C9F2'], reef: ['#8E2038', '#E8647B', '#F8B2BF'], arctic: ['#1F5A80', '#58A6D3', '#BBE0F3']
  };
  /* The book's chapter colors, used for the habitat map (tile, ink, muted, highlight) exactly like the profile pages. */
  const BOOK = {
    forest: ['#253822', '#F0F3E6', '#BDC8AE', '#E3B04B'], rainforest: ['#183A2C', '#ECF6EF', '#B3CFC0', '#F29A3A'], desert: ['#4A2E1D', '#FBEFE0', '#E0C6AA', '#5FC7BD'],
    savanna: ['#3D3318', '#FAF3DA', '#DCCFA4', '#E9875A'], steppe: ['#343B29', '#F1F3E8', '#C6CCB4', '#C9A3E0'], freshwater: ['#173E45', '#E9F6F7', '#B1D0D4', '#B5DB6E'],
    ocean: ['#173150', '#EAF1FA', '#B1C3DB', '#F2C24B'], reef: ['#4C212B', '#FFF0EC', '#EBC3C3', '#4FD1CC'], arctic: ['#22343F', '#EEF5F8', '#B9CCD6', '#F07A6A']
  };
  const WHERE = {
    forest: 'North America, Europe, Asia & Australia', desert: 'The Americas, Africa, Asia & Australia', savanna: 'Africa, south of the Sahara',
    rainforest: 'Central & South America, Africa & Southeast Asia', steppe: 'North & South America, Europe & Asia', freshwater: 'Big rivers and lakes around the world',
    ocean: 'Every ocean on Earth', reef: 'Warm, shallow seas near the equator', arctic: 'The far north: Arctic lands and frozen seas'
  };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lum = h => { const n = parseInt(h.slice(1), 16), f = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(n >> 16) + .7152 * f(n >> 8 & 255) + .0722 * f(n & 255); };
  const frame = (b, t) => SHADES[b][TYPES.indexOf(SQ(t))];
  const onFrame = (b, t) => lum(frame(b, t)) > .3 ? SHADES[b][0] : '#FFFFFF';
  const pick = a => a[Math.floor(Math.random() * a.length)];

  function load(base) {
    base = base || '';
    return Promise.all([
      fetch(base + 'questions.json').then(r => { if (!r.ok) throw new Error('questions.json did not load'); return r.json(); }),
      fetch(base + 'maps.json').then(r => r.ok ? r.json() : null).catch(() => null)
    ]).then(([q, maps]) => ({ biomes: q.biomes, cards: q.cards, maps, base }));
  }

  function createDeck(data, saved) {
    const used = new Set((saved && saved.used) || []);
    const last = Object.assign({}, (saved && saved.last) || {});
    const byId = new Map(data.cards.map(c => [c.id, c]));
    /* 'fb' means the whole light-square deck (fill in the blank + picture cards); 'pic' means picture cards only. */
    const fits = (c, t) => !t || c.type === t || (t === 'fb' && c.type === 'pic');
    const pool = (b, t) => data.cards.filter(c => c.biome === b && fits(c, t) && !used.has(c.id));
    const only = (b, t) => data.cards.filter(c => c.biome === b && c.type === t && !used.has(c.id));
    function choose(list, b) {
      if (!list.length) return null;
      const fresh = list.filter(c => c.animal !== last[b]);
      const c = pick(fresh.length ? fresh : list);
      last[b] = c.animal;
      return c;
    }
    return {
      /* A card of this type from this habitat, or null if none are left of that type. */
      draw(b, t) {
        if (t === 'fb') {
          const pics = only(b, 'pic'), words = only(b, 'fb');
          if (pics.length && (!words.length || Math.random() < PIC_CHANCE)) return choose(pics, b);
          return choose(words, b);
        }
        return choose(pool(b, t), b);
      },
      /* Final question: any type, at random, from the habitat the other players picked. */
      drawAny(b) { const t = pick(TYPES.filter(x => pool(b, x).length)); return t ? this.draw(b, t) : null; },
      /* Correct: out of the deck. Wrong: stays in, so it can come up again. */
      answer(card, correct) { if (correct) used.add(card.id); },
      remaining(b, t) { return pool(b, t).length; },
      total(b, t) { return data.cards.filter(c => c.biome === b && fits(c, t)).length; },
      isUsed(id) { return used.has(id); },
      reset(b) { if (!b) used.clear(); else for (const id of [...used]) if (byId.get(id).biome === b) used.delete(id); },
      save() { return { used: [...used], last: Object.assign({}, last) }; }
    };
  }

  const CSS = `
.fc-root{--fc-face:#FBF7EE;--fc-ink:#22252A;--fc-muted:#5E6168;--fc-good:#1E8E4E;--fc-bad:#C2362F;position:relative;isolation:isolate;max-width:720px;font-family:'Nunito Sans',system-ui,sans-serif}
.fc-root *{box-sizing:border-box;min-width:0}
.fc-root::before,.fc-root::after{content:"";position:absolute;inset:0;border-radius:24px;background:var(--k);z-index:0;filter:brightness(.85)}
.fc-root::before{transform:rotate(-2.4deg) translate(-8px,10px)}
.fc-root::after{transform:rotate(1.8deg) translate(8px,6px);filter:brightness(.93)}
.fc-card{position:relative;z-index:2;background:var(--k);color:var(--kt);border-radius:24px;padding:16px;box-shadow:0 16px 30px rgba(0,0,0,.22);min-height:420px;display:flex;flex-direction:column}
.fc-ch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 8px 14px}
.fc-t{display:block;font:700 clamp(26px,3.4vw,34px)/1 'Fredoka',sans-serif}
.fc-h{display:block;font:600 16px/1.3 'Fredoka',sans-serif;opacity:.95;margin-top:6px}
.fc-fin{display:inline-block;margin-bottom:8px;background:var(--fc-face);color:var(--fc-ink);border-radius:999px;padding:3px 12px;font:600 14px 'Fredoka',sans-serif}
.fc-map{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.fc-map svg{display:block;width:clamp(160px,26vw,240px);height:auto;border-radius:10px}
.fc-wh{font-size:12px;font-weight:700;max-width:240px;text-align:right;line-height:1.3;color:var(--kt)}
.fc-face{flex:1;background:var(--fc-face);color:var(--fc-ink);border-radius:16px;padding:clamp(18px,3vw,28px);display:flex;flex-direction:column;gap:18px}
.fc-qx{font-size:clamp(21px,2.6vw,26px);font-weight:800;line-height:1.35;margin:0;text-wrap:pretty}
.fc-nm{background:none;color:var(--d);box-shadow:inset 0 -0.38em 0 color-mix(in srgb,var(--m) 30%,transparent);padding:0 2px;border-radius:2px}
.fc-opts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.fc-opt{display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 14px;border-radius:14px;border:2px solid #E2DBCC;background:#fff;color:var(--fc-ink);font:700 17px/1.3 'Nunito Sans',sans-serif;text-align:left;cursor:pointer}
.fc-opt:hover:not(:disabled){border-color:var(--d)}
.fc-opt:focus-visible,.fc-act:focus-visible{outline:3px solid #2F7BF5;outline-offset:2px}
.fc-l{flex:none;width:32px;height:32px;border-radius:50%;display:grid;place-items:center;background:var(--d);color:#fff;font:600 16px 'Fredoka',sans-serif}
.fc-opt:disabled{cursor:default}
.fc-opt.fc-right{border-color:var(--fc-good);background:#E6F4EA}.fc-opt.fc-right .fc-l{background:var(--fc-good)}
.fc-opt.fc-wrong{border-color:var(--fc-bad);background:#FBE9E7}.fc-opt.fc-wrong .fc-l{background:var(--fc-bad)}
.fc-tf .fc-opt{justify-content:center;font:600 22px 'Fredoka',sans-serif;min-height:64px}
.fc-row{display:flex;flex-wrap:wrap;gap:10px}
.fc-act{min-height:48px;padding:0 20px;border-radius:999px;border:0;background:var(--d);color:#fff;font:600 18px 'Fredoka',sans-serif;cursor:pointer;box-shadow:inset 0 -3px 0 rgba(0,0,0,.2)}
.fc-act.fc-alt{background:#fff;color:var(--fc-ink);border:2px solid #E2DBCC;box-shadow:none}
.fc-res{border-radius:14px;padding:12px 16px;font-weight:700}
.fc-res b{display:block;font:600 20px 'Fredoka',sans-serif}
.fc-ok{background:#E6F4EA;color:#14532D}.fc-no{background:#FBE9E7;color:#7F1D1D}.fc-show{background:color-mix(in srgb,var(--m) 22%,#fff);color:var(--fc-ink)}
.fc-pic{margin:0;position:relative;border-radius:12px;overflow:hidden;background:#D9D2C3;aspect-ratio:3/2}
.fc-pic img{display:block;width:100%;height:100%;object-fit:cover}
.fc-cr{position:absolute;right:8px;bottom:6px;font-size:11px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.7)}
.fc-pq{font:600 clamp(22px,2.8vw,28px)/1.2 'Fredoka',sans-serif;margin:0}
.fc-id{align-self:flex-end;margin-top:auto;font:600 13px 'Fredoka',sans-serif;color:var(--fc-muted)}
.fc-empty{flex:1;display:grid;place-items:center;text-align:center;color:var(--fc-muted);font-size:18px}
.fc-empty b{display:block;font:600 26px 'Fredoka',sans-serif;color:var(--fc-ink);margin-bottom:6px}
@media(max-width:560px){.fc-ch{flex-wrap:wrap}.fc-map svg{width:150px}.fc-opts{grid-template-columns:minmax(0,1fr)}.fc-card{min-height:0}}
@media(prefers-reduced-motion:no-preference){.fc-card.fc-deal{animation:fc-deal .35s ease-out both}@keyframes fc-deal{from{transform:translateY(20px) rotate(-2deg);opacity:0}to{transform:none;opacity:1}}}`;

  function setup(data) {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('fc-style')) {
      const st = document.createElement('style'); st.id = 'fc-style'; st.textContent = CSS; document.head.appendChild(st);
    }
    if (!document.querySelector('link[href*="Fredoka"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito+Sans:wght@400;600;700;800&display=swap';
      document.head.appendChild(l);
    }
    if (data && data.maps && !document.getElementById('fc-landclip')) {
      document.body.insertAdjacentHTML('beforeend', `<svg id="fc-landclip" width="0" height="0" style="position:fixed;left:0;top:0;width:0;height:0;overflow:hidden" aria-hidden="true"><defs><clipPath id="LANDCLIP"><path d="${data.maps.land}" clip-rule="evenodd"></path></clipPath></defs></svg>`);
    }
  }

  function biomeName(data, b) { const x = data.biomes.find(y => y.id === b); return x ? x.name : b; }

  /* The habitat map, drawn like the book's profile-page range maps. */
  function mapSvg(data, b) {
    const M = data.maps; if (!M) return '';
    const [tile, ink, muted, hi] = BOOK[b], h = M.maps[b] || '', sea = b === 'ocean' || b === 'reef';
    const land = `<path d="${M.land}" fill="${sea ? muted : ink}" fill-opacity="${sea ? 1 : .28}" fill-rule="evenodd"></path>`;
    return `<svg viewBox="0 0 ${M.w} ${M.h}" role="img" aria-label="World map showing where ${esc(biomeName(data, b))} animals live: ${esc(WHERE[b])}" style="background:${tile};--hl:${hi};--sea:${tile}">${b === 'ocean' ? h + land : land + h}</svg><span class="fc-wh">Where they live: ${esc(WHERE[b])}</span>`;
  }

  function question(c) {
    const s = c.nameSpan; if (!s) return esc(c.q);
    return esc(c.q.slice(0, s[0])) + '<mark class="fc-nm">' + esc(c.q.slice(s[0], s[1])) + '</mark>' + esc(c.q.slice(s[1]));
  }

  /* Draws a card into el. card may be null (no cards of that type left): pass opts.biome and opts.type then.
     opts: { onResult(correct, card), final: bool, deal: bool (default true), base: folder of the photos/ folder (default: same as the page) } */
  function render(el, card, data, opts) {
    opts = opts || {};
    setup(data);
    const b = card ? card.biome : opts.biome, t = card ? card.type : opts.type;
    el.className = 'fc-root';
    el.setAttribute('style', `--d:${SHADES[b][0]};--m:${SHADES[b][1]};--l:${SHADES[b][2]};--k:${frame(b, t)};--kt:${onFrame(b, t)}`);
    const head = `<div class="fc-ch"><div>${opts.final ? '<span class="fc-fin">Final question</span>' : ''}<span class="fc-t">${esc(TYPE_NAMES[t])}</span><span class="fc-h">${esc(biomeName(data, b))}</span></div><div class="fc-map">${mapSvg(data, b)}</div></div>`;
    if (!card) {
      el.innerHTML = `<div class="fc-card">${head}<div class="fc-face"><div class="fc-empty"><div><b>No ${esc(TYPE_NAMES[SQ(t)].toLowerCase())} cards left</b>Every one in this habitat has been answered.</div></div></div></div>`;
      return;
    }
    let body = '';
    if (card.type === 'mc') body = `<div class="fc-opts">${card.options.map((o, k) => `<button class="fc-opt" type="button" data-pick="${'ABCD'[k]}"><span class="fc-l">${'ABCD'[k]}</span>${esc(o)}</button>`).join('')}</div>`;
    if (card.type === 'tf') body = `<div class="fc-opts fc-tf"><button class="fc-opt" type="button" data-pick="True">True</button><button class="fc-opt" type="button" data-pick="False">False</button></div>`;
    if (card.type === 'fb' || card.type === 'pic') body = `<div class="fc-row"><button class="fc-act" type="button" data-do="show">Show the answer</button></div>`;
    const base = opts.base != null ? opts.base : (data.base || '');
    const prompt = card.type === 'pic'
      ? `<figure class="fc-pic"><img src="${esc(base + card.photo)}" alt="Photo of the mystery animal" width="${card.w || 1200}" height="${card.h || 800}" style="object-position:${esc(card.focus || '50% 50%')}"><figcaption class="fc-cr">Photo: ${esc(card.credit || 'Unsplash')}</figcaption></figure><p class="fc-pq">What animal is this?</p>`
      : `<p class="fc-qx">${question(card)}</p>`;
    el.innerHTML = `<div class="fc-card">${head}<div class="fc-face">${prompt}${body}<div class="fc-out" aria-live="polite"></div><span class="fc-id">Card ${esc(card.id)}</span></div></div>`;
    const cardEl = el.firstElementChild, out = el.querySelector('.fc-out');
    if (opts.deal !== false) { cardEl.classList.remove('fc-deal'); void cardEl.offsetWidth; cardEl.classList.add('fc-deal'); }
    let done = false;
    function finish(ok) {
      if (done) return; done = true;
      out.innerHTML = ok ? `<div class="fc-res fc-ok"><b>Correct!</b>${esc(card.answer)}</div>`
                         : `<div class="fc-res fc-no"><b>Not this time.</b>The answer is: ${esc(card.answer)}</div>`;
      if (opts.onResult) opts.onResult(ok, card);
    }
    el.onclick = e => {
      const o = e.target.closest('.fc-opt');
      if (o && !o.disabled) {
        const right = card.type === 'mc' ? card.answer.trim()[0] : (card.answer.trim().startsWith('True') ? 'True' : 'False');
        el.querySelectorAll('.fc-opt').forEach(x => { x.disabled = true; if (x.dataset.pick === right) x.classList.add('fc-right'); });
        if (o.dataset.pick !== right) o.classList.add('fc-wrong');
        finish(o.dataset.pick === right); return;
      }
      const a = e.target.closest('[data-do]'); if (!a) return;
      if (a.dataset.do === 'show') {
        a.parentNode.remove();
        out.innerHTML = `<div class="fc-res fc-show"><b>Answer: ${esc(card.answer)}</b>Did you get it?</div><div class="fc-row" style="margin-top:10px"><button class="fc-act" type="button" data-do="yes">We got it</button><button class="fc-act fc-alt" type="button" data-do="no">We missed it</button></div>`;
      }
      if (a.dataset.do === 'yes') finish(true);
      if (a.dataset.do === 'no') finish(false);
    };
  }

  root.FieldCards = { load, createDeck, render, mapSvg, BIOMES, TYPES, TYPE_NAMES, SQUARE_NAMES, SHADES, BOOK, WHERE, PIC_CHANCE };
})(typeof window !== 'undefined' ? window : this);
