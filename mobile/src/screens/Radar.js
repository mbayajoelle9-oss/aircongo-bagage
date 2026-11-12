import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, Alert } from 'react-native';
import CarteOSM from '../CarteOSM';
import { api } from '../api';
import { etatLocal } from '../geo';
import { C, OPERATEURS, usd } from '../theme';
import { Carte, H, T, Muted, Champ, Bouton, Erreur, Pill } from '../ui';

const PHASE = { AU_SOL: C.gris, EN_VOL: C.vert, ARRIVE: C.bleu2, ANNULE: C.rouge };

// Radar des vols en temps réel. `mesBagages` : [{numeroVol, depart, arrivee, nb}] → pastille 🧳 qui voyage avec l'avion.
export default function Radar({ jeton, personnel = false, mesBagages = [], volInitial = null, passager = null }) {
  const [vols, setVols] = useState([]);
  const [q, setQ] = useState('');
  const [choisi, setChoisi] = useState(volInitial);
  const [suivre, setSuivre] = useState(false);
  const [acc, setAcc] = useState(false); // démo accélérée ×60 (personnel uniquement)
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState('');
  const [fiche, setFiche] = useState(null);
  const accDebut = useRef({ r: Date.now(), s: Date.now() });
  const cadrer = useRef(false);

  const charger = useCallback(async () => {
    try { setVols((await api('GET', `/api/radar${q.trim() ? `?compagnie=${encodeURIComponent(q.trim())}` : ''}`)).vols); setErr(''); }
    catch (e) { setErr(e.message); }
  }, [q]);
  useEffect(() => { charger(); const i = setInterval(charger, 15000); return () => clearInterval(i); }, [charger]);
  useEffect(() => { const i = setInterval(() => setTick((n) => n + 1), suivre ? 500 : 1000); return () => clearInterval(i); }, [suivre]);
  useEffect(() => { if (!choisi) { setFiche(null); return; } const v = vols.find((x) => x.id === choisi); setFiche(v ?? null); }, [choisi, vols]);

  const maintenant = () => (acc ? accDebut.current.s + (Date.now() - accDebut.current.r) * 60 : Date.now());
  const basculerAcc = () => { accDebut.current = { r: Date.now(), s: Date.now() }; setAcc((a) => !a); };

  const sacs = (v) => mesBagages.filter((b) => b.numeroVol === v.numero && b.depart === v.depart && b.arrivee === v.arrivee).reduce((n, b) => n + b.nb, 0);

  const donneesCarte = useMemo(() => {
    const t = maintenant();
    const avions = vols.map((v) => {
      const e = etatLocal(v, t);
      if (!e) return null;
      const n = sacs(v);
      return { id: v.id, lat: e.pos[0], lon: e.pos[1], cap: e.cap, sel: v.id === choisi, bag: n || null };
    }).filter(Boolean);
    const v = vols.find((x) => x.id === choisi);
    const out = { avions, trace: v?.trace?.length === 2 ? v.trace.map((p) => [p.lat, p.lon]) : null, suivre: suivre ? choisi : null, cadrer: cadrer.current };
    cadrer.current = false;
    return out;
    // eslint-disable-next-line
  }, [vols, choisi, suivre, tick, acc]);

  const choisir = (id) => { cadrer.current = true; setChoisi(id); setSuivre(false); };
  const v = fiche;
  const e = v ? etatLocal(v, maintenant()) : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 10, backgroundColor: '#fff', flexDirection: 'row', gap: 8 }}>
        <TextInput value={q} onChangeText={setQ} onSubmitEditing={charger} returnKeyType="search" placeholder="Compagnie : Air Congo, Kenya Airways…"
          placeholderTextColor="#9aa5b1" style={{ flex: 1, borderWidth: 1, borderColor: C.bord, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: '#1d2733' }} />
        {personnel ? <TouchableOpacity onPress={basculerAcc} style={{ justifyContent: 'center', paddingHorizontal: 10, borderRadius: 10, backgroundColor: acc ? C.orange : C.fond }}><Text style={{ fontWeight: '700', color: acc ? '#fff' : C.gris }}>×60</Text></TouchableOpacity> : null}
      </View>
      {acc ? <Text style={{ backgroundColor: '#fff4e0', color: '#7a5200', fontSize: 12, padding: 6, textAlign: 'center' }}>Simulation accélérée ×60 pour la démonstration : positions fictives.</Text> : null}
      <Erreur>{err}</Erreur>
      <View style={{ flex: 1.1 }}><CarteOSM donnees={donneesCarte} onVol={choisir} style={{ flex: 1 }} /></View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
        {v ? <FicheVol v={v} e={e} jeton={jeton} suivre={suivre} setSuivre={setSuivre} fermer={() => { setChoisi(null); setSuivre(false); }} nb={sacs(v)} recharger={charger} personnel={personnel} passager={passager} maintenant={maintenant} /> : null}
        <H>{vols.length} vol(s) · touchez un avion ou un vol</H>
        {vols.map((x) => (
          <TouchableOpacity key={x.id} onPress={() => choisir(x.id)}>
            <Carte style={{ padding: 10, borderColor: x.id === choisi ? C.bleu2 : C.bord }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T style={{ fontWeight: '700' }}>{x.numero} · {x.depart}→{x.arrivee}</T><Pill texte={x.libellePhase} couleur={PHASE[x.phase] ?? C.gris} /></View>
              <Muted>{x.compagnie ?? '—'} · {x.nbBagages} bagage(s) · {x.libreKg} kg libres</Muted>
            </Carte>
          </TouchableOpacity>))}
      </ScrollView>
    </View>
  );
}

