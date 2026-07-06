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

  var KUGEL_RADIUS = 11;
  var BAELLE_PRO_RUNDE = 5;      // Kugel-Vorrat pro Runde (Anzeige oben)

  // Abschuss-Gasse rechts: Trennwand bei x=352, Gassen-Innenraum 356..384
  var GASSE_X = 352;

  // Flipper-Geometrie: Drehpunkte + Laenge + Winkel (Ruhe/oben, Bogenmass).
  // Die Drehpunkte sitzen IM Rahmen (am Ende der Einlauf-Schraege), damit
  // dort keine Tasche entsteht, in der die Kugel liegen bleiben kann.
  var FLIPPER_LAENGE = 72;
  var FLIPPER_DICKE  = 17;
  var FLIPPER_RUHE   = 0.46;     // ~26 Grad nach unten
  var FLIPPER_OBEN   = -0.52;    // ~30 Grad nach oben
  var FLIPPER_TEMPO_HOCH   = 0.30;  // rad pro Physik-Schritt beim Hochschnellen
  var FLIPPER_TEMPO_RUNTER = 0.12;  // ... und beim Zuruecksinken
  var PIVOT_L = { x: 116, y: 516 };
  var PIVOT_R = { x: 284, y: 516 };

  // Drei Schwierigkeitsstufen (im Menue waehlbar): sie steuern NUR das
  // Kugeltempo (Schwerkraft, Tempodeckel, Staerke aller Kicks) – die
  // Lerninhalte bleiben gleich. Standard ist "leicht" (gemuetliche Kugel).
  //
  // TEMPO BEWUSST NIEDRIG + SANFTE STAFFELUNG: Selbst "leicht" bleibt richtig
  // gemuetlich, und die Stufen wachsen nur in kleinen Schritten (kein harter
  // Sprung). "abschussMin/Max" ist die Bandbreite des Plungers (siehe unten):
  // kurz druecken -> schwach, lange halten -> kraeftig.
  var SCHWIERIGKEITEN = {
    leicht:  { gravitation: 0.42, maxTempo: 7.5,  bumperKick: 5.4,
               sling: { x: 3.2, y: -5.0 }, abschussMin: 8.5,  abschussMax: 15.0, flipperKraft: 0.58 },
    mittel:  { gravitation: 0.54, maxTempo: 8.8,  bumperKick: 6.3,
               sling: { x: 3.7, y: -5.8 }, abschussMin: 9.0,  abschussMax: 16.5, flipperKraft: 0.66 },
    schnell: { gravitation: 0.68, maxTempo: 10.2, bumperKick: 7.4,
               sling: { x: 4.3, y: -6.7 }, abschussMin: 9.5,  abschussMax: 18.0, flipperKraft: 0.76 }
  };

  // Punktwerte – bewusst simpel und grosszuegig
  var PUNKTE_BUMPER  = 10;
  var PUNKTE_SLING   = 5;
  var PUNKTE_TOR     = 25;
  var PUNKTE_MISSION = 100;
  var PUNKTE_LOCH    = 50;   // Fang-Loch mit 3D-Koerper

  // 3D-Koerper fuer das Fang-Loch: dort dreht sich ein Koerper; faengt das
  // Loch die Kugel, wird sein Name vorgelesen (Lerneffekt) und der naechste
  // Koerper kommt an die Reihe.
  var KOERPER_3D = [
    { id: "wuerfel",  name: "Würfel",   artikel: "der", farbe: "#2f6fd6" },
    { id: "kugel",    name: "Kugel",    artikel: "die", farbe: "#ff9e2c" },
    { id: "quader",   name: "Quader",   artikel: "der", farbe: "#28c08a" },
    { id: "zylinder", name: "Zylinder", artikel: "der", farbe: "#9a7bd0" },
    { id: "kegel",    name: "Kegel",    artikel: "der", farbe: "#d9453e" },
    { id: "pyramide", name: "Pyramide", artikel: "die", farbe: "#f3c44a" }
  ];

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
    baelle: BAELLE_PRO_RUNDE,// uebrige Kugeln in dieser Runde (Anzeige oben)
    rundenStartPunkte: 0,    // Punktestand beim Rundenbeginn (fuer die Bilanz)
    symbole: "mix",          // Einstellung: buchstaben | formen | mix
    schwierigkeit: "leicht", // Einstellung: leicht | mittel | schnell
    zwischenspiele: true,    // Zwischenspiele zwischen den Kugeln?
    // Rechenaufgabe-Einstellungen (Menue): Zahlenraum + aktive Operationen.
    // Mal/Geteilt bleiben immer im kleinen Einmaleins (Faktoren 1..10).
    rechnen: { zahlenraum: 20, plus: true, minus: true, mal: false, geteilt: false },
    naechstesZwischen: "zeichnen", // wechselt: zeichnen <-> rechnen
    toene: true,
    sprache: true,
    mission: null,           // { elementIndex, symbol } oder null
    kugelUnterwegs: false,
    wartetAufAbschuss: false // Kugel liegt in der Gasse, Knopf sichtbar
  };

  // Werte der aktuell gewaehlten Schwierigkeit (Kurzform)
  function K() { return SCHWIERIGKEITEN[state.schwierigkeit]; }

  var el = {};               // DOM-Verweise, werden in init() gefuellt
  [
    "titelscreen", "mission-schild", "mission-text", "spielfeld",
    "symbol-blitz", "lob-banner", "zone-links", "zone-rechts",
    "anzeige-punkte", "anzeige-sterne", "anzeige-baelle",
    "stat-punkte", "stat-sterne", "stat-baelle",
    "button-abschuss", "runde-overlay", "runde-punkte", "button-neue-runde",
    "button-about", "button-einstellungen", "einstellungen",
    "einstellungen-zu", "einstellungen-fertig", "button-reset",
    "eltern-dialog", "eltern-frage", "eltern-antworten", "eltern-abbrechen",
    "popover", "konfetti", "spiegel-overlay", "spiegel-canvas",
    "spiegel-titel", "spiegel-hinweis",
    "rechen-overlay", "rechen-frage", "rechen-antworten", "rechen-hinweis"
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
  engine.positionIterations = 8;             // stabilere Kollisionen
  engine.velocityIterations = 6;

  // Schwerkraft je nach gewaehlter Schwierigkeit setzen
  function wendeSchwierigkeitAn() { engine.gravity.y = K().gravitation; }

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

  // --- Feste Waende: Seiten, oben eine runde Kuppel, unten Einlauf-
  //     Schraegen. Rechts liegt die ABSCHUSS-GASSE (wie beim echten
  //     Flipper): Trennwand + Gassen-Boden; die Kugel wartet dort auf den
  //     Abschuss-Knopf. Die Einlauf-Schraegen enden DIREKT an den Flipper-
  //     Drehpunkten, damit keine Kugel-Falle entsteht.
  var waende = [
    wandSegment(4, 120, 4, 445, 24),                    // linke Wand
    wandSegment(396, 120, 396, 516, 24),                // rechte Wand (bis Gassen-Boden)
    wandSegment(4, 445, PIVOT_L.x, PIVOT_L.y, 16),      // Einlauf links
    wandSegment(GASSE_X, 448, PIVOT_R.x, PIVOT_R.y, 16),// Einlauf rechts
    wandSegment(GASSE_X, 190, GASSE_X, 508, 8),         // Gassen-Trennwand
    // Umlenk-Dach am Gassen-Ausgang: schiebt Kugeln nach LINKS ins Feld (die
    // linke Seite liegt TIEFER, die Kugel rollt also von der Gasse WEG). So
    // faellt eine zurueckkommende Kugel fast nie mehr in den Einlasskanal.
    wandSegment(GASSE_X, 172, 300, 200, 9),
    wandSegment(348, 508, 398, 514, 14),                // Gassen-Boden (leicht schraeg -> Kugel rollt an die Wand)
    wandSegment(104, 530, 104, 600, 12),                // Abfluss-Kanal links
    wandSegment(296, 530, 296, 600, 12),                // Abfluss-Kanal rechts
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

  // --- Fang-Loch: sitzt oben in der Mitte. Die Bumper flankieren es, sodass
  //     ein freier Schussweg nach oben in dieses Loch entsteht (wie beim
  //     echten Flipper). Faellt die Kugel hinein, verschwindet sie fuer 2 s
  //     und wird dann wieder ausgeworfen. Auf dem Loch dreht sich ein 3D-
  //     Koerper, dessen Name beim Fangen vorgelesen wird (Lerneffekt).
  var LOCH_R = 30;
  var loch = {
    x: 200, y: 150, r: LOCH_R,
    aktuell: 0,          // Index in KOERPER_3D
    drehung: 0,          // laeuft in jedem Frame weiter -> Koerper rotiert
    gefangen: false,     // Kugel gerade eingefangen?
    gefangenSeit: 0,
    blitzZeit: 0
  };
  // Sensor-Kreis: die Kugel "faellt hinein" (kein Abprall), wir fangen sie
  // in der Kollisionslogik selbst ab.
  var lochBody = Bodies.circle(loch.x, loch.y, loch.r * 0.72, {
    isStatic: true, isSensor: true, label: "loch"
  });

  // --- Pilz-Bumper: zwei grosse Kreise, die den Mittelweg zum Loch frei
  //     lassen. "elemente" sammelt alles, was ein Symbol traegt (Bumper +
  //     Tore) fuer Missionen & Rendering. Bumper sind bewusst groesser, damit
  //     Buchstaben/Formen bequem auf dem Schild sitzen (nicht auf dem Rand).
  var elemente = [];         // { art, body, x, y, r/w, symbol, blitzZeit }

  [{ x: 88, y: 256 }, { x: 312, y: 256 }]
    .forEach(function (p, i) {
      var body = Bodies.circle(p.x, p.y, 33, { isStatic: true, label: "bumper-" + i });
      elemente.push({ art: "bumper", body: body, x: p.x, y: p.y, r: 33, symbol: null, blitzZeit: 0 });
    });

  // --- Tore: drei "Tuerchen" (abgerundete Kloetze) an Kuppel und Seiten.
  //     Das obere ist MINIMAL geneigt, damit die Kugel nicht darauf
  //     liegen bleiben kann, sondern immer herunterrollt.
  //     Die seitlichen Tore liegen BUENDIG an ihrer Wand (leicht ueberlappend):
  //     bleibt ein schmaler Spalt, kann sich die Kugel dort einklemmen.
  [{ x: 200, y: 88, winkel: 0.08 },
   { x: 44,  y: 336, winkel:  0.42 },
   { x: 320, y: 336, winkel: -0.42 }]
    .forEach(function (p, i) {
      var body = Bodies.rectangle(p.x, p.y, 62, 30, {
        isStatic: true, angle: p.winkel, label: "tor-" + i, chamfer: { radius: 10 }
      });
      elemente.push({ art: "tor", body: body, x: p.x, y: p.y, w: 62, h: 30,
                      winkel: p.winkel, symbol: null, blitzZeit: 0 });
    });

  // --- Slingshots: zwei Dreiecke ueber den Einlauf-Schraegen, die die Kugel
  //     zurueck ins Feld schubsen (klassisches Flipper-Element).
  //     WICHTIG: genug Abstand zur Einlauf-Schraege lassen (> Kugel-
  //     durchmesser), sonst verkeilt sich die Kugel in der Ecke.
  var slings = [];
  [
    [{ x: 98, y: 396 }, { x: 138, y: 460 }, { x: 98, y: 460 }],
    [{ x: 298, y: 392 }, { x: 258, y: 452 }, { x: 298, y: 452 }]
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
    .concat([lochBody, flipperL.body, flipperR.body]));


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

  var klammerPauseBis = 0;   // kurz nach dem Abschuss gilt der Deckel nicht

  function begrenzeTempo() {
    if (!kugel || performance.now() < klammerPauseBis) { return; }
    var deckel = K().maxTempo;
    var v = kugel.velocity, tempo = Math.hypot(v.x, v.y);
    if (tempo > deckel) {
      Body.setVelocity(kugel, { x: v.x / tempo * deckel,
                                y: v.y / tempo * deckel });
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
      else if (anderer.label === "loch") { aufLoch(); }
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
    var omega = f.omega * (f.seite < 0 ? 1 : -1) * 60 * K().flipperKraft;
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
    var kick = K().bumperKick;
    Body.setVelocity(kugel, { x: dx / d * kick, y: dy / d * kick });
    gibPunkte(PUNKTE_BUMPER);
    spielKlang("bumper");
    spawnFunken(e.x, e.y, "#f3c44a");
    zeigeSymbol(e.symbol);
    pruefeMission(e);
  }

  function aufTor(body) {
    if (!darfTreffen(body.label)) { return; }
    var e = elementZuLabel(body.label);
    e.blitzZeit = performance.now();
    gibPunkte(PUNKTE_TOR);
    spielKlang("tor");
    spawnFunken(e.x, e.y, "#2f6fd6");
    zeigeSymbol(e.symbol);
    pruefeMission(e);
  }

  function aufSling(body) {
    if (!darfTreffen(body.label)) { return; }
    var s = body.label === "sling-0" ? slings[0] : slings[1];
    s.blitzZeit = performance.now();
    // zur Feldmitte hoch schubsen
    var richtung = body.label === "sling-0" ? 1 : -1;
    Body.setVelocity(kugel, { x: richtung * K().sling.x, y: K().sling.y });
    gibPunkte(PUNKTE_SLING);
    spielKlang("sling");
  }

  // --- Fang-Loch: Kugel verschwindet 2 Sekunden, dann Auswurf. Der gerade
  //     rotierende 3D-Koerper wird vorgelesen (z. B. "Würfel!") und danach
  //     kommt der naechste Koerper an die Reihe.
  function aufLoch() {
    if (loch.gefangen || !kugel) { return; }
    loch.gefangen = true;
    loch.gefangenSeit = performance.now();
    loch.blitzZeit = performance.now();
    World.remove(engine.world, kugel);
    kugel = null;                            // andere Pruefungen ruhen solange

    var k = KOERPER_3D[loch.aktuell];
    gibPunkte(PUNKTE_LOCH);
    spielKlang("tor");
    spawnFunken(loch.x, loch.y, k.farbe);
    zeigeKoerper3dName(k);                    // gross einblenden + vorlesen
    window.setTimeout(freigabeLoch, 2000);
  }

  function freigabeLoch() {
    loch.gefangen = false;
    loch.aktuell = (loch.aktuell + 1) % KOERPER_3D.length;  // naechster Koerper
    if (!state.laeuft) { return; }
    // Neue Kugel direkt unter dem Loch auswerfen (sanft nach unten ins Feld)
    kugel = Bodies.circle(loch.x, loch.y + loch.r + KUGEL_RADIUS + 2, KUGEL_RADIUS, {
      label: "kugel", restitution: 0.45, friction: 0.002,
      frictionAir: 0.006, density: 0.0022
    });
    World.add(engine.world, kugel);
    kugelSpur = [];
    Body.setVelocity(kugel, { x: (Math.random() - 0.5) * 3, y: 3.5 });
    spielKlang("abschuss");
  }

  // 3D-Koerper-Namen gross einblenden (nutzt das Symbol-Blitz-Overlay)
  function zeigeKoerper3dName(k) {
    var blitz = el.symbolBlitz;
    blitz.classList.remove("zeigt");
    void blitz.offsetWidth;
    blitz.textContent = k.name;
    blitz.style.color = k.farbe;
    blitz.classList.add("zeigt");
    sprich(k.artikel + " " + k.name);
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


  /* 7. KUGEL-VERWALTUNG ------------------------------------------------------
     Wie beim echten Flipper: die neue Kugel liegt in der Abschuss-Gasse
     rechts und wartet auf den grossen 🚀-Knopf. Faellt eine Kugel spaeter
     in die Gasse zurueck, erscheint der Knopf einfach wieder. */

  var abschussHinweise = 0;      // Sprach-Tipp nur die ersten Male

  function neueKugel() {
    if (kugel) { World.remove(engine.world, kugel); }
    kugel = Bodies.circle(373, 486, KUGEL_RADIUS, {
      label: "kugel",
      restitution: 0.45,
      friction: 0.002,
      frictionAir: 0.006,
      density: 0.0022
    });
    World.add(engine.world, kugel);
    kugelSpur = [];
    state.kugelUnterwegs = true;
    macheAbschussBereit();
  }

  function macheAbschussBereit() {
    state.wartetAufAbschuss = true;
    el.buttonAbschuss.hidden = false;
    if (abschussHinweise < 2) {
      abschussHinweise++;
      sprich("Halt den roten Knopf gedrückt – je länger, desto weiter fliegt die Kugel!");
    }
  }

  // --- Variabler Abschuss (wie ein echter Plunger): den Knopf gedrueckt
  //     HALTEN laedt die Kraft von schwach bis zum Maximum. Loslassen
  //     schiesst mit der geladenen Kraft. Kurz getippt -> die Kugel kommt
  //     kaum raus; lange gehalten -> voller Schuss.
  var LADE_ZEIT = 900;                 // ms bis zur vollen Kraft
  var ladung = { aktiv: false, start: 0, wert: 0 };

  // 0..1: aktueller Ladestand (fuers Zeichnen der Kraftanzeige)
  function ladeStand() {
    if (ladung.aktiv) {
      return Math.min(1, (performance.now() - ladung.start) / LADE_ZEIT);
    }
    return ladung.wert;
  }

  function starteLaden(e) {
    if (e) {
      e.preventDefault();
      // Zeiger festhalten: so kommt das "Loslassen" sicher an und ein
      // versehentliches Abrutschen loest nicht zu frueh aus.
      try { el.buttonAbschuss.setPointerCapture(e.pointerId); } catch (f) {}
    }
    if (!kugel || !state.wartetAufAbschuss || ladung.aktiv) { return; }
    weckeAudio();
    ladung.aktiv = true;
    ladung.start = performance.now();
    ladung.wert = 0;
    spielKlang("laden");
  }

  function schiesseKugelAb() {
    if (!kugel || !state.wartetAufAbschuss || !ladung.aktiv) { return; }
    var t = Math.min(1, (performance.now() - ladung.start) / LADE_ZEIT);
    ladung.aktiv = false;
    ladung.wert = 0;
    state.wartetAufAbschuss = false;
    el.buttonAbschuss.hidden = true;
    // Der Tempodeckel pausiert kurz, damit der Abschuss volle Kraft hat
    klammerPauseBis = performance.now() + 900;
    var kraft = K().abschussMin + t * (K().abschussMax - K().abschussMin);
    Body.setVelocity(kugel, { x: -0.4, y: -kraft });
    spielKlang("abschuss");
  }
  el.buttonAbschuss.addEventListener("pointerdown", starteLaden);
  el.buttonAbschuss.addEventListener("pointerup", schiesseKugelAb);
  el.buttonAbschuss.addEventListener("pointercancel", schiesseKugelAb);
  el.buttonAbschuss.addEventListener("pointerleave", schiesseKugelAb);

  // Liegt die Kugel (wieder) ruhig in der Gasse? -> Abschuss-Knopf zeigen
  function pruefeGasse() {
    if (!kugel || !state.kugelUnterwegs || state.wartetAufAbschuss) { return; }
    var tempo = Math.hypot(kugel.velocity.x, kugel.velocity.y);
    if (kugel.position.x > GASSE_X && kugel.position.y > 455 && tempo < 0.9) {
      macheAbschussBereit();
    }
  }

  // Anti-Klemm-Sicherung: steht die Kugel laenger als ~3 Sekunden fast
  // still (in einer Ecke verkeilt o.ae.), bekommt sie einen sanften Schubs
  // Richtung Feldmitte. So kann NIE dauerhaft Stillstand entstehen.
  var stillstandSeit = 0;
  function pruefeStillstand() {
    if (!kugel || !state.kugelUnterwegs || state.wartetAufAbschuss) {
      stillstandSeit = 0; return;
    }
    var tempo = Math.hypot(kugel.velocity.x, kugel.velocity.y);
    // Nur solange ein Flipper GEHALTEN wird, darf die Kugel dort ruhen
    // (das Kind zielt gerade) - sonst wird jeder Stillstand aufgeloest.
    var haeltFlipper = flipperL.gedrueckt || flipperR.gedrueckt;
    if (tempo > 0.6 || haeltFlipper) { stillstandSeit = 0; return; }
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
      state.baelle = Math.max(0, state.baelle - 1);
      el.anzeigeBaelle.textContent = state.baelle;
      if (state.baelle === 0) {
        zeigeRundenEnde();                   // Runde vorbei -> Feier + Bilanz
      } else if (state.zwischenspiele) {
        oeffneZwischenspiel();               // Zeichnen ODER Rechnen -> neue Kugel
      } else {
        window.setTimeout(neueKugel, 900);
      }
    }
  }

  // --- Rundenende: KEIN "Game Over", sondern eine Feier mit Punkte-Bilanz.
  //     Ein Tipp auf den grossen Knopf startet die naechste Runde (der
  //     Punktestand laeuft einfach weiter).
  function zeigeRundenEnde() {
    var rundenPunkte = state.punkte - state.rundenStartPunkte;
    el.rundePunkte.textContent = rundenPunkte;
    el.rundeOverlay.hidden = false;
    werfeKonfetti();
    spielKlang("erfolg");
    sprich("Runde geschafft! Du hast " + rundenPunkte + " Punkte gesammelt!");
  }
  el.buttonNeueRunde.addEventListener("click", function () {
    el.rundeOverlay.hidden = true;
    state.baelle = BAELLE_PRO_RUNDE;
    state.rundenStartPunkte = state.punkte;
    el.anzeigeBaelle.textContent = state.baelle;
    verteileSymbole();
    neueKugel();
  });


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

  // Funken-Partikel (kleine Feier bei jedem Treffer)
  var funken = [];
  function spawnFunken(x, y, farbe) {
    for (var i = 0; i < 10; i++) {
      funken.push({ x: x, y: y,
                    vx: (Math.random() - 0.5) * 7,
                    vy: -Math.random() * 5 - 1,
                    leben: 1, farbe: farbe });
    }
  }
  function malUndBewegeFunken() {
    for (var i = funken.length - 1; i >= 0; i--) {
      var p = funken[i];
      p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.leben -= 0.045;
      if (p.leben <= 0) { funken.splice(i, 1); continue; }
      ctx.globalAlpha = p.leben;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.2 * p.leben + 0.8, 0, Math.PI * 2);
      ctx.fillStyle = p.farbe;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Kugel-Schweif: die letzten Positionen verblassen hinter der Kugel
  var kugelSpur = [];

  function zeichneFeld() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.spielfeld.width, el.spielfeld.height);
    ctx.setTransform(skala, 0, 0, skala, versatzX, versatzY);

    zeichneHintergrund();
    zeichneGasse();
    slings.forEach(zeichneSling);
    zeichneLoch();
    elemente.forEach(function (e) {
      if (e.art === "bumper") { zeichneBumper(e); } else { zeichneTor(e); }
    });
    zeichneFlipper(flipperL);
    zeichneFlipper(flipperR);
    malUndBewegeFunken();
    if (kugel) { zeichneKugel(); }
    zeichneVignette();
  }

  // --- Spielfeld-Grund: dunkelblaues "Kabinett" mit Goldleiste, darin die
  //     helle Spielflaeche. Rampen, Gasse und Abfluss sind Teil des Rahmens.
  function zeichneHintergrund() {
    // 1) Kabinett (aussen): edles dunkles Blau wie das Missions-Schild
    ctx.beginPath();
    ctx.moveTo(0, FELD_H);
    ctx.lineTo(0, 124);
    ctx.arc(200, 124, 200, Math.PI, 0);
    ctx.lineTo(400, FELD_H);
    ctx.closePath();
    var kab = ctx.createLinearGradient(0, 0, 0, FELD_H);
    kab.addColorStop(0, "#2b4373");
    kab.addColorStop(1, "#1d2c54");
    ctx.fillStyle = kab;
    ctx.fill();

    // 2) Spielflaeche (innen): warmes Creme mit Licht von oben
    ctx.beginPath();
    ctx.moveTo(16, FELD_H);
    ctx.lineTo(16, 124);
    ctx.arc(200, 124, 184, Math.PI, 0);
    ctx.lineTo(384, FELD_H);
    ctx.closePath();
    var feld = ctx.createLinearGradient(0, -60, 0, FELD_H);
    feld.addColorStop(0, "#fffdf6");
    feld.addColorStop(0.55, "#f4f0e2");
    feld.addColorStop(1, "#e7e9f2");
    ctx.fillStyle = feld;
    ctx.fill();
    // Goldleiste zwischen Kabinett und Flaeche
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#f3c44a";
    ctx.stroke();

    // 3) Dezente Wiesen-Deko: Huegel + Bluemchen (Platzhalter fuer eigenes
    //    Hintergrundbild - hier einfach drawImage() einsetzen)
    ctx.fillStyle = "rgba(40, 192, 138, 0.08)";
    ctx.beginPath(); ctx.ellipse(90, 470, 120, 46, 0, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.ellipse(300, 480, 130, 52, 0, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "rgba(47, 111, 214, 0.05)";
    ctx.beginPath(); ctx.arc(200, 210, 92, 0, Math.PI * 2); ctx.fill();
    [[70, 130], [330, 140], [160, 400], [240, 388]].forEach(function (b) {
      zeichneBluemchen(b[0], b[1]);
    });

    // 4) Rampen unten (Teil des Rahmens): fuehren zur Flipper-Ebene
    ctx.fillStyle = "#26375f";
    ctx.beginPath();                          // links
    ctx.moveTo(16, 445); ctx.lineTo(PIVOT_L.x, PIVOT_L.y);
    ctx.lineTo(104, FELD_H); ctx.lineTo(16, FELD_H);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();                          // rechts (bis unter die Gasse)
    ctx.moveTo(GASSE_X, 448); ctx.lineTo(PIVOT_R.x, PIVOT_R.y);
    ctx.lineTo(296, FELD_H); ctx.lineTo(384, FELD_H);
    ctx.lineTo(384, 514); ctx.lineTo(348, 508);
    ctx.closePath(); ctx.fill();
    // goldene Kante auf den Rampen
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#f3c44a";
    ctx.beginPath();
    ctx.moveTo(16, 445); ctx.lineTo(PIVOT_L.x, PIVOT_L.y);
    ctx.moveTo(GASSE_X, 448); ctx.lineTo(PIVOT_R.x, PIVOT_R.y);
    ctx.stroke();

    // 5) Abfluss in der Mitte: dunkle Oeffnung ueber die volle Kanalbreite
    ctx.beginPath();
    ctx.ellipse(200, FELD_H + 4, 96, 38, 0, Math.PI, 0, true);
    ctx.fillStyle = "#131f3e";
    ctx.fill();
  }

  function zeichneBluemchen(x, y) {
    for (var i = 0; i < 5; i++) {
      var a = i / 5 * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 3.4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(243, 169, 60, 0.35)";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(217, 69, 62, 0.4)";
    ctx.fill();
  }

  // --- Abschuss-Gasse rechts: Trennwand, Umlenk-Dach, Kraftanzeige, Feder
  function zeichneGasse() {
    // Trennwand mit runder Kappe + Umlenk-Dach (nach links ins Feld)
    ctx.lineCap = "round";
    ctx.strokeStyle = "#26375f";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(GASSE_X, 508); ctx.lineTo(GASSE_X, 190);
    ctx.lineTo(GASSE_X, 172); ctx.lineTo(300, 200);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#f3c44a";
    ctx.beginPath();
    ctx.moveTo(GASSE_X - 4, 505); ctx.lineTo(GASSE_X - 4, 192);
    ctx.stroke();

    // Kraftanzeige (Plunger): fuellt sich, solange der Knopf gehalten wird
    var stand = ladeStand();
    if (state.wartetAufAbschuss) {
      var bx = 366, by = 300, bh = 150, bw = 12;   // Balken in der Gasse
      ctx.fillStyle = "rgba(30, 44, 82, 0.16)";
      ctx.beginPath();
      abgerundetesRechteck(bx, by, bw, bh, 6); ctx.fill();
      var fh = bh * stand;
      var farbe = stand > 0.75 ? "#d9453e" : (stand > 0.4 ? "#ff9e2c" : "#28c08a");
      ctx.fillStyle = farbe;
      ctx.beginPath();
      abgerundetesRechteck(bx, by + (bh - fh), bw, fh, 6); ctx.fill();
    }

    // Pfeile in der Gasse (leuchten, wenn die Kugel wartet)
    var puls = state.wartetAufAbschuss
      ? 0.45 + 0.4 * Math.sin(performance.now() / 200) : 0.18;
    ctx.fillStyle = "rgba(243, 196, 74, " + puls + ")";
    [250, 200].forEach(function (y) {
      ctx.beginPath();
      ctx.moveTo(373, y - 12);
      ctx.lineTo(383, y + 4);
      ctx.lineTo(363, y + 4);
      ctx.closePath();
      ctx.fill();
    });

    // Feder unter der wartenden Kugel (staucht sich mit dem Ladestand)
    if (state.wartetAufAbschuss && kugel) {
      var oben = kugel.position.y + KUGEL_RADIUS + 2;
      var y0 = 505 - stand * 8;                 // laedt -> Feder staucht leicht
      ctx.strokeStyle = "#d9453e";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      var stufen = 5, hoehe = (y0 - oben) / stufen;
      ctx.moveTo(373, y0);
      for (var i = 0; i < stufen; i++) {
        ctx.lineTo(i % 2 === 0 ? 365 : 381, y0 - hoehe * (i + 0.5));
      }
      ctx.lineTo(373, oben);
      ctx.stroke();
    }
  }

  // Sanfte Vignette: dunkelt die Raender minimal ab -> mehr Tiefe
  function zeichneVignette() {
    var v = ctx.createRadialGradient(200, 260, 150, 200, 300, 420);
    v.addColorStop(0, "rgba(20, 30, 60, 0)");
    v.addColorStop(1, "rgba(20, 30, 60, 0.13)");
    ctx.beginPath();
    ctx.moveTo(0, FELD_H);
    ctx.lineTo(0, 124);
    ctx.arc(200, 124, 200, Math.PI, 0);
    ctx.lineTo(400, FELD_H);
    ctx.closePath();
    ctx.fillStyle = v;
    ctx.fill();
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

  // --- Fang-Loch mit rotierendem 3D-Koerper ---------------------------------
  //     Farben mischen (fuer Licht/Schatten der Koerper)
  function hexRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mischeFarbe(hex, mit, anteil) {
    var a = hexRgb(hex), b = hexRgb(mit);
    return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * anteil) + "," +
                    Math.round(a[1] + (b[1] - a[1]) * anteil) + "," +
                    Math.round(a[2] + (b[2] - a[2]) * anteil) + ")";
  }

  function zeichneLoch() {
    loch.drehung += 0.03;
    var x = loch.x, y = loch.y, r = loch.r;

    // Schatten + dunkle Oeffnung (Tiefe per Radialverlauf)
    ctx.beginPath();
    ctx.ellipse(x, y + 4, r * 1.04, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(30, 44, 82, 0.22)";
    ctx.fill();
    var g = ctx.createRadialGradient(x, y - 3, r * 0.2, x, y, r);
    g.addColorStop(0, "#0d1730");
    g.addColorStop(1, "#26375f");
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = "#f3c44a"; ctx.stroke();

    // Timer-Ring, solange eine Kugel gefangen ist (leert sich in 2 s)
    if (loch.gefangen) {
      var t = Math.min(1, (performance.now() - loch.gefangenSeit) / 2000);
      ctx.beginPath();
      ctx.arc(x, y, r + 5, -Math.PI / 2, -Math.PI / 2 + (1 - t) * Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(255, 158, 44, 0.9)";
      ctx.stroke();
    }

    // Der rotierende Koerper darauf
    zeichneKoerper3D(KOERPER_3D[loch.aktuell], x, y, r * 0.62, loch.drehung);
  }

  // Rotierender 3D-Koerper (Platzhalter-Vektorgrafik mit Dreh-Illusion)
  function zeichneKoerper3D(k, cx, cy, s, dreh) {
    if (k.id === "wuerfel")      { zeichneKasten(cx, cy, s * 0.82, s * 0.82, s * 1.5, dreh, k.farbe); }
    else if (k.id === "quader")  { zeichneKasten(cx, cy, s * 0.95, s * 0.5, s * 1.85, dreh, k.farbe); }
    else if (k.id === "pyramide"){ zeichnePyramide(cx, cy, s * 0.95, s * 1.7, dreh, k.farbe); }
    else if (k.id === "kugel")   { zeichne3dKugel(cx, cy, s, dreh, k.farbe); }
    else if (k.id === "zylinder"){ zeichneZylinder(cx, cy, s * 0.72, s * 1.7, dreh, k.farbe); }
    else if (k.id === "kegel")   { zeichneKegel(cx, cy, s * 0.85, s * 1.7, dreh, k.farbe); }
  }

  // Drehbarer Quader (leichte Aufsicht): 4 Seiten nach Tiefe sortiert + Deckel
  function zeichneKasten(cx, cy, a, b, h, dreh, farbe) {
    var tilt = 0.42;
    var hell = mischeFarbe(farbe, "#ffffff", 0.42);
    var dunkel = mischeFarbe(farbe, "#000000", 0.32);
    var ecken = [[-a, -b], [a, -b], [a, b], [-a, b]];
    var top = [], bot = [];
    for (var i = 0; i < 4; i++) {
      var ex = ecken[i][0], ez = ecken[i][1];
      var rx = ex * Math.cos(dreh) - ez * Math.sin(dreh);
      var rz = ex * Math.sin(dreh) + ez * Math.cos(dreh);
      top.push({ x: cx + rx, y: cy - h / 2 + rz * tilt, z: rz });
      bot.push({ x: cx + rx, y: cy + h / 2 + rz * tilt, z: rz });
    }
    var seiten = [];
    for (var j = 0; j < 4; j++) {
      var n = (j + 1) % 4;
      seiten.push({ pts: [top[j], top[n], bot[n], bot[j]], z: (top[j].z + top[n].z) / 2 });
    }
    seiten.sort(function (p, q) { return p.z - q.z; });
    seiten.forEach(function (fl) {
      ctx.beginPath();
      fl.pts.forEach(function (p, kk) { ctx[kk === 0 ? "moveTo" : "lineTo"](p.x, p.y); });
      ctx.closePath();
      ctx.fillStyle = fl.z >= 0 ? farbe : dunkel;
      ctx.fill();
      ctx.lineWidth = 1.4; ctx.strokeStyle = dunkel; ctx.stroke();
    });
    ctx.beginPath();
    top.forEach(function (p, kk) { ctx[kk === 0 ? "moveTo" : "lineTo"](p.x, p.y); });
    ctx.closePath();
    ctx.fillStyle = hell; ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = dunkel; ctx.stroke();
  }

  function zeichnePyramide(cx, cy, a, h, dreh, farbe) {
    var tilt = 0.42;
    var apex = { x: cx, y: cy - h / 2 };
    var ecken = [[-a, -a], [a, -a], [a, a], [-a, a]];
    var base = [];
    for (var i = 0; i < 4; i++) {
      var ex = ecken[i][0], ez = ecken[i][1];
      var rx = ex * Math.cos(dreh) - ez * Math.sin(dreh);
      var rz = ex * Math.sin(dreh) + ez * Math.cos(dreh);
      base.push({ x: cx + rx, y: cy + h / 2 + rz * tilt, z: rz });
    }
    var faces = [];
    for (var j = 0; j < 4; j++) {
      var n = (j + 1) % 4;
      faces.push({ pts: [apex, base[j], base[n]], z: (base[j].z + base[n].z) / 2 });
    }
    faces.sort(function (p, q) { return p.z - q.z; });
    faces.forEach(function (f) {
      ctx.beginPath();
      f.pts.forEach(function (p, kk) { ctx[kk === 0 ? "moveTo" : "lineTo"](p.x, p.y); });
      ctx.closePath();
      ctx.fillStyle = f.z >= 0 ? mischeFarbe(farbe, "#ffffff", 0.28)
                               : mischeFarbe(farbe, "#000000", 0.30);
      ctx.fill();
      ctx.lineWidth = 1.4; ctx.strokeStyle = mischeFarbe(farbe, "#000000", 0.32); ctx.stroke();
    });
  }

  function zeichne3dKugel(cx, cy, r, dreh, farbe) {
    var g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r);
    g.addColorStop(0, mischeFarbe(farbe, "#ffffff", 0.7));
    g.addColorStop(0.5, farbe);
    g.addColorStop(1, mischeFarbe(farbe, "#000000", 0.34));
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = mischeFarbe(farbe, "#000000", 0.3); ctx.stroke();
    // rotierender Meridian -> Dreh-Illusion
    ctx.beginPath();
    ctx.ellipse(cx, cy, Math.abs(Math.cos(dreh)) * r * 0.88, r * 0.9, 0, 0, Math.PI * 2);
    ctx.lineWidth = 1.4; ctx.strokeStyle = "rgba(255,255,255,0.32)"; ctx.stroke();
  }

  function zeichneZylinder(cx, cy, r, h, dreh, farbe) {
    var oben = cy - h / 2, unten = cy + h / 2, ry = r * 0.34;
    var koerper = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    koerper.addColorStop(0, mischeFarbe(farbe, "#000000", 0.30));
    koerper.addColorStop(0.5, mischeFarbe(farbe, "#ffffff", 0.36));
    koerper.addColorStop(1, mischeFarbe(farbe, "#000000", 0.30));
    ctx.beginPath();
    ctx.moveTo(cx - r, oben);
    ctx.lineTo(cx - r, unten);
    ctx.ellipse(cx, unten, r, ry, 0, Math.PI, 0, true);
    ctx.lineTo(cx + r, oben);
    ctx.closePath();
    ctx.fillStyle = koerper; ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = mischeFarbe(farbe, "#000000", 0.3); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(cx, oben, r, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = mischeFarbe(farbe, "#ffffff", 0.42); ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = mischeFarbe(farbe, "#000000", 0.3); ctx.stroke();
    var nx = cx + Math.sin(dreh) * r * 0.92;
    ctx.beginPath(); ctx.moveTo(nx, oben + ry * (Math.cos(dreh) < 0 ? -0.2 : 0.2));
    ctx.lineTo(nx, unten); ctx.lineWidth = 1.4;
    ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.stroke();
  }

  function zeichneKegel(cx, cy, r, h, dreh, farbe) {
    var oben = cy - h / 2, unten = cy + h / 2, ry = r * 0.34;
    var g = ctx.createLinearGradient(cx - r, 0, cx + r, 0);
    g.addColorStop(0, mischeFarbe(farbe, "#000000", 0.30));
    g.addColorStop(0.45, mischeFarbe(farbe, "#ffffff", 0.36));
    g.addColorStop(1, mischeFarbe(farbe, "#000000", 0.30));
    ctx.beginPath();
    ctx.moveTo(cx, oben);
    ctx.lineTo(cx + r, unten);
    ctx.ellipse(cx, unten, r, ry, 0, 0, Math.PI, false);
    ctx.closePath();
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = mischeFarbe(farbe, "#000000", 0.3); ctx.stroke();
  }

  // --- Pilz-Bumper: schattierter roter Hut mit Glanzlicht und Tupfen,
  //     Symbol auf einem weissen Schild in der Mitte
  function zeichneBumper(e) {
    var blitz = blitzWert(e.blitzZeit);
    var r = e.r + blitz * 5;                // ploppt beim Treffer kurz auf

    if (state.mission && state.mission.element === e) {
      zeichneMissionsRing(e.x, e.y, e.r);
    }

    // weicher Schlagschatten auf der Spielflaeche
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + r * 0.95, r * 0.85, r * 0.28, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(30, 44, 82, 0.16)";
    ctx.fill();

    // Stiel mit leichtem Verlauf
    var stiel = ctx.createLinearGradient(e.x - r * 0.4, 0, e.x + r * 0.4, 0);
    stiel.addColorStop(0, "#efdcba");
    stiel.addColorStop(0.5, "#f9efd8");
    stiel.addColorStop(1, "#e3ceaa");
    ctx.fillStyle = stiel;
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + r * 0.55, r * 0.42, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hut: Radialverlauf mit Lichtpunkt oben links (blitzt beim Treffer)
    var hut = ctx.createRadialGradient(e.x - r * 0.35, e.y - r * 0.4, r * 0.15,
                                       e.x, e.y, r);
    if (blitz > 0) {
      hut.addColorStop(0, "#ffb3a6"); hut.addColorStop(1, "#ff7a68");
    } else {
      hut.addColorStop(0, "#f4796a"); hut.addColorStop(1, "#c9402f");
    }
    ctx.beginPath();
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
    ctx.fillStyle = hut;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#a2352b";
    ctx.stroke();

    // Glanzbogen oben links
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * 0.78, Math.PI * 1.05, Math.PI * 1.45);
    ctx.lineWidth = r * 0.14;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.stroke();

    // weisse Tupfen
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    [[-0.55, -0.35, 0.15], [0.5, -0.45, 0.12], [0.1, 0.6, 0.11]].forEach(function (t) {
      ctx.beginPath();
      ctx.arc(e.x + t[0] * r, e.y + t[1] * r, t[2] * r, 0, Math.PI * 2);
      ctx.fill();
    });

    // weisses Schild in der Mitte mit Goldrand + Symbol
    ctx.beginPath();
    ctx.arc(e.x, e.y, r * 0.66, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#f3c44a";
    ctx.stroke();
    zeichneSymbol(e.symbol, e.x, e.y, r * 0.74);
  }

  // --- Tor: goldgerahmtes Tuerchen mit sanftem Verlauf und Symbol
  function zeichneTor(e) {
    var blitz = blitzWert(e.blitzZeit);
    if (state.mission && state.mission.element === e) {
      zeichneMissionsRing(e.x, e.y, 34);
    }
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.winkel);
    // Schlagschatten
    ctx.beginPath();
    abgerundetesRechteck(-e.w / 2 + 2, -e.h / 2 + 4, e.w, e.h, 9);
    ctx.fillStyle = "rgba(30, 44, 82, 0.18)";
    ctx.fill();
    // Tuerchen mit Verlauf
    var tuer = ctx.createLinearGradient(0, -e.h / 2, 0, e.h / 2);
    if (blitz > 0) {
      tuer.addColorStop(0, "#fff3d6"); tuer.addColorStop(1, "#ffe2a6");
    } else {
      tuer.addColorStop(0, "#ffffff"); tuer.addColorStop(1, "#e8edfa");
    }
    ctx.beginPath();
    abgerundetesRechteck(-e.w / 2, -e.h / 2, e.w, e.h, 9);
    ctx.fillStyle = tuer;
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "#f3c44a";
    ctx.stroke();
    ctx.lineWidth = 1.5;
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
    var verlauf = ctx.createLinearGradient(0, s.ecken[0].y, 0, s.ecken[2].y);
    if (blitz > 0) {
      verlauf.addColorStop(0, "#ffe9b0"); verlauf.addColorStop(1, "#ffd27f");
    } else {
      verlauf.addColorStop(0, "#f8d876"); verlauf.addColorStop(1, "#e9b23a");
    }
    ctx.beginPath();
    ctx.moveTo(s.ecken[0].x, s.ecken[0].y);
    ctx.lineTo(s.ecken[1].x, s.ecken[1].y);
    ctx.lineTo(s.ecken[2].x, s.ecken[2].y);
    ctx.closePath();
    ctx.fillStyle = verlauf;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = blitz > 0 ? "#f3c44a" : "#c99427";
    ctx.stroke();
    // Gummiband-Linie an der Schraege (typisches Flipper-Detail)
    ctx.beginPath();
    ctx.moveTo(s.ecken[0].x, s.ecken[0].y);
    ctx.lineTo(s.ecken[1].x, s.ecken[1].y);
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(217, 69, 62, 0.85)";
    ctx.stroke();
  }

  function zeichneFlipper(f) {
    var a = f.seite < 0 ? f.winkel : Math.PI - f.winkel;
    ctx.save();
    ctx.translate(f.pivot.x, f.pivot.y);
    ctx.rotate(a);
    // Schlagschatten unter dem Arm
    ctx.beginPath();
    abgerundetesRechteck(-4, -FLIPPER_DICKE / 2 + 4, FLIPPER_LAENGE + 4,
                         FLIPPER_DICKE, FLIPPER_DICKE / 2 - 1);
    ctx.fillStyle = "rgba(30, 44, 82, 0.20)";
    ctx.fill();
    // Arm als Kapsel mit Verlauf: links BLAU, rechts ROT (wie die Zonen)
    var arm = ctx.createLinearGradient(0, -FLIPPER_DICKE / 2, 0, FLIPPER_DICKE / 2);
    if (f.seite < 0) { arm.addColorStop(0, "#5a92e8"); arm.addColorStop(1, "#2456ab"); }
    else             { arm.addColorStop(0, "#ef7a6e"); arm.addColorStop(1, "#b2372c"); }
    ctx.beginPath();
    abgerundetesRechteck(-4, -FLIPPER_DICKE / 2, FLIPPER_LAENGE + 4,
                         FLIPPER_DICKE, FLIPPER_DICKE / 2 - 1);
    ctx.fillStyle = arm;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = f.seite < 0 ? "#1e4b96" : "#a2352b";
    ctx.stroke();
    // Glanzlinie oben auf dem Arm
    ctx.beginPath();
    ctx.moveTo(4, -FLIPPER_DICKE / 2 + 4.5);
    ctx.lineTo(FLIPPER_LAENGE - 10, -FLIPPER_DICKE / 2 + 4.5);
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.stroke();
    ctx.restore();
    // Drehpunkt: goldene "Schraube", halb im Rahmen versenkt
    ctx.beginPath();
    ctx.arc(f.pivot.x, f.pivot.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#f3c44a";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#c99427";
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(f.pivot.x, f.pivot.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#26375f";
    ctx.fill();
  }

  function zeichneKugel() {
    var p = kugel.position;

    // Schweif: letzte Positionen verblassen hinter der Kugel
    kugelSpur.push({ x: p.x, y: p.y });
    if (kugelSpur.length > 7) { kugelSpur.shift(); }
    kugelSpur.forEach(function (s, i) {
      ctx.globalAlpha = (i + 1) / kugelSpur.length * 0.18;
      ctx.beginPath();
      ctx.arc(s.x, s.y, KUGEL_RADIUS * (0.5 + i / kugelSpur.length * 0.4), 0, Math.PI * 2);
      ctx.fillStyle = "#8fa8d8";
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // kleiner Schatten unter der Kugel
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + KUGEL_RADIUS * 0.9, KUGEL_RADIUS * 0.8,
                KUGEL_RADIUS * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(30, 44, 82, 0.18)";
    ctx.fill();

    // Metall-Optik: heller Lichtpunkt oben links, dunkler Rand
    var verlauf = ctx.createRadialGradient(p.x - 4, p.y - 5, 1.5, p.x, p.y, KUGEL_RADIUS);
    verlauf.addColorStop(0, "#ffffff");
    verlauf.addColorStop(0.4, "#dfe7f6");
    verlauf.addColorStop(1, "#8d9fc6");
    ctx.beginPath();
    ctx.arc(p.x, p.y, KUGEL_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = verlauf;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#5f6e96";
    ctx.stroke();
    // Glanzpunkt
    ctx.beginPath();
    ctx.arc(p.x - 3.5, p.y - 4, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fill();
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
    pruefeGasse();
    pruefeStillstand();
    pruefeKugelVerlust();
    zeichneFeld();
  }
  window.requestAnimationFrame(function (zeit) { letzteZeit = zeit; schleife(zeit); });


  /* 9. ZWISCHENSPIELE ----------------------------------------------------------
     Zwischen zwei Kugeln kommt IMMER eine kleine Aufgabe – abwechselnd:
       a) "Zeichne die andere Hälfte": links steht eine halbe Zeichnung, das
          Kind zeichnet rechts auf weisser Flaeche die gespiegelte Haelfte
          nach. Die Kontrollpunkte sind UNSICHTBAR (im Hintergrund) und
          grosszuegig, es muss in EINEM Zug (max. 2 Ansaetze) gezeichnet
          werden – wildes Kritzeln startet den Versuch neu.
       b) Eine Rechenaufgabe (Zahlenraum + Operationen im Menue einstellbar).
     Es gibt bewusst KEINEN Ueberspringen-Knopf: die Aufgabe ist unausweichlich. */

  // Abwechselnd Zeichnen / Rechnen aufrufen
  function oeffneZwischenspiel() {
    var typ = state.naechstesZwischen;
    state.naechstesZwischen = (typ === "zeichnen") ? "rechnen" : "zeichnen";
    if (typ === "rechnen") { oeffneRechnen(); } else { oeffneZeichnen(); }
  }

  /* --- 9a) ZEICHNE DIE ANDERE HAELFTE ------------------------------------- */

  // Halbe Zeichnungen als Linienzuege in Einheitskoordinaten (0..1),
  // Spiegelachse bei x = 0.5. >>> Eigene Motive: einfach Punkte ergaenzen. <<<
  var ZEICHEN_MOTIVE = [
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
      [0.38, 0.60], [0.24, 0.80], [0.50, 0.80]] },
    { name: "Kreis", farbe: "#2f6fd6", punkte: [
      [0.50, 0.18], [0.34, 0.22], [0.23, 0.34], [0.19, 0.50],
      [0.23, 0.66], [0.34, 0.78], [0.50, 0.82]] },
    { name: "Dreieck", farbe: "#28c08a", punkte: [
      [0.50, 0.18], [0.36, 0.50], [0.22, 0.82], [0.50, 0.82]] },
    { name: "Raute", farbe: "#9a7bd0", punkte: [
      [0.50, 0.16], [0.36, 0.33], [0.24, 0.50], [0.36, 0.67], [0.50, 0.84]] }
  ];

  var zeichnen = {
    offen: false, motiv: null, ziele: [],    // ziele: {x,y,getroffen} (unsichtbar!)
    striche: [], aktuell: null, malt: false,  // striche: Liste von Punkt-Listen
    wegLaenge: 0, budget: 0, fertig: false
  };
  var zeichenCtx = el.spiegelCanvas.getContext("2d");

  function oeffneZeichnen() {
    zeichnen.offen = true;
    zeichnen.fertig = false;
    zeichnen.motiv = zufallAus(ZEICHEN_MOTIVE);
    zeichnen.striche = [];
    zeichnen.aktuell = null;
    zeichnen.wegLaenge = 0;

    el.spiegelTitel.textContent = "✏️ Zeichne die andere Hälfte!";
    el.spiegelOverlay.classList.add("offen");
    el.spiegelOverlay.setAttribute("aria-hidden", "false");
    el.spiegelHinweis.textContent = "Zeichne rechts die andere Hälfte – in einem Zug.";
    el.spiegelHinweis.classList.remove("erfolg");

    // Canvas-Aufloesung + unsichtbare Kontrollpunkte aus dem gespiegelten
    // Linienzug abtasten. Grober Abstand + grosser Radius = grosse Toleranz.
    var dpr = window.devicePixelRatio || 1;
    var box = el.spiegelCanvas.getBoundingClientRect();
    el.spiegelCanvas.width = Math.round(box.width * dpr);
    el.spiegelCanvas.height = Math.round(box.height * dpr);

    var K = el.spiegelCanvas.width;          // quadratisch (CSS aspect-ratio)
    zeichnen.ziele = [];
    var abstand = K * 0.085;
    var pts = zeichnen.motiv.punkte.map(function (p) {
      return { x: (1 - p[0]) * K, y: p[1] * K };   // x spiegeln: rechte Haelfte
    });
    var motivLaenge = 0;
    for (var i = 0; i < pts.length - 1; i++) {
      var a = pts[i], b = pts[i + 1];
      var laenge = Math.hypot(b.x - a.x, b.y - a.y);
      motivLaenge += laenge;
      var n = Math.max(1, Math.round(laenge / abstand));
      for (var j = 0; j < n; j++) {
        zeichnen.ziele.push({ x: a.x + (b.x - a.x) * j / n,
                              y: a.y + (b.y - a.y) * j / n, getroffen: false });
      }
    }
    zeichnen.ziele.push({ x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, getroffen: false });
    // Weg-Budget gegen wildes Kritzeln (2 Zuege duerfen etwas laenger sein)
    zeichnen.budget = motivLaenge * 2.6;

    sprich("Zeichne die andere Hälfte! Zeichne sie in einem Zug nach.");
    zeichneZeichnung();
  }

  function zeichneZeichnung() {
    var K = el.spiegelCanvas.width, ctx2 = zeichenCtx;
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

    // Linke Haelfte: die fertige Vorlage
    ctx2.strokeStyle = zeichnen.motiv.farbe;
    ctx2.lineWidth = dick;
    ctx2.lineCap = "round";
    ctx2.lineJoin = "round";
    ctx2.beginPath();
    zeichnen.motiv.punkte.forEach(function (p, i) {
      ctx2[i === 0 ? "moveTo" : "lineTo"](p[0] * K, p[1] * K);
    });
    ctx2.stroke();

    // Rechte Haelfte: KEINE sichtbaren Punkte – nur weisse Flaeche.
    // Nach dem Erfolg wird das gespiegelte Motiv als Loesung eingeblendet.
    if (zeichnen.fertig) {
      ctx2.strokeStyle = zeichnen.motiv.farbe;
      ctx2.lineWidth = dick;
      ctx2.beginPath();
      zeichnen.motiv.punkte.forEach(function (p, i) {
        ctx2[i === 0 ? "moveTo" : "lineTo"]((1 - p[0]) * K, p[1] * K);
      });
      ctx2.stroke();
    }

    // Kinder-Zeichnung (alle Striche, bleiben stehen)
    ctx2.strokeStyle = "rgba(40, 160, 120, 0.85)";
    ctx2.lineWidth = dick * 1.25;
    zeichnen.striche.forEach(function (strich) {
      if (strich.length < 2) { return; }
      ctx2.beginPath();
      strich.forEach(function (p, i) { ctx2[i === 0 ? "moveTo" : "lineTo"](p.x, p.y); });
      ctx2.stroke();
    });
  }

  function zeichenPunktVonEvent(ereignis) {
    var box = el.spiegelCanvas.getBoundingClientRect();
    var dpr = el.spiegelCanvas.width / box.width;
    return { x: (ereignis.clientX - box.left) * dpr,
             y: (ereignis.clientY - box.top) * dpr };
  }

  // Versuch neu starten (zu viele Ansaetze oder Gekritzel)
  function neuerZeichenVersuch(hinweis) {
    zeichnen.striche = [];
    zeichnen.aktuell = null;
    zeichnen.wegLaenge = 0;
    zeichnen.ziele.forEach(function (z) { z.getroffen = false; });
    el.spiegelHinweis.textContent = hinweis;
    sprich(hinweis);
    zeichneZeichnung();
  }

  function zeichenMale(ereignis) {
    if (!zeichnen.offen || !zeichnen.malt || zeichnen.fertig) { return; }
    ereignis.preventDefault();
    var p = zeichenPunktVonEvent(ereignis);
    var K = el.spiegelCanvas.width;
    if (p.x < K / 2) { return; }              // linke Haelfte ist tabu (Vorlage)
    var strich = zeichnen.aktuell;
    if (strich && strich.length) {
      var vor = strich[strich.length - 1];
      zeichnen.wegLaenge += Math.hypot(p.x - vor.x, p.y - vor.y);
    }
    strich.push(p);
    // Anti-Kritzel: zu langer Weg -> Versuch neu
    if (zeichnen.wegLaenge > zeichnen.budget) {
      zeichnen.malt = false;
      neuerZeichenVersuch("Nicht kritzeln – zeichne die Linie in einem Zug nach!");
      return;
    }
    var radius = K * 0.075, neue = 0;         // grosse, unsichtbare Toleranz
    zeichnen.ziele.forEach(function (z) {
      if (!z.getroffen && Math.hypot(z.x - p.x, z.y - p.y) < radius) {
        z.getroffen = true; neue++;
      }
    });
    if (neue > 0) { spielKlang("spiegelpunkt"); }
    zeichneZeichnung();
    pruefeZeichenFertig();
  }

  function pruefeZeichenFertig() {
    var offen = zeichnen.ziele.filter(function (z) { return !z.getroffen; }).length;
    if (offen > 0) { return; }
    zeichnen.fertig = true;
    zeichnen.malt = false;
    el.spiegelHinweis.textContent = "✨ Wunderbar nachgezeichnet!";
    el.spiegelHinweis.classList.add("erfolg");
    zeichneZeichnung();
    werfeKonfetti();
    spielKlang("erfolg");
    sprich("Wunderbar gezeichnet! Hier kommt die nächste Kugel!");
    window.setTimeout(schliesseZeichnen, 1600);
  }

  function schliesseZeichnen() {
    zeichnen.offen = false;
    el.spiegelOverlay.classList.remove("offen");
    el.spiegelOverlay.setAttribute("aria-hidden", "true");
    neueKugel();
  }

  el.spiegelCanvas.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    if (!zeichnen.offen || zeichnen.fertig) { return; }
    // Maximal ZWEI Ansaetze: der dritte startet den Versuch neu
    if (zeichnen.striche.length >= 2) {
      neuerZeichenVersuch("In einem Zug bitte – höchstens zweimal ansetzen!");
    }
    zeichnen.aktuell = [];
    zeichnen.striche.push(zeichnen.aktuell);
    zeichnen.malt = true;
    el.spiegelCanvas.setPointerCapture(e.pointerId);
    zeichenMale(e);
  });
  el.spiegelCanvas.addEventListener("pointermove", zeichenMale);
  el.spiegelCanvas.addEventListener("pointerup", function () {
    zeichnen.malt = false;
  });
  el.spiegelCanvas.addEventListener("pointercancel", function () {
    zeichnen.malt = false;
  });

  /* --- 9b) RECHENAUFGABE -------------------------------------------------- */

  function erzeugeAufgabe() {
    var ops = [];
    if (state.rechnen.plus)    { ops.push("plus"); }
    if (state.rechnen.minus)   { ops.push("minus"); }
    if (state.rechnen.mal)     { ops.push("mal"); }
    if (state.rechnen.geteilt) { ops.push("geteilt"); }
    if (!ops.length) { ops = ["plus"]; }
    var op = zufallAus(ops);
    var zr = state.rechnen.zahlenraum;
    var a, b, erg, text, gesprochen;
    if (op === "plus") {
      a = zufallGanzzahl(0, zr); b = zufallGanzzahl(0, zr - a);
      erg = a + b; text = a + " + " + b; gesprochen = a + " plus " + b;
    } else if (op === "minus") {
      a = zufallGanzzahl(0, zr); b = zufallGanzzahl(0, a);
      erg = a - b; text = a + " − " + b; gesprochen = a + " minus " + b;
    } else if (op === "mal") {
      a = zufallGanzzahl(1, 10); b = zufallGanzzahl(1, 10);      // kleines Einmaleins
      erg = a * b; text = a + " × " + b; gesprochen = a + " mal " + b;
    } else {
      b = zufallGanzzahl(2, 10); erg = zufallGanzzahl(1, 10); a = b * erg;
      text = a + " ÷ " + b; gesprochen = a + " geteilt durch " + b;
    }
    return { text: text, erg: erg, gesprochen: gesprochen };
  }

  var rechenAufgabe = null;

  function oeffneRechnen() {
    rechenAufgabe = erzeugeAufgabe();
    el.rechenFrage.textContent = rechenAufgabe.text + " = ?";
    el.rechenHinweis.textContent = "Tippe die richtige Antwort!";
    el.rechenHinweis.classList.remove("erfolg");

    // Antwortmoeglichkeiten: richtige + zwei knappe Nachbarn
    var antworten = [rechenAufgabe.erg], schutz = 0;
    while (antworten.length < 3 && schutz < 60) {
      var d = rechenAufgabe.erg + zufallGanzzahl(-3, 3);
      if (d >= 0 && antworten.indexOf(d) < 0) { antworten.push(d); }
      schutz++;
    }
    while (antworten.length < 3) { antworten.push(rechenAufgabe.erg + antworten.length); }
    antworten.sort(function () { return Math.random() - 0.5; });

    leere(el.rechenAntworten);
    antworten.forEach(function (wert) {
      var knopf = document.createElement("button");
      knopf.type = "button";
      knopf.className = "rechen-antwort";
      knopf.textContent = wert;
      knopf.addEventListener("click", function () { antworteRechnen(wert, knopf); });
      el.rechenAntworten.appendChild(knopf);
    });

    el.rechenOverlay.classList.add("offen");
    el.rechenOverlay.setAttribute("aria-hidden", "false");
    sprich("Rechne: " + rechenAufgabe.gesprochen + "?");
  }

  function antworteRechnen(wert, knopf) {
    if (!rechenAufgabe) { return; }
    if (wert === rechenAufgabe.erg) {
      var loesung = rechenAufgabe.erg;
      rechenAufgabe = null;
      knopf.classList.add("richtig");
      el.rechenHinweis.textContent = "✨ Richtig!";
      el.rechenHinweis.classList.add("erfolg");
      werfeKonfetti();
      spielKlang("richtig");
      sprich(zufallAus(["Richtig!", "Super gerechnet!", "Genau!", "Klasse!"]) +
             " Das ist " + loesung + ".");
      window.setTimeout(schliesseRechnen, 1400);
    } else {
      knopf.classList.add("falsch");
      el.rechenOverlay.querySelector(".rechen-karte").classList.add("wackelt");
      window.setTimeout(function () {
        el.rechenOverlay.querySelector(".rechen-karte").classList.remove("wackelt");
      }, 550);
      spielKlang("falsch");
      sprich("Fast! Probier es noch einmal.");
    }
  }

  function schliesseRechnen() {
    el.rechenOverlay.classList.remove("offen");
    el.rechenOverlay.setAttribute("aria-hidden", "true");
    neueKugel();
  }


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
      abschuss:     { toene: [196, 392, 587.33],    art: "square",   laut: 0.14, dauer: 0.12 },
      laden:        { toene: [160],                 art: "square",   laut: 0.06, dauer: 0.06 },
      verloren:     { toene: [330, 262],            art: "sine",     laut: 0.14, dauer: 0.22 },
      spiegelpunkt: { toene: [740 + Math.random() * 160], art: "sine", laut: 0.1, dauer: 0.07 },
      richtig:      { toene: [523.25, 659.25, 880], art: "triangle", laut: 0.2,  dauer: 0.16 },
      falsch:       { toene: [220, 175],            art: "sine",     laut: 0.12, dauer: 0.18 }
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
    state.baelle = BAELLE_PRO_RUNDE;
    state.rundenStartPunkte = state.punkte;
    el.anzeigeBaelle.textContent = state.baelle;
    wendeSchwierigkeitAn();
    passeCanvasAn();
    verteileSymbole();
    planeMission(6000);
    sprich("Willkommen in der Pilz-Arena!");
    neueKugel();
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
  el.statBaelle.addEventListener("click", function () {
    zeigePopover("🎱 Deine <b>Kugeln</b>: So viele Kugeln hast du noch in dieser Runde!", el.statBaelle);
  });

  // --- Einstellungen: Karten togglen + speichern
  function markiereEinstellungen() {
    document.querySelectorAll(".opt-karte").forEach(function (karte) {
      var s = karte.dataset.setting, w = karte.dataset.wert;
      var aktiv =
        (s === "symbole" && state.symbole === w) ||
        (s === "schwierigkeit" && state.schwierigkeit === w) ||
        (s === "zwischen" && state.zwischenspiele === (w === "an")) ||
        (s === "zahlenraum" && state.rechnen.zahlenraum === parseInt(w, 10)) ||
        (s === "rechenop" && state.rechnen[w] === true) ||
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
      if (s === "schwierigkeit" && SCHWIERIGKEITEN[w]) {
        state.schwierigkeit = w;
        wendeSchwierigkeitAn();              // wirkt sofort auf die Kugel
      }
      if (s === "zwischen") { state.zwischenspiele = (w === "an"); }
      if (s === "zahlenraum") { state.rechnen.zahlenraum = parseInt(w, 10); }
      if (s === "rechenop") { state.rechnen[w] = !state.rechnen[w]; }  // Mehrfachauswahl
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
        schwierigkeit: state.schwierigkeit, zwischenspiele: state.zwischenspiele,
        rechnen: state.rechnen, toene: state.toene, sprache: state.sprache
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
      if (SCHWIERIGKEITEN[d.schwierigkeit]) { state.schwierigkeit = d.schwierigkeit; }
      // Zwischenspiele (neuer Schluessel, aber alten "spiegel" noch respektieren)
      if (typeof d.zwischenspiele === "boolean") { state.zwischenspiele = d.zwischenspiele; }
      else if (typeof d.spiegel === "boolean") { state.zwischenspiele = d.spiegel; }
      if (d.rechnen && typeof d.rechnen === "object") {
        if ([10, 20, 100].indexOf(d.rechnen.zahlenraum) >= 0) {
          state.rechnen.zahlenraum = d.rechnen.zahlenraum;
        }
        ["plus", "minus", "mal", "geteilt"].forEach(function (op) {
          if (typeof d.rechnen[op] === "boolean") { state.rechnen[op] = d.rechnen[op]; }
        });
      }
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
  wendeSchwierigkeitAn();
  el.anzeigeBaelle.textContent = state.baelle;
  passeCanvasAn();
  verteileSymbole();
  zeichneFeld();                             // Standbild hinter dem Titel
})();
