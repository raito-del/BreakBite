/* BreakBite logo: clicking "Bite" chomps the cookie, then opens the order page */
(function () {
  var bite = document.getElementById("bbBite");
  var cookie = document.getElementById("bbCookie");
  var hint = document.getElementById("bbHint");
  if (!bite || !cookie) return;
  var TARGET = "student.html";
  var busy = false;

  function crumbs(x, y) {
    for (var i = 0; i < 9; i++) {
      var c = document.createElement("span");
      c.className = "bb-crumb";
      var angle = (Math.PI * 2 / 9) * i + Math.random() * 0.4;
      var dist = 60 + Math.random() * 60;
      c.style.left = x + "px";
      c.style.top = y + "px";
      c.style.setProperty("--dx", Math.cos(angle) * dist + "px");
      c.style.setProperty("--dy", Math.sin(angle) * dist + "px");
      document.body.appendChild(c);
      setTimeout(function (el) { el.remove(); }.bind(null, c), 900);
    }
  }

  bite.addEventListener("click", function () {
    if (busy) return;
    busy = true;
    if (hint) hint.classList.add("bb-hide");
    bite.classList.add("bb-pressed");
    cookie.classList.add("bb-chomp");
    var r = bite.getBoundingClientRect();
    crumbs(r.left + r.width / 2, r.top + r.height / 2);
    setTimeout(function () { window.location.href = TARGET; }, 800);
  });
})();