function FicheVol({ v, e, jeton, suivre, setSuivre, fermer, nb, recharger, personnel, passager, maintenant }) {
  const [bagages, setBagages] = useState(null);
  const [achat, setAchat] = useState(false);
  useEffect(() => {
    setBagages(null);
    if (personnel && jeton && v.phase !== 'AU_SOL') api('GET', `/api/agent/radar/vols/${v.id}`, null, jeton).then((d) => setBagages(d.bagages)).catch(() => {});
  }, [v.id, v.phase]);
  const live = e?.phase === 'EN_VOL';
  const kmRestants = null;
  return (
    <Carte style={{ borderColor: C.bleu2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><H>{v.numero} · {v.villeDepart} → {v.villeArrivee}</H><TouchableOpacity onPress={fermer}><Text style={{ color: C.gris }}>✕</Text></TouchableOpacity></View>
      <Muted>{v.compagnie ?? ''} · départ {v.heureDepart ?? '—'}</Muted>
      <View style={{ height: 8 }} />
      <Pill texte={(e ? { AU_SOL: 'Au sol', EN_VOL: 'En vol', ARRIVE: 'Arrivé' }[e.phase] : null) ?? v.libellePhase} couleur={PHASE[e?.phase ?? v.phase] ?? C.gris} />
      {e && v.departTs ? <View style={{ height: 6, backgroundColor: C.fond, borderRadius: 3, marginTop: 10 }}><View style={{ height: 6, borderRadius: 3, backgroundColor: C.vert, width: `${Math.round(e.f * 100)}%` }} /></View> : null}
      {e && v.departTs ? <Muted style={{ marginTop: 4 }}>Progression {Math.round(e.f * 100)} %</Muted> : null}
      <View style={{ height: 8 }} />
      <T>🧳 {v.nbBagages} bagage(s) · {v.bagagesKg} kg + fret {v.fretKg} kg</T>
      <T>Soute : {v.libreKg} kg libres sur {v.capaciteKg} kg ({v.remplissagePct} % remplie)</T>
      {nb ? <T style={{ color: C.bleu2, fontWeight: '700', marginTop: 4 }}>Vos {nb} bagage(s) voyagent sur cet avion</T> : null}
      {live ? <Bouton titre={suivre ? '⏹ Arrêter le suivi' : '🎥 Suivre l’avion en direct'} onPress={() => setSuivre(!suivre)} couleur={suivre ? C.gris : C.vert} /> : null}
      {e?.phase === 'AU_SOL' && v.achatOuvert ? <Bouton titre={`Acheter de l’espace en soute (${usd(v.prixUsdKg)}/kg)`} onPress={() => setAchat(!achat)} couleur={C.orange} /> : null}
      {achat ? <Achat v={v} passager={passager} fini={() => { setAchat(false); recharger(); }} /> : null}
      {bagages ? <View style={{ marginTop: 10 }}><H>Bagages à bord ({bagages.length})</H>
        {bagages.slice(0, 40).map((b) => <T key={b.code} style={{ fontSize: 12 }}>{b.code} · {b.passager} · {b.poidsKg ?? '?'} kg · {b.libelle}</T>)}</View> : null}
    </Carte>
  );
}

function Achat({ v, passager, fini }) {
  const [kg, setKg] = useState('10');
  const [nom, setNom] = useState(passager?.nom ?? '');
  const [tel, setTel] = useState('');
  const [op, setOp] = useState('MPESA');
  const [err, setErr] = useState('');
  const [rec, setRec] = useState(null);
  const [att, setAtt] = useState(false);
  const total = (Number(kg) || 0) * (v.prixUsdKg ?? 0);
  const payer = async () => {
    setAtt(true); setErr('');
    try { setRec(await api('POST', '/api/espace/acheter', { volId: v.id, kg: Number(kg), nom, telephone: tel, operateur: op })); }
    catch (e) { setErr(e.message); }
    setAtt(false);
  };
  if (rec) return (<View style={{ backgroundColor: '#e9f7ef', padding: 12, borderRadius: 10, marginTop: 10 }}>
    <T style={{ fontWeight: '700' }}>Réservation confirmée</T><T style={{ fontSize: 20, fontWeight: '700' }}>{rec.reference}</T>
    <T>{rec.numeroVol} · {rec.kg} kg · {usd(rec.montantUsd)}</T><Muted>{rec.message}</Muted>
    <Bouton titre="Fermer" onPress={fini} couleur={C.vert} /></View>);
  return (<View style={{ marginTop: 10 }}>
    <Champ label="Poids à réserver (kg)" value={kg} onChangeText={setKg} keyboardType="numeric" />
    <Champ label="Nom" value={nom} onChangeText={setNom} autoCapitalize="words" />
    <Champ label="Numéro Mobile Money" value={tel} onChangeText={setTel} keyboardType="phone-pad" placeholder="0812345678" />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>{OPERATEURS.map(([k, n]) => (
      <TouchableOpacity key={k} onPress={() => setOp(k)} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 16, backgroundColor: op === k ? C.bleu2 : C.fond }}>
        <Text style={{ color: op === k ? '#fff' : C.gris, fontWeight: '600' }}>{n}</Text></TouchableOpacity>))}</View>
    <Erreur>{err}</Erreur>
    <Bouton titre={`Payer ${usd(total)} par Mobile Money`} onPress={payer} chargement={att} couleur={C.vert} />
    <Muted style={{ marginTop: 6 }}>Paiement simulé dans cette version de démonstration.</Muted>
  </View>);
}
