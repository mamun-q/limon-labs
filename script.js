/* LIMON Labs — scroll reveal + lightweight interactive 3D orb (Three.js)
   Mobile-first: DPR capped at 1.5, rendering pauses off-screen / hidden tab,
   prefers-reduced-motion and WebGL failure keep the CSS fallback orb. */
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

  /* ---------- 3D orb ---------- */
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var canvas = document.getElementById("orbCanvas");
  var fallback = document.getElementById("orbFallback");
  if (reducedMotion || !canvas || typeof THREE === "undefined") return; // keep CSS fallback

  var renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  } catch (err) {
    return; // WebGL unavailable — keep CSS fallback
  }
  if (!renderer.getContext()) return;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));

  var scene = new THREE.Scene();
  var camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0, 6.2);

  var group = new THREE.Group();
  scene.add(group);

  /* Orb: emerald glass sphere */
  var orb = new THREE.Mesh(
    new THREE.SphereGeometry(1.15, 48, 48),
    new THREE.MeshPhysicalMaterial({
      color: 0x0e9f6e,
      metalness: 0.1,
      roughness: 0.12,
      transmission: 0.55,
      thickness: 1.4,
      emissive: 0x065f46,
      emissiveIntensity: 0.55,
      clearcoat: 0.7,
      clearcoatRoughness: 0.25
    })
  );
  group.add(orb);

  /* Inner glow core */
  var core = new THREE.Mesh(
    new THREE.SphereGeometry(0.62, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0x34d399, transparent: true, opacity: 0.5 })
  );
  group.add(core);

  /* Two luminous orbit rings */
  function makeRing(radius, color, opacity) {
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 0.012, 8, 128),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity })
    );
    return ring;
  }
  var ringA = makeRing(1.72, 0x34d399, 0.9);
  ringA.rotation.x = Math.PI / 2.4;
  ringA.rotation.y = 0.4;
  group.add(ringA);

  var ringB = makeRing(1.95, 0xa7f3d0, 0.45);
  ringB.rotation.x = Math.PI / 1.8;
  ringB.rotation.y = -0.6;
  group.add(ringB);

  /* Tiny sparkles */
  var sparkCount = 90;
  var sparkPos = new Float32Array(sparkCount * 3);
  for (var i = 0; i < sparkCount; i++) {
    var r = 1.5 + Math.random() * 1.5;
    var theta = Math.random() * Math.PI * 2;
    var phi = Math.acos(2 * Math.random() - 1);
    sparkPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    sparkPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    sparkPos[i * 3 + 2] = r * Math.cos(phi);
  }
  var sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
  var sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    color: 0xa7f3d0, size: 0.045, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  group.add(sparks);

  /* Lights */
  scene.add(new THREE.AmbientLight(0x1d4d3a, 1.4));
  var keyLight = new THREE.PointLight(0x6ee7b7, 60, 30);
  keyLight.position.set(3, 3, 4);
  scene.add(keyLight);
  var rimLight = new THREE.PointLight(0x0ea5e9, 18, 30);
  rimLight.position.set(-4, -2, 3);
  scene.add(rimLight);

  /* Sizing (square stage) */
  function resize() {
    var w = canvas.clientWidth || canvas.parentElement.clientWidth;
    var h = canvas.clientHeight || canvas.parentElement.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener("resize", resize);

  /* Pointer / touch reaction (gentle) */
  var targetX = 0, targetY = 0, tiltX = 0, tiltY = 0;
  var stage = canvas.parentElement;
  function onPointer(e) {
    var rect = stage.getBoundingClientRect();
    var cx = (e.touches ? e.touches[0].clientX : e.clientX);
    var cy = (e.touches ? e.touches[0].clientY : e.clientY);
    targetY = ((cx - rect.left) / rect.width - 0.5) * 0.7;
    targetX = ((cy - rect.top) / rect.height - 0.5) * 0.5;
  }
  stage.addEventListener("pointermove", onPointer, { passive: true });
  stage.addEventListener("touchmove", onPointer, { passive: true });
  stage.addEventListener("pointerleave", function () { targetX = 0; targetY = 0; });

  /* Pause when hero off-screen or tab hidden */
  var heroVisible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      heroVisible = entries[0].isIntersecting;
    }, { threshold: 0.05 }).observe(stage);
  }

  /* WebGL ready — swap fallback for canvas */
  fallback.classList.add("off");
  canvas.classList.add("on");

  var clock = new THREE.Clock();
  function animate() {
    requestAnimationFrame(animate);
    if (document.hidden || !heroVisible) return;
    var t = clock.getElapsedTime();

    tiltX += (targetX - tiltX) * 0.04;
    tiltY += (targetY - tiltY) * 0.04;

    group.rotation.y = t * 0.12 + tiltY;
    group.rotation.x = Math.sin(t * 0.25) * 0.08 + tiltX;
    group.position.y = Math.sin(t * 0.8) * 0.06;

    ringA.rotation.z = t * 0.35;
    ringB.rotation.z = -t * 0.22;
    sparks.rotation.y = t * 0.05;
    core.material.opacity = 0.42 + Math.sin(t * 1.6) * 0.1;

    renderer.render(scene, camera);
  }
  animate();
})();
