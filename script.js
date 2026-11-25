/* LIMON Labs — scroll reveal + lightweight depth-parallax 3D hero.
   The 3D effect is a single textured quad in raw WebGL: the painted hero
   image plus a depth map, shifted by depth. No 3D library, DPR capped,
   pauses off-screen — smooth on cheap phones. The still image underneath
   remains as the fallback if WebGL is unavailable. */
(function () {
  "use strict";

  /* ---------- Scroll reveal ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var revealObs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          revealObs.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(function (el) { revealObs.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("in"); });
  }

  /* ---------- Depth-parallax 3D hero ---------- */
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canvas = document.getElementById("heroCanvas");
  var heroImg = document.getElementById("heroImg");
  if (reducedMotion || !canvas || !heroImg) return;

  var gl;
  try {
    gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
  } catch (err) { return; }
  if (!gl) return;

  var VS = "attribute vec2 p; varying vec2 vUv;" +
    "void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }";
  var FS = "precision mediump float; varying vec2 vUv;" +
    "uniform sampler2D uColor; uniform sampler2D uDepth;" +
    "uniform vec4 uRect; uniform vec2 uShift;" +
    "void main(){" +
    "  vec2 uv = uRect.xy + vUv * uRect.zw;" +
    "  uv = (uv - 0.5) * 0.96 + 0.5;" +
    "  float d = texture2D(uDepth, uv).r;" +
    "  vec2 off = uShift * (d - 0.45);" +
    "  gl_FragColor = texture2D(uColor, uv + off);" +
    "}";

  function shader(type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  var vs = shader(gl.VERTEX_SHADER, VS);
  var fs = shader(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return;
  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var uRect = gl.getUniformLocation(prog, "uRect");
  var uShift = gl.getUniformLocation(prog, "uShift");
  gl.uniform1i(gl.getUniformLocation(prog, "uColor"), 0);
  gl.uniform1i(gl.getUniformLocation(prog, "uDepth"), 1);

  function makeTex(unit, img) {
    var t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  /* object-fit: cover, object-position: 50% 40% — same crop as the <img> */
  var IMG_W = 1056, IMG_H = 2208, POS_Y = 0.40;
  function coverRect(cw, ch) {
    var ai = IMG_W / IMG_H, ac = cw / ch, w, h, x, y;
    if (ac > ai) { w = 1; h = ai / ac; x = 0; y = (1 - h) * (1 - POS_Y); }
    else { h = 1; w = ac / ai; x = (1 - w) / 2; y = (1 - h) * (1 - POS_Y); }
    return [x, y, w, h];
  }

  function resize() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    var r = coverRect(w, h);
    gl.uniform4f(uRect, r[0], r[1], r[2], r[3]);
  }

  var colorImg = new Image();
  var depthImg = new Image();
  var loaded = 0;
  function onLoad() {
    loaded++;
    if (loaded < 2) return;
    makeTex(0, colorImg);
    makeTex(1, depthImg);
    resize();
    canvas.classList.add("on");
    requestAnimationFrame(tick);
  }
  colorImg.onload = onLoad;
  depthImg.onload = onLoad;
  colorImg.src = "hero.webp";
  depthImg.src = "depth.webp";

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  /* Pointer parallax (desktop) + gentle idle sway (everywhere) */
  var tx = 0, ty = 0, sx = 0, sy = 0;
  window.addEventListener("pointermove", function (e) {
    if (e.pointerType === "touch") return;
    var r = canvas.getBoundingClientRect();
    if (!r.width) return;
    var cx = (e.clientX - (r.left + r.width / 2)) / r.width;
    var cy = (e.clientY - (r.top + r.height / 2)) / r.height;
    tx = Math.max(-1, Math.min(1, cx)) * 0.030;
    ty = Math.max(-1, Math.min(1, -cy)) * 0.022;
  }, { passive: true });

  var visible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
    }, { threshold: 0.03 }).observe(canvas);
  }

  var start = null;
  function tick(ts) {
    requestAnimationFrame(tick);
    if (document.hidden || !visible) return;
    if (start === null) start = ts;
    var t = (ts - start) / 1000;
    var swayX = Math.sin(t * 0.40) * 0.010;
    var swayY = Math.sin(t * 0.31 + 1.3) * 0.007;
    sx += ((tx + swayX) - sx) * 0.045;
    sy += ((ty + swayY) - sy) * 0.045;
    gl.uniform2f(uShift, sx, sy);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
})();
