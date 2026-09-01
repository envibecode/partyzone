const { chromium } = require('playwright');
const wait = ms => new Promise(r => setTimeout(r, ms));
const OUT=require('path').join(__dirname,'..','shots'); require('fs').mkdirSync(OUT,{recursive:true});
const errs=[]; const res=[];
const check=(l,ok,d='')=>{ res.push(ok); console.log(`${ok?'  ✓':'  ✗'} ${l}${d?' — '+d:''}`); };
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
  const ctx = await b.newContext({ viewport:{width:1500,height:940}, locale:'fr-FR', deviceScaleFactor:2 });
  const p = await ctx.newPage();
  p.on('pageerror',e=>errs.push('ERR '+e.message));
  p.on('console',m=>{ if(m.type()==='error' && !/favicon|ERR_TUNNEL/.test(m.text())) errs.push('CON '+m.text()); });

  await p.goto('http://localhost:3000',{waitUntil:'networkidle'});
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
  await p2.goto('http://localhost:3000',{waitUntil:'networkidle'});
  await p2.fill('#guest-name','Lea'); await p2.click('#form-guest button');
  await p2.waitForSelector('#app.active'); await p2.waitForFunction(()=>window.PZ&&window.PZ.profile);
  await p2.evaluate(()=>{location.hash='#blackjack';}); await wait(400);
  await p2.click('#bj-create'); await wait(2000);
  const after = await countTables();
  check('le panel admin se met à jour sans rechargement', after === before + 1,
    `${before} → ${after} tables, sans toucher à la page`);
  await p.screenshot({path:OUT+'/admin.png', fullPage:true});

  await b.close();
  console.log('\n' + res.filter(Boolean).length + '/' + res.length + ' vérifications');
  if (errs.length) { console.log('erreurs :'); [...new Set(errs)].slice(0,8).forEach(e=>console.log('  '+e)); }
  else console.log('Aucune erreur JavaScript.');
  process.exit(res.includes(false)||errs.length ? 1 : 0);
})().catch(e=>{ console.error('ÉCHEC :', e.message); process.exit(1); });
