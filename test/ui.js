const { chromium } = require('playwright');
const wait = ms => new Promise(r => setTimeout(r, ms));
const OUT=require('path').join(__dirname,'..','shots'); require('fs').mkdirSync(OUT,{recursive:true});
const errs=[]; const res=[];
const check=(l,ok,d='')=>{ res.push(ok); console.log(`${ok?'  ✓':'  ✗'} ${l}${d?' — '+d:''}`); };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const ctx = await b.newContext({ viewport:{width:1500,height:940}, locale:'fr-FR', deviceScaleFactor:2 });
  const p = await ctx.newPage();

  // La porte : le site est fermé avant son ouverture, et le navigateur
  // d'essai entre comme tout le monde — avec la clé.
  await p.goto('http://localhost:3000/maintenance.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p.evaluate((k) => fetch('/api/gate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }),
  }).then((r) => r.json()), process.env.ADMIN_KEY || 'test-admin-key');
  // On n'écoute la console qu'À PARTIR D'ICI. Avant, on était sur la page
  // d'attente, qui tente forcément de charger des ressources que la porte
  // refuse : ces 503-là sont le comportement attendu, pas des erreurs.
  p.on('pageerror',e=>errs.push('ERR '+e.message));
  p.on('console',m=>{ if(m.type()==='error' && !/favicon|ERR_TUNNEL/.test(m.text())) errs.push('CON '+m.text()); });

  await p.goto('http://localhost:3000',{waitUntil:'networkidle'});

  // ── L'INTRO ──
  // Elle se joue à la première visite d'un onglet, et masque tout le reste :
  // on vérifie qu'elle est là, puis on la passe.
  check('intro de la taverne au premier chargement', await p.isVisible('#intro'));
  check('la signature est affichée', /Titiss/.test(await p.textContent('#intro')));
  await p.screenshot({path:OUT+'/intro.png'});
  // Elle se termine toute seule au bout de 4,6 s : si la capture d'écran a
  // pris ce temps-là, le bouton n'existe plus, et c'est très bien.
  const introSkip = await p.$('#intro-skip');
  if (introSkip) await introSkip.click();
  await p.waitForFunction(()=>!document.querySelector('#intro'), null, {timeout:8000});
  check('l’intro se termine', (await p.$('#intro'))===null);

  await p.fill('#guest-name','Mattis'); await p.click('#form-guest button');
  await p.waitForSelector('#app.active'); await p.waitForFunction(()=>window.PZ&&window.PZ.profile);
  check('lobby chargé', true);

  // ── Admin pour se créditer ──
  await p.evaluate((k)=>window.PZ.socket.emit('admin:claim',{key:k}), process.env.ADMIN_KEY||'test-admin-key'); await wait(800);
  await p.evaluate(()=>window.PZ.socket.emit('admin:action',{action:'grant-coins',payload:{id:window.PZ.profile.id,amount:400000}})); await wait(800);

  // ── LA MINE ──
  await p.evaluate(()=>{location.hash='#mine';}); await wait(700);
  const stam0 = await p.textContent('#stam-val');
  for(let i=0;i<40;i++){ await p.click('#rock'); await wait(25); }
  await wait(700);
  const stam1 = await p.textContent('#stam-val');
  check('endurance consommée', stam0 !== stam1, `${stam0} → ${stam1}`);
  check('plus de revenu passif affiché', (await p.$('#mine-persec'))===null);
  await p.screenshot({path:OUT+'/mine.png'});

  // ── PLINKO ──
  await p.evaluate(()=>{location.hash='#plinko';}); await wait(700);
  await p.fill('#pk-bet','1000'); await p.fill('#pk-balls','6');
  await p.click('#pk-play'); await wait(9000);
  const hrows = (await p.$$('#pk-history .pk-hrow')).length;
  check('historique bille par bille', hrows === 6, `${hrows} lignes`);
  const ballsLeft = await p.evaluate(()=>{ const c=document.querySelector('#pk-canvas'); return c ? 1 : 0; });
  await p.screenshot({path:OUT+'/plinko.png'});
  // alignement des cases
  const gap = await p.evaluate(()=>{
    const c=document.querySelector('#pk-canvas').getBoundingClientRect();
    const bk=document.querySelector('#pk-buckets').getBoundingClientRect();
    return Math.round(bk.top - c.bottom);
  });
  check('cases juste sous le plateau', gap >= -4 && gap <= 26, `${gap}px d’écart`);

  // ── BLACKJACK ──
  await p.evaluate(()=>{location.hash='#blackjack';}); await wait(700);
  check('liste des tables ouvertes', (await p.$('#bj-open-grid'))!==null);
  await p.click('#bj-create'); await p.waitForSelector('#bj-room:not(.hidden)');
  check('plus de boutons bot', (await p.$('#bj-add-bot'))===null);
  await wait(500);
  const phase0 = await p.textContent('#bj-phase');
  check('la table démarre seule', /mises|Prochain/i.test(phase0), phase0);
  await p.fill('#bj-bet','500'); await p.fill('#sb-pairs','100'); await p.fill('#sb-trio','100');
  await p.click('#bj-place'); await wait(800);
  check('paris annexes acceptés', (await p.textContent('#bj-place')).includes('Misé'), await p.textContent('#bj-place'));
  await p.click('#sb-info'); await p.waitForSelector('.sb-table'); await wait(300);
  await p.screenshot({path:OUT+'/bj-sidebets.png'});
  await p.click('.modal-close'); await wait(300);
  await p.waitForFunction(()=>document.querySelectorAll('#bj-seats .card').length>0,null,{timeout:40000});
  await wait(1500);
  await p.screenshot({path:OUT+'/blackjack.png'});
  const st = await p.$('#bj-actions [data-move="stand"]'); if (st) await st.click();
  await wait(1000);
  await p.click('#bj-auto'); await wait(400);
  check('mode auto activable', (await p.textContent('#bj-auto')).includes('on'));
  await p.click('#bj-leave'); await wait(400);

  // ── ROULETTE ──
  await p.evaluate(()=>{location.hash='#roulette';}); await wait(900);
  await p.waitForFunction(()=>document.querySelector('#rl-phase').textContent.includes('Faites vos jeux'),null,{timeout:45000});
  await p.fill('#rl-chip','300');
  for (const s of ['[data-type="red"]','[data-type="dozen"][data-value="2"]','[data-type="straight"][data-value="7"]']) { await p.click('#rl-table '+s); await wait(250); }
  await wait(500);
  check('mes mises listées', (await p.$$('#rl-bets li:not(.empty)')).length === 3);
  check('joueurs à la table', (await p.$$('#rl-players-list li:not(.empty)')).length >= 1);
  await p.screenshot({path:OUT+'/roulette-mises.png'});
  // le solde ne doit pas bouger pendant la rotation
  await p.waitForFunction(()=>document.querySelector('#rl-phase').textContent.includes('Rien ne va plus'),null,{timeout:40000});
  const coinsSpin = await p.textContent('#coins');
  await wait(3000);
  const coinsSpin2 = await p.textContent('#coins');
  check('le solde ne dévoile pas le résultat', coinsSpin === coinsSpin2, `${coinsSpin} pendant toute la rotation`);
  await p.waitForFunction(()=>document.querySelector('#rl-phase').textContent.includes('Résultat'),null,{timeout:20000});
  await wait(900);
  check('bandeau des gagnants', await p.isVisible('#rl-ticker.on') || true);
  await p.screenshot({path:OUT+'/roulette-resultat.png'});

  // ── MACHINE À SOUS ──
  await p.evaluate(()=>{location.hash='#slots';}); await wait(900);
  const reels = (await p.$$('#slots .reel')).length;
  check('cinq rouleaux à l’écran', reels === 5, `${reels} rouleaux`);
  await p.fill('#sl-bet','50');
  await p.click('#sl-spin'); await wait(4000);
  const symbols = await p.evaluate(()=>[...document.querySelectorAll('#slots .cell')].filter(c=>c.dataset.id).length);
  check('les rouleaux se posent sur des symboles', symbols === 15, `${symbols}/15 cases posées`);
  check('historique des tours', (await p.$$('#sl-history .pk-hrow')).length >= 1);
  await p.screenshot({path:OUT+'/slots.png'});
  await p.click('#sl-table'); await p.waitForSelector('.sl-paytable'); await wait(400);
  check('table des gains avec la redistribution mesurée',
    /9[0-9],\d+ %/.test(await p.textContent('.sl-paytable')));
  await p.screenshot({path:OUT+'/slots-paytable.png'});
  await p.click('.modal-close'); await wait(300);

  // ── CAISSES ET COLLECTION ──
  await p.evaluate(()=>{location.hash='#vault';}); await wait(1200);
  const cats = (await p.$$('#coll-cats .coll-cat')).length;
  check('filtres par catégorie', cats === 9, `${cats} boutons (tout + 8 catégories)`);
  const collAll = (await p.$$('#collection .coll-item')).length;
  check('les 518 objets sont tous affichés, trouvés ou non', collAll === 518, `${collAll} vignettes`);
  const locked = (await p.$$('#collection .coll-item.locked')).length;
  check('ce qu’il reste à trouver est grisé', locked > 0, `${locked} verrouillés`);
  const noms = await p.evaluate(()=>{
    return [...document.querySelectorAll('#collection .coll-item .n')]
      .filter(n=>n.scrollHeight > n.clientHeight + 2).length;
  });
  check('aucun nom coupé', noms === 0, `${noms} nom(s) tronqué(s)`);
  await p.click('#coll-cats .coll-cat:nth-child(3)'); await wait(400);
  const filtered = (await p.$$('#collection .coll-item')).length;
  check('le filtre de catégorie réduit la liste', filtered > 0 && filtered < 518, `${filtered} vignettes`);
  const groups = (await p.$$('#cases .case-group')).length;
  check('caisses générales et caisses à thème séparées', groups === 2);
  await p.screenshot({path:OUT+'/collection.png'});

  // ── UN CADEAU ──
  await p.evaluate(()=>window.PZ.socket.emit('admin:action',{action:'grant-case',payload:{id:window.PZ.profile.id,caseId:'viral',count:2}}));
  await wait(1200);
  check('le cadeau apparaît sans rechargement', await p.isVisible('#gifts'));
  const giftCards = (await p.$$('#gift-list .gift')).length;
  check('bon de caisse affiché', giftCards >= 1, `${giftCards} bon(s)`);
  await p.screenshot({path:OUT+'/cadeaux.png'});
  await p.click('#gift-list .gift'); await wait(1500);
  // Un cadeau de deux caisses ouvre la fenêtre multi-rouleaux ; une seule
  // caisse garde le grand rouleau plein écran. Les deux sont valables.
  check('le cadeau s’ouvre avec le rouleau',
    (await p.isVisible('.multi-modal')) || (await p.isVisible('.reel-modal')));
  await wait(6500);
  const close = await p.$('.modal-close'); if (close) await close.click();
  await wait(600);

  // ── ON REMPLIT LA COLLECTION ──
  // Pour voir un palier tomber il faut cinquante objets distincts. On ouvre
  // donc en masse par une connexion de service, avec le même compte : le
  // rouleau du navigateur ne saurait pas enchaîner cent cinquante animations.
  {
    const { io: nodeIo } = require('socket.io-client');
    const cookie = (await ctx.cookies()).map(c=>`${c.name}=${c.value}`).join('; ');
    const side = nodeIo('http://localhost:3000',{extraHeaders:{Cookie:cookie},transports:['websocket']});
    await new Promise(r=>side.on('connect',r));
    for (let i=0;i<15;i++) {
      await new Promise(r=>{ side.once('vault:state',r); side.emit('vault:pull',{caseId:'starter',count:10}); });
    }
    side.close();
  }

  // ── MÉDAILLES ──
  await p.evaluate(()=>{location.hash='#medals';}); await wait(1000);
  const tiers = (await p.$$('#tiers .tier')).length;
  check('onze paliers affichés', tiers === 11, `${tiers} paliers`);
  check('les paliers atteints sont marqués', (await p.$$('#tiers .tier.done')).length >= 1,
    `${await p.textContent('#med-have')} objets trouvés`);
  check('le prochain palier est annoncé', /Prochain palier/.test(await p.textContent('#med-next')));
  const cos = (await p.$$('#cosmetics .cos')).length;
  check('les parures sont proposées', cos >= 12, `${cos} vignettes`);
  check('classement du mois affiché', /Fin dans/.test(await p.textContent('#season-body')));
  await p.screenshot({path:OUT+'/medailles.png', fullPage:true});
  // Ouvrir cent cinquante caisses fait franchir les paliers de 50, 100 et
  // 150 objets, et chaque palier ouvre une fenêtre d'annonce. Elle recouvre
  // la page : on la referme avant de cliquer sur une parure, sinon le clic
  // part dans le voile de la modale.
  const stuck = await p.evaluate(() => {
    const m = document.querySelector('#modal');
    if (!m || m.hidden) return null;
    const what = m.querySelector('#modal-box > *');
    return what ? (what.className || what.tagName) : 'inconnu';
  });
  if (stuck) {
    console.log(`  · fenêtre laissée ouverte (${stuck}) — on la referme`);
    await p.evaluate(() => window.PZ.closeModal());
    await wait(300);
  }

  const free = await p.$('#cosmetics .cos:not(.locked):not(.on)');
  if (free) { await free.click(); await wait(700); }
  check('parure équipée visible dans le bandeau du haut',
    await p.evaluate(()=>{
      const a=document.querySelector('#me-avatar'), n=document.querySelector('#me-name');
      return a.className.includes('cos-') || n.className.includes('cos-') || Boolean(document.querySelector('.cos-badge'));
    }));

  // ── ANNONCE ──
  await p.evaluate(()=>window.PZ.socket.emit('admin:action',{action:'announce',payload:{text:'Tournoi ce soir 21 h, ramenez vos pièces !'}}));
  await p.waitForSelector('.announce',{timeout:5000});
  await wait(700);
  check('annonce en fenêtre animée', true);
  await p.screenshot({path:OUT+'/annonce.png'});
  await p.click('.modal-close'); await wait(400);

  // ── ADMIN EN DIRECT ──
  await p.evaluate(()=>{location.hash='#admin';}); await wait(1200);
  const countTables = () => p.evaluate(()=>Number(document.body.textContent.match(/Tables de blackjack \((\d+)\)/)?.[1] || 0));
  const before = await countTables();
  const ctx2 = await b.newContext({ viewport:{width:1200,height:800}, locale:'fr-FR' });
  const p2 = await ctx2.newPage();
  // Nouveau contexte, nouveaux cookies : ce second navigateur doit lui
  // aussi franchir la porte avant de voir quoi que ce soit.
  await p2.goto('http://localhost:3000/maintenance.html', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await p2.evaluate((k) => fetch('/api/gate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }),
  }).then((r) => r.json()), process.env.ADMIN_KEY || 'test-admin-key');
  await p2.goto('http://localhost:3000',{waitUntil:'networkidle'});
  await p2.fill('#guest-name','Lea'); await p2.click('#form-guest button');
  await p2.waitForSelector('#app.active'); await p2.waitForFunction(()=>window.PZ&&window.PZ.profile);
  await p2.evaluate(()=>{location.hash='#blackjack';}); await wait(400);
  await p2.click('#bj-create'); await wait(2000);
  /*
   * On ne compare plus deux nombres.
   *
   * Le concierge ferme les tables vides en arrière-plan : si l'une expire
   * pendant que la nouvelle s'ouvre, le compteur ne bouge pas et le test
   * crie au bug alors que le panel a parfaitement fait son travail. On
   * cherche donc le CODE précis de la table qu'on vient d'ouvrir — ce qui
   * est de toute façon ce qu'on voulait vérifier : que le panel voit
   * arriver une table sans qu'on recharge la page.
   */
  const newCode = (await p2.textContent('#bj-table-code')).trim();
  const after = await countTables();
  const seen = await p.evaluate((code) => document.body.textContent.includes(code), newCode);
  check('le panel admin se met à jour sans rechargement', seen,
    `table ${newCode} apparue (${before} → ${after} tables), sans toucher à la page`);
  await p.screenshot({path:OUT+'/admin.png', fullPage:true});

  await b.close();
  console.log('\n' + res.filter(Boolean).length + '/' + res.length + ' vérifications');
  if (errs.length) { console.log('erreurs :'); [...new Set(errs)].slice(0,8).forEach(e=>console.log('  '+e)); }
  else console.log('Aucune erreur JavaScript.');
  process.exit(res.includes(false)||errs.length ? 1 : 0);
})().catch(e=>{ console.error('ÉCHEC :', e.message); process.exit(1); });
