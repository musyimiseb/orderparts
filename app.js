/* ============================================================
   OrderParts KE — application logic
   Requires: @supabase/supabase-js v2 (loaded via CDN in index.html)
   ============================================================ */
(function () {
'use strict';

/* ============================================================
   CONFIG — REPLACE THESE TWO VALUES
   ============================================================ */
var SUPABASE_URL      = 'postgresql://postgres.edyzxgdafwbpwlwumits:orderparts@100@aws-1-eu-west-1.pooler.supabase.com:6543/postgres?pgbouncer=true';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVkeXp4Z2RhZndicHdsd3VtaXRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU0NDc3MzcsImV4cCI6MjExMTAyMzczN30.cjrKAkvnRQGZ5yaDMKWdO0_AHigl32wRIUlQizM5_Gg';

/* ============================================================ */

var sb = null;
if (window.supabase && SUPABASE_URL.indexOf('YOUR-PROJECT') === -1) {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

var INITIAL_LIMIT = 8;
var SESSION_HOURS = 8;
var MAX_UPLOAD_DIM = 1200;

var DEFAULTS = {
  phone: '254705976736',
  email: 'info@orderpartske.com',
  ship:  500,
  cur:   'KES',
  logo:  'img/logo.jpeg'
};

var FALLBACK_IMG = "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23efece5'/%3E%3Ccircle cx='38' cy='38' r='7' fill='%23c9c2b6'/%3E%3Cpath d='M26 74l16-22 12 16 8-10 14 16z' fill='%23c9c2b6'/%3E%3C/svg%3E";

/* ---------- state ---------- */
var products   = [];
var cart       = {};
var activeCat  = 'All';
var query      = '';
var shown      = INITIAL_LIMIT;
var currentProduct = null;
var editingId  = null;
var pendingImage = '';
var store = Object.assign({}, DEFAULTS);

/* ---------- helpers ---------- */
function $(id){ return document.getElementById(id); }
function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function money(n){
  var num = Number(n);
  if (isNaN(num)) num = 0;
  return store.cur + ' ' + num.toLocaleString('en-KE');
}
function findProduct(id){
  for (var i = 0; i < products.length; i++) {
    if (String(products[i].id) === String(id)) return products[i];
  }
  return null;
}
function bindImages(scope){
  (scope || document).querySelectorAll('img:not([data-bound])').forEach(function(img){
    img.dataset.bound = '1';
    img.addEventListener('error', function(){
      if (this.src !== FALLBACK_IMG) this.src = FALLBACK_IMG;
    });
  });
}
function fmtPhone(raw){
  var s = String(raw || '').replace(/\D/g, '');
  if (s.length === 12) return '+' + s.slice(0,3) + ' ' + s.slice(3,6) + ' ' + s.slice(6,9) + ' ' + s.slice(9);
  return '+' + s;
}

/* ============================================================
   SETTINGS
   ============================================================ */
async function loadSettings(){
  store = Object.assign({}, DEFAULTS);
  if (!sb) return;
  var res = await sb.from('settings').select('*');
  if (res.error){ console.warn('[OrderParts] settings load', res.error); return; }
  (res.data || []).forEach(function(row){
    if (row.key === 'phone')      store.phone = row.value || DEFAULTS.phone;
    else if (row.key === 'email') store.email = row.value || DEFAULTS.email;
    else if (row.key === 'ship')  store.ship  = Number(row.value) || 0;
    else if (row.key === 'cur')   store.cur   = row.value || DEFAULTS.cur;
    else if (row.key === 'logo')  store.logo  = row.value || DEFAULTS.logo;
  });
}
async function saveSettings(updates){
  if (!sb) throw new Error('Supabase not configured');
  var rows = Object.keys(updates).map(function(k){
    return { key: k, value: String(updates[k]), updated_at: new Date().toISOString() };
  });
  var res = await sb.from('settings').upsert(rows);
  if (res.error) throw res.error;
}

/* ============================================================
   IMAGE UPLOAD
   ============================================================ */
async function compressImage(file){
  if (!file || file.type === 'image/svg+xml' || file.type === 'image/gif') return file;
  if (file.size < 250 * 1024) return file;
  return new Promise(function(resolve){
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function(){
      var w = img.width, h = img.height;
      var scale = Math.min(1, MAX_UPLOAD_DIM / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var c = document.createElement('canvas');
      c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      c.toBlob(function(blob){
        if (!blob) return resolve(file);
        var base = file.name.replace(/\.[^.]+$/, '');
        resolve(new File([blob], base + '.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.85);
    };
    img.onerror = function(){ URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
async function uploadImage(file, folder){
  if (!sb) throw new Error('Supabase client not configured');
  var compressed = await compressImage(file);
  var ext = (compressed.name.split('.').pop() || 'jpg').toLowerCase();
  var path = (folder || 'products') + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  var up = await sb.storage.from('product-images').upload(path, compressed, {
    cacheControl: '31536000',
    upsert: false,
    contentType: compressed.type || 'image/jpeg'
  });
  if (up.error) throw up.error;
  var pub = sb.storage.from('product-images').getPublicUrl(path);
  return pub.data.publicUrl;
}

/* ============================================================
   PRODUCTS
   ============================================================ */
async function loadProducts(){
  if (!sb){ products = []; return; }
  var res = await sb.from('products').select('*').order('id', { ascending: true });
  if (res.error){ console.error('[OrderParts] products load', res.error); products = []; return; }
  products = (res.data || []).map(function(r){
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description || '',
      price: Number(r.price) || 0,
      image: r.image || '',
      badge: r.badge || null,
      stock: Number(r.stock) || 0,
      featured: !!r.featured
    };
  });
}

/* ============================================================
   APPLY STORE
   ============================================================ */
function applyStore(){
  document.querySelectorAll('[data-phone-text]').forEach(function(el){ el.textContent = fmtPhone(store.phone); });
  document.querySelectorAll('[data-tel]').forEach(function(el){ el.href = 'tel:+' + store.phone.replace(/\D/g,''); });
  document.querySelectorAll('[data-mail]').forEach(function(el){ el.href = 'mailto:' + store.email; });
  document.querySelectorAll('[data-email-text]').forEach(function(el){ el.textContent = store.email; });
  document.querySelectorAll('[data-wa]').forEach(function(el){
    el.href = 'https://wa.me/' + store.phone.replace(/\D/g,'') + '?text=' + encodeURIComponent("Hi OrderParts KE, I'm looking for a part.");
  });
  document.querySelectorAll('#brand-logo, #brand-logo-footer').forEach(function(img){
    if (img.getAttribute('src') !== store.logo) img.src = store.logo;
  });
}

/* ============================================================
   CART
   ============================================================ */
var CART_KEY = 'op_cart';

function loadCart(){
  cart = {};
  var raw = localStorage.getItem(CART_KEY);
  if (!raw) return;
  var parsed;
  try { parsed = JSON.parse(raw); } catch(e){ return; }
  if (Array.isArray(parsed)){
    parsed.forEach(function(it){
      if (it && it.id != null){
        var q = parseInt(it.qty || it.quantity || 1, 10);
        if (!isNaN(q) && q > 0) cart[String(it.id)] = q;
      }
    });
    return;
  }
  if (parsed && typeof parsed === 'object'){
    Object.keys(parsed).forEach(function(k){
      var v = parsed[k];
      var n = (typeof v === 'number') ? v : parseInt(v, 10);
      if (!isNaN(n) && n > 0 && /^\d+$/.test(String(k))) cart[String(k)] = n;
    });
  }
}
function saveCart(){ try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch(e){} }
function cartCount(){
  var n = 0;
  for (var k in cart){ var v = Number(cart[k]); if (!isNaN(v) && v > 0) n += v; }
  return n;
}
function cartSubtotal(){
  var s = 0;
  for (var id in cart){
    var p = findProduct(id);
    var q = Number(cart[id]);
    if (p && !isNaN(q) && q > 0) s += p.price * q;
  }
  return s;
}

/* ============================================================
   RENDER
   ============================================================ */
function cardHTML(p){
  var img = p.image || FALLBACK_IMG;
  var low = p.stock > 0 && p.stock < 5;
  var stockText = p.stock === 0 ? 'Out of stock' : (low ? 'Low stock · ' + p.stock : 'In stock');
  var badgeClass = 'tag';
  if (p.badge && /^new$/i.test(p.badge)) badgeClass += ' new';
  return ''
    + '<article class="card" data-id="' + p.id + '" tabindex="0">'
    +   '<div class="ph">'
    +     '<span class="ref">' + esc((p.category || 'GEN').slice(0,3).toUpperCase()) + '</span>'
    +     (p.badge ? '<span class="' + badgeClass + '">' + esc(p.badge) + '</span>' : '')
    +     '<img src="' + esc(img) + '" alt="' + esc(p.name) + '" loading="lazy">'
    +   '</div>'
    +   '<div class="b">'
    +     '<div class="cat">' + esc(p.category) + '</div>'
    +     '<h3>' + esc(p.name) + '</h3>'
    +     '<div class="d">' + esc(p.description) + '</div>'
    +     '<div class="st' + (low ? ' low' : '') + '">' + stockText + '</div>'
    +   '</div>'
    +   '<div class="f">'
    +     '<span class="p">' + money(p.price) + '</span>'
    +     '<div class="f-btns">'
    +       '<button class="add" data-add="' + p.id + '" aria-label="Add to cart">'
    +         '<span class="add-txt">Add</span>'
    +         '<svg class="ic" aria-hidden="true"><use href="#i-plus"/></svg>'
    +       '</button>'
    +     '</div>'
    +   '</div>'
    + '</article>';
}

function renderFeatured(){
  var f = products.filter(function(p){ return p.featured; }).slice(0, 4);
  $('featured-grid').innerHTML = f.map(cardHTML).join('');
  bindImages($('featured-grid'));
}

function renderTabs(){
  var cats = ['All'];
  products.forEach(function(p){ if (cats.indexOf(p.category) === -1) cats.push(p.category); });
  $('tabs').innerHTML = cats.map(function(c){
    var n = c === 'All' ? products.length : products.filter(function(p){ return p.category === c; }).length;
    return '<button class="tab' + (c === activeCat ? ' on' : '') + '" data-tab="' + esc(c) + '" role="tab">'
      + esc(c) + '<b>' + n + '</b></button>';
  }).join('');

  var sel = $('adm-filter');
  if (sel){
    var cur = sel.value;
    sel.innerHTML = '<option value="">All categories</option>'
      + cats.filter(function(c){ return c !== 'All'; })
            .map(function(c){ return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    sel.value = cur || '';
  }
}

function renderGrid(){
  var q = query.trim().toLowerCase();
  var list = products.filter(function(p){
    if (activeCat !== 'All' && p.category !== activeCat) return false;
    if (q){
      var hay = (p.name + ' ' + p.category + ' ' + (p.description || '')).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });
  var total = list.length;
  var visible = list.slice(0, shown);
  $('grid').innerHTML = visible.map(cardHTML).join('');
  bindImages($('grid'));
  $('shown').textContent = visible.length;
  $('total').textContent = total;
  $('empty').classList.toggle('hide', total > 0);
  $('show-more-wrap').classList.toggle('hide', shown >= total);
  $('show-more-label').textContent = 'View all products (' + total + ')';
}

function renderCart(){
  var ids = Object.keys(cart).filter(function(k){
    return Number(cart[k]) > 0 && findProduct(k);
  });
  var count = 0;
  ids.forEach(function(k){ count += Number(cart[k]); });

  $('cart-n').textContent = String(count);
  $('cart-count').textContent = String(count);
  $('cart-count').classList.toggle('hide', count === 0);

  var body = $('cart-body');
  var foot = $('cart-foot');

  if (!ids.length){
    body.innerHTML = '<div class="cempty">'
      + '<div class="box"><svg class="ic"><use href="#i-bag"/></svg></div>'
      + '<h4>Your cart is empty</h4>'
      + '<p>Add parts to get started.</p>'
      + '<button id="cempty-shop">Browse products</button>'
      + '</div>';
    foot.classList.add('hide');
    var shopBtn = $('cempty-shop');
    if (shopBtn) shopBtn.onclick = function(){ closeAll(); location.hash = '#shop'; };
    return;
  }

  foot.classList.remove('hide');
  body.innerHTML = ids.map(function(id){
    var p = findProduct(id);
    var qty = Number(cart[id]) || 0;
    return '<div class="ci" data-id="' + p.id + '">'
      + '<img src="' + esc(p.image || FALLBACK_IMG) + '" alt="">'
      + '<div>'
      +   '<div class="nm">' + esc(p.name) + '</div>'
      +   '<div class="mt">' + esc(p.category) + '</div>'
      +   '<div class="qty">'
      +     '<button data-dec="' + p.id + '" aria-label="Decrease"><svg class="ic"><use href="#i-minus"/></svg></button>'
      +     '<span>' + qty + '</span>'
      +     '<button data-inc="' + p.id + '" aria-label="Increase"><svg class="ic"><use href="#i-plus"/></svg></button>'
      +   '</div>'
      + '</div>'
      + '<div class="rt">'
      +   '<div class="ln">' + money(p.price * qty) + '</div>'
      +   '<button class="rm" data-rm="' + p.id + '" aria-label="Remove"><svg class="ic"><use href="#i-trash"/></svg></button>'
      + '</div>'
      + '</div>';
  }).join('');
  bindImages(body);

  var sub = cartSubtotal();
  $('sub').textContent = money(sub);
  $('ship').textContent = store.ship ? money(store.ship) : 'Free';
  $('tot').textContent = money(sub + store.ship);
}

function renderSuggestions(){
  var sug = $('sug');
  var q = query.trim().toLowerCase();
  if (!q){ sug.classList.add('hide'); return; }
  var matches = products.filter(function(p){
    return (p.name + ' ' + p.category + ' ' + (p.description || '')).toLowerCase().indexOf(q) !== -1;
  }).slice(0, 6);
  if (!matches.length){
    sug.innerHTML = '<div class="s-none"><svg class="ic"><use href="#i-search"/></svg><p>No matches</p><span>Try a different term</span></div>';
  } else {
    sug.innerHTML = '<div class="s-lab">Matches</div>' + matches.map(function(p){
      return '<div class="s" data-sug="' + p.id + '" role="option">'
        + '<img class="s-img" src="' + esc(p.image || FALLBACK_IMG) + '" alt="">'
        + '<div class="s-m"><div class="s-t">' + esc(p.name) + '</div><div class="s-s">' + esc(p.category) + ' · ' + money(p.price) + '</div></div>'
        + '<svg class="ic s-a"><use href="#i-right"/></svg>'
        + '</div>';
    }).join('') + '<div class="s s-all" data-sug-all="1"><span class="s-t">View all results</span><svg class="ic s-a"><use href="#i-right"/></svg></div>';
  }
  sug.classList.remove('hide');
  bindImages(sug);
}

function renderAll(){
  applyStore();
  renderFeatured();
  renderTabs();
  renderGrid();
  renderCart();
}

/* ============================================================
   MODAL
   ============================================================ */
function openModal(p){
  currentProduct = p;
  $('m-id').textContent = 'REF · ' + String(p.id).padStart(3, '0');
  $('m-img').src = p.image || FALLBACK_IMG;
  $('m-thumbs').innerHTML = '';
  $('m-badge').textContent = p.badge || '';
  $('m-title').textContent = p.name;
  $('m-desc').textContent = p.description || '';
  $('m-cat').textContent = p.category;
  $('m-stock').textContent = p.stock === 0 ? 'Out of stock' : (p.stock + ' available');
  $('m-price').textContent = money(p.price);
  var addBtn = $('m-add');
  addBtn.classList.remove('is-added');
  addBtn.innerHTML = '<svg class="ic"><use href="#i-plus"/></svg> Add to cart';
  $('m-wa').href = 'https://wa.me/' + store.phone.replace(/\D/g,'') + '?text='
    + encodeURIComponent("Hi OrderParts KE, I'm interested in: " + p.name + ' (' + money(p.price) + ')');
  $('modal').classList.remove('hide');
  document.body.classList.add('overlay-open');
}
function closeModal(){
  $('modal').classList.add('hide');
  if (!$('cart').classList.contains('on') && !$('admin').classList.contains('on'))
    document.body.classList.remove('overlay-open');
}

/* ============================================================
   SHARE
   ============================================================ */
function openShare(p){
  currentProduct = p;
  $('share-img').src = p.image || FALLBACK_IMG;
  $('share-name').textContent = p.name;
  $('share-price').textContent = money(p.price);
  var url = location.origin + location.pathname + '#p=' + p.id;
  $('share-url').value = url;
  $('share-native').classList.toggle('hide', !navigator.share);
  $('share').classList.add('on');
}
function closeShare(){ $('share').classList.remove('on'); }

/* ============================================================
   TOAST
   ============================================================ */
var toastTimer;
function toast(msg, type){
  var el = $('toast');
  $('toast-txt').textContent = msg;
  el.setAttribute('data-t', type || '');
  $('toast-ic').setAttribute('href', type === 'warn' ? '#i-clock' : '#i-check');
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ el.classList.remove('on'); }, 2400);
}

/* ============================================================
   ADD TO CART
   ============================================================ */
function addToCart(id, btn){
  var p = findProduct(id); if (!p) return;
  var key = String(p.id);
  var cur = parseInt(cart[key], 10);
  if (isNaN(cur) || cur < 0) cur = 0;
  cart[key] = cur + 1;
  saveCart();
  renderCart();
  if (btn){
    btn.classList.add('is-added');
    setTimeout(function(){ btn.classList.remove('is-added'); }, 900);
  }
  $('cart-count').classList.add('pop');
  setTimeout(function(){ $('cart-count').classList.remove('pop'); }, 400);
  toast('Added · ' + p.name);
}

/* ============================================================
   OVERLAYS
   ============================================================ */
function openCart(){
  renderCart();
  $('cart').classList.add('on');
  $('cart').setAttribute('aria-hidden','false');
  $('ovl').classList.add('on');
  document.body.classList.add('overlay-open');
}
function closeCart(){
  $('cart').classList.remove('on');
  $('cart').setAttribute('aria-hidden','true');
  $('ovl').classList.remove('on');
  document.body.classList.remove('overlay-open');
}
function closeAll(){
  closeCart(); closeModal(); closeShare();
  $('admin').classList.remove('on');
  $('admin-login').classList.add('hide');
  $('ovl').classList.remove('on');
  document.body.classList.remove('overlay-open');
  $('sug').classList.add('hide');
}

/* ============================================================
   ADMIN AUTH
   ============================================================ */
var PASS_KEY    = 'op_pass_hash';
var SESSION_KEY = 'op_session';

async function hashPass(pw){
  var data = new TextEncoder().encode('op-ke::' + pw);
  var buf  = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(function(b){ return b.toString(16).padStart(2,'0'); }).join('');
}
async function getPassHash(){
  var h = localStorage.getItem(PASS_KEY);
  if (!h){ h = await hashPass('orderparts'); localStorage.setItem(PASS_KEY, h); }
  return h;
}
function isAuthed(){
  var t = Number(localStorage.getItem(SESSION_KEY) || 0);
  return t && (Date.now() - t) < SESSION_HOURS * 3600 * 1000;
}
function setAuthed(){ localStorage.setItem(SESSION_KEY, String(Date.now())); }
function clearAuthed(){ localStorage.removeItem(SESSION_KEY); }

/* ============================================================
   ADMIN PANEL
   ============================================================ */
function openAdmin(){
  $('admin').classList.add('on');
  $('admin').setAttribute('aria-hidden','false');
  $('ovl').classList.add('on');
  document.body.classList.add('overlay-open');
  $('admin-who').textContent = 'Signed in';
  renderAdminStats();
  renderAdminList();
  renderTabs();
  syncStoreForm();
  renderBrandPreview();
}
function closeAdmin(){
  $('admin').classList.remove('on');
  $('admin').setAttribute('aria-hidden','true');
  $('ovl').classList.remove('on');
  document.body.classList.remove('overlay-open');
}
function syncStoreForm(){
  if ($('st-phone')) $('st-phone').value = store.phone;
  if ($('st-email')) $('st-email').value = store.email;
  if ($('st-ship'))  $('st-ship').value  = store.ship;
  if ($('st-cur'))   $('st-cur').value   = store.cur;
}

function renderAdminStats(){
  var total    = products.length;
  var featured = products.filter(function(p){ return p.featured; }).length;
  var low      = products.filter(function(p){ return p.stock > 0 && p.stock < 5; }).length;
  var out      = products.filter(function(p){ return p.stock === 0; }).length;
  $('adm-stats').innerHTML = ''
    + '<div class="adm-stat"><b>' + total + '</b><span>Products</span></div>'
    + '<div class="adm-stat"><b>' + featured + '</b><span>Featured</span></div>'
    + '<div class="adm-stat warn"><b>' + low + '</b><span>Low stock</span></div>'
    + '<div class="adm-stat warn"><b>' + out + '</b><span>Out</span></div>';
}

function renderAdminList(){
  var s   = ($('adm-search').value || '').toLowerCase();
  var cat = $('adm-filter').value;
  var list = products.filter(function(p){
    if (cat && p.category !== cat) return false;
    if (s && (p.name + ' ' + p.category).toLowerCase().indexOf(s) === -1) return false;
    return true;
  });
  $('admin-list').innerHTML = list.map(function(p){
    return '<div class="adm-item" data-id="' + p.id + '">'
      + '<img src="' + esc(p.image || FALLBACK_IMG) + '" alt="">'
      + '<div>'
      +   '<div class="nm">' + esc(p.name) + '</div>'
      +   '<div class="mt">' + esc(p.category) + ' · <b>' + money(p.price) + '</b> · ' + p.stock + ' in stock</div>'
      + '</div>'
      + '<div class="acts">'
      +   '<button data-edit="' + p.id + '" aria-label="Edit"><svg class="ic"><use href="#i-edit"/></svg></button>'
      +   '<button class="danger" data-del="' + p.id + '" aria-label="Delete"><svg class="ic"><use href="#i-trash"/></svg></button>'
      + '</div>'
      + '</div>';
  }).join('') || '<p class="adm-note" style="padding:16px 0">No products yet. Click <b>+ New</b> to add one.</p>';
  bindImages($('admin-list'));
}

function resetForm(){
  editingId = null;
  pendingImage = '';
  $('admin-form').reset();
  $('af-id').value = '';
  $('af-image-url').value = '';
  $('af-thumbs').innerHTML = '';
}
function closeForm(){
  resetForm();
  $('admin-form').classList.add('hide');
}
function editProduct(id){
  var p = findProduct(id); if (!p) return;
  editingId = p.id;
  pendingImage = p.image || '';
  $('af-id').value = p.id;
  $('af-name').value = p.name;
  $('af-category').value = p.category;
  $('af-price').value = p.price;
  $('af-badge').value = p.badge || '';
  $('af-stock').value = p.stock;
  $('af-description').value = p.description || '';
  $('af-featured').checked = !!p.featured;
  $('af-image-url').value = (p.image && /^https?:/.test(p.image)) ? p.image : '';
  $('af-thumbs').innerHTML = p.image
    ? '<div class="adm-thumb"><img src="' + esc(p.image) + '" alt=""><button type="button" data-clear-thumb="1" aria-label="Remove">×</button></div>'
    : '';
  $('admin-form').classList.remove('hide');
  $('af-name').focus();
}

function showThumb(url, uploading){
  var html = '<div class="adm-thumb' + (uploading ? ' uploading' : '') + '">'
    + '<img src="' + esc(url || FALLBACK_IMG) + '" alt="">'
    + (!uploading ? '<button type="button" data-clear-thumb="1" aria-label="Remove">×</button>' : '')
    + '</div>';
  $('af-thumbs').innerHTML = html;
  bindImages($('af-thumbs'));
}
function clearThumb(){
  pendingImage = '';
  $('af-image-url').value = '';
  $('af-thumbs').innerHTML = '';
  var files = $('af-files');
  if (files) files.value = '';
}

function renderBrandPreview(){
  var box = $('brand-prev');
  var img = $('brand-prev-img');
  var picker = $('brand-picker');
  if (!box || !img) return;
  if (store.logo && store.logo !== DEFAULTS.logo){
    img.src = store.logo;
    box.classList.add('on');
    if (picker) picker.classList.add('has-logo');
  } else {
    box.classList.remove('on');
    if (picker) picker.classList.remove('has-logo');
  }
}

/* ============================================================
   BOOT
   ============================================================ */
async function boot(){
  loadCart();
  await Promise.all([loadProducts(), loadSettings()]);
  renderAll();

  /* ---- search ---- */
  var searchTimer;
  $('q').addEventListener('input', function(e){
    query = e.target.value;
    shown = INITIAL_LIMIT;
    renderGrid();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSuggestions, 120);
  });
  $('q').addEventListener('focus', function(){ if (query.trim()) renderSuggestions(); });
  $('sug').addEventListener('click', function(e){
    var item = e.target.closest('[data-sug]');
    if (item){
      var p = findProduct(item.getAttribute('data-sug'));
      $('sug').classList.add('hide');
      if (p) openModal(p);
      return;
    }
    if (e.target.closest('[data-sug-all]')){
      $('sug').classList.add('hide');
      location.hash = '#shop';
    }
  });
  document.addEventListener('click', function(e){
    if (!e.target.closest('.search')) $('sug').classList.add('hide');
  });

  /* ---- tabs ---- */
  $('tabs').addEventListener('click', function(e){
    var t = e.target.closest('[data-tab]'); if (!t) return;
    activeCat = t.getAttribute('data-tab');
    shown = INITIAL_LIMIT;
    renderTabs(); renderGrid();
  });

  /* ---- category jumps ---- */
  document.querySelectorAll('[data-cat-jump]').forEach(function(a){
    a.addEventListener('click', function(){
      activeCat = a.getAttribute('data-cat-jump');
      shown = INITIAL_LIMIT;
      renderTabs(); renderGrid();
    });
  });

  /* ---- grids → modal / add ---- */
  ['grid','featured-grid'].forEach(function(gid){
    $(gid).addEventListener('click', function(e){
      var add = e.target.closest('[data-add]');
      if (add){ e.stopPropagation(); addToCart(add.getAttribute('data-add'), add); return; }
      var card = e.target.closest('.card');
      if (card){
        var p = findProduct(card.getAttribute('data-id'));
        if (p) openModal(p);
      }
    });
  });

  /* ---- show more / reset ---- */
  $('show-more-btn').addEventListener('click', function(){
    shown = products.length; renderGrid();
  });
  $('reset').addEventListener('click', function(){
    activeCat = 'All'; query = ''; shown = INITIAL_LIMIT;
    $('q').value = ''; renderTabs(); renderGrid();
  });

  /* ---- cart ---- */
  $('cart-btn').addEventListener('click', openCart);
  $('cart-x').addEventListener('click', closeCart);
  $('ovl').addEventListener('click', closeAll);
  $('cart-body').addEventListener('click', function(e){
    var inc = e.target.closest('[data-inc]');
    if (inc){
      var k = String(inc.getAttribute('data-inc'));
      var n = parseInt(cart[k], 10); if (isNaN(n)) n = 0;
      cart[k] = n + 1; saveCart(); renderCart(); return;
    }
    var dec = e.target.closest('[data-dec]');
    if (dec){
      var k2 = String(dec.getAttribute('data-dec'));
      var n2 = parseInt(cart[k2], 10); if (isNaN(n2)) n2 = 0;
      n2--; if (n2 <= 0) delete cart[k2]; else cart[k2] = n2;
      saveCart(); renderCart(); return;
    }
    var rm = e.target.closest('[data-rm]');
    if (rm){ delete cart[String(rm.getAttribute('data-rm'))]; saveCart(); renderCart(); }
  });
  $('wa-order').addEventListener('click', function(){
    var lines = ["Hi OrderParts KE, I'd like to order:"];
    for (var id in cart){
      var p = findProduct(id);
      var q = Number(cart[id]);
      if (p && q > 0) lines.push('• ' + p.name + ' × ' + q + ' — ' + money(p.price * q));
    }
    lines.push('');
    lines.push('Total: ' + money(cartSubtotal() + store.ship) + ' (incl. delivery ' + money(store.ship) + ')');
    window.open('https://wa.me/' + store.phone.replace(/\D/g,'') + '?text=' + encodeURIComponent(lines.join('\n')), '_blank');
  });
  $('em-order').addEventListener('click', function(){
    var lines = ["Hi OrderParts KE, I'd like to order:"];
    for (var id in cart){
      var p = findProduct(id);
      var q = Number(cart[id]);
      if (p && q > 0) lines.push('- ' + p.name + ' x' + q + ' (' + money(p.price * q) + ')');
    }
    lines.push(''); lines.push('Total: ' + money(cartSubtotal() + store.ship));
    window.location.href = 'mailto:' + store.email + '?subject=' + encodeURIComponent('Order from OrderParts KE')
      + '&body=' + encodeURIComponent(lines.join('\n'));
  });

  /* ---- modal ---- */
  $('m-x').addEventListener('click', closeModal);
  $('m-add').addEventListener('click', function(){
    if (!currentProduct) return;
    addToCart(currentProduct.id, null);
    var b = $('m-add');
    b.classList.add('is-added');
    b.innerHTML = '<svg class="ic"><use href="#i-check"/></svg> Added';
    setTimeout(function(){
      b.classList.remove('is-added');
      b.innerHTML = '<svg class="ic"><use href="#i-plus"/></svg> Add to cart';
    }, 1400);
  });
  $('m-share').addEventListener('click', function(){ if (currentProduct) openShare(currentProduct); });

  /* ---- share ---- */
  $('share-x').addEventListener('click', closeShare);
  $('share').addEventListener('click', function(e){ if (e.target === $('share')) closeShare(); });
  $('share-options').addEventListener('click', async function(e){
    var opt = e.target.closest('[data-share-opt]'); if (!opt || !currentProduct) return;
    var kind = opt.getAttribute('data-share-opt');
    var url  = $('share-url').value;
    var txt  = currentProduct.name + ' — ' + money(currentProduct.price) + ' @ OrderParts KE';
    if (kind === 'native'){
      try { await navigator.share({ title: txt, text: txt, url: url }); closeShare(); } catch(e){}
    } else if (kind === 'whatsapp'){
      window.open('https://wa.me/?text=' + encodeURIComponent(txt + '\n' + url), '_blank');
    } else if (kind === 'email'){
      window.location.href = 'mailto:?subject=' + encodeURIComponent(txt) + '&body=' + encodeURIComponent(url);
    } else if (kind === 'copy'){
      copyShareUrl();
    }
  });
  $('share-copy').addEventListener('click', copyShareUrl);
  function copyShareUrl(){
    var u = $('share-url'); u.select();
    try { navigator.clipboard.writeText(u.value); toast('Link copied'); }
    catch(e){ try { document.execCommand('copy'); toast('Link copied'); } catch(e2){} }
  }

  /* ---- menu ---- */
  $('menu-btn').addEventListener('click', function(){
    var m = $('menu'); var open = !m.classList.contains('hide');
    m.classList.toggle('hide', open);
    $('menu-btn').setAttribute('aria-expanded', String(!open));
  });

  /* ---- toast close ---- */
  $('toast').addEventListener('click', function(){ $('toast').classList.remove('on'); });

  /* ---- back to top ---- */
  window.addEventListener('scroll', function(){
    $('top-btn').classList.toggle('on', window.scrollY > 500);
  }, { passive: true });
  $('top-btn').addEventListener('click', function(){ window.scrollTo({ top: 0, behavior: 'smooth' }); });

  /* ---- deep link ---- */
  function handleHash(){
    var m = location.hash.match(/^#p=(\d+)$/);
    if (m){ var p = findProduct(m[1]); if (p) openModal(p); }
  }
  window.addEventListener('hashchange', handleHash);
  handleHash();

  /* ============================================================
     ADMIN — login
     ============================================================ */
  $('admin-btn').addEventListener('click', function(){
    if (isAuthed()) openAdmin();
    else {
      $('admin-login').classList.remove('hide');
      $('al-pass').value = '';
      $('al-err').classList.add('hide');
      setTimeout(function(){ $('al-pass').focus(); }, 60);
    }
  });
  $('al-x').addEventListener('click', function(){ $('admin-login').classList.add('hide'); });
  $('al-eye').addEventListener('click', function(){
    var inp = $('al-pass');
    var showing = inp.type === 'text';
    inp.type = showing ? 'password' : 'text';
    $('al-eye').innerHTML = '<svg class="ic"><use href="' + (showing ? '#i-eye' : '#i-eye-off') + '"/></svg>';
  });
  $('al-go').addEventListener('click', async function(){
    var pw = $('al-pass').value;
    var stored = await getPassHash();
    var given  = await hashPass(pw);
    if (given === stored){
      setAuthed();
      $('admin-login').classList.add('hide');
      openAdmin();
    } else {
      $('al-err').classList.remove('hide');
      $('al-pass').classList.add('shake');
      setTimeout(function(){ $('al-pass').classList.remove('shake'); }, 500);
    }
  });
  $('al-pass').addEventListener('keydown', function(e){ if (e.key === 'Enter') $('al-go').click(); });
  $('al-forgot').addEventListener('click', function(){ toast('Ask the site owner to reset', 'warn'); });

  $('admin-x').addEventListener('click', closeAdmin);
  $('admin-logout').addEventListener('click', function(){
    clearAuthed(); closeAdmin(); toast('Signed out');
  });

  /* admin tabs */
  $('adm-tabs').addEventListener('click', function(e){
    var t = e.target.closest('[data-atab]'); if (!t) return;
    var name = t.getAttribute('data-atab');
    document.querySelectorAll('.adm-tab').forEach(function(x){ x.classList.toggle('on', x === t); });
    document.querySelectorAll('.adm-pane').forEach(function(p){ p.classList.toggle('hide', p.getAttribute('data-pane') !== name); });
  });

  /* ---- products pane ---- */
  $('adm-search').addEventListener('input', renderAdminList);
  $('adm-filter').addEventListener('change', renderAdminList);
  $('admin-new').addEventListener('click', function(){
    resetForm();
    $('admin-form').classList.remove('hide');
    $('af-name').focus();
  });
  $('af-cancel').addEventListener('click', closeForm);
  $('admin-list').addEventListener('click', async function(e){
    var ed = e.target.closest('[data-edit]');
    if (ed){ editProduct(ed.getAttribute('data-edit')); return; }
    var del = e.target.closest('[data-del]');
    if (del){
      var id = del.getAttribute('data-del');
      if (!confirm('Delete this product? This cannot be undone.')) return;
      if (!sb){ toast('Supabase not configured', 'warn'); return; }
      var res = await sb.from('products').delete().eq('id', id);
      if (res.error){ toast('Delete failed', 'warn'); console.error(res.error); return; }
      await loadProducts(); renderAll(); renderAdminStats(); renderAdminList();
      toast('Deleted');
    }
  });

  $('af-thumbs').addEventListener('click', function(e){
    if (e.target.closest('[data-clear-thumb]')) clearThumb();
  });

  $('af-files').addEventListener('change', async function(e){
    var f = e.target.files && e.target.files[0]; if (!f) return;
    if (!sb){ toast('Supabase not configured', 'warn'); return; }
    if (f.size > 8 * 1024 * 1024){ toast('Image too large (max 8 MB)', 'warn'); return; }
    try {
      showThumb('', true);
      toast('Uploading…');
      var url = await uploadImage(f, 'products');
      pendingImage = url;
      showThumb(url, false);
      toast('Image uploaded');
    } catch(err){
      console.error(err);
      clearThumb();
      toast('Upload failed: ' + (err.message || 'try again'), 'warn');
    }
  });

  $('af-image-url').addEventListener('change', function(){
    var v = $('af-image-url').value.trim();
    if (v){ pendingImage = v; showThumb(v, false); }
  });

  $('admin-form').addEventListener('submit', async function(e){
    e.preventDefault();
    if (!sb){ toast('Supabase not configured', 'warn'); return; }
    var data = {
      name: $('af-name').value.trim(),
      category: $('af-category').value.trim(),
      price: Number($('af-price').value) || 0,
      badge: $('af-badge').value.trim() || null,
      stock: Number($('af-stock').value) || 0,
      description: $('af-description').value.trim(),
      featured: $('af-featured').checked,
      image: pendingImage || null
    };
    if (!data.name || !data.category){ toast('Name and category are required', 'warn'); return; }

    var res;
    if (editingId){ res = await sb.from('products').update(data).eq('id', editingId); }
    else          { res = await sb.from('products').insert(data); }
    if (res.error){ toast('Save failed', 'warn'); console.error(res.error); return; }

    var wasEdit = !!editingId;
    await loadProducts(); renderAll(); renderAdminStats(); renderAdminList();
    closeForm();
    toast(wasEdit ? 'Saved' : 'Product added');
  });

  /* ---- store pane ---- */
  $('st-save').addEventListener('click', async function(){
    var updates = {
      phone: $('st-phone').value.trim() || DEFAULTS.phone,
      email: $('st-email').value.trim() || DEFAULTS.email,
      ship:  String(Number($('st-ship').value) || 0),
      cur:   $('st-cur').value.trim() || DEFAULTS.cur
    };
    try {
      await saveSettings(updates);
      store.phone = updates.phone;
      store.email = updates.email;
      store.ship  = Number(updates.ship);
      store.cur   = updates.cur;
      applyStore(); renderCart(); renderGrid(); renderTabs(); renderAdminList();
      toast('Store settings saved');
    } catch(err){
      console.error(err);
      toast('Save failed: ' + (err.message || 'try again'), 'warn');
    }
  });

  $('brand-files').addEventListener('change', async function(e){
    var f = e.target.files && e.target.files[0]; if (!f) return;
    if (!sb){ toast('Supabase not configured', 'warn'); return; }
    try {
      toast('Uploading logo…');
      var url = await uploadImage(f, 'brand');
      await saveSettings({ logo: url });
      store.logo = url;
      applyStore(); renderBrandPreview();
      toast('Logo updated');
    } catch(err){
      console.error(err);
      toast('Logo upload failed', 'warn');
    }
  });
  $('brand-remove').addEventListener('click', async function(){
    try {
      await saveSettings({ logo: DEFAULTS.logo });
      store.logo = DEFAULTS.logo;
      applyStore(); renderBrandPreview();
      toast('Logo reset');
    } catch(err){ toast('Reset failed', 'warn'); }
  });

  /* ---- security pane ---- */
  $('sec-save').addEventListener('click', async function(){
    var oldp = $('sec-old').value;
    var n1   = $('sec-new').value;
    var n2   = $('sec-new2').value;
    var stored = await getPassHash();
    if (await hashPass(oldp) !== stored){ toast('Current password wrong', 'warn'); return; }
    if (!n1 || n1.length < 4){ toast('New password too short', 'warn'); return; }
    if (n1 !== n2){ toast("Passwords don't match", 'warn'); return; }
    localStorage.setItem(PASS_KEY, await hashPass(n1));
    $('sec-old').value = ''; $('sec-new').value = ''; $('sec-new2').value = '';
    toast('Password updated');
  });
  $('sec-reset').addEventListener('click', async function(){
    if (!confirm('Reset admin password to the default?')) return;
    localStorage.setItem(PASS_KEY, await hashPass('orderparts'));
    toast('Password reset to default');
  });

  /* ---- backup pane ---- */
  $('bk-export').addEventListener('click', function(){
    var payload = {
      exportedAt: new Date().toISOString(),
      store: { phone: store.phone, email: store.email, ship: store.ship, cur: store.cur, logo: store.logo },
      products: products.map(function(p){
        return { id:p.id, name:p.name, category:p.category, description:p.description,
                 price:p.price, image:p.image, badge:p.badge, stock:p.stock, featured:p.featured };
      })
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'orderparts-backup-' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
    toast('Backup downloaded');
  });
  $('bk-file').addEventListener('change', async function(e){
    var f = e.target.files && e.target.files[0]; if (!f) return;
    if (!sb){ toast('Supabase not configured', 'warn'); return; }
    try {
      var data = JSON.parse(await f.text());
      if (data.store){
        var stUpd = {};
        if (data.store.phone) stUpd.phone = data.store.phone;
        if (data.store.email) stUpd.email = data.store.email;
        if (data.store.ship != null) stUpd.ship = String(data.store.ship);
        if (data.store.cur) stUpd.cur = data.store.cur;
        if (data.store.logo) stUpd.logo = data.store.logo;
        if (Object.keys(stUpd).length){ await saveSettings(stUpd); await loadSettings(); }
      }
      if (Array.isArray(data.products)){
        var rows = data.products.map(function(p){
          var r = { name:p.name, category:p.category, description:p.description||'',
                    price:Number(p.price)||0, image:p.image||null, badge:p.badge||null,
                    stock:Number(p.stock)||0, featured:!!p.featured };
          if (p.id != null) r.id = p.id;
          return r;
        });
        var up = await sb.from('products').upsert(rows);
        if (up.error) throw up.error;
      }
      await loadProducts(); renderAll(); renderAdminStats(); renderAdminList();
      syncStoreForm(); applyStore(); renderBrandPreview();
      toast('Restored');
    } catch(err){ console.error(err); toast('Invalid backup file', 'warn'); }
  });
  $('bk-reset').addEventListener('click', async function(){
    await loadProducts();
    renderAll(); renderAdminStats(); renderAdminList();
    toast('Refreshed from database');
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();