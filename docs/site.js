// 頂欄：滾動後加分隔線；導航高亮當前所在的區塊
(function () {
  var bar = document.querySelector('.topbar');
  var onScroll = function () { bar.classList.toggle('scrolled', window.scrollY > 8); };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  var links = {};
  document.querySelectorAll('header.top nav a[href^="#"]').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  if (!('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var a = links[e.target.id];
      if (a) a.classList.toggle('on', e.isIntersecting);
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  Object.keys(links).forEach(function (id) { var el = document.getElementById(id); if (el) io.observe(el); });
})();
