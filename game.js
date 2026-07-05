/* ===========================================================================
   Fietes Formenflipper: Die Pilz-Arena  –  Spiellogik (game.js)
   ---------------------------------------------------------------------------
   Kindgerechter Lern-Flipper (ca. 6 Jahre): Pilz-Bumper und Tore tragen
   Buchstaben oder geometrische Formen. Jeder Treffer blendet das Symbol
   gross ein und spricht es vor. Missionen ("Triff das M!") geben Bonus-
   punkte – ohne Zeitdruck, ohne Strafen, ohne Game Over.

   AUFBAU DIESER DATEI:
     1.  KONSTANTEN + SYMBOL-POOL
     2.  ZUSTAND (state) + DOM-REFERENZEN
     3.  PHYSIK-WELT (Matter.js): Waende, Bumper, Tore, Slingshots, Flipper
     4.  FLIPPER-STEUERUNG (Touch-Zonen + Tastatur)
     5.  KOLLISIONEN (Treffer-Logik, Punkte, Symbol-Blitz)
     6.  MISSIONS-SYSTEM
     7.  KUGEL-VERWALTUNG (Start, Verlust, Nachschub)
     8.  RENDERING (alles wird selbst auf den Canvas gezeichnet)
     9.  SPIEGEL-MINISPIEL (Symmetrie nachzeichnen)
     10. SOUND (WebAudio) + SPRACHAUSGABE
     11. UI (Titelscreen, Menue, Popover, Konfetti, Speicher)

   ASSETS TAUSCHEN:
     - Grafiken: alle zeichne*()-Funktionen in Abschnitt 8 malen Platzhalter
       (Farben/Formen). Eigene Bilder: dort ctx.drawImage(bild, ...) einsetzen.
     - Sounds: spielKlang() in Abschnitt 10 erzeugt Toene per WebAudio.
       Eigene Sounds: Audio-Objekte laden und dort abspielen.
     - Sprache: sprich() nutzt die Browser-Sprachsynthese (de-DE).
   ===========================================================================*/

