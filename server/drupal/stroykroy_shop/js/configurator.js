/**
 * Конфигуратор лекал: форма (типовой размер или свои мерки, прибавки, опции, элементы) + образец чертежа с водяным знаком.
 * Чертёж считает сервер (/sk-api/…): построения в браузер не попадают, пришла только картинка и описание полей.
 */
(function (drupalSettings) {
  'use strict';
  var cfg = drupalSettings && drupalSettings.stroykroyShop;
  var root = document.getElementById('sk-configurator');
  if (!cfg || !root) return;

  var sel = { figure: undefined, height: null, bust: null, measurements: null, eases: {}, easeValues: {}, options: {}, elements: {}, seam: 1 };
  var form = null;          // последний ответ сервера (поля формы)
  var timer = null, ctrl = null, seq = 0;
  var els = {};             // ссылки на узлы
  var optionsSig = '';
  var easeSig = '';

  function h(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function fmt(v) { return String(Math.round(v * 100) / 100).replace('.', ','); }
  function parse(t) {
    var s = String(t).replace(/\s+/g, '').replace(',', '.');
    if (s === '' || s === '-' || s === '.') return null;
    var n = Number(s);
    return isFinite(n) ? n : null;
  }

  function request(immediate) {
    clearTimeout(timer);
    timer = setTimeout(run, immediate ? 0 : 450);
  }

  var FIXING = 'Мы уже знаем об этой ошибке и исправляем её. Попробуйте другие параметры или загляните позже.';

  function run() {
    publishSelection();
    if (ctrl) ctrl.abort();
    ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var my = ++seq;
    if (els.preview) els.preview.classList.add('is-loading');
    fetch(cfg.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, selection: sel }),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      if (my !== seq) return;
      if (!res.ok) { showError(res.j && res.j.error === 'build_failed' ? FIXING : (res.j && res.j.error ? res.j.error : 'Не удалось получить чертёж')); return; }
      apply(res.j);
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      showError('Нет связи с сервером чертежей. Попробуйте позже.');
    });
  }

  // Выбор покупателя передаётся вместе с формой «В корзину»; сайт проверит его заново на сервере
  function publishSelection() {
    var f = document.querySelector('input[name="sk_selection"]');
    if (f) { try { f.value = JSON.stringify(sel); } catch (e) { /* нет */ } }
  }

  // На случай, если нажали «В корзину» раньше, чем сработал пересчёт, обновляем выбор прямо при отправке формы
  document.addEventListener('submit', publishSelection, true);

  function showError(text) {
    if (!els.preview) { root.textContent = text; return; }
    els.preview.classList.remove('is-loading');
    failed(text);
  }

  // Чертёж не построился: вместо картинки — короткая надпись, под ней — что мы уже знаем об ошибке
  function failed(detail) {
    els.img.style.display = 'none';
    els.fail.style.display = '';
    els.status.textContent = detail === FIXING ? FIXING : (detail || FIXING);
  }

  function okShown() {
    els.img.style.display = '';
    els.fail.style.display = 'none';
  }

  function apply(j) {
    form = j.form;
    if (!els.preview) build();
    els.preview.classList.remove('is-loading');
    if (j.error) {
      failed(j.error === 'build_failed' ? FIXING : 'Чертёж не построился: ' + j.error);
    } else {
      okShown();
      els.status.textContent = '';
      els.img.src = j.kind === 'svg' ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(j.image) : j.image;
    }
    syncFigure();
    syncEases();
    syncOptions();
    syncElements();
    syncGallery();
    window.StroyKroyConfigurator = { model: cfg.model, selection: sel, form: form };
  }

  /* ---------- галерея: фото товара переезжают в левую колонку над чертежом ----------
     Фото основы берём из поля товара; когда выбран элемент (рукав и т. п.) с фото, показываем фото элемента. */
  var gallery = null;      // { box, main, row }
  var basePhotos = [];     // фото основы: [{src, alt}]
  var gallerySig = null;
  function elementPhotoList() {
    var all = cfg.elementPhotos || {};
    var chosen = form ? form.elements || [] : [];
    for (var i = 0; i < chosen.length; i++) {
      var e = chosen[i];
      var urls = all[e.kind] && all[e.kind][e.selected];
      if (urls && urls.length) return urls.map(function (u) { return { src: u, alt: '' }; });
    }
    return null;
  }
  function showPhotos(list) {
    if (!gallery) return;
    var sig = list.map(function (x) { return x.src; }).join('|');
    if (sig === gallerySig) return;
    gallerySig = sig;
    gallery.row.textContent = '';
    gallery.box.style.display = list.length ? '' : 'none';
    if (!list.length) return;
    gallery.main.src = list[0].src; gallery.main.alt = list[0].alt;
    gallery.row.style.display = list.length > 1 ? '' : 'none';
    list.forEach(function (it, i) {
      var t = h('button', { type: 'button', class: 'sk-gallery__thumb' + (i === 0 ? ' is-active' : '') }, [h('img', { src: it.src, alt: it.alt })]);
      t.addEventListener('click', function () {
        gallery.main.src = it.src; gallery.main.alt = it.alt;
        Array.prototype.forEach.call(gallery.row.children, function (c) { c.classList.remove('is-active'); });
        t.classList.add('is-active');
      });
      gallery.row.appendChild(t);
    });
  }
  /* ---------- технический рисунок слоями: основа + выбранные элементы, привязанные по двум точкам ---------- */
  var sketchImgs = {};
  function loadImg(src, cb) {
    var rec = sketchImgs[src];
    if (rec && rec.done) return cb(rec.img);
    if (rec) return rec.cbs.push(cb);
    rec = sketchImgs[src] = { img: new Image(), cbs: [cb], done: false };
    rec.img.onload = rec.img.onerror = function () { rec.done = true; rec.cbs.splice(0).forEach(function (f) { f(rec.img); }); };
    rec.img.src = src;
  }
  function pairOf(p) { return p && p.length >= 2 && p[0] && p[1] ? p : null; }
  function similarity(e, b) {
    var ex = e[1].x - e[0].x, ey = e[1].y - e[0].y, bx = b[1].x - b[0].x, by = b[1].y - b[0].y;
    var le = Math.hypot(ex, ey), lb = Math.hypot(bx, by);
    if (le < 1e-6 || lb < 1e-6) return null;
    var k = lb / le, th = Math.atan2(by, bx) - Math.atan2(ey, ex), a = k * Math.cos(th), c = k * Math.sin(th);
    return [a, c, -c, a, b[0].x - (a * e[0].x - c * e[0].y), b[0].y - (c * e[0].x + a * e[0].y)];
  }
  function sketchLayers() {
    var sk = cfg.sketch, all = cfg.elementSketches || {};
    if (!sk || !sk.src) return null;
    var layers = [];
    (form ? form.elements || [] : []).forEach(function (e) {
      var es = all[e.kind] && all[e.kind][e.selected];
      var anchors = pairOf(sk.anchors && sk.anchors[e.kind]);
      var pts = es && pairOf(es.points);
      var m = anchors && pts ? similarity(pts, anchors) : null;
      if (es && m) layers.push({ src: es.src, w: es.w, h: es.h, m: m, behind: !!es.behind });
    });
    return layers;
  }
  var sketchSig = null, sketchUrl = null;
  function renderSketch(done) {
    var layers = sketchLayers();
    if (!layers) { sketchSig = null; sketchUrl = null; return done(null); }
    var sig = layers.map(function (l) { return l.src + l.m.join(','); }).join('|');
    if (sig === sketchSig) return done(sketchUrl);
    var todo = [cfg.sketch.src].concat(layers.map(function (l) { return l.src; }));
    var left = todo.length;
    todo.forEach(function (u) {
      loadImg(u, function () {
        if (--left) return;
        var W = cfg.sketch.w, H = cfg.sketch.h, scale = Math.min(1, 1400 / Math.max(W, H));
        var cv = document.createElement('canvas');
        cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        function draw(src, w, h, m) {
          var im = sketchImgs[src].img;
          if (!im.naturalWidth) return;
          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          if (m) ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
          ctx.drawImage(im, 0, 0, w, h);
        }
        layers.filter(function (l) { return l.behind; }).forEach(function (l) { draw(l.src, l.w, l.h, l.m); });
        draw(cfg.sketch.src, W, H, null);
        layers.filter(function (l) { return !l.behind; }).forEach(function (l) { draw(l.src, l.w, l.h, l.m); });
        try { sketchUrl = cv.toDataURL('image/png'); sketchSig = sig; } catch (e) { sketchUrl = null; }
        done(sketchUrl);
      });
    });
  }
  var syncToken = 0;
  function syncGallery() {
    if (!gallery) return;
    var token = ++syncToken;
    var photos = elementPhotoList() || basePhotos;
    renderSketch(function (url) {
      if (token !== syncToken) return;
      showPhotos(url ? [{ src: url, alt: 'Технический рисунок' }].concat(photos) : photos);
    });
  }
  function buildGallery() {
    var field = document.querySelector('.field--name-field-photos');
    if (field) {
      Array.prototype.forEach.call(field.querySelectorAll('img'), function (im) { if (im.getAttribute('src')) basePhotos.push({ src: im.getAttribute('src'), alt: im.getAttribute('alt') || '' }); });
      field.style.display = 'none';
    }
    if (!basePhotos.length && !Object.keys(cfg.elementPhotos || {}).length && !cfg.sketch) return null;
    var main = h('img', { src: '', alt: '' });
    var row = h('div', { class: 'sk-gallery__thumbs' });
    var box = h('div', { class: 'sk-gallery' }, [h('div', { class: 'sk-gallery__main' }, [main]), row]);
    gallery = { box: box, main: main, row: row };
    syncGallery();
    return box;
  }

  /* ---------- построение формы (один раз) ---------- */
  function build() {
    root.textContent = '';
    var left = h('div', {});
    var right = h('div', { class: 'sk-cfg__preview' });

    // Типовой размер
    left.appendChild(h('h3', { text: 'Размер' }));
    els.figure = h('select', {});
    left.appendChild(els.figure);
    els.figure.addEventListener('change', function () {
      if (els.figure.value === '') return;
      sel.figure = els.figure.value;
      sel.measurements = null; sel.height = null; sel.bust = null;
      measuresRendered = false;
      request(true);
    });
    els.body = h('div', { class: 'sk-grid2' });
    left.appendChild(els.body);

    els.measures = h('div', {});
    left.appendChild(els.measures);
    els.easeBox = h('div', {});
    left.appendChild(els.easeBox);

    // Опции и элементы
    els.elements = h('div', {});
    els.options = h('div', {});
    left.appendChild(els.elements);
    left.appendChild(els.options);

    // Припуск на швы: поле показываем только у моделей со спеком припуска (spec_seam_allowance_max), пока таких в данных нет
    if (cfg.seamSpec) {
      left.appendChild(h('h3', { text: 'Припуск на швы' }));
      var seam = h('input', { type: 'number', step: '0.1', min: '0', max: '5', value: '1' });
      seam.addEventListener('input', function () { var v = parse(seam.value); if (v !== null && v >= 0 && v <= 5) { sel.seam = v; request(); } });
      left.appendChild(h('label', { text: 'Размер припуска, см' }));
      left.appendChild(seam);
    }

    var gal = buildGallery();
    var wrap = h('div', { class: 'sk-cfg' }, gal ? [gal, left] : [left]);
    root.appendChild(wrap);

    els.img = h('img', { alt: 'Образец лекал', draggable: 'false' });
    els.img.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    els.status = h('div', { class: 'sk-cfg__status' });
    els.fail = h('div', { class: 'sk-cfg__fail', text: 'Чертёж для этих параметров не построился', style: 'display:none' });
    right.appendChild(els.img);
    right.appendChild(els.fail);
    right.appendChild(els.status);
    right.appendChild(h('div', { class: 'sk-cfg__note', text: 'Лекала строятся по вашим меркам: после оплаты вы получите файлы PDF (для печати на A4 и в натуральную величину) и DXF, а также DXF-AAMA для 3D-программ.' }));
    els.preview = right;
    twoCols(right);
    widen();
  }

  /* ---------- раскладка страницы: слева только чертёж, справа всё остальное ---------- */
  var wideEl = root;
  function twoCols(preview) {
    try {
      var form = document.querySelector('form[id^="commerce-order-item-add-to-cart-form"], form.commerce-order-item-add-to-cart-form');
      var C = root.parentElement;
      while (C && C !== document.body && !(form && C.contains(form))) C = C.parentElement;
      if (!C || C === document.body || C === document.documentElement) C = root.parentElement;
      var grid = h('div', { class: 'sk-product' });
      var lc = h('div', { class: 'sk-product__left' });
      var rc = h('div', { class: 'sk-product__right' });
      grid.appendChild(lc); grid.appendChild(rc);
      C.insertBefore(grid, C.firstChild);
      Array.prototype.slice.call(C.childNodes).forEach(function (n) { if (n !== grid) rc.appendChild(n); });
      lc.appendChild(preview);
      root.style.width = ''; root.style.marginLeft = '';
      wideEl = grid;
    } catch (e) { /* раскладка не удалась — страница остаётся как есть */ }
  }

  var measuresRendered = false;
  var bodyShown = false;

  /* ---------- типовой размер и мерки ---------- */
  function syncFigure() {
    // список фигур — один раз
    if (!els.figure.options.length) {
      els.figure.appendChild(h('option', { value: '', text: 'Свои мерки' }));
      form.figures.forEach(function (g) {
        var og = h('optgroup', { label: g.title });
        g.items.forEach(function (id) { og.appendChild(h('option', { value: id, text: id })); });
        els.figure.appendChild(og);
      });
    }
    els.figure.value = form.figure || '';
    // рост и обхват груди — только для своих мерок
    var custom = !form.figure;
    if (custom !== bodyShown) {
      bodyShown = custom;
      els.body.textContent = '';
    }
    if (custom && !els.body.firstChild) {
      els.body.appendChild(numberField('Рост, см', form.height, function (v) { sel.height = v; }, 100, 230));
      els.body.appendChild(numberField('Обхват груди, см', form.bust, function (v) { sel.bust = v; }, 60, 200));
    }
    if (!measuresRendered || els.measures.getAttribute('data-fig') !== (form.figure || '')) renderMeasures();
    measuresRendered = true;
  }

  function numberField(label, value, onValue, lo, hi) {
    var inp = h('input', { type: 'text', inputmode: 'decimal', value: fmt(value) });
    inp.addEventListener('input', function () {
      var v = parse(inp.value);
      if (v === null || v < lo || v > hi) return;
      onValue(v);
      request();
    });
    return h('div', {}, [h('label', { text: label }), inp]);
  }

  function ensureCustom() {
    // первая правка: фиксируем все текущие значения, дальше считаем «по своим меркам»
    if (sel.figure !== null || !sel.measurements) {
      sel.measurements = {};
      form.measurements.forEach(function (m) { sel.measurements[m.key] = m.value; });
      sel.height = form.height; sel.bust = form.bust;
      sel.figure = null;
      els.measures.setAttribute('data-fig', ''); // перерисовывать поля при вводе не нужно
    }
  }

  function renderMeasures() {
    els.measures.textContent = '';
    els.measures.setAttribute('data-fig', form.figure || '');
    if (form.measurements.length) {
      var det = h('details', {});
      det.appendChild(h('summary', { text: 'Мерки, см' }));
      form.measurements.forEach(function (m) {
        var inp = h('input', { type: 'text', inputmode: 'decimal', value: fmt(m.value) });
        inp.addEventListener('input', function () {
          var v = parse(inp.value);
          if (v === null || v <= 0 || v >= 400) return;
          ensureCustom();
          sel.measurements[m.key] = v;
          request();
        });
        det.appendChild(h('div', { class: 'sk-row' }, [h('span', { text: m.name }), inp]));
      });
      det.appendChild(h('div', { class: 'sk-hint', text: 'Если измените мерку, размер станет «Свои мерки».' }));
      els.measures.appendChild(det);
    }
    form.eases.forEach(function (g) {
      var det = h('details', {});
      det.appendChild(h('summary', { text: g.title }));
      // Эти прибавки покупатель не меняет: показываем для ознакомления, без поля ввода
      g.items.forEach(function (it) {
        det.appendChild(h('div', { class: 'sk-row sk-row--ro' }, [h('span', { text: it.name }), h('span', { class: 'sk-ro', text: fmt(it.value) })]));
      });
      els.measures.appendChild(det);
    });
  }

  /* ---------- прибавки из файла Leko: у каждой виден диапазон ---------- */
  function syncEases() {
    var list = form.easeList || [];
    var sig = JSON.stringify(list.map(function (e) { return [e.name, Math.round(e.min * 100), Math.round(e.max * 100)]; }));
    if (sig === easeSig) {
      // диапазоны и размер в лекалах обновляем на месте, поля не трогаем
      list.forEach(function (e) {
        var hint = els.easeBox.querySelector('[data-hint="' + e.name + '"]');
        if (hint) hint.textContent = easeHint(e);
      });
      return;
    }
    easeSig = sig;
    els.easeBox.textContent = '';
    if (!list.length) return;
    var det = h('details', {});
    det.appendChild(h('summary', { text: 'Размеры и посадка (прибавки)' }));
    list.forEach(function (e) {
      var inp = h('input', { type: 'text', inputmode: 'decimal', placeholder: e.default !== null ? fmt(e.default) : 'авто' });
      if (sel.easeValues[e.name] !== undefined) inp.value = fmt(sel.easeValues[e.name]);
      inp.addEventListener('input', function () {
        if (inp.value.trim() === '') { delete sel.easeValues[e.name]; request(); return; }
        var v = parse(inp.value);
        if (v === null) return;
        sel.easeValues[e.name] = Math.min(e.max, Math.max(e.min, v));
        request();
      });
      inp.addEventListener('blur', function () {
        if (sel.easeValues[e.name] !== undefined) inp.value = fmt(sel.easeValues[e.name]);
      });
      det.appendChild(h('div', { class: 'sk-row' }, [h('span', { text: e.unit && e.title.slice(-e.unit.length) !== e.unit ? e.title + ', ' + e.unit : e.title }), inp]));
      det.appendChild(h('div', { class: 'sk-hint', 'data-hint': e.name, text: easeHint(e) }));
    });
    els.easeBox.appendChild(det);
  }

  function easeHint(e) {
    var t = 'допустимо от ' + fmt(e.min) + ' до ' + fmt(e.max) + (e.unit ? ' ' + e.unit : '');
    if (e.pattern !== null && e.pattern !== undefined) t += ' · в лекалах сейчас ' + fmt(e.pattern) + (e.unit ? ' ' + e.unit : '');
    return t;
  }

  /* ---------- опции и элементы ---------- */
  function syncElements() {
    els.elements.textContent = '';
    if (!form.elements.length) return;
    els.elements.appendChild(h('h3', { text: 'Модель' }));
    form.elements.forEach(function (e) {
      var s = h('select', {});
      e.choices.forEach(function (c) { s.appendChild(h('option', { value: c.id, text: c.name })); });
      s.value = e.selected;
      s.addEventListener('change', function () { sel.elements[e.kind] = s.value; optionsSig = ''; request(true); });
      els.elements.appendChild(h('label', { text: e.title }));
      els.elements.appendChild(s);
    });
  }

  function syncOptions() {
    var sig = JSON.stringify(form.options.map(function (o) { return [o.name, o.value, o.values ? o.values.length : 0]; }));
    if (sig === optionsSig) return;
    optionsSig = sig;
    els.options.textContent = '';
    if (!form.options.length) return;
    els.options.appendChild(h('h3', { text: 'Опции' }));
    form.options.forEach(function (o) {
      els.options.appendChild(h('label', { text: o.title }));
      if (o.values) {
        var s = h('select', {});
        o.values.forEach(function (v) { s.appendChild(h('option', { value: String(v.value), text: v.label })); });
        s.value = String(o.value);
        s.addEventListener('change', function () { sel.options[o.name] = Number(s.value); request(true); });
        els.options.appendChild(s);
      } else {
        var inp = h('input', { type: 'text', inputmode: 'decimal', value: fmt(o.value) });
        inp.addEventListener('input', function () { var v = parse(inp.value); if (v !== null) { sel.options[o.name] = v; request(); } });
        els.options.appendChild(inp);
        if (o.hint) els.options.appendChild(h('div', { class: 'sk-hint', text: o.hint }));
      }
    });
  }

  /* ---------- широкая раскладка: чертёж слева, форма справа ----------
     Тема сайта держит содержимое товара в узкой колонке со смещением. Растягиваем блок конфигуратора
     до ширины окна (не больше 1100 px) и центрируем по окну, чтобы слева не оставалось пустое место. */
  function widen() {
    wideEl.style.width = ''; wideEl.style.marginLeft = '';
    var vw = document.documentElement.clientWidth;
    if (vw < 900) return;
    var target = Math.min(1200, vw - 48);
    var r = wideEl.getBoundingClientRect();
    if (target <= r.width + 8) return;
    wideEl.style.width = target + 'px';
    wideEl.style.marginLeft = ((vw - target) / 2 - r.left) + 'px';
  }
  window.addEventListener('resize', widen);
  setTimeout(widen, 0);
  setTimeout(widen, 600);

  run();
})(window.drupalSettings);
