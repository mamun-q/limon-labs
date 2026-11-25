/* LIMON Labs — scroll reveal + real-time 3D hero (hand-written WebGL).
   A live 3D glass orb with two orbit rings and sparkles floats over a
   painted aurora backdrop. No 3D library and no transmission pass, DPR
   capped at 1.25, rendering pauses off-screen — built to stay smooth on
   cheap phones. Drag the hero to spin the orb; tilt works on phones.
   The still painting underneath is the fallback if WebGL is unavailable. */
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

  /* ---------- 3D hero ---------- */
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canvas = document.getElementById("heroCanvas");
  var heroImg = document.getElementById("heroImg");
  var wrap = canvas ? canvas.parentElement : null;
  if (reducedMotion || !canvas || !heroImg || !wrap) return;

  var gl;
  try {
    gl = canvas.getContext("webgl", { alpha: false, antialias: true, powerPreference: "low-power" });
  } catch (err) { return; }
  if (!gl) return;

  /* ----- tiny mat4 helpers (column-major) ----- */
  function mIdent() { return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]); }
  function mMul(a, b) {
    var o = new Float32Array(16);
    for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
      var s = 0;
      for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  }
  function mPersp(fov, asp, n, f) {
    var t = 1 / Math.tan(fov / 2), o = new Float32Array(16);
    o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f);
    return o;
  }
  function mTrans(x, y, z) { var o = mIdent(); o[12] = x; o[13] = y; o[14] = z; return o; }
  function mRotX(a) { var c = Math.cos(a), s = Math.sin(a); return new Float32Array([1,0,0,0, 0,c,s,0, 0,-s,c,0, 0,0,0,1]); }
  function mRotY(a) { var c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,0,-s,0, 0,1,0,0, s,0,c,0, 0,0,0,1]); }
  function mRotZ(a) { var c = Math.cos(a), s = Math.sin(a); return new Float32Array([c,s,0,0, -s,c,0,0, 0,0,1,0, 0,0,0,1]); }
  function mScale(s) { return new Float32Array([s,0,0,0, 0,s,0,0, 0,0,s,0, 0,0,0,1]); }

  function makeProg(vsSrc, fsSrc) {
    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    }
    var vs = sh(gl.VERTEX_SHADER, vsSrc), fs = sh(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    var p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
  }
  function vbo(data) {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    return b;
  }
  function ibo(data) {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(data), gl.STATIC_DRAW);
    return b;
  }

  /* ----- Program A: painted backdrop (cover-cropped textured quad) ----- */
  var progBg = makeProg(
    "attribute vec2 p; varying vec2 vUv;" +
    "void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }",
    "precision mediump float; varying vec2 vUv;" +
    "uniform sampler2D uTex; uniform vec4 uRect;" +
    "void main(){ vec2 uv = uRect.xy + vUv * uRect.zw; gl_FragColor = texture2D(uTex, uv); }"
  );
  /* ----- Program B: glass orb ----- */
  var progOrb = makeProg(
    "attribute vec3 p; attribute vec3 n;" +
    "uniform mat4 uMVP; uniform mat4 uModel;" +
    "varying vec3 vN; varying vec3 vWP; varying vec3 vObj;" +
    "void main(){ vObj = p; vN = mat3(uModel) * n; vec4 wp = uModel * vec4(p, 1.0); vWP = wp.xyz;" +
    " gl_Position = uMVP * vec4(p, 1.0); }",
    "precision mediump float;" +
    "varying vec3 vN; varying vec3 vWP; varying vec3 vObj;" +
    "uniform float uTime; uniform vec3 uCam;" +
    "void main(){" +
    "  vec3 N = normalize(vN); vec3 V = normalize(uCam - vWP);" +
    "  float fres = pow(1.0 - abs(dot(N, V)), 2.3);" +
    "  float swirl = sin(vObj.y * 7.0 + uTime * 0.6 + sin(vObj.x * 5.0 - uTime * 0.45) * 1.6) * 0.5 + 0.5;" +
    "  float swirl2 = sin(vObj.z * 9.0 - uTime * 0.35 + vObj.y * 4.0) * 0.5 + 0.5;" +
    "  vec3 deep = vec3(0.012, 0.16, 0.10);" +
    "  vec3 mid = vec3(0.03, 0.48, 0.30);" +
    "  vec3 col = mix(deep, mid, swirl * 0.45 + swirl2 * 0.25);" +
    "  col += vec3(0.10, 0.85, 0.55) * pow(swirl * swirl2, 2.0) * 0.55;" +
    "  vec3 L = normalize(vec3(0.5, 0.75, 0.85));" +
    "  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 70.0) * 1.4;" +
    "  vec3 L2 = normalize(vec3(-0.7, -0.35, 0.6));" +
    "  float spec2 = pow(max(dot(reflect(-L2, N), V), 0.0), 26.0) * 0.35;" +
    "  col += vec3(0.85, 1.0, 0.95) * spec + vec3(0.35, 0.75, 0.9) * spec2;" +
    "  col = mix(col, vec3(0.45, 1.0, 0.78), fres * 0.85);" +
    "  float alpha = mix(0.62, 1.0, fres);" +
    "  gl_FragColor = vec4(col, alpha);" +
    "}"
  );
  /* ----- Program C: additive glow / rings / sparkles / core ----- */
  var progFx = makeProg(
    "attribute vec3 p; attribute float aSeed;" +
    "uniform mat4 uMVP; uniform float uPoint; uniform float uTime;" +
    "varying float vSeed;" +
    "void main(){ vSeed = aSeed;" +
    "  vec4 mv = uMVP * vec4(p, 1.0);" +
    "  if (uPoint > 0.5) { gl_PointSize = (2.2 + aSeed * 3.4) * (120.0 / -mv.z); }" +
    "  gl_Position = mv; }",
    "precision mediump float;" +
    "uniform vec4 uColor; uniform float uPoint; uniform float uTime;" +
    "varying float vSeed;" +
    "void main(){" +
    "  float a = uColor.a;" +
    "  if (uPoint > 0.5) {" +
    "    vec2 d = gl_PointCoord - 0.5;" +
    "    float m = smoothstep(0.5, 0.05, length(d));" +
    "    float tw = 0.65 + 0.35 * sin(uTime * (1.2 + vSeed * 2.0) + vSeed * 40.0);" +
    "    a *= m * tw;" +
    "  }" +
    "  gl_FragColor = vec4(uColor.rgb, a);" +
    "}"
  );
  if (!progBg || !progOrb || !progFx) return;

  /* ----- geometry ----- */
  var quadBuf = vbo([-1, -1, 1, -1, -1, 1, 1, 1]);

  function sphereGeo(r, w, h) {
    var pos = [], nor = [], idx = [];
    for (var y = 0; y <= h; y++) {
      var v = y / h, phi = v * Math.PI;
      for (var x = 0; x <= w; x++) {
        var u = x / w, th = u * Math.PI * 2;
        var px = -r * Math.cos(th) * Math.sin(phi);
        var py = r * Math.cos(phi);
        var pz = r * Math.sin(th) * Math.sin(phi);
        pos.push(px, py, pz);
        var l = Math.sqrt(px * px + py * py + pz * pz) || 1;
        nor.push(px / l, py / l, pz / l);
      }
    }
    for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) {
      var a = j * (w + 1) + i, b = a + 1, c = a + w + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    return { pos: vbo(pos), nor: vbo(nor), idx: ibo(idx), count: idx.length };
  }
  function torusGeo(r, tube, rad, tub) {
    var pos = [], idx = [];
    for (var j = 0; j <= rad; j++) {
      var v = j / rad * Math.PI * 2;
      for (var i = 0; i <= tub; i++) {
        var u = i / tub * Math.PI * 2;
        var cx = r * Math.cos(v), cy = r * Math.sin(v);
        pos.push(cx + tube * Math.cos(u) * Math.cos(v), cy + tube * Math.cos(u) * Math.sin(v), tube * Math.sin(u));
      }
    }
    for (var a = 0; a < rad; a++) for (var b = 0; b < tub; b++) {
      var p1 = a * (tub + 1) + b, p2 = p1 + tub + 1;
      idx.push(p1, p2, p1 + 1, p1 + 1, p2, p2 + 1);
    }
    return { pos: vbo(pos), idx: ibo(idx), count: idx.length };
  }
  var orbGeo = sphereGeo(1.15, 48, 32);
  var coreGeo = sphereGeo(0.58, 24, 16);
  var ringA = torusGeo(1.62, 0.016, 110, 6);
  var ringB = torusGeo(1.86, 0.010, 110, 6);

  var sparkPos = [], sparkSeed = [];
  for (var i = 0; i < 240; i++) {
    var ang = Math.random() * Math.PI * 2;
    var rad2 = 1.35 + Math.random() * 0.85;
    sparkPos.push(Math.cos(ang) * rad2, (Math.random() - 0.5) * 0.55, Math.sin(ang) * rad2);
    sparkSeed.push(Math.random());
  }
  var sparkBuf = vbo(sparkPos), sparkSeedBuf = vbo(sparkSeed);

  /* soft radial glow texture, drawn on a 2D canvas */
  function glowTexture() {
    var c = document.createElement("canvas");
    c.width = c.height = 128;
    var g = c.getContext("2d");
    var grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, "rgba(255,255,255,0.85)");
    grad.addColorStop(0.35, "rgba(255,255,255,0.28)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  /* ----- backdrop texture + cover crop (matches the <img> CSS) ----- */
  var bgTex = null, bgRect = [0, 0, 1, 1];
  function coverRect(cw, ch, iw, ih) {
    var ai = iw / ih, ac = cw / ch, w, h, x, y, POS_Y = 0.40;
    if (ac > ai) { w = 1; h = ai / ac; x = 0; y = (1 - h) * (1 - POS_Y); }
    else { h = 1; w = ac / ai; x = (1 - w) / 2; y = (1 - h) * (1 - POS_Y); }
    return [x, y, w, h];
  }
  var bgImg = new Image();
  bgImg.onload = function () {
    bgTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgImg);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    resize();
    canvas.classList.add("on");
    heroImg.style.opacity = "0";
    requestAnimationFrame(tick);
  };
  bgImg.src = "bg.webp";
  var glowTex = glowTexture();

  /* ----- sizing ----- */
  var proj = mIdent();
  function resize() {
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    proj = mPersp(0.72, w / h, 0.1, 50);
    if (bgImg.naturalWidth) bgRect = coverRect(w, h, bgImg.naturalWidth, bgImg.naturalHeight);
  }
  resize();
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  /* ----- interaction: drag to spin, tilt, idle motion ----- */
  var rotY = 0.4, rotX = 0.12, velY = 0, velX = 0;
  var tiltX = 0, tiltY = 0;
  var dragging = false, lastPX = 0, lastPY = 0;
  wrap.addEventListener("pointerdown", function (e) {
    dragging = true; lastPX = e.clientX; lastPY = e.clientY;
  });
  window.addEventListener("pointermove", function (e) {
    if (!dragging) return;
    var dx = e.clientX - lastPX, dy = e.clientY - lastPY;
    lastPX = e.clientX; lastPY = e.clientY;
    velY = dx * 0.0045; velX = dy * 0.003;
    rotY += velY * 2.2; rotX += velX * 2.2;
  }, { passive: true });
  window.addEventListener("pointerup", function () { dragging = false; });
  window.addEventListener("pointercancel", function () { dragging = false; });
  window.addEventListener("deviceorientation", function (e) {
    if (e.gamma === null || e.beta === null) return;
    tiltY = Math.max(-1, Math.min(1, e.gamma / 26)) * 0.35;
    tiltX = Math.max(-1, Math.min(1, (e.beta - 42) / 26)) * -0.22;
  }, { passive: true });

  var visible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[0].isIntersecting;
    }, { threshold: 0.03 }).observe(canvas);
  }

  /* ----- draw helpers ----- */
  function drawBg() {
    gl.useProgram(progBg);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    var loc = gl.getAttribLocation(progBg, "p");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.uniform1i(gl.getUniformLocation(progBg, "uTex"), 0);
    gl.uniform4f(gl.getUniformLocation(progBg, "uRect"), bgRect[0], bgRect[1], bgRect[2], bgRect[3]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  function drawFx(geo, mvp, color, isPoints, count) {
    gl.useProgram(progFx);
    var loc = gl.getAttribLocation(progFx, "p");
    gl.bindBuffer(gl.ARRAY_BUFFER, geo);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    var sLoc = gl.getAttribLocation(progFx, "aSeed");
    if (isPoints) {
      gl.bindBuffer(gl.ARRAY_BUFFER, sparkSeedBuf);
      gl.enableVertexAttribArray(sLoc);
      gl.vertexAttribPointer(sLoc, 1, gl.FLOAT, false, 0, 0);
    } else if (sLoc >= 0) {
      gl.disableVertexAttribArray(sLoc);
      gl.vertexAttrib1f(sLoc, 0.5);
    }
    gl.uniformMatrix4fv(gl.getUniformLocation(progFx, "uMVP"), false, mvp);
    gl.uniform4f(gl.getUniformLocation(progFx, "uColor"), color[0], color[1], color[2], color[3]);
    gl.uniform1f(gl.getUniformLocation(progFx, "uPoint"), isPoints ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(progFx, "uTime"), perfT);
    if (isPoints) gl.drawArrays(gl.POINTS, 0, count);
  }
  function drawTorus(geo, mvp, color) {
    drawFx(geo.pos, mvp, color, false, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geo.idx);
    gl.drawElements(gl.TRIANGLES, geo.count, gl.UNSIGNED_SHORT, 0);
  }
  function drawSphere(geo, model, time) {
    gl.useProgram(progOrb);
    var pLoc = gl.getAttribLocation(progOrb, "p");
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.pos);
    gl.enableVertexAttribArray(pLoc);
    gl.vertexAttribPointer(pLoc, 3, gl.FLOAT, false, 0, 0);
    var nLoc = gl.getAttribLocation(progOrb, "n");
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.nor);
    gl.enableVertexAttribArray(nLoc);
    gl.vertexAttribPointer(nLoc, 3, gl.FLOAT, false, 0, 0);
    var mvp = mMul(proj, model);
    gl.uniformMatrix4fv(gl.getUniformLocation(progOrb, "uMVP"), false, mvp);
    gl.uniformMatrix4fv(gl.getUniformLocation(progOrb, "uModel"), false, model);
    gl.uniform1f(gl.getUniformLocation(progOrb, "uTime"), time);
    gl.uniform3f(gl.getUniformLocation(progOrb, "uCam"), 0, 0, 0); /* positions are view-space: camera at origin */
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geo.idx);
    gl.drawElements(gl.TRIANGLES, geo.count, gl.UNSIGNED_SHORT, 0);
  }
  /* glow quad has its own minimal program (needs a 3D transform) */
  var progGlow = makeProg(
    "attribute vec2 p; uniform mat4 uMVP; varying vec2 vUv;" +
    "void main(){ vUv = p * 0.5 + 0.5; gl_Position = uMVP * vec4(p, 0.0, 1.0); }",
    "precision mediump float; varying vec2 vUv;" +
    "uniform sampler2D uTex; uniform vec3 uTint; uniform float uAlpha;" +
    "void main(){ float a = texture2D(uTex, vUv).a; gl_FragColor = vec4(uTint, a * uAlpha); }"
  );
  function drawGlowQuad(model) {
    if (!progGlow) return;
    gl.useProgram(progGlow);
    var loc = gl.getAttribLocation(progGlow, "p");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, glowTex);
    gl.uniform1i(gl.getUniformLocation(progGlow, "uTex"), 0);
    gl.uniformMatrix4fv(gl.getUniformLocation(progGlow, "uMVP"), false, mMul(proj, model));
    gl.uniform3f(gl.getUniformLocation(progGlow, "uTint"), 0.15, 0.85, 0.55);
    gl.uniform1f(gl.getUniformLocation(progGlow, "uAlpha"), 0.55);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /* ----- frame ----- */
  var perfT = 0, start = null;
  function tick(ts) {
    requestAnimationFrame(tick);
    if (document.hidden || !visible || !bgTex) return;
    if (start === null) start = ts;
    var t = (ts - start) / 1000;
    perfT = t;

    if (!dragging) {
      rotY += 0.0016 + velY;
      rotX += velX;
      velY *= 0.94; velX *= 0.94;
    }
    rotX = Math.max(-0.75, Math.min(0.75, rotX));
    var bobY = 0.10 + Math.sin(t * 0.8) * 0.06;
    var group = mMul(
      mTrans(0, bobY, 0),
      mMul(mRotY(rotY + tiltY), mRotX(rotX + tiltX + Math.sin(t * 0.25) * 0.05))
    );
    var view = mTrans(0, 0, -6.4);
    var groupView = mMul(view, group);

    gl.clearColor(0.008, 0.05, 0.03, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawBg();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    /* halo behind the orb */
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    drawGlowQuad(mMul(view, mMul(mTrans(0, bobY, -0.9), mScale(2.6))));
    /* glowing core */
    drawFx(coreGeo.pos, mMul(proj, mMul(groupView, mScale(1))), [0.16, 0.9, 0.6, 0.30 + Math.sin(t * 1.6) * 0.07], false, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, coreGeo.idx);
    gl.drawElements(gl.TRIANGLES, coreGeo.count, gl.UNSIGNED_SHORT, 0);
    gl.depthMask(true);
    /* glass orb */
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    drawSphere(orbGeo, groupView, t);
    /* rings + sparkles */
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.depthMask(false);
    var ringModelA = mMul(groupView, mMul(mRotX(Math.PI / 2.35), mMul(mRotY(0.4), mRotZ(t * 0.35))));
    drawTorus(ringA, mMul(proj, ringModelA), [0.20, 0.95, 0.65, 0.85]);
    var ringModelB = mMul(groupView, mMul(mRotX(Math.PI / 1.75), mMul(mRotY(-0.6), mRotZ(-t * 0.22))));
    drawTorus(ringB, mMul(proj, ringModelB), [0.65, 1.0, 0.85, 0.40]);
    var sparkModel = mMul(groupView, mRotY(t * 0.05));
    drawFx(sparkBuf, mMul(proj, sparkModel), [0.75, 1.0, 0.88, 0.85], true, 240);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
})();
