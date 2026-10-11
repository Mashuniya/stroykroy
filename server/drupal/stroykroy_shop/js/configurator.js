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

  function run() {
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
      if (!res.ok) { showError(res.j && res.j.error ? res.j.error : 'Не удалось получить чертёж'); return; }
      apply(res.j);
    }).catch(function (e) {
      if (e && e.name === 'AbortError') return;
      showError('Нет связи с сервером чертежей. Попробуйте позже.');
    });
  }

  function showError(text) {
    if (!els.preview) { root.textContent = text; return; }
    els.preview.classList.remove('is-loading');
    els.status.textContent = text;
  }

  function apply(j) {
    form = j.form;
    if (!els.preview) build();
    els.preview.classList.remove('is-loading');
    if (j.error) {
      els.status.textContent = 'Чертёж не построился: ' + j.error;
    } else {
      els.status.textContent = 'Образец с водяным знаком. Файлы без знака — после оплаты.';
      els.img.src = j.kind === 'svg' ? 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(j.image) : j.image;
    }
    syncFigure();
    syncEases();
    syncOptions();
    syncElements();
    window.StroyKroyConfigurator = { model: cfg.model, selection: sel, form: form };
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

    // Припуск на швы
    left.appendChild(h('h3', { text: 'Припуск на швы' }));
    var seam = h('input', { type: 'number', step: '0.1', min: '0', max: '5', value: '1' });
    seam.addEventListener('input', function () { var v = parse(seam.value); if (v !== null && v >= 0 && v <= 5) { sel.seam = v; request(); } });
    left.appendChild(h('label', { text: 'Размер припуска, см' }));
    left.appendChild(seam);

    var wrap = h('div', { class: 'sk-cfg' }, [left, right]);
    root.appendChild(wrap);

    els.img = h('img', { alt: 'Образец лекал', draggable: 'false' });
    els.img.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    els.status = h('div', { class: 'sk-cfg__status' });
    right.appendChild(els.img);
    right.appendChild(els.status);
    right.appendChild(h('div', { class: 'sk-cfg__note', text: 'Лекала строятся по вашим меркам: после оплаты вы получите файлы PDF (в натуральную величину и для печати на A4) и DXF.' }));
    els.preview = right;
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
      g.items.forEach(function (it) {
        var inp = h('input', { type: 'text', inputmode: 'decimal', value: fmt(it.value) });
        inp.addEventListener('input', function () {
          var v = parse(inp.value);
          if (v === null || Math.abs(v) >= 100) return;
          sel.eases[it.key] = v;
          request();
        });
        det.appendChild(h('div', { class: 'sk-row' }, [h('span', { text: it.name }), inp]));
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

  run();
})(window.drupalSettings);