(function () {
  "use strict";

  /* 1. KONSTANTEN + SYMBOL-POOL ------------------------------------------- */

  // Logische Spielfeld-Groesse: ALLE Physik-Koordinaten leben in diesem
  // festen Raster und werden beim Zeichnen auf die echte Canvas-Groesse
  // skaliert (Hochformat, Verhaeltnis 2:3).
  var FELD_B = 400;
  var FELD_H = 600;

  var KUGEL_RADIUS   = 11;
  var KUGEL_MAX_TEMPO = 19;      // Tempodeckel gegen Tunneln durch Waende

  // Flipper-Geometrie: Drehpunkte + Laenge + Winkel (Ruhe/oben, Bogenmass)
  var FLIPPER_LAENGE = 64;
  var FLIPPER_DICKE  = 17;
  var FLIPPER_RUHE   = 0.50;     // ~29 Grad nach unten
  var FLIPPER_OBEN   = -0.52;    // ~30 Grad nach oben
  var FLIPPER_TEMPO_HOCH   = 0.30;  // rad pro Physik-Schritt beim Hochschnellen
  var FLIPPER_TEMPO_RUNTER = 0.12;  // ... und beim Zuruecksinken
  var PIVOT_L = { x: 124, y: 522 };
  var PIVOT_R = { x: 276, y: 522 };

  // Punktwerte – bewusst simpel und grosszuegig
  var PUNKTE_BUMPER  = 10;
  var PUNKTE_SLING   = 5;
  var PUNKTE_TOR     = 25;
  var PUNKTE_MISSION = 100;

  // Geometrische Formen als "Symbole": Glyph fuers grosse Einblenden,
  // Name/Artikel fuer Sprachausgabe + Missionstext, Farbe fuers Spielfeld.
  var FORMEN = [
    { id: "kreis",   glyph: "●", name: "Kreis",   artikel: "den", farbe: "#2f6fd6" },
    { id: "dreieck", glyph: "▲", name: "Dreieck", artikel: "das", farbe: "#28c08a" },
    { id: "quadrat", glyph: "■", name: "Quadrat", artikel: "das", farbe: "#ff9e2c" },
    { id: "stern",   glyph: "★", name: "Stern",   artikel: "den", farbe: "#f3c44a" }
  ];
  // Buchstaben: gaengige Grossbuchstaben (ohne leicht verwechselbare Q/X/Y)
  var BUCHSTABEN = "ABCDEFGHIJKLMNOPRSTUVWZ".split("");

  // Konfetti-Farben = Akzentpalette des Spiels
  var KONFETTI_FARBEN = ["#ff9e2c", "#28c08a", "#2f6fd6", "#f3c44a", "#d9453e", "#9a7bd0"];

  var SPEICHER_SCHLUESSEL = "fietes-formenflipper";


  /* 2. ZUSTAND + DOM-REFERENZEN ------------------------------------------- */

  var state = {
    laeuft: false,           // false bis der Titelscreen weggetippt wurde
    punkte: 0,
    sterne: 0,               // geschaffte Missionen
    symbole: "mix",          // Einstellung: buchstaben | formen | mix
    spiegel: true,           // Spiegel-Minispiel zwischen den Kugeln?
    toene: true,
    sprache: true,
    mission: null,           // { elementIndex, symbol } oder null
    kugelUnterwegs: false
  };

  var el = {};               // DOM-Verweise, werden in init() gefuellt
  [
    "titelscreen", "mission-schild", "mission-text", "spielfeld",
    "symbol-blitz", "lob-banner", "zone-links", "zone-rechts",
    "anzeige-punkte", "anzeige-sterne", "stat-punkte", "stat-sterne",
    "button-about", "button-einstellungen", "einstellungen",
    "einstellungen-zu", "einstellungen-fertig", "button-reset",
    "eltern-dialog", "eltern-frage", "eltern-antworten", "eltern-abbrechen",
    "popover", "konfetti", "spiegel-overlay", "spiegel-canvas",
    "spiegel-titel", "spiegel-hinweis", "spiegel-skip"
  ].forEach(function (id) {
    el[id.replace(/-([a-z])/g, function (_, b) { return b.toUpperCase(); })] =
      document.getElementById(id);
  });

  function zufallGanzzahl(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function zufallAus(liste) { return liste[zufallGanzzahl(0, liste.length - 1)]; }
  function leere(node) { while (node.firstChild) { node.removeChild(node.firstChild); } }


  /* 3. PHYSIK-WELT (Matter.js) --------------------------------------------
     Die Welt ist statisch aufgebaut; nur die Kugel bewegt sich frei. Die
     Flipper sind statische Koerper, deren Winkel wir selbst animieren –
     den "Kick" auf die Kugel geben wir in Abschnitt 5 von Hand dazu
     (das ist fuer ein Kinderspiel deutlich berechenbarer als echte
     Motor-Constraints). */

  var Engine = Matter.Engine, Bodies = Matter.Bodies, Body = Matter.Body,
      World = Matter.World, Events = Matter.Events;

  var engine = Engine.create();
  engine.gravity.y = 1.5;                    // etwas flotter als Standard
  engine.positionIterations = 8;             // stabilere Kollisionen
  engine.velocityIterations = 6;

  var kugel = null;                          // der aktuelle Ball (oder null)

  // Ein duennes Wandstueck zwischen zwei Punkten (fuer Dome + Schraegen)
  function wandSegment(x1, y1, x2, y2, dicke) {
    var laenge = Math.hypot(x2 - x1, y2 - y1);
    return Bodies.rectangle((x1 + x2) / 2, (y1 + y2) / 2, laenge, dicke || 14, {
      isStatic: true,
      angle: Math.atan2(y2 - y1, x2 - x1),
      label: "wand"
    });
  }

  // --- Feste Waende: Seiten, oben eine runde Kuppel, unten Einlauf-Schraegen
  var waende = [
    wandSegment(4, 120, 4, 445, 24),         // linke Wand
    wandSegment(396, 120, 396, 445, 24),     // rechte Wand
    wandSegment(4, 445, PIVOT_L.x - 8, PIVOT_L.y + 6, 16),   // Einlauf links
    wandSegment(396, 445, PIVOT_R.x + 8, PIVOT_R.y + 6, 16), // Einlauf rechts
    // unsichtbare Decke knapp ueber dem Sichtbereich: haelt die Kugel im Bild
    Bodies.rectangle(200, -18, 420, 20, { isStatic: true, label: "wand" })
  ];
  // Kuppel oben: Halbkreis aus kurzen Segmenten (Radius 196 um (200,124))
  (function () {
    var cx = 200, cy = 124, r = 196, schritte = 14;
    for (var i = 0; i < schritte; i++) {
      var a1 = Math.PI + (i / schritte) * Math.PI;
      var a2 = Math.PI + ((i + 1) / schritte) * Math.PI;
      waende.push(wandSegment(
        cx + r * Math.cos(a1), cy + r * Math.sin(a1),
        cx + r * Math.cos(a2), cy + r * Math.sin(a2), 18));
    }
  })();

  // --- Pilz-Bumper: drei Kreise im oberen Feld. "elemente" sammelt alles,
  //     was ein Symbol traegt (Bumper + Tore) fuer Missionen & Rendering.
  var elemente = [];         // { art, body, x, y, r/w, symbol, blitzZeit }

  [{ x: 112, y: 208 }, { x: 288, y: 208 }, { x: 200, y: 306 }]
    .forEach(function (p, i) {
      var body = Bodies.circle(p.x, p.y, 27, { isStatic: true, label: "bumper-" + i });
      elemente.push({ art: "bumper", body: body, x: p.x, y: p.y, r: 27, symbol: null, blitzZeit: 0 });
    });

  // --- Tore: drei "Tuerchen" (abgerundete Kloetze) an Kuppel und Seiten.
  //     Das obere ist MINIMAL geneigt, damit die Kugel nicht darauf
  //     liegen bleiben kann, sondern immer herunterrollt.
  [{ x: 200, y: 96, winkel: 0.08 },
   { x: 52,  y: 330, winkel:  0.42 },
   { x: 348, y: 330, winkel: -0.42 }]
    .forEach(function (p, i) {
      var body = Bodies.rectangle(p.x, p.y, 58, 22, {
        isStatic: true, angle: p.winkel, label: "tor-" + i, chamfer: { radius: 8 }
      });
      elemente.push({ art: "tor", body: body, x: p.x, y: p.y, w: 58, h: 22,
                      winkel: p.winkel, symbol: null, blitzZeit: 0 });
    });

  // --- Slingshots: zwei Dreiecke ueber den Einlauf-Schraegen, die die Kugel
  //     zurueck ins Feld schubsen (klassisches Flipper-Element).
  //     WICHTIG: genug Abstand zur Einlauf-Schraege lassen (> Kugel-
  //     durchmesser), sonst verkeilt sich die Kugel in der Ecke.
  var slings = [];
  [
    [{ x: 98, y: 396 }, { x: 138, y: 460 }, { x: 98, y: 460 }],
    [{ x: 302, y: 396 }, { x: 262, y: 460 }, { x: 302, y: 460 }]
  ].forEach(function (ecken, i) {
    var body = Bodies.fromVertices(0, 0, [ecken], { isStatic: true, label: "sling-" + i });
    // fromVertices zentriert die Form – wieder an die richtige Stelle ruecken
    var mx = (ecken[0].x + ecken[1].x + ecken[2].x) / 3;
    var my = (ecken[0].y + ecken[1].y + ecken[2].y) / 3;
    Body.setPosition(body, { x: mx, y: my });
    slings.push({ body: body, ecken: ecken, blitzZeit: 0 });
  });

  // --- Flipper: statische Rechtecke, Winkel wird pro Frame animiert.
  //     seite: -1 = links (Winkel direkt), +1 = rechts (gespiegelt).
  function baueFlipper(pivot, seite) {
    var body = Bodies.rectangle(pivot.x, pivot.y, FLIPPER_LAENGE, FLIPPER_DICKE, {
      isStatic: true, label: seite < 0 ? "flipper-l" : "flipper-r",
      chamfer: { radius: FLIPPER_DICKE / 2 - 1 }
    });
    return { body: body, pivot: pivot, seite: seite,
             winkel: FLIPPER_RUHE, omega: 0, gedrueckt: false };
  }
  var flipperL = baueFlipper(PIVOT_L, -1);
  var flipperR = baueFlipper(PIVOT_R, +1);

  // Position/Winkel des Flipper-Koerpers aus Drehpunkt + Winkel ableiten.
  // Der Drehpunkt sitzt am INNEREN Ende, der Arm zeigt zur Feldmitte.
  function setzeFlipperKoerper(f) {
    var a = f.seite < 0 ? f.winkel : Math.PI - f.winkel;   // rechts gespiegelt
    Body.setPosition(f.body, {
      x: f.pivot.x + (FLIPPER_LAENGE / 2) * Math.cos(a),
      y: f.pivot.y + (FLIPPER_LAENGE / 2) * Math.sin(a)
    });
    Body.setAngle(f.body, a);
  }
  setzeFlipperKoerper(flipperL);
  setzeFlipperKoerper(flipperR);

  // Flipper-Winkel pro Physik-Schritt Richtung Ziel bewegen (schnell hoch,
  // gemuetlich runter). omega merken wir uns fuer den Kugel-Kick.
  function animiereFlipper(f) {
    var ziel = f.gedrueckt ? FLIPPER_OBEN : FLIPPER_RUHE;
    var tempo = f.gedrueckt ? FLIPPER_TEMPO_HOCH : FLIPPER_TEMPO_RUNTER;
    var vorher = f.winkel;
    if (f.winkel > ziel) { f.winkel = Math.max(ziel, f.winkel - tempo); }
    else                 { f.winkel = Math.min(ziel, f.winkel + tempo); }
    f.omega = f.winkel - vorher;             // negativ = Arm schwingt hoch
    if (f.omega !== 0) { setzeFlipperKoerper(f); }
  }

  // Alles in die Welt setzen
  World.add(engine.world, waende
    .concat(elemente.map(function (e) { return e.body; }))
    .concat(slings.map(function (s) { return s.body; }))
    .concat([flipperL.body, flipperR.body]));


  /* 4. FLIPPER-STEUERUNG ---------------------------------------------------
     Grosse Touch-Zonen: gedrueckt halten = Arm oben, loslassen = Arm faellt.
     Zusaetzlich Pfeiltasten fuer Desktop-Tests. */

  function bindeZone(zone, flipper) {
    function druecken(ereignis) {
      ereignis.preventDefault();
      flipper.gedrueckt = true;
      zone.classList.add("aktiv");
      weckeAudio();
      spielKlang("flipper");
    }
    function loslassen() {
      flipper.gedrueckt = false;
      zone.classList.remove("aktiv");
    }
    zone.addEventListener("pointerdown", druecken);
    zone.addEventListener("pointerup", loslassen);
    zone.addEventListener("pointercancel", loslassen);
    zone.addEventListener("pointerleave", loslassen);
    zone.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }
  bindeZone(el.zoneLinks, flipperL);
  bindeZone(el.zoneRechts, flipperR);

  document.addEventListener("keydown", function (e) {
    if (e.repeat) { return; }
    if (e.key === "ArrowLeft")  { flipperL.gedrueckt = true; el.zoneLinks.classList.add("aktiv"); }
    if (e.key === "ArrowRight") { flipperR.gedrueckt = true; el.zoneRechts.classList.add("aktiv"); }
  });
  document.addEventListener("keyup", function (e) {
    if (e.key === "ArrowLeft")  { flipperL.gedrueckt = false; el.zoneLinks.classList.remove("aktiv"); }
    if (e.key === "ArrowRight") { flipperR.gedrueckt = false; el.zoneRechts.classList.remove("aktiv"); }
  });


  /* 5. KOLLISIONEN ---------------------------------------------------------
     Treffer-Logik: Bumper/Tore zeigen ihr Symbol gross, sprechen es vor
     und geben Punkte. Der Bumper-Kick und der Flipper-Kick werden von
     Hand als Geschwindigkeit auf die Kugel gegeben – gut steuerbar. */

  var trefferSperre = {};    // label -> Zeitstempel (verhindert Doppel-Treffer)

  function darfTreffen(label) {
    var jetzt = performance.now();
    if (trefferSperre[label] && jetzt - trefferSperre[label] < 350) { return false; }
    trefferSperre[label] = jetzt;
    return true;
  }

  function begrenzeTempo() {
    if (!kugel) { return; }
    var v = kugel.velocity, tempo = Math.hypot(v.x, v.y);
    if (tempo > KUGEL_MAX_TEMPO) {
      Body.setVelocity(kugel, { x: v.x / tempo * KUGEL_MAX_TEMPO,
                                y: v.y / tempo * KUGEL_MAX_TEMPO });
    }
  }

  Events.on(engine, "collisionStart", function (ereignis) {
    ereignis.pairs.forEach(function (paar) {
      var a = paar.bodyA, b = paar.bodyB;
      var anderer = a.label === "kugel" ? b : (b.label === "kugel" ? a : null);
      if (!anderer || !kugel) { return; }

      if (anderer.label.indexOf("bumper-") === 0) { aufBumper(anderer); }
      else if (anderer.label.indexOf("tor-") === 0) { aufTor(anderer); }
      else if (anderer.label.indexOf("sling-") === 0) { aufSling(anderer); }
      else if (anderer.label.indexOf("flipper-") === 0) { kickeVonFlipper(anderer); }
    });
  });

  // Waehrend der Arm hochschwingt auch bei ANHALTENDEM Kontakt kicken –
  // sonst bleibt eine ruhende Kugel auf dem Flipper liegen.
  Events.on(engine, "collisionActive", function (ereignis) {
    ereignis.pairs.forEach(function (paar) {
      var a = paar.bodyA, b = paar.bodyB;
      var anderer = a.label === "kugel" ? b : (b.label === "kugel" ? a : null);
      if (anderer && anderer.label.indexOf("flipper-") === 0) { kickeVonFlipper(anderer); }
    });
  });

  // Flipper-Kick: Tangentialgeschwindigkeit des Arms an der Kugelposition
  // (omega x Hebelarm), skaliert – fuehlt sich wie ein echter Schlag an.
  function kickeVonFlipper(flipperBody) {
    var f = flipperBody.label === "flipper-l" ? flipperL : flipperR;
    if (!kugel || f.omega >= 0) { return; }          // nur beim Hochschwingen
    var hebelX = kugel.position.x - f.pivot.x;
    var hebelY = kugel.position.y - f.pivot.y;
    // omega ist in "Winkel pro Schritt"; rechts dreht der Arm andersherum
    var omega = f.omega * (f.seite < 0 ? 1 : -1) * 60 * 0.9;
    Body.setVelocity(kugel, {
      x: kugel.velocity.x + (-omega * hebelY) * 0.016,
      y: kugel.velocity.y + ( omega * hebelX) * 0.016 - 2.5
    });
    begrenzeTempo();
  }

  function elementZuLabel(label) {
    for (var i = 0; i < elemente.length; i++) {
      if (elemente[i].body.label === label) { return elemente[i]; }
    }
    return null;
  }

  function aufBumper(body) {
    if (!darfTreffen(body.label)) { return; }
    var e = elementZuLabel(body.label);
    e.blitzZeit = performance.now();
    // Kick: Kugel radial vom Pilz wegschubsen
    var dx = kugel.position.x - e.x, dy = kugel.position.y - e.y;
    var d = Math.hypot(dx, dy) || 1;
    Body.setVelocity(kugel, { x: dx / d * 11, y: dy / d * 11 });
    gibPunkte(PUNKTE_BUMPER);
    spielKlang("bumper");
    zeigeSymbol(e.symbol);
    pruefeMission(e);
  }

  function aufTor(body) {
    if (!darfTreffen(body.label)) { return; }
    var e = elementZuLabel(body.label);
    e.blitzZeit = performance.now();
    gibPunkte(PUNKTE_TOR);
    spielKlang("tor");
    zeigeSymbol(e.symbol);
    pruefeMission(e);
  }

  function aufSling(body) {
    if (!darfTreffen(body.label)) { return; }
    var s = body.label === "sling-0" ? slings[0] : slings[1];
    s.blitzZeit = performance.now();
    // zur Feldmitte hoch schubsen
    var richtung = body.label === "sling-0" ? 1 : -1;
    Body.setVelocity(kugel, { x: richtung * 6, y: -9 });
    gibPunkte(PUNKTE_SLING);
    spielKlang("sling");
  }

  // Grosses Symbol in der Feldmitte aufblitzen lassen + vorsprechen
  function zeigeSymbol(symbol) {
    if (!symbol) { return; }
    var blitz = el.symbolBlitz;
    blitz.classList.remove("zeigt");
    void blitz.offsetWidth;                 // Animation neu starten
    if (symbol.art === "form") {
      blitz.textContent = symbol.glyph;
      blitz.style.color = symbol.farbe;
      sprich(symbol.name);
    } else {
      blitz.textContent = symbol.zeichen;
      blitz.style.color = "#1e2c52";
      sprich(symbol.zeichen);
    }
    blitz.classList.add("zeigt");
  }

  function gibPunkte(n) {
    state.punkte += n;
    el.anzeigePunkte.textContent = state.punkte;
    el.statPunkte.classList.remove("plopp");
    void el.statPunkte.offsetWidth;
    el.statPunkte.classList.add("plopp");
    speichereStand();
  }


  /* 6. MISSIONS-SYSTEM ------------------------------------------------------
     Alle paar Sekunden erscheint eine Mission ("Triff das M!"). Das passende
     Element pulsiert golden. Treffer = Bonuspunkte + Stern + Konfetti.
     Kein Countdown, keine Strafe – die Mission wartet geduldig. */

  var missionTimer = null;

  // Symbol-Objekte: entweder { art:"buchstabe", zeichen } oder eine Form
  function neuesSymbol(benutzt) {
    var pool = state.symbole;
    var nimmForm = pool === "formen" || (pool === "mix" && Math.random() < 0.4);
    for (var versuch = 0; versuch < 40; versuch++) {
      var s;
      if (nimmForm) {
        var f = zufallAus(FORMEN);
        s = { art: "form", id: f.id, glyph: f.glyph, name: f.name,
              artikel: f.artikel, farbe: f.farbe };
      } else {
        var z = zufallAus(BUCHSTABEN);
        s = { art: "buchstabe", id: "b-" + z, zeichen: z };
      }
      if (!benutzt[s.id]) { benutzt[s.id] = true; return s; }
    }
    return s;                                // (praktisch unerreichbar)
  }

  // Allen Bumpern/Toren frische, untereinander verschiedene Symbole geben
  function verteileSymbole() {
    var benutzt = {};
    elemente.forEach(function (e) { e.symbol = neuesSymbol(benutzt); });
  }

  function missionText(symbol) {
    return symbol.art === "form"
      ? "Triff " + symbol.artikel + " " + symbol.name + "!"
      : "Triff das " + symbol.zeichen + "!";
  }

  function starteMission() {
    var e = zufallAus(elemente);
    state.mission = { element: e, symbol: e.symbol };
    el.missionText.textContent = missionText(e.symbol);
    el.missionSchild.classList.remove("neu");
    void el.missionSchild.offsetWidth;
    el.missionSchild.classList.add("neu");
    spielKlang("mission");
    sprich("Neue Mission! " + missionText(e.symbol));
  }

  function planeMission(verzoegerungMs) {
    window.clearTimeout(missionTimer);
    missionTimer = window.setTimeout(starteMission, verzoegerungMs);
  }

  function pruefeMission(element) {
    if (!state.mission || state.mission.element !== element) { return; }
    state.mission = null;
    state.sterne += 1;
    el.anzeigeSterne.textContent = state.sterne;
    gibPunkte(PUNKTE_MISSION);
    el.missionText.textContent = "Geschafft! ⭐";
    el.missionSchild.classList.add("geschafft");
    window.setTimeout(function () { el.missionSchild.classList.remove("geschafft"); }, 1000);
    // Lob-Banner + Konfetti + Jubel
    el.lobBanner.hidden = false;
    el.lobBanner.classList.remove("zeigt");
    void el.lobBanner.offsetWidth;
    el.lobBanner.classList.add("zeigt");
    window.setTimeout(function () { el.lobBanner.hidden = true; }, 1500);
    werfeKonfetti();
    spielKlang("erfolg");
    sprich(zufallAus(["Super gemacht!", "Klasse Treffer!", "Wunderbar!", "Du bist spitze!"]));
    // Neue Symbole verteilen und die naechste Mission ankuendigen
    window.setTimeout(verteileSymbole, 1600);
    planeMission(6000);
    speichereStand();
  }

  // Mission antippen -> nochmal vorlesen (fuer Nichtleser wichtig)
  el.missionSchild.addEventListener("click", function () {
    if (state.mission) { sprich(missionText(state.mission.symbol)); }
    else { sprich("Gleich kommt eine neue Mission!"); }
  });


  /* 7. KUGEL-VERWALTUNG ----------------------------------------------------- */

  function neueKugel() {
    if (kugel) { World.remove(engine.world, kugel); }
    kugel = Bodies.circle(200 + zufallGanzzahl(-40, 40), 60, KUGEL_RADIUS, {
      label: "kugel",
      restitution: 0.45,
      friction: 0.002,
      frictionAir: 0.004,
      density: 0.0022
    });
    Body.setVelocity(kugel, { x: zufallGanzzahl(-3, 3), y: 2 });
    World.add(engine.world, kugel);
    state.kugelUnterwegs = true;
    spielKlang("start");
  }

  // Anti-Klemm-Sicherung: steht die Kugel laenger als ~3 Sekunden fast
  // still (in einer Ecke verkeilt o.ae.), bekommt sie einen sanften Schubs
  // Richtung Feldmitte. So kann NIE dauerhaft Stillstand entstehen.
  var stillstandSeit = 0;
  function pruefeStillstand() {
    if (!kugel || !state.kugelUnterwegs) { stillstandSeit = 0; return; }
    var tempo = Math.hypot(kugel.velocity.x, kugel.velocity.y);
    // Auf den Flipper-Armen darf sie ruhig liegen (das Kind zielt gerade)
    var aufFlipper = kugel.position.y > 480 &&
                     kugel.position.x > 90 && kugel.position.x < 310;
    if (tempo > 0.6 || aufFlipper) { stillstandSeit = 0; return; }
    if (!stillstandSeit) { stillstandSeit = performance.now(); return; }
    if (performance.now() - stillstandSeit > 3000) {
      Body.setVelocity(kugel, {
        x: (200 - kugel.position.x) * 0.02 + zufallGanzzahl(-2, 2),
        y: -5
      });
      stillstandSeit = 0;
    }
  }

  // Kugel unten herausgefallen? (wird im Game-Loop geprueft)
  function pruefeKugelVerlust() {
    if (!kugel || !state.kugelUnterwegs) { return; }
    if (kugel.position.y > FELD_H + 60) {
      state.kugelUnterwegs = false;
      World.remove(engine.world, kugel);
      kugel = null;
      spielKlang("verloren");
      if (state.spiegel) {
        oeffneSpiegelSpiel();                // Minispiel -> danach neue Kugel
      } else {
        window.setTimeout(neueKugel, 900);
      }
    }
  }


  /* 8. RENDERING -------------------------------------------------------------
     Wir zeichnen ALLES selbst (statt Matter.Render): so sehen Bumper wie
     Pilze aus, Tore wie Tuerchen, und die Missions-Markierung pulsiert.
     >>> Hier eigene Grafiken einsetzen: statt der Zeichen-Befehle einfach
     ctx.drawImage(meinBild, x, y, breite, hoehe) verwenden. <<< */

  var ctx = el.spielfeld.getContext("2d");
  var skala = 1, versatzX = 0, versatzY = 0;   // logisches Feld -> Canvas

  function passeCanvasAn() {
    var dpr = window.devicePixelRatio || 1;
    var box = el.spielfeld.getBoundingClientRect();
    el.spielfeld.width = Math.round(box.width * dpr);
    el.spielfeld.height = Math.round(box.height * dpr);
    skala = Math.min(el.spielfeld.width / FELD_B, el.spielfeld.height / FELD_H);
    versatzX = (el.spielfeld.width - FELD_B * skala) / 2;
    versatzY = (el.spielfeld.height - FELD_H * skala) / 2;
  }
  window.addEventListener("resize", passeCanvasAn);

  // Hilfen: Blitz-Intensitaet (1 direkt nach Treffer -> 0 nach 300 ms)
  function blitzWert(zeit) {
    var d = performance.now() - zeit;
    return d < 300 ? 1 - d / 300 : 0;
  }

  function zeichneFeld() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.spielfeld.width, el.spielfeld.height);
    ctx.setTransform(skala, 0, 0, skala, versatzX, versatzY);

    zeichneHintergrund();
    slings.forEach(zeichneSling);
    elemente.forEach(function (e) {
      if (e.art === "bumper") { zeichneBumper(e); } else { zeichneTor(e); }
    });
    zeichneFlipper(flipperL);
    zeichneFlipper(flipperR);
    if (kugel) { zeichneKugel(); }
  }

  // Spielfeld-Grund: heller Teppich mit Kuppel-Rand und Einlauf-Schraegen
  function zeichneHintergrund() {
    ctx.beginPath();
    feldUmriss();
    var verlauf = ctx.createLinearGradient(0, 0, 0, FELD_H);
    verlauf.addColorStop(0, "#ffffff");
    verlauf.addColorStop(1, "#e9f0fc");
    ctx.fillStyle = verlauf;
    ctx.fill();
    ctx.lineWidth = 10;
    ctx.strokeStyle = "#f3c44a";            // goldener Rand wie die Lernuhr
    ctx.stroke();

    // sanfte Deko-Punkte (Platzhalter fuer eigenes Hintergrundbild)
    ctx.fillStyle = "rgba(47, 111, 214, 0.05)";
    for (var i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(60 + i * 70, 150 + (i % 2) * 220, 16, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Umriss des Felds (Kuppel + Seiten + Einlauf + Abfluss) als Pfad
  function feldUmriss() {
    ctx.moveTo(4, 445);
    ctx.lineTo(4, 124);
    ctx.arc(200, 124, 196, Math.PI, 0);     // Kuppel
    ctx.lineTo(396, 445);
    ctx.lineTo(PIVOT_R.x + 8, PIVOT_R.y + 6);
    ctx.lineTo(PIVOT_R.x + 8, FELD_H);
    ctx.lineTo(PIVOT_L.x - 8, FELD_H);
    ctx.lineTo(PIVOT_L.x - 8, PIVOT_L.y + 6);
    ctx.closePath();
  }

  // Traegt dieses Element gerade die Mission? -> goldener Puls-Ring
  function zeichneMissionsRing(x, y, radius) {
    var puls = 0.5 + 0.5 * Math.sin(performance.now() / 220);
    ctx.beginPath();
    ctx.arc(x, y, radius + 7 + puls * 4, 0, Math.PI * 2);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(255, 158, 44, " + (0.55 + puls * 0.45) + ")";
    ctx.stroke();
  }

  // --- Pilz-Bumper: roter Hut mit weissen Punkten, Symbol gross auf dem Hut
  function zeichneBumper(e) {
    var blitz = blitzWert(e.blitzZeit);
    var r = e.r + blitz * 5;                // ploppt beim Treffer kurz auf

    if (state.mission && state.mission.element === e) {
      zeichneMissionsRing(e.x, e.y, e.r);
    }

    // Stiel
    ctx.fillStyle = "#f2e3c8";
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + r * 0.55, r * 0.42, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hut (blitzt beim Treffer heller)
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fillStyle = blitz > 0 ? "#ff7a68" : "#e0503f";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#b23a2c";
    ctx.stroke();

    // weisse Tupfen
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    [[-0.55, -0.35, 0.16], [0.45, -0.5, 0.13], [0.15, 0.55, 0.12]].forEach(function (t) {
      ctx.beginPath();
      ctx.arc(e.x + t[0] * r, e.y + t[1] * r, t[2] * r, 0, Math.PI * 2);
      ctx.fill();
    });

    // helles Schild in der Mitte mit dem Symbol
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * 0.62, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    zeichneSymbol(e.symbol, e.x, e.y, r * 0.8);
  }

  // --- Tor: abgerundetes Tuerchen mit Symbol
  function zeichneTor(e) {
    var blitz = blitzWert(e.blitzZeit);
    if (state.mission && state.mission.element === e) {
      zeichneMissionsRing(e.x, e.y, 34);
    }
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.winkel);
    ctx.beginPath();
    abgerundetesRechteck(-e.w / 2, -e.h / 2, e.w, e.h, 9);
    ctx.fillStyle = blitz > 0 ? "#ffe9c4" : "#ffffff";
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "#2b4373";
    ctx.stroke();
    ctx.restore();
    zeichneSymbol(e.symbol, e.x, e.y, 24);
  }

  function abgerundetesRechteck(x, y, b, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + b, y, x + b, y + h, r);
    ctx.arcTo(x + b, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + b, y, r);
    ctx.closePath();
  }

  // Symbol (Buchstabe oder Form) zentriert zeichnen. groesse ~ Hoehe in px.
  function zeichneSymbol(symbol, x, y, groesse) {
    if (!symbol) { return; }
    if (symbol.art === "buchstabe") {
      ctx.fillStyle = "#1e2c52";
      ctx.font = "800 " + groesse + "px 'Baloo 2', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(symbol.zeichen, x, y + groesse * 0.06);
      return;
    }
    // Formen als echte Vektoren (nicht als Text) – schoen knackig
    var g = groesse * 0.5;
    ctx.fillStyle = symbol.farbe;
    ctx.beginPath();
    if (symbol.id === "kreis") {
      ctx.arc(x, y, g, 0, Math.PI * 2);
    } else if (symbol.id === "quadrat") {
      ctx.rect(x - g * 0.88, y - g * 0.88, g * 1.76, g * 1.76);
    } else if (symbol.id === "dreieck") {
      ctx.moveTo(x, y - g);
      ctx.lineTo(x + g * 0.95, y + g * 0.75);
      ctx.lineTo(x - g * 0.95, y + g * 0.75);
      ctx.closePath();
    } else if (symbol.id === "stern") {
      for (var i = 0; i < 10; i++) {
        var rr = i % 2 === 0 ? g * 1.12 : g * 0.45;
        var a = -Math.PI / 2 + i * Math.PI / 5;
        ctx[i === 0 ? "moveTo" : "lineTo"](x + rr * Math.cos(a), y + rr * Math.sin(a));
      }
      ctx.closePath();
    }
    ctx.fill();
  }

  function zeichneSling(s) {
    var blitz = blitzWert(s.blitzZeit);
    ctx.beginPath();
    ctx.moveTo(s.ecken[0].x, s.ecken[0].y);
    ctx.lineTo(s.ecken[1].x, s.ecken[1].y);
    ctx.lineTo(s.ecken[2].x, s.ecken[2].y);
    ctx.closePath();
    ctx.fillStyle = blitz > 0 ? "#ffd27f" : "#f3c44a";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#d9a92f";
    ctx.stroke();
  }

  function zeichneFlipper(f) {
    var a = f.seite < 0 ? f.winkel : Math.PI - f.winkel;
    ctx.save();
    ctx.translate(f.pivot.x, f.pivot.y);
    ctx.rotate(a);
    // Arm als Kapsel: links BLAU, rechts ROT (wie die Touch-Zonen)
    ctx.beginPath();
    abgerundetesRechteck(-4, -FLIPPER_DICKE / 2, FLIPPER_LAENGE + 4,
                         FLIPPER_DICKE, FLIPPER_DICKE / 2 - 1);
    ctx.fillStyle = f.seite < 0 ? "#2f6fd6" : "#d9453e";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = f.seite < 0 ? "#1e4b96" : "#a2352b";
    ctx.stroke();
    ctx.restore();
    // Drehpunkt-Kappe
    ctx.beginPath();
    ctx.arc(f.pivot.x, f.pivot.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#36456f";
    ctx.fill();
  }

  function zeichneKugel() {
    var p = kugel.position;
    var verlauf = ctx.createRadialGradient(p.x - 4, p.y - 4, 2, p.x, p.y, KUGEL_RADIUS);
    verlauf.addColorStop(0, "#ffffff");
    verlauf.addColorStop(1, "#9fb0d4");
    ctx.beginPath();
    ctx.arc(p.x, p.y, KUGEL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = verlauf;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#5f6e96";
    ctx.stroke();
  }

  // --- Game-Loop: Physik in festen Schritten, dann zeichnen -----------------
  var letzteZeit = 0;
  function schleife(zeit) {
    window.requestAnimationFrame(schleife);
    if (!state.laeuft) { return; }
    var dt = Math.min(zeit - letzteZeit, 50);   // Tab-Wechsel abfedern
    letzteZeit = zeit;

    // Zwei Halbschritte pro Frame: stabiler bei schneller Kugel
    animiereFlipper(flipperL);
    animiereFlipper(flipperR);
    Engine.update(engine, dt / 2);
    Engine.update(engine, dt / 2);
    begrenzeTempo();
    pruefeStillstand();
    pruefeKugelVerlust();
    zeichneFeld();
  }
  window.requestAnimationFrame(function (zeit) { letzteZeit = zeit; schleife(zeit); });


  /* 9. SPIEGEL-MINISPIEL -------------------------------------------------------
     Zwischen zwei Kugeln: links steht eine halbe Strichzeichnung, in der
     Mitte die Spiegelachse. Das Kind faehrt rechts mit dem Finger ueber die
     Punktreihe und "zaubert" so das Spiegelbild. Alle Punkte getroffen ->
     Konfetti und die naechste Kugel. Ein dezenter "Weiter"-Knopf erscheint
     nach einer Weile (kein Frust, keine Strafe). */

  // Halbe Zeichnungen als Linienzuege in Einheitskoordinaten (0..1),
  // Spiegelachse bei x = 0.5. >>> Eigene Motive: einfach Punkte ergaenzen. <<<
  var SPIEGEL_MOTIVE = [
    { name: "Herz", farbe: "#d9453e", punkte: [
      [0.50, 0.30], [0.44, 0.22], [0.35, 0.18], [0.27, 0.20], [0.21, 0.27],
      [0.20, 0.36], [0.24, 0.45], [0.32, 0.54], [0.41, 0.63], [0.50, 0.72]] },
    { name: "Haus", farbe: "#2f6fd6", punkte: [
      [0.50, 0.80], [0.26, 0.80], [0.26, 0.52], [0.50, 0.30]] },
    { name: "Stern", farbe: "#f3a93c", punkte: [
      [0.50, 0.20], [0.424, 0.415], [0.196, 0.421], [0.376, 0.560],
      [0.312, 0.779], [0.50, 0.65]] },
    { name: "Tannenbaum", farbe: "#149e72", punkte: [
      [0.50, 0.16], [0.34, 0.38], [0.42, 0.38], [0.28, 0.60],
      [0.38, 0.60], [0.24, 0.80], [0.50, 0.80]] }
  ];

  var spiegel = {
    offen: false, motiv: null, ziele: [],    // ziele: {x,y,getroffen}
    strich: [],                              // gemalte Fingerpunkte
    malt: false, skipTimer: null
  };
  var spiegelCtx = el.spiegelCanvas.getContext("2d");

  function oeffneSpiegelSpiel() {
    spiegel.offen = true;
    spiegel.motiv = zufallAus(SPIEGEL_MOTIVE);
    spiegel.strich = [];
    el.spiegelOverlay.classList.add("offen");
    el.spiegelOverlay.setAttribute("aria-hidden", "false");
    el.spiegelHinweis.textContent = "Fahre rechts mit dem Finger über die Punkte.";
    el.spiegelHinweis.classList.remove("erfolg");
    el.spiegelSkip.classList.remove("sichtbar");
    window.clearTimeout(spiegel.skipTimer);
    spiegel.skipTimer = window.setTimeout(function () {
      el.spiegelSkip.classList.add("sichtbar");
    }, 18000);

    // Canvas-Aufloesung setzen und Zielpunkte aus dem gespiegelten
    // Linienzug abtasten (alle ~7% der Kantenlaenge ein Punkt).
    var dpr = window.devicePixelRatio || 1;
    var box = el.spiegelCanvas.getBoundingClientRect();
    el.spiegelCanvas.width = Math.round(box.width * dpr);
    el.spiegelCanvas.height = Math.round(box.height * dpr);

    var K = el.spiegelCanvas.width;          // quadratisch (CSS aspect-ratio)
    spiegel.ziele = [];
    var abstand = K * 0.07;
    var pts = spiegel.motiv.punkte.map(function (p) {
      return { x: (1 - p[0]) * K, y: p[1] * K };   // x spiegeln: rechts
    });
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var laenge = Math.hypot(b.x - a.x, b.y - a.y);
      var n = Math.max(1, Math.round(laenge / abstand));
      for (var j = 0; j < n; j++) {
        spiegel.ziele.push({ x: a.x + (b.x - a.x) * j / n,
                             y: a.y + (b.y - a.y) * j / n, getroffen: false });
      }
    }
    spiegel.ziele.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, getroffen: false });

    sprich("Zaubere die andere Hälfte! Fahre mit dem Finger über die Punkte.");
    zeichneSpiegel();
  }

  function zeichneSpiegel() {
    var K = el.spiegelCanvas.width, ctx2 = spiegelCtx;
    ctx2.setTransform(1, 0, 0, 1, 0, 0);
    ctx2.clearRect(0, 0, K, el.spiegelCanvas.height);
    var dick = Math.max(4, K * 0.016);

    // Spiegelachse (gestrichelt, mittig)
    ctx2.strokeStyle = "#9fb0d4";
    ctx2.lineWidth = dick * 0.6;
    ctx2.setLineDash([K * 0.02, K * 0.02]);
    ctx2.beginPath();
    ctx2.moveTo(K / 2, K * 0.06);
    ctx2.lineTo(K / 2, K * 0.94);
    ctx2.stroke();
    ctx2.setLineDash([]);

    // Linke Haelfte: das fertige halbe Motiv
    ctx2.strokeStyle = spiegel.motiv.farbe;
    ctx2.lineWidth = dick;
    ctx2.lineCap = "round";
    ctx2.lineJoin = "round";
    ctx2.beginPath();
    spiegel.motiv.punkte.forEach(function (p, i) {
      ctx2[i === 0 ? "moveTo" : "lineTo"](p[0] * K, p[1] * K);
    });
    ctx2.stroke();

    // Rechte Haelfte: Zielpunkte (offen = hell, getroffen = bunt)
    spiegel.ziele.forEach(function (z) {
      ctx2.beginPath();
      ctx2.arc(z.x, z.y, dick * 1.1, 0, Math.PI * 2);
      ctx2.fillStyle = z.getroffen ? spiegel.motiv.farbe : "#d5deef";
      ctx2.fill();
    });

    // Fingerspur des Kindes (weiche gruene Linie)
    if (spiegel.strich.length > 1) {
      ctx2.strokeStyle = "rgba(40, 192, 138, 0.55)";
      ctx2.lineWidth = dick * 1.4;
      ctx2.beginPath();
      spiegel.strich.forEach(function (p, i) {
        ctx2[i === 0 ? "moveTo" : "lineTo"](p.x, p.y);
      });
      ctx2.stroke();
    }
  }

  // Finger-Eingabe: nur die rechte Haelfte zaehlt (links ist die Vorlage)
  function spiegelPunktVonEvent(ereignis) {
    var box = el.spiegelCanvas.getBoundingClientRect();
    var dpr = el.spiegelCanvas.width / box.width;
    return { x: (ereignis.clientX - box.left) * dpr,
             y: (ereignis.clientY - box.top) * dpr };
  }

  function spiegelMale(ereignis) {
    if (!spiegel.offen || !spiegel.malt) { return; }
    ereignis.preventDefault();
    var p = spiegelPunktVonEvent(ereignis);
    var K = el.spiegelCanvas.width;
    if (p.x < K / 2) { return; }             // linke Haelfte ist tabu
    spiegel.strich.push(p);
    var radius = K * 0.055, neue = 0;        // grosszuegige Toleranz
    spiegel.ziele.forEach(function (z) {
      if (!z.getroffen && Math.hypot(z.x - p.x, z.y - p.y) < radius) {
        z.getroffen = true;
        neue++;
      }
    });
    if (neue > 0) { spielKlang("spiegelpunkt"); }
    zeichneSpiegel();
    pruefeSpiegelFertig();
  }

  function pruefeSpiegelFertig() {
    var offenZaehler = spiegel.ziele.filter(function (z) { return !z.getroffen; }).length;
    if (offenZaehler > 0) { return; }
    spiegel.offen = false;                   // fertig - Eingabe stoppen
    el.spiegelHinweis.textContent = "✨ Wunderbar gespiegelt!";
    el.spiegelHinweis.classList.add("erfolg");
    werfeKonfetti();
    spielKlang("erfolg");
    sprich("Wunderbar gespiegelt! Hier kommt die nächste Kugel!");
    window.setTimeout(schliesseSpiegelSpiel, 1500);
  }

  function schliesseSpiegelSpiel() {
    spiegel.offen = false;
    window.clearTimeout(spiegel.skipTimer);
    el.spiegelOverlay.classList.remove("offen");
    el.spiegelOverlay.setAttribute("aria-hidden", "true");
    neueKugel();
  }

  el.spiegelCanvas.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    if (!spiegel.offen) { return; }
    spiegel.malt = true;
    el.spiegelCanvas.setPointerCapture(e.pointerId);
    spiegelMale(e);
  });
  el.spiegelCanvas.addEventListener("pointermove", spiegelMale);
  el.spiegelCanvas.addEventListener("pointerup", function () {
    spiegel.malt = false;
    spiegel.strich = [];                     // Spur verblasst beim Absetzen
    if (spiegel.offen) { zeichneSpiegel(); }
  });
  el.spiegelSkip.addEventListener("click", schliesseSpiegelSpiel);


  /* 10. SOUND + SPRACHAUSGABE ---------------------------------------------- */

  var audioContext = null;
  function weckeAudio() {
    if (audioContext === null && (window.AudioContext || window.webkitAudioContext)) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext && audioContext.state === "suspended") { audioContext.resume(); }
    return audioContext;
  }

  // Alle Effekte als kleine WebAudio-Toene (Platzhalter fuer echte Sounds).
  // >>> Eigene Sounds: hier stattdessen new Audio("sounds/xyz.mp3").play() <<<
  function spielKlang(typ) {
    if (!state.toene) { return; }
    var ctxA = weckeAudio();
    if (!ctxA) { return; }
    var rezepte = {
      flipper:      { toene: [180],                 art: "square",   laut: 0.10, dauer: 0.08 },
      bumper:       { toene: [660 + Math.random() * 220], art: "triangle", laut: 0.22, dauer: 0.18 },
      sling:        { toene: [420],                 art: "triangle", laut: 0.16, dauer: 0.12 },
      tor:          { toene: [523.25, 783.99],      art: "triangle", laut: 0.2,  dauer: 0.16 },
      mission:      { toene: [523.25, 659.25, 880], art: "triangle", laut: 0.2,  dauer: 0.18 },
      erfolg:       { toene: [523.25, 659.25, 783.99, 1046.5], art: "triangle", laut: 0.24, dauer: 0.2 },
      start:        { toene: [392, 523.25],         art: "sine",     laut: 0.16, dauer: 0.14 },
      verloren:     { toene: [330, 262],            art: "sine",     laut: 0.14, dauer: 0.22 },
      spiegelpunkt: { toene: [740 + Math.random() * 160], art: "sine", laut: 0.1, dauer: 0.07 }
    };
    var r = rezepte[typ] || rezepte.bumper;
    r.toene.forEach(function (frequenz, i) {
      var osz = ctxA.createOscillator(), gain = ctxA.createGain();
      osz.type = r.art;
      osz.frequency.value = frequenz;
      var startZeit = ctxA.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0.0001, startZeit);
      gain.gain.exponentialRampToValueAtTime(r.laut, startZeit + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startZeit + r.dauer);
      osz.connect(gain); gain.connect(ctxA.destination);
      osz.start(startZeit); osz.stop(startZeit + r.dauer);
    });
  }

  function sprich(text) {
    if (!state.sprache || !("speechSynthesis" in window)) { return; }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }


  /* 11. UI: TITELSCREEN, MENUE, POPOVER, KONFETTI, SPEICHER ----------------- */

  // --- Titelscreen: erster Tipp startet Spiel + Audio-Freigabe
  el.titelscreen.addEventListener("click", function () {
    if (state.laeuft) { return; }
    el.titelscreen.classList.add("aus");
    window.setTimeout(function () { el.titelscreen.hidden = true; }, 500);
    weckeAudio();
    state.laeuft = true;
    passeCanvasAn();
    verteileSymbole();
    neueKugel();
    planeMission(5000);
    sprich("Willkommen in der Pilz-Arena! Halte die Kugel mit den bunten Knöpfen im Spiel!");
  });

  // --- Konfetti (rein DOM/CSS, respektiert Reduced Motion)
  function werfeKonfetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) { return; }
    for (var i = 0; i < 16; i++) {
      var k = document.createElement("span");
      k.className = "konfetti";
      k.style.left = zufallGanzzahl(4, 96) + "%";
      k.style.background = zufallAus(KONFETTI_FARBEN);
      k.style.animationDelay = (Math.random() * 0.3).toFixed(2) + "s";
      k.style.transform = "rotate(" + zufallGanzzahl(0, 180) + "deg)";
      el.konfetti.appendChild(k);
    }
    window.setTimeout(function () { leere(el.konfetti); }, 2200);
  }

  // --- Popover (About + Erklaerungen der Status-Chips)
  var popoverTimer = null;
  function zeigePopover(html, ankerKnopf) {
    window.clearTimeout(popoverTimer);
    el.popover.innerHTML = html;
    el.popover.hidden = false;
    var box = ankerKnopf.getBoundingClientRect();
    el.popover.style.top = (box.bottom + 8) + "px";
    el.popover.style.left = Math.min(box.left, window.innerWidth - 276) + "px";
    popoverTimer = window.setTimeout(function () { el.popover.hidden = true; }, 3800);
  }
  el.buttonAbout.addEventListener("click", function () {
    zeigePopover(
      '<span class="about-titel">🐸 Fietes Formenflipper</span>' +
      '<span class="about-unter">Die Pilz-Arena</span>' +
      '<span class="about-studio">ein Spiel von JONFIE STUDIOS</span>', el.buttonAbout);
  });
  el.statPunkte.addEventListener("click", function () {
    zeigePopover("🔵 Deine <b>Punkte</b>: Jeder Pilz und jedes Tor gibt Punkte!", el.statPunkte);
  });
  el.statSterne.addEventListener("click", function () {
    zeigePopover("⭐ Deine <b>Sterne</b>: Für jede geschaffte Mission gibt es einen Stern!", el.statSterne);
  });

  // --- Einstellungen: Karten togglen + speichern
  function markiereEinstellungen() {
    document.querySelectorAll(".opt-karte").forEach(function (karte) {
      var s = karte.dataset.setting, w = karte.dataset.wert;
      var aktiv =
        (s === "symbole" && state.symbole === w) ||
        (s === "spiegel" && state.spiegel === (w === "an")) ||
        (s === "toene"   && state.toene   === (w === "an")) ||
        (s === "sprache" && state.sprache === (w === "an"));
      karte.classList.toggle("aktiv", aktiv);
    });
  }
  document.querySelectorAll(".opt-karte").forEach(function (karte) {
    karte.addEventListener("click", function () {
      var s = karte.dataset.setting, w = karte.dataset.wert;
      if (s === "symbole") {
        state.symbole = w;
        verteileSymbole();                   // sofort neue Symbole zeigen
        state.mission = null;                // alte Mission passt nicht mehr
        el.missionText.textContent = "Los geht’s!";
        planeMission(4000);
      }
      if (s === "spiegel") { state.spiegel = (w === "an"); }
      if (s === "toene")   { state.toene   = (w === "an"); }
      if (s === "sprache") { state.sprache = (w === "an"); }
      markiereEinstellungen();
      speichereStand();
    });
  });

  function oeffneModal(overlay) { overlay.classList.add("offen"); overlay.setAttribute("aria-hidden", "false"); }
  function schliesseModal(overlay) { overlay.classList.remove("offen"); overlay.setAttribute("aria-hidden", "true"); }

  el.buttonEinstellungen.addEventListener("click", function () {
    markiereEinstellungen();
    oeffneModal(el.einstellungen);
  });
  el.einstellungenZu.addEventListener("click", function () { schliesseModal(el.einstellungen); });
  el.einstellungenFertig.addEventListener("click", function () { schliesseModal(el.einstellungen); });

  // --- Zuruecksetzen mit Eltern-Sicherung (kleine Rechenaufgabe)
  el.buttonReset.addEventListener("click", function () {
    var a = zufallGanzzahl(2, 9), b = zufallGanzzahl(2, 9);
    el.elternFrage.textContent = a + " + " + b;
    leere(el.elternAntworten);
    var richtig = a + b;
    var antworten = [richtig, richtig + zufallGanzzahl(1, 3), richtig - zufallGanzzahl(1, 3)];
    antworten.sort(function () { return Math.random() - 0.5; });
    antworten.forEach(function (wert) {
      var knopf = document.createElement("button");
      knopf.type = "button";
      knopf.className = "eltern-antwort";
      knopf.textContent = wert;
      knopf.addEventListener("click", function () {
        if (wert === richtig) {
          state.punkte = 0; state.sterne = 0;
          el.anzeigePunkte.textContent = 0;
          el.anzeigeSterne.textContent = 0;
          speichereStand();
          schliesseModal(el.elternDialog);
          schliesseModal(el.einstellungen);
        } else {
          el.elternDialog.querySelector(".eltern-modal").classList.add("wackelt");
          window.setTimeout(function () {
            el.elternDialog.querySelector(".eltern-modal").classList.remove("wackelt");
          }, 550);
        }
      });
      el.elternAntworten.appendChild(knopf);
    });
    oeffneModal(el.elternDialog);
  });
  el.elternAbbrechen.addEventListener("click", function () { schliesseModal(el.elternDialog); });

  // --- Speichern/Laden (Punkte, Sterne, Einstellungen)
  function speichereStand() {
    try {
      window.localStorage.setItem(SPEICHER_SCHLUESSEL, JSON.stringify({
        punkte: state.punkte, sterne: state.sterne, symbole: state.symbole,
        spiegel: state.spiegel, toene: state.toene, sprache: state.sprache
      }));
    } catch (fehler) { /* privater Modus o.ae. - dann eben ohne Speichern */ }
  }
  function ladeStand() {
    try {
      var roh = window.localStorage.getItem(SPEICHER_SCHLUESSEL);
      if (!roh) { return; }
      var d = JSON.parse(roh);
      if (typeof d.punkte === "number") { state.punkte = d.punkte; }
      if (typeof d.sterne === "number") { state.sterne = d.sterne; }
      if (typeof d.symbole === "string") { state.symbole = d.symbole; }
      if (typeof d.spiegel === "boolean") { state.spiegel = d.spiegel; }
      if (typeof d.toene === "boolean") { state.toene = d.toene; }
      if (typeof d.sprache === "boolean") { state.sprache = d.sprache; }
    } catch (fehler) { /* kaputte Daten ignorieren */ }
    el.anzeigePunkte.textContent = state.punkte;
    el.anzeigeSterne.textContent = state.sterne;
  }

  // --- Service Worker: macht das Spiel offline-faehig (PWA)
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () { /* egal */ });
    });
  }

  // --- Los geht's
  ladeStand();
  passeCanvasAn();
  verteileSymbole();
  zeichneFeld();                             // Standbild hinter dem Titel
})();